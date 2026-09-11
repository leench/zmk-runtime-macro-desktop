use crate::auth::{Nonce, DEFAULT_ITERATIONS, KDF_ID, MAX_ITERATIONS, MIN_ITERATIONS, NONCE_SIZE};
use crate::error::{ProtocolError, TextError};
use zeroize::Zeroize;

pub const FRAME_SIZE: usize = 32;
pub const HEADER_SIZE: usize = 10;
pub const PAYLOAD_SIZE: usize = FRAME_SIZE - HEADER_SIZE;
pub const MAX_TEXT_LENGTH: usize = 256;
/// Dynamic Protocol v2 text objects are independent from the static slots and
/// allow up to 512 bytes each.
pub const MAX_DYNAMIC_TEXT_LENGTH: usize = 512;
pub const VERSION: u8 = 2;
pub const LIST_SLOT: u8 = 0xff;
pub const AUTH_SLOT: u8 = LIST_SLOT;
pub const PASSWORD_SET_LENGTH: usize = 52;
pub const AUTH_INFO_LENGTH: usize = 22;
pub const AUTH_CHALLENGE_LENGTH: usize = NONCE_SIZE;
pub const AUTH_PROVE_LENGTH: usize = 16;
pub const DYNAMIC_CAPABILITIES_LENGTH: usize = 22;
pub const DYNAMIC_CAPABILITY_VERSION: u8 = 2;
/// Dynamic object indices are `0..dynamic_object_count-1`. The protocol-level
/// maximum object count is 8, so `0xff` (the static `LIST_SLOT` sentinel) and
/// every index at or above 8 are invalid on every device.
pub const DYNAMIC_FIRST_SLOT: u8 = 0;
pub const DYNAMIC_SLOT_COUNT_MIN: u8 = 1;
pub const DYNAMIC_SLOT_COUNT_MAX: u8 = 8;
pub const DYNAMIC_DEFAULT_TTL_SECONDS: u32 = 300;
pub const DYNAMIC_MIN_TTL_SECONDS: u32 = 1;
pub const DYNAMIC_MAX_TTL_SECONDS: u32 = 86_400;
pub const DYNAMIC_TRANSACTION_TIMEOUT_SECONDS: u32 = 30;
pub const DYNAMIC_BEGIN_FLAG_KEEP_AFTER_EXECUTE: u8 = 1 << 0;
pub const DYNAMIC_BEGIN_KNOWN_FLAGS: u8 = DYNAMIC_BEGIN_FLAG_KEEP_AFTER_EXECUTE;
pub const DYNAMIC_LIFECYCLE_CLEAR_ON_BOOT: u16 = 1 << 0;
pub const DYNAMIC_LIFECYCLE_CLEAR_ON_TTL_EXPIRY: u16 = 1 << 1;
pub const DYNAMIC_LIFECYCLE_CLEAR_ON_EXECUTION_ACCEPT: u16 = 1 << 2;
pub const DYNAMIC_LIFECYCLE_CLEAR_ON_USB_DISCONNECT: u16 = 1 << 3;
pub const DYNAMIC_LIFECYCLE_CLEAR_ON_BLE_PROFILE_CHANGE: u16 = 1 << 4;
pub const DYNAMIC_LIFECYCLE_CLEAR_ON_SELECTED_ENDPOINT_CHANGE: u16 = 1 << 5;
pub const DYNAMIC_LIFECYCLE_SUPPORTS_KEEP_AFTER_EXECUTE: u16 = 1 << 6;
pub const DYNAMIC_LIFECYCLE_KNOWN_MASK: u16 = 0x007f;
pub const DYNAMIC_LIFECYCLE_REQUIRED_MASK: u16 = DYNAMIC_LIFECYCLE_CLEAR_ON_BOOT
    | DYNAMIC_LIFECYCLE_CLEAR_ON_TTL_EXPIRY
    | DYNAMIC_LIFECYCLE_CLEAR_ON_EXECUTION_ACCEPT;
pub const PASSWORD_CONFIGURED_FLAG: u8 = 1 << 0;
pub const SESSION_AUTHENTICATED_FLAG: u8 = 1 << 1;

pub const VERSION_OFFSET: usize = 0;
pub const OPCODE_OFFSET: usize = 1;
pub const REQUEST_ID_OFFSET: usize = 2;
pub const STATUS_OFFSET: usize = 3;
pub const SLOT_OFFSET: usize = 4;
pub const PAYLOAD_LENGTH_OFFSET: usize = 5;
pub const OFFSET_OFFSET: usize = 6;
pub const TOTAL_LENGTH_OFFSET: usize = 8;
pub const PAYLOAD_OFFSET: usize = HEADER_SIZE;

pub type Frame = [u8; FRAME_SIZE];

/// A request frame containing credential or proof material. It intentionally
/// has no Debug, Serialize, Clone, or raw public accessor implementation.
pub(crate) struct SecretFrame(Frame);

impl SecretFrame {
    pub(crate) fn new(frame: Frame) -> Self {
        Self(frame)
    }

    pub(crate) fn as_frame(&self) -> &Frame {
        &self.0
    }
}

