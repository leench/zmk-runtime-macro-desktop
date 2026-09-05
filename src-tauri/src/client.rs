use std::time::{Duration, Instant};

use zeroize::Zeroizing;

use crate::auth::{AuthSession, Credential, SALT_SIZE};
use crate::error::{ClientError, ProtocolError, TransportError};
use crate::protocol::{
    build_auth_challenge_request, build_auth_info_request, build_auth_prove_request, build_frame,
    build_lock_request, build_password_set_chunk, normalize_response,
    parse_auth_challenge_response, parse_auth_info_response, read_u16, response_identity_matches,
    validate_empty_success, validate_response, validate_text, AuthInfo, Frame, Opcode, Status,
    LIST_SLOT, MAX_TEXT_LENGTH, OFFSET_OFFSET, PASSWORD_SET_LENGTH, PAYLOAD_LENGTH_OFFSET,
    PAYLOAD_OFFSET, PAYLOAD_SIZE, TOTAL_LENGTH_OFFSET,
};

pub const DEFAULT_TIMEOUT_MS: u64 = 1_000;
pub const DEFAULT_RETRIES: usize = 2;
pub const MIN_TIMEOUT_MS: u64 = 100;
pub const MAX_TIMEOUT_MS: u64 = 5_000;
pub const MAX_RETRIES: usize = 5;
const MAX_LIST_RESULT_LENGTH: usize = 1 + 2 * u8::MAX as usize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientConfig {
    pub timeout_ms: u64,
    pub retries: usize,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            timeout_ms: DEFAULT_TIMEOUT_MS,
            retries: DEFAULT_RETRIES,
        }
    }
}

impl ClientConfig {
    pub fn new(timeout_ms: u64, retries: usize) -> Result<Self, ClientError> {
        if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
            return Err(ClientError::InvalidConfiguration(
                "timeout must be between 100 and 5000 milliseconds",
            ));
        }
        if retries > MAX_RETRIES {
            return Err(ClientError::InvalidConfiguration(
                "retries must be between 0 and 5",
            ));
        }
        Ok(Self {
            timeout_ms,
            retries,
        })
    }
}

/// A transport-independent interface for the fixed-frame protocol client.
///
/// Implementations own the platform-specific HID details. Reads may return a
/// 32-byte frame or a 33-byte frame with a leading zero report ID; the client
/// normalizes and validates that shape before interpreting a response.
pub trait Transport {
    fn write_frame(&mut self, frame: &Frame) -> Result<(), TransportError>;
    fn read_frame(&mut self, timeout: Duration) -> Result<Vec<u8>, TransportError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlotInfo {
    pub slot: u8,
    pub length: u16,
}

pub struct RuntimeMacroClient<T> {
    transport: T,
    timeout: Duration,
    retries: usize,
    next_request_id: u8,
    auth_session: AuthSession,
}

impl<T: Transport> RuntimeMacroClient<T> {
    pub fn new(transport: T, timeout_ms: u64, retries: usize) -> Result<Self, ClientError> {
        if timeout_ms == 0 {
            return Err(ClientError::InvalidConfiguration(
                "timeout must be greater than zero",
            ));
        }

        Ok(Self {
            transport,
            timeout: Duration::from_millis(timeout_ms),
            retries,
            next_request_id: 0,
            auth_session: AuthSession::new(),
        })
    }

    pub fn with_config(transport: T, config: ClientConfig) -> Self {
        Self {
            transport,
            timeout: Duration::from_millis(config.timeout_ms),
            retries: config.retries,
            next_request_id: 0,
            auth_session: AuthSession::new(),
        }
    }

    pub fn with_defaults(transport: T) -> Self {
        Self::with_config(transport, ClientConfig::default())
    }

    pub fn transport_mut(&mut self) -> &mut T {
        &mut self.transport
    }

    pub fn is_authenticated(&self) -> bool {
        self.auth_session.is_authenticated()
    }

    pub fn is_protected(&self) -> bool {
        self.auth_session.is_protected()
    }

    fn take_request_id(&mut self) -> u8 {
        let request_id = self.next_request_id;
        self.next_request_id = self.next_request_id.wrapping_add(1);
        request_id
    }

    fn exchange(&mut self, request: &Frame) -> Result<Frame, ClientError> {
        self.transport.write_frame(request)?;
        let deadline = Instant::now() + self.timeout;

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(TransportError::Timeout.into());
            }

            let raw_response = self.transport.read_frame(remaining)?;
            let response = normalize_response(&raw_response)?;

