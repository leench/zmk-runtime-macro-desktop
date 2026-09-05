use crate::auth::{Nonce, DEFAULT_ITERATIONS, KDF_ID, MAX_ITERATIONS, MIN_ITERATIONS, NONCE_SIZE};
use crate::error::{ProtocolError, TextError};
use zeroize::Zeroize;

pub const FRAME_SIZE: usize = 32;
pub const HEADER_SIZE: usize = 10;
pub const PAYLOAD_SIZE: usize = FRAME_SIZE - HEADER_SIZE;
pub const MAX_TEXT_LENGTH: usize = 256;
pub const VERSION: u8 = 2;
pub const LIST_SLOT: u8 = 0xff;
pub const AUTH_SLOT: u8 = LIST_SLOT;
pub const PASSWORD_SET_LENGTH: usize = 52;
pub const AUTH_INFO_LENGTH: usize = 22;
pub const AUTH_CHALLENGE_LENGTH: usize = NONCE_SIZE;
pub const AUTH_PROVE_LENGTH: usize = 16;
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

pub fn read_u16(frame: &Frame, offset: usize) -> u16 {
    u16::from_le_bytes([frame[offset], frame[offset + 1]])
}

fn write_u16(frame: &mut Frame, offset: usize, value: u16) {
    frame[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
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
