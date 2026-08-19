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

use passkey_authenticator::{extensions::HmacSecretConfig, Authenticator};
use passkey_client::{Client, DefaultClientData};
use passkey_types::{
    ctap2::Aaguid,
    webauthn::{CredentialCreationOptions, CredentialRequestOptions},
    Passkey,
};
use url::Url;

use crate::{
    credential_store::{passkey_to_json, PvCredentialStore, PvUserValidation},
    error::PvProviderError,
};

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

/// Registers a new passkey against `request_json` (a WebAuthn
/// `PublicKeyCredentialCreationOptions`-shaped JSON, wrapped in `{"publicKey":
/// ...}` per `CredentialCreationOptions`'s own shape) from `origin`. Starts
/// from an EMPTY in-memory credential store — this ceremony only ever
/// creates one new credential; it has no need to see any of the caller's
/// existing passkeys (exclude-list checking against an empty store is a
/// no-op per `passkey-authenticator`'s own `make_credential` — see this
/// file's `<behavior>`-contract-verifying tests).
pub fn create_provider_credential(
    request_json: &str,
    origin: &str,
) -> Result<CreateProviderResult, PvProviderError> {
    let request: CredentialCreationOptions = serde_json::from_str(request_json)
        .map_err(|e| PvProviderError::Serde(format!("create request JSON decode failed: {e}")))?;
    let origin_url = parse_origin(origin)?;

    let store = PvCredentialStore::from_passkeys_json("[]")?;
    let authenticator = Authenticator::new(Aaguid::new_empty(), store, PvUserValidation)
        // D-06/D-07/PROV-04: enable the hmac-secret (PRF) extension on the
        // authenticator itself — passkey-rs computes PRF entirely in WASM
        // when the RP's create() request includes the prf extension (D-16),
        // never a second, hand-rolled implementation.
        .hmac_secret(HmacSecretConfig::new_without_uv());
    // 13-03-PLAN.md deviation (Playwright dual-browser harness, Task 2):
    // `passkey_client::Client`'s `RpIdVerifier` rejects `rp_id == "localhost"`
    // outright unless `.allows_insecure_localhost(true)` is set (defaults to
    // `false` in passkey-client@0.5.0's `RpIdVerifier::new`) -- confirmed by
    // reading `~/.cargo/registry/.../passkey-client-0.5.0/src/rp_id_verifier.rs`
    // after a real end-to-end Playwright ceremony against a local
    // `http://localhost:*` RP test page silently fell through to native
    // WebAuthn with `InsecureLocalhostNotAllowed` logged server-side. Every
    // OTHER rp_id still requires `origin.scheme() == "https"` (unchanged,
    // `assert_web_rp_id`'s own check) -- this flag ONLY special-cases the
    // fixed literal string "localhost", which a hostile remote site cannot
    // spoof (WebAuthn's own browser-level rpId-vs-origin match already
    // requires the CALLING PAGE's own origin to genuinely be `localhost`
    // for this branch to matter at all). This mirrors the same
    // "http://localhost is a browser-recognized secure context" allowance
    // Chrome itself already grants WebAuthn, and is genuinely useful for
    // self-hosters registering passkeys against their OWN locally-served
    // apps, not just this test harness -- flagged here for Bartek's
    // awareness/review, not silently assumed permanent.
    let mut client = Client::new(authenticator).allows_insecure_localhost(true);

    let response = pollster::block_on(client.register(&origin_url, request, DefaultClientData))
        .map_err(|e| PvProviderError::Ceremony(format!("{e:?}")))?;

    // The store started empty and `make_credential` (invoked internally by
    // `register`) calls `CredentialStore::save_credential` exactly once on
    // success — the new Passkey is now the store's only entry.
    let new_passkey: &Passkey = client
        .authenticator()
        .store()
        .passkeys()
        .last()
        .ok_or_else(|| {
            PvProviderError::Ceremony("registration succeeded but no credential was saved".into())
        })?;

    let credential_response_json = serde_json::to_string(&response).map_err(|e| {
        PvProviderError::Serde(format!("credential response JSON encode failed: {e}"))
    })?;
    let new_passkey_json = passkey_to_json(new_passkey)?;

    Ok(CreateProviderResult { credential_response_json, new_passkey_json })
}

