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

/// 43-02: the `From<PvProviderError> for FfiError` impl the IOS-06 decision
/// record anticipated ("plus `From<PvProviderError> for FfiError` if/when
/// `pv-provider` is touched" — `ios/IOS-SPIKE-LOG.md` §1). There is no
/// dedicated `FfiError::Ceremony` variant and this impl does not add one —
/// `InvalidInput` already carries an arbitrary message, matching
/// `wrap_user_key_json`'s own JSON-decode-error mapping style (`lib.rs`).
/// Every `PvProviderError` variant (`Ceremony`/`InvalidInput`/`Serde`) maps
/// here identically: the distinction that matters to a Swift caller is
/// "the call failed, here is why", not which Rust-side enum variant
/// produced it.
impl From<pv_provider::PvProviderError> for FfiError {
    fn from(e: pv_provider::PvProviderError) -> Self {
        FfiError::InvalidInput(e.to_string())
    }
}
