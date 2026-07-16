use thiserror::Error;

/// Errors surfaced by the provider ceremony/store layer. Mirrors
/// `pv-core::error::CryptoError`'s style (thiserror-derived, explicit
/// variants, no bare `anyhow::Error` leaking into this crate's public API).
#[derive(Debug, Error)]
pub enum PvProviderError {
    /// Wraps the underlying `passkey-client`/`passkey-authenticator`
    /// ceremony error's `Display` output (`WebauthnError`/`StatusCode` don't
    /// implement `std::error::Error`, so we capture their message as a
    /// `String` rather than losing it).
    #[error("passkey ceremony failed: {0}")]
    Ceremony(String),

    /// Caller-supplied input (request JSON, existing-credentials JSON) was
    /// malformed or violated an invariant this crate enforces.
    #[error("invalid input: {0}")]
    InvalidInput(&'static str),

    /// JSON (de)serialization failure — kept distinct from `Ceremony` so
    /// callers can tell a malformed request apart from a WebAuthn-level
    /// rejection (e.g. origin mismatch).
    #[error("(de)serialization failed: {0}")]
    Serde(String),
}
