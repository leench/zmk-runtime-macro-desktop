//! Local HTTP API for automation clients on this machine.
//!
//! This is the loopback API described in `docs/DYNAMIC-AUTOMATION-PLAN.md` §10.
//! It lets another program on this machine learn which Runtime Macro devices
//! exist, how the user named them, and write one Dynamic Macro object:
//!
//! - `GET /api/v1/health` reports that the API is running;
//! - `GET /api/v1/devices` lists the connectable Runtime Macro interfaces with
//!   their safe summary and the user's local alias;
//! - `POST /api/v1/dynamic-macros` writes one Dynamic Macro object on the device
//!   the request names by alias.
//!
//! A write is addressed by the user's alias, never by a device identity: the
//! request names an alias and the API resolves it against the mirrored alias map
//! plus live discovery, so nothing is guessed and the window's opaque candidate
//! ids are never consumed or refreshed. With no active session the requested
//! device is connected and that shared session is kept; when another device is
//! already active the write is refused with `409` instead of switching devices
//! silently. The write itself runs through the same service and the same single
//! HID worker the window and the tray use, so there is never a second writer.
//!
//! Deliberate boundaries of this version:
//!
//! - a write request is strict JSON over `Content-Type: application/json`: an
//!   unknown field, a wrong type, a missing required field, a wrong media type
//!   and an oversized body are all refused before any HID access, and the text is
//!   checked against the protocol bounds before the device is even opened;
//! - the response never echoes the macro text back: a successful write reports
//!   the byte length, the effective TTL and the keep flag only, and it is a local
//!   acknowledgement, not a readback;
//! - the API always listens on the fixed loopback address [`API_BIND_ADDR`]
//!   while the desktop app runs. [`bind_loopback`] itself accepts only the
//!   exact IPv4 loopback address, so the API never binds `0.0.0.0`, a LAN
//!   address or IPv6, and a busy port only leaves the API unavailable instead of
//!   affecting the desktop app;
//! - `GET /api/v1/devices` answers only after the window has mirrored the
//!   device alias map for the first time. Before that first mirror the API is
//!   not ready and answers `503 service_not_ready` instead of publishing a
//!   device list whose aliases would all look unset; `GET /api/v1/health` stays
//!   available either way, so a client can tell "still starting" from "not
//!   running";
//! - there is no authentication yet, so the API stays a local surface. A
//!   request that carries an `Origin` header is refused, and no CORS header is
//!   ever sent, so a web page cannot read the API;
//! - a device is identified by the user's alias, never by a HID path, a serial
//!   number or a temporary candidate id. The write may open and retain the
//!   requested shared session, but it never changes devices silently;
//! - the window is told about a write (and about the session it may have opened)
//!   through one payload-free global event. The window re-reads the body-free
//!   connection, device list and service state through its existing read-only
//!   commands and sends no static management command, so the API never logs in,
//!   never lists and never touches a locked device on the window's behalf;
//! - device enumeration runs on the application's single HID worker through
//!   [`crate::commands::api_device_records`], so the API serializes with every
//!   Tauri command instead of opening a second HID writer;
//! - the module never logs a request, a response body, an alias, a HID path or a
//!   serial number.

use std::collections::BTreeMap;
use std::convert::Infallible;
use std::future::Future;
use std::io;
use std::net::TcpListener;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::Poll;
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full, LengthLimitError, Limited};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, ALLOW, CACHE_CONTROL, CONTENT_TYPE, ORIGIN};
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::Notify;

use crate::commands::AppState;
use crate::hid::DeviceSummary;

/// Fixed loopback endpoint of the local API.
///
/// The address is a constant so a local automation client can reach the API
/// without reading a runtime metadata file. It is always a loopback address.
pub const API_BIND_ADDR: &str = "127.0.0.1:17653";

/// Version reported by `GET /api/v1/health` and used by the `/api/v1` prefix.
pub const API_VERSION: u8 = 1;

/// Stable global event name the backend uses when the shared session or the
/// Dynamic service state changed outside the window (currently: a local API write,
/// which may also open the session for its device).
///
/// The event carries no payload at all, so a notification cannot leak macro text,
/// a HID path, a serial number, a raw frame or a device identity; the window
/// re-reads the authoritative, body-free state itself through its existing
/// read-only commands (connection, device list and the local service state) and
/// sends no static management command for it.
pub const DYNAMIC_STATE_CHANGED_EVENT: &str = "dynamic-state-changed";

/// Stable code of a request that arrives before the alias map was mirrored.
const SERVICE_NOT_READY_CODE: &str = "service_not_ready";

/// Fixed, sanitized message for [`SERVICE_NOT_READY_CODE`].
const SERVICE_NOT_READY_MESSAGE: &str = "The local API has not received the device alias map yet.";

/// Message of a refused bind request. It is a constant, so the rejected address
/// is never echoed and no operating-system text is attached.
const LOOPBACK_ONLY_MESSAGE: &str = "the local API only binds the IPv4 loopback address 127.0.0.1";

/// Upper bound of one device alias in UTF-8 bytes.
///
/// It is the same bound the desktop alias and the tray display name use, so the
/// API accepts exactly the names the user could already set.
pub const MAX_DEVICE_ALIAS_BYTES: usize = crate::scenario_store::MAX_SCENARIO_NAME_BYTES;

const HEALTH_PATH: &str = "/api/v1/health";
const DEVICES_PATH: &str = "/api/v1/devices";
const DYNAMIC_MACROS_PATH: &str = "/api/v1/dynamic-macros";
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
/// Longest accepted decimal representation of one summary part (`u16` or `i32`).
const MAX_SUMMARY_PART_DIGITS: usize = 11;
/// A client that never finishes its request headers is dropped instead of
/// holding a connection forever.
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Upper bound of one write request body.
///
/// The largest legal write is a 512-byte text plus its JSON envelope, so this is
/// generous while still keeping an oversized body from being buffered.
const MAX_WRITE_BODY_BYTES: usize = 4096;
/// Status of a write the device acknowledged in this session.
const COMMITTED_LOCALLY: &str = "committedLocally";
/// Fixed messages of the public error contract. Each one is a constant, so a
/// rejected value, a device identity or a backend detail can never travel back.
const TEXT_INVALID_MESSAGE: &str =
    "The text must be 1 to 512 bytes of printable ASCII, LF, Tab or Backspace.";
const TEXT_TOO_LONG_MESSAGE: &str =
    "The text exceeds the Dynamic Macro protocol limit of 512 bytes.";
const SLOT_INVALID_MESSAGE: &str =
    "The Dynamic object index must be inside the 0 to 7 protocol range.";
const TTL_INVALID_MESSAGE: &str =
    "The TTL must be between 1 and 86400 seconds, or omitted for the device default.";
const DEVICE_NOT_FOUND_MESSAGE: &str = "No Runtime Macro device matches the requested alias.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    api_version: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevicesResponse {
    devices: Vec<DeviceEntry>,
}

/// One device as the API publishes it.
///
/// The entry is built from the safe device summary plus the locally configured
/// alias. It has no field for a HID path, a serial number or a candidate id, so
/// none of them can be serialized by accident.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceEntry {
    vendor_id: u16,
    product_id: u16,
    product_name: Option<String>,
    interface_number: i32,
    usage_page: u16,
    usage: u16,
    alias: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: ErrorDetail,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorDetail {
    code: String,
    message: String,
}

/// One Dynamic Macro write request, exactly as the caller contract defines it.
///
/// The parser is strict: unknown fields, wrong types and missing required fields
/// are refused, so a misspelled field can never take effect silently. `slot`,
/// `ttl_seconds` and the body bounds are parsed as wider integers than the wire
/// types, which keeps an out-of-range value a validated request error instead of
/// a JSON type error.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DynamicWriteRequest {
    device_alias: String,
    text: String,
    slot: i64,
    #[serde(default)]
    ttl_seconds: Option<i64>,
    #[serde(default)]
    keep_after_execute: bool,
}

/// A write request that passed validation, in the shape the device layer takes.
struct ValidatedDynamicWrite {
    device_alias: String,
    text: String,
    slot: u8,
    ttl_seconds: Option<u32>,
    keep_after_execute: bool,
}

/// Body-free success response of one write.
///
/// It carries no field for the macro text, so the accepted text cannot be echoed
/// by construction: only the byte length, the effective TTL and the keep flag
/// travel, and `committedLocally` is a local acknowledgement rather than a
/// readback of device memory.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DynamicWriteResponse {
    status: &'static str,
    device_alias: String,
    slot: u8,
    text_length: u16,
    ttl_seconds: u32,
    keep_after_execute: bool,
}

/// One Dynamic Macro write the API asks the device layer to perform.
///
/// The text is moved into the protocol call and dropped afterwards. It is never
/// stored, logged or returned: the service state and the response both keep the
/// byte length instead.
pub(crate) struct ApiDynamicWrite {
    /// Safe device summary key the requested alias resolved to.
    pub summary_key: String,
    pub slot: u8,
    pub text: String,
    pub ttl_seconds: Option<u32>,
    pub keep_after_execute: bool,
}

impl std::fmt::Debug for ApiDynamicWrite {
    /// The macro text and the internal safe summary key are deliberately absent:
    /// a `Debug` print of a write request shows its bounds and length only, so
    /// the key stays an internal lookup value.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ApiDynamicWrite")
            .field("slot", &self.slot)
            .field("text_length", &self.text.len())
            .field("ttl_seconds", &self.ttl_seconds)
            .field("keep_after_execute", &self.keep_after_execute)
            .finish()
    }
}

/// Body-free result of one write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ApiDynamicOutcome {
    pub text_length: u16,
    /// Effective TTL: the requested value, or the device default the capability
    /// exchange reported.
    pub ttl_seconds: u32,
    pub keep_after_execute: bool,
}

/// One enumerable device, reduced to its safe summary key and display data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ApiDevice {
    /// `vendorId:productId:interfaceNumber:usagePage:usage`; the same safe key
    /// the desktop uses for local preferences, and never a HID path.
    pub summary_key: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: Option<String>,
    pub interface_number: i32,
    pub usage_page: u16,
    pub usage: u16,
}

impl ApiDevice {
    pub(crate) fn from_summary(summary: &DeviceSummary) -> Self {
        Self {
            summary_key: summary_key(summary),
            vendor_id: summary.vendor_id,
            product_id: summary.product_id,
            product_name: crate::commands::safe_product_name(summary.product_name.as_deref()),
            interface_number: summary.interface_number,
            usage_page: summary.usage_page,
            usage: summary.usage,
        }
    }
}

/// The safe device summary key derived exactly like the desktop's
/// `deviceSummaryKey`: five numeric parts joined by colons.
pub(crate) fn summary_key(summary: &DeviceSummary) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        summary.vendor_id,
        summary.product_id,
        summary.interface_number,
        summary.usage_page,
        summary.usage
    )
}

/// A device enumeration failure, already reduced to a sanitized envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ApiFailure {
    pub code: String,
    pub message: String,
}

impl ApiFailure {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

/// Boxed enumeration future, so the source stays object-safe without an extra
/// async-trait dependency.
pub(crate) type ApiFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// Device enumeration for the API.
///
/// The production implementation runs on the application's HID worker; tests
/// use fixed in-memory fixtures, which is also why this is a trait instead of a
/// free function.
pub(crate) trait ApiDeviceSource: Send + Sync + 'static {
    fn devices(&self) -> ApiFuture<Result<Vec<ApiDevice>, ApiFailure>>;

    /// Write one Dynamic Macro object through the shared device layer.
    ///
    /// The production implementation connects (or reuses) the device the safe
    /// summary key names and uploads through the same service the window uses;
    /// tests answer with fixed outcomes.
    fn write_dynamic(
        &self,
        write: ApiDynamicWrite,
    ) -> ApiFuture<Result<ApiDynamicOutcome, ApiFailure>>;
}

