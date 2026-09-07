use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;

use serde::Serialize;
use tauri::State;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::client::{ClientConfig, RuntimeMacroClient, SlotInfo};
use crate::error::{ClientError, TransportError};
use crate::hid::{
    enumerate_devices, new_hid_api, open_device, DeviceDiscoveryError, DeviceRecord, DeviceSummary,
    HidTransport, RUNTIME_MACRO_USAGE, RUNTIME_MACRO_USAGE_PAGE,
};
use crate::protocol::{AuthInfo, Status};

/// A stable, serializable error envelope used by every frontend command.
///
/// Backend and operating-system error text is intentionally discarded. This
/// keeps paths, serial numbers, and backend-specific details out of the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    fn state_unavailable() -> Self {
        Self::new("state_unavailable", "The application state is unavailable.")
    }

    fn candidate_not_found() -> Self {
        Self::new(
            "candidate_not_found",
            "The selected device is no longer available. Refresh the device list.",
        )
    }

    fn not_connected() -> Self {
        Self::new("not_connected", "No Runtime Macro device is connected.")
    }
}

impl From<DeviceDiscoveryError> for CommandError {
    fn from(error: DeviceDiscoveryError) -> Self {
        match error {
            DeviceDiscoveryError::HidApiInitialization => Self::new(
                "hid_backend_unavailable",
                "The HID backend could not be initialized.",
            ),
            DeviceDiscoveryError::NoDevice => Self::new(
                "no_device",
                "No compatible Runtime Macro HID device was found.",
            ),
            DeviceDiscoveryError::UsageMetadataMissing => Self::new(
                "usage_metadata_missing",
                "HID Usage metadata is unavailable; choose a device explicitly.",
            ),
            DeviceDiscoveryError::AmbiguousDevices { .. } => Self::new(
                "ambiguous_devices",
                "Multiple compatible HID devices were found; choose one explicitly.",
            ),
            DeviceDiscoveryError::OpenFailed => Self::new(
                "device_open_failed",
                "The selected HID device could not be opened; it may be busy or require permission.",
            ),
            DeviceDiscoveryError::InvalidPath => Self::new(
                "device_open_failed",
                "The selected HID device could not be opened; it may be busy or require permission.",
            ),
        }
    }
}

impl From<ClientError> for CommandError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::Transport(TransportError::Timeout) => {
                Self::new("timeout", "The HID device did not respond in time.")
            }
            ClientError::Transport(TransportError::Recoverable(_))
            | ClientError::Transport(TransportError::Fatal(_)) => Self::new(
                "transport_error",
                "Communication with the HID device failed.",
            ),
            ClientError::Protocol(_) => Self::new(
                "protocol_error",
                "The device returned an invalid protocol response.",
            ),
            ClientError::Auth(error) => match error {
                crate::error::AuthError::EmptyPassword => {
                    Self::new("empty_password", "A management password must not be empty.")
                }
                crate::error::AuthError::InvalidIterations
                | crate::error::AuthError::InvalidSalt
                | crate::error::AuthError::InvalidDerivedKey
                | crate::error::AuthError::InvalidNonce => Self::new(
                    "invalid_authentication_input",
                    "The authentication input is invalid.",
                ),
                crate::error::AuthError::RandomnessUnavailable => Self::new(
                    "randomness_unavailable",
                    "The operating system secure random source is unavailable.",
                ),
            },
            ClientError::Remote(status) => {
                let (code, message) = match status {
                    crate::protocol::Status::BadVersion => (
                        "bad_version",
                        "The device uses an unsupported protocol version.",
                    ),
                    crate::protocol::Status::BadOpcode => {
                        ("bad_opcode", "The device rejected the protocol command.")
                    }
                    crate::protocol::Status::BadRequest => {
                        ("bad_request", "The device rejected the request.")
                    }
                    crate::protocol::Status::BadSlot => {
                        ("bad_slot", "The device rejected the slot.")
                    }
                    crate::protocol::Status::BadOffset => {
                        ("bad_offset", "The device rejected the data offset.")
                    }
                    crate::protocol::Status::BadLength => {
                        ("bad_length", "The device rejected the data length.")
                    }
                    crate::protocol::Status::InvalidText => {
                        ("invalid_text", "The device rejected the slot text.")
                    }
                    crate::protocol::Status::StorageError => (
                        "storage_error",
                        "The device could not persist its settings.",
                    ),
                    crate::protocol::Status::Internal => (
                        "device_internal_error",
                        "The device reported an internal error.",
                    ),
                    crate::protocol::Status::AuthRequired => {
                        ("auth_required", "Unlock the device before managing macros.")
                    }
                    crate::protocol::Status::AuthFailed => {
                        ("auth_failed", "The management password was not accepted.")
                    }
                    crate::protocol::Status::AuthNotConfigured => (
                        "auth_not_configured",
                        "The device has no management password configured.",
                    ),
                    crate::protocol::Status::RateLimited => (
                        "rate_limited",
                        "Too many authentication attempts; wait before trying again.",
                    ),
                    crate::protocol::Status::AuthNoChallenge => (
                        "auth_no_challenge",
                        "The authentication challenge is no longer available.",
                    ),
                    crate::protocol::Status::CredentialInvalid => (
                        "credential_invalid",
                        "The device rejected the new management credential.",
                    ),
                    crate::protocol::Status::Ok => {
                        ("device_error", "The device returned an unexpected status.")
                    }
                };
                Self::new(code, message)
            }
            ClientError::InvalidSlot(_) => {
                Self::new("invalid_slot", "The selected slot is invalid.")
            }
            ClientError::InvalidText(_) => {
                Self::new("invalid_text", "The slot contains unsupported text bytes.")
            }
            ClientError::LengthExceeded { .. } => Self::new(
                "length_exceeded",
                "The slot text exceeds the protocol limit.",
            ),
            ClientError::InvalidConfiguration(_) => Self::new(
                "invalid_configuration",
                "The client configuration is invalid.",
            ),
        }
    }
}

type HidJob = Box<dyn FnOnce() + Send + 'static>;

/// Run every application-state command on one long-lived thread.
///
/// macOS's hidapi backend keeps a process-global IOHIDManager tied to the
/// thread that initializes it. Tauri's blocking pool is allowed to move
/// successive commands between short-lived worker threads, so HID operations
/// must not run directly on that pool. Keeping the state and all session
/// lifecycle operations on this worker also makes device close/drop ordering
/// deterministic.
struct HidWorker {
    sender: mpsc::Sender<HidJob>,
}

impl HidWorker {
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<HidJob>();
        thread::Builder::new()
            .name("zmk-hid-worker".to_string())
            .spawn(move || {
                while let Ok(job) = receiver.recv() {
                    job();
                }
            })
            .expect("failed to start HID worker thread");
        Self { sender }
    }

    fn execute<T, F>(&self, operation: F) -> Result<T, CommandError>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, CommandError> + Send + 'static,
    {
        let (result_sender, result_receiver) = mpsc::sync_channel(1);
        self.sender
            .send(Box::new(move || {
                let _ = result_sender.send(operation());
            }))
            .map_err(|_| CommandError::state_unavailable())?;
        result_receiver
            .recv()
            .map_err(|_| CommandError::state_unavailable())?
    }
}

static HID_WORKER: OnceLock<HidWorker> = OnceLock::new();

