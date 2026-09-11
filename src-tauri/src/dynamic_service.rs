//! Locally observed Dynamic Macro state for the connected device.
//!
//! This module is deliberately narrow: it owns the service state and the
//! stable, body-free DTO that the Tauri bridge publishes. It performs no HID
//! I/O, opens no session, spawns no thread and keeps no queue — every command
//! already reaches the single `MacroSession` through the application state
//! mutex and the one HID worker thread.
//!
//! Boundaries that the dynamic surface as a whole keeps:
//!
//! - Dynamic commands bypass the static management/auth gate. This layer never
//!   calls, refreshes or auto-logs-in static auth and never touches static slot
//!   state.
//! - Dynamic Macro has no readback. `CommittedLocally` / `ClearedLocally` mean
//!   the device acknowledged the operation in this session; they are not proof
//!   that the device still holds the object.
//! - Dynamic text only exists inside the calling command. State and DTO keep the
//!   byte length and the requested parameters, never the text itself and never a
//!   HID path, serial number, password or raw frame.
//! - `generation` is a local last-write-wins counter. It is not a firmware
//!   value, not a protocol request id and not a device version: only the newest
//!   generation may publish state, so a completion from a superseded operation
//!   is discarded instead of overwriting newer observations.

use serde::Serialize;

use crate::protocol::DynamicCapabilities;

/// Serialized status of the Dynamic Macro service for the current session.
///
/// The values are the stable frontend contract: `unknown`, `discovering`,
/// `ready`, `unsupported`, `uploading`, `committedLocally`, `clearing`,
/// `clearedLocally` and `error`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DynamicServiceStatus {
    /// No dynamic fact was observed for the current connection.
    Unknown,
    /// A capability exchange is in flight.
    Discovering,
    /// Capability metadata is available; `uploading`/`clearing` are per-operation.
    Ready,
    /// The device rejected the dynamic protocol itself.
    Unsupported,
    /// A dynamic operation is in flight.
    Uploading,
    /// The device acknowledged the newest upload in this session.
    CommittedLocally,
    /// A clear is in flight.
    Clearing,
    /// The device acknowledged the newest clear in this session.
    ClearedLocally,
    /// The newest dynamic operation failed while the session stayed usable.
    Error,
}

/// Serialized status of the newest local observation of one object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DynamicObjectStatus {
    /// No operation for this object was observed in the current session.
    Unknown,
    Uploading,
    CommittedLocally,
    Clearing,
    ClearedLocally,
    Error,
}

/// Whether a failed dynamic operation was unsupported or an operational error.
///
/// The classification mirrors the command error mapping: only an explicit
/// protocol incompatibility (`BAD_OPCODE` / `BAD_VERSION`) is `Unsupported`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DynamicFailure {
    Unsupported,
    Error,
}

impl DynamicFailure {
    fn status(self) -> DynamicServiceStatus {
        match self {
            Self::Unsupported => DynamicServiceStatus::Unsupported,
            Self::Error => DynamicServiceStatus::Error,
        }
    }
}

/// Sanitized failure of the newest dynamic operation.
///
/// It reuses the frontend command error envelope, so it only carries a stable
/// code and a message that never contains protocol bytes, dynamic text, HID
/// paths, serial numbers or authentication material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicServiceError {
    pub code: String,
    pub message: String,
}

/// Stable, body-free capability metadata for Dynamic Protocol v2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicCapabilitiesMetadata {
    pub capability_version: u8,
    pub dynamic_object_count: u8,
    pub lifecycle_flags: u16,
    pub max_dynamic_length: u16,
    pub default_ttl_seconds: u32,
    pub min_ttl_seconds: u32,
    pub max_ttl_seconds: u32,
    pub transaction_timeout_seconds: u32,
    pub clear_on_boot: bool,
    pub clear_on_ttl_expiry: bool,
    pub clear_on_execution_accept: bool,
    pub clear_on_usb_disconnect: bool,
    pub clear_on_ble_profile_change: bool,
    pub clear_on_selected_endpoint_change: bool,
    pub supports_keep_after_execute: bool,
}

