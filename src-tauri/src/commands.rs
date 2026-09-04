use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::client::{RuntimeMacroClient, SlotInfo};
use crate::error::{ClientError, TransportError};
use crate::hid::{
    enumerate_devices, new_hid_api, open_device, DeviceDiscoveryError, DeviceRecord, DeviceSummary,
    HidTransport, RUNTIME_MACRO_USAGE, RUNTIME_MACRO_USAGE_PAGE,
};

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
                "The selected HID device could not be opened.",
            ),
            DeviceDiscoveryError::InvalidPath => Self::new(
                "device_open_failed",
                "The selected HID device could not be opened.",
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub connected: bool,
    pub device: Option<ConnectedDevice>,
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
    pub fn refresh(&mut self, records: Vec<DeviceRecord>) -> Vec<DeviceCandidate> {
        self.candidates.clear();
        let has_exact = records
            .iter()
            .any(DeviceRecord::has_target_usage_for_registry);

        self.candidates = records
            .into_iter()
            .filter(|record| {
                if has_exact {
                    record.has_target_usage_for_registry()
                } else {
                    record.has_missing_usage_for_registry()
                }
            })
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
}

impl MacroSession for RuntimeMacroClient<HidTransport> {
    fn list_slots(&mut self) -> Result<Vec<SlotInfo>, ClientError> {
        RuntimeMacroClient::list_slots(self)
    }
}

pub trait SessionFactory: Send {
    fn open(
        &mut self,
        record: &DeviceRecord,
    ) -> Result<Box<dyn MacroSession>, DeviceDiscoveryError>;
}

#[derive(Default)]
pub struct HidSessionFactory;

impl SessionFactory for HidSessionFactory {
    fn open(
        &mut self,
        record: &DeviceRecord,
    ) -> Result<Box<dyn MacroSession>, DeviceDiscoveryError> {
        let api = new_hid_api()?;
        let transport = open_device(&api, record)?;
        Ok(Box::new(RuntimeMacroClient::with_defaults(transport)))
    }
}

struct ConnectedSession {
    device: ConnectedDevice,
    session: Box<dyn MacroSession>,
}

pub struct AppState<F: SessionFactory = HidSessionFactory> {
    registry: DeviceRegistry,
    connection: Option<ConnectedSession>,
    factory: F,
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
        }
    }

    pub fn invalidate_candidates(&mut self) {
        self.registry.invalidate();
    }

    pub fn refresh_records(&mut self, records: Vec<DeviceRecord>) -> Vec<DeviceCandidate> {
        self.registry.refresh(records)
    }

    pub fn connect(&mut self, opaque_id: &str) -> Result<ConnectionState, CommandError> {
        // A failed replacement attempt must never leave the previous session
        // looking connected to the frontend.
        self.connection = None;

        let record = self
            .registry
            .find(opaque_id)
            .ok_or_else(CommandError::candidate_not_found)?;
        let summary = record.summary();
        let device = connected_device(&summary);
        let mut session = self.factory.open(&record).map_err(CommandError::from)?;

        // Do not install the session until its first complete LIST succeeds.
        session.list_slots().map_err(CommandError::from)?;
        self.connection = Some(ConnectedSession { device, session });
        Ok(self.connection_state())
    }

    pub fn connection_state(&self) -> ConnectionState {
        match self.connection.as_ref() {
            Some(connection) => ConnectionState {
                connected: true,
                device: Some(connection.device.clone()),
            },
            None => ConnectionState {
                connected: false,
                device: None,
            },
        }
    }

    pub fn list_slots(&mut self) -> Result<Vec<SlotMetadata>, CommandError> {
        if self.connection.is_none() {
            return Err(CommandError::not_connected());
        }

        let result = self
            .connection
            .as_mut()
            .expect("connection was checked above")
            .session
            .list_slots();
        match result {
            Ok(slots) => Ok(slots.into_iter().map(SlotMetadata::from).collect()),
            Err(error) => {
                // A failed LIST means the current session can no longer be
                // trusted. Drop it before returning the sanitized error.
                self.connection = None;
                Err(CommandError::from(error))
            }
        }
    }

    pub fn disconnect(&mut self) {
        self.connection = None;
    }
}

