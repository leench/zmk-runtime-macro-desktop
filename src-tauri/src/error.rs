use std::fmt;

use crate::protocol::Status;

/// Errors while turning a user password into v2 authentication material.
///
/// This type intentionally carries no password-derived bytes so it is safe to
/// move through the client and command error layers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthError {
    EmptyPassword,
    InvalidIterations,
    InvalidSalt,
    InvalidDerivedKey,
    InvalidNonce,
    RandomnessUnavailable,
}

impl fmt::Display for AuthError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::EmptyPassword => "password must not be empty",
            Self::InvalidIterations => {
                "password derivation iterations are outside the supported range"
            }
            Self::InvalidSalt => "password derivation salt is invalid",
            Self::InvalidDerivedKey => "password derivation produced an invalid key",
            Self::InvalidNonce => "the authentication challenge is invalid",
            Self::RandomnessUnavailable => {
                "the operating system secure random source is unavailable"
            }
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for AuthError {}

/// Errors reported by the transport implementation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// The response did not arrive before the requested deadline.
    Timeout,
    /// A temporary transport failure for which the complete operation may be retried.
    Recoverable(String),
    /// A transport failure that must be surfaced without an automatic retry.
    Fatal(String),
}

impl TransportError {
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Timeout | Self::Recoverable(_))
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Timeout => write!(formatter, "timed out waiting for HID response"),
            Self::Recoverable(message) => {
                write!(formatter, "recoverable transport error: {message}")
            }
            Self::Fatal(message) => write!(formatter, "transport error: {message}"),
        }
    }
}

impl std::error::Error for TransportError {}

/// Errors in a fixed-size v2 frame or in a response's wire-level invariants.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    FrameLength {
        actual: usize,
    },
    NonZeroReportId(u8),
    PayloadTooLong {
        length: usize,
    },
    UnknownOpcode(u8),
    UnknownStatus(u8),
    UnsupportedVersion {
        actual: u8,
    },
    InvalidRequestStatus {
        actual: u8,
    },
    InvalidRequest {
        operation: &'static str,
    },
    InvalidAuthRequest {
        operation: &'static str,
    },
    InvalidAuthInfo,
    PasswordSetConfirmationMismatch,
    InvalidAuthChallenge,
    InvalidAuthFlags {
        flags: u8,
    },
    UnsupportedKdf {
        id: u8,
    },
    ResponseFieldMismatch {
        field: &'static str,
        expected: u8,
        actual: u8,
    },
    NonZeroPayloadPadding,
    ErrorResponseNotEmpty,
    PageOffsetMismatch {
        operation: &'static str,
        expected: u16,
        actual: u16,
    },
    PageTotalChanged {
        operation: &'static str,
        expected: u16,
        actual: u16,
    },
    PageExceedsTotal {
        operation: &'static str,
    },
    PageMadeNoProgress {
        operation: &'static str,
    },
    InvalidLogicalLength {
        operation: &'static str,
    },
    UnexpectedResponsePayload {
        operation: &'static str,
    },
    SetAckOffset {
        expected: u16,
        actual: u16,
    },
    SetAckTotal {
        expected: u16,
        actual: u16,
    },
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FrameLength { actual } => {
                write!(
                    formatter,
                    "response has length {actual}, expected 32 or 33 bytes"
                )
            }
            Self::NonZeroReportId(id) => write!(formatter, "response has non-zero report ID {id}"),
            Self::PayloadTooLong { length } => {
                write!(formatter, "payload length {length} exceeds 22 bytes")
            }
            Self::UnknownOpcode(opcode) => write!(formatter, "unknown opcode {opcode}"),
            Self::UnknownStatus(status) => {
                write!(formatter, "response has unknown status {status}")
            }
            Self::UnsupportedVersion { actual } => {
                write!(formatter, "protocol version {actual} is unsupported")
            }
            Self::InvalidRequestStatus { actual } => {
                write!(formatter, "request status must be zero, got {actual}")
            }
            Self::InvalidRequest { operation } => {
                write!(formatter, "invalid {operation} request fields")
            }
            Self::InvalidAuthRequest { operation } => {
                write!(formatter, "invalid {operation} request fields")
            }
            Self::InvalidAuthInfo => write!(formatter, "invalid AUTH_INFO response fields"),
            Self::PasswordSetConfirmationMismatch => {
                write!(
                    formatter,
                    "PASSWORD_SET confirmation did not show the new credential"
                )
            }
            Self::InvalidAuthChallenge => {
                write!(formatter, "invalid AUTH_CHALLENGE response fields")
            }
            Self::InvalidAuthFlags { flags } => {
                write!(
                    formatter,
                    "AUTH_INFO contains unsupported flags {flags:#04x}"
                )
            }
            Self::UnsupportedKdf { id } => {
                write!(formatter, "AUTH_INFO contains unsupported KDF {id}")
            }
            Self::ResponseFieldMismatch {
                field,
                expected,
                actual,
            } => write!(
                formatter,
                "response {field} does not match request (expected {expected}, got {actual})"
            ),
            Self::NonZeroPayloadPadding => {
                write!(formatter, "response payload padding is not zero")
            }
            Self::ErrorResponseNotEmpty => {
                write!(
                    formatter,
                    "error response contains payload or non-zero range"
                )
            }
            Self::PageOffsetMismatch {
                operation,
                expected,
                actual,
            } => write!(
                formatter,
                "{operation} response offset {actual} does not match requested offset {expected}"
            ),
            Self::PageTotalChanged {
                operation,
                expected,
                actual,
            } => write!(
                formatter,
                "{operation} response total changed from {expected} to {actual}"
            ),
            Self::PageExceedsTotal { operation } => {
                write!(formatter, "{operation} response exceeds logical result")
            }
            Self::PageMadeNoProgress { operation } => {
                write!(formatter, "{operation} response made no progress")
            }
            Self::InvalidLogicalLength { operation } => {
                write!(formatter, "{operation} logical result has invalid length")
            }
            Self::UnexpectedResponsePayload { operation } => {
                write!(
                    formatter,
                    "{operation} acknowledgement contains a payload or range"
                )
            }
            Self::SetAckOffset { expected, actual } => {
                write!(
                    formatter,
                    "SET acknowledgement offset is {actual}, expected {expected}"
                )
            }
            Self::SetAckTotal { expected, actual } => {
                write!(
                    formatter,
                    "SET acknowledgement total is {actual}, expected {expected}"
                )
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

/// A byte that is not accepted by the firmware's macro text mapping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextError {
    pub index: usize,
    pub byte: u8,
}