impl From<DynamicCapabilities> for DynamicCapabilitiesMetadata {
    fn from(capabilities: DynamicCapabilities) -> Self {
        Self {
            capability_version: capabilities.capability_version,
            dynamic_object_count: capabilities.dynamic_object_count,
            lifecycle_flags: capabilities.lifecycle_flags,
            max_dynamic_length: capabilities.max_dynamic_length,
            default_ttl_seconds: capabilities.default_ttl_seconds,
            min_ttl_seconds: capabilities.min_ttl_seconds,
            max_ttl_seconds: capabilities.max_ttl_seconds,
            transaction_timeout_seconds: capabilities.transaction_timeout_seconds,
            clear_on_boot: capabilities.lifecycle_flags
                & crate::protocol::DYNAMIC_LIFECYCLE_CLEAR_ON_BOOT
                != 0,
            clear_on_ttl_expiry: capabilities.lifecycle_flags
                & crate::protocol::DYNAMIC_LIFECYCLE_CLEAR_ON_TTL_EXPIRY
                != 0,
            clear_on_execution_accept: capabilities.lifecycle_flags
                & crate::protocol::DYNAMIC_LIFECYCLE_CLEAR_ON_EXECUTION_ACCEPT
                != 0,
            clear_on_usb_disconnect: capabilities.clear_on_usb_disconnect(),
            clear_on_ble_profile_change: capabilities.clear_on_ble_profile_change(),
            clear_on_selected_endpoint_change: capabilities.clear_on_selected_endpoint_change(),
            supports_keep_after_execute: capabilities.supports_keep_after_execute(),
        }
    }
}

/// Local observation of one dynamic object in the current session.
///
/// Only the byte length of the uploaded text is kept. The text itself never
/// enters the service state, and no entry is a readback of device memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicObjectObservation {
    /// Wire slot reported by `CAPABILITIES` (`0..dynamic_object_count-1`).
    pub slot: u8,
    pub status: DynamicObjectStatus,
    /// Byte length of the last uploaded object, `Some(0)` after a successful
    /// clear, `None` while nothing was observed in this session.
    pub text_length: Option<u16>,
    /// TTL requested with the last upload; `None` for the device default and
    /// after a clear.
    pub ttl_seconds: Option<u32>,
    /// `keep-after-execute` flag of the last upload.
    pub keep_after_execute: bool,
}

impl DynamicObjectObservation {
    fn unknown(slot: u8) -> Self {
        Self {
            slot,
            status: DynamicObjectStatus::Unknown,
            text_length: None,
            ttl_seconds: None,
            keep_after_execute: false,
        }
    }
}

/// Serialized Dynamic service state for the Tauri bridge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicServiceState {
    pub status: DynamicServiceStatus,
    /// Capability metadata of the current connection; `None` until a capability
    /// exchange succeeded.
    pub capabilities: Option<DynamicCapabilitiesMetadata>,
    /// Local last-write-wins counter of the newest dynamic operation. It is not
    /// firmware state: callers may only compare it for staleness, never present
    /// it as a device value.
    pub generation: u64,
    /// One entry per known object, ordered by wire slot. Capability discovery
    /// seeds the entries; an operation on an unknown slot adds its own entry.
    pub objects: Vec<DynamicObjectObservation>,
    /// Sanitized error of the newest failed operation, cleared again by the next
    /// successful one.
    pub error: Option<DynamicServiceError>,
}

/// State layer for capability, upload and clear observations.
///
/// All access is serialized by the application state mutex, so no additional
/// lock, queue or writer is needed here.
#[derive(Debug)]
pub struct DynamicService {
    status: DynamicServiceStatus,
    capabilities: Option<DynamicCapabilitiesMetadata>,
    generation: u64,
    objects: Vec<DynamicObjectObservation>,
    error: Option<DynamicServiceError>,
}

