//! `create_provider_credential`/`get_provider_assertion` — wires
//! `passkey_client::Client` + `passkey_authenticator::Authenticator` +
//! `PvCredentialStore`/`PvUserValidation` into the two ceremony entry points
//! this crate exposes. Only ever called from `pv-wasm` (Task 2), which is
//! responsible for decrypting/encrypting the vault item around these calls
//! (D-07: reuse `pv-core`'s existing per-item AEAD, no second crypto path).
//!
//! ## Async executor (D-18)
//!
//! `passkey_client::Client::register`/`authenticate` are genuinely `async
//! fn` in the pinned 0.5.0 crate (verified against the vendored source under
//! `~/.cargo/registry/src/.../passkey-client-0.5.0/src/lib.rs` — 12-RESEARCH.md
//! Assumption A1's flagged gap). This project has zero tokio/async-runtime
//! dependency anywhere (`pv-core`'s explicit "no I/O" constraint) and our
//! own `CredentialStore`/`UserValidationMethod` impls never actually await
//! real I/O (`PvCredentialStore` is a plain in-memory `Vec`, `PvUserValidation`
//! returns immediately) — so a minimal single-poll executor is sufficient.
//! `pollster` 1.0.1 was used: crates.io legitimacy check performed inline
//! (11 published versions spanning 2020-04-07 to 2026-07-10, consistent
//! maintainer, real repository at github.com/zesterer/pollster, no
//! typosquat-style name confusion — verdict OK) per D-18's pre-approval;
//! see 12-01-SUMMARY.md for the recorded outcome.

// RED phase (TDD gate): these imports are only exercised by the real
// implementation, wired up in this task's GREEN commit — allowed unused here
// so the stub bodies below still compile and fail the behavior tests.
#[allow(unused_imports)]
use passkey_authenticator::{extensions::HmacSecretConfig, Authenticator};
#[allow(unused_imports)]
use passkey_client::{Client, DefaultClientData};
#[allow(unused_imports)]
use passkey_types::{
    ctap2::Aaguid,
    webauthn::{CredentialCreationOptions, CredentialRequestOptions},
    Passkey,
};
#[allow(unused_imports)]
use url::Url;

#[allow(unused_imports)]
use crate::credential_store::{passkey_to_json, PvCredentialStore, PvUserValidation};
use crate::error::PvProviderError;

/// Result of `create_provider_credential`. `new_passkey_json` contains the
/// full serialized `Passkey` INCLUDING the private key — this field exists
/// ONLY to be consumed by `pv-wasm` inside the SAME function call that
/// immediately encrypts it (`core_encrypt_item`); `pv-provider` itself must
/// not be called from anywhere except `pv-wasm`.
pub struct CreateProviderResult {
    /// Public-only WebAuthn response (id/rawId/type/response/
    /// clientExtensionResults) — safe to return to JS/the page. NEVER
    /// contains private key bytes.
    pub credential_response_json: String,
    /// Full serialized `Passkey` (private key included) — secret, local-use
    /// only, never to be returned to JS as-is.
    pub new_passkey_json: String,
}

/// Result of `get_provider_assertion`. `updated_passkey_json` is `Some` only
/// if passkey-rs mutated the credential's internal state (e.g. a sign
/// counter) during the ceremony — `None` if unchanged (the common case,
/// since this authenticator is not configured with
/// `make_credentials_with_signature_counter`, see `create_provider_credential`).
pub struct GetProviderAssertionResult {
    /// Public assertion response — safe to return to JS/the page.
    pub credential_response_json: String,
    /// Full serialized, re-wrappable `Passkey` reflecting any authenticator-
    /// side mutation (secret, local-use only) — `None` if nothing changed.
    pub updated_passkey_json: Option<String>,
}

fn parse_origin(origin: &str) -> Result<Url, PvProviderError> {
    Url::parse(origin).map_err(|_| PvProviderError::InvalidInput("origin is not a valid URL"))
}

// RED phase (TDD gate): ceremony wiring not implemented yet — every call
// fails, so this task's three behavior tests (create_then_get_roundtrip,
// origin_mismatch_rejected, prf_capable_credential) all fail here. GREEN
// commit replaces these bodies with the real passkey-rs wiring.
#[allow(unused_variables)]
pub fn create_provider_credential(
    request_json: &str,
    origin: &str,
) -> Result<CreateProviderResult, PvProviderError> {
    Err(PvProviderError::InvalidInput("create_provider_credential not yet implemented (RED)"))
}

#[allow(unused_variables)]
pub fn get_provider_assertion(
    request_json: &str,
    origin: &str,
    existing_credentials_json: &str,
) -> Result<GetProviderAssertionResult, PvProviderError> {
    Err(PvProviderError::InvalidInput("get_provider_assertion not yet implemented (RED)"))
}