#[tauri::command]
pub async fn list_devices(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<DeviceCandidate>, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|_| CommandError::state_unavailable())?
}

#[tauri::command]
pub async fn connect_device(
    opaque_id: String,
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ConnectionState, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.connect(&opaque_id)
    })
    .await
    .map_err(|_| CommandError::state_unavailable())?
}

#[tauri::command]
pub async fn disconnect_device(state: State<'_, Arc<Mutex<AppState>>>) -> Result<(), CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.disconnect();
        Ok(())
    })
    .await
    .map_err(|_| CommandError::state_unavailable())?
}

#[tauri::command]
pub async fn get_connection(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<ConnectionState, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        Ok(state.connection_state())
    })
    .await
    .map_err(|_| CommandError::state_unavailable())?
}

#[tauri::command]
pub async fn list_slots(
    state: State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<SlotMetadata>, CommandError> {
    let state = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::state_unavailable())?;
        state.list_slots()
    })
    .await
    .map_err(|_| CommandError::state_unavailable())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hid::DeviceSummary;
    use crate::protocol::Status;
    use std::sync::{Arc, Mutex as StdMutex};

    fn record(path: &[u8], usage_page: u16, usage: u16, interface_number: i32) -> DeviceRecord {
        DeviceRecord::for_test(
            path,
            DeviceSummary {
                vendor_id: 0x1234,
                product_id: 0x5678,
                product_name: Some("Example Keyboard".to_string()),
                interface_number,
                usage_page,
                usage,
            },
        )
    }

    #[derive(Clone)]
    struct FakeFactory {
        list_result: Result<Vec<SlotInfo>, ClientError>,
        open_error: Option<DeviceDiscoveryError>,
        open_count: Arc<StdMutex<usize>>,
    }

    struct FakeSession {
        list_result: Result<Vec<SlotInfo>, ClientError>,
        list_count: Arc<StdMutex<usize>>,
    }

    impl MacroSession for FakeSession {
        fn list_slots(&mut self) -> Result<Vec<SlotInfo>, ClientError> {
            *self.list_count.lock().unwrap() += 1;
            self.list_result.clone()
        }
    }

    impl SessionFactory for FakeFactory {
        fn open(
            &mut self,
            _record: &DeviceRecord,
        ) -> Result<Box<dyn MacroSession>, DeviceDiscoveryError> {
            *self.open_count.lock().unwrap() += 1;
            if let Some(error) = &self.open_error {
                return Err(error.clone());
            }
            Ok(Box::new(FakeSession {
                list_result: self.list_result.clone(),
                list_count: Arc::clone(&self.open_count),
            }))
        }
    }

    fn factory(slots: Result<Vec<SlotInfo>, ClientError>) -> (FakeFactory, Arc<StdMutex<usize>>) {
        let count = Arc::new(StdMutex::new(0));
        (
            FakeFactory {
                list_result: slots,
                open_error: None,
                open_count: Arc::clone(&count),
            },
            count,
        )
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
    fn missing_usage_is_fallback_only_when_no_exact_candidate_exists() {
        let (factory, _) = factory(Ok(Vec::new()));
        let mut state = AppState::new(factory);
        let devices = state.refresh_records(vec![
            record(b"wrong", 0xff60, 0x62, 1),
            record(b"missing-a", 0, 0, 2),
            record(b"missing-b", 0, 0, 3),
        ]);
        assert_eq!(devices.len(), 2);
        assert!(devices
            .iter()
            .all(|device| device.usage_metadata == UsageMetadataStatus::Missing));
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
    fn connect_installs_session_only_after_list_succeeds() {
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
        assert_eq!(*count.lock().unwrap(), 2);
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
            }
        );
    }

    #[test]
    fn list_failure_does_not_leave_a_session_and_errors_are_sanitized() {
        let (factory, _) = factory(Err(ClientError::Transport(TransportError::Fatal(
            "private backend detail".to_string(),
        ))));
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
    fn command_error_serializes_stably_without_backend_details() {
        let error = CommandError::from(ClientError::Remote(Status::StorageError));
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"code":"storage_error","message":"The device could not persist its settings."}"#
        );
    }
}
