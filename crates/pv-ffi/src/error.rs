//! FfiError — pv-ffi's OWN error enum, normalizing at the binding boundary
//! exactly the way `pv-wasm`'s `to_js_err`/`to_js_str_err` do for JS.
//!
//! `pv_core::CryptoError` cannot derive `uniffi::Error` directly: it (and
//! `pv_provider::PvProviderError`) carry an `InvalidInput(&'static str)`
//! variant, and UniFFI has no builtin-type mapping for an owned enum variant
//! holding `&'static str` (only `&str`/`&[T]` as `[ByRef]` function-argument
//! types, valid for one call, not storable in an owned Result payload). See
//! the IOS-06 decision record (`ios/IOS-SPIKE-LOG.md` §1, "Error type
//! normalization") for the full evidence trail.
//!
//! `pv_core::CryptoError` itself is NEVER modified or made `uniffi`-aware
//! (P2) — this file is where the impedance mismatch is absorbed, mirroring
//! `pv-wasm`'s thin-binding-crate split exactly.

use thiserror::Error;

#[derive(Debug, Error, uniffi::Error)]
pub enum FfiError {
    #[error("key derivation failed")]
    Kdf,
    #[error("decryption failed (wrong key or corrupted data)")]
    Decrypt,
    #[error("encryption failed")]
    Encrypt,
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

impl From<pv_core::CryptoError> for FfiError {
    fn from(e: pv_core::CryptoError) -> Self {
        match e {
            pv_core::CryptoError::Kdf => FfiError::Kdf,
            pv_core::CryptoError::Decrypt => FfiError::Decrypt,
            pv_core::CryptoError::Encrypt => FfiError::Encrypt,
            pv_core::CryptoError::InvalidInput(msg) => FfiError::InvalidInput(msg.to_string()),
        }
    }
}