            // HID input queues can contain a response left behind by a host
            // timeout. Discard only a response for a different transaction;
            // a matching response with a bad version or malformed fields must
            // be reported as a protocol error.
            if !response_identity_matches(request, &response) {
                continue;
            }
            return Ok(response);
        }
    }

    fn call(&mut self, request: &Frame) -> Result<Frame, ClientError> {
        let response = self.exchange(request)?;
        match validate_response(request, &response)? {
            Status::Ok => Ok(response),
            status => {
                if matches!(
                    status,
                    Status::AuthRequired
                        | Status::AuthFailed
                        | Status::AuthNoChallenge
                        | Status::AuthNotConfigured
                ) {
                    self.auth_session.clear_session();
                }
                Err(ClientError::Remote(status))
            }
        }
    }

    fn call_with_transport_retry<F>(&mut self, mut make_request: F) -> Result<Frame, ClientError>
    where
        F: FnMut(u8) -> Result<Frame, ClientError>,
    {
        let mut last_error = None;
        for _ in 0..=self.retries {
            let request = make_request(self.take_request_id())?;
            match self.call(&request) {
                Ok(response) => return Ok(response),
                Err(ClientError::Transport(error)) if error.is_retryable() => {
                    last_error = Some(ClientError::Transport(error));
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_error.expect("at least one transport attempt is always made"))
    }

    /// Query the public authentication state and KDF parameters.
    pub fn auth_info(&mut self) -> Result<AuthInfo, ClientError> {
        let response = match self.call_with_transport_retry(|request_id| {
            build_auth_info_request(request_id).map_err(ClientError::from)
        }) {
            Ok(response) => response,
            Err(error) => {
                self.auth_session.clear_session();
                return Err(error);
            }
        };
        let info = match parse_auth_info_response(&response) {
            Ok(info) => info,
            Err(error) => {
                // AUTH_INFO is the device-authoritative session observation;
                // never retain a prior authenticated state after a malformed
                // or otherwise non-canonical successful response.
                self.auth_session.clear_session();
                return Err(error.into());
            }
        };
        self.auth_session
            .observe(info.password_configured, info.session_authenticated);
        Ok(info)
    }

    /// Request a fresh one-time challenge. Transport retries create a fresh
    /// request ID and must be parsed as a new challenge; no old nonce is
    /// retained by the client.
    pub fn auth_challenge(&mut self) -> Result<crate::auth::Nonce, ClientError> {
        let response = self.call_with_transport_retry(|request_id| {
            build_auth_challenge_request(request_id).map_err(ClientError::from)
        })?;
        Ok(parse_auth_challenge_response(&response)?)
    }

    /// Perform AUTH_INFO -> AUTH_CHALLENGE -> AUTH_PROVE for a password.
    /// AUTH_PROVE is deliberately a single non-retried exchange because its
    /// challenge is one-shot, including when the response is lost.
    pub fn authenticate(&mut self, password: &str) -> Result<(), ClientError> {
        let info = self.auth_info()?;
        if !info.password_configured {
            return Err(ClientError::Remote(Status::AuthNotConfigured));
        }

        let credential = Credential::derive(password, info.salt, info.iterations)?;
        let nonce = match self.auth_challenge() {
            Ok(nonce) => nonce,
            Err(error) => {
                self.auth_session.clear_session();
                return Err(error);
            }
        };
        let proof = credential.proof(&nonce);
        let request_id = self.take_request_id();
        let request = match build_auth_prove_request(request_id, &proof) {
            Ok(request) => request,
            Err(error) => {
                self.auth_session.clear_session();
                return Err(error.into());
            }
        };
        let response = match self.call(request.as_frame()) {
            Ok(response) => response,
            Err(error) => {
                // Clear local authentication state for AUTH_FAILED and
                // AUTH_NO_CHALLENGE as well as unknown transport/protocol
                // outcomes.
                self.auth_session.clear_session();
                return Err(error);
            }
        };
        if let Err(error) = validate_empty_success(&response, "AUTH_PROVE") {
            self.auth_session.clear_session();
            return Err(error.into());
        }

        self.auth_session.install_authenticated();
        Ok(())
    }

    fn validate_password_set_ack(
        response: &Frame,
        expected_offset: u16,
    ) -> Result<(), ClientError> {
        if response[PAYLOAD_LENGTH_OFFSET] != 0 {
            return Err(ProtocolError::UnexpectedResponsePayload {
                operation: "PASSWORD_SET",
            }
            .into());
        }
        let actual_offset = read_u16(response, OFFSET_OFFSET);
        if actual_offset != expected_offset {
            return Err(ProtocolError::SetAckOffset {
                expected: expected_offset,
                actual: actual_offset,
            }
            .into());
        }
        let actual_total = read_u16(response, TOTAL_LENGTH_OFFSET);
        if actual_total != PASSWORD_SET_LENGTH as u16 {
            return Err(ProtocolError::SetAckTotal {
                expected: PASSWORD_SET_LENGTH as u16,
                actual: actual_total,
            }
            .into());
        }
        Ok(())
    }

    /// Resolve an uncertain final PASSWORD_SET result without replaying its
    /// secret chunk. AUTH_INFO updates local state authoritatively; a matching
    /// new credential tuple means the device committed the change.
    fn resolve_password_set_outcome(
        &mut self,
        expected_iterations: u32,
        expected_salt: [u8; SALT_SIZE],
        original_error: Option<ClientError>,
    ) -> Result<(), ClientError> {
        let info = match self.auth_info() {
            Ok(info) => info,
            Err(error) => {
                self.auth_session.clear_session();
                return Err(error);
            }
        };
        if info.password_configured
            && info.iterations == expected_iterations
            && info.salt == expected_salt
        {
            self.auth_session.become_protected();
            Ok(())
        } else {
            Err(original_error
                .unwrap_or_else(|| ProtocolError::PasswordSetConfirmationMismatch.into()))
        }
    }

    /// Submit a complete 52-byte PASSWORD_SET object. The operation never
    /// retries a chunk: a lost final ACK is resolved with AUTH_INFO, not by
    /// blindly repeating a secret transaction.
    pub fn set_password(&mut self, password: &str) -> Result<(), ClientError> {
        let info = self.auth_info()?;
        if info.password_configured && !info.session_authenticated {
            return Err(ClientError::Remote(Status::AuthRequired));
        }

        let credential = Credential::generate(password)?;
        let mut object = Zeroizing::new([0u8; PASSWORD_SET_LENGTH]);
        credential.write_password_set_object(&mut object[..])?;
        let expected_iterations = credential.iterations();
        let expected_salt = credential.salt();
        drop(credential);
        let request_id = self.take_request_id();

        let mut offset = 0usize;
        while offset < PASSWORD_SET_LENGTH {
            let end = (offset + PAYLOAD_SIZE).min(PASSWORD_SET_LENGTH);
            let is_final_chunk = end == PASSWORD_SET_LENGTH;
            let request =
                build_password_set_chunk(request_id, offset as u16, &object[offset..end])?;
            let response = self.call(request.as_frame());
            drop(request);
            let response = match response {
                Ok(response) => response,
                Err(error)
                    if is_final_chunk
                        && matches!(
                            error,
                            ClientError::Transport(_) | ClientError::Protocol(_)
                        ) =>
                {
                    drop(object);
                    return self.resolve_password_set_outcome(
                        expected_iterations,
                        expected_salt,
                        Some(error),
                    );
                }
                Err(error) => return Err(error),
            };

            if let Err(error) = Self::validate_password_set_ack(&response, end as u16) {
                if is_final_chunk {
                    drop(object);
                    return self.resolve_password_set_outcome(
                        expected_iterations,
                        expected_salt,
                        Some(error),
                    );
                }
                return Err(error);
            }
            offset = end;
        }

        // Even a well-shaped final OK is only an acknowledgement of the
        // transaction. Confirm the committed tuple before changing local state.
        drop(object);
        self.resolve_password_set_outcome(expected_iterations, expected_salt, None)
    }

    /// Ask the device to clear its transient authentication session. Local
    /// authentication state is cleared even when the best-effort request fails.
    pub fn lock(&mut self) -> Result<(), ClientError> {
        let response = self.call_with_transport_retry(|request_id| {
            build_lock_request(request_id).map_err(ClientError::from)
        });
        self.auth_session.clear_session();
        let response = response?;
        validate_empty_success(&response, "LOCK")?;
        Ok(())
    }

    pub fn list_slots(&mut self) -> Result<Vec<SlotInfo>, ClientError> {
        let mut offset = 0u16;
        let mut total = None;
        let mut result = Vec::new();

        loop {
            let requested_offset = offset;
            let response = self.call_with_transport_retry(|request_id| {
                build_frame(
                    Opcode::List,
                    request_id,
                    LIST_SLOT,
                    &[],
                    requested_offset,
                    0,
                )
                .map_err(ClientError::from)
            })?;

            let payload_length = response[PAYLOAD_LENGTH_OFFSET] as usize;
            let response_offset = read_u16(&response, OFFSET_OFFSET);
            let response_total = read_u16(&response, TOTAL_LENGTH_OFFSET);
            if response_offset != requested_offset {
                return Err(ProtocolError::PageOffsetMismatch {
                    operation: "LIST",
                    expected: requested_offset,
                    actual: response_offset,
                }
                .into());
            }
            if response_total == 0 || response_total as usize > MAX_LIST_RESULT_LENGTH {
                return Err(ProtocolError::InvalidLogicalLength { operation: "LIST" }.into());
            }
            if let Some(expected_total) = total {
                if expected_total != response_total {
                    return Err(ProtocolError::PageTotalChanged {
                        operation: "LIST",
                        expected: expected_total,
                        actual: response_total,
                    }
                    .into());
                }
            } else {
                total = Some(response_total);
                result.reserve(response_total as usize);
            }

            if response_offset > response_total
                || payload_length > (response_total - response_offset) as usize
            {
                return Err(ProtocolError::PageExceedsTotal { operation: "LIST" }.into());
            }
            if response_offset < response_total && payload_length == 0 {
                return Err(ProtocolError::PageMadeNoProgress { operation: "LIST" }.into());
            }

            result.extend_from_slice(&response[PAYLOAD_OFFSET..PAYLOAD_OFFSET + payload_length]);
            offset = response_offset + payload_length as u16;
            if offset == response_total {
                break;
            }
        }

        let total = total.ok_or(ProtocolError::InvalidLogicalLength { operation: "LIST" })?;
        if result.len() != total as usize || result.is_empty() {
            return Err(ProtocolError::InvalidLogicalLength { operation: "LIST" }.into());
        }
        let slot_count = result[0] as usize;
        if total as usize != 1 + 2 * slot_count {
            return Err(ProtocolError::InvalidLogicalLength { operation: "LIST" }.into());
        }

        Ok((0..slot_count)
            .map(|slot| SlotInfo {
                slot: slot as u8,
                length: u16::from_le_bytes([result[1 + 2 * slot], result[2 + 2 * slot]]),
            })
            .collect())
    }

    pub fn get_slot(&mut self, slot: u8) -> Result<Vec<u8>, ClientError> {
        validate_slot(slot)?;

        let mut offset = 0usize;
        let mut total = None;
        let mut result = Vec::new();

        loop {
            let requested_offset = u16::try_from(offset)
                .map_err(|_| ProtocolError::InvalidLogicalLength { operation: "GET" })?;
            let response = self.call_with_transport_retry(|request_id| {
                build_frame(Opcode::Get, request_id, slot, &[], requested_offset, 0)
                    .map_err(ClientError::from)
            })?;

            let payload_length = response[PAYLOAD_LENGTH_OFFSET] as usize;
            let response_offset = read_u16(&response, OFFSET_OFFSET) as usize;
            let response_total = read_u16(&response, TOTAL_LENGTH_OFFSET) as usize;
            if response_offset != requested_offset as usize {
                return Err(ProtocolError::PageOffsetMismatch {
                    operation: "GET",
                    expected: requested_offset,
                    actual: response_offset as u16,
                }
                .into());
            }
            if response_total > MAX_TEXT_LENGTH {
                return Err(ProtocolError::InvalidLogicalLength { operation: "GET" }.into());
            }
            if let Some(expected_total) = total {
                if expected_total != response_total {
                    return Err(ProtocolError::PageTotalChanged {
                        operation: "GET",
                        expected: expected_total as u16,
                        actual: response_total as u16,
                    }
                    .into());
                }
            } else {
                total = Some(response_total);
                result.reserve(response_total);
            }

            if response_offset > response_total || payload_length > response_total - response_offset
            {
                return Err(ProtocolError::PageExceedsTotal { operation: "GET" }.into());
            }
            if response_offset < response_total && payload_length == 0 {
                return Err(ProtocolError::PageMadeNoProgress { operation: "GET" }.into());
            }

            result.extend_from_slice(&response[PAYLOAD_OFFSET..PAYLOAD_OFFSET + payload_length]);
            offset = response_offset + payload_length;
            if offset == response_total {
                break;
            }
        }

        let total = total.ok_or(ProtocolError::InvalidLogicalLength { operation: "GET" })?;
        if result.len() != total {
            return Err(ProtocolError::InvalidLogicalLength { operation: "GET" }.into());
        }
        validate_text(&result)?;
        Ok(result)
    }

    fn set_once(&mut self, slot: u8, data: &[u8], request_id: u8) -> Result<(), ClientError> {
        let total = data.len() as u16;
        let chunk_count = if data.is_empty() {
            1
        } else {
            data.len().div_ceil(PAYLOAD_SIZE)
        };

        for chunk_index in 0..chunk_count {
            let offset = if data.is_empty() {
                0
            } else {
                chunk_index * PAYLOAD_SIZE
            };
            let end = (offset + PAYLOAD_SIZE).min(data.len());
            let payload = &data[offset..end];
            let offset_u16 = offset as u16;
            let request = build_frame(Opcode::Set, request_id, slot, payload, offset_u16, total)?;
            let response = self.call(&request)?;
            if response[PAYLOAD_LENGTH_OFFSET] != 0
                || read_u16(&response, OFFSET_OFFSET) != offset_u16 + payload.len() as u16
                || read_u16(&response, TOTAL_LENGTH_OFFSET) != total
            {
                let expected_offset = offset_u16 + payload.len() as u16;
                if response[PAYLOAD_LENGTH_OFFSET] != 0 {
                    return Err(
                        ProtocolError::UnexpectedResponsePayload { operation: "SET" }.into(),
                    );
                }
                let actual_offset = read_u16(&response, OFFSET_OFFSET);
                if actual_offset != expected_offset {
                    return Err(ProtocolError::SetAckOffset {
                        expected: expected_offset,
                        actual: actual_offset,
                    }
                    .into());
                }
                return Err(ProtocolError::SetAckTotal {
                    expected: total,
                    actual: read_u16(&response, TOTAL_LENGTH_OFFSET),
                }
                .into());
            }
        }
        Ok(())
    }

    pub fn set_slot(&mut self, slot: u8, data: &[u8]) -> Result<(), ClientError> {
        validate_slot(slot)?;
        if data.len() > MAX_TEXT_LENGTH {
            return Err(ClientError::LengthExceeded {
                length: data.len(),
                maximum: MAX_TEXT_LENGTH,
            });
        }
        validate_text(data)?;

        let mut last_error = None;
        for _ in 0..=self.retries {
            let request_id = self.take_request_id();
            match self.set_once(slot, data, request_id) {
                Ok(()) => return Ok(()),
                Err(ClientError::Transport(error)) if error.is_retryable() => {
                    last_error = Some(ClientError::Transport(error));
                }
                Err(ClientError::Remote(status))
                    if matches!(status, Status::BadRequest | Status::BadOffset) =>
                {
                    last_error = Some(ClientError::Remote(status));
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_error.expect("at least one SET attempt is always made"))
    }

    pub fn clear_slot(&mut self, slot: u8) -> Result<(), ClientError> {
        validate_slot(slot)?;
        let response = self.call_with_transport_retry(|request_id| {
            build_frame(Opcode::Clear, request_id, slot, &[], 0, 0).map_err(ClientError::from)
        })?;
        if response[PAYLOAD_LENGTH_OFFSET] != 0
            || read_u16(&response, OFFSET_OFFSET) != 0
            || read_u16(&response, TOTAL_LENGTH_OFFSET) != 0
        {
            return Err(ProtocolError::UnexpectedResponsePayload { operation: "CLEAR" }.into());
        }
        Ok(())
    }
}

fn validate_slot(slot: u8) -> Result<(), ClientError> {
    if slot == LIST_SLOT {
        Err(ClientError::InvalidSlot(slot))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{ProtocolError, TextError};
    use crate::protocol::{
        FRAME_SIZE, OPCODE_OFFSET, REQUEST_ID_OFFSET, SLOT_OFFSET, STATUS_OFFSET, VERSION_OFFSET,
    };
    use std::collections::VecDeque;

    type ReadResult = Result<Vec<u8>, TransportError>;
    type Handler = Box<dyn FnMut(&Frame) -> Vec<ReadResult>>;

    struct FakeTransport {
        writes: Vec<Zeroizing<Frame>>,
        reads: VecDeque<ReadResult>,
        read_timeouts: Vec<Duration>,
        on_write: Option<Handler>,
    }

    impl FakeTransport {
        fn with_handler<F>(handler: F) -> Self
        where
            F: FnMut(&Frame) -> Vec<ReadResult> + 'static,
        {
            Self {
                writes: Vec::new(),
                reads: VecDeque::new(),
                read_timeouts: Vec::new(),
                on_write: Some(Box::new(handler)),
            }
        }

        fn response(
            request: &Frame,
            status: Status,
            payload: &[u8],
            offset: u16,
            total: u16,
        ) -> Vec<u8> {
            assert!(payload.len() <= PAYLOAD_SIZE);
            let mut response = [0u8; FRAME_SIZE];
            response[VERSION_OFFSET] = request[VERSION_OFFSET];
            response[OPCODE_OFFSET] = request[OPCODE_OFFSET];
            response[REQUEST_ID_OFFSET] = request[REQUEST_ID_OFFSET];
            response[STATUS_OFFSET] = status as u8;
            response[SLOT_OFFSET] = request[SLOT_OFFSET];
            response[PAYLOAD_LENGTH_OFFSET] = payload.len() as u8;
            response[OFFSET_OFFSET..OFFSET_OFFSET + 2].copy_from_slice(&offset.to_le_bytes());
            response[TOTAL_LENGTH_OFFSET..TOTAL_LENGTH_OFFSET + 2]
                .copy_from_slice(&total.to_le_bytes());
            response[PAYLOAD_OFFSET..PAYLOAD_OFFSET + payload.len()].copy_from_slice(payload);
            response.to_vec()
        }

        fn page_handler(logical: Vec<u8>) -> impl FnMut(&Frame) -> Vec<ReadResult> {
            move |request| {
                let offset = read_u16(request, OFFSET_OFFSET) as usize;
                let end = (offset + PAYLOAD_SIZE).min(logical.len());
                vec![Ok(Self::response(
                    request,
                    Status::Ok,
                    &logical[offset..end],
                    offset as u16,
                    logical.len() as u16,
                ))]
            }
        }
    }

    impl Transport for FakeTransport {
        fn write_frame(&mut self, frame: &Frame) -> Result<(), TransportError> {
            self.writes.push(Zeroizing::new(*frame));
            if let Some(handler) = self.on_write.as_mut() {
                self.reads.extend(handler(frame));
            }
            Ok(())
        }

        fn read_frame(&mut self, timeout: Duration) -> Result<Vec<u8>, TransportError> {
            self.read_timeouts.push(timeout);
            self.reads
                .pop_front()
                .unwrap_or(Err(TransportError::Timeout))
        }
    }

    fn client_with_handler<F>(handler: F, retries: usize) -> RuntimeMacroClient<FakeTransport>
    where
        F: FnMut(&Frame) -> Vec<ReadResult> + 'static,
    {
        RuntimeMacroClient::new(FakeTransport::with_handler(handler), 10, retries).unwrap()
    }

    fn ok_response(request: &Frame, offset: u16, total: u16) -> ReadResult {
        Ok(FakeTransport::response(
            request,
            Status::Ok,
            &[],
            offset,
            total,
        ))
    }

    fn auth_info_ok(
        request: &Frame,
        configured: bool,
        authenticated: bool,
        iterations: u32,
        salt: [u8; crate::auth::SALT_SIZE],
    ) -> Vec<ReadResult> {
        let mut payload = [0u8; crate::protocol::AUTH_INFO_LENGTH];
        payload[0] = (configured as u8 * crate::protocol::PASSWORD_CONFIGURED_FLAG)
            | (authenticated as u8 * crate::protocol::SESSION_AUTHENTICATED_FLAG);
        payload[1] = crate::auth::KDF_ID;
        payload[2..6].copy_from_slice(&iterations.to_le_bytes());
        payload[6..].copy_from_slice(&salt);
        vec![Ok(FakeTransport::response(
            request,
            Status::Ok,
            &payload,
            0,
            crate::protocol::AUTH_INFO_LENGTH as u16,
        ))]
    }

    fn auth_challenge_ok(request: &Frame, nonce: [u8; crate::auth::NONCE_SIZE]) -> Vec<ReadResult> {
        vec![Ok(FakeTransport::response(
            request,
            Status::Ok,
            &nonce,
            0,
            crate::protocol::AUTH_CHALLENGE_LENGTH as u16,
        ))]
    }

    #[test]
    fn auth_info_and_password_set_follow_open_wire_contract() {
        let mut auth_info_calls = 0;
        let mut new_salt = [0u8; crate::auth::SALT_SIZE];
        let mut client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_calls += 1;
                    let (configured, authenticated, iterations, salt) = if auth_info_calls == 1 {
                        (
                            false,
                            false,
                            crate::auth::DEFAULT_ITERATIONS,
                            [0; crate::auth::SALT_SIZE],
                        )
                    } else {
                        (true, false, crate::auth::DEFAULT_ITERATIONS, new_salt)
                    };
                    auth_info_ok(request, configured, authenticated, iterations, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::PasswordSet => {
                    let offset = read_u16(request, OFFSET_OFFSET);
                    if offset == 0 {
                        new_salt.copy_from_slice(
                            &request
                                [PAYLOAD_OFFSET + 4..PAYLOAD_OFFSET + 4 + crate::auth::SALT_SIZE],
                        );
                    }
                    let payload_length = request[PAYLOAD_LENGTH_OFFSET] as u16;
                    vec![ok_response(
                        request,
                        offset + payload_length,
                        PASSWORD_SET_LENGTH as u16,
                    )]
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );

        client.set_password("fixture-new-password").unwrap();
        assert!(client.is_protected());
        assert!(!client.is_authenticated());

        let writes = &client.transport_mut().writes;
        assert_eq!(writes.len(), 5);
        assert_eq!(writes[0][OPCODE_OFFSET], Opcode::AuthInfo as u8);
        assert_eq!(writes[4][OPCODE_OFFSET], Opcode::AuthInfo as u8);
        assert_eq!(
            writes[1..4]
                .iter()
                .map(|frame| (
                    frame[REQUEST_ID_OFFSET],
                    read_u16(frame, OFFSET_OFFSET),
                    frame[PAYLOAD_LENGTH_OFFSET],
                    read_u16(frame, TOTAL_LENGTH_OFFSET),
                ))
                .collect::<Vec<_>>(),
            vec![(1, 0, 22, 52), (1, 22, 22, 52), (1, 44, 8, 52)]
        );
        assert!(writes[1..4]
            .iter()
            .all(|frame| frame[VERSION_OFFSET] == crate::protocol::VERSION
                && frame[SLOT_OFFSET] == crate::protocol::AUTH_SLOT
                && frame[PAYLOAD_OFFSET + frame[PAYLOAD_LENGTH_OFFSET] as usize..]
                    .iter()
                    .all(|byte| *byte == 0)));
        assert!(writes[1][PAYLOAD_OFFSET + 4..PAYLOAD_OFFSET + 20]
            .iter()
            .any(|byte| *byte != 0));
    }

    #[test]
    fn authenticate_derives_nfc_password_and_sends_one_proof() {
        let salt = [0x31; crate::auth::SALT_SIZE];
        let nonce_bytes = [0x41; crate::auth::NONCE_SIZE];
        let expected = Credential::derive("fixture-password", salt, crate::auth::MIN_ITERATIONS)
            .unwrap()
            .proof(&crate::auth::Nonce::from_wire(nonce_bytes).unwrap());
        let expected_bytes = *expected.as_bytes();

        let mut client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_ok(request, true, false, crate::auth::MIN_ITERATIONS, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::AuthChallenge => auth_challenge_ok(request, nonce_bytes)
                    .into_iter()
                    .collect(),
                Opcode::AuthProve => {
                    assert_eq!(
                        &request
                            [PAYLOAD_OFFSET..PAYLOAD_OFFSET + crate::protocol::AUTH_PROVE_LENGTH],
                        &expected_bytes
                    );
                    vec![ok_response(request, 0, 0)]
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );

        client.authenticate("fixture-password").unwrap();
        assert!(client.is_protected());
        assert!(client.is_authenticated());
        assert_eq!(
            client
                .transport_mut()
                .writes
                .iter()
                .map(|frame| frame[OPCODE_OFFSET])
                .collect::<Vec<_>>(),
            vec![
                Opcode::AuthInfo as u8,
                Opcode::AuthChallenge as u8,
                Opcode::AuthProve as u8
            ]
        );
    }

    #[test]
    fn auth_remote_errors_and_prove_timeout_are_not_retried() {
        let salt = [0x32; crate::auth::SALT_SIZE];
        let nonce = [0x42; crate::auth::NONCE_SIZE];
        let mut failed = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_ok(request, true, false, crate::auth::MIN_ITERATIONS, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::AuthChallenge => auth_challenge_ok(request, nonce).into_iter().collect(),
                Opcode::AuthProve => vec![Ok(FakeTransport::response(
                    request,
                    Status::AuthFailed,
                    &[],
                    0,
                    0,
                ))],
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            failed.authenticate("fixture-wrong-password"),
            Err(ClientError::Remote(Status::AuthFailed))
        );
        assert_eq!(failed.transport_mut().writes.len(), 3);
        assert!(!failed.is_authenticated());

        let mut timed_out = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_ok(request, true, false, crate::auth::MIN_ITERATIONS, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::AuthChallenge => auth_challenge_ok(request, nonce).into_iter().collect(),
                Opcode::AuthProve => vec![Err(TransportError::Timeout)],
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            timed_out.authenticate("fixture-password"),
            Err(ClientError::Transport(TransportError::Timeout))
        );
        assert_eq!(timed_out.transport_mut().writes.len(), 3);
        assert!(!timed_out.is_authenticated());
    }

    #[test]
    fn challenge_timeout_restarts_challenge_and_rate_limit_stops_immediately() {
        let salt = [0x33; crate::auth::SALT_SIZE];
        let mut timeout_client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_ok(request, true, false, crate::auth::MIN_ITERATIONS, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::AuthChallenge => vec![Err(TransportError::Timeout)],
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            timeout_client.authenticate("fixture-password"),
            Err(ClientError::Transport(TransportError::Timeout))
        );
        assert_eq!(timeout_client.transport_mut().writes.len(), 5);

        let mut rate_limited = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_ok(request, true, false, crate::auth::MIN_ITERATIONS, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::AuthChallenge => vec![Ok(FakeTransport::response(
                    request,
                    Status::RateLimited,
                    &[],
                    0,
                    0,
                ))],
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            rate_limited.authenticate("fixture-password"),
            Err(ClientError::Remote(Status::RateLimited))
        );
        assert_eq!(rate_limited.transport_mut().writes.len(), 2);

        let mut no_challenge = client_with_handler(
            |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthChallenge => vec![Ok(FakeTransport::response(
                    request,
                    Status::AuthNoChallenge,
                    &[],
                    0,
                    0,
                ))],
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert!(matches!(
            no_challenge.auth_challenge(),
            Err(ClientError::Remote(Status::AuthNoChallenge))
        ));
        assert_eq!(no_challenge.transport_mut().writes.len(), 1);
    }

    #[test]
    fn password_set_storage_failure_preserves_session_and_lost_ack_is_not_repeated() {
        let salt = [0x34; crate::auth::SALT_SIZE];
        let mut calls = 0;
        let mut storage_error = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_ok(request, true, true, crate::auth::MIN_ITERATIONS, salt)
                        .into_iter()
                        .collect()
                }
                Opcode::PasswordSet => {
                    calls += 1;
                    if calls == 3 {
                        vec![Ok(FakeTransport::response(
                            request,
                            Status::StorageError,
                            &[],
                            0,
                            0,
                        ))]
                    } else {
                        let offset = read_u16(request, OFFSET_OFFSET);
                        vec![ok_response(
                            request,
                            offset + request[PAYLOAD_LENGTH_OFFSET] as u16,
                            PASSWORD_SET_LENGTH as u16,
                        )]
                    }
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            storage_error.set_password("fixture-new-password"),
            Err(ClientError::Remote(Status::StorageError))
        );
        assert!(storage_error.is_authenticated());
        assert_eq!(storage_error.transport_mut().writes.len(), 4);

        let mut lost_ack_calls = 0;
        let mut lost_ack = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => auth_info_ok(
                    request,
                    false,
                    false,
                    crate::auth::DEFAULT_ITERATIONS,
                    [0; crate::auth::SALT_SIZE],
                )
                .into_iter()
                .collect(),
                Opcode::PasswordSet => {
                    lost_ack_calls += 1;
                    if lost_ack_calls == 3 {
                        vec![Err(TransportError::Timeout)]
                    } else {
                        let offset = read_u16(request, OFFSET_OFFSET);
                        vec![ok_response(
                            request,
                            offset + request[PAYLOAD_LENGTH_OFFSET] as u16,
                            PASSWORD_SET_LENGTH as u16,
                        )]
                    }
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            lost_ack.set_password("fixture-new-password"),
            Err(ClientError::Transport(TransportError::Timeout))
        );
        assert_eq!(lost_ack.transport_mut().writes.len(), 5);
        assert!(!lost_ack.is_protected());
        assert_eq!(
            lost_ack
                .transport_mut()
                .writes
                .iter()
                .filter(|frame| frame[OPCODE_OFFSET] == Opcode::PasswordSet as u8)
                .count(),
            3
        );
    }

    #[test]
    fn password_set_final_timeout_recovers_from_matching_auth_info() {
        let old_salt = [0x35; crate::auth::SALT_SIZE];
        let mut auth_info_calls = 0;
        let mut password_set_calls = 0;
        let mut new_salt = [0u8; crate::auth::SALT_SIZE];
        let mut client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_calls += 1;
                    if auth_info_calls == 1 {
                        auth_info_ok(request, true, true, crate::auth::MIN_ITERATIONS, old_salt)
                            .into_iter()
                            .collect()
                    } else {
                        auth_info_ok(
                            request,
                            true,
                            false,
                            crate::auth::DEFAULT_ITERATIONS,
                            new_salt,
                        )
                        .into_iter()
                        .collect()
                    }
                }
                Opcode::PasswordSet => {
                    password_set_calls += 1;
                    let offset = read_u16(request, OFFSET_OFFSET);
                    if offset == 0 {
                        new_salt.copy_from_slice(
                            &request
                                [PAYLOAD_OFFSET + 4..PAYLOAD_OFFSET + 4 + crate::auth::SALT_SIZE],
                        );
                    }
                    if password_set_calls == 3 {
                        vec![Err(TransportError::Timeout)]
                    } else {
                        vec![ok_response(
                            request,
                            offset + request[PAYLOAD_LENGTH_OFFSET] as u16,
                            PASSWORD_SET_LENGTH as u16,
                        )]
                    }
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            0,
        );

        client.set_password("fixture-new-password").unwrap();
        assert!(client.is_protected());
        assert!(!client.is_authenticated());
        assert_eq!(
            client
                .transport_mut()
                .writes
                .iter()
                .filter(|frame| frame[OPCODE_OFFSET] == Opcode::AuthInfo as u8)
                .count(),
            2
        );
        assert_eq!(
            client
                .transport_mut()
                .writes
                .iter()
                .filter(|frame| frame[OPCODE_OFFSET] == Opcode::PasswordSet as u8)
                .count(),
            3
        );
    }

    #[test]
    fn password_set_final_ack_shape_is_resolved_without_replaying_chunk() {
        let old_salt = [0x36; crate::auth::SALT_SIZE];
        let mut auth_info_calls = 0;
        let mut password_set_calls = 0;
        let mut new_salt = [0u8; crate::auth::SALT_SIZE];
        let mut client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_calls += 1;
                    if auth_info_calls == 1 {
                        auth_info_ok(request, true, true, crate::auth::MIN_ITERATIONS, old_salt)
                            .into_iter()
                            .collect()
                    } else {
                        auth_info_ok(
                            request,
                            true,
                            false,
                            crate::auth::DEFAULT_ITERATIONS,
                            new_salt,
                        )
                        .into_iter()
                        .collect()
                    }
                }
                Opcode::PasswordSet => {
                    password_set_calls += 1;
                    let offset = read_u16(request, OFFSET_OFFSET);
                    if offset == 0 {
                        new_salt.copy_from_slice(
                            &request
                                [PAYLOAD_OFFSET + 4..PAYLOAD_OFFSET + 4 + crate::auth::SALT_SIZE],
                        );
                    }
                    let payload_length = request[PAYLOAD_LENGTH_OFFSET] as u16;
                    let acknowledged_offset = if password_set_calls == 3 {
                        offset
                    } else {
                        offset + payload_length
                    };
                    vec![ok_response(
                        request,
                        acknowledged_offset,
                        PASSWORD_SET_LENGTH as u16,
                    )]
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            0,
        );

        client.set_password("fixture-new-password").unwrap();
        assert!(client.is_protected());
        assert!(!client.is_authenticated());
        assert_eq!(client.transport_mut().writes.len(), 5);
        assert_eq!(
            client.transport_mut().writes[4][OPCODE_OFFSET],
            Opcode::AuthInfo as u8
        );
    }

    #[test]
    fn password_set_confirmation_failure_clears_local_authentication() {
        let old_salt = [0x37; crate::auth::SALT_SIZE];
        let mut auth_info_calls = 0;
        let mut password_set_calls = 0;
        let mut client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_calls += 1;
                    if auth_info_calls == 1 {
                        auth_info_ok(request, true, true, crate::auth::MIN_ITERATIONS, old_salt)
                            .into_iter()
                            .collect()
                    } else {
                        vec![Err(TransportError::Timeout)]
                    }
                }
                Opcode::PasswordSet => {
                    password_set_calls += 1;
                    let offset = read_u16(request, OFFSET_OFFSET);
                    if password_set_calls == 3 {
                        vec![Err(TransportError::Timeout)]
                    } else {
                        vec![ok_response(
                            request,
                            offset + request[PAYLOAD_LENGTH_OFFSET] as u16,
                            PASSWORD_SET_LENGTH as u16,
                        )]
                    }
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            0,
        );

        assert_eq!(
            client.set_password("fixture-new-password"),
            Err(ClientError::Transport(TransportError::Timeout))
        );
        assert!(client.is_protected());
        assert!(!client.is_authenticated());
    }

    #[test]
    fn malformed_auth_info_clears_previous_authenticated_state() {
        let salt = [0x38; crate::auth::SALT_SIZE];
        let mut auth_info_calls = 0;
        let mut client = client_with_handler(
            move |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => {
                    auth_info_calls += 1;
                    if auth_info_calls == 1 {
                        auth_info_ok(request, true, true, crate::auth::MIN_ITERATIONS, salt)
                            .into_iter()
                            .collect()
                    } else {
                        let mut malformed =
                            auth_info_ok(request, true, true, crate::auth::MIN_ITERATIONS, salt)
                                .pop()
                                .unwrap()
                                .unwrap();
                        malformed[PAYLOAD_OFFSET] = 0x80;
                        vec![Ok(malformed)]
                    }
                }
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            0,
        );

        client.auth_info().unwrap();
        assert!(client.is_authenticated());
        assert_eq!(
            client.auth_info(),
            Err(ClientError::Protocol(ProtocolError::InvalidAuthFlags {
                flags: 0x80
            }))
        );
        assert!(client.is_protected());
        assert!(!client.is_authenticated());
    }

    #[test]
    fn protected_macro_error_is_not_retried_and_empty_password_writes_nothing() {
        let mut client = client_with_handler(
            |request| {
                vec![Ok(FakeTransport::response(
                    request,
                    Status::AuthRequired,
                    &[],
                    0,
                    0,
                ))]
            },
            3,
        );
        assert_eq!(
            client.list_slots(),
            Err(ClientError::Remote(Status::AuthRequired))
        );
        assert_eq!(client.transport_mut().writes.len(), 1);

        let mut empty = client_with_handler(
            |request| match Opcode::try_from(request[OPCODE_OFFSET]).unwrap() {
                Opcode::AuthInfo => auth_info_ok(
                    request,
                    false,
                    false,
                    crate::auth::DEFAULT_ITERATIONS,
                    [0; crate::auth::SALT_SIZE],
                )
                .into_iter()
                .collect(),
                opcode => panic!("unexpected fixture opcode: {opcode:?}"),
            },
            3,
        );
        assert_eq!(
            empty.set_password(""),
            Err(ClientError::Auth(crate::error::AuthError::EmptyPassword))
        );
        assert_eq!(empty.transport_mut().writes.len(), 1);
    }

    #[test]
    fn client_config_has_safe_defaults_and_validates_bounds() {
        assert_eq!(
            ClientConfig::default(),
            ClientConfig {
                timeout_ms: DEFAULT_TIMEOUT_MS,
                retries: DEFAULT_RETRIES,
            }
        );
        assert!(ClientConfig::new(MIN_TIMEOUT_MS, 0).is_ok());
        assert!(ClientConfig::new(MAX_TIMEOUT_MS, MAX_RETRIES).is_ok());
        assert!(ClientConfig::new(MIN_TIMEOUT_MS - 1, 0).is_err());
        assert!(ClientConfig::new(MAX_TIMEOUT_MS + 1, 0).is_err());
        assert!(ClientConfig::new(DEFAULT_TIMEOUT_MS, MAX_RETRIES + 1).is_err());
    }

    #[test]
    fn client_config_keeps_runtime_client_timeout_and_retry_values() {
        let config = ClientConfig::new(250, 3).unwrap();
        let mut attempts = 0;
        let mut client = RuntimeMacroClient::with_config(
            FakeTransport::with_handler(move |request| {
                attempts += 1;
                if attempts <= 3 {
                    vec![Err(TransportError::Timeout)]
                } else {
                    vec![ok_response(request, 1, 1)]
                }
            }),
            config,
        );
        client.set_slot(0, b"x").unwrap();
        let read_timeouts = &client.transport_mut().read_timeouts;
        assert_eq!(read_timeouts.len(), 4);
        assert!(read_timeouts
            .iter()
            .all(|timeout| *timeout <= Duration::from_millis(250)));
        assert!(read_timeouts
            .iter()
            .all(|timeout| *timeout > Duration::from_millis(200)));
    }

    #[test]
    fn stale_response_is_discarded_before_matching_response() {
        let mut sent = false;
        let mut client = client_with_handler(
            move |request| {
                if sent {
                    vec![ok_response(request, 0, 0)]
                } else {
                    sent = true;
                    let mut stale = FakeTransport::response(request, Status::Ok, &[], 0, 0);
                    stale[REQUEST_ID_OFFSET] = request[REQUEST_ID_OFFSET].wrapping_add(1);
                    vec![Ok(stale), ok_response(request, 0, 0)]
                }
            },
            0,
        );

        assert_eq!(client.get_slot(0).unwrap(), Vec::<u8>::new());
        assert_eq!(client.transport_mut().writes.len(), 1);
    }

    #[test]
    fn matching_malformed_response_is_not_retried() {
        let mut client = client_with_handler(
            |request| {
                let mut response = FakeTransport::response(request, Status::Ok, &[], 0, 1);
                response[PAYLOAD_LENGTH_OFFSET] = 1;
                response[PAYLOAD_OFFSET + 1] = 0xa5;
                vec![Ok(response)]
            },
            3,
        );

        let error = client.get_slot(0).unwrap_err();
        assert!(matches!(
            error,
            ClientError::Protocol(ProtocolError::NonZeroPayloadPadding)
        ));
        assert_eq!(client.transport_mut().writes.len(), 1);
    }

    #[test]
    fn list_supports_empty_slots_and_crosses_pages_without_fixed_count() {
        let logical: Vec<u8> = std::iter::once(12u8)
            .chain((0..12).flat_map(|length| (length as u16).to_le_bytes()))
            .collect();
        let mut client = client_with_handler(FakeTransport::page_handler(logical), 0);
        let slots = client.list_slots().unwrap();
        assert_eq!(slots.len(), 12);
        assert_eq!(
            slots,
            (0..12)
                .map(|slot| SlotInfo {
                    slot,
                    length: slot as u16,
                })
                .collect::<Vec<_>>()
        );

        let mut empty_client =
            client_with_handler(FakeTransport::page_handler(vec![3, 0, 0, 0, 0, 0, 0]), 0);
        assert_eq!(
            empty_client.list_slots().unwrap(),
            vec![
                SlotInfo { slot: 0, length: 0 },
                SlotInfo { slot: 1, length: 0 },
                SlotInfo { slot: 2, length: 0 },
            ]
        );
    }

    #[test]
    fn list_rejects_bad_offset_total_progress_and_result() {
        let cases: Vec<Handler> = vec![
            Box::new(|request| {
                vec![Ok(FakeTransport::response(
                    request,
                    Status::Ok,
                    &[1, 0, 0],
                    1,
                    3,
                ))]
            }),
            Box::new({
                let mut call = 0;
                move |request| {
                    call += 1;
                    let offset = read_u16(request, OFFSET_OFFSET);
                    if call == 1 {
                        vec![Ok(FakeTransport::response(
                            request,
                            Status::Ok,
                            &[1; PAYLOAD_SIZE],
                            0,
                            23,
                        ))]
                    } else {
                        vec![Ok(FakeTransport::response(
                            request,
                            Status::Ok,
                            &[1],
                            offset,
                            24,
                        ))]
                    }
                }
            }),
            Box::new(|request| vec![Ok(FakeTransport::response(request, Status::Ok, &[], 0, 3))]),
            Box::new(FakeTransport::page_handler(vec![2, 0])),
        ];

        for handler in cases {
            let mut client = client_with_handler(handler, 0);
            assert!(matches!(client.list_slots(), Err(ClientError::Protocol(_))));
        }
    }

    #[test]
    fn get_handles_empty_and_22_23_byte_boundaries() {
        for logical in [Vec::new(), vec![b'x'; 22], vec![b'y'; 23]] {
            let expected = logical.clone();
            let mut client = client_with_handler(FakeTransport::page_handler(logical), 0);
            assert_eq!(client.get_slot(0).unwrap(), expected);
            let offsets: Vec<u16> = client
                .transport_mut()
                .writes
                .iter()
                .map(|frame| read_u16(frame, OFFSET_OFFSET))
                .collect();
            assert_eq!(
                offsets,
                if expected.len() == 23 {
                    vec![0, 22]
                } else {
                    vec![0]
                }
            );
        }
    }

    #[test]
    fn get_rejects_bad_offset_total_progress_and_text() {
        let mut wrong_offset = client_with_handler(
            |request| vec![Ok(FakeTransport::response(request, Status::Ok, b"x", 1, 1))],
            0,
        );
        assert!(matches!(
            wrong_offset.get_slot(0),
            Err(ClientError::Protocol(
                ProtocolError::PageOffsetMismatch { .. }
            ))
        ));

        let mut changing_total = client_with_handler(
            {
                let mut call = 0;
                move |request| {
                    call += 1;
                    let offset = read_u16(request, OFFSET_OFFSET);
                    if call == 1 {
                        vec![Ok(FakeTransport::response(
                            request,
                            Status::Ok,
                            &[b'a'; PAYLOAD_SIZE],
                            0,
                            23,
                        ))]
                    } else {
                        vec![Ok(FakeTransport::response(
                            request,
                            Status::Ok,
                            b"b",
                            offset,
                            24,
                        ))]
                    }
                }
            },
            0,
        );
        assert!(matches!(
            changing_total.get_slot(0),
            Err(ClientError::Protocol(
                ProtocolError::PageTotalChanged { .. }
            ))
        ));

        let mut no_progress = client_with_handler(
            |request| vec![Ok(FakeTransport::response(request, Status::Ok, &[], 0, 1))],
            0,
        );
        assert!(matches!(
            no_progress.get_slot(0),
            Err(ClientError::Protocol(
                ProtocolError::PageMadeNoProgress { .. }
            ))
        ));

        let mut invalid_text = client_with_handler(
            |request| {
                vec![Ok(FakeTransport::response(
                    request,
                    Status::Ok,
                    &[0x80],
                    0,
                    1,
                ))]
            },
            0,
        );
        assert_eq!(
            invalid_text.get_slot(0),
            Err(ClientError::InvalidText(TextError {
                index: 0,
                byte: 0x80,
            }))
        );
    }

    #[test]
    fn set_uses_canonical_chunks_for_zero_22_23_and_256_bytes() {
        let mut client = client_with_handler(
            |request| {
                let offset = read_u16(request, OFFSET_OFFSET);
                let payload_length = request[PAYLOAD_LENGTH_OFFSET] as u16;
                let total = read_u16(request, TOTAL_LENGTH_OFFSET);
                vec![ok_response(request, offset + payload_length, total)]
            },
            0,
        );
        client.set_slot(7, &[b'A'; 23]).unwrap();
        assert_eq!(
            client.transport_mut().writes[0][..10],
            [crate::protocol::VERSION, 3, 0, 0, 7, 22, 0, 0, 23, 0]
        );
        assert_eq!(
            client.transport_mut().writes[1][..10],
            [crate::protocol::VERSION, 3, 0, 0, 7, 1, 22, 0, 23, 0]
        );
        assert!(client.transport_mut().writes.iter().all(|frame| frame
            [PAYLOAD_OFFSET + frame[PAYLOAD_LENGTH_OFFSET] as usize..]
            .iter()
            .all(|byte| *byte == 0)));

        for (length, chunks) in [(0, 1), (22, 1), (23, 2), (256, 12)] {
            let mut client = client_with_handler(
                |request| {
                    let offset = read_u16(request, OFFSET_OFFSET);
                    let payload_length = request[PAYLOAD_LENGTH_OFFSET] as u16;
                    vec![ok_response(
                        request,
                        offset + payload_length,
                        read_u16(request, TOTAL_LENGTH_OFFSET),
                    )]
                },
                0,
            );
            client.set_slot(0, &vec![b'b'; length]).unwrap();
            assert_eq!(client.transport_mut().writes.len(), chunks);
        }
    }

    #[test]
    fn set_rejects_bad_ack_without_retry_and_bad_input_before_writing() {
        let mut bad_offset = client_with_handler(
            |request| {
                vec![ok_response(
                    request,
                    read_u16(request, OFFSET_OFFSET) + 2,
                    read_u16(request, TOTAL_LENGTH_OFFSET),
                )]
            },
            3,
        );
        assert!(matches!(
            bad_offset.set_slot(0, b"x"),
            Err(ClientError::Protocol(ProtocolError::SetAckOffset { .. }))
        ));
        assert_eq!(bad_offset.transport_mut().writes.len(), 1);

        let mut bad_total = client_with_handler(
            |request| {
                vec![ok_response(
                    request,
                    read_u16(request, OFFSET_OFFSET) + request[PAYLOAD_LENGTH_OFFSET] as u16,
                    2,
                )]
            },
            3,
        );
        assert!(matches!(
            bad_total.set_slot(0, b"x"),
            Err(ClientError::Protocol(ProtocolError::SetAckTotal { .. }))
        ));
        assert_eq!(bad_total.transport_mut().writes.len(), 1);

        for data in [
            vec![0x00],
            vec![0x07],
            vec![0x0b],
            vec![0x7f],
            vec![0x80],
            vec![0xff],
        ] {
            let mut client = client_with_handler(|_| Vec::new(), 0);
            assert!(matches!(
                client.set_slot(0, &data),
                Err(ClientError::InvalidText(_))
            ));
            assert!(client.transport_mut().writes.is_empty());
        }
        let mut too_long = client_with_handler(|_| Vec::new(), 0);
        assert_eq!(
            too_long.set_slot(0, &[b'x'; MAX_TEXT_LENGTH + 1]),
            Err(ClientError::LengthExceeded {
                length: MAX_TEXT_LENGTH + 1,
                maximum: MAX_TEXT_LENGTH,
            })
        );
        assert!(too_long.transport_mut().writes.is_empty());
    }

    #[test]
    fn set_restarts_everything_with_new_id_after_timeout() {
        let mut call = 0;
        let mut client = client_with_handler(
            move |request| {
                call += 1;
                if call == 2 {
                    Vec::new()
                } else {
                    vec![ok_response(
                        request,
                        read_u16(request, OFFSET_OFFSET) + request[PAYLOAD_LENGTH_OFFSET] as u16,
                        read_u16(request, TOTAL_LENGTH_OFFSET),
                    )]
                }
            },
            1,
        );
        client.set_slot(1, &[b'c'; 23]).unwrap();
        let writes = &client.transport_mut().writes;
        let seen: Vec<_> = writes
            .iter()
            .map(|request| {
                (
                    request[REQUEST_ID_OFFSET],
                    read_u16(request, OFFSET_OFFSET),
                    request[PAYLOAD_LENGTH_OFFSET],
                )
            })
            .collect();
        assert_eq!(seen, vec![(0, 0, 22), (0, 22, 1), (1, 0, 22), (1, 22, 1)]);
    }

    #[test]
    fn set_restarts_everything_after_recoverable_transport_error() {
        let mut call = 0;
        let mut client = client_with_handler(
            move |request| {
                call += 1;
                if call == 2 {
                    vec![Err(TransportError::Recoverable("temporary".into()))]
                } else {
                    vec![ok_response(
                        request,
                        read_u16(request, OFFSET_OFFSET) + request[PAYLOAD_LENGTH_OFFSET] as u16,
                        read_u16(request, TOTAL_LENGTH_OFFSET),
                    )]
                }
            },
            1,
        );
        client.set_slot(1, &[b'e'; 23]).unwrap();

        let writes = &client.transport_mut().writes;
        let seen: Vec<_> = writes
            .iter()
            .map(|request| {
                (
                    request[REQUEST_ID_OFFSET],
                    read_u16(request, OFFSET_OFFSET),
                    request[PAYLOAD_LENGTH_OFFSET],
                )
            })
            .collect();
        assert_eq!(seen, vec![(0, 0, 22), (0, 22, 1), (1, 0, 22), (1, 22, 1)]);
        assert_eq!(
            &writes[0][PAYLOAD_OFFSET..PAYLOAD_OFFSET + PAYLOAD_SIZE],
            &[b'e'; 22]
        );
        assert_eq!(&writes[1][PAYLOAD_OFFSET..PAYLOAD_OFFSET + 1], b"e");
        assert_eq!(
            &writes[2][PAYLOAD_OFFSET..PAYLOAD_OFFSET + PAYLOAD_SIZE],
            &[b'e'; 22]
        );
        assert_eq!(&writes[3][PAYLOAD_OFFSET..PAYLOAD_OFFSET + 1], b"e");
    }

    #[test]
    fn set_restarts_after_transaction_status_but_not_storage_or_text_status() {
        for recoverable_status in [Status::BadRequest, Status::BadOffset] {
            let mut calls = 0;
            let mut client = client_with_handler(
                move |request| {
                    calls += 1;
                    if calls == 1 {
                        vec![Ok(FakeTransport::response(
                            request,
                            recoverable_status,
                            &[],
                            0,
                            0,
                        ))]
                    } else {
                        vec![ok_response(
                            request,
                            read_u16(request, OFFSET_OFFSET)
                                + request[PAYLOAD_LENGTH_OFFSET] as u16,
                            read_u16(request, TOTAL_LENGTH_OFFSET),
                        )]
                    }
                },
                1,
            );
            client.set_slot(0, &[b'd'; 23]).unwrap();
            assert_eq!(client.transport_mut().writes[0][REQUEST_ID_OFFSET], 0);
            assert_eq!(client.transport_mut().writes[1][REQUEST_ID_OFFSET], 1);
            assert_eq!(
                read_u16(&client.transport_mut().writes[1], OFFSET_OFFSET),
                0
            );
        }

        for nonrecoverable_status in [Status::StorageError, Status::InvalidText, Status::BadLength]
        {
            let mut client = client_with_handler(
                move |request| {
                    vec![Ok(FakeTransport::response(
                        request,
                        nonrecoverable_status,
                        &[],
                        0,
                        0,
                    ))]
                },
                3,
            );
            assert_eq!(
                client.set_slot(0, b"x"),
                Err(ClientError::Remote(nonrecoverable_status))
            );
            assert_eq!(client.transport_mut().writes.len(), 1);
        }
    }

    #[test]
    fn clear_retries_transport_timeout_and_rejects_remote_status() {
        let mut calls = 0;
        let mut client = client_with_handler(
            move |request| {
                calls += 1;
                if calls == 1 {
                    Vec::new()
                } else {
                    vec![ok_response(request, 0, 0)]
                }
            },
            1,
        );
        client.clear_slot(2).unwrap();
        assert_eq!(
            client
                .transport_mut()
                .writes
                .iter()
                .map(|frame| frame[REQUEST_ID_OFFSET])
                .collect::<Vec<_>>(),
            vec![0, 1]
        );

        let mut error_client = client_with_handler(
            |request| {
                vec![Ok(FakeTransport::response(
                    request,
                    Status::BadSlot,
                    &[],
                    0,
                    0,
                ))]
            },
            3,
        );
        assert_eq!(
            error_client.clear_slot(0),
            Err(ClientError::Remote(Status::BadSlot))
        );
        assert_eq!(error_client.transport_mut().writes.len(), 1);
    }

    #[test]
    fn recoverable_transport_error_is_retried_and_request_ids_wrap() {
        let mut calls = 0;
        let mut client = client_with_handler(
            move |request| {
                calls += 1;
                if calls == 1 {
                    vec![Err(TransportError::Recoverable("temporary".into()))]
                } else {
                    vec![ok_response(request, 0, 0)]
                }
            },
            1,
        );
        client.clear_slot(0).unwrap();
        assert_eq!(client.transport_mut().writes.len(), 2);

        let mut wrap_client = client_with_handler(|request| vec![ok_response(request, 0, 0)], 0);
        wrap_client.next_request_id = u8::MAX;
        wrap_client.clear_slot(0).unwrap();
        wrap_client.clear_slot(0).unwrap();
        assert_eq!(
            wrap_client
                .transport_mut()
                .writes
                .iter()
                .map(|frame| frame[REQUEST_ID_OFFSET])
                .collect::<Vec<_>>(),
            vec![u8::MAX, 0]
        );
    }

    #[test]
    fn list_get_clear_and_set_reject_reserved_slot() {
        let mut client = client_with_handler(|_| Vec::new(), 0);
        assert_eq!(
            client.get_slot(LIST_SLOT),
            Err(ClientError::InvalidSlot(LIST_SLOT))
        );
        assert_eq!(
            client.set_slot(LIST_SLOT, b"x"),
            Err(ClientError::InvalidSlot(LIST_SLOT))
        );
        assert_eq!(
            client.clear_slot(LIST_SLOT),
            Err(ClientError::InvalidSlot(LIST_SLOT))
        );
    }

    #[test]
    fn malformed_error_response_and_version_mismatch_are_not_accepted() {
        let mut client = client_with_handler(
            |request| {
                let mut error = FakeTransport::response(request, Status::BadLength, &[], 0, 0);
                error[OFFSET_OFFSET] = 1;
                vec![Ok(error)]
            },
            0,
        );
        assert_eq!(
            client.get_slot(0),
            Err(ClientError::Protocol(ProtocolError::ErrorResponseNotEmpty))
        );

        let mut version_client = client_with_handler(
            |request| {
                let mut response = FakeTransport::response(request, Status::Ok, &[], 0, 0);
                response[VERSION_OFFSET] = 1;
                vec![Ok(response)]
            },
            0,
        );
        assert!(matches!(
            version_client.get_slot(0),
            Err(ClientError::Protocol(
                ProtocolError::ResponseFieldMismatch {
                    field: "version",
                    ..
                }
            ))
        ));
    }
}