impl Default for DynamicService {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicService {
    pub fn new() -> Self {
        Self {
            status: DynamicServiceStatus::Unknown,
            capabilities: None,
            generation: 0,
            objects: Vec::new(),
            error: None,
        }
    }

    /// Snapshot for the bridge. The state is body-free by construction.
    pub fn state(&self) -> DynamicServiceState {
        DynamicServiceState {
            status: self.status,
            capabilities: self.capabilities,
            generation: self.generation,
            objects: self.objects.clone(),
            error: self.error.clone(),
        }
    }

    /// Forget every device fact: new connection, disconnect, device replacement
    /// or application shutdown. In-flight completions become stale.
    pub fn reset(&mut self) {
        self.status = DynamicServiceStatus::Unknown;
        self.capabilities = None;
        self.objects.clear();
        self.error = None;
        self.next_generation();
    }

    /// Start a capability exchange and return its generation.
    pub fn begin_capability_discovery(&mut self) -> u64 {
        let generation = self.next_generation();
        self.clear_superseded_object_statuses();
        self.status = DynamicServiceStatus::Discovering;
        self.error = None;
        generation
    }

    /// Publish validated capability metadata and seed the object collection.
    ///
    /// Observations of surviving slots are kept: they describe operations of
    /// this session, which a capability refresh does not invalidate.
    pub fn complete_capability_discovery(
        &mut self,
        generation: u64,
        capabilities: DynamicCapabilities,
    ) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        let metadata = DynamicCapabilitiesMetadata::from(capabilities);
        self.status = DynamicServiceStatus::Ready;
        self.capabilities = Some(metadata);
        self.sync_objects(metadata.dynamic_object_count);
        self.error = None;
        true
    }