/// Reports a change the window did not cause itself.
///
/// The notification deliberately takes no argument and carries no payload: the
/// window re-reads the authoritative, body-free state itself, so this trait cannot
/// transmit macro text, a HID path, a serial number, a raw frame or a device
/// identity. A write that opened the shared session reports it through the same
/// notification, which is how the window learns that the device is connected
/// without a second event or a second vocabulary.
pub(crate) trait DynamicStateNotifier: Send + Sync + 'static {
    fn dynamic_state_changed(&self);
}

/// The production notifier: one global Tauri event with no payload.
pub(crate) struct TauriDynamicStateNotifier {
    app: tauri::AppHandle,
}

impl TauriDynamicStateNotifier {
    pub(crate) fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl DynamicStateNotifier for TauriDynamicStateNotifier {
    fn dynamic_state_changed(&self) {
        // A window that is gone (or not listening yet) is not a device error.
        let _ = self.app.emit(DYNAMIC_STATE_CHANGED_EVENT, ());
    }
}

/// Enumerates devices through the application's single HID worker.
pub(crate) struct HidApiDeviceSource {
    state: Arc<Mutex<AppState>>,
}

impl HidApiDeviceSource {
    pub(crate) fn new(state: Arc<Mutex<AppState>>) -> Self {
        Self { state }
    }
}

impl ApiDeviceSource for HidApiDeviceSource {
    fn devices(&self) -> ApiFuture<Result<Vec<ApiDevice>, ApiFailure>> {
        let state = Arc::clone(&self.state);
        Box::pin(async move {
            let records = crate::commands::api_device_records(state)
                .await
                .map_err(|error| ApiFailure::new(&error.code, &error.message))?;
            Ok(records
                .iter()
                .map(|record| ApiDevice::from_summary(&record.summary()))
                .collect())
        })
    }

    fn write_dynamic(
        &self,
        write: ApiDynamicWrite,
    ) -> ApiFuture<Result<ApiDynamicOutcome, ApiFailure>> {
        let state = Arc::clone(&self.state);
        Box::pin(async move {
            crate::commands::api_dynamic_write(state, write)
                .await
                .map_err(|error| ApiFailure::new(&error.code, &error.message))
        })
    }
}

/// Why a device alias map was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceAliasError {
    /// The key is not a safe device summary key.
    InvalidSummaryKey,
    /// The alias is empty, too long or contains a control character.
    InvalidAlias,
    /// Two devices would share one alias, which makes a name ambiguous.
    DuplicateAlias,
}

impl DeviceAliasError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidSummaryKey => "invalid_device_alias_key",
            Self::InvalidAlias => "invalid_device_alias",
            Self::DuplicateAlias => "duplicate_device_alias",
        }
    }

    /// A stable message that never echoes the rejected key or alias.
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidSummaryKey => {
                "A device alias must be keyed by a safe device summary, not by a device path."
            }
            Self::InvalidAlias => {
                "A device alias must be 1 to 64 bytes and free of control characters."
            }
            Self::DuplicateAlias => "One alias cannot belong to two devices.",
        }
    }
}

/// The locally configured device aliases, keyed by safe device summary key.
///
/// The map is a local display preference: the desktop keeps it in its own
/// storage and only mirrors it here so the API can resolve a device by name.
/// Every entry is re-validated on the way in, so a frontend bug or a hand-edited
/// value cannot introduce an unusable key, an unbounded alias or an ambiguous
/// name.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DeviceAliasRegistry {
    aliases: BTreeMap<String, String>,
    /// Whether the window has mirrored its alias map at least once.
    ///
    /// A brand-new registry and a registry that accepted an empty map both hold
    /// no alias, but they mean different things: the first one is "the window
    /// has not read its local storage yet", the second one is "the user has no
    /// alias". Only the second one may answer `/devices`.
    ready: bool,
}

impl DeviceAliasRegistry {
    pub fn alias_for(&self, summary_key: &str) -> Option<&str> {
        self.aliases.get(summary_key).map(String::as_str)
    }

    /// Safe summary key of the device that owns one alias.
    ///
    /// Aliases are unique per machine, so at most one key can match. This is the
    /// only device naming a write request is resolved through; the summary key
    /// stays internal and is never published.
    pub fn summary_key_for_alias(&self, alias: &str) -> Option<&str> {
        self.aliases
            .iter()
            .find(|(_, value)| value.as_str() == alias)
            .map(|(key, _)| key.as_str())
    }

    /// Whether the first alias mirror already arrived.
    ///
    /// A successful [`Self::replace`] — including one that carries an empty map
    /// — marks the registry ready; a refused one never does.
    pub fn is_ready(&self) -> bool {
        self.ready
    }

    /// Number of devices that currently have an alias.
    pub fn len(&self) -> usize {
        self.aliases.len()
    }

    pub fn is_empty(&self) -> bool {
        self.aliases.is_empty()
    }

    /// Replace the whole map with a freshly validated one.
    ///
    /// The replacement is all-or-nothing: an invalid entry leaves the previous
    /// map untouched instead of publishing a partially accepted one, and a
    /// refused map also leaves the readiness state untouched.
    pub fn replace(&mut self, incoming: &BTreeMap<String, String>) -> Result<(), DeviceAliasError> {
        let mut next: BTreeMap<String, String> = BTreeMap::new();
        for (key, alias) in incoming {
            if !is_safe_summary_key(key) {
                return Err(DeviceAliasError::InvalidSummaryKey);
            }
            let Some(alias) = normalize_alias(alias) else {
                return Err(DeviceAliasError::InvalidAlias);
            };
            if next.values().any(|existing| existing == alias) {
                return Err(DeviceAliasError::DuplicateAlias);
            }
            next.insert(key.clone(), alias.to_string());
        }
        self.aliases = next;
        self.ready = true;
        Ok(())
    }
}

/// Trim an alias draft into its stored form, or reject it.
fn normalize_alias(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > MAX_DEVICE_ALIAS_BYTES
        || trimmed.chars().any(char::is_control)
    {
        return None;
    }
    Some(trimmed)
}

/// Whether a key is the safe device summary key the desktop derives.
///
/// This mirrors the frontend `SUMMARY_KEY_PATTERN`: five decimal numbers joined
/// by colons. Digits are bounded so an arbitrary frontend payload cannot send an
/// unbounded numeric string.
fn is_safe_summary_key(key: &str) -> bool {
    let parts: Vec<&str> = key.split(':').collect();
    parts.len() == 5
        && parts.iter().all(|part| {
            let digits = part.strip_prefix('-').unwrap_or(part);
            !digits.is_empty()
                && digits.len() <= MAX_SUMMARY_PART_DIGITS
                && digits.bytes().all(|byte| byte.is_ascii_digit())
        })
}

/// Bind the loopback listener of the API.
///
/// The helper itself accepts nothing but the exact IPv4 loopback address, so a
/// later caller cannot widen the surface: an unspecified address (`0.0.0.0`), a
/// LAN address, an IPv6 address and a host name are all refused before any
/// socket is opened. The port still comes from the caller, which is what lets
/// tests bind an ephemeral loopback port.
///
/// Binding stays synchronous so a busy port is a plain return value instead of a
/// failed background task. A refusal is a constant message: the rejected address
/// is never echoed and no request or device information is recorded.
pub fn bind_loopback(address: &str) -> io::Result<TcpListener> {
    let parsed: std::net::SocketAddr = address
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, LOOPBACK_ONLY_MESSAGE))?;
    if parsed.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            LOOPBACK_ONLY_MESSAGE,
        ));
    }
    let listener = TcpListener::bind(parsed)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// Handle to the running local API server.
///
/// The acceptor runs as a detached task, so this handle is the only way to stop
/// it. Stopping releases the listener and the references the server holds to the
/// shared application state, which keeps an application shutdown from leaving
/// that state alive behind the process. It is a plain signal, not a manager: the
/// server itself owns its task, the listener and its state references.
pub struct ApiServer {
    shutdown: Arc<Notify>,
}

impl ApiServer {
    /// Signal the acceptor to stop.
    ///
    /// The call is idempotent and does not wait: the acceptor stops at its next
    /// await point and drops its listener and its state references. A server
    /// that never started (a busy port) has nothing to stop.
    pub fn shutdown(&self) {
        self.shutdown.notify_one();
    }
}

/// Start the API on [`API_BIND_ADDR`].
///
/// A failure to bind is deliberately silent: the API is an optional local
/// surface, the operating-system error text is not needed and must not travel
/// anywhere, and the desktop application keeps working without the API.
pub fn start(
    app: tauri::AppHandle,
    state: Arc<Mutex<AppState>>,
    aliases: Arc<Mutex<DeviceAliasRegistry>>,
) -> ApiServer {
    let Ok(listener) = bind_loopback(API_BIND_ADDR) else {
        // A busy or unavailable port only leaves the API unavailable; there is
        // no acceptor to stop afterwards.
        return ApiServer {
            shutdown: Arc::new(Notify::new()),
        };
    };
    let source = Arc::new(HidApiDeviceSource::new(state));
    let notifier = Arc::new(TauriDynamicStateNotifier::new(app));
    // The production server lives as long as the application, so the acceptor
    // task is detached instead of being observed here.
    spawn_acceptor(listener, source, aliases, notifier).0
}

/// Spawn the acceptor for an already-bound loopback listener.
///
/// The stop handle and the acceptor task are returned together so a caller that
/// has to observe the stop can await the task; production [`start`] keeps the
/// handle and drops the task handle. When the task is observed, its completion
/// is also the point at which the listener and the references to the shared
/// state have been released.
pub(crate) fn spawn_acceptor<S: ApiDeviceSource, N: DynamicStateNotifier>(
    listener: TcpListener,
    source: Arc<S>,
    aliases: Arc<Mutex<DeviceAliasRegistry>>,
    notifier: Arc<N>,
) -> (ApiServer, tauri::async_runtime::JoinHandle<()>) {
    let shutdown = Arc::new(Notify::new());
    let signal = Arc::clone(&shutdown);
    let task = tauri::async_runtime::spawn(serve(listener, source, aliases, notifier, signal));
    (ApiServer { shutdown }, task)
}

/// Accept and serve connections until the listener can no longer accept or the
/// server is signalled to stop.
///
/// Every connection is served on the application's runtime, so a slow client
/// cannot block the desktop UI or another request. The stop signal is polled
/// together with the accept by hand, which keeps the stop immediate without
/// pulling in `tokio/macros` for `tokio::select!`.
pub(crate) async fn serve<S: ApiDeviceSource, N: DynamicStateNotifier>(
    listener: TcpListener,
    source: Arc<S>,
    aliases: Arc<Mutex<DeviceAliasRegistry>>,
    notifier: Arc<N>,
    shutdown: Arc<Notify>,
) {
    let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
        return;
    };
    let mut stopped = Box::pin(shutdown.notified());
    loop {
        let accepted = std::future::poll_fn(|context| {
            if stopped.as_mut().poll(context).is_ready() {
                return Poll::Ready(None);
            }
            listener.poll_accept(context).map(Some)
        })
        .await;
        let Some(accepted) = accepted else {
            // The server was signalled to stop: the listener and the references
            // to the shared state are dropped with this task.
            return;
        };
        let Ok((stream, _peer)) = accepted else {
            // The local API stops responding; the desktop app is unaffected.
            return;
        };
        let source = Arc::clone(&source);
        let aliases = Arc::clone(&aliases);
        let notifier = Arc::clone(&notifier);
        tauri::async_runtime::spawn(async move {
            let io = TokioIo::new(stream);
            let service = service_fn(move |request: Request<Incoming>| {
                let source = Arc::clone(&source);
                let aliases = Arc::clone(&aliases);
                let notifier = Arc::clone(&notifier);
                async move {
                    Ok::<_, Infallible>(
                        handle_http_request(
                            request,
                            source.as_ref(),
                            aliases.as_ref(),
                            notifier.as_ref(),
                        )
                        .await,
                    )
                }
            });
            let mut builder = hyper::server::conn::http1::Builder::new();
            builder.timer(TokioTimer::new());
            builder.header_read_timeout(HEADER_READ_TIMEOUT);
            let _ = builder.serve_connection(io, service).await;
        });
    }
}