impl fmt::Display for TextError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "unsupported text byte 0x{:02x} at index {}; only printable ASCII, LF, TAB, and Backspace are allowed",
            self.byte, self.index
        )
    }
}

impl std::error::Error for TextError {}

/// Errors returned by the protocol client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientError {
    Transport(TransportError),
    Protocol(ProtocolError),
    Auth(AuthError),
    Remote(Status),
    InvalidSlot(u8),
    InvalidText(TextError),
    LengthExceeded { length: usize, maximum: usize },
    InvalidConfiguration(&'static str),
}

impl fmt::Display for ClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(error) => error.fmt(formatter),
            Self::Protocol(error) => error.fmt(formatter),
            Self::Auth(error) => error.fmt(formatter),
            Self::Remote(status) => write!(
                formatter,
                "firmware returned {status:?} ({})",
                *status as u8
            ),
            Self::InvalidSlot(slot) => write!(formatter, "slot {slot} must be between 0 and 254"),
            Self::InvalidText(error) => error.fmt(formatter),
            Self::LengthExceeded { length, maximum } => {
                write!(
                    formatter,
                    "text length {length} exceeds protocol maximum {maximum} bytes"
                )
            }
            Self::InvalidConfiguration(message) => {
                write!(formatter, "invalid client configuration: {message}")
            }
        }
    }
}

impl std::error::Error for ClientError {}

impl From<TransportError> for ClientError {
    fn from(error: TransportError) -> Self {
        Self::Transport(error)
    }
}

impl From<AuthError> for ClientError {
    fn from(error: AuthError) -> Self {
        Self::Auth(error)
    }
}

impl From<ProtocolError> for ClientError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
}

impl From<TextError> for ClientError {
    fn from(error: TextError) -> Self {
        Self::InvalidText(error)
    }
}