impl Drop for SecretFrame {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Opcode {
    List = 1,
    Get = 2,
    Set = 3,
    Clear = 4,
    AuthInfo = 0x10,
    AuthChallenge = 0x11,
    AuthProve = 0x12,
    PasswordSet = 0x13,
    Lock = 0x14,
    DynamicBegin = 0x20,
    DynamicData = 0x21,
    DynamicClear = 0x22,
    Capabilities = 0x23,
}

impl TryFrom<u8> for Opcode {
    type Error = ProtocolError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::List),
            2 => Ok(Self::Get),
            3 => Ok(Self::Set),
            4 => Ok(Self::Clear),
            0x10 => Ok(Self::AuthInfo),
            0x11 => Ok(Self::AuthChallenge),
            0x12 => Ok(Self::AuthProve),
            0x13 => Ok(Self::PasswordSet),
            0x14 => Ok(Self::Lock),
            0x20 => Ok(Self::DynamicBegin),
            0x21 => Ok(Self::DynamicData),
            0x22 => Ok(Self::DynamicClear),
            0x23 => Ok(Self::Capabilities),
            value => Err(ProtocolError::UnknownOpcode(value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Status {
    Ok = 0,
    BadVersion = 1,
    BadOpcode = 2,
    BadRequest = 3,
    BadSlot = 4,
    BadOffset = 5,
    BadLength = 6,
    InvalidText = 7,
    StorageError = 8,
    Internal = 9,
    AuthRequired = 10,
    AuthFailed = 11,
    AuthNotConfigured = 12,
    RateLimited = 13,
    AuthNoChallenge = 14,
    CredentialInvalid = 15,
}

impl TryFrom<u8> for Status {
    type Error = ProtocolError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Ok),
            1 => Ok(Self::BadVersion),
            2 => Ok(Self::BadOpcode),
            3 => Ok(Self::BadRequest),
            4 => Ok(Self::BadSlot),
            5 => Ok(Self::BadOffset),
            6 => Ok(Self::BadLength),
            7 => Ok(Self::InvalidText),
            8 => Ok(Self::StorageError),
            9 => Ok(Self::Internal),
            10 => Ok(Self::AuthRequired),
            11 => Ok(Self::AuthFailed),
            12 => Ok(Self::AuthNotConfigured),
            13 => Ok(Self::RateLimited),
            14 => Ok(Self::AuthNoChallenge),
            15 => Ok(Self::CredentialInvalid),
            value => Err(ProtocolError::UnknownStatus(value)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthInfo {
    pub password_configured: bool,
    pub session_authenticated: bool,
    pub kdf_id: u8,
    pub iterations: u32,
    pub salt: [u8; 16],
}

impl AuthInfo {
    pub fn is_protected(&self) -> bool {
        self.password_configured
    }

    pub fn flags(&self) -> u8 {
        (self.password_configured as u8 * PASSWORD_CONFIGURED_FLAG)
            | (self.session_authenticated as u8 * SESSION_AUTHENTICATED_FLAG)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DynamicCapabilities {
    pub capability_version: u8,
    pub dynamic_object_count: u8,
    pub lifecycle_flags: u16,
    pub max_dynamic_length: u16,
    pub default_ttl_seconds: u32,
    pub min_ttl_seconds: u32,
    pub max_ttl_seconds: u32,
    pub transaction_timeout_seconds: u32,
}

impl DynamicCapabilities {
    pub fn supports_keep_after_execute(&self) -> bool {
        self.lifecycle_flags & DYNAMIC_LIFECYCLE_SUPPORTS_KEEP_AFTER_EXECUTE != 0
    }

    pub fn clear_on_usb_disconnect(&self) -> bool {
        self.lifecycle_flags & DYNAMIC_LIFECYCLE_CLEAR_ON_USB_DISCONNECT != 0
    }

    pub fn clear_on_ble_profile_change(&self) -> bool {
        self.lifecycle_flags & DYNAMIC_LIFECYCLE_CLEAR_ON_BLE_PROFILE_CHANGE != 0
    }

    pub fn clear_on_selected_endpoint_change(&self) -> bool {
        self.lifecycle_flags & DYNAMIC_LIFECYCLE_CLEAR_ON_SELECTED_ENDPOINT_CHANGE != 0
    }
}

pub fn read_u16(frame: &Frame, offset: usize) -> u16 {
    u16::from_le_bytes([frame[offset], frame[offset + 1]])
}

fn write_u16(frame: &mut Frame, offset: usize, value: u16) {
    frame[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

/// Report whether `slot` is a valid dynamic object index for a device that
/// reports `object_count` dynamic objects. Before capability discovery only
/// the protocol-level bound is known, which is expressed by passing
/// [`DYNAMIC_SLOT_COUNT_MAX`].
pub fn dynamic_slot_is_valid(slot: u8, object_count: u8) -> bool {
    (DYNAMIC_SLOT_COUNT_MIN..=DYNAMIC_SLOT_COUNT_MAX).contains(&object_count) && slot < object_count
}

fn valid_dynamic_begin_payload(payload: &[u8]) -> bool {
    match payload.len() {
        0 => true,
        1 => payload[0] & !DYNAMIC_BEGIN_KNOWN_FLAGS == 0,
        4 => {
            let ttl = u32::from_le_bytes(payload.try_into().expect("length checked"));
            (DYNAMIC_MIN_TTL_SECONDS..=DYNAMIC_MAX_TTL_SECONDS).contains(&ttl)
        }
        5 => {
            let ttl = u32::from_le_bytes(payload[..4].try_into().expect("length checked"));
            (DYNAMIC_MIN_TTL_SECONDS..=DYNAMIC_MAX_TTL_SECONDS).contains(&ttl)
                && payload[4] & !DYNAMIC_BEGIN_KNOWN_FLAGS == 0
        }
        _ => false,
    }
}

/// Build a canonical v2 request. The frame starts zero-filled, including all
/// payload bytes after the declared payload length.
pub fn build_frame(
    opcode: Opcode,
    request_id: u8,
    slot: u8,
    payload: &[u8],
    offset: u16,
    total_length: u16,
) -> Result<Frame, ProtocolError> {
    if payload.len() > PAYLOAD_SIZE {
        return Err(ProtocolError::PayloadTooLong {
            length: payload.len(),
        });
    }

    match opcode {
        Opcode::List if slot != LIST_SLOT || !payload.is_empty() || total_length != 0 => {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        Opcode::Get if slot == AUTH_SLOT || !payload.is_empty() || total_length != 0 => {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        Opcode::Set
            if slot == AUTH_SLOT
                || total_length as usize > MAX_TEXT_LENGTH
                || offset > total_length
                || (payload.is_empty() && total_length != 0)
                || payload.len() > (total_length - offset) as usize =>
        {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        Opcode::Clear
            if slot == AUTH_SLOT || !payload.is_empty() || offset != 0 || total_length != 0 =>
        {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        Opcode::AuthInfo | Opcode::AuthChallenge | Opcode::Lock
            if slot != AUTH_SLOT || !payload.is_empty() || offset != 0 || total_length != 0 =>
        {
            return Err(ProtocolError::InvalidAuthRequest {
                operation: opcode.name(),
            });
        }
        Opcode::AuthProve
            if slot != AUTH_SLOT
                || payload.len() != AUTH_PROVE_LENGTH
                || offset != 0
                || total_length != AUTH_PROVE_LENGTH as u16 =>
        {
            return Err(ProtocolError::InvalidAuthRequest {
                operation: opcode.name(),
            });
        }
        Opcode::PasswordSet
            if slot != AUTH_SLOT
                || total_length != PASSWORD_SET_LENGTH as u16
                || offset > PASSWORD_SET_LENGTH as u16
                || payload.is_empty()
                || payload.len() > (PASSWORD_SET_LENGTH - offset as usize) =>
        {
            return Err(ProtocolError::InvalidAuthRequest {
                operation: opcode.name(),
            });
        }
        Opcode::DynamicBegin
            if !dynamic_slot_is_valid(slot, DYNAMIC_SLOT_COUNT_MAX)
                || offset != 0
                || !(1..=MAX_DYNAMIC_TEXT_LENGTH as u16).contains(&total_length)
                || !valid_dynamic_begin_payload(payload) =>
        {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        Opcode::DynamicData
            if !dynamic_slot_is_valid(slot, DYNAMIC_SLOT_COUNT_MAX)
                || !(1..=MAX_DYNAMIC_TEXT_LENGTH as u16).contains(&total_length)
                || offset > total_length
                || payload.is_empty()
                || payload.len() > (total_length - offset) as usize =>
        {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        Opcode::DynamicClear | Opcode::Capabilities
            if !dynamic_slot_is_valid(slot, DYNAMIC_SLOT_COUNT_MAX)
                || !payload.is_empty()
                || offset != 0
                || total_length != 0 =>
        {
            return Err(ProtocolError::InvalidRequest {
                operation: opcode.name(),
            });
        }
        _ => {}
    }

    let mut frame = [0u8; FRAME_SIZE];
    frame[VERSION_OFFSET] = VERSION;
    frame[OPCODE_OFFSET] = opcode as u8;
    frame[REQUEST_ID_OFFSET] = request_id;
    // Requests always carry status zero.
    frame[STATUS_OFFSET] = Status::Ok as u8;
    frame[SLOT_OFFSET] = slot;
    frame[PAYLOAD_LENGTH_OFFSET] = payload.len() as u8;
    write_u16(&mut frame, OFFSET_OFFSET, offset);
    write_u16(&mut frame, TOTAL_LENGTH_OFFSET, total_length);
    frame[PAYLOAD_OFFSET..PAYLOAD_OFFSET + payload.len()].copy_from_slice(payload);
    Ok(frame)
}

impl Opcode {
    fn name(self) -> &'static str {
        match self {
            Self::List => "LIST",
            Self::Get => "GET",
            Self::Set => "SET",
            Self::Clear => "CLEAR",
            Self::AuthInfo => "AUTH_INFO",
            Self::AuthChallenge => "AUTH_CHALLENGE",
            Self::AuthProve => "AUTH_PROVE",
            Self::PasswordSet => "PASSWORD_SET",
            Self::Lock => "LOCK",
            Self::DynamicBegin => "DYNAMIC_BEGIN",
            Self::DynamicData => "DYNAMIC_DATA",
            Self::DynamicClear => "DYNAMIC_CLEAR",
            Self::Capabilities => "CAPABILITIES",
        }
    }
}

pub fn build_auth_info_request(request_id: u8) -> Result<Frame, ProtocolError> {
    build_frame(Opcode::AuthInfo, request_id, AUTH_SLOT, &[], 0, 0)
}

pub fn build_auth_challenge_request(request_id: u8) -> Result<Frame, ProtocolError> {
    build_frame(Opcode::AuthChallenge, request_id, AUTH_SLOT, &[], 0, 0)
}

pub(crate) fn build_auth_prove_request(
    request_id: u8,
    proof: &crate::auth::Proof,
) -> Result<SecretFrame, ProtocolError> {
    build_frame(
        Opcode::AuthProve,
        request_id,
        AUTH_SLOT,
        proof.as_bytes(),
        0,
        AUTH_PROVE_LENGTH as u16,
    )
    .map(SecretFrame::new)
}

pub(crate) fn build_password_set_chunk(
    request_id: u8,
    offset: u16,
    payload: &[u8],
) -> Result<SecretFrame, ProtocolError> {
    build_frame(
        Opcode::PasswordSet,
        request_id,
        AUTH_SLOT,
        payload,
        offset,
        PASSWORD_SET_LENGTH as u16,
    )
    .map(SecretFrame::new)
}

pub fn build_lock_request(request_id: u8) -> Result<Frame, ProtocolError> {
    build_frame(Opcode::Lock, request_id, AUTH_SLOT, &[], 0, 0)
}

/// `CAPABILITIES` accepts any valid dynamic object index and the firmware
/// returns identical metadata for all of them; the client always probes the
/// first object so the request stays valid on a device with one object.
pub fn build_capabilities_request(request_id: u8) -> Result<Frame, ProtocolError> {
    build_frame(
        Opcode::Capabilities,
        request_id,
        DYNAMIC_FIRST_SLOT,
        &[],
        0,
        0,
    )
}

pub fn build_dynamic_begin_request(
    request_id: u8,
    slot: u8,
    total_length: usize,
    ttl_seconds: Option<u32>,
    keep_after_execute: bool,
) -> Result<Frame, ProtocolError> {
    let total_length = u16::try_from(total_length).map_err(|_| ProtocolError::InvalidRequest {
        operation: "DYNAMIC_BEGIN",
    })?;
    let mut payload = [0u8; 5];
    let payload_length = match (ttl_seconds, keep_after_execute) {
        (None, false) => 0,
        (None, true) => {
            payload[0] = DYNAMIC_BEGIN_FLAG_KEEP_AFTER_EXECUTE;
            1
        }
        (Some(ttl), false) => {
            if !(DYNAMIC_MIN_TTL_SECONDS..=DYNAMIC_MAX_TTL_SECONDS).contains(&ttl) {
                return Err(ProtocolError::InvalidRequest {
                    operation: "DYNAMIC_BEGIN",
                });
            }
            payload[..4].copy_from_slice(&ttl.to_le_bytes());
            4
        }
        (Some(ttl), true) => {
            if !(DYNAMIC_MIN_TTL_SECONDS..=DYNAMIC_MAX_TTL_SECONDS).contains(&ttl) {
                return Err(ProtocolError::InvalidRequest {
                    operation: "DYNAMIC_BEGIN",
                });
            }
            payload[..4].copy_from_slice(&ttl.to_le_bytes());
            payload[4] = DYNAMIC_BEGIN_FLAG_KEEP_AFTER_EXECUTE;
            5
        }
    };
    build_frame(
        Opcode::DynamicBegin,
        request_id,
        slot,
        &payload[..payload_length],
        0,
        total_length,
    )
}

pub fn build_dynamic_data_request(
    request_id: u8,
    slot: u8,
    offset: usize,
    total_length: usize,
    payload: &[u8],
) -> Result<Frame, ProtocolError> {
    let offset = u16::try_from(offset).map_err(|_| ProtocolError::InvalidRequest {
        operation: "DYNAMIC_DATA",
    })?;
    let total_length = u16::try_from(total_length).map_err(|_| ProtocolError::InvalidRequest {
        operation: "DYNAMIC_DATA",
    })?;
    build_frame(
        Opcode::DynamicData,
        request_id,
        slot,
        payload,
        offset,
        total_length,
    )
}

pub fn build_dynamic_clear_request(request_id: u8, slot: u8) -> Result<Frame, ProtocolError> {
    build_frame(Opcode::DynamicClear, request_id, slot, &[], 0, 0)
}

/// Parse the fixed capability metadata response after common response identity,
/// status, and padding validation has completed. The response must belong to a
/// valid dynamic object index: a capability answer cannot come from the static
/// `LIST_SLOT` sentinel or from an index the device does not have.
pub fn parse_dynamic_capabilities_response(
    response: &Frame,
) -> Result<DynamicCapabilities, ProtocolError> {
    if response[VERSION_OFFSET] != VERSION
        || response[OPCODE_OFFSET] != Opcode::Capabilities as u8
        || Status::try_from(response[STATUS_OFFSET])? != Status::Ok
        || response[PAYLOAD_LENGTH_OFFSET] as usize != DYNAMIC_CAPABILITIES_LENGTH
        || read_u16(response, OFFSET_OFFSET) != 0
        || read_u16(response, TOTAL_LENGTH_OFFSET) != DYNAMIC_CAPABILITIES_LENGTH as u16
        || response[PAYLOAD_OFFSET + DYNAMIC_CAPABILITIES_LENGTH..]
            .iter()
            .any(|byte| *byte != 0)
    {
        return Err(ProtocolError::InvalidDynamicCapabilities);
    }

    let payload = &response[PAYLOAD_OFFSET..PAYLOAD_OFFSET + DYNAMIC_CAPABILITIES_LENGTH];
    let lifecycle_flags = u16::from_le_bytes([payload[2], payload[3]]);
    let capabilities = DynamicCapabilities {
        capability_version: payload[0],
        dynamic_object_count: payload[1],
        lifecycle_flags,
        max_dynamic_length: u16::from_le_bytes([payload[4], payload[5]]),
        default_ttl_seconds: u32::from_le_bytes(payload[6..10].try_into().expect("fixed field")),
        min_ttl_seconds: u32::from_le_bytes(payload[10..14].try_into().expect("fixed field")),
        max_ttl_seconds: u32::from_le_bytes(payload[14..18].try_into().expect("fixed field")),
        transaction_timeout_seconds: u32::from_le_bytes(
            payload[18..22].try_into().expect("fixed field"),
        ),
    };
    if capabilities.capability_version != DYNAMIC_CAPABILITY_VERSION
        || !dynamic_slot_is_valid(response[SLOT_OFFSET], capabilities.dynamic_object_count)
        || lifecycle_flags & !DYNAMIC_LIFECYCLE_KNOWN_MASK != 0
        || lifecycle_flags & DYNAMIC_LIFECYCLE_REQUIRED_MASK != DYNAMIC_LIFECYCLE_REQUIRED_MASK
        || capabilities.max_dynamic_length != MAX_DYNAMIC_TEXT_LENGTH as u16
        || capabilities.default_ttl_seconds != DYNAMIC_DEFAULT_TTL_SECONDS
        || capabilities.min_ttl_seconds != DYNAMIC_MIN_TTL_SECONDS
        || capabilities.max_ttl_seconds != DYNAMIC_MAX_TTL_SECONDS
        || capabilities.transaction_timeout_seconds != DYNAMIC_TRANSACTION_TIMEOUT_SECONDS
    {
        return Err(ProtocolError::InvalidDynamicCapabilities);
    }
    Ok(capabilities)
}

/// Parse and validate the common request invariants before dispatching an
/// operation. A version mismatch is reported explicitly; a firmware endpoint
/// may instead encode BAD_VERSION in a response while echoing the request.
pub fn validate_request(frame: &Frame) -> Result<Opcode, ProtocolError> {
    if frame[VERSION_OFFSET] != VERSION {
        return Err(ProtocolError::UnsupportedVersion {
            actual: frame[VERSION_OFFSET],
        });
    }
    if frame[STATUS_OFFSET] != Status::Ok as u8 {
        return Err(ProtocolError::InvalidRequestStatus {
            actual: frame[STATUS_OFFSET],
        });
    }

    let opcode = Opcode::try_from(frame[OPCODE_OFFSET])?;
    let payload_length = frame[PAYLOAD_LENGTH_OFFSET] as usize;
    if payload_length > PAYLOAD_SIZE {
        return Err(ProtocolError::PayloadTooLong {
            length: payload_length,
        });
    }
    if frame[PAYLOAD_OFFSET + payload_length..]
        .iter()
        .any(|byte| *byte != 0)
    {
        return Err(ProtocolError::NonZeroPayloadPadding);
    }

    match opcode {
        Opcode::List => {
            if frame[SLOT_OFFSET] != LIST_SLOT
                || payload_length != 0
                || read_u16(frame, TOTAL_LENGTH_OFFSET) != 0
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::Get => {
            if frame[SLOT_OFFSET] == AUTH_SLOT
                || payload_length != 0
                || read_u16(frame, TOTAL_LENGTH_OFFSET) != 0
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::Set => {
            let offset = read_u16(frame, OFFSET_OFFSET);
            let total = read_u16(frame, TOTAL_LENGTH_OFFSET);
            if frame[SLOT_OFFSET] == AUTH_SLOT
                || total as usize > MAX_TEXT_LENGTH
                || offset > total
                || (payload_length == 0 && total != 0)
                || payload_length > (total - offset) as usize
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::Clear => {
            if frame[SLOT_OFFSET] == AUTH_SLOT
                || payload_length != 0
                || read_u16(frame, OFFSET_OFFSET) != 0
                || read_u16(frame, TOTAL_LENGTH_OFFSET) != 0
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::AuthInfo | Opcode::AuthChallenge | Opcode::Lock => {
            if frame[SLOT_OFFSET] != AUTH_SLOT
                || payload_length != 0
                || read_u16(frame, OFFSET_OFFSET) != 0
                || read_u16(frame, TOTAL_LENGTH_OFFSET) != 0
            {
                return Err(ProtocolError::InvalidAuthRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::AuthProve => {
            if frame[SLOT_OFFSET] != AUTH_SLOT
                || payload_length != AUTH_PROVE_LENGTH
                || read_u16(frame, OFFSET_OFFSET) != 0
                || read_u16(frame, TOTAL_LENGTH_OFFSET) != AUTH_PROVE_LENGTH as u16
            {
                return Err(ProtocolError::InvalidAuthRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::PasswordSet => {
            let offset = read_u16(frame, OFFSET_OFFSET);
            let total = read_u16(frame, TOTAL_LENGTH_OFFSET);
            if frame[SLOT_OFFSET] != AUTH_SLOT
                || total != PASSWORD_SET_LENGTH as u16
                || offset > total
                || payload_length == 0
                || payload_length > (total - offset) as usize
            {
                return Err(ProtocolError::InvalidAuthRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::DynamicBegin => {
            if !dynamic_slot_is_valid(frame[SLOT_OFFSET], DYNAMIC_SLOT_COUNT_MAX)
                || read_u16(frame, OFFSET_OFFSET) != 0
                || !(1..=MAX_DYNAMIC_TEXT_LENGTH as u16)
                    .contains(&read_u16(frame, TOTAL_LENGTH_OFFSET))
                || !valid_dynamic_begin_payload(
                    &frame[PAYLOAD_OFFSET..PAYLOAD_OFFSET + payload_length],
                )
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::DynamicData => {
            let offset = read_u16(frame, OFFSET_OFFSET);
            let total = read_u16(frame, TOTAL_LENGTH_OFFSET);
            if !dynamic_slot_is_valid(frame[SLOT_OFFSET], DYNAMIC_SLOT_COUNT_MAX)
                || !(1..=MAX_DYNAMIC_TEXT_LENGTH as u16).contains(&total)
                || offset > total
                || payload_length == 0
                || payload_length > (total - offset) as usize
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
        Opcode::DynamicClear | Opcode::Capabilities => {
            if !dynamic_slot_is_valid(frame[SLOT_OFFSET], DYNAMIC_SLOT_COUNT_MAX)
                || payload_length != 0
                || read_u16(frame, OFFSET_OFFSET) != 0
                || read_u16(frame, TOTAL_LENGTH_OFFSET) != 0
            {
                return Err(ProtocolError::InvalidRequest {
                    operation: opcode.name(),
                });
            }
        }
    }

    Ok(opcode)
}

fn validate_success_shape(
    response: &Frame,
    payload_length: usize,
    offset: u16,
    total_length: u16,
    error: ProtocolError,
) -> Result<(), ProtocolError> {
    if response[PAYLOAD_LENGTH_OFFSET] as usize != payload_length
        || read_u16(response, OFFSET_OFFSET) != offset
        || read_u16(response, TOTAL_LENGTH_OFFSET) != total_length
    {
        return Err(error);
    }
    Ok(())
}

pub fn parse_auth_info_response(response: &Frame) -> Result<AuthInfo, ProtocolError> {
    if response[VERSION_OFFSET] != VERSION
        || response[OPCODE_OFFSET] != Opcode::AuthInfo as u8
        || response[SLOT_OFFSET] != AUTH_SLOT
        || Status::try_from(response[STATUS_OFFSET])? != Status::Ok
        || response[PAYLOAD_LENGTH_OFFSET] as usize != AUTH_INFO_LENGTH
        || read_u16(response, OFFSET_OFFSET) != 0
        || read_u16(response, TOTAL_LENGTH_OFFSET) != AUTH_INFO_LENGTH as u16
        || response[PAYLOAD_OFFSET + AUTH_INFO_LENGTH..]
            .iter()
            .any(|byte| *byte != 0)
    {
        return Err(ProtocolError::InvalidAuthInfo);
    }

    let payload = &response[PAYLOAD_OFFSET..PAYLOAD_OFFSET + AUTH_INFO_LENGTH];
    let flags = payload[0];
    if flags & !(PASSWORD_CONFIGURED_FLAG | SESSION_AUTHENTICATED_FLAG) != 0 {
        return Err(ProtocolError::InvalidAuthFlags { flags });
    }
    let password_configured = flags & PASSWORD_CONFIGURED_FLAG != 0;
    let session_authenticated = flags & SESSION_AUTHENTICATED_FLAG != 0;
    if session_authenticated && !password_configured {
        return Err(ProtocolError::InvalidAuthFlags { flags });
    }

    let kdf_id = payload[1];
    if kdf_id != KDF_ID {
        return Err(ProtocolError::UnsupportedKdf { id: kdf_id });
    }
    let iterations = u32::from_le_bytes([payload[2], payload[3], payload[4], payload[5]]);
    let mut salt = [0u8; 16];
    salt.copy_from_slice(&payload[6..22]);

    if password_configured {
        if !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&iterations)
            || salt.iter().all(|byte| *byte == 0)
        {
            return Err(ProtocolError::InvalidAuthInfo);
        }
    } else if iterations != DEFAULT_ITERATIONS || salt.iter().any(|byte| *byte != 0) {
        return Err(ProtocolError::InvalidAuthInfo);
    }

    Ok(AuthInfo {
        password_configured,
        session_authenticated,
        kdf_id,
        iterations,
        salt,
    })
}

pub fn parse_auth_challenge_response(response: &Frame) -> Result<Nonce, ProtocolError> {
    if response[VERSION_OFFSET] != VERSION
        || response[OPCODE_OFFSET] != Opcode::AuthChallenge as u8
        || response[SLOT_OFFSET] != AUTH_SLOT
        || Status::try_from(response[STATUS_OFFSET])? != Status::Ok
        || response[PAYLOAD_LENGTH_OFFSET] as usize != AUTH_CHALLENGE_LENGTH
        || read_u16(response, OFFSET_OFFSET) != 0
        || read_u16(response, TOTAL_LENGTH_OFFSET) != AUTH_CHALLENGE_LENGTH as u16
        || response[PAYLOAD_OFFSET + AUTH_CHALLENGE_LENGTH..]
            .iter()
            .any(|byte| *byte != 0)
    {
        return Err(ProtocolError::InvalidAuthChallenge);
    }

    let mut nonce = [0u8; NONCE_SIZE];
    nonce.copy_from_slice(&response[PAYLOAD_OFFSET..PAYLOAD_OFFSET + NONCE_SIZE]);
    Nonce::from_wire(nonce).map_err(|_| ProtocolError::InvalidAuthChallenge)
}

pub fn validate_empty_success(
    response: &Frame,
    operation: &'static str,
) -> Result<(), ProtocolError> {
    validate_success_shape(
        response,
        0,
        0,
        0,
        ProtocolError::UnexpectedResponsePayload { operation },
    )
}

/// Normalize the two common hidapi shapes into the protocol's exact 32-byte
/// frame. The optional leading byte is a report ID and must be zero.
pub fn normalize_response(data: &[u8]) -> Result<Frame, ProtocolError> {
    const REPORT_WITH_ID_SIZE: usize = FRAME_SIZE + 1;

    match data.len() {
        FRAME_SIZE => data
            .try_into()
            .map_err(|_| ProtocolError::FrameLength { actual: data.len() }),
        REPORT_WITH_ID_SIZE if data[0] == 0 => data[1..]
            .try_into()
            .map_err(|_| ProtocolError::FrameLength { actual: data.len() }),
        REPORT_WITH_ID_SIZE => Err(ProtocolError::NonZeroReportId(data[0])),
        actual => Err(ProtocolError::FrameLength { actual }),
    }
}

/// Return whether a response belongs to the request currently being awaited.
/// A response with a different version but matching request ID/opcode/slot is
/// deliberately not treated as stale; validate_response will report the
/// version mismatch.
pub fn response_identity_matches(request: &Frame, response: &Frame) -> bool {
    response[OPCODE_OFFSET] == request[OPCODE_OFFSET]
        && response[REQUEST_ID_OFFSET] == request[REQUEST_ID_OFFSET]
        && response[SLOT_OFFSET] == request[SLOT_OFFSET]
}

/// Validate all response-wide invariants and return its known status.
/// Non-OK responses use the protocol's common empty error shape.
pub fn validate_response(request: &Frame, response: &Frame) -> Result<Status, ProtocolError> {
    for (offset, field) in [
        (VERSION_OFFSET, "version"),
        (OPCODE_OFFSET, "opcode"),
        (REQUEST_ID_OFFSET, "request_id"),
        (SLOT_OFFSET, "slot"),
    ] {
        if response[offset] != request[offset] {
            return Err(ProtocolError::ResponseFieldMismatch {
                field,
                expected: request[offset],
                actual: response[offset],
            });
        }
    }

    let status = Status::try_from(response[STATUS_OFFSET])?;
    let payload_length = response[PAYLOAD_LENGTH_OFFSET] as usize;
    if payload_length > PAYLOAD_SIZE {
        return Err(ProtocolError::PayloadTooLong {
            length: payload_length,
        });
    }
    if response[PAYLOAD_OFFSET + payload_length..]
        .iter()
        .any(|value| *value != 0)
    {
        return Err(ProtocolError::NonZeroPayloadPadding);
    }

    if status != Status::Ok
        && (payload_length != 0
            || read_u16(response, OFFSET_OFFSET) != 0
            || read_u16(response, TOTAL_LENGTH_OFFSET) != 0)
    {
        return Err(ProtocolError::ErrorResponseNotEmpty);
    }

    Ok(status)
}

pub fn validate_text(data: &[u8]) -> Result<(), TextError> {
    for (index, byte) in data.iter().copied().enumerate() {
        if !(0x20..=0x7e).contains(&byte) && !matches!(byte, 0x08..=0x0a) {
            return Err(TextError { index, byte });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response_for(request: &Frame, status: u8) -> Frame {
        let mut response = [0u8; FRAME_SIZE];
        response[VERSION_OFFSET] = request[VERSION_OFFSET];
        response[OPCODE_OFFSET] = request[OPCODE_OFFSET];
        response[REQUEST_ID_OFFSET] = request[REQUEST_ID_OFFSET];
        response[STATUS_OFFSET] = status;
        response[SLOT_OFFSET] = request[SLOT_OFFSET];
        response
    }

    #[test]
    fn canonical_frame_is_fixed_zero_filled_and_little_endian() {
        let frame = build_frame(Opcode::Set, 7, 4, b"xy", 0x0034, 0x00f8).unwrap();
        let mut expected = [0u8; FRAME_SIZE];
        expected[..10].copy_from_slice(&[VERSION, 3, 7, 0, 4, 2, 0x34, 0x00, 0xf8, 0x00]);
        expected[10..12].copy_from_slice(b"xy");
        assert_eq!(frame, expected);
        assert_eq!(read_u16(&frame, OFFSET_OFFSET), 0x0034);
        assert_eq!(read_u16(&frame, TOTAL_LENGTH_OFFSET), 0x00f8);
    }

    #[test]
    fn authentication_requests_use_strict_v2_wire_shapes() {
        let info = build_auth_info_request(3).unwrap();
        assert_eq!(
            info,
            [
                VERSION,
                Opcode::AuthInfo as u8,
                3,
                0,
                AUTH_SLOT,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ]
        );
        assert_eq!(validate_request(&info), Ok(Opcode::AuthInfo));

        let credential = crate::auth::Credential::derive(
            "fixture-password",
            [1; crate::auth::SALT_SIZE],
            MIN_ITERATIONS,
        )
        .unwrap();
        let nonce = crate::auth::Nonce::from_wire([2; crate::auth::NONCE_SIZE]).unwrap();
        let proof = credential.proof(&nonce);
        let prove = build_auth_prove_request(4, &proof).unwrap();
        assert_eq!(prove.as_frame()[VERSION_OFFSET], VERSION);
        assert_eq!(prove.as_frame()[OPCODE_OFFSET], Opcode::AuthProve as u8);
        assert_eq!(prove.as_frame()[SLOT_OFFSET], AUTH_SLOT);
        assert_eq!(
            prove.as_frame()[PAYLOAD_LENGTH_OFFSET] as usize,
            AUTH_PROVE_LENGTH
        );
        assert_eq!(read_u16(prove.as_frame(), OFFSET_OFFSET), 0);
        assert_eq!(
            read_u16(prove.as_frame(), TOTAL_LENGTH_OFFSET),
            AUTH_PROVE_LENGTH as u16
        );
        assert_eq!(validate_request(prove.as_frame()), Ok(Opcode::AuthProve));

        let chunk = build_password_set_chunk(5, 44, &[0xa5; 8]).unwrap();
        assert_eq!(chunk.as_frame()[VERSION_OFFSET], VERSION);
        assert_eq!(chunk.as_frame()[OPCODE_OFFSET], Opcode::PasswordSet as u8);
        assert_eq!(chunk.as_frame()[SLOT_OFFSET], AUTH_SLOT);
        assert_eq!(chunk.as_frame()[PAYLOAD_LENGTH_OFFSET], 8);
        assert_eq!(read_u16(chunk.as_frame(), OFFSET_OFFSET), 44);
        assert_eq!(
            read_u16(chunk.as_frame(), TOTAL_LENGTH_OFFSET),
            PASSWORD_SET_LENGTH as u16
        );
        assert_eq!(validate_request(chunk.as_frame()), Ok(Opcode::PasswordSet));
        assert_eq!(
            validate_request(&build_lock_request(6).unwrap()),
            Ok(Opcode::Lock)
        );
    }

    #[test]
    fn dynamic_requests_use_canonical_wire_shapes_and_payload_combinations() {
        assert_eq!(Opcode::try_from(0x20), Ok(Opcode::DynamicBegin));
        assert_eq!(Opcode::try_from(0x21), Ok(Opcode::DynamicData));
        assert_eq!(Opcode::try_from(0x22), Ok(Opcode::DynamicClear));
        assert_eq!(Opcode::try_from(0x23), Ok(Opcode::Capabilities));

        let capabilities = build_capabilities_request(1).unwrap();
        assert_eq!(validate_request(&capabilities), Ok(Opcode::Capabilities));
        assert_eq!(capabilities[SLOT_OFFSET], DYNAMIC_FIRST_SLOT);
        assert!(capabilities[PAYLOAD_OFFSET..].iter().all(|byte| *byte == 0));

        for (ttl, keep, expected_length) in [
            (None, false, 0),
            (None, true, 1),
            (Some(600), false, 4),
            (Some(600), true, 5),
        ] {
            let begin = build_dynamic_begin_request(2, 7, 23, ttl, keep).unwrap();
            assert_eq!(validate_request(&begin), Ok(Opcode::DynamicBegin));
            assert_eq!(begin[SLOT_OFFSET], 7);
            assert_eq!(begin[PAYLOAD_LENGTH_OFFSET] as usize, expected_length);
            assert!(begin[PAYLOAD_OFFSET + expected_length..]
                .iter()
                .all(|byte| *byte == 0));
            assert_eq!(read_u16(&begin, TOTAL_LENGTH_OFFSET), 23);
        }

        let data = build_dynamic_data_request(2, 7, 22, 23, b"x").unwrap();
        assert_eq!(validate_request(&data), Ok(Opcode::DynamicData));
        assert_eq!(data[SLOT_OFFSET], 7);
        let clear = build_dynamic_clear_request(3, 7).unwrap();
        assert_eq!(validate_request(&clear), Ok(Opcode::DynamicClear));
        assert_eq!(clear[SLOT_OFFSET], 7);
        assert!(build_dynamic_begin_request(2, 0, 0, None, false).is_err());
        assert!(build_dynamic_begin_request(2, 0, 1, Some(0), false).is_err());
        assert!(build_dynamic_begin_request(2, 0, 1, Some(86_401), false).is_err());
        assert!(build_frame(Opcode::DynamicBegin, 2, LIST_SLOT, &[2], 0, 1).is_err());
    }

    #[test]
    fn dynamic_slot_validation_rejects_sentinel_and_protocol_out_of_range() {
        assert!(dynamic_slot_is_valid(0, DYNAMIC_SLOT_COUNT_MAX));
        assert!(dynamic_slot_is_valid(7, DYNAMIC_SLOT_COUNT_MAX));
        assert!(!dynamic_slot_is_valid(LIST_SLOT, DYNAMIC_SLOT_COUNT_MAX));
        assert!(!dynamic_slot_is_valid(8, DYNAMIC_SLOT_COUNT_MAX));
        assert!(!dynamic_slot_is_valid(9, DYNAMIC_SLOT_COUNT_MAX));
        assert!(!dynamic_slot_is_valid(0, 0));
        assert!(!dynamic_slot_is_valid(0, 9));
        assert!(dynamic_slot_is_valid(0, 1));
        assert!(!dynamic_slot_is_valid(1, 1));
        assert!(dynamic_slot_is_valid(7, 8));

        // Slot 0 and the highest valid object index are accepted; the static
        // LIST sentinel and every index above it are not.
        for slot in [0u8, 7] {
            assert_eq!(
                validate_request(&build_dynamic_begin_request(1, slot, 1, None, false).unwrap()),
                Ok(Opcode::DynamicBegin)
            );
            assert_eq!(
                validate_request(&build_dynamic_data_request(1, slot, 0, 1, b"x").unwrap()),
                Ok(Opcode::DynamicData)
            );
            assert_eq!(
                validate_request(&build_dynamic_clear_request(1, slot).unwrap()),
                Ok(Opcode::DynamicClear)
            );
        }
        for slot in [LIST_SLOT, 8, 16, 0xfe] {
            assert!(matches!(
                build_dynamic_begin_request(1, slot, 1, None, false),
                Err(ProtocolError::InvalidRequest { .. })
            ));
            assert!(matches!(
                build_dynamic_data_request(1, slot, 0, 1, b"x"),
                Err(ProtocolError::InvalidRequest { .. })
            ));
            assert!(matches!(
                build_dynamic_clear_request(1, slot),
                Err(ProtocolError::InvalidRequest { .. })
            ));
            assert!(matches!(
                build_frame(Opcode::Capabilities, 1, slot, &[], 0, 0),
                Err(ProtocolError::InvalidRequest { .. })
            ));
            assert!(matches!(
                validate_request(&{
                    let mut frame = build_dynamic_clear_request(1, 0).unwrap();
                    frame[SLOT_OFFSET] = slot;
                    frame
                }),
                Err(ProtocolError::InvalidRequest { .. })
            ));
        }
    }

    #[test]
    fn dynamic_length_bounds_follow_the_512_byte_object_contract() {
        assert_eq!(MAX_DYNAMIC_TEXT_LENGTH, 512);

        for total in [1usize, 22, 23, 511, 512] {
            let begin = build_dynamic_begin_request(1, 0, total, None, false).unwrap();
            assert_eq!(read_u16(&begin, TOTAL_LENGTH_OFFSET), total as u16);
            assert_eq!(validate_request(&begin), Ok(Opcode::DynamicBegin));
        }
        assert!(build_dynamic_begin_request(1, 0, 0, None, false).is_err());
        assert!(build_dynamic_begin_request(1, 0, 513, None, false).is_err());

        // A 512-byte object needs 24 chunks: 23 full 22-byte chunks plus 6 bytes.
        let mut offset = 0usize;
        let mut chunks = 0usize;
        while offset < 512 {
            let end = (offset + PAYLOAD_SIZE).min(512);
            let chunk = &[b'x'; PAYLOAD_SIZE][..end - offset];
            let request = build_dynamic_data_request(1, 0, offset, 512, chunk).unwrap();
            assert_eq!(validate_request(&request), Ok(Opcode::DynamicData));
            assert_eq!(read_u16(&request, OFFSET_OFFSET) as usize, offset);
            assert_eq!(request[PAYLOAD_LENGTH_OFFSET] as usize, chunk.len());
            offset = end;
            chunks += 1;
        }
        assert_eq!(chunks, 24);

        let final_chunk = build_dynamic_data_request(1, 0, 506, 512, &[b'x'; 6]).unwrap();
        assert_eq!(validate_request(&final_chunk), Ok(Opcode::DynamicData));
        assert!(build_dynamic_data_request(1, 0, 506, 512, &[b'x'; 7]).is_err());
        let final_byte = build_dynamic_data_request(1, 0, 511, 512, b"x").unwrap();
        assert_eq!(validate_request(&final_byte), Ok(Opcode::DynamicData));
        assert!(build_dynamic_data_request(1, 0, 512, 512, b"x").is_err());
        assert!(build_dynamic_data_request(1, 0, 0, 513, &[b'x'; 22]).is_err());
        assert_eq!(
            build_dynamic_data_request(1, 0, 0, 512, &[b'x'; PAYLOAD_SIZE + 1]),
            Err(ProtocolError::PayloadTooLong {
                length: PAYLOAD_SIZE + 1
            })
        );
    }

    #[test]
    fn dynamic_capability_parser_rejects_reserved_and_noncanonical_metadata() {
        fn capability_response(request: &Frame, object_count: u8, version: u8) -> Frame {
            let mut response = response_for(request, Status::Ok as u8);
            response[PAYLOAD_LENGTH_OFFSET] = DYNAMIC_CAPABILITIES_LENGTH as u8;
            response[TOTAL_LENGTH_OFFSET..TOTAL_LENGTH_OFFSET + 2]
                .copy_from_slice(&(DYNAMIC_CAPABILITIES_LENGTH as u16).to_le_bytes());
            response[PAYLOAD_OFFSET] = version;
            response[PAYLOAD_OFFSET + 1] = object_count;
            response[PAYLOAD_OFFSET + 2..PAYLOAD_OFFSET + 4]
                .copy_from_slice(&0x004f_u16.to_le_bytes());
            response[PAYLOAD_OFFSET + 4..PAYLOAD_OFFSET + 6]
                .copy_from_slice(&(MAX_DYNAMIC_TEXT_LENGTH as u16).to_le_bytes());
            response[PAYLOAD_OFFSET + 6..PAYLOAD_OFFSET + 10]
                .copy_from_slice(&DYNAMIC_DEFAULT_TTL_SECONDS.to_le_bytes());
            response[PAYLOAD_OFFSET + 10..PAYLOAD_OFFSET + 14]
                .copy_from_slice(&DYNAMIC_MIN_TTL_SECONDS.to_le_bytes());
            response[PAYLOAD_OFFSET + 14..PAYLOAD_OFFSET + 18]
                .copy_from_slice(&DYNAMIC_MAX_TTL_SECONDS.to_le_bytes());
            response[PAYLOAD_OFFSET + 18..PAYLOAD_OFFSET + 22]
                .copy_from_slice(&DYNAMIC_TRANSACTION_TIMEOUT_SECONDS.to_le_bytes());
            response
        }

        let request = build_capabilities_request(7).unwrap();
        assert_eq!(request[SLOT_OFFSET], DYNAMIC_FIRST_SLOT);
        let response = capability_response(&request, 8, DYNAMIC_CAPABILITY_VERSION);
        assert_eq!(
            parse_dynamic_capabilities_response(&response).unwrap(),
            DynamicCapabilities {
                capability_version: 2,
                dynamic_object_count: 8,
                lifecycle_flags: 0x004f,
                max_dynamic_length: 512,
                default_ttl_seconds: 300,
                min_ttl_seconds: 1,
                max_ttl_seconds: 86_400,
                transaction_timeout_seconds: 30,
            }
        );
        assert_eq!(
            parse_dynamic_capabilities_response(&capability_response(
                &request,
                1,
                DYNAMIC_CAPABILITY_VERSION
            ))
            .unwrap()
            .dynamic_object_count,
            1
        );

        // A capability answer must belong to a real object index: the static
        // LIST sentinel and any index above the reported object count are
        // malformed metadata.
        let mut sentinel_slot = response;
        sentinel_slot[SLOT_OFFSET] = LIST_SLOT;
        assert_eq!(
            parse_dynamic_capabilities_response(&sentinel_slot),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );
        let mut out_of_range_slot = response;
        out_of_range_slot[SLOT_OFFSET] = 8;
        assert_eq!(
            parse_dynamic_capabilities_response(&out_of_range_slot),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );
        let mut single_object = capability_response(&request, 1, DYNAMIC_CAPABILITY_VERSION);
        single_object[SLOT_OFFSET] = 1;
        assert_eq!(
            parse_dynamic_capabilities_response(&single_object),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );

        for (offset, value) in [
            (PAYLOAD_OFFSET, 1),     // v1 capability version is never accepted
            (PAYLOAD_OFFSET, 3),     // unknown future capability version
            (PAYLOAD_OFFSET + 1, 0), // object count below the protocol minimum
            (PAYLOAD_OFFSET + 1, 9), // object count above the protocol maximum
        ] {
            let mut malformed = response;
            malformed[offset] = value;
            assert_eq!(
                parse_dynamic_capabilities_response(&malformed),
                Err(ProtocolError::InvalidDynamicCapabilities)
            );
        }

        let mut v1_length = response;
        v1_length[PAYLOAD_OFFSET + 4..PAYLOAD_OFFSET + 6]
            .copy_from_slice(&(MAX_TEXT_LENGTH as u16).to_le_bytes());
        assert_eq!(
            parse_dynamic_capabilities_response(&v1_length),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );

        let mut reserved = response;
        reserved[PAYLOAD_OFFSET + 2..PAYLOAD_OFFSET + 4].copy_from_slice(&0x008f_u16.to_le_bytes());
        assert_eq!(
            parse_dynamic_capabilities_response(&reserved),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );

        let mut missing_required_flag = response;
        missing_required_flag[PAYLOAD_OFFSET + 2..PAYLOAD_OFFSET + 4]
            .copy_from_slice(&0x004c_u16.to_le_bytes());
        assert_eq!(
            parse_dynamic_capabilities_response(&missing_required_flag),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );

        let mut bad_length = response;
        bad_length[PAYLOAD_LENGTH_OFFSET] = (DYNAMIC_CAPABILITIES_LENGTH - 1) as u8;
        assert_eq!(
            parse_dynamic_capabilities_response(&bad_length),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );

        let mut wrong_offset = response;
        wrong_offset[OFFSET_OFFSET] = 1;
        assert_eq!(
            parse_dynamic_capabilities_response(&wrong_offset),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );

        // The capability response has no padding space: the payload fills the
        // whole frame, so a short declared length is the only malformed-payload
        // shape the firmware can produce.
        let mut short_payload = response;
        short_payload[PAYLOAD_LENGTH_OFFSET] = (DYNAMIC_CAPABILITIES_LENGTH - 1) as u8;
        assert_eq!(
            parse_dynamic_capabilities_response(&short_payload),
            Err(ProtocolError::InvalidDynamicCapabilities)
        );
    }

    #[test]
    fn v2_auth_opcodes_and_status_values_are_stable() {
        assert_eq!(Opcode::try_from(0x10), Ok(Opcode::AuthInfo));
        assert_eq!(Opcode::try_from(0x11), Ok(Opcode::AuthChallenge));
        assert_eq!(Opcode::try_from(0x12), Ok(Opcode::AuthProve));
        assert_eq!(Opcode::try_from(0x13), Ok(Opcode::PasswordSet));
        assert_eq!(Opcode::try_from(0x14), Ok(Opcode::Lock));
        assert_eq!(Status::try_from(10), Ok(Status::AuthRequired));
        assert_eq!(Status::try_from(11), Ok(Status::AuthFailed));
        assert_eq!(Status::try_from(12), Ok(Status::AuthNotConfigured));
        assert_eq!(Status::try_from(13), Ok(Status::RateLimited));
        assert_eq!(Status::try_from(14), Ok(Status::AuthNoChallenge));
        assert_eq!(Status::try_from(15), Ok(Status::CredentialInvalid));
    }

    #[test]
    fn auth_info_and_challenge_parsers_reject_noncanonical_metadata() {
        let request = build_auth_info_request(7).unwrap();
        let mut open = response_for(&request, Status::Ok as u8);
        open[PAYLOAD_LENGTH_OFFSET] = AUTH_INFO_LENGTH as u8;
        open[TOTAL_LENGTH_OFFSET..TOTAL_LENGTH_OFFSET + 2]
            .copy_from_slice(&(AUTH_INFO_LENGTH as u16).to_le_bytes());
        open[PAYLOAD_OFFSET + 1] = KDF_ID;
        open[PAYLOAD_OFFSET + 2..PAYLOAD_OFFSET + 6]
            .copy_from_slice(&DEFAULT_ITERATIONS.to_le_bytes());
        assert_eq!(
            parse_auth_info_response(&open).unwrap(),
            AuthInfo {
                password_configured: false,
                session_authenticated: false,
                kdf_id: KDF_ID,
                iterations: DEFAULT_ITERATIONS,
                salt: [0; 16],
            }
        );

        let mut protected = open;
        protected[PAYLOAD_OFFSET] = PASSWORD_CONFIGURED_FLAG;
        protected[PAYLOAD_OFFSET + 2..PAYLOAD_OFFSET + 6]
            .copy_from_slice(&MIN_ITERATIONS.to_le_bytes());
        protected[PAYLOAD_OFFSET + 6..PAYLOAD_OFFSET + 22].copy_from_slice(&[3; 16]);
        assert!(parse_auth_info_response(&protected).unwrap().is_protected());

        let mut bad_flags = protected;
        bad_flags[PAYLOAD_OFFSET] = 0x80;
        assert!(matches!(
            parse_auth_info_response(&bad_flags),
            Err(ProtocolError::InvalidAuthFlags { flags: 0x80 })
        ));

        let mut bad_open = open;
        bad_open[PAYLOAD_OFFSET + 6] = 1;
        assert_eq!(
            parse_auth_info_response(&bad_open),
            Err(ProtocolError::InvalidAuthInfo)
        );

        let challenge_request = build_auth_challenge_request(8).unwrap();
        let mut challenge = response_for(&challenge_request, Status::Ok as u8);
        challenge[PAYLOAD_LENGTH_OFFSET] = AUTH_CHALLENGE_LENGTH as u8;
        challenge[TOTAL_LENGTH_OFFSET..TOTAL_LENGTH_OFFSET + 2]
            .copy_from_slice(&(AUTH_CHALLENGE_LENGTH as u16).to_le_bytes());
        challenge[PAYLOAD_OFFSET..PAYLOAD_OFFSET + NONCE_SIZE].copy_from_slice(&[4; NONCE_SIZE]);
        assert!(parse_auth_challenge_response(&challenge).is_ok());

        let mut zero_nonce = challenge;
        zero_nonce[PAYLOAD_OFFSET..PAYLOAD_OFFSET + NONCE_SIZE].fill(0);
        assert!(matches!(
            parse_auth_challenge_response(&zero_nonce),
            Err(ProtocolError::InvalidAuthChallenge)
        ));

        let mut wrong_shape = challenge;
        wrong_shape[PAYLOAD_OFFSET + AUTH_CHALLENGE_LENGTH] = 1;
        assert!(matches!(
            parse_auth_challenge_response(&wrong_shape),
            Err(ProtocolError::InvalidAuthChallenge)
        ));
    }

    #[test]
    fn validate_request_rejects_v1_and_nonzero_status_or_padding() {
        let mut request = build_auth_info_request(1).unwrap();
        request[VERSION_OFFSET] = 1;
        assert_eq!(
            validate_request(&request),
            Err(ProtocolError::UnsupportedVersion { actual: 1 })
        );

        let mut request = build_auth_info_request(2).unwrap();
        request[STATUS_OFFSET] = Status::BadRequest as u8;
        assert_eq!(
            validate_request(&request),
            Err(ProtocolError::InvalidRequestStatus {
                actual: Status::BadRequest as u8
            })
        );

        let mut request = build_auth_info_request(3).unwrap();
        request[PAYLOAD_OFFSET] = 1;
        assert_eq!(
            validate_request(&request),
            Err(ProtocolError::NonZeroPayloadPadding)
        );

        assert!(matches!(
            build_frame(Opcode::AuthChallenge, 0, 0, &[], 0, 0),
            Err(ProtocolError::InvalidAuthRequest { .. })
        ));
        assert!(matches!(
            build_password_set_chunk(0, 43, &[0xa5; 10]),
            Err(ProtocolError::InvalidAuthRequest { .. })
        ));
    }

    #[test]
    fn builder_rejects_payload_larger_than_one_frame() {
        assert_eq!(
            build_frame(Opcode::Set, 0, 0, &[b'x'; PAYLOAD_SIZE + 1], 0, 0),
            Err(ProtocolError::PayloadTooLong {
                length: PAYLOAD_SIZE + 1
            })
        );
    }

    #[test]
    fn response_normalization_requires_exact_frame_or_zero_report_id() {
        assert_eq!(
            normalize_response(&[0u8; FRAME_SIZE]),
            Ok([0u8; FRAME_SIZE])
        );
        assert_eq!(
            normalize_response(&[0u8; FRAME_SIZE + 1]),
            Ok([0u8; FRAME_SIZE])
        );
        assert_eq!(
            normalize_response(&[1u8; FRAME_SIZE + 1]),
            Err(ProtocolError::NonZeroReportId(1))
        );
        assert_eq!(
            normalize_response(&[0u8; FRAME_SIZE - 1]),
            Err(ProtocolError::FrameLength {
                actual: FRAME_SIZE - 1
            })
        );
        assert_eq!(
            normalize_response(&[0u8; FRAME_SIZE + 2]),
            Err(ProtocolError::FrameLength {
                actual: FRAME_SIZE + 2
            })
        );
    }

    #[test]
    fn response_validation_checks_identity_status_padding_and_error_shape() {
        let request = build_frame(Opcode::Get, 9, 2, &[], 0, 0).unwrap();

        for (offset, field) in [
            (VERSION_OFFSET, "version"),
            (OPCODE_OFFSET, "opcode"),
            (REQUEST_ID_OFFSET, "request_id"),
            (SLOT_OFFSET, "slot"),
        ] {
            let mut response = response_for(&request, Status::Ok as u8);
            response[offset] = response[offset].wrapping_add(1);
            assert_eq!(
                validate_response(&request, &response),
                Err(ProtocolError::ResponseFieldMismatch {
                    field,
                    expected: request[offset],
                    actual: response[offset]
                })
            );
        }

        let mut unknown_status = response_for(&request, 0);
        unknown_status[STATUS_OFFSET] = 0xff;
        assert_eq!(
            validate_response(&request, &unknown_status),
            Err(ProtocolError::UnknownStatus(0xff))
        );

        let mut bad_padding = response_for(&request, Status::Ok as u8);
        bad_padding[PAYLOAD_LENGTH_OFFSET] = 1;
        bad_padding[PAYLOAD_OFFSET + 1] = 1;
        assert_eq!(
            validate_response(&request, &bad_padding),
            Err(ProtocolError::NonZeroPayloadPadding)
        );

        let mut nonempty_error = response_for(&request, Status::BadLength as u8);
        nonempty_error[PAYLOAD_LENGTH_OFFSET] = 1;
        nonempty_error[PAYLOAD_OFFSET] = b'x';
        assert_eq!(
            validate_response(&request, &nonempty_error),
            Err(ProtocolError::ErrorResponseNotEmpty)
        );

        let mut bad_error_range = response_for(&request, Status::BadLength as u8);
        bad_error_range[OFFSET_OFFSET] = 1;
        assert_eq!(
            validate_response(&request, &bad_error_range),
            Err(ProtocolError::ErrorResponseNotEmpty)
        );
    }

    #[test]
    fn text_validation_accepts_only_firmware_supported_bytes() {
        assert!(validate_text(b"printable ~\n\t\x08").is_ok());
        for byte in [0x00, 0x07, 0x0b, 0x1f, 0x7f, 0x80, 0xff] {
            let error = validate_text(&[byte]).unwrap_err();
            assert_eq!(error, TextError { index: 0, byte });
        }
        let error = validate_text(b"ok\x00").unwrap_err();
        assert_eq!(error, TextError { index: 2, byte: 0 });
    }
}