/// One already-parsed request, so the routing table and the write flow are
/// exercised directly by the tests instead of through a socket.
struct ApiRequest<'a> {
    method: &'a Method,
    path: &'a str,
    /// `true` when the request carried an `Origin` header.
    browser_origin: bool,
    /// Raw `Content-Type` header value, when the client sent one.
    content_type: Option<&'a str>,
    /// Raw JSON body of a write request; `None` for every other route.
    body: Option<&'a Bytes>,
}

/// Read one request, then answer it.
async fn handle_http_request<S: ApiDeviceSource, N: DynamicStateNotifier>(
    request: Request<Incoming>,
    source: &S,
    aliases: &Mutex<DeviceAliasRegistry>,
    notifier: &N,
) -> Response<Full<Bytes>> {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let browser_origin = request.headers().contains_key(ORIGIN);
    let content_type = request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);

    // A body is read only for a request the request line and the media type
    // already identify as a write, and only the declared maximum is buffered.
    // Every other route is answered from the request line and headers, so a
    // refused request never reaches its body.
    let reads_body = method == Method::POST
        && path == DYNAMIC_MACROS_PATH
        && !browser_origin
        && is_json_media_type(content_type.as_deref());
    let body = if reads_body {
        match read_limited_body(request.into_body()).await {
            Ok(body) => Some(body),
            Err(BodyReadError::TooLarge) => {
                return error_response(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "payload_too_large",
                    "The write request body is larger than the local API accepts.",
                )
            }
            Err(BodyReadError::Failed) => {
                return error_response(
                    StatusCode::BAD_REQUEST,
                    "invalid_json",
                    "The write request body could not be read.",
                )
            }
        }
    } else {
        None
    };

    handle_request(
        ApiRequest {
            method: &method,
            path: &path,
            browser_origin,
            content_type: content_type.as_deref(),
            body: body.as_ref(),
        },
        source,
        aliases,
        notifier,
    )
    .await
}

/// Route one request.
///
/// Every branch answers with the sanitized error envelope, and no branch echoes
/// a rejected request value, a device identity or backend text.
async fn handle_request<S: ApiDeviceSource, N: DynamicStateNotifier>(
    request: ApiRequest<'_>,
    source: &S,
    aliases: &Mutex<DeviceAliasRegistry>,
    notifier: &N,
) -> Response<Full<Bytes>> {
    // The API is not a browser surface. A request that carries an `Origin`
    // header can only come from a web page or an embedded web view, so it is
    // refused before it reaches any state. The rejected value is never echoed.
    if request.browser_origin {
        return error_response(
            StatusCode::FORBIDDEN,
            "browser_origin_rejected",
            "The local API does not accept browser requests.",
        );
    }
    if !is_known_path(request.path) {
        return error_response(
            StatusCode::NOT_FOUND,
            "not_found",
            "The local API has no such path.",
        );
    }
    if request.method == Method::POST {
        if request.path != DYNAMIC_MACROS_PATH {
            return method_not_allowed("GET");
        }
        if !is_json_media_type(request.content_type) {
            return error_response(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "A Dynamic Macro write must be sent as application/json.",
            );
        }
        let Some(body) = request.body else {
            return error_response(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "The write request body is missing.",
            );
        };
        return dynamic_write_response(body, source, aliases, notifier).await;
    }
    if request.method != Method::GET {
        return method_not_allowed(if request.path == DYNAMIC_MACROS_PATH {
            "POST"
        } else {
            "GET"
        });
    }
    match request.path {
        HEALTH_PATH => health_response(),
        DEVICES_PATH => devices_response(source, aliases).await,
        // Every known path is matched explicitly, so the remaining path is the
        // write path and its allowance is the method that would work.
        _ => method_not_allowed("POST"),
    }
}

fn health_response() -> Response<Full<Bytes>> {
    json_response(
        StatusCode::OK,
        HealthResponse {
            status: "ok",
            api_version: API_VERSION,
        },
    )
}

fn is_known_path(path: &str) -> bool {
    matches!(path, HEALTH_PATH | DEVICES_PATH | DYNAMIC_MACROS_PATH)
}

/// Whether a `Content-Type` header declares the JSON media type.
///
/// A media type parameter such as `charset=utf-8` is accepted; anything else,
/// including a missing header, is refused.
fn is_json_media_type(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .eq_ignore_ascii_case("application/json")
}

/// Validate and perform one Dynamic Macro write.
async fn dynamic_write_response<S: ApiDeviceSource, N: DynamicStateNotifier>(
    body: &Bytes,
    source: &S,
    aliases: &Mutex<DeviceAliasRegistry>,
    notifier: &N,
) -> Response<Full<Bytes>> {
    // The parser message is never echoed: it can quote a request field name, and
    // the caller contract only promises a stable code.
    let Ok(request) = serde_json::from_slice::<DynamicWriteRequest>(body) else {
        return error_response(
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "The write request is not a valid Dynamic Macro write request.",
        );
    };
    let write = match validate_dynamic_write(request) {
        Ok(write) => write,
        Err(error) => return error.into_response(),
    };
    // The alias map is the only device naming this API accepts. Until the window
    // has mirrored it there is nothing to resolve, so the request is refused
    // instead of being reported as an unknown device.
    let summary_key = match resolve_alias(aliases, &write.device_alias) {
        Ok(summary_key) => summary_key,
        Err(error) => return error.into_response(),
    };
    let outcome = match source
        .write_dynamic(ApiDynamicWrite {
            summary_key,
            slot: write.slot,
            text: write.text,
            ttl_seconds: write.ttl_seconds,
            keep_after_execute: write.keep_after_execute,
        })
        .await
    {
        Ok(outcome) => outcome,
        Err(failure) => {
            // A failed attempt still changed the observed state (an error was
            // published, or the session dropped back to unknown), so the window is
            // told to re-read it. The notification itself carries nothing, and the
            // session the attempt may have opened is read back by the window the
            // same way.
            notifier.dynamic_state_changed();
            let (status, code, message) = public_error(&failure.code);
            return error_response(status, code, message);
        }
    };
    // The write ran through the same service the window reads, so the window has
    // to re-read the body-free observed state instead of showing a stale one. A
    // write that opened the shared session is announced by the same notification,
    // so the window can mirror the connection it did not create itself.
    notifier.dynamic_state_changed();
    json_response(
        StatusCode::OK,
        DynamicWriteResponse {
            status: COMMITTED_LOCALLY,
            device_alias: write.device_alias,
            slot: write.slot,
            text_length: outcome.text_length,
            ttl_seconds: outcome.ttl_seconds,
            keep_after_execute: outcome.keep_after_execute,
        },
    )
}

/// One sanitized error answer of the public contract.
///
/// The response type itself is far larger than this, so a fallible step returns
/// the small error and the caller turns it into a response, which also keeps the
/// refusal path independent of the body type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }

    fn into_response(self) -> Response<Full<Bytes>> {
        error_response(self.status, self.code, self.message)
    }
}

/// Validate one write request against the protocol bounds.
///
/// Every check here happens before a device is opened, so an unusable request
/// never reaches HID. The device's own capability bounds (object count, length
/// limit, TTL range, keep support) are re-checked by the protocol client after
/// capability discovery, which is why a device-narrower value is refused there
/// with a mapped error instead of being accepted here.
fn validate_dynamic_write(request: DynamicWriteRequest) -> Result<ValidatedDynamicWrite, ApiError> {
    let Some(device_alias) = normalize_alias(&request.device_alias).map(ToOwned::to_owned) else {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "deviceAlias must be 1 to 64 bytes and free of control characters.",
        ));
    };
    let text_bytes = request.text.as_bytes();
    if text_bytes.is_empty() || crate::protocol::validate_text(text_bytes).is_err() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_text",
            TEXT_INVALID_MESSAGE,
        ));
    }
    if text_bytes.len() > crate::protocol::MAX_DYNAMIC_TEXT_LENGTH {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "text_too_long",
            TEXT_TOO_LONG_MESSAGE,
        ));
    }
    let slot_range =
        crate::protocol::DYNAMIC_FIRST_SLOT as i64..crate::protocol::DYNAMIC_SLOT_COUNT_MAX as i64;
    if !slot_range.contains(&request.slot) {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_slot",
            SLOT_INVALID_MESSAGE,
        ));
    }
    let ttl_seconds = match request.ttl_seconds {
        Some(ttl) => {
            let ttl_range = crate::protocol::DYNAMIC_MIN_TTL_SECONDS as i64
                ..=crate::protocol::DYNAMIC_MAX_TTL_SECONDS as i64;
            if !ttl_range.contains(&ttl) {
                return Err(ApiError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "invalid_ttl",
                    TTL_INVALID_MESSAGE,
                ));
            }
            Some(ttl as u32)
        }
        None => None,
    };
    Ok(ValidatedDynamicWrite {
        device_alias,
        text: request.text,
        slot: request.slot as u8,
        ttl_seconds,
        keep_after_execute: request.keep_after_execute,
    })
}

/// Resolve one alias to the safe summary key of its device.
///
/// The alias lock is released before the caller awaits the write, so no state
/// lock is ever held across a HID operation.
fn resolve_alias(aliases: &Mutex<DeviceAliasRegistry>, alias: &str) -> Result<String, ApiError> {
    let registry = alias_registry(aliases);
    if !registry.is_ready() {
        return Err(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            SERVICE_NOT_READY_CODE,
            SERVICE_NOT_READY_MESSAGE,
        ));
    }
    registry
        .summary_key_for_alias(alias)
        .map(ToOwned::to_owned)
        .ok_or(ApiError::new(
            StatusCode::NOT_FOUND,
            "device_not_found",
            DEVICE_NOT_FOUND_MESSAGE,
        ))
}

/// Map one sanitized device-layer error onto the public HTTP API contract.
///
/// The public vocabulary is independent of the desktop's internal command codes:
/// a caller only ever sees a code the contract promises, together with a fixed
/// message, so no device identity, HID path, serial number, raw frame or macro
/// text can travel through an error.
fn public_error(code: &str) -> (StatusCode, &'static str, &'static str) {
    match code {
        "device_not_found" | "no_device" => (
            StatusCode::NOT_FOUND,
            "device_not_found",
            DEVICE_NOT_FOUND_MESSAGE,
        ),
        "ambiguous_device" => (
            StatusCode::CONFLICT,
            "ambiguous_device",
            "The requested alias matches more than one connected device.",
        ),
        "device_conflict" => (
            StatusCode::CONFLICT,
            "device_conflict",
            "Another device is currently active; the API never switches devices.",
        ),
        "hid_backend_unavailable" => (
            StatusCode::SERVICE_UNAVAILABLE,
            "hid_unavailable",
            "The HID backend is unavailable.",
        ),
        "device_open_failed" | "usage_metadata_missing" => (
            StatusCode::SERVICE_UNAVAILABLE,
            "device_open_failed",
            "The requested device could not be opened.",
        ),
        "not_connected" => (
            StatusCode::SERVICE_UNAVAILABLE,
            "hid_unavailable",
            "The requested device is not connected.",
        ),
        "transport_error" => (
            StatusCode::SERVICE_UNAVAILABLE,
            "transport_error",
            "Communication with the device failed.",
        ),
        "timeout" => (
            StatusCode::GATEWAY_TIMEOUT,
            "device_timeout",
            "The device did not answer in time.",
        ),
        "protocol_error" | "dynamic_auth_boundary" => (
            StatusCode::BAD_GATEWAY,
            "device_protocol_error",
            "The device returned an invalid protocol response.",
        ),
        "bad_version" | "dynamic_unsupported" | "bad_opcode" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "dynamic_unsupported",
            "The device does not support Dynamic Macro v2.",
        ),
        "invalid_slot" | "bad_slot" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_slot",
            "The requested Dynamic object is not available on this device.",
        ),
        "length_exceeded" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "text_too_long",
            TEXT_TOO_LONG_MESSAGE,
        ),
        "invalid_text" | "dynamic_empty" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_text",
            "The text is not accepted by the Dynamic Macro protocol.",
        ),
        "dynamic_ttl_invalid" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_ttl",
            TTL_INVALID_MESSAGE,
        ),
        "dynamic_keep_unsupported" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "keep_after_execute_unsupported",
            "This device cannot keep the object after execution.",
        ),
        "bad_request" | "bad_offset" | "bad_length" => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_request",
            "The device rejected the write request.",
        ),
        "storage_error" | "device_internal_error" | "device_error" => (
            StatusCode::BAD_GATEWAY,
            "device_error",
            "The device reported a failure.",
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "The local API could not complete the write.",
        ),
    }
}