/// **EXT-10 decision record (no per-item signature-counter tracking for
/// shared provider passkeys), committed before any dependent code per the
/// KEY-05 precedent (`.planning/PROJECT.md`'s Key Decisions table carries a
/// matching row):**
///
/// EXT-10's own requirement text frames this as "no shipped product
/// precedent exists — the starting hypothesis is server-authoritative
/// counter state." That framing is factually incorrect. A direct code read
/// of THIS function and `create_provider_credential` above shows the
/// `Authenticator` is constructed with `Authenticator::new(...)` and never
/// opts in to `make_credentials_with_signature_counter(true)` — the only way
/// `passkey-authenticator` 0.5.0 tracks a counter at all. `counter_before`/
/// `after_pk.counter` (both `Option<u32>`) compared just below always stay
/// `None`, so `updated_passkey_json` is always `None` on this axis — and
/// `crates/pv-provider/tests/response_shape.rs`'s
/// `sign_count_is_always_zero_for_a_provider_ceremony_assertion` (EXT-10
/// Task 1) confirms this empirically on the RAW WIRE BYTES: it decodes
/// the base64url `response.authenticatorData` field returned to the page
/// and reads the fixed 4-byte big-endian counter at offset 33..37,
/// asserting it is 0 — a stronger claim than trusting the Rust-side
/// `Option<u32>` alone. That in-process test is the permanent
/// fast-regression tier only; the genuine live-wire measurement against a
/// real browser and a real RP is completed downstream by 27-06's headed
/// dual-extension ceremony spec.
///
/// **Decision: no counter is added.** WebAuthn L3 §6.1.1 explicitly permits
/// an authenticator that "does not implement a signature counter" to report
/// a constant 0 — this is not a workaround, it is a spec-sanctioned
/// authenticator category. Industry precedent confirms it is also the
/// SHIPPED behavior of every major synced-passkey provider: both iCloud
/// Keychain and Google Password Manager report a constant `signCount: 0` for
/// synced passkeys (27-RESEARCH.md Secondary sources) — exactly the
/// "multiple concurrently active instances of one logical credential" shape
/// `pv-provider`'s shared provider passkeys now have (27-CONTEXT.md's
/// pluralization-promotion, ROADMAP SC 3).
///
/// **Explicit anti-goal:** no per-item monotonic counter is ever introduced
/// here to "fix" this. A passkey shared across N concurrently active member
/// extensions has no single authoritative "last counter value" to advance
/// from — two members' extensions would race on writing a revision-guarded
/// row, manufacturing exactly the counter-regression false-positive EXT-10
/// exists to prevent. Promotion (27-CONTEXT.md §A-8) is realized by NOT
/// adding per-device state, not by adding N-way coordination for it.
///
/// **SEC-04 classifier-reachability finding (27-CONTEXT.md §A-8 step 3):** a
/// provider-ceremony assertion structurally cannot reach the Phase 19 SEC-04
/// counter-anomaly classifier
/// (`crates/pv-server/src/routes/passkeys.rs:299-350`,
/// `handle_finish_auth_error`). That classifier is called from exactly 3
/// sites — `crates/pv-server/src/routes/passkeys.rs:269` (`prf_wrap`),
/// `crates/pv-server/src/routes/passkeys.rs:552` (`unlock_finish`), and
/// `crates/pv-server/src/routes/auth.rs:575` (`passkey_login_finish`) —
/// every one inside pv-server's own `webauthn-rs` vault login/unlock
/// ceremony, verified against the `passkeys` table (the vault's OWN login
/// credentials, never a provider-issued ITEM passkey). `pv-provider`'s
/// `Cargo.toml` has no `webauthn-rs`, `sqlx`, or `pv-server` edge in its
/// `[dependencies]` section — this crate implements the AUTHENTICATOR side
/// of a ceremony against THIRD-PARTY relying parties and structurally never
/// calls any pv-server route handler. (Pre-empting the obvious grep-based
/// objection: `webauthn-rs = "0.5"` IS present, but only under
/// `[dev-dependencies]` at `Cargo.toml:46`, as QA-03's independent
/// cross-vendor test verifier in `tests/real_rp_verification.rs` — a
/// dev-dependency is not on any production code path, so this does not
/// affect the unreachability conclusion.) The two code paths cannot meet:
/// ROADMAP SC 3's "does not trip the Phase 19 (SEC-04) sign-counter anomaly
/// classifier" clause is satisfied structurally, not by omission — this is
/// proof the classifier cannot fire, not merely a record that we shipped no
/// counter.
///
/// Authenticates against `request_json` (a WebAuthn
/// `PublicKeyCredentialRequestOptions`-shaped JSON, wrapped in `{"publicKey":
/// ...}`) from `origin`, using `existing_credentials_json` (a JSON array of
/// already-decrypted `Passkey` blobs, produced by `passkey_to_json` — the
/// single matching vault item's decrypted content, per `pv-wasm`'s Task 2
/// contract) as the in-memory credential store's initial contents.
pub fn get_provider_assertion(
    request_json: &str,
    origin: &str,
    existing_credentials_json: &str,
) -> Result<GetProviderAssertionResult, PvProviderError> {
    let request: CredentialRequestOptions = serde_json::from_str(request_json)
        .map_err(|e| PvProviderError::Serde(format!("get request JSON decode failed: {e}")))?;
    let origin_url = parse_origin(origin)?;

    let store = PvCredentialStore::from_passkeys_json(existing_credentials_json)?;
    let passkeys_before: Vec<Passkey> = store.passkeys().to_vec();

    let authenticator = Authenticator::new(Aaguid::new_empty(), store, PvUserValidation)
        .hmac_secret(HmacSecretConfig::new_without_uv());
    // See create_provider_credential's matching comment above -- same
    // 13-03-PLAN.md deviation, same rationale, kept consistent across both
    // ceremony entry points.
    let mut client = Client::new(authenticator).allows_insecure_localhost(true);

    let response =
        pollster::block_on(client.authenticate(&origin_url, request, DefaultClientData))
            .map_err(|e| PvProviderError::Ceremony(format!("{e:?}")))?;

    let credential_id: Vec<u8> = response.raw_id.clone().into();
    let passkeys_after = client.authenticator().store().passkeys();
    let matching_after = passkeys_after
        .iter()
        .find(|pk| Vec::from(pk.credential_id.clone()) == credential_id);

    let updated_passkey_json = match matching_after {
        Some(after_pk) => {
            let counter_before = passkeys_before
                .iter()
                .find(|pk| Vec::from(pk.credential_id.clone()) == credential_id)
                .and_then(|pk| pk.counter);
            if counter_before != after_pk.counter {
                Some(passkey_to_json(after_pk)?)
            } else {
                None
            }
        }
        None => None,
    };

    let credential_response_json = serde_json::to_string(&response).map_err(|e| {
        PvProviderError::Serde(format!("assertion response JSON encode failed: {e}"))
    })?;

    Ok(GetProviderAssertionResult { credential_response_json, updated_passkey_json })
}