    /// Record a failed capability exchange without touching object entries.
    pub fn fail_capability_discovery(
        &mut self,
        generation: u64,
        failure: DynamicFailure,
        error: DynamicServiceError,
    ) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.status = failure.status();
        self.error = Some(error);
        true
    }

    /// Start an upload for one object and return its generation.
    pub fn begin_upload(&mut self, slot: u8) -> u64 {
        let generation = self.next_generation();
        self.clear_superseded_object_statuses();
        self.status = DynamicServiceStatus::Uploading;
        self.error = None;
        self.object_mut(slot).status = DynamicObjectStatus::Uploading;
        generation
    }

    /// Record the acknowledged upload as a local observation.
    ///
    /// `text_length` is the only fact derived from the dynamic text.
    pub fn complete_upload(
        &mut self,
        generation: u64,
        slot: u8,
        text_length: u16,
        ttl_seconds: Option<u32>,
        keep_after_execute: bool,
    ) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.status = DynamicServiceStatus::CommittedLocally;
        self.error = None;
        let object = self.object_mut(slot);
        object.status = DynamicObjectStatus::CommittedLocally;
        object.text_length = Some(text_length);
        object.ttl_seconds = ttl_seconds;
        object.keep_after_execute = keep_after_execute;
        true
    }

    /// Start a clear for one object and return its generation.
    pub fn begin_clear(&mut self, slot: u8) -> u64 {
        let generation = self.next_generation();
        self.clear_superseded_object_statuses();
        self.status = DynamicServiceStatus::Clearing;
        self.error = None;
        self.object_mut(slot).status = DynamicObjectStatus::Clearing;
        generation
    }

    /// Record the acknowledged clear as a local observation.
    pub fn complete_clear(&mut self, generation: u64, slot: u8) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.status = DynamicServiceStatus::ClearedLocally;
        self.error = None;
        let object = self.object_mut(slot);
        object.status = DynamicObjectStatus::ClearedLocally;
        object.text_length = Some(0);
        object.ttl_seconds = None;
        object.keep_after_execute = false;
        true
    }

    /// Record a failed operation for one object.
    ///
    /// The previous observation of the object is not overwritten with the failed
    /// attempt: the object is a RAM object that only changes when the complete
    /// transaction succeeds.
    pub fn fail_object_operation(
        &mut self,
        generation: u64,
        slot: u8,
        failure: DynamicFailure,
        error: DynamicServiceError,
    ) -> bool {
        if !self.is_current(generation) {
            return false;
        }
        self.status = failure.status();
        self.error = Some(error);
        self.object_mut(slot).status = DynamicObjectStatus::Error;
        true
    }

    fn next_generation(&mut self) -> u64 {
        self.generation = self.generation.wrapping_add(1);
        self.generation
    }

    /// `true` while `generation` is still the newest issued operation. The
    /// initial `0` is not an issued operation, so it can never publish state.
    fn is_current(&self, generation: u64) -> bool {
        generation != 0 && generation == self.generation
    }

    /// A new operation supersedes an in-flight one, so a transient object status
    /// left behind by it must not stay visible. Confirmed observations of the
    /// object, including its byte length, are kept.
    fn clear_superseded_object_statuses(&mut self) {
        for object in &mut self.objects {
            if matches!(
                object.status,
                DynamicObjectStatus::Uploading | DynamicObjectStatus::Clearing
            ) {
                object.status = DynamicObjectStatus::Unknown;
            }
        }
    }

    /// Resize the object collection to the reported object count, keeping the
    /// observations of surviving wire slots.
    fn sync_objects(&mut self, object_count: u8) {
        let mut objects = Vec::with_capacity(object_count as usize);
        for slot in 0..object_count {
            let existing = self
                .objects
                .iter()
                .find(|object| object.slot == slot)
                .copied()
                .unwrap_or_else(|| DynamicObjectObservation::unknown(slot));
            objects.push(existing);
        }
        self.objects = objects;
    }

    /// Observation entry of one slot, created in slot order when it is unknown.
    fn object_mut(&mut self, slot: u8) -> &mut DynamicObjectObservation {
        let index = match self.objects.iter().position(|object| object.slot == slot) {
            Some(index) => index,
            None => {
                let index = self
                    .objects
                    .iter()
                    .position(|object| object.slot > slot)
                    .unwrap_or(self.objects.len());
                self.objects
                    .insert(index, DynamicObjectObservation::unknown(slot));
                index
            }
        };
        &mut self.objects[index]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        DYNAMIC_CAPABILITY_VERSION, DYNAMIC_DEFAULT_TTL_SECONDS, DYNAMIC_LIFECYCLE_CLEAR_ON_BOOT,
        DYNAMIC_LIFECYCLE_CLEAR_ON_EXECUTION_ACCEPT, DYNAMIC_LIFECYCLE_CLEAR_ON_TTL_EXPIRY,
        DYNAMIC_LIFECYCLE_SUPPORTS_KEEP_AFTER_EXECUTE, DYNAMIC_MAX_TTL_SECONDS,
        DYNAMIC_MIN_TTL_SECONDS, DYNAMIC_SLOT_COUNT_MAX, DYNAMIC_TRANSACTION_TIMEOUT_SECONDS,
        MAX_DYNAMIC_TEXT_LENGTH,
    };
    use serde_json::{json, Value};

    /// Keys that may never appear anywhere in a serialized service state.
    const FORBIDDEN_KEYS: &[&str] = &[
        "text",
        "draftText",
        "path",
        "devicePath",
        "serial",
        "serialNumber",
        "password",
        "token",
        "secret",
        "salt",
        "nonce",
        "proof",
        "key",
        "raw",
        "frame",
    ];

    const STATE_KEYS: &[&str] = &["capabilities", "error", "generation", "objects", "status"];

    const OBJECT_KEYS: &[&str] = &[
        "keepAfterExecute",
        "slot",
        "status",
        "textLength",
        "ttlSeconds",
    ];

    fn capabilities(object_count: u8) -> DynamicCapabilities {
        DynamicCapabilities {
            capability_version: DYNAMIC_CAPABILITY_VERSION,
            dynamic_object_count: object_count,
            lifecycle_flags: DYNAMIC_LIFECYCLE_CLEAR_ON_BOOT
                | DYNAMIC_LIFECYCLE_CLEAR_ON_TTL_EXPIRY
                | DYNAMIC_LIFECYCLE_CLEAR_ON_EXECUTION_ACCEPT
                | DYNAMIC_LIFECYCLE_SUPPORTS_KEEP_AFTER_EXECUTE,
            max_dynamic_length: MAX_DYNAMIC_TEXT_LENGTH as u16,
            default_ttl_seconds: DYNAMIC_DEFAULT_TTL_SECONDS,
            min_ttl_seconds: DYNAMIC_MIN_TTL_SECONDS,
            max_ttl_seconds: DYNAMIC_MAX_TTL_SECONDS,
            transaction_timeout_seconds: DYNAMIC_TRANSACTION_TIMEOUT_SECONDS,
        }
    }

    fn sample_error() -> DynamicServiceError {
        DynamicServiceError {
            code: "bad_length".to_string(),
            message: "The device rejected the data length.".to_string(),
        }
    }

    fn serialized_keys(value: &Value, keys: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    keys.push(key.clone());
                    serialized_keys(child, keys);
                }
            }
            Value::Array(items) => {
                for item in items {
                    serialized_keys(item, keys);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
        }
    }

    /// Assert that a serialized state only exposes the documented, body-free
    /// keys and never a dynamic text or device identifier field.
    fn assert_body_free(state: &DynamicServiceState) {
        let value = serde_json::to_value(state).unwrap();
        let state_keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(state_keys, STATE_KEYS);

        let mut keys = Vec::new();
        serialized_keys(&value, &mut keys);
        for key in &keys {
            assert!(
                !FORBIDDEN_KEYS.contains(&key.as_str()),
                "service state exposes forbidden key {key}"
            );
        }

        for object in value["objects"].as_array().unwrap() {
            let object_keys: Vec<&str> = object
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(object_keys, OBJECT_KEYS);
        }
    }

    #[test]
    fn service_starts_unknown_and_serializes_body_free_state() {
        let mut service = DynamicService::new();
        assert_eq!(service.state().status, DynamicServiceStatus::Unknown);
        assert_eq!(service.state().capabilities, None);
        assert!(service.state().objects.is_empty());
        assert_eq!(service.state().error, None);
        assert_eq!(service.state().generation, 0);
        assert_body_free(&service.state());

        // A stale generation can never publish state, not even at startup.
        assert!(!service.complete_clear(0, 0));
        assert!(!service.fail_object_operation(0, 0, DynamicFailure::Error, sample_error()));
        assert_eq!(service.state().status, DynamicServiceStatus::Unknown);
    }

    #[test]
    fn capability_discovery_moves_through_discovering_to_ready() {
        let mut service = DynamicService::new();
        let generation = service.begin_capability_discovery();
        assert_eq!(service.state().status, DynamicServiceStatus::Discovering);
        assert_eq!(service.state().generation, generation);

        assert!(service.complete_capability_discovery(generation, capabilities(8)));
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::Ready);
        assert_eq!(state.capabilities.unwrap().dynamic_object_count, 8);
        assert_eq!(state.objects.len(), 8);
        assert!(state
            .objects
            .iter()
            .enumerate()
            .all(|(index, object)| object.slot as usize == index
                && object.status == DynamicObjectStatus::Unknown
                && object.text_length.is_none()));
        assert_body_free(&state);

        // A single-object device reports exactly one object, never a guess.
        let mut single = DynamicService::new();
        let generation = single.begin_capability_discovery();
        assert!(single.complete_capability_discovery(generation, capabilities(1)));
        assert_eq!(single.state().objects.len(), 1);
        assert_eq!(single.state().objects[0].slot, 0);
    }

    #[test]
    fn capability_refresh_keeps_surviving_observations_and_drops_the_rest() {
        let mut service = DynamicService::new();
        let generation = service.begin_capability_discovery();
        service.complete_capability_discovery(generation, capabilities(DYNAMIC_SLOT_COUNT_MAX));
        let generation = service.begin_upload(5);
        assert!(service.complete_upload(generation, 5, 12, Some(60), true));

        let generation = service.begin_capability_discovery();
        assert!(service.complete_capability_discovery(generation, capabilities(3)));
        let state = service.state();
        assert_eq!(state.objects.len(), 3);
        assert!(state.objects.iter().all(|object| object.slot < 3));

        let generation = service.begin_capability_discovery();
        assert!(service.complete_capability_discovery(generation, capabilities(8)));
        let state = service.state();
        assert_eq!(state.objects.len(), 8);
        assert_eq!(state.objects[5].status, DynamicObjectStatus::Unknown);
        assert_eq!(state.objects[5].text_length, None);
    }

    #[test]
    fn unsupported_and_error_failures_are_distinguished() {
        let mut service = DynamicService::new();
        let generation = service.begin_capability_discovery();
        assert!(service.fail_capability_discovery(
            generation,
            DynamicFailure::Unsupported,
            DynamicServiceError {
                code: "dynamic_unsupported".to_string(),
                message: "This device does not support Dynamic Macro.".to_string(),
            },
        ));
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::Unsupported);
        assert_eq!(state.capabilities, None);
        assert_eq!(state.error.as_ref().unwrap().code, "dynamic_unsupported");
        assert_body_free(&state);

        // The next attempt clears the previous failure, and an operational
        // failure reports `Error` instead of `Unsupported`.
        let generation = service.begin_capability_discovery();
        assert_eq!(service.state().error, None);
        assert!(service.fail_capability_discovery(
            generation,
            DynamicFailure::Error,
            sample_error()
        ));
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::Error);
        assert_eq!(state.error.as_ref().unwrap().code, "bad_length");

        // Capability metadata survives an object-level failure.
        let generation = service.begin_capability_discovery();
        service.complete_capability_discovery(generation, capabilities(2));
        let generation = service.begin_upload(1);
        service.fail_object_operation(generation, 1, DynamicFailure::Error, sample_error());
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::Error);
        assert_eq!(state.capabilities.unwrap().dynamic_object_count, 2);
        assert_eq!(state.objects[1].status, DynamicObjectStatus::Error);
        assert_eq!(state.objects[0].status, DynamicObjectStatus::Unknown);
        assert_body_free(&state);
    }

    #[test]
    fn upload_and_clear_record_only_length_and_parameters() {
        let mut service = DynamicService::new();
        let generation = service.begin_capability_discovery();
        service.complete_capability_discovery(generation, capabilities(4));

        let generation = service.begin_upload(2);
        assert_eq!(service.state().status, DynamicServiceStatus::Uploading);
        assert_eq!(
            service.state().objects[2].status,
            DynamicObjectStatus::Uploading
        );
        assert!(service.complete_upload(generation, 2, 9, Some(120), true));
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::CommittedLocally);
        let object = state.objects[2];
        assert_eq!(object.status, DynamicObjectStatus::CommittedLocally);
        assert_eq!(object.text_length, Some(9));
        assert_eq!(object.ttl_seconds, Some(120));
        assert!(object.keep_after_execute);
        // Other objects keep their own observation.
        assert_eq!(state.objects[1].text_length, None);
        assert_body_free(&state);

        let generation = service.begin_clear(2);
        assert_eq!(service.state().status, DynamicServiceStatus::Clearing);
        assert!(service.complete_clear(generation, 2));
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::ClearedLocally);
        let object = state.objects[2];
        assert_eq!(object.status, DynamicObjectStatus::ClearedLocally);
        assert_eq!(object.text_length, Some(0));
        assert_eq!(object.ttl_seconds, None);
        assert!(!object.keep_after_execute);
        assert_body_free(&state);

        // A failed upload keeps the last acknowledged observation.
        let generation = service.begin_upload(2);
        assert_eq!(
            service.state().objects[2].status,
            DynamicObjectStatus::Uploading
        );
        assert!(service.fail_object_operation(
            generation,
            2,
            DynamicFailure::Error,
            sample_error()
        ));
        let object = service.state().objects[2];
        assert_eq!(object.status, DynamicObjectStatus::Error);
        assert_eq!(object.text_length, Some(0));
    }

    #[test]
    fn an_operation_on_an_unknown_slot_adds_one_entry_in_slot_order() {
        let mut service = DynamicService::new();
        let generation = service.begin_upload(7);
        assert!(service.complete_upload(generation, 7, 3, None, false));
        assert_eq!(service.state().objects.len(), 1);

        let generation = service.begin_clear(2);
        assert!(service.complete_clear(generation, 2));
        let slots: Vec<u8> = service.state().objects.iter().map(|o| o.slot).collect();
        assert_eq!(slots, vec![2, 7]);
        assert_body_free(&service.state());
    }

    #[test]
    fn stale_completions_cannot_overwrite_a_newer_operation() {
        let mut service = DynamicService::new();
        let first = service.begin_capability_discovery();
        assert!(service.complete_capability_discovery(first, capabilities(4)));

        let upload = service.begin_upload(3);
        let clear = service.begin_clear(1);
        assert_ne!(upload, clear);

        // The capability exchange and the upload were superseded by the clear.
        assert!(!service.complete_capability_discovery(upload, capabilities(1)));
        assert!(!service.complete_upload(upload, 3, 5, None, false));
        assert!(!service.fail_object_operation(upload, 3, DynamicFailure::Error, sample_error()));
        assert_eq!(service.state().status, DynamicServiceStatus::Clearing);
        assert_eq!(
            service.state().objects[3].status,
            DynamicObjectStatus::Unknown
        );
        assert_eq!(
            service.state().objects[1].status,
            DynamicObjectStatus::Clearing
        );
        assert_eq!(service.state().error, None);

        // The newest generation still applies.
        assert!(service.complete_clear(clear, 1));
        assert_eq!(service.state().status, DynamicServiceStatus::ClearedLocally);
    }

    #[test]
    fn reset_clears_device_facts_and_invalidates_in_flight_operations() {
        let mut service = DynamicService::new();
        let generation = service.begin_capability_discovery();
        service.complete_capability_discovery(generation, capabilities(2));
        let generation = service.begin_upload(0);
        service.complete_upload(generation, 0, 4, Some(30), true);
        let stale = service.begin_upload(1);

        service.reset();
        let state = service.state();
        assert_eq!(state.status, DynamicServiceStatus::Unknown);
        assert_eq!(state.capabilities, None);
        assert!(state.objects.is_empty());
        assert_eq!(state.error, None);
        assert!(state.generation > stale);
        assert!(!service.complete_upload(stale, 1, 4, None, false));
        assert!(!service.fail_object_operation(stale, 1, DynamicFailure::Error, sample_error()));
        assert_eq!(service.state().status, DynamicServiceStatus::Unknown);
    }

    #[test]
    fn capability_metadata_serializes_with_the_existing_camel_case_fields() {
        let metadata = DynamicCapabilitiesMetadata::from(capabilities(8));
        assert_eq!(
            serde_json::to_value(metadata).unwrap(),
            json!({
                "capabilityVersion": 2,
                "dynamicObjectCount": 8,
                "lifecycleFlags": metadata.lifecycle_flags,
                "maxDynamicLength": 512,
                "defaultTtlSeconds": 300,
                "minTtlSeconds": 1,
                "maxTtlSeconds": 86_400,
                "transactionTimeoutSeconds": 30,
                "clearOnBoot": true,
                "clearOnTtlExpiry": true,
                "clearOnExecutionAccept": true,
                "clearOnUsbDisconnect": false,
                "clearOnBleProfileChange": false,
                "clearOnSelectedEndpointChange": false,
                "supportsKeepAfterExecute": true,
            })
        );
    }
}