/// Why a request body could not be used.
#[derive(Debug)]
enum BodyReadError {
    /// The body exceeded [`MAX_WRITE_BODY_BYTES`].
    TooLarge,
    /// The transport failed before the body was complete.
    Failed,
}

/// Read one request body up to [`MAX_WRITE_BODY_BYTES`].
///
/// The body is generic so the limit itself is unit-tested without a socket, and
/// the wrapper drops the rest of an oversized body instead of buffering it.
async fn read_limited_body<B>(body: B) -> Result<Bytes, BodyReadError>
where
    B: hyper::body::Body<Data = Bytes> + Send,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    match Limited::new(body, MAX_WRITE_BODY_BYTES).collect().await {
        Ok(collected) => Ok(collected.to_bytes()),
        Err(error) => {
            if error.is::<LengthLimitError>() {
                Err(BodyReadError::TooLarge)
            } else {
                Err(BodyReadError::Failed)
            }
        }
    }
}

async fn devices_response<S: ApiDeviceSource>(
    source: &S,
    aliases: &Mutex<DeviceAliasRegistry>,
) -> Response<Full<Bytes>> {
    // The API resolves a device by the alias map the window mirrors after it has
    // read its local storage. Until that first mirror the registry is not ready,
    // and a device list whose aliases were all `null` would report "this device
    // has no name" instead of "the API is still starting". The request is
    // refused before any HID enumeration happens, so the answer also does not
    // depend on a device being present, connected or enumerable.
    let ready = alias_registry(aliases).is_ready();
    if !ready {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            SERVICE_NOT_READY_CODE,
            SERVICE_NOT_READY_MESSAGE,
        );
    }
    let devices = match source.devices().await {
        Ok(devices) => devices,
        Err(failure) => {
            let (status, code, message) = public_error(&failure.code);
            return error_response(status, code, message);
        }
    };
    // The alias lock is taken after the enumeration and released immediately: a
    // state lock is never held across a HID operation.
    let registry = alias_registry(aliases);
    let entries = devices
        .into_iter()
        .map(|device| DeviceEntry {
            alias: registry
                .alias_for(&device.summary_key)
                .map(ToOwned::to_owned),
            vendor_id: device.vendor_id,
            product_id: device.product_id,
            product_name: device.product_name,
            interface_number: device.interface_number,
            usage_page: device.usage_page,
            usage: device.usage,
        })
        .collect();
    json_response(StatusCode::OK, DevicesResponse { devices: entries })
}

/// Lock the alias map, recovering from a poisoned lock.
///
/// The map is a small local preference with no partially written state, so a
/// panic on another thread must not turn the API into a permanently silent
/// surface: the poisoned guard is reused instead of failing the request.
fn alias_registry(aliases: &Mutex<DeviceAliasRegistry>) -> MutexGuard<'_, DeviceAliasRegistry> {
    aliases
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn method_not_allowed(allowed: &'static str) -> Response<Full<Bytes>> {
    let mut response = error_response(
        StatusCode::METHOD_NOT_ALLOWED,
        "method_not_allowed",
        "The local API does not support this method on this path.",
    );
    response
        .headers_mut()
        .insert(ALLOW, HeaderValue::from_static(allowed));
    response
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response<Full<Bytes>> {
    json_response(
        status,
        ErrorBody {
            error: ErrorDetail {
                code: code.to_string(),
                message: message.to_string(),
            },
        },
    )
}

fn json_response<T: Serialize>(status: StatusCode, body: T) -> Response<Full<Bytes>> {
    let Ok(payload) = serde_json::to_vec(&body) else {
        return empty_response(StatusCode::INTERNAL_SERVER_ERROR);
    };
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, JSON_CONTENT_TYPE)
        .header(CACHE_CONTROL, "no-store")
        .body(Full::new(Bytes::from(payload)))
        .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
}

