use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, Zeroizing};

use crate::error::AuthError;

pub const KDF_ID: u8 = 1;
pub const DEFAULT_ITERATIONS: u32 = 600_000;
pub const MIN_ITERATIONS: u32 = 100_000;
pub const MAX_ITERATIONS: u32 = 5_000_000;
pub const SALT_SIZE: usize = 16;
pub const KEY_SIZE: usize = 32;
pub const NONCE_SIZE: usize = 16;
pub const PROOF_SIZE: usize = 16;
pub const AUTH_DOMAIN: &[u8] = b"ZMK-RUNTIME-MACRO-AUTH-V2";

/// A challenge nonce returned by the device.
///
/// Nonces are intentionally not `Debug` or `Serialize`; callers should pass
/// them directly to [`Credential::proof`] instead of putting them in logs or
/// DTOs.
pub struct Nonce([u8; NONCE_SIZE]);

impl Nonce {
    pub(crate) fn from_wire(bytes: [u8; NONCE_SIZE]) -> Result<Self, AuthError> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(AuthError::InvalidNonce);
        }
        Ok(Self(bytes))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; NONCE_SIZE] {
        &self.0
    }
}

/// The truncated proof sent in an AUTH_PROVE request.
///
/// Proof bytes are intentionally not `Debug` or `Serialize` because they are
/// authentication material, even though the wire format exposes them to the
/// connected device.
pub struct Proof([u8; PROOF_SIZE]);

impl Proof {
    pub(crate) fn as_bytes(&self) -> &[u8; PROOF_SIZE] {
        &self.0
    }
}

/// Password-derived v2 credential material.
///
/// The key is kept private and zeroized on drop. This type has no `Debug`,
/// `Serialize`, or raw-key accessor implementation by design.
pub struct Credential {
    iterations: u32,
    salt: [u8; SALT_SIZE],
    key: [u8; KEY_SIZE],
}

impl Credential {
    /// Derive a credential from a password after Unicode NFC normalization.
    ///
    /// The supplied salt is copied and never generated from a weak local
    /// source. Production callers that need a new credential should use
    /// [`Self::generate`], while tests may use a fixed non-zero salt here for
    /// reproducible vectors.
    pub fn derive(
        password: &str,
        salt: [u8; SALT_SIZE],
        iterations: u32,
    ) -> Result<Self, AuthError> {
        let normalized_password = normalize_password(password)?;
        Self::derive_normalized(normalized_password, salt, iterations)
    }

    /// Generate a new credential using the operating system CSPRNG for salt.
    pub fn generate(password: &str) -> Result<Self, AuthError> {
        // Validate the password before touching the random source so an empty
        // input has deterministic, non-secret error semantics.
        let normalized_password = normalize_password(password)?;
        let mut salt = [0u8; SALT_SIZE];
        getrandom::getrandom(&mut salt).map_err(|_| AuthError::RandomnessUnavailable)?;

        if salt.iter().all(|byte| *byte == 0) {
            salt.zeroize();
            return Err(AuthError::InvalidSalt);
        }

        Self::derive_normalized(normalized_password, salt, DEFAULT_ITERATIONS)
    }

    fn derive_normalized(
        normalized_password: Zeroizing<Vec<u8>>,
        salt: [u8; SALT_SIZE],
        iterations: u32,
    ) -> Result<Self, AuthError> {
        validate_parameters(&salt, iterations)?;

        let mut key = [0u8; KEY_SIZE];
        pbkdf2_hmac::<Sha256>(&normalized_password, &salt, iterations, &mut key);

        if key.iter().all(|byte| *byte == 0) {
            key.zeroize();
            return Err(AuthError::InvalidDerivedKey);
        }

        Ok(Self {
            iterations,
            salt,
            key,
        })
    }

    pub fn iterations(&self) -> u32 {
        self.iterations
    }

    pub fn salt(&self) -> [u8; SALT_SIZE] {
        self.salt
    }

    /// Calculate `Truncate16(HMAC-SHA256(K, domain || nonce))`.
    pub fn proof(&self, nonce: &Nonce) -> Proof {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key)
            .expect("HMAC-SHA256 accepts a fixed-size credential key");
        mac.update(AUTH_DOMAIN);
        mac.update(nonce.as_bytes());
        let mut full = mac.finalize().into_bytes();
        let mut proof = [0u8; PROOF_SIZE];
        proof.copy_from_slice(&full[..PROOF_SIZE]);
        full.zeroize();
        Proof(proof)
    }

    /// Write the exact 52-byte PASSWORD_SET object without exposing the key
    /// through a return value. The destination remains the caller's secret
    /// buffer and must be zeroized when the request is complete.
    pub(crate) fn write_password_set_object(
        &self,
        destination: &mut [u8],
    ) -> Result<(), AuthError> {
        if destination.len() != crate::protocol::PASSWORD_SET_LENGTH {
            return Err(AuthError::InvalidDerivedKey);
        }

        destination[..4].copy_from_slice(&self.iterations.to_le_bytes());
        destination[4..4 + SALT_SIZE].copy_from_slice(&self.salt);
        destination[4 + SALT_SIZE..].copy_from_slice(&self.key);
        Ok(())
    }

    #[cfg(test)]
    fn key_for_test(&self) -> &[u8; KEY_SIZE] {
        &self.key
    }
}

