use crate::error::{ProtocolError, TextError};

pub const FRAME_SIZE: usize = 32;
pub const HEADER_SIZE: usize = 10;
pub const PAYLOAD_SIZE: usize = FRAME_SIZE - HEADER_SIZE;
pub const MAX_TEXT_LENGTH: usize = 256;
pub const VERSION: u8 = 1;
pub const LIST_SLOT: u8 = 0xff;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Opcode {
    List = 1,
    Get = 2,
    Set = 3,
    Clear = 4,
}

impl TryFrom<u8> for Opcode {
    type Error = ProtocolError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::List),
            2 => Ok(Self::Get),
            3 => Ok(Self::Set),
            4 => Ok(Self::Clear),
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
            value => Err(ProtocolError::UnknownStatus(value)),
        }
    }
}

pub fn read_u16(frame: &Frame, offset: usize) -> u16 {
    u16::from_le_bytes([frame[offset], frame[offset + 1]])
}

fn write_u16(frame: &mut Frame, offset: usize, value: u16) {
    frame[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

/// Build a canonical v1 request. The frame starts zero-filled, including all
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
        let frame = build_frame(Opcode::Set, 7, 4, b"xy", 0x1234, 0x5678).unwrap();
        let mut expected = [0u8; FRAME_SIZE];
        expected[..10].copy_from_slice(&[1, 3, 7, 0, 4, 2, 0x34, 0x12, 0x78, 0x56]);
        expected[10..12].copy_from_slice(b"xy");
        assert_eq!(frame, expected);
        assert_eq!(read_u16(&frame, OFFSET_OFFSET), 0x1234);
        assert_eq!(read_u16(&frame, TOTAL_LENGTH_OFFSET), 0x5678);
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