fn empty_response(status: StatusCode) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, JSON_CONTENT_TYPE)
        .header(CACHE_CONTROL, "no-store")
        .body(Full::new(Bytes::new()))
        .unwrap_or_else(|_| Response::new(Full::new(Bytes::new())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{DYNAMIC_DEFAULT_TTL_SECONDS, MAX_DYNAMIC_TEXT_LENGTH};
    use http_body_util::BodyExt;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Fixed, obviously fake device fixtures. No real device data is used.
    fn summary(vendor_id: u16, product_id: u16, interface_number: i32) -> DeviceSummary {
        DeviceSummary {
            vendor_id,
            product_id,
            product_name: Some("Example Keyboard".to_string()),
            interface_number,
            usage_page: crate::hid::RUNTIME_MACRO_USAGE_PAGE,
            usage: crate::hid::RUNTIME_MACRO_USAGE,
        }
    }

    /// Alias a write test names, and the safe summary key it resolves to.
    const WRITE_ALIAS: &str = "Work keyboard";
    const WRITE_KEY: &str = "4660:22136:2:65376:97";

    /// Recorded write requests, so a test can assert what reached the device
    /// layer without needing a device.
    type WriteCalls = Arc<Mutex<Vec<ApiDynamicWrite>>>;

    struct TestSource {
        devices: Vec<ApiDevice>,
        fail: bool,
        /// Failure every write answers with; `None` accepts the write.
        write_error: Option<ApiFailure>,
        writes: WriteCalls,
    }

    impl TestSource {
        fn with_devices(devices: Vec<ApiDevice>) -> Self {
            Self {
                devices,
                fail: false,
                write_error: None,
                writes: WriteCalls::default(),
            }
        }

        fn failing() -> Self {
            Self {
                devices: Vec::new(),
                fail: true,
                write_error: None,
                writes: WriteCalls::default(),
            }
        }

        /// A source that accepts writes and records them.
        fn writing() -> Self {
            Self::with_devices(Vec::new())
        }

        /// A source whose writes fail with one sanitized device-layer error.
        fn failing_writes(code: &str, message: &str) -> Self {
            Self {
                devices: Vec::new(),
                fail: false,
                write_error: Some(ApiFailure::new(code, message)),
                writes: WriteCalls::default(),
            }
        }

        fn write_count(&self) -> usize {
            self.writes.lock().expect("write log").len()
        }

        /// Inspect the recorded write requests without cloning them.
        fn with_writes(&self, check: impl FnOnce(&[ApiDynamicWrite])) {
            let writes = self.writes.lock().expect("write log");
            check(&writes);
        }
    }

    impl ApiDeviceSource for TestSource {
        fn devices(&self) -> ApiFuture<Result<Vec<ApiDevice>, ApiFailure>> {
            let devices = self.devices.clone();
            let fail = self.fail;
            Box::pin(async move {
                if fail {
                    return Err(ApiFailure::new(
                        "hid_backend_unavailable",
                        "The HID backend could not be initialized.",
                    ));
                }
                Ok(devices)
            })
        }

        fn write_dynamic(
            &self,
            write: ApiDynamicWrite,
        ) -> ApiFuture<Result<ApiDynamicOutcome, ApiFailure>> {
            let write_error = self.write_error.clone();
            let outcome = ApiDynamicOutcome {
                text_length: u16::try_from(write.text.len()).unwrap_or(u16::MAX),
                ttl_seconds: write
                    .ttl_seconds
                    .unwrap_or(crate::protocol::DYNAMIC_DEFAULT_TTL_SECONDS),
                keep_after_execute: write.keep_after_execute,
            };
            self.writes.lock().expect("write log").push(write);
            Box::pin(async move {
                match write_error {
                    Some(failure) => Err(failure),
                    None => Ok(outcome),
                }
            })
        }
    }

    fn aliases(entries: &[(&str, &str)]) -> Mutex<DeviceAliasRegistry> {
        let mut registry = DeviceAliasRegistry::default();
        let map: BTreeMap<String, String> = entries
            .iter()
            .map(|(key, alias)| (key.to_string(), alias.to_string()))
            .collect();
        registry.replace(&map).expect("fixture aliases are valid");
        Mutex::new(registry)
    }

    /// A registry that has not received its first mirror yet.
    fn unsynced_aliases() -> Mutex<DeviceAliasRegistry> {
        Mutex::new(DeviceAliasRegistry::default())
    }

    /// Counts the payload-free state-change notifications of one request.
    #[derive(Default)]
    struct CountingNotifier {
        calls: AtomicUsize,
    }

    impl CountingNotifier {
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl DynamicStateNotifier for CountingNotifier {
        fn dynamic_state_changed(&self) {
            self.calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// A source that counts how often enumeration was asked for, so a test can
    /// prove that a refused request never reached the device layer.
    struct CountingSource {
        calls: Arc<AtomicUsize>,
    }

    impl ApiDeviceSource for CountingSource {
        fn devices(&self) -> ApiFuture<Result<Vec<ApiDevice>, ApiFailure>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                Err(ApiFailure::new(
                    "hid_backend_unavailable",
                    "The HID backend could not be initialized.",
                ))
            })
        }

        fn write_dynamic(
            &self,
            _write: ApiDynamicWrite,
        ) -> ApiFuture<Result<ApiDynamicOutcome, ApiFailure>> {
            Box::pin(async move {
                Err(ApiFailure::new(
                    "internal_error",
                    "The counting fixture does not accept writes.",
                ))
            })
        }
    }

    fn body_text(response: Response<Full<Bytes>>) -> String {
        let bytes = tauri::async_runtime::block_on(response.into_body().collect())
            .expect("fixture body is readable")
            .to_bytes();
        String::from_utf8(bytes.to_vec()).expect("fixture body is UTF-8")
    }

    fn error_code(response: Response<Full<Bytes>>) -> String {
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        value["error"]["code"]
            .as_str()
            .expect("error code")
            .to_string()
    }

    /// Answer one `GET` request that has no body.
    fn get(path: &str, browser_origin: bool, source: &TestSource) -> Response<Full<Bytes>> {
        tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::GET,
                path,
                browser_origin,
                content_type: None,
                body: None,
            },
            source,
            &aliases(&[]),
            &CountingNotifier::default(),
        ))
    }

    /// Answer one `GET` against an explicit alias registry.
    fn get_with<S: ApiDeviceSource>(
        path: &str,
        browser_origin: bool,
        source: &S,
        registry: &Mutex<DeviceAliasRegistry>,
    ) -> Response<Full<Bytes>> {
        tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::GET,
                path,
                browser_origin,
                content_type: None,
                body: None,
            },
            source,
            registry,
            &CountingNotifier::default(),
        ))
    }

    /// A registry that already mirrored exactly one alias.
    fn write_registry() -> Mutex<DeviceAliasRegistry> {
        aliases(&[(WRITE_KEY, WRITE_ALIAS)])
    }

    fn write_body(json: &str) -> Bytes {
        Bytes::from(json.to_string().into_bytes())
    }

    /// The smallest valid write request body.
    fn valid_write_json() -> String {
        format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"api-fixture","slot":0}}"#)
    }

    /// Answer one write request with a JSON media type.
    fn write(
        body: &Bytes,
        source: &TestSource,
        registry: &Mutex<DeviceAliasRegistry>,
    ) -> Response<Full<Bytes>> {
        write_with_notifier(body, source, registry, &CountingNotifier::default())
    }

    /// Answer one write request while recording its state-change notifications.
    fn write_with_notifier(
        body: &Bytes,
        source: &TestSource,
        registry: &Mutex<DeviceAliasRegistry>,
        notifier: &CountingNotifier,
    ) -> Response<Full<Bytes>> {
        tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: DYNAMIC_MACROS_PATH,
                browser_origin: false,
                content_type: Some("application/json"),
                body: Some(body),
            },
            source,
            registry,
            notifier,
        ))
    }

    fn get_json(path: &str, browser_origin: bool, source: &TestSource) -> serde_json::Value {
        let response = get(path, browser_origin, source);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE).expect("content type"),
            JSON_CONTENT_TYPE
        );
        serde_json::from_str(&body_text(response)).expect("JSON body")
    }

    #[test]
    fn the_api_bind_address_is_a_fixed_loopback_endpoint() {
        let address: std::net::SocketAddr = API_BIND_ADDR.parse().expect("parseable address");
        assert_eq!(address.ip().to_string(), "127.0.0.1");
        assert_eq!(address.port(), 17653);
        assert!(address.ip().is_loopback());
        // The bind helper is the only way this module opens a listener, and it
        // is exercised through an ephemeral loopback port instead of the fixed
        // production port so two test runs cannot collide.
        let listener = bind_loopback("127.0.0.1:0").expect("bind loopback");
        let local = listener.local_addr().expect("local address");
        assert!(local.ip().is_loopback());
        assert_ne!(local.port(), 0);
    }

    #[test]
    fn the_bind_helper_accepts_only_the_exact_ipv4_loopback_address() {
        // The helper itself refuses everything that would widen the API surface:
        // an unspecified address, a LAN address, IPv6 and a host name are all
        // rejected before a socket is opened.
        for rejected in [
            "0.0.0.0:17653",
            "0.0.0.0:0",
            "192.0.2.10:17653",
            "10.1.2.3:0",
            "[::1]:17653",
            "[::]:17653",
            "localhost:17653",
            "127.0.0.1",
            "",
        ] {
            let error = bind_loopback(rejected).expect_err("a widened bind is refused");
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{rejected}");
            // The refusal is the constant message: the rejected address is never
            // echoed, and no operating-system bind text is attached to it.
            assert_eq!(error.to_string(), LOOPBACK_ONLY_MESSAGE, "{rejected}");
        }

        // The real loopback address still binds, including the ephemeral test
        // port, so the guard does not make the API itself unreachable.
        let listener = bind_loopback("127.0.0.1:0").expect("bind loopback");
        assert!(listener
            .local_addr()
            .expect("local address")
            .ip()
            .is_loopback());
    }

    #[test]
    fn health_reports_the_api_version() {
        let source = TestSource::failing();
        let body = get_json(HEALTH_PATH, false, &source);
        assert_eq!(body, serde_json::json!({"status": "ok", "apiVersion": 1}));
        assert_eq!(body["apiVersion"], API_VERSION);
    }

    #[test]
    fn only_get_is_served_and_unknown_paths_are_not_found() {
        let source = TestSource::with_devices(Vec::new());
        let registry = aliases(&[]);
        let rejected = tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: HEALTH_PATH,
                browser_origin: false,
                content_type: None,
                body: None,
            },
            &source,
            &registry,
            &CountingNotifier::default(),
        ));
        assert_eq!(rejected.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(rejected.headers().get(ALLOW).expect("allow"), "GET");

        let unknown = get("/api/v1/unknown", false, &source);
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body_text(unknown)).expect("JSON body")
                ["error"]["code"],
            "not_found"
        );
    }

    #[test]
    fn a_browser_origin_is_refused_before_any_state_is_read() {
        let source = TestSource::failing();
        let response = get(HEALTH_PATH, true, &source);
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        // No CORS header is ever sent, and the rejected origin is never echoed.
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());
        let body = body_text(response);
        assert!(!body.contains("example.com"));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).expect("JSON body")["error"]["code"],
            "browser_origin_rejected"
        );
    }

    #[test]
    fn devices_publish_the_safe_summary_and_alias_only() {
        let device = summary(0x1234, 0x5678, 2);
        let key = summary_key(&device);
        let source = TestSource::with_devices(vec![ApiDevice::from_summary(&device)]);
        let registry = aliases(&[(&key, "Work keyboard")]);

        let response = get_with(DEVICES_PATH, false, &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_text(response);
        let value: serde_json::Value = serde_json::from_str(&body).expect("JSON body");
        assert_eq!(
            value,
            serde_json::json!({
                "devices": [{
                    "vendorId": 0x1234,
                    "productId": 0x5678,
                    "productName": "Example Keyboard",
                    "interfaceNumber": 2,
                    "usagePage": 0xff60,
                    "usage": 0x61,
                    "alias": "Work keyboard",
                }]
            })
        );

        // The published JSON has no field for a device identity, and the summary
        // key stays internal: it is a lookup key, not a device handle.
        for forbidden in ["path", "serial", "deviceId", "summaryKey", key.as_str()] {
            assert!(
                !body.contains(forbidden),
                "devices response contains {forbidden}"
            );
        }
    }

    #[test]
    fn a_device_without_an_alias_is_published_with_a_null_alias() {
        let device = summary(0x1234, 0x5678, 3);
        let other = summary(0x1234, 0x5678, 4);
        let source = TestSource::with_devices(vec![
            ApiDevice::from_summary(&device),
            ApiDevice::from_summary(&other),
        ]);
        // Only one of the two devices has an alias.
        let registry = aliases(&[(&summary_key(&other), "Second keyboard")]);

        let response = get_with(DEVICES_PATH, false, &source, &registry);
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        assert_eq!(value["devices"][0]["alias"], serde_json::Value::Null);
        assert_eq!(value["devices"][1]["alias"], "Second keyboard");
        // Two interfaces of one product never share an alias by accident.
        assert_eq!(registry.lock().expect("registry").len(), 1);
    }

    #[test]
    fn a_failed_enumeration_is_reported_as_a_sanitized_service_error() {
        let source = TestSource::failing();
        let registry = aliases(&[]);
        let response = get_with(DEVICES_PATH, false, &source, &registry);
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        assert_eq!(value["error"]["code"], "hid_unavailable");
        assert_eq!(value["devices"], serde_json::Value::Null);
    }

    #[test]
    fn devices_are_refused_until_the_alias_map_is_ready() {
        let calls = Arc::new(AtomicUsize::new(0));
        let source = CountingSource {
            calls: Arc::clone(&calls),
        };
        let registry = unsynced_aliases();

        let response = get_with(DEVICES_PATH, false, &source, &registry);
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = body_text(response);
        let value: serde_json::Value = serde_json::from_str(&body).expect("JSON body");
        assert_eq!(value["error"]["code"], "service_not_ready");
        assert_eq!(value["error"]["message"], SERVICE_NOT_READY_MESSAGE);
        assert_eq!(value["devices"], serde_json::Value::Null);
        // The refusal happens before device enumeration, so it neither needs nor
        // touches a device, and the body never contains a device or request value.
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        for forbidden in ["HID", "hidraw", "serial", "Example Keyboard"] {
            assert!(
                !body.contains(forbidden),
                "not-ready response contains {forbidden}"
            );
        }
    }

    #[test]
    fn an_empty_alias_sync_still_marks_the_registry_ready() {
        let mut registry = DeviceAliasRegistry::default();
        assert!(!registry.is_ready());
        // An empty map is a legitimate mirror: the user has no alias. It is the
        // first successful replacement, so the API becomes ready with it.
        assert_eq!(registry.replace(&BTreeMap::new()), Ok(()));
        assert!(registry.is_ready());
        assert!(registry.is_empty());

        // And the served answer is then the real (empty) device list, not 503.
        let source = TestSource::with_devices(Vec::new());
        let response = get_with(DEVICES_PATH, false, &source, &Mutex::new(registry));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body_text(response)).expect("JSON body"),
            serde_json::json!({ "devices": [] })
        );
    }

    #[test]
    fn a_refused_alias_map_never_marks_the_registry_ready() {
        // A refusal leaves a brand-new registry not ready: an invalid mirror is
        // not a mirror, so the API must keep answering `service_not_ready`.
        let mut registry = DeviceAliasRegistry::default();
        let mut unsafe_key = BTreeMap::new();
        unsafe_key.insert("/dev/hidraw0".to_string(), "Keyboard".to_string());
        assert_eq!(
            registry.replace(&unsafe_key),
            Err(DeviceAliasError::InvalidSummaryKey)
        );
        assert!(!registry.is_ready());
        assert!(registry.is_empty());

        let duplicate: BTreeMap<String, String> = [
            ("1:2:3:4:5".to_string(), "Keyboard".to_string()),
            ("1:2:3:4:6".to_string(), "Keyboard".to_string()),
        ]
        .into_iter()
        .collect();
        let mut ready = DeviceAliasRegistry::default();
        ready.replace(&BTreeMap::new()).expect("empty sync");
        assert_eq!(
            ready.replace(&duplicate),
            Err(DeviceAliasError::DuplicateAlias)
        );
        // A ready registry stays ready and keeps its accepted map when a later
        // mirror is refused.
        assert!(ready.is_ready());
        assert!(ready.is_empty());
    }

    #[test]
    fn health_is_available_before_the_alias_map_is_ready() {
        let source = TestSource::with_devices(Vec::new());
        let registry = unsynced_aliases();
        let response = get_with(HEALTH_PATH, false, &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        // Exact body: a client can tell "starting" from "not running".
        assert_eq!(
            value,
            serde_json::json!({ "status": "ok", "apiVersion": 1 })
        );
        // Health never touches the alias map, so a request cannot make it ready.
        assert!(!registry.lock().expect("registry").is_ready());
    }

    #[test]
    fn the_served_api_answers_over_a_real_loopback_socket() {
        use std::io::{Read, Write};

        let listener = bind_loopback("127.0.0.1:0").expect("bind loopback");
        let address = listener.local_addr().expect("local address");
        let source = Arc::new(TestSource::with_devices(Vec::new()));
        let writes = Arc::clone(&source.writes);
        let registry = Arc::new(aliases(&[(WRITE_KEY, WRITE_ALIAS)]));
        let notifier = Arc::new(CountingNotifier::default());
        tauri::async_runtime::spawn(serve(
            listener,
            source,
            registry,
            Arc::clone(&notifier),
            Arc::new(Notify::new()),
        ));

        let mut stream = std::net::TcpStream::connect(address).expect("connect to the API");
        stream
            .set_read_timeout(Some(HEADER_READ_TIMEOUT))
            .expect("read timeout");
        stream
            .write_all(
                b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            )
            .expect("write request");
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("read response");

        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        assert!(response.contains("\"status\":\"ok\""), "{response}");
        assert!(response.contains("\"apiVersion\":1"), "{response}");

        // The same listener also refuses a request that carries a browser
        // Origin, so the refusal holds on the real socket path too.
        let mut stream = std::net::TcpStream::connect(address).expect("connect to the API");
        stream
            .set_read_timeout(Some(HEADER_READ_TIMEOUT))
            .expect("read timeout");
        stream
            .write_all(
                b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://example.com\r\nConnection: close\r\n\r\n",
            )
            .expect("write request");
        let mut refused = String::new();
        stream.read_to_string(&mut refused).expect("read response");
        assert!(refused.starts_with("HTTP/1.1 403 Forbidden"), "{refused}");

        // A real write request travels the whole HTTP path: strict JSON parsing,
        // alias resolution and the device layer, and the answer stays body-free.
        let payload = valid_write_json();
        let request = format!(
            "POST /api/v1/dynamic-macros HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            payload.len(),
            payload
        );
        let mut stream = std::net::TcpStream::connect(address).expect("connect to the API");
        stream
            .set_read_timeout(Some(HEADER_READ_TIMEOUT))
            .expect("read timeout");
        stream.write_all(request.as_bytes()).expect("write request");
        let mut written = String::new();
        stream.read_to_string(&mut written).expect("read response");
        assert!(written.starts_with("HTTP/1.1 200 OK"), "{written}");
        assert!(
            written.contains("\"status\":\"committedLocally\""),
            "{written}"
        );
        assert!(written.contains("\"textLength\":11"), "{written}");
        assert!(!written.contains("api-fixture"), "{written}");
        assert_eq!(writes.lock().expect("write log").len(), 1);
        // The whole HTTP path notified the window exactly once, through the
        // payload-free sink: nothing from the request can travel with it.
        assert_eq!(notifier.calls(), 1);
    }

    #[test]
    fn a_stopped_api_server_releases_its_listener() {
        let listener = bind_loopback("127.0.0.1:0").expect("bind loopback");
        let address = listener.local_addr().expect("local address");
        let source = Arc::new(TestSource::with_devices(Vec::new()));
        let registry = Arc::new(aliases(&[]));
        let notifier = Arc::new(CountingNotifier::default());
        let (server, task) = spawn_acceptor(listener, source, registry, notifier);

        // The explicit stop is what the application exit path uses; awaiting the
        // acceptor task is how a caller observes that it really released the
        // listener and its state references.
        server.shutdown();
        tauri::async_runtime::block_on(task).expect("the acceptor stops cleanly");

        // The freed port can be bound again immediately, so nothing keeps the
        // API endpoint alive after an explicit stop.
        let rebound = bind_loopback(&address.to_string()).expect("the listener was released");
        drop(rebound);

        // Stopping again is a no-op rather than a second side effect.
        server.shutdown();
    }

    #[test]
    fn a_completed_write_notifies_the_window_and_a_refused_one_does_not() {
        // The event name is the one the frontend subscribes to.
        assert_eq!(DYNAMIC_STATE_CHANGED_EVENT, "dynamic-state-changed");

        let registry = write_registry();

        // A successful write wakes the window once: the service state now holds a
        // new local observation the window has not read yet.
        let source = TestSource::writing();
        let notifier = CountingNotifier::default();
        let response = write_with_notifier(
            &write_body(&valid_write_json()),
            &source,
            &registry,
            &notifier,
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(notifier.calls(), 1);

        // A device-layer failure changes the observed state too (it publishes the
        // sanitized error, or drops the session back to unknown), so the window is
        // told to re-read it just the same. The device layer reports `timeout`; the
        // public code is `device_timeout`.
        let failing = TestSource::failing_writes("timeout", "The device did not answer in time.");
        let notifier = CountingNotifier::default();
        let response = write_with_notifier(
            &write_body(&valid_write_json()),
            &failing,
            &registry,
            &notifier,
        );
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(notifier.calls(), 1);

        // A request refused before any device call changes nothing, so the window
        // is not woken for it and no write reaches the device layer.
        let source = TestSource::writing();
        let notifier = CountingNotifier::default();
        let response = write_with_notifier(&write_body("{}"), &source, &registry, &notifier);
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(notifier.calls(), 0);
        assert_eq!(source.write_count(), 0);

        // The same holds for a write whose alias cannot be resolved.
        let source = TestSource::writing();
        let notifier = CountingNotifier::default();
        let response = write_with_notifier(
            &write_body(&valid_write_json()),
            &source,
            &aliases(&[]),
            &notifier,
        );
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(notifier.calls(), 0);
        assert_eq!(source.write_count(), 0);
    }

    #[test]
    fn aliases_are_validated_and_all_or_nothing() {
        let mut registry = DeviceAliasRegistry::default();
        let accepted: BTreeMap<String, String> = [
            ("1:2:3:4:5".to_string(), " Work keyboard ".to_string()),
            ("-1:2:-3:4:5".to_string(), "工作键盘".to_string()),
        ]
        .into_iter()
        .collect();
        assert_eq!(registry.replace(&accepted), Ok(()));
        // Stored trimmed, and the raw key never carries a device path.
        assert_eq!(registry.alias_for("1:2:3:4:5"), Some("Work keyboard"));
        assert_eq!(registry.alias_for("-1:2:-3:4:5"), Some("工作键盘"));
        assert_eq!(registry.alias_for("1:2:3:4:6"), None);
        assert_eq!(registry.len(), 2);

        for (key, alias, expected) in [
            // The key must be exactly five decimal parts: a device path, a
            // serial-style string, a missing part or an over-long number is
            // never a safe device summary key.
            ("1:2:3:4", "Keyboard", DeviceAliasError::InvalidSummaryKey),
            (
                "1:2:3:4:5:6",
                "Keyboard",
                DeviceAliasError::InvalidSummaryKey,
            ),
            ("1:2:3:4:", "Keyboard", DeviceAliasError::InvalidSummaryKey),
            ("1:2:3:4:x", "Keyboard", DeviceAliasError::InvalidSummaryKey),
            (
                "/dev/hidraw0",
                "Keyboard",
                DeviceAliasError::InvalidSummaryKey,
            ),
            (
                "01:23:45:67:89:ab",
                "Keyboard",
                DeviceAliasError::InvalidSummaryKey,
            ),
            (
                "123456789012:2:3:4:5",
                "Keyboard",
                DeviceAliasError::InvalidSummaryKey,
            ),
            ("1:2:3:4:5", "", DeviceAliasError::InvalidAlias),
            ("1:2:3:4:5", "   ", DeviceAliasError::InvalidAlias),
            ("1:2:3:4:5", "with\nnewline", DeviceAliasError::InvalidAlias),
            ("1:2:3:4:5", "with\ttab", DeviceAliasError::InvalidAlias),
        ] {
            let mut rejected = DeviceAliasRegistry::default();
            let mut map = BTreeMap::new();
            map.insert(key.to_string(), alias.to_string());
            assert_eq!(rejected.replace(&map), Err(expected), "{key} {alias}");
            assert!(rejected.is_empty());
        }

        // Over-long aliases are bounded in bytes, and a duplicate alias is
        // refused instead of stealing the name from another device.
        let mut too_long = BTreeMap::new();
        too_long.insert(
            "1:2:3:4:5".to_string(),
            "n".repeat(MAX_DEVICE_ALIAS_BYTES + 1),
        );
        assert_eq!(
            DeviceAliasRegistry::default().replace(&too_long),
            Err(DeviceAliasError::InvalidAlias)
        );

        let mut multibyte = BTreeMap::new();
        multibyte.insert(
            "1:2:3:4:5".to_string(),
            "场".repeat(MAX_DEVICE_ALIAS_BYTES / 3 + 1),
        );
        assert_eq!(
            DeviceAliasRegistry::default().replace(&multibyte),
            Err(DeviceAliasError::InvalidAlias)
        );

        let duplicate: BTreeMap<String, String> = [
            ("1:2:3:4:5".to_string(), "Keyboard".to_string()),
            ("1:2:3:4:6".to_string(), "Keyboard".to_string()),
        ]
        .into_iter()
        .collect();
        assert_eq!(
            DeviceAliasRegistry::default().replace(&duplicate),
            Err(DeviceAliasError::DuplicateAlias)
        );

        // A refused replacement keeps the previously accepted map.
        assert_eq!(
            registry.replace(&duplicate),
            Err(DeviceAliasError::DuplicateAlias)
        );
        assert_eq!(registry.alias_for("1:2:3:4:5"), Some("Work keyboard"));
        assert_eq!(registry.len(), 2);
    }

    #[test]
    fn alias_error_envelopes_never_echo_the_rejected_value() {
        for error in [
            DeviceAliasError::InvalidSummaryKey,
            DeviceAliasError::InvalidAlias,
            DeviceAliasError::DuplicateAlias,
        ] {
            assert!(!error.code().is_empty());
            assert!(!error.message().is_empty());
            assert!(!error.code().contains('/'));
            assert!(!error.message().chars().any(char::is_control));
        }
        assert_eq!(
            DeviceAliasError::InvalidSummaryKey.code(),
            "invalid_device_alias_key"
        );
        assert_eq!(
            DeviceAliasError::InvalidAlias.code(),
            "invalid_device_alias"
        );
        assert_eq!(
            DeviceAliasError::DuplicateAlias.code(),
            "duplicate_device_alias"
        );
    }

    #[test]
    fn a_write_request_is_refused_before_any_device_is_touched() {
        let source = TestSource::writing();
        let registry = write_registry();

        // Every case is refused by validation, so no device is enumerated,
        // opened, connected or written for any of them.
        let cases: Vec<(String, StatusCode, &str)> = vec![
            // The parser is strict: an unknown or misspelled field can never take
            // effect silently.
            (
                r#"{"deviceAlias":"Work keyboard","text":"x","slot":0,"extra":1}"#.to_string(),
                StatusCode::BAD_REQUEST,
                "invalid_json",
            ),
            // A wrong type or a missing required field is a malformed request.
            (
                r#"{"deviceAlias":"Work keyboard","text":5,"slot":0}"#.to_string(),
                StatusCode::BAD_REQUEST,
                "invalid_json",
            ),
            (
                r#"{"deviceAlias":"Work keyboard","slot":0}"#.to_string(),
                StatusCode::BAD_REQUEST,
                "invalid_json",
            ),
            (
                "not json at all".to_string(),
                StatusCode::BAD_REQUEST,
                "invalid_json",
            ),
            // An alias that could never match a stored one is a request error.
            (
                format!(
                    r#"{{"deviceAlias":"{}","text":"x","slot":0}}"#,
                    "n".repeat(MAX_DEVICE_ALIAS_BYTES + 1)
                ),
                StatusCode::BAD_REQUEST,
                "invalid_request",
            ),
            // Text the protocol cannot carry is refused before HID.
            (
                format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"","slot":0}}"#),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
            ),
            (
                format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"中文","slot":0}}"#),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
            ),
            // A control character is outside the allowed set, and the rejected
            // text must not come back in the error.
            (
                format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"marker-text\u0000","slot":0}}"#),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
            ),
            (
                format!(
                    r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"{}","slot":0}}"#,
                    "x".repeat(MAX_DYNAMIC_TEXT_LENGTH + 1)
                ),
                StatusCode::UNPROCESSABLE_ENTITY,
                "text_too_long",
            ),
            // The object index and the TTL are checked against the protocol
            // bounds; a narrower device bound is enforced after discovery.
            (
                format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"x","slot":8}}"#),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_slot",
            ),
            (
                format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"x","slot":-1}}"#),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_slot",
            ),
            (
                format!(r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"x","slot":0,"ttlSeconds":0}}"#),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_ttl",
            ),
            (
                format!(
                    r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"x","slot":0,"ttlSeconds":86401}}"#
                ),
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_ttl",
            ),
        ];

        for (body, expected_status, expected_code) in cases {
            let bytes = write_body(&body);
            let response = write(&bytes, &source, &registry);
            assert_eq!(response.status(), expected_status, "{expected_code}");
            let text = body_text(response);
            let value: serde_json::Value = serde_json::from_str(&text).expect("JSON body");
            assert_eq!(value["error"]["code"], expected_code, "{expected_code}");
            assert!(!value["error"]["message"]
                .as_str()
                .unwrap_or_default()
                .is_empty());
            assert!(
                !text.contains("marker-text"),
                "{expected_code} error body echoes the request text"
            );
        }
        assert_eq!(source.write_count(), 0);
    }

    #[test]
    fn a_write_is_refused_until_the_alias_map_is_ready() {
        let source = TestSource::writing();
        let registry = unsynced_aliases();
        let body = write_body(&valid_write_json());

        let response = write(&body, &source, &registry);
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error_code(response), "service_not_ready");
        // Nothing was resolved and nothing reached the device layer.
        assert_eq!(source.write_count(), 0);
    }

    #[test]
    fn a_write_reports_an_unmatched_alias_as_a_missing_device() {
        let source = TestSource::writing();
        let body = write_body(&valid_write_json());

        // A ready map that simply has no alias at all.
        let empty = aliases(&[]);
        let response = write(&body, &source, &empty);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(error_code(response), "device_not_found");

        // A ready map that names another device, so the requested name is still
        // unknown and is never mapped onto whatever device exists.
        let other = aliases(&[("4660:22136:3:65376:97", "Other keyboard")]);
        let response = write(&body, &source, &other);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(error_code(response), "device_not_found");

        assert_eq!(source.write_count(), 0);
    }

    #[test]
    fn a_write_reaches_the_device_layer_by_alias_and_echoes_no_content() {
        let source = TestSource::writing();
        let registry = write_registry();
        let body = write_body(&valid_write_json());

        let response = write(&body, &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);
        let text = body_text(response);
        let value: serde_json::Value = serde_json::from_str(&text).expect("JSON body");
        assert_eq!(
            value,
            serde_json::json!({
                "status": "committedLocally",
                "deviceAlias": WRITE_ALIAS,
                "slot": 0,
                "textLength": 11,
                "ttlSeconds": DYNAMIC_DEFAULT_TTL_SECONDS,
                "keepAfterExecute": false,
            })
        );
        // The response carries no macro text and no device identity, and the
        // internal summary key is never published.
        for forbidden in [
            "api-fixture",
            "path",
            "serial",
            "deviceId",
            "summaryKey",
            WRITE_KEY,
        ] {
            assert!(
                !text.contains(forbidden),
                "write response contains {forbidden}"
            );
        }

        // The device layer received the resolved key and the four macro
        // parameters, and nothing else.
        source.with_writes(|writes| {
            assert_eq!(writes.len(), 1);
            assert_eq!(writes[0].summary_key, WRITE_KEY);
            assert_eq!(writes[0].slot, 0);
            assert_eq!(writes[0].text, "api-fixture");
            assert_eq!(writes[0].ttl_seconds, None);
            assert!(!writes[0].keep_after_execute);
        });
    }

    #[test]
    fn a_write_request_debug_never_shows_its_text_or_the_internal_key() {
        let write = ApiDynamicWrite {
            summary_key: "4660:22136:233:65376:97".to_string(),
            slot: 3,
            text: "debug-fixture-text".to_string(),
            ttl_seconds: Some(60),
            keep_after_execute: true,
        };

        let debug = format!("{write:?}");

        // The bounds stay printable for diagnostics.
        assert!(debug.contains("text_length: 18"), "{debug}");
        assert!(debug.contains("slot: 3"), "{debug}");
        assert!(debug.contains("ttl_seconds: Some(60)"), "{debug}");
        // Neither the macro text nor the internal safe summary key can travel
        // through a `Debug` print of a write request.
        assert!(!debug.contains("debug-fixture-text"), "{debug}");
        assert!(!debug.contains("4660:22136:233:65376:97"), "{debug}");
    }

    #[test]
    fn a_write_forwards_the_macro_parameters_and_reports_the_effective_ttl() {
        let source = TestSource::writing();
        let registry = write_registry();

        // An omitted TTL and an explicit `null` both mean the device default,
        // and the reported TTL is the device's own default either way.
        let response = write(&write_body(&valid_write_json()), &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        assert_eq!(value["ttlSeconds"], DYNAMIC_DEFAULT_TTL_SECONDS);

        let body = write_body(&format!(
            r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"api-fixture","slot":3,"ttlSeconds":900,"keepAfterExecute":true}}"#
        ));
        let response = write(&body, &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        assert_eq!(value["slot"], 3);
        assert_eq!(value["ttlSeconds"], 900);
        assert_eq!(value["keepAfterExecute"], true);

        let body = write_body(&format!(
            r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"api-fixture","slot":0,"ttlSeconds":null}}"#
        ));
        let response = write(&body, &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);

        source.with_writes(|writes| {
            assert_eq!(writes.len(), 3);
            assert_eq!(writes[0].ttl_seconds, None);
            assert!(!writes[0].keep_after_execute);
            assert_eq!(writes[1].slot, 3);
            assert_eq!(writes[1].ttl_seconds, Some(900));
            assert!(writes[1].keep_after_execute);
            assert_eq!(writes[2].ttl_seconds, None);
            assert_eq!(writes[2].slot, 0);
        });
    }

    #[test]
    fn a_device_layer_failure_becomes_a_sanitized_public_error() {
        for (internal_code, expected_status, expected_code) in [
            (
                "device_not_found",
                StatusCode::NOT_FOUND,
                "device_not_found",
            ),
            ("ambiguous_device", StatusCode::CONFLICT, "ambiguous_device"),
            ("device_conflict", StatusCode::CONFLICT, "device_conflict"),
            (
                "hid_backend_unavailable",
                StatusCode::SERVICE_UNAVAILABLE,
                "hid_unavailable",
            ),
            (
                "device_open_failed",
                StatusCode::SERVICE_UNAVAILABLE,
                "device_open_failed",
            ),
            ("timeout", StatusCode::GATEWAY_TIMEOUT, "device_timeout"),
            (
                "transport_error",
                StatusCode::SERVICE_UNAVAILABLE,
                "transport_error",
            ),
            (
                "protocol_error",
                StatusCode::BAD_GATEWAY,
                "device_protocol_error",
            ),
            (
                "dynamic_unsupported",
                StatusCode::UNPROCESSABLE_ENTITY,
                "dynamic_unsupported",
            ),
            (
                "invalid_slot",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_slot",
            ),
            (
                "length_exceeded",
                StatusCode::UNPROCESSABLE_ENTITY,
                "text_too_long",
            ),
            (
                "dynamic_ttl_invalid",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_ttl",
            ),
            (
                "dynamic_keep_unsupported",
                StatusCode::UNPROCESSABLE_ENTITY,
                "keep_after_execute_unsupported",
            ),
        ] {
            // The internal message carries a marker that must never travel, and
            // the accepted text must not come back either.
            let source = TestSource::failing_writes(
                internal_code,
                "internal-detail /dev/hidraw0 serial=XYZ",
            );
            let registry = write_registry();
            let body = write_body(&valid_write_json());
            let response = write(&body, &source, &registry);
            assert_eq!(response.status(), expected_status, "{internal_code}");
            let text = body_text(response);
            let value: serde_json::Value = serde_json::from_str(&text).expect("JSON body");
            assert_eq!(value["error"]["code"], expected_code, "{internal_code}");
            for forbidden in ["internal-detail", "hidraw", "serial=", "api-fixture"] {
                assert!(
                    !text.contains(forbidden),
                    "{internal_code} error body contains {forbidden}"
                );
            }
        }
    }

    #[test]
    fn a_write_refuses_a_browser_origin_a_wrong_method_and_a_wrong_media_type() {
        let source = TestSource::writing();
        let registry = write_registry();
        let body = write_body(&valid_write_json());

        // A browser origin is refused before the body is read, and no CORS
        // header is ever sent.
        let response = tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: DYNAMIC_MACROS_PATH,
                browser_origin: true,
                content_type: Some("application/json"),
                body: Some(&body),
            },
            &source,
            &registry,
            &CountingNotifier::default(),
        ));
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());
        assert_eq!(error_code(response), "browser_origin_rejected");

        // A write must declare the JSON media type; a missing header is refused
        // as well instead of being guessed.
        for content_type in [None, Some("text/plain"), Some("application/xml")] {
            let response = tauri::async_runtime::block_on(handle_request(
                ApiRequest {
                    method: &Method::POST,
                    path: DYNAMIC_MACROS_PATH,
                    browser_origin: false,
                    content_type,
                    body: Some(&body),
                },
                &source,
                &registry,
                &CountingNotifier::default(),
            ));
            assert_eq!(
                response.status(),
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "{content_type:?}"
            );
            assert_eq!(error_code(response), "unsupported_media_type");
        }

        // A media type parameter is accepted.
        let response = tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: DYNAMIC_MACROS_PATH,
                browser_origin: false,
                content_type: Some("application/json; charset=utf-8"),
                body: Some(&body),
            },
            &source,
            &registry,
            &CountingNotifier::default(),
        ));
        assert_eq!(response.status(), StatusCode::OK);

        // A write whose body the reader never produced is refused instead of
        // being accepted as an empty write.
        let response = tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: DYNAMIC_MACROS_PATH,
                browser_origin: false,
                content_type: Some("application/json"),
                body: None,
            },
            &source,
            &registry,
            &CountingNotifier::default(),
        ));
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(error_code(response), "invalid_json");

        // Each path names the method that would work.
        let response = get_with(DYNAMIC_MACROS_PATH, false, &source, &registry);
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(response.headers().get(ALLOW).expect("allow"), "POST");

        let response = tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: DEVICES_PATH,
                browser_origin: false,
                content_type: Some("application/json"),
                body: Some(&body),
            },
            &source,
            &registry,
            &CountingNotifier::default(),
        ));
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(response.headers().get(ALLOW).expect("allow"), "GET");

        // Only the accepted write reached the device layer.
        assert_eq!(source.write_count(), 1);
    }

    #[test]
    fn an_oversized_write_body_is_refused_without_being_buffered() {
        let oversized = Bytes::from(vec![b'x'; MAX_WRITE_BODY_BYTES + 1]);
        let result = tauri::async_runtime::block_on(read_limited_body(Full::new(oversized)));
        assert!(matches!(result, Err(BodyReadError::TooLarge)));

        // A body at the limit is still readable, so the guard bounds the request
        // instead of rejecting a large but legal one.
        let within = Bytes::from(vec![b'x'; MAX_WRITE_BODY_BYTES]);
        let result = tauri::async_runtime::block_on(read_limited_body(Full::new(within)));
        assert_eq!(
            result.expect("body at the limit is readable").len(),
            MAX_WRITE_BODY_BYTES
        );
    }

    #[test]
    fn an_oversized_write_body_is_refused_with_413_over_a_real_socket() {
        use std::io::{Read, Write};

        let listener = bind_loopback("127.0.0.1:0").expect("bind loopback");
        let address = listener.local_addr().expect("local address");
        let source = Arc::new(TestSource::writing());
        let registry = Arc::new(write_registry());
        tauri::async_runtime::spawn(serve(
            listener,
            Arc::clone(&source),
            registry,
            Arc::new(CountingNotifier::default()),
            Arc::new(Notify::new()),
        ));

        // A body over the accepted size is refused while it is read, so the
        // oversized request never reaches the parser, the alias map or the device
        // layer, and the answer is the documented `413 payload_too_large`.
        let payload = format!(
            r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"{}","slot":0}}"#,
            "x".repeat(MAX_WRITE_BODY_BYTES)
        );
        assert!(
            payload.len() > MAX_WRITE_BODY_BYTES,
            "fixture exceeds the limit"
        );
        let request = format!(
            "POST {DYNAMIC_MACROS_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.len()
        );
        let mut stream = std::net::TcpStream::connect(address).expect("connect to the API");
        stream
            .set_read_timeout(Some(HEADER_READ_TIMEOUT))
            .expect("read timeout");
        stream.write_all(request.as_bytes()).expect("write request");
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("read response");

        assert!(
            response.starts_with("HTTP/1.1 413 Payload Too Large"),
            "{response}"
        );
        // The answer carries the documented code and status of the closed
        // vocabulary the handler-level tests pin.
        let (_, body) = response
            .split_once("\r\n\r\n")
            .expect("response has a body");
        let value: serde_json::Value = serde_json::from_str(body).expect("JSON body");
        let code = value["error"]["code"].as_str().expect("error code");
        assert_eq!(code, "payload_too_large");
        assert!(DOCUMENTED_CODES.contains(&code), "{code}");
        assert!(DOCUMENTED_STATUSES.contains(&StatusCode::PAYLOAD_TOO_LARGE));
        assert_eq!(source.write_count(), 0);
        // The refusal echoes neither the request nor the text it carried.
        assert!(!response.contains("xxxx"), "{response}");
        assert!(!response.contains(WRITE_ALIAS), "{response}");
    }

    #[test]
    fn a_published_product_name_is_bounded_and_control_free() {
        // `productName` comes from the device descriptor, so it is untrusted text:
        // the API publishes it bounded and control-free instead of passing the
        // descriptor through, and it is never a HID path or a serial number.
        let mut unsafe_name = summary(0x1234, 0x5678, 2);
        unsafe_name.product_name = Some(format!("Line\nBreak\t{}\u{0}\u{7}", "n".repeat(80)));
        let mut empty_name = summary(0x1234, 0x5678, 3);
        empty_name.product_name = Some(String::new());
        let source = TestSource::with_devices(vec![
            ApiDevice::from_summary(&unsafe_name),
            ApiDevice::from_summary(&empty_name),
        ]);
        let registry = aliases(&[]);

        let response = get_with(DEVICES_PATH, false, &source, &registry);
        assert_eq!(response.status(), StatusCode::OK);
        let body = body_text(response);
        let value: serde_json::Value = serde_json::from_str(&body).expect("JSON body");

        let name = value["devices"][0]["productName"]
            .as_str()
            .expect("the bounded name is still published");
        assert!(name.starts_with("Line"), "{name}");
        assert!(!name.chars().any(char::is_control), "{name}");
        assert!(name.chars().count() <= 64, "{name}");
        // A descriptor control character becomes the replacement character instead
        // of travelling, so the value stays printable.
        assert!(name.contains('\u{fffd}'), "{name}");
        // A descriptor without a usable name is published as an explicit `null`,
        // not as an empty string a caller could mistake for a real name.
        let unnamed = value["devices"][1]
            .as_object()
            .expect("the second device is an object");
        assert!(unnamed.contains_key("productName"), "{unnamed:?}");
        assert_eq!(unnamed["productName"], serde_json::Value::Null);
        // The refused characters reach neither the JSON nor the published text.
        for raw in ["\\u0000", "\\u0007", "\\n", "\\t"] {
            assert!(!body.contains(raw), "response contains {raw}: {body}");
        }
    }

    /// Public code and status vocabulary of the caller contract
    /// (`docs/LOCAL_DYNAMIC_HTTP_API.md` §6 of the companion project).
    const DOCUMENTED_CODES: &[&str] = &[
        "ambiguous_device",
        "browser_origin_rejected",
        "device_conflict",
        "device_error",
        "device_not_found",
        "device_open_failed",
        "device_protocol_error",
        "device_timeout",
        "dynamic_unsupported",
        "hid_unavailable",
        "internal_error",
        "invalid_json",
        "invalid_request",
        "invalid_slot",
        "invalid_text",
        "invalid_ttl",
        "keep_after_execute_unsupported",
        "method_not_allowed",
        "not_found",
        "payload_too_large",
        "service_not_ready",
        "text_too_long",
        "transport_error",
        "unsupported_media_type",
    ];

    const DOCUMENTED_STATUSES: &[StatusCode] = &[
        StatusCode::BAD_REQUEST,
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
        StatusCode::METHOD_NOT_ALLOWED,
        StatusCode::CONFLICT,
        StatusCode::PAYLOAD_TOO_LARGE,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        StatusCode::UNPROCESSABLE_ENTITY,
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::BAD_GATEWAY,
        StatusCode::SERVICE_UNAVAILABLE,
        StatusCode::GATEWAY_TIMEOUT,
    ];

    #[test]
    fn every_device_layer_error_maps_onto_one_documented_public_error() {
        // The public mapping is complete: every code the device layer can return
        // has one documented status and one documented code, with a fixed message,
        // so neither an internal code nor backend text can reach a caller.
        for (internal_code, expected_status, expected_code) in [
            ("no_device", StatusCode::NOT_FOUND, "device_not_found"),
            (
                "device_not_found",
                StatusCode::NOT_FOUND,
                "device_not_found",
            ),
            ("ambiguous_device", StatusCode::CONFLICT, "ambiguous_device"),
            ("device_conflict", StatusCode::CONFLICT, "device_conflict"),
            (
                "hid_backend_unavailable",
                StatusCode::SERVICE_UNAVAILABLE,
                "hid_unavailable",
            ),
            (
                "not_connected",
                StatusCode::SERVICE_UNAVAILABLE,
                "hid_unavailable",
            ),
            (
                "device_open_failed",
                StatusCode::SERVICE_UNAVAILABLE,
                "device_open_failed",
            ),
            (
                "usage_metadata_missing",
                StatusCode::SERVICE_UNAVAILABLE,
                "device_open_failed",
            ),
            (
                "transport_error",
                StatusCode::SERVICE_UNAVAILABLE,
                "transport_error",
            ),
            ("timeout", StatusCode::GATEWAY_TIMEOUT, "device_timeout"),
            (
                "protocol_error",
                StatusCode::BAD_GATEWAY,
                "device_protocol_error",
            ),
            (
                "dynamic_auth_boundary",
                StatusCode::BAD_GATEWAY,
                "device_protocol_error",
            ),
            (
                "bad_version",
                StatusCode::UNPROCESSABLE_ENTITY,
                "dynamic_unsupported",
            ),
            (
                "bad_opcode",
                StatusCode::UNPROCESSABLE_ENTITY,
                "dynamic_unsupported",
            ),
            (
                "dynamic_unsupported",
                StatusCode::UNPROCESSABLE_ENTITY,
                "dynamic_unsupported",
            ),
            ("bad_slot", StatusCode::UNPROCESSABLE_ENTITY, "invalid_slot"),
            (
                "invalid_slot",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_slot",
            ),
            (
                "length_exceeded",
                StatusCode::UNPROCESSABLE_ENTITY,
                "text_too_long",
            ),
            (
                "invalid_text",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
            ),
            (
                "dynamic_empty",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
            ),
            (
                "dynamic_ttl_invalid",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_ttl",
            ),
            (
                "dynamic_keep_unsupported",
                StatusCode::UNPROCESSABLE_ENTITY,
                "keep_after_execute_unsupported",
            ),
            (
                "bad_request",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_request",
            ),
            (
                "bad_offset",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_request",
            ),
            (
                "bad_length",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_request",
            ),
            ("storage_error", StatusCode::BAD_GATEWAY, "device_error"),
            (
                "device_internal_error",
                StatusCode::BAD_GATEWAY,
                "device_error",
            ),
            ("device_error", StatusCode::BAD_GATEWAY, "device_error"),
        ] {
            let (status, code, message) = public_error(internal_code);
            assert_eq!(status, expected_status, "{internal_code}");
            assert_eq!(code, expected_code, "{internal_code}");
            assert!(
                DOCUMENTED_STATUSES.contains(&status),
                "{internal_code} maps onto the undocumented status {status}"
            );
            assert!(
                DOCUMENTED_CODES.contains(&code),
                "{internal_code} maps onto the undocumented code {code}"
            );
            assert!(!message.is_empty(), "{internal_code}");
            assert!(
                !message.chars().any(char::is_control),
                "{internal_code} has a message that is not printable"
            );
        }

        // A code the mapping does not classify becomes the generic local failure
        // instead of reaching the caller as itself.
        for unclassified in [
            "state_unavailable",
            "invalid_configuration",
            "internal_error",
            "",
            "Not-A-Code",
        ] {
            let (status, code, _) = public_error(unclassified);
            assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{unclassified}");
            assert_eq!(code, "internal_error", "{unclassified}");
        }
    }

    /// Status and stable public code of one answered request.
    fn status_and_code(response: Response<Full<Bytes>>) -> (StatusCode, String) {
        let status = response.status();
        let value: serde_json::Value =
            serde_json::from_str(&body_text(response)).expect("JSON body");
        (
            status,
            value["error"]["code"].as_str().unwrap_or("ok").to_string(),
        )
    }

    /// Answer one `POST` on an arbitrary path, with no body and no media type.
    fn post(
        path: &str,
        source: &TestSource,
        registry: &Mutex<DeviceAliasRegistry>,
    ) -> Response<Full<Bytes>> {
        tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path,
                browser_origin: false,
                content_type: None,
                body: None,
            },
            source,
            registry,
            &CountingNotifier::default(),
        ))
    }

    /// Answer one write request with an explicit `Content-Type` header.
    fn write_with_content_type(
        body: Option<&Bytes>,
        content_type: Option<&str>,
        source: &TestSource,
        registry: &Mutex<DeviceAliasRegistry>,
    ) -> Response<Full<Bytes>> {
        tauri::async_runtime::block_on(handle_request(
            ApiRequest {
                method: &Method::POST,
                path: DYNAMIC_MACROS_PATH,
                browser_origin: false,
                content_type,
                body,
            },
            source,
            registry,
            &CountingNotifier::default(),
        ))
    }

    #[test]
    fn every_request_level_refusal_uses_a_documented_public_code() {
        // Routing and request-parsing refusals share the closed vocabulary of the
        // caller contract, so a new refusal cannot appear under an undocumented
        // code or a status the contract does not promise.
        let source = TestSource::writing();
        let ready = aliases(&[]);
        let unsynced = unsynced_aliases();
        let valid = write_body(&valid_write_json());

        let cases: Vec<(&str, StatusCode, &str, Response<Full<Bytes>>)> = vec![
            (
                "unknown path",
                StatusCode::NOT_FOUND,
                "not_found",
                get("/api/v1/unknown", false, &source),
            ),
            (
                "GET on the write path",
                StatusCode::METHOD_NOT_ALLOWED,
                "method_not_allowed",
                get(DYNAMIC_MACROS_PATH, false, &source),
            ),
            (
                "POST on a read path",
                StatusCode::METHOD_NOT_ALLOWED,
                "method_not_allowed",
                post(DEVICES_PATH, &source, &ready),
            ),
            (
                "browser origin",
                StatusCode::FORBIDDEN,
                "browser_origin_rejected",
                get(HEALTH_PATH, true, &source),
            ),
            (
                "missing media type",
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                write_with_content_type(Some(&valid), None, &source, &ready),
            ),
            (
                "wrong media type",
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                write_with_content_type(Some(&valid), Some("text/plain"), &source, &ready),
            ),
            (
                "missing body",
                StatusCode::BAD_REQUEST,
                "invalid_json",
                write_with_content_type(None, Some("application/json"), &source, &ready),
            ),
            (
                "empty body",
                StatusCode::BAD_REQUEST,
                "invalid_json",
                write(&Bytes::new(), &source, &ready),
            ),
            (
                "unknown field",
                StatusCode::BAD_REQUEST,
                "invalid_json",
                write(
                    &write_body(r#"{"deviceAlias":"Work keyboard","text":"x","slot":0,"extra":1}"#),
                    &source,
                    &ready,
                ),
            ),
            (
                "unusable alias",
                StatusCode::BAD_REQUEST,
                "invalid_request",
                write(
                    &write_body(&format!(
                        r#"{{"deviceAlias":"{}","text":"x","slot":0}}"#,
                        "n".repeat(MAX_DEVICE_ALIAS_BYTES + 1)
                    )),
                    &source,
                    &ready,
                ),
            ),
            (
                "empty text",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_text",
                write(
                    &write_body(&format!(
                        r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"","slot":0}}"#
                    )),
                    &source,
                    &ready,
                ),
            ),
            (
                "text over the protocol bound",
                StatusCode::UNPROCESSABLE_ENTITY,
                "text_too_long",
                write(
                    &write_body(&format!(
                        r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"{}","slot":0}}"#,
                        "x".repeat(MAX_DYNAMIC_TEXT_LENGTH + 1)
                    )),
                    &source,
                    &ready,
                ),
            ),
            (
                "object index outside the protocol range",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_slot",
                write(
                    &write_body(&format!(
                        r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"x","slot":8}}"#
                    )),
                    &source,
                    &ready,
                ),
            ),
            (
                "ttl outside the protocol range",
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_ttl",
                write(
                    &write_body(&format!(
                        r#"{{"deviceAlias":"{WRITE_ALIAS}","text":"x","slot":0,"ttlSeconds":0}}"#
                    )),
                    &source,
                    &ready,
                ),
            ),
            (
                "alias map not mirrored yet",
                StatusCode::SERVICE_UNAVAILABLE,
                "service_not_ready",
                write(&valid, &source, &unsynced),
            ),
            (
                "alias without a device",
                StatusCode::NOT_FOUND,
                "device_not_found",
                write(&valid, &source, &ready),
            ),
        ];

        for (label, expected_status, expected_code, response) in cases {
            let (status, code) = status_and_code(response);
            assert_eq!(status, expected_status, "{label}");
            assert_eq!(code, expected_code, "{label}");
            // The vocabulary is closed: every refusal is one the caller contract
            // documents, with a status the contract promises for it.
            assert!(
                DOCUMENTED_STATUSES.contains(&status),
                "{label} answered with the undocumented status {status}"
            );
            assert!(
                DOCUMENTED_CODES.contains(&code.as_str()),
                "{label} answered with the undocumented code {code}"
            );
        }
        // No refusal reached the device layer.
        assert_eq!(source.write_count(), 0);
    }
}