impl Drop for Credential {
    fn drop(&mut self) {
        self.key.zeroize();
        self.salt.zeroize();
    }
}

impl Drop for Nonce {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for Proof {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Local client-side view of the device's authentication session.
///
/// The device remains authoritative for expiry. This type only tracks the
/// public protected/authenticated state and never caches credential material.
pub struct AuthSession {
    protected: bool,
    authenticated: bool,
}

impl Default for AuthSession {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthSession {
    pub fn new() -> Self {
        Self {
            protected: false,
            authenticated: false,
        }
    }

    /// Observe the device-authoritative public AUTH_INFO state. No credential
    /// material is cached here; these booleans are only the local UI/session
    /// view.
    pub fn observe(&mut self, protected: bool, authenticated: bool) {
        self.protected = protected;
        self.authenticated = protected && authenticated;
    }

    pub fn is_protected(&self) -> bool {
        self.protected
    }

    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    pub(crate) fn install_authenticated(&mut self) {
        self.protected = true;
        self.authenticated = true;
    }

    pub(crate) fn clear_session(&mut self) {
        self.authenticated = false;
    }

    pub(crate) fn become_protected(&mut self) {
        self.protected = true;
        self.clear_session();
    }
}

fn validate_parameters(salt: &[u8; SALT_SIZE], iterations: u32) -> Result<(), AuthError> {
    if !(MIN_ITERATIONS..=MAX_ITERATIONS).contains(&iterations) {
        return Err(AuthError::InvalidIterations);
    }
    if salt.iter().all(|byte| *byte == 0) {
        return Err(AuthError::InvalidSalt);
    }
    Ok(())
}

fn normalize_password(password: &str) -> Result<Zeroizing<Vec<u8>>, AuthError> {
    let normalized: String = password.nfc().collect();
    let bytes = normalized.into_bytes();
    if bytes.is_empty() {
        return Err(AuthError::EmptyPassword);
    }
    Ok(Zeroizing::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_SALT: [u8; SALT_SIZE] = [
        0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87, 0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe,
        0x0f,
    ];

    #[test]
    fn password_is_nfc_normalized_before_utf8_kdf() {
        let composed = Credential::derive("Cafe\u{301}", FIXTURE_SALT, MIN_ITERATIONS).unwrap();
        let decomposed = Credential::derive("Caf\u{e9}", FIXTURE_SALT, MIN_ITERATIONS).unwrap();
        assert_eq!(composed.key_for_test(), decomposed.key_for_test());
    }

    #[test]
    fn empty_and_invalid_credential_parameters_are_rejected() {
        assert!(matches!(
            Credential::derive("", FIXTURE_SALT, DEFAULT_ITERATIONS),
            Err(AuthError::EmptyPassword)
        ));
        assert!(matches!(
            Credential::derive("fixture", [0; SALT_SIZE], DEFAULT_ITERATIONS),
            Err(AuthError::InvalidSalt)
        ));
        assert!(matches!(
            Credential::derive("fixture", FIXTURE_SALT, MIN_ITERATIONS - 1),
            Err(AuthError::InvalidIterations)
        ));
        assert!(matches!(
            Credential::derive("fixture", FIXTURE_SALT, MAX_ITERATIONS + 1),
            Err(AuthError::InvalidIterations)
        ));
    }

    #[test]
    fn proof_uses_the_v2_domain_and_nonce() {
        let credential =
            Credential::derive("fixture-password", FIXTURE_SALT, MIN_ITERATIONS).unwrap();
        let nonce = Nonce::from_wire([
            0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad,
            0xae, 0xaf,
        ])
        .unwrap();
        let proof = credential.proof(&nonce);
        assert_eq!(
            proof.as_bytes(),
            &[
                0x14, 0x83, 0x21, 0xb9, 0x4d, 0xf1, 0x6f, 0x05, 0x77, 0xb3, 0x7c, 0x0e, 0xf4, 0x63,
                0x57, 0x6e,
            ]
        );
    }

    #[test]
    fn generated_credential_uses_default_kdf_and_wire_object_layout() {
        let credential = Credential::generate("fixture-generated-password").unwrap();
        assert_eq!(credential.iterations(), DEFAULT_ITERATIONS);
        assert!(credential.salt().iter().any(|byte| *byte != 0));

        let mut object = [0u8; crate::protocol::PASSWORD_SET_LENGTH];
        credential.write_password_set_object(&mut object).unwrap();
        assert_eq!(&object[..4], &DEFAULT_ITERATIONS.to_le_bytes());
        assert_eq!(&object[4..20], &credential.salt());
        assert!(object[20..].iter().any(|byte| *byte != 0));
    }

    #[test]
    fn auth_session_follows_device_authoritative_state_without_credentials() {
        let mut session = AuthSession::new();
        session.observe(true, true);
        assert!(session.is_protected());
        assert!(session.is_authenticated());

        session.observe(true, false);
        assert!(!session.is_authenticated());

        session.install_authenticated();
        assert!(session.is_authenticated());
        session.observe(false, false);
        assert!(!session.is_protected());
        assert!(!session.is_authenticated());
    }
}