fn execute_on_hid_worker<T, F>(operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CommandError> + Send + 'static,
{
    HID_WORKER.get_or_init(HidWorker::new).execute(operation)
}

async fn run_on_hid_worker<T, F>(operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || execute_on_hid_worker(operation))
        .await
        .map_err(|_| CommandError::state_unavailable())?
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageMetadataStatus {
    Exact,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCandidate {
    pub id: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: Option<String>,
    pub interface_number: i32,
    pub usage_page: u16,
    pub usage: u16,
    pub usage_metadata: UsageMetadataStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDevice {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product_name: Option<String>,
    pub interface_number: i32,
    pub usage_page: u16,
    pub usage: u16,
    pub usage_metadata: UsageMetadataStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    Disconnected,
    Open,
    Locked,
    Authenticated,
    CredentialInvalid,
}

impl AuthState {
    fn from_info(info: &AuthInfo) -> Self {
        if !info.password_configured {
            Self::Open
        } else if info.session_authenticated {
            Self::Authenticated
        } else {
            Self::Locked
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub connected: bool,
    pub device: Option<ConnectedDevice>,
    pub auth_state: AuthState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSettings {
    pub timeout_ms: u64,
    pub retries: usize,
    pub applies_next_connection: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotMetadata {
    pub slot: u8,
    pub length: u16,
}

impl From<SlotInfo> for SlotMetadata {
    fn from(slot: SlotInfo) -> Self {
        Self {
            slot: slot.slot,
            length: slot.length,
        }
    }
}

fn safe_product_name(product_name: Option<&str>) -> Option<String> {
    let product_name = product_name?;
    let mut safe = String::new();
    for character in product_name.chars().take(64) {
        if character.is_control() {
            safe.push('\u{fffd}');
        } else {
            safe.push(character);
        }
    }
    (!safe.is_empty()).then_some(safe)
}

fn usage_metadata(summary: &DeviceSummary) -> UsageMetadataStatus {
    if summary.usage_page == RUNTIME_MACRO_USAGE_PAGE && summary.usage == RUNTIME_MACRO_USAGE {
        UsageMetadataStatus::Exact
    } else {
        UsageMetadataStatus::Missing
    }
}

fn connected_device(summary: &DeviceSummary) -> ConnectedDevice {
    ConnectedDevice {
        vendor_id: summary.vendor_id,
        product_id: summary.product_id,
        product_name: safe_product_name(summary.product_name.as_deref()),
        interface_number: summary.interface_number,
        usage_page: summary.usage_page,
        usage: summary.usage,
        usage_metadata: usage_metadata(summary),
    }
}

struct RegisteredCandidate {
    id: String,
    record: DeviceRecord,
    dto: DeviceCandidate,
}

#[derive(Default)]
pub struct DeviceRegistry {
    candidates: Vec<RegisteredCandidate>,
}

impl DeviceRegistry {
    /// Replace the current directory and invalidate every previously issued ID.
    ///
    /// The desktop candidate list is deliberately strict: only a USB record
    /// with the exact Runtime Macro vendor Usage pair is safe to present as
    /// connectable. Some Bluetooth HID backends report Usage Page/Usage as
    /// `0/0`, but neither that metadata nor an exact Usage pair identifies a
    /// supported USB Runtime Macro interface.
    pub fn refresh(&mut self, records: Vec<DeviceRecord>) -> Vec<DeviceCandidate> {
        self.candidates.clear();

        self.candidates = records
            .into_iter()
            .filter(|record| record.is_usb() && record.has_target_usage_for_registry())
            .map(|record| {
                let summary = record.summary();
                let id = format!("candidate-{}", Uuid::new_v4().simple());
                let dto = DeviceCandidate {
                    id: id.clone(),
                    vendor_id: summary.vendor_id,
                    product_id: summary.product_id,
                    product_name: safe_product_name(summary.product_name.as_deref()),
                    interface_number: summary.interface_number,
                    usage_page: summary.usage_page,
                    usage: summary.usage,
                    usage_metadata: usage_metadata(&summary),
                };
                RegisteredCandidate { id, record, dto }
            })
            .collect();

        self.candidates
            .iter()
            .map(|candidate| candidate.dto.clone())
            .collect()
    }

    pub fn invalidate(&mut self) {
        self.candidates.clear();
    }

    fn find(&self, id: &str) -> Option<DeviceRecord> {
        self.candidates
            .iter()
            .find(|candidate| candidate.id == id)
            .map(|candidate| candidate.record.clone())
    }
}

/// A narrow abstraction around the protocol session makes connection state
/// testable without requiring a real USB device.
pub trait MacroSession: Send {
    fn list_slots(&mut self) -> Result<Vec<SlotInfo>, ClientError>;
    fn get_slot(&mut self, slot: u8) -> Result<Vec<u8>, ClientError>;
    fn set_slot(&mut self, slot: u8, data: &[u8]) -> Result<(), ClientError>;
    fn clear_slot(&mut self, slot: u8) -> Result<(), ClientError>;

    /// Authentication methods are part of the backend session boundary so
    /// the next Tauri command layer cannot accidentally bypass v2. Custom
    /// test sessions remain source-compatible until they opt into auth.
    fn auth_info(&mut self) -> Result<AuthInfo, ClientError> {
        Err(ClientError::InvalidConfiguration(
            "session does not implement v2 authentication",
        ))
    }

    fn authenticate(&mut self, _password: &str) -> Result<(), ClientError> {
        Err(ClientError::InvalidConfiguration(
            "session does not implement v2 authentication",
        ))
    }

    fn set_password(&mut self, _password: &str) -> Result<(), ClientError> {
        Err(ClientError::InvalidConfiguration(
            "session does not implement v2 authentication",
        ))
    }

    fn lock(&mut self) -> Result<(), ClientError> {
        Err(ClientError::InvalidConfiguration(
            "session does not implement v2 authentication",
        ))
    }
}

impl MacroSession for RuntimeMacroClient<HidTransport> {
    fn list_slots(&mut self) -> Result<Vec<SlotInfo>, ClientError> {
        RuntimeMacroClient::list_slots(self)
    }

    fn get_slot(&mut self, slot: u8) -> Result<Vec<u8>, ClientError> {
        RuntimeMacroClient::get_slot(self, slot)
    }

    fn set_slot(&mut self, slot: u8, data: &[u8]) -> Result<(), ClientError> {
        RuntimeMacroClient::set_slot(self, slot, data)
    }

    fn clear_slot(&mut self, slot: u8) -> Result<(), ClientError> {
        RuntimeMacroClient::clear_slot(self, slot)
    }

    fn auth_info(&mut self) -> Result<AuthInfo, ClientError> {
        RuntimeMacroClient::auth_info(self)
    }

    fn authenticate(&mut self, password: &str) -> Result<(), ClientError> {
        RuntimeMacroClient::authenticate(self, password)
    }

    fn set_password(&mut self, password: &str) -> Result<(), ClientError> {
        RuntimeMacroClient::set_password(self, password)
    }

    fn lock(&mut self) -> Result<(), ClientError> {
        RuntimeMacroClient::lock(self)
    }
}

pub trait SessionFactory: Send {
    fn open(
        &mut self,
        record: &DeviceRecord,
        config: ClientConfig,
    ) -> Result<Box<dyn MacroSession>, DeviceDiscoveryError>;
}

#[derive(Default)]
pub struct HidSessionFactory;

impl SessionFactory for HidSessionFactory {
    fn open(
        &mut self,
        record: &DeviceRecord,
        config: ClientConfig,
    ) -> Result<Box<dyn MacroSession>, DeviceDiscoveryError> {
        let api = new_hid_api()?;
        let transport = open_device(&api, record)?;
        Ok(Box::new(RuntimeMacroClient::with_config(transport, config)))
    }
}

struct ConnectedSession {
    device: ConnectedDevice,
    session: Box<dyn MacroSession>,
    auth_state: AuthState,
}

pub struct AppState<F: SessionFactory = HidSessionFactory> {
    registry: DeviceRegistry,
    connection: Option<ConnectedSession>,
    factory: F,
    client_config: ClientConfig,
}

impl Default for AppState<HidSessionFactory> {
    fn default() -> Self {
        Self::new(HidSessionFactory)
    }
}

impl<F: SessionFactory> AppState<F> {
    pub fn new(factory: F) -> Self {
        Self {
            registry: DeviceRegistry::default(),
            connection: None,
            factory,
            client_config: ClientConfig::default(),
        }
    }

    pub fn client_settings(&self) -> ClientSettings {
        ClientSettings {
            timeout_ms: self.client_config.timeout_ms,
            retries: self.client_config.retries,
            applies_next_connection: true,
        }
    }

    pub fn set_client_settings(
        &mut self,
        timeout_ms: u64,
        retries: usize,
    ) -> Result<ClientSettings, CommandError> {
        let config = ClientConfig::new(timeout_ms, retries).map_err(CommandError::from)?;
        self.client_config = config;
        Ok(self.client_settings())
    }

    pub fn invalidate_candidates(&mut self) {
        self.registry.invalidate();
    }

    pub fn refresh_records(&mut self, records: Vec<DeviceRecord>) -> Vec<DeviceCandidate> {
        self.registry.refresh(records)
    }

    pub fn connect(&mut self, opaque_id: &str) -> Result<ConnectionState, CommandError> {
        // Switching devices must not leave the previous authentication window
        // active. LOCK is best-effort because the old transport may already be
        // gone; dropping the session is unconditional.
        self.disconnect();

        let record = self
            .registry
            .find(opaque_id)
            .ok_or_else(CommandError::candidate_not_found)?;
        let summary = record.summary();
        let device = connected_device(&summary);
        let mut session = self
            .factory
            .open(&record, self.client_config)
            .map_err(CommandError::from)?;

        // AUTH_INFO is the v2 handshake. Do not install a session until it
        // succeeds, and never fall back to an unauthenticated v1 LIST.
        let info = match session.auth_info() {
            Ok(info) => info,
            Err(error) => {
                // The candidate session is not installed, but still gets a
                // best-effort LOCK before its transport is dropped.
                let _ = session.lock();
                return Err(CommandError::from(error));
            }
        };
        let auth_state = AuthState::from_info(&info);
        self.connection = Some(ConnectedSession {
            device,
            session,
            auth_state,
        });
        Ok(self.connection_state())
    }

    pub fn connection_state(&self) -> ConnectionState {
        match self.connection.as_ref() {
            Some(connection) => ConnectionState {
                connected: true,
                device: Some(connection.device.clone()),
                auth_state: connection.auth_state,
            },
            None => ConnectionState {
                connected: false,
                device: None,
                auth_state: AuthState::Disconnected,
            },
        }
    }

    pub fn refresh_auth_state(&mut self) -> Result<AuthState, CommandError> {
        if self.connection.is_none() {
            return Err(CommandError::not_connected());
        }

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .auth_info();
        match result {
            Ok(info) => {
                let auth_state = AuthState::from_info(&info);
                self.connection
                    .as_mut()
                    .expect("connection was checked above")
                    .auth_state = auth_state;
                Ok(auth_state)
            }
            Err(error) => {
                if !self.retain_connection_for_command_error(&error) {
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn authenticate(&mut self, password: &str) -> Result<AuthState, CommandError> {
        if self.connection.is_none() {
            return Err(CommandError::not_connected());
        }

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .authenticate(password);
        match result {
            Ok(()) => {
                self.connection
                    .as_mut()
                    .expect("connection was checked above")
                    .auth_state = AuthState::Authenticated;
                Ok(AuthState::Authenticated)
            }
            Err(error) => {
                if !self.retain_connection_for_command_error(&error) {
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn set_password(&mut self, password: &str) -> Result<AuthState, CommandError> {
        if self.connection.is_none() {
            return Err(CommandError::not_connected());
        }

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .set_password(password);
        match result {
            Ok(()) => {
                // PASSWORD_SET success invalidates the old session and the
                // client confirms PROTECTED through AUTH_INFO before returning.
                self.connection
                    .as_mut()
                    .expect("connection was checked above")
                    .auth_state = AuthState::Locked;
                Ok(AuthState::Locked)
            }
            Err(error) => {
                // CREDENTIAL_INVALID is ambiguous at this boundary: the
                // PASSWORD_SET object may be rejected while the old session
                // remains valid, or the client's AUTH_INFO observation may
                // have found a damaged device credential. Re-read AUTH_INFO
                // once, returning the original error either way.
                if matches!(error, ClientError::Remote(Status::CredentialInvalid)) {
                    self.reconcile_credential_invalid();
                } else if !self.retain_connection_for_command_error(&error) {
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn lock(&mut self) -> Result<AuthState, CommandError> {
        let previous_state = self
            .connection
            .as_ref()
            .map(|connection| connection.auth_state)
            .ok_or_else(CommandError::not_connected)?;

        // The local state is locked before observing the transport result.
        // This is deliberately unconditional so a failed LOCK cannot leave a
        // stale authenticated state visible to the frontend.
        self.connection
            .as_mut()
            .expect("connection was checked above")
            .auth_state = AuthState::Locked;
        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .lock();
        let state_after_lock = match &result {
            Ok(()) => state_after_lock_result(previous_state),
            Err(ClientError::Remote(Status::AuthNotConfigured)) => AuthState::Open,
            Err(ClientError::Remote(Status::CredentialInvalid)) => AuthState::CredentialInvalid,
            Err(_) => state_after_lock_result(previous_state),
        };
        self.connection
            .as_mut()
            .expect("connection was checked above")
            .auth_state = state_after_lock;
        match result {
            Ok(()) => Ok(state_after_lock),
            Err(error) => Err(CommandError::from(error)),
        }
    }

    fn reconcile_credential_invalid(&mut self) {
        if self.connection.is_none() {
            return;
        }
        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .auth_info();
        match result {
            Ok(info) => {
                let auth_state = AuthState::from_info(&info);
                self.connection
                    .as_mut()
                    .expect("connection was checked above")
                    .auth_state = auth_state;
            }
            Err(error) => {
                if !self.retain_connection_for_command_error(&error) {
                    self.connection = None;
                }
            }
        }
    }

    fn retain_connection_for_auth_error(&mut self, error: &ClientError) -> bool {
        if let Some(auth_state) = auth_state_for_error(error) {
            if let Some(connection) = self.connection.as_mut() {
                connection.auth_state = auth_state;
                return true;
            }
            return false;
        }
        self.retain_connection_for_command_error(error)
    }

    fn ensure_management_access(&self) -> Result<(), CommandError> {
        let Some(connection) = self.connection.as_ref() else {
            return Err(CommandError::not_connected());
        };
        match connection.auth_state {
            AuthState::Open | AuthState::Authenticated => Ok(()),
            AuthState::Locked => Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired,
            ))),
            AuthState::CredentialInvalid => Err(CommandError::from(ClientError::Remote(
                Status::CredentialInvalid,
            ))),
            AuthState::Disconnected => Err(CommandError::not_connected()),
        }
    }

    fn retain_connection_for_command_error(&mut self, error: &ClientError) -> bool {
        if let Some(auth_state) = auth_state_for_error(error) {
            if let Some(connection) = self.connection.as_mut() {
                connection.auth_state = auth_state;
                return true;
            }
            return false;
        }

        // A remote status is a valid protocol response and leaves the HID
        // session usable. Only exhausted transport failures, malformed
        // protocol responses, and an explicit incompatibility status discard
        // the session. This also preserves the old credential/session state on
        // PASSWORD_SET STORAGE_ERROR.
        match error {
            ClientError::Transport(_) | ClientError::Protocol(_) => false,
            ClientError::Remote(Status::BadVersion) => false,
            ClientError::Remote(_)
            | ClientError::Auth(_)
            | ClientError::InvalidConfiguration(_)
            | ClientError::InvalidSlot(_)
            | ClientError::InvalidText(_)
            | ClientError::LengthExceeded { .. } => self.connection.is_some(),
        }
    }

    pub fn list_slots(&mut self) -> Result<Vec<SlotMetadata>, CommandError> {
        self.ensure_management_access()?;

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .list_slots();
        match result {
            Ok(slots) => Ok(slots.into_iter().map(SlotMetadata::from).collect()),
            Err(error) => {
                // Valid remote statuses keep the HID connection so the
                // frontend can recover authentication without reconnecting;
                // only transport/protocol failure invalidates it.
                if !self.retain_connection_for_auth_error(&error) {
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn get_slot(&mut self, slot: u8) -> Result<Vec<u8>, CommandError> {
        self.ensure_management_access()?;

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .get_slot(slot);
        match result {
            Ok(data) => Ok(data),
            Err(error) => {
                if !self.retain_connection_for_auth_error(&error) {
                    // A transport/protocol read failure invalidates the live
                    // session. A remote status remains physically connected.
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn set_slot(&mut self, slot: u8, text: &str) -> Result<(), CommandError> {
        self.ensure_management_access()?;

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .set_slot(slot, text.as_bytes());
        match result {
            Ok(()) => Ok(()),
            Err(error) => {
                if !self.retain_connection_for_auth_error(&error) {
                    // SET transport/protocol failures invalidate the session;
                    // STORAGE_ERROR and other remote statuses retain it while
                    // the caller reports the authoritative device error.
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn clear_slot(&mut self, slot: u8) -> Result<(), CommandError> {
        self.ensure_management_access()?;

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .clear_slot(slot);
        match result {
            Ok(()) => Ok(()),
            Err(error) => {
                if !self.retain_connection_for_auth_error(&error) {
                    self.connection = None;
                }
                Err(CommandError::from(error))
            }
        }
    }

    pub fn disconnect(&mut self) {
        if let Some(mut connection) = self.connection.take() {
            // LOCK is best-effort on disconnect. Dropping the session locally
            // is the authoritative lifecycle action even if the HID write fails.
            let _ = connection.session.lock();
        }
    }
}

impl<F: SessionFactory> Drop for AppState<F> {
    fn drop(&mut self) {
        // A normal Tauri application shutdown drops managed state after the
        // window closes. Reuse the same best-effort LOCK path used for explicit
        // disconnects; a failed LOCK never changes shutdown behavior.
        self.disconnect();
    }
}

fn state_after_lock_result(previous_state: AuthState) -> AuthState {
    match previous_state {
        AuthState::Open => AuthState::Open,
        AuthState::CredentialInvalid => AuthState::CredentialInvalid,
        AuthState::Disconnected | AuthState::Locked | AuthState::Authenticated => AuthState::Locked,
    }
}

fn auth_state_for_error(error: &ClientError) -> Option<AuthState> {
    let ClientError::Remote(status) = error else {
        return None;
    };
    match status {
        Status::AuthRequired
        | Status::AuthFailed
        | Status::RateLimited
        | Status::AuthNoChallenge => Some(AuthState::Locked),
        Status::AuthNotConfigured => Some(AuthState::Open),
        Status::CredentialInvalid => Some(AuthState::CredentialInvalid),
        _ => None,
    }
}

#[tauri::command]
pub async fn get_settings(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ClientSettings, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        Ok(state.client_settings())
    })
    .await
}

#[tauri::command]
pub async fn set_settings(
    timeout_ms: u64,
    retries: usize,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ClientSettings, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.set_client_settings(timeout_ms, retries)
    })
    .await
}

#[tauri::command]
pub async fn list_devices(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<DeviceCandidate>, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        // Even a failed refresh must not leave an old opaque ID usable.
        state.invalidate_candidates();
        let api = new_hid_api().map_err(CommandError::from)?;
        let records = enumerate_devices(&api);
        Ok(state.refresh_records(records))
    })
    .await
}

#[tauri::command]
pub async fn connect_device(
    opaque_id: String,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ConnectionState, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.connect(&opaque_id)
    })
    .await
}

#[tauri::command]
pub async fn disconnect_device(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.disconnect();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_connection(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ConnectionState, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        Ok(state.connection_state())
    })
    .await
}

#[tauri::command]
pub async fn refresh_auth_state(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<AuthState, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.refresh_auth_state()
    })
    .await
}

#[tauri::command]
pub async fn authenticate(
    password: String,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<AuthState, CommandError> {
    // Wrap the command-owned password before entering the blocking task. It
    // is never logged, serialized, persisted, or included in an error.
    let password = Zeroizing::new(password);
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.authenticate(password.as_str())
    })
    .await
}

#[tauri::command]
pub async fn set_password(
    password: String,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<AuthState, CommandError> {
    let password = Zeroizing::new(password);
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.set_password(password.as_str())
    })
    .await
}

#[tauri::command]
pub async fn lock_device(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<AuthState, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.lock()
    })
    .await
}

#[tauri::command]
pub async fn list_slots(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<SlotMetadata>, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.list_slots()
    })
    .await
}

#[tauri::command]
pub async fn get_slot(
    slot: u8,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<u8>, CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.get_slot(slot)
    })
    .await
}

#[tauri::command]
pub async fn set_slot(
    slot: u8,
    text: String,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.set_slot(slot, &text)
    })
    .await
}

#[tauri::command]
pub async fn clear_slot(
    slot: u8,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), CommandError> {
    let state = Arc::clone(state.inner());
    run_on_hid_worker(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.clear_slot(slot)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hid::DeviceSummary;
    use crate::protocol::Status;
    use std::sync::{Arc, Mutex as StdMutex};

    type SetCall = (u8, Vec<u8>);
    type SetCalls = Arc<StdMutex<Vec<SetCall>>>;

    fn record(path: &[u8], usage_page: u16, usage: u16, interface_number: i32) -> DeviceRecord {
        record_with_transport(path, usage_page, usage, interface_number, true)
    }

    fn record_with_transport(
        path: &[u8],
        usage_page: u16,
        usage: u16,
        interface_number: i32,
        usb: bool,
    ) -> DeviceRecord {
        DeviceRecord::for_test_with_transport(
            path,
            DeviceSummary {
                vendor_id: 0x1234,
                product_id: 0x5678,
                product_name: Some("Example Keyboard".to_string()),
                interface_number,
                usage_page,
                usage,
            },
            usb,
        )
    }

    #[derive(Clone)]
    struct FakeFactory {
        list_result: Result<Vec<SlotInfo>, ClientError>,
        get_result: Result<Vec<u8>, ClientError>,
        set_result: Result<(), ClientError>,
        clear_result: Result<(), ClientError>,
        auth_info_result: Result<AuthInfo, ClientError>,
        auth_info_followup_result: Option<Result<AuthInfo, ClientError>>,
        authenticate_result: Result<(), ClientError>,
        password_result: Result<(), ClientError>,
        lock_result: Result<(), ClientError>,
        open_error: Option<DeviceDiscoveryError>,
        open_count: Arc<StdMutex<usize>>,
        open_configs: Arc<StdMutex<Vec<ClientConfig>>>,
        list_calls: Arc<StdMutex<usize>>,
        auth_info_calls: Arc<StdMutex<usize>>,
        lock_calls: Arc<StdMutex<usize>>,
        get_calls: Arc<StdMutex<Vec<u8>>>,
        set_calls: SetCalls,
        clear_calls: Arc<StdMutex<Vec<u8>>>,
    }

    struct FakeSession {
        list_result: Result<Vec<SlotInfo>, ClientError>,
        get_result: Result<Vec<u8>, ClientError>,
        set_result: Result<(), ClientError>,
        clear_result: Result<(), ClientError>,
        auth_info_result: Result<AuthInfo, ClientError>,
        auth_info_followup_result: Option<Result<AuthInfo, ClientError>>,
        authenticate_result: Result<(), ClientError>,
        password_result: Result<(), ClientError>,
        lock_result: Result<(), ClientError>,
        list_count: Arc<StdMutex<usize>>,
        auth_info_calls: Arc<StdMutex<usize>>,
        lock_calls: Arc<StdMutex<usize>>,
        get_calls: Arc<StdMutex<Vec<u8>>>,
        set_calls: SetCalls,
        clear_calls: Arc<StdMutex<Vec<u8>>>,
    }

    impl MacroSession for FakeSession {
        fn list_slots(&mut self) -> Result<Vec<SlotInfo>, ClientError> {
            *self.list_count.lock().unwrap() += 1;
            self.list_result.clone()
        }

        fn get_slot(&mut self, slot: u8) -> Result<Vec<u8>, ClientError> {
            self.get_calls.lock().unwrap().push(slot);
            self.get_result.clone()
        }

        fn set_slot(&mut self, slot: u8, data: &[u8]) -> Result<(), ClientError> {
            self.set_calls.lock().unwrap().push((slot, data.to_vec()));
            self.set_result.clone()
        }

        fn clear_slot(&mut self, slot: u8) -> Result<(), ClientError> {
            self.clear_calls.lock().unwrap().push(slot);
            self.clear_result.clone()
        }

        fn auth_info(&mut self) -> Result<AuthInfo, ClientError> {
            let mut calls = self.auth_info_calls.lock().unwrap();
            *calls += 1;
            if *calls > 1 {
                if let Some(result) = &self.auth_info_followup_result {
                    return result.clone();
                }
            }
            self.auth_info_result.clone()
        }

        fn authenticate(&mut self, _password: &str) -> Result<(), ClientError> {
            self.authenticate_result.clone()
        }

        fn set_password(&mut self, _password: &str) -> Result<(), ClientError> {
            self.password_result.clone()
        }

        fn lock(&mut self) -> Result<(), ClientError> {
            *self.lock_calls.lock().unwrap() += 1;
            self.lock_result.clone()
        }
    }

    impl SessionFactory for FakeFactory {
        fn open(
            &mut self,
            _record: &DeviceRecord,
            config: ClientConfig,
        ) -> Result<Box<dyn MacroSession>, DeviceDiscoveryError> {
            self.open_configs.lock().unwrap().push(config);
            *self.open_count.lock().unwrap() += 1;
            if let Some(error) = &self.open_error {
                return Err(error.clone());
            }
            Ok(Box::new(FakeSession {
                list_result: self.list_result.clone(),
                get_result: self.get_result.clone(),
                set_result: self.set_result.clone(),
                clear_result: self.clear_result.clone(),
                auth_info_result: self.auth_info_result.clone(),
                auth_info_followup_result: self.auth_info_followup_result.clone(),
                authenticate_result: self.authenticate_result.clone(),
                password_result: self.password_result.clone(),
                lock_result: self.lock_result.clone(),
                list_count: Arc::clone(&self.list_calls),
                auth_info_calls: Arc::clone(&self.auth_info_calls),
                lock_calls: Arc::clone(&self.lock_calls),
                get_calls: Arc::clone(&self.get_calls),
                set_calls: Arc::clone(&self.set_calls),
                clear_calls: Arc::clone(&self.clear_calls),
            }))
        }
    }

    fn factory(slots: Result<Vec<SlotInfo>, ClientError>) -> (FakeFactory, Arc<StdMutex<usize>>) {
        let count = Arc::new(StdMutex::new(0));
        (
            FakeFactory {
                list_result: slots,
                get_result: Ok(Vec::new()),
                set_result: Ok(()),
                clear_result: Ok(()),
                auth_info_result: Ok(AuthInfo {
                    password_configured: false,
                    session_authenticated: false,
                    kdf_id: crate::auth::KDF_ID,
                    iterations: crate::auth::DEFAULT_ITERATIONS,
                    salt: [0; crate::auth::SALT_SIZE],
                }),
                auth_info_followup_result: None,
                authenticate_result: Ok(()),
                password_result: Ok(()),
                lock_result: Ok(()),
                open_error: None,
                open_count: Arc::clone(&count),
                open_configs: Arc::new(StdMutex::new(Vec::new())),
                list_calls: Arc::new(StdMutex::new(0)),
                auth_info_calls: Arc::new(StdMutex::new(0)),
                lock_calls: Arc::new(StdMutex::new(0)),
                get_calls: Arc::new(StdMutex::new(Vec::new())),
                set_calls: Arc::new(StdMutex::new(Vec::new())),
                clear_calls: Arc::new(StdMutex::new(Vec::new())),
            },
            count,
        )
    }

    #[test]
    fn settings_have_defaults_and_are_rejected_outside_safe_bounds() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        assert_eq!(
            state.client_settings(),
            ClientSettings {
                timeout_ms: crate::client::DEFAULT_TIMEOUT_MS,
                retries: crate::client::DEFAULT_RETRIES,
                applies_next_connection: true,
            }
        );
        assert!(state.set_client_settings(100, 0).is_ok());
        assert_eq!(state.client_settings().timeout_ms, 100);
        assert_eq!(state.client_settings().retries, 0);
        assert!(state.set_client_settings(99, 0).is_err());
        assert!(state.set_client_settings(5_001, 0).is_err());
        assert!(state.set_client_settings(1_000, 6).is_err());
    }

    #[test]
    fn settings_apply_to_the_next_connection_without_replacing_live_session() {
        let (factory, _) = factory(Ok(vec![SlotInfo { slot: 0, length: 0 }]));
        let mut state = AppState::new(factory);
        let candidates = state.refresh_records(vec![record(
            b"configurable",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            1,
        )]);
        state.set_client_settings(250, 3).unwrap();
        state.connect(&candidates[0].id).unwrap();
        assert_eq!(
            state.factory.open_configs.lock().unwrap().as_slice(),
            &[ClientConfig {
                timeout_ms: 250,
                retries: 3,
            }]
        );
        assert!(state.connection_state().connected);
        state.set_client_settings(500, 1).unwrap();
        assert!(state.connection_state().connected);
        assert_eq!(state.client_settings().timeout_ms, 500);
        state.connect(&candidates[0].id).unwrap();
        assert_eq!(
            state.factory.open_configs.lock().unwrap().as_slice(),
            &[
                ClientConfig {
                    timeout_ms: 250,
                    retries: 3,
                },
                ClientConfig {
                    timeout_ms: 500,
                    retries: 1,
                },
            ]
        );
    }

    #[test]
    fn exact_usage_is_preferred_and_known_wrong_usage_is_excluded() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        let devices = state.refresh_records(vec![
            record(b"display", RUNTIME_MACRO_USAGE_PAGE, RUNTIME_MACRO_USAGE, 1),
            record(b"runtime", RUNTIME_MACRO_USAGE_PAGE, RUNTIME_MACRO_USAGE, 2),
            record(b"wrong", 0xff60, 0x62, 3),
            record(b"missing", 0, 0, 4),
        ]);
        assert_eq!(devices.len(), 2);
        assert!(devices.iter().all(|device| {
            device.usage_metadata == UsageMetadataStatus::Exact
                && device.usage_page == RUNTIME_MACRO_USAGE_PAGE
                && device.usage == RUNTIME_MACRO_USAGE
        }));
        assert_ne!(devices[0].interface_number, devices[1].interface_number);
    }

    #[test]
    fn missing_usage_is_not_exposed_by_desktop_registry() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        let devices = state.refresh_records(vec![
            record(b"wrong", 0xff60, 0x62, 1),
            record(b"bluetooth-keyboard-a", 0, 0, 2),
            record(b"bluetooth-keyboard-b", 0, 0, 3),
            record_with_transport(
                b"bluetooth-runtime-macro",
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                4,
                false,
            ),
        ]);
        assert!(devices.is_empty());
    }

    #[test]
    fn multiple_exact_candidates_are_not_guessed_and_ids_are_not_paths() {
        let (factory, open_count) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        let devices = state.refresh_records(vec![
            record(
                b"private-example-a",
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                1,
            ),
            record(
                b"private-example-b",
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                2,
            ),
        ]);
        assert_eq!(devices.len(), 2);
        assert!(devices
            .iter()
            .all(|device| !device.id.contains("private-example-a")
                && !device.id.contains("private-example-b")));
        assert_eq!(*open_count.lock().unwrap(), 0);
    }

    #[test]
    fn refresh_invalidates_old_ids() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        let first = state.refresh_records(vec![record(
            b"old",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            1,
        )]);
        let old_id = first[0].id.clone();
        let second = state.refresh_records(vec![record(
            b"new",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            1,
        )]);
        assert_ne!(old_id, second[0].id);
        assert_eq!(
            state.connect(&old_id),
            Err(CommandError::candidate_not_found())
        );
    }

    #[test]
    fn connect_installs_session_only_after_auth_info_succeeds() {
        let (factory, count) = factory(Ok(vec![SlotInfo {
            slot: 0,
            length: 12,
        }]));
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"connectable",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        let connection = state.connect(&candidate.id).unwrap();
        assert!(connection.connected);
        assert_eq!(state.connection_state(), connection);
        assert_eq!(*count.lock().unwrap(), 1);
    }

    #[test]
    fn auth_state_dto_is_minimal_and_stable() {
        assert_eq!(
            serde_json::to_string(&AuthState::Disconnected).unwrap(),
            "\"disconnected\""
        );
        assert_eq!(serde_json::to_string(&AuthState::Open).unwrap(), "\"open\"");
        assert_eq!(
            serde_json::to_string(&AuthState::Locked).unwrap(),
            "\"locked\""
        );
        assert_eq!(
            serde_json::to_string(&AuthState::Authenticated).unwrap(),
            "\"authenticated\""
        );
        assert_eq!(
            serde_json::to_string(&AuthState::CredentialInvalid).unwrap(),
            "\"credentialInvalid\""
        );

        let state = ConnectionState {
            connected: true,
            device: None,
            auth_state: AuthState::Authenticated,
        };
        let serialized = serde_json::to_string(&state).unwrap();
        assert!(serialized.contains("\"authState\":\"authenticated\""));
        assert!(!serialized.contains("salt"));
        assert!(!serialized.contains("iterations"));
        assert!(!serialized.contains("kdf"));
    }

    #[test]
    fn connect_probes_auth_info_before_any_macro_list() {
        let (mut factory, _) = factory(Err(ClientError::Transport(TransportError::Fatal(
            "private list detail".to_string(),
        ))));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: false,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5a; crate::auth::SALT_SIZE],
        });
        let list_calls = Arc::clone(&factory.list_calls);
        let auth_info_calls = Arc::clone(&factory.auth_info_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"auth-first",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();

        let connection = state.connect(&candidate.id).unwrap();
        assert_eq!(connection.auth_state, AuthState::Locked);
        assert_eq!(*auth_info_calls.lock().unwrap(), 1);
        assert_eq!(*list_calls.lock().unwrap(), 0);
    }

    #[test]
    fn bad_version_rejects_connection_without_v1_list_fallback() {
        let (mut factory, _) = factory(Ok(vec![SlotInfo { slot: 0, length: 1 }]));
        factory.auth_info_result = Err(ClientError::Remote(Status::BadVersion));
        let list_calls = Arc::clone(&factory.list_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"legacy",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();

        assert_eq!(
            state.connect(&candidate.id),
            Err(CommandError::from(ClientError::Remote(Status::BadVersion)))
        );
        assert_eq!(*list_calls.lock().unwrap(), 0);
        assert_eq!(state.connection_state().auth_state, AuthState::Disconnected);
    }

    #[test]
    fn authentication_gate_failures_keep_connection_and_lock_state() {
        for status in [
            Status::AuthFailed,
            Status::RateLimited,
            Status::AuthNoChallenge,
        ] {
            let (mut factory, _) = factory(Ok(Vec::new()));
            factory.auth_info_result = Ok(AuthInfo {
                password_configured: true,
                session_authenticated: false,
                kdf_id: crate::auth::KDF_ID,
                iterations: crate::auth::DEFAULT_ITERATIONS,
                salt: [0x5b; crate::auth::SALT_SIZE],
            });
            factory.authenticate_result = Err(ClientError::Remote(status));
            let mut state = AppState::new(factory);
            let candidate = state.refresh_records(vec![record(
                b"auth-failure",
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                2,
            )])[0]
                .clone();
            state.connect(&candidate.id).unwrap();

            assert_eq!(
                state.authenticate("input"),
                Err(CommandError::from(ClientError::Remote(status)))
            );
            assert_eq!(state.connection_state().auth_state, AuthState::Locked);
            assert!(state.connection_state().connected);
        }
    }

    #[test]
    fn refresh_auth_state_updates_public_state_without_exposing_auth_info() {
        let (mut factory, _) = factory(Ok(Vec::new()));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: false,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5f; crate::auth::SALT_SIZE],
        });
        factory.auth_info_followup_result =
            Some(Err(ClientError::Remote(Status::CredentialInvalid)));
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"auth-refresh",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        state.connect(&candidate.id).unwrap();

        assert_eq!(
            state.refresh_auth_state(),
            Err(CommandError::from(ClientError::Remote(
                Status::CredentialInvalid
            )))
        );
        assert_eq!(
            state.connection_state().auth_state,
            AuthState::CredentialInvalid
        );
        assert!(state.connection_state().connected);
    }

    #[test]
    fn locked_management_access_gate_blocks_macro_operations() {
        let (mut factory, _) = factory(Ok(vec![SlotInfo { slot: 0, length: 1 }]));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: false,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5c; crate::auth::SALT_SIZE],
        });
        let list_calls = Arc::clone(&factory.list_calls);
        let get_calls = Arc::clone(&factory.get_calls);
        let set_calls = Arc::clone(&factory.set_calls);
        let clear_calls = Arc::clone(&factory.clear_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"auth-required",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        state.connect(&candidate.id).unwrap();

        assert_eq!(
            state.list_slots(),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired
            )))
        );
        assert_eq!(
            state.get_slot(0),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired
            )))
        );
        assert_eq!(
            state.set_slot(0, "input"),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired
            )))
        );
        assert_eq!(
            state.clear_slot(0),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired
            )))
        );
        assert_eq!(state.connection_state().auth_state, AuthState::Locked);
        assert!(state.connection_state().connected);
        assert_eq!(*list_calls.lock().unwrap(), 0);
        assert!(get_calls.lock().unwrap().is_empty());
        assert!(set_calls.lock().unwrap().is_empty());
        assert!(clear_calls.lock().unwrap().is_empty());
    }

    #[test]
    fn expired_authenticated_session_keeps_connection_and_locks_after_list() {
        let (mut factory, _) = factory(Err(ClientError::Remote(Status::AuthRequired)));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x60; crate::auth::SALT_SIZE],
        });
        let list_calls = Arc::clone(&factory.list_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"expired-list",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        let connected = state.connect(&candidate.id).unwrap();
        assert_eq!(connected.auth_state, AuthState::Authenticated);

        assert_eq!(
            state.list_slots(),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired
            )))
        );
        assert_eq!(*list_calls.lock().unwrap(), 1);
        assert_eq!(state.connection_state().auth_state, AuthState::Locked);
        assert!(state.connection_state().connected);
    }

    #[test]
    fn expired_authenticated_session_keeps_connection_and_locks_after_get() {
        let (mut factory, _) = factory(Ok(Vec::new()));
        factory.get_result = Err(ClientError::Remote(Status::AuthRequired));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x61; crate::auth::SALT_SIZE],
        });
        let get_calls = Arc::clone(&factory.get_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"expired-get",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        state.connect(&candidate.id).unwrap();

        assert_eq!(
            state.get_slot(0),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthRequired
            )))
        );
        assert_eq!(get_calls.lock().unwrap().as_slice(), &[0]);
        assert_eq!(state.connection_state().auth_state, AuthState::Locked);
        assert!(state.connection_state().connected);
    }

    #[test]
    fn locked_connection_can_authenticate_and_become_authenticated() {
        let (mut factory, _) = factory(Ok(Vec::new()));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: false,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x62; crate::auth::SALT_SIZE],
        });
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"unlock",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        state.connect(&candidate.id).unwrap();
        assert_eq!(state.connection_state().auth_state, AuthState::Locked);

        assert_eq!(state.authenticate("input"), Ok(AuthState::Authenticated));
        assert_eq!(
            state.connection_state().auth_state,
            AuthState::Authenticated
        );
        assert!(state.connection_state().connected);
    }

    #[test]
    fn password_set_success_locks_and_storage_error_preserves_auth_state() {
        let (mut success_factory, _) = factory(Ok(Vec::new()));
        success_factory.password_result = Ok(());
        let mut success_state = AppState::new(success_factory);
        let candidate = success_state.refresh_records(vec![record(
            b"password-success",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        success_state.connect(&candidate.id).unwrap();
        assert_eq!(success_state.set_password("input"), Ok(AuthState::Locked));
        assert_eq!(
            success_state.connection_state().auth_state,
            AuthState::Locked
        );
        assert!(success_state.connection_state().connected);

        let (mut storage_factory, _) = factory(Ok(Vec::new()));
        storage_factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5d; crate::auth::SALT_SIZE],
        });
        storage_factory.password_result = Err(ClientError::Remote(Status::StorageError));
        let mut storage_state = AppState::new(storage_factory);
        let candidate = storage_state.refresh_records(vec![record(
            b"password-storage",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        storage_state.connect(&candidate.id).unwrap();
        assert_eq!(
            storage_state.connection_state().auth_state,
            AuthState::Authenticated
        );
        assert_eq!(
            storage_state.set_password("input"),
            Err(CommandError::from(ClientError::Remote(
                Status::StorageError
            )))
        );
        assert_eq!(
            storage_state.connection_state().auth_state,
            AuthState::Authenticated
        );
        assert!(storage_state.connection_state().connected);

        let (mut rejected_factory, _) = factory(Ok(Vec::new()));
        rejected_factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5e; crate::auth::SALT_SIZE],
        });
        rejected_factory.auth_info_followup_result = Some(Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5e; crate::auth::SALT_SIZE],
        }));
        rejected_factory.password_result = Err(ClientError::Remote(Status::CredentialInvalid));
        let rejected_auth_info_calls = Arc::clone(&rejected_factory.auth_info_calls);
        let mut rejected_state = AppState::new(rejected_factory);
        let candidate = rejected_state.refresh_records(vec![record(
            b"password-invalid-old-valid",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        rejected_state.connect(&candidate.id).unwrap();
        assert_eq!(
            rejected_state.set_password("input"),
            Err(CommandError::from(ClientError::Remote(
                Status::CredentialInvalid
            )))
        );
        assert_eq!(*rejected_auth_info_calls.lock().unwrap(), 2);
        assert_eq!(
            rejected_state.connection_state().auth_state,
            AuthState::Authenticated
        );
        assert!(rejected_state.connection_state().connected);

        let (mut damaged_factory, _) = factory(Ok(Vec::new()));
        damaged_factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x5f; crate::auth::SALT_SIZE],
        });
        damaged_factory.auth_info_followup_result =
            Some(Err(ClientError::Remote(Status::CredentialInvalid)));
        damaged_factory.password_result = Err(ClientError::Remote(Status::CredentialInvalid));
        let mut damaged_state = AppState::new(damaged_factory);
        let candidate = damaged_state.refresh_records(vec![record(
            b"password-invalid-damaged",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        damaged_state.connect(&candidate.id).unwrap();
        assert_eq!(
            damaged_state.set_password("input"),
            Err(CommandError::from(ClientError::Remote(
                Status::CredentialInvalid
            )))
        );
        assert_eq!(
            damaged_state.connection_state().auth_state,
            AuthState::CredentialInvalid
        );
        assert!(damaged_state.connection_state().connected);
    }

    #[test]
    fn lock_is_local_first_and_disconnect_or_switch_best_effort_lock() {
        let (mut factory, _) = factory(Ok(Vec::new()));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x63; crate::auth::SALT_SIZE],
        });
        factory.lock_result = Err(ClientError::Transport(TransportError::Timeout));
        let lock_calls = Arc::clone(&factory.lock_calls);
        let mut state = AppState::new(factory);
        let candidates = state.refresh_records(vec![
            record(b"first", RUNTIME_MACRO_USAGE_PAGE, RUNTIME_MACRO_USAGE, 1),
            record(b"second", RUNTIME_MACRO_USAGE_PAGE, RUNTIME_MACRO_USAGE, 2),
        ]);
        state.connect(&candidates[0].id).unwrap();

        assert_eq!(
            state.lock(),
            Err(CommandError::from(ClientError::Transport(
                TransportError::Timeout
            )))
        );
        assert_eq!(state.connection_state().auth_state, AuthState::Locked);
        assert!(state.connection_state().connected);

        state.connect(&candidates[1].id).unwrap();
        assert_eq!(*lock_calls.lock().unwrap(), 2);
        assert!(state.connection_state().connected);
        state.disconnect();
        assert_eq!(*lock_calls.lock().unwrap(), 3);
        assert_eq!(state.connection_state().auth_state, AuthState::Disconnected);
    }

    #[test]
    fn dropping_connected_state_attempts_best_effort_lock() {
        let (mut factory, _) = factory(Ok(Vec::new()));
        factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x65; crate::auth::SALT_SIZE],
        });
        let lock_calls = Arc::clone(&factory.lock_calls);
        {
            let mut state = AppState::new(factory);
            let candidate = state.refresh_records(vec![record(
                b"drop-lock",
                RUNTIME_MACRO_USAGE_PAGE,
                RUNTIME_MACRO_USAGE,
                2,
            )])[0]
                .clone();
            state.connect(&candidate.id).unwrap();
            assert!(state.connection_state().connected);
        }
        assert_eq!(*lock_calls.lock().unwrap(), 1);
    }

    #[test]
    fn lock_restores_open_and_credential_invalid_states_from_remote_statuses() {
        let (mut open_factory, _) = factory(Ok(Vec::new()));
        open_factory.lock_result = Err(ClientError::Remote(Status::AuthNotConfigured));
        let mut open_state = AppState::new(open_factory);
        let candidate = open_state.refresh_records(vec![record(
            b"lock-open",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        open_state.connect(&candidate.id).unwrap();
        assert_eq!(open_state.connection_state().auth_state, AuthState::Open);
        assert_eq!(
            open_state.lock(),
            Err(CommandError::from(ClientError::Remote(
                Status::AuthNotConfigured
            )))
        );
        assert_eq!(open_state.connection_state().auth_state, AuthState::Open);
        assert!(open_state.connection_state().connected);

        let (mut credential_factory, _) = factory(Ok(Vec::new()));
        credential_factory.auth_info_result = Ok(AuthInfo {
            password_configured: true,
            session_authenticated: true,
            kdf_id: crate::auth::KDF_ID,
            iterations: crate::auth::DEFAULT_ITERATIONS,
            salt: [0x64; crate::auth::SALT_SIZE],
        });
        credential_factory.auth_info_followup_result =
            Some(Err(ClientError::Remote(Status::CredentialInvalid)));
        credential_factory.lock_result = Err(ClientError::Remote(Status::CredentialInvalid));
        let mut credential_state = AppState::new(credential_factory);
        let candidate = credential_state.refresh_records(vec![record(
            b"lock-credential-invalid",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        credential_state.connect(&candidate.id).unwrap();
        assert_eq!(
            credential_state.refresh_auth_state(),
            Err(CommandError::from(ClientError::Remote(
                Status::CredentialInvalid
            )))
        );
        assert_eq!(
            credential_state.connection_state().auth_state,
            AuthState::CredentialInvalid
        );
        assert_eq!(
            credential_state.lock(),
            Err(CommandError::from(ClientError::Remote(
                Status::CredentialInvalid
            )))
        );
        assert_eq!(
            credential_state.connection_state().auth_state,
            AuthState::CredentialInvalid
        );
        assert!(credential_state.connection_state().connected);
    }

    #[test]
    fn failed_replacement_connection_drops_existing_session() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        let candidates = state.refresh_records(vec![
            record(b"first", RUNTIME_MACRO_USAGE_PAGE, RUNTIME_MACRO_USAGE, 1),
            record(b"second", RUNTIME_MACRO_USAGE_PAGE, RUNTIME_MACRO_USAGE, 2),
        ]);
        state.connect(&candidates[0].id).unwrap();
        assert!(state.connection_state().connected);

        state.factory.open_error = Some(DeviceDiscoveryError::OpenFailed);
        let error = state.connect(&candidates[1].id).unwrap_err();
        assert_eq!(error, CommandError::from(DeviceDiscoveryError::OpenFailed));
        assert_eq!(
            state.connection_state(),
            ConnectionState {
                connected: false,
                device: None,
                auth_state: AuthState::Disconnected,
            }
        );
    }

    #[test]
    fn auth_info_failure_does_not_leave_a_session_and_errors_are_sanitized() {
        let (mut factory, _) = factory(Ok(Vec::new()));
        factory.auth_info_result = Err(ClientError::Transport(TransportError::Fatal(
            "private backend detail".to_string(),
        )));
        let lock_calls = Arc::clone(&factory.lock_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"failure",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        let error = state.connect(&candidate.id).unwrap_err();
        assert_eq!(error.code, "transport_error");
        assert_eq!(error.message, "Communication with the HID device failed.");
        assert!(!error.message.contains("private backend detail"));
        assert!(!state.connection_state().connected);
        assert_eq!(*lock_calls.lock().unwrap(), 1);
    }

    #[test]
    fn list_slots_is_dynamic_and_disconnect_is_idempotent() {
        let (factory, _) = factory(Ok(vec![
            SlotInfo {
                slot: 0,
                length: 12,
            },
            SlotInfo { slot: 1, length: 0 },
            SlotInfo {
                slot: 2,
                length: 23,
            },
        ]));
        let mut state = AppState::new(factory);
        assert_eq!(state.list_slots(), Err(CommandError::not_connected()));
        let candidate = state.refresh_records(vec![record(
            b"slots",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        state.connect(&candidate.id).unwrap();
        assert_eq!(
            state.list_slots().unwrap(),
            vec![
                SlotMetadata {
                    slot: 0,
                    length: 12
                },
                SlotMetadata { slot: 1, length: 0 },
                SlotMetadata {
                    slot: 2,
                    length: 23
                },
            ]
        );
        state.disconnect();
        state.disconnect();
        assert!(!state.connection_state().connected);
    }

    #[test]
    fn get_set_and_clear_forward_slot_and_fixture_bytes() {
        let (mut factory, _) = factory(Ok(vec![SlotInfo {
            slot: 4,
            length: 12,
        }]));
        factory.get_result = Ok(b"fixture-text".to_vec());
        factory.set_result = Ok(());
        factory.clear_result = Ok(());
        let get_calls = Arc::clone(&factory.get_calls);
        let set_calls = Arc::clone(&factory.set_calls);
        let clear_calls = Arc::clone(&factory.clear_calls);
        let mut state = AppState::new(factory);
        let candidate = state.refresh_records(vec![record(
            b"editor",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        state.connect(&candidate.id).unwrap();

        assert_eq!(state.get_slot(4).unwrap(), b"fixture-text");
        state.set_slot(4, "next-fixture\n").unwrap();
        state.clear_slot(4).unwrap();

        assert_eq!(*get_calls.lock().unwrap(), vec![4]);
        assert_eq!(
            *set_calls.lock().unwrap(),
            vec![(4, b"next-fixture\n".to_vec())]
        );
        assert_eq!(*clear_calls.lock().unwrap(), vec![4]);
        assert!(state.connection_state().connected);
    }

    #[test]
    fn transport_failure_drops_but_remote_status_preserves_the_session() {
        let (mut get_factory, _) = factory(Ok(Vec::new()));
        get_factory.get_result = Err(ClientError::Transport(TransportError::Fatal(
            "private fixture backend detail".to_string(),
        )));
        let mut get_state = AppState::new(get_factory);
        let get_candidate = get_state.refresh_records(vec![record(
            b"get-failure",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        get_state.connect(&get_candidate.id).unwrap();
        let get_error = get_state.get_slot(0).unwrap_err();
        assert_eq!(get_error.code, "transport_error");
        assert!(!get_error.message.contains("private fixture backend detail"));
        assert!(!get_state.connection_state().connected);

        let (mut set_factory, _) = factory(Ok(Vec::new()));
        set_factory.set_result = Err(ClientError::Remote(Status::StorageError));
        let mut set_state = AppState::new(set_factory);
        let set_candidate = set_state.refresh_records(vec![record(
            b"set-failure",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        set_state.connect(&set_candidate.id).unwrap();
        assert_eq!(
            set_state.set_slot(0, "fixture").unwrap_err().code,
            "storage_error"
        );
        assert!(set_state.connection_state().connected);

        let (mut clear_factory, _) = factory(Ok(Vec::new()));
        clear_factory.clear_result = Err(ClientError::Remote(Status::BadSlot));
        let mut clear_state = AppState::new(clear_factory);
        let clear_candidate = clear_state.refresh_records(vec![record(
            b"clear-failure",
            RUNTIME_MACRO_USAGE_PAGE,
            RUNTIME_MACRO_USAGE,
            2,
        )])[0]
            .clone();
        clear_state.connect(&clear_candidate.id).unwrap();
        assert_eq!(clear_state.clear_slot(0).unwrap_err().code, "bad_slot");
        assert!(clear_state.connection_state().connected);
    }

    #[test]
    fn authentication_errors_map_without_secret_material() {
        let auth_errors = [
            (crate::error::AuthError::EmptyPassword, "empty_password"),
            (
                crate::error::AuthError::InvalidIterations,
                "invalid_authentication_input",
            ),
            (
                crate::error::AuthError::InvalidSalt,
                "invalid_authentication_input",
            ),
            (
                crate::error::AuthError::InvalidDerivedKey,
                "invalid_authentication_input",
            ),
            (
                crate::error::AuthError::InvalidNonce,
                "invalid_authentication_input",
            ),
            (
                crate::error::AuthError::RandomnessUnavailable,
                "randomness_unavailable",
            ),
        ];
        for (error, expected_code) in auth_errors {
            let mapped = CommandError::from(ClientError::Auth(error));
            assert_eq!(mapped.code, expected_code);
            assert!(!mapped.message.contains("fixture-password"));
            assert!(!mapped.message.contains("proof"));
            assert!(!mapped.message.contains("nonce"));
            let serialized = serde_json::to_string(&mapped).unwrap();
            assert!(!serialized.contains("fixture-password"));
        }

        for (status, expected_code) in [
            (Status::AuthRequired, "auth_required"),
            (Status::AuthFailed, "auth_failed"),
            (Status::AuthNotConfigured, "auth_not_configured"),
            (Status::RateLimited, "rate_limited"),
            (Status::AuthNoChallenge, "auth_no_challenge"),
            (Status::CredentialInvalid, "credential_invalid"),
        ] {
            assert_eq!(
                CommandError::from(ClientError::Remote(status)).code,
                expected_code
            );
        }
    }

    #[test]
    fn editor_operations_without_a_connection_return_a_stable_error() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        assert_eq!(
            state.get_slot(0).unwrap_err(),
            CommandError::not_connected()
        );
        assert_eq!(
            state.set_slot(0, "fixture").unwrap_err(),
            CommandError::not_connected()
        );
        assert_eq!(
            state.clear_slot(0).unwrap_err(),
            CommandError::not_connected()
        );
    }

    #[test]
    fn client_settings_serialize_with_camel_case_fields() {
        let settings = ClientSettings {
            timeout_ms: 250,
            retries: 3,
            applies_next_connection: true,
        };
        assert_eq!(
            serde_json::to_string(&settings).unwrap(),
            r#"{"timeoutMs":250,"retries":3,"appliesNextConnection":true}"#
        );
    }

    #[test]
    fn command_error_serializes_stably_without_backend_details() {
        let error = CommandError::from(ClientError::Remote(Status::StorageError));
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"code":"storage_error","message":"The device could not persist its settings."}"#
        );
    }
}
