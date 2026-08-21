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

use coset::iana;
use passkey_authenticator::{extensions::HmacSecretConfig, Authenticator};
use passkey_client::{Client, DefaultClientData};
use passkey_types::{
    ctap2::{self, Aaguid},
    webauthn::{
        CredentialCreationOptions, CredentialRequestOptions, PublicKeyCredentialDescriptor,
        PublicKeyCredentialParameters, PublicKeyCredentialType,
    },
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
/// `sign_count_is_always_zero_for_a_provider_ceremony_assertion` (EXT-10 Task
/// 1) confirms this empirically on the RAW WIRE BYTES: it decodes the
/// base64url `response.authenticatorData` field returned to the page and
/// reads the fixed 4-byte big-endian counter at offset 33..37, asserting it
/// is 0 — a stronger claim than trusting the Rust-side `Option<u32>` alone.
/// That in-process test is the permanent fast-regression tier only; the
/// genuine live-wire measurement against a real browser and a real RP is
/// completed downstream by 27-06's headed dual-extension ceremony spec.
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

/// Result of `get_assertion_ctap2`. Every field is a PUBLIC WebAuthn
/// response value -- credential id, user handle, signature, authenticator
/// data -- NEVER raw private-key bytes. This is the T-43-02 mitigation
/// (43-02-PLAN.md's threat register): `pv-ffi`'s `provider_get_assertion`
/// returns this struct verbatim (via a 1:1 `FfiProviderAssertionResult`
/// mirror), so this struct's own shape IS the enforcement point, not a
/// downstream filter that could be forgotten.
#[derive(Debug)]
pub struct GetAssertionCtap2Result {
    pub credential_id: Vec<u8>,
    pub user_handle: Option<Vec<u8>>,
    pub signature: Vec<u8>,
    pub authenticator_data: Vec<u8>,
}

/// CTAP2-level assertion entry point for iOS's `ASCredentialProviderViewController`
/// (OPT-03, `43-RESEARCH.md` Finding 2). iOS hands a credential provider a
/// pre-computed `clientDataHash` -- never a full WebAuthn options JSON --
/// so `get_provider_assertion` above (which builds/hashes `clientData`
/// itself, internally, via `passkey_client::Client::authenticate`) CANNOT
/// be reused for this path: SHA-256 is not invertible, so there is no way
/// to recover the JSON `Client::authenticate` expects from a hash alone
/// (43-RESEARCH.md "Anti-patterns to avoid", first bullet). This function
/// instead calls `passkey_authenticator::Authenticator::get_assertion`
/// directly -- one layer BELOW `passkey_client::Client`, and the only layer
/// in this dependency graph whose `Request` type takes `client_data_hash:
/// Bytes` as a first-class field
/// (`passkey-types-0.5.0/src/ctap2/get_assertion.rs:33`, vendored source).
///
/// Same `PvCredentialStore`/`PvUserValidation` types as
/// `get_provider_assertion` above -- never a second store implementation --
/// and the SAME EXT-10 posture: the `Authenticator::new(...)` construction
/// below is never opted into `make_credentials_with_signature_counter(true)`,
/// for the identical reasons `get_provider_assertion`'s own EXT-10 decision
/// record states above (no counter is ever tracked for a provider-issued
/// passkey; see `tests/ctap2_ceremony.rs` for this function's own
/// fast-regression proof of that property on raw wire bytes). Unlike both
/// existing entry points, this authenticator is never given
/// `.hmac_secret(...)` either -- OPT-01 (43-RESEARCH.md "Locked Decisions")
/// scopes PRF entirely out of Phase 43, so this construction is narrower
/// than either of the two functions above it in this file, not merely a
/// CTAP2-shaped rewrite of them.
pub fn get_assertion_ctap2(
    rp_id: &str,
    client_data_hash: Vec<u8>,
    allow_credential_id: Option<Vec<u8>>,
    existing_credentials_json: &str,
) -> Result<GetAssertionCtap2Result, PvProviderError> {
    let store = PvCredentialStore::from_passkeys_json(existing_credentials_json)?;
    let mut authenticator = Authenticator::new(Aaguid::new_empty(), store, PvUserValidation);

    let request = ctap2::get_assertion::Request {
        rp_id: rp_id.to_string(),
        client_data_hash: client_data_hash.into(),
        allow_list: allow_credential_id.map(|id| {
            vec![PublicKeyCredentialDescriptor {
                ty: PublicKeyCredentialType::PublicKey,
                id: id.into(),
                transports: None,
            }]
        }),
        // No PRF/hmac-secret this phase -- OPT-01 scopes it out entirely,
        // mirroring the two functions above never opting this authenticator
        // into HmacSecretConfig either.
        extensions: None,
        options: Default::default(),
        // CTAP2 PIN protocol is not this crate's concern -- user
        // presence/verification is already asserted unconditionally by
        // `PvUserValidation` (real consent already happened via the
        // popup/confirmation UI before this function is ever called, same
        // ordering guarantee `PvUserValidation`'s own doc comment states).
        pin_auth: None,
        pin_protocol: None,
    };

    let response = pollster::block_on(authenticator.get_assertion(request))
        .map_err(|e| PvProviderError::Ceremony(format!("{e:?}")))?;

    // `Response::credential` is documented as "may be omitted if the
    // allowList has exactly one Credential" -- but this crate's own
    // `Authenticator::get_assertion` (passkey-authenticator=0.5.0) always
    // populates it (`Some(credential.as_credential_descriptor(None))`,
    // vendored source), so treating an absent value as a ceremony failure
    // (rather than silently falling back to the request's own
    // `allow_credential_id`) surfaces a real upstream-behavior change loudly
    // instead of masking it.
    let credential_id: Vec<u8> = response.credential.map(|c| Vec::from(c.id)).ok_or_else(|| {
        PvProviderError::Ceremony(
            "get_assertion succeeded but returned no credential descriptor".into(),
        )
    })?;
    let user_handle = response.user.map(|u| Vec::from(u.id));
    let signature: Vec<u8> = response.signature.into();
    // `AuthenticatorData::to_vec()` -- the SAME raw-byte encoding
    // `response_shape.rs`'s own EXT-10 test decodes off the base64url wire
    // field for the WebAuthn-client-level path; here it is already plain
    // bytes, no base64url unwrap needed (`tests/ctap2_ceremony.rs`, Task 2).
    let authenticator_data = response.auth_data.to_vec();

    Ok(GetAssertionCtap2Result { credential_id, user_handle, signature, authenticator_data })
}

/// Result of `make_credential_ctap2`. `attestation_object` is the CBOR-encoded
/// WebAuthn `attestationObject` (public, `fmt`/`authData`/`attStmt`) -- PUBLIC
/// WebAuthn response material, never raw private-key bytes. `new_passkey_json`
/// mirrors `CreateProviderResult.new_passkey_json`'s existing secrecy contract
/// (local-use only, the caller MUST re-encrypt it immediately and never
/// surface it to any UI layer) but NOT its `credential_response_json` field --
/// iOS needs the raw CBOR `attestationObject`, not a WebAuthn JSON response.
#[derive(Debug)]
pub struct MakeCredentialCtap2Result {
    pub credential_id: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub new_passkey_json: String,
}

/// CTAP2-level registration entry point for iOS's `ASCredentialProviderViewController`
/// (OPT-03, `43-RESEARCH.md` Finding 2, Open Question 3) -- the registration
/// counterpart to `get_assertion_ctap2` above, completing the matched pair
/// 43-RESEARCH.md Pitfall 7 flags as a phase-scope failure if shipped alone.
///
/// Same `PvCredentialStore`/`PvUserValidation` types as every other entry
/// point in this file -- never a second store implementation. Unlike
/// `get_assertion_ctap2`, this function DOES take `existing_credentials_json`
/// (a deviation from this plan's originally-authored signature, recorded in
/// 43-04-SUMMARY.md): CTAP2's `exclude_list` check
/// (`passkey_authenticator::Authenticator::make_credential`, step 1) is
/// resolved via `self.store().find_credentials(exclude_list, rp_id, ...)` --
/// against an EMPTY store, `find_credentials` always returns
/// `Ctap2Error::NoCredentials`, which `make_credential` treats as "nothing to
/// exclude" (vendored source, `authenticator/make_credential.rs`), making
/// `exclude_list` a structural no-op exactly as `create_provider_credential`'s
/// own doc comment above already documents for the WebAuthn-client path. This
/// function's own `must_haves.truths`/`<behavior>` contract requires the
/// exclude-list to be HONORED, not silently ignored -- which is only possible
/// if the caller's existing passkeys for this `rp_id` are actually present in
/// the store, the same reason `get_assertion_ctap2`/`get_provider_assertion`
/// both already take an `existing_credentials_json` parameter. A SECOND,
/// independent finding (also recorded in 43-04-SUMMARY.md) makes a populated
/// store necessary but not SUFFICIENT: `passkey_authenticator::Authenticator::
/// make_credential`'s own exclude-list handling never actually terminates the
/// ceremony on a match (confirmed against the crate's own test suite, see
/// this function's body for the full citation) -- so this function performs
/// its own explicit exclude-list rejection against `existing_credentials_json`
/// BEFORE calling into the library at all, rather than relying on the
/// library's (non-functional) enforcement.
///
/// Same EXT-10 posture as every other entry point in this file: the
/// `Authenticator::new(...)` construction below is never opted into
/// `make_credentials_with_signature_counter(true)` -- no per-item signature
/// counter is ever tracked for a provider-issued passkey, for the identical
/// reasons `get_provider_assertion`'s own EXT-10 decision record states above
/// (a passkey shared across N concurrently active member extensions has no
/// single authoritative "last counter value" to advance from). Also never
/// `.hmac_secret(...)` -- OPT-01 (43-RESEARCH.md "Locked Decisions") scopes
/// PRF entirely out of Phase 43, matching `get_assertion_ctap2`'s identical
/// narrower construction (no PRF) rather than the two WebAuthn-client-level
/// functions above (which do enable it).
///
/// Only ever issues `fmt: "none"` (no attestation certificate, T-43-05) ES256
/// (`-7`, T-43-06) credentials -- `supported_algorithms` is checked for `-7`
/// BEFORE any credential is constructed (fail before allocating, mirroring
/// WR-11's own "check before you allocate" discipline), and a picky RP
/// requesting only a different algorithm gets an honest `Err`, never a
/// wrong-algorithm credential.
pub fn make_credential_ctap2(
    rp_id: &str,
    rp_name: Option<&str>,
    user_id: Vec<u8>,
    user_name: &str,
    user_display_name: Option<&str>,
    client_data_hash: Vec<u8>,
    supported_algorithms: &[i64],
    excluded_credential_ids: &[Vec<u8>],
    existing_credentials_json: &str,
) -> Result<MakeCredentialCtap2Result, PvProviderError> {
    // -7 == coset::iana::Algorithm::ES256 (COSE Algorithms registry) --
    // checked as a raw i64 here since `supported_algorithms` crosses the
    // FFI boundary as `Vec<i64>` (iOS's own `ASAuthorizationPublicKeyCredentialParameters`
    // shape), never assumed to already be a validated `iana::Algorithm`.
    const ES256_COSE_ALG: i64 = -7;
    if !supported_algorithms.contains(&ES256_COSE_ALG) {
        return Err(PvProviderError::InvalidInput(
            "RP does not accept ES256, the only algorithm this authenticator issues",
        ));
    }

    let store = PvCredentialStore::from_passkeys_json(existing_credentials_json)?;

    // CTAP2 §6.1 step 1 enforcement, performed HERE rather than trusting
    // `passkey_authenticator::Authenticator::make_credential` (=0.5.0) to do
    // it (Rule 1/Rule 2 deviation, recorded in 43-04-SUMMARY.md): direct
    // source read of the crate's OWN test suite
    // (`passkey-authenticator-0.5.0/src/authenticator/make_credential/tests.rs::assert_excluded_credentials`)
    // shows its exclude-list handling calls
    // `check_user(UiHint::InformExcludedCredentialFound(...))` as an
    // informational hint ONLY and then proceeds to create the credential
    // regardless -- that test's own `.expect("Excluded id gets ignored")`,
    // with the spec-correct `.expect_err(CredentialExcluded)` assertion
    // commented out immediately below it, is upstream's own admission that
    // the CTAP2-mandated "wait for user presence, then terminate ... return
    // CTAP2_ERR_CREDENTIAL_EXCLUDED" step is not implemented. This
    // function's own must_haves.truths/<behavior> contract requires the
    // exclude-list to be HONORED, not silently ignored, so it is checked
    // against the caller-supplied `existing_credentials_json` before the
    // library is ever invoked.
    if !excluded_credential_ids.is_empty() {
        let already_registered = store.passkeys().iter().any(|pk| {
            pk.rp_id == rp_id
                && excluded_credential_ids
                    .iter()
                    .any(|id| Vec::from(pk.credential_id.clone()) == *id)
        });
        if already_registered {
            return Err(PvProviderError::Ceremony(
                "credential excluded: an existing credential for this rp_id is present in \
                 excluded_credential_ids"
                    .into(),
            ));
        }
    }

    let mut authenticator = Authenticator::new(Aaguid::new_empty(), store, PvUserValidation);
    // NEVER .hmac_secret(...) -- OPT-01 scopes PRF out of Phase 43 (see
    // this function's own doc comment above).
    // NEVER make_credentials_with_signature_counter(true) -- EXT-10 applies
    // identically to registration (see this function's own doc comment
    // above).

    let exclude_list = if excluded_credential_ids.is_empty() {
        None
    } else {
        Some(
            excluded_credential_ids
                .iter()
                .map(|id| PublicKeyCredentialDescriptor {
                    ty: PublicKeyCredentialType::PublicKey,
                    id: id.clone().into(),
                    transports: None,
                })
                .collect(),
        )
    };

    let request = ctap2::make_credential::Request {
        client_data_hash: client_data_hash.into(),
        rp: ctap2::make_credential::PublicKeyCredentialRpEntity {
            id: rp_id.to_string(),
            // Open Question 1's own recommended default -- name falls back
            // to rp_id when the RP omits one, matching
            // `create_provider_credential`'s existing behavior for that
            // case.
            name: Some(rp_name.map(str::to_string).unwrap_or_else(|| rp_id.to_string())),
        },
        // `Request.user` is typed `webauthn::PublicKeyCredentialUserEntity`
        // (required `name`/`display_name`, no `icon_url`) -- NOT the CTAP2
        // `ctap2::make_credential::PublicKeyCredentialUserEntity` this file's
        // own `rp` field uses. `passkey-types-0.5.0/src/ctap2/make_credential.rs`
        // confirmed by direct source read (this task's own deviation note,
        // 43-04-SUMMARY.md).
        user: passkey_types::webauthn::PublicKeyCredentialUserEntity {
            id: user_id.into(),
            name: user_name.to_string(),
            display_name: user_display_name
                .map(str::to_string)
                .unwrap_or_else(|| user_name.to_string()),
        },
        pub_key_cred_params: vec![PublicKeyCredentialParameters {
            ty: PublicKeyCredentialType::PublicKey,
            alg: iana::Algorithm::ES256,
        }],
        exclude_list,
        // No PRF/hmac-secret this phase -- see this function's own doc
        // comment above.
        extensions: None,
        options: Default::default(),
        // CTAP2 PIN protocol is not this crate's concern -- see
        // `get_assertion_ctap2`'s identical comment above.
        pin_auth: None,
        pin_protocol: None,
    };

    let response = pollster::block_on(authenticator.make_credential(request))
        .map_err(|e| PvProviderError::Ceremony(format!("{e:?}")))?;

    // `Response::as_webauthn_bytes()` -- passkey-types' OWN CBOR encoding of
    // the WebAuthn §6.5.4 attestationObject (`{"fmt": "none", "attStmt": {},
    // "authData": <bytes>}`, WebAuthn string keys, not CTAP2 integer keys),
    // via `ciborium`'s own `cbor!`/`into_writer` machinery
    // (vendored source, `passkey-types-0.5.0/src/ctap2/make_credential.rs`).
    // Deviation from this task's originally-authored action text (recorded
    // in 43-04-SUMMARY.md): the plan text instructed hand-constructing a
    // `ciborium::value::Value::Map` with integer keys `1`/`2`/`3` -- but
    // this crate-provided method already does exactly that (with the
    // correct WebAuthn STRING keys, which is what a real RP's own
    // `attestationObject` CBOR parser expects, not CTAP2's integer keys),
    // making the hand-rolled version both unnecessary AND wrong-shaped.
    // Using the crate's own method is a STRICTER reading of this file's
    // "never hand-assembled bytes" convention, not a looser one.
    let attestation_object: Vec<u8> = response.as_webauthn_bytes().into();

    // Read the new credential back out of the store the SAME way
    // `create_provider_credential` does.
    let new_passkey: &Passkey = authenticator.store().passkeys().last().ok_or_else(|| {
        PvProviderError::Ceremony("registration succeeded but no credential was saved".into())
    })?;
    let credential_id = Vec::from(new_passkey.credential_id.clone());
    let new_passkey_json = passkey_to_json(new_passkey)?;

    Ok(MakeCredentialCtap2Result { credential_id, attestation_object, new_passkey_json })
}

#[cfg(test)]
mod ctap2_tests {
    use sha2::{Digest, Sha256};
    use webauthn_rs::prelude::{
        Passkey as WebauthnRsPasskey, PublicKeyCredential, RegisterPublicKeyCredential, Uuid,
        WebauthnBuilder,
    };

    use super::*;

    /// Mirrors `crates/pv-provider/src/lib.rs`'s own `fixture_create_request`
    /// (private to that file's `#[cfg(test)] mod tests`, not importable from
    /// here) -- duplicated per this crate's own fixture-owning precedent
    /// (`tests/response_shape.rs`, `tests/real_rp_verification.rs`'s own
    /// headers).
    fn fixture_create_request(rp_id: &str) -> String {
        let public_key = serde_json::json!({
            "rp": { "id": rp_id, "name": "Example" },
            "user": {
                "id": passkey_types::encoding::base64url(&[1u8; 16]),
                "name": "user@example.com",
                "displayName": "User",
            },
            "challenge": passkey_types::encoding::base64url(&[2u8; 16]),
            "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
        });
        serde_json::to_string(&serde_json::json!({ "publicKey": public_key })).unwrap()
    }

    /// `get_assertion_ctap2` against an EMPTY credential store returns the
    /// SAME `Ctap2Error::NoCredentials` shape `PvCredentialStore::
    /// find_credentials` already produces for the WebAuthn-client-level
    /// path -- there is no credential to assert with.
    #[test]
    fn empty_store_rejected() {
        let result = get_assertion_ctap2("example.com", vec![0u8; 32], None, "[]");
        assert!(
            matches!(result, Err(PvProviderError::Ceremony(_))),
            "an empty credential store must be rejected with a Ceremony error -- got: {result:?}"
        );
    }

    /// `find_credentials`'s existing `rp_id` filter (T-43-09) is exercised
    /// THROUGH the new entry point, never bypassed: a store seeded for a
    /// DIFFERENT rp_id than the one requested must still be rejected.
    #[test]
    fn wrong_rp_id_rejected() {
        let create_result =
            create_provider_credential(&fixture_create_request("example.com"), "https://example.com")
                .expect("create_provider_credential should succeed");
        let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);

        let result = get_assertion_ctap2(
            "other-rp.example",
            vec![0u8; 32],
            None,
            &existing_credentials_json,
        );
        assert!(
            matches!(result, Err(PvProviderError::Ceremony(_))),
            "a store seeded for a different rp_id must be rejected, not silently matched -- \
             got: {result:?}"
        );
    }

    /// The byte-level plumbing proof: `get_assertion_ctap2`'s `signature`
    /// verifies, using a REAL third-party `webauthn-rs` verifier, against
    /// the SAME `client_data_hash` passed in and the seeded credential's
    /// public key. `get_assertion_ctap2` itself never sees or produces a
    /// `clientDataJSON` (that is the entire reason this entry point
    /// exists) -- so this test builds its OWN `clientDataJSON` embedding a
    /// genuine `webauthn-rs`-issued challenge, hashes it exactly like an
    /// OS-level caller would before invoking this function, and then
    /// reconstructs a `webauthn-rs` `PublicKeyCredential` from the CTAP2
    /// result plus that same JSON to hand to the SAME independent verifier
    /// `tests/real_rp_verification.rs` uses.
    #[test]
    fn signature_verifies_against_independent_webauthn_rs() {
        let rp_id = "example.com";
        let rp_origin = "https://example.com";
        let webauthn = WebauthnBuilder::new(rp_id, &Url::parse(rp_origin).unwrap())
            .unwrap()
            .build()
            .unwrap();

        // Seed a real credential the SAME way real_rp_verification.rs does
        // -- driven by a genuine webauthn-rs CreationChallengeResponse,
        // verified by webauthn-rs's own finish_passkey_registration, never
        // a hand-rolled Passkey.
        let (ccr, reg_state) = webauthn
            .start_passkey_registration(Uuid::new_v4(), "qa@example.com", "T-43-02", None)
            .expect("start_passkey_registration should succeed");
        let create_request_json = serde_json::to_string(&ccr).unwrap();
        let create_result = create_provider_credential(&create_request_json, rp_origin)
            .expect("create_provider_credential should succeed");
        let reg: RegisterPublicKeyCredential =
            serde_json::from_str(&create_result.credential_response_json).unwrap();
        let webauthn_rs_passkey: WebauthnRsPasskey = webauthn
            .finish_passkey_registration(&reg, &reg_state)
            .expect("independent webauthn-rs verifier must accept the seed registration");

        // A genuine webauthn-rs challenge, embedded in a clientDataJSON this
        // test builds itself and hashes -- exactly the split an OS-level
        // caller (iOS) performs: the hash crosses into pv-provider, the
        // JSON stays on the caller's side.
        let (rcr, auth_state) = webauthn
            .start_passkey_authentication(&[webauthn_rs_passkey])
            .expect("start_passkey_authentication should succeed");
        let challenge_bytes: &[u8] = &rcr.public_key.challenge;
        let challenge_b64 = passkey_types::encoding::base64url(challenge_bytes);
        let client_data_json = serde_json::json!({
            "type": "webauthn.get",
            "challenge": challenge_b64,
            "origin": rp_origin,
        })
        .to_string();
        let client_data_hash = Sha256::digest(client_data_json.as_bytes()).to_vec();

        let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);
        let result =
            get_assertion_ctap2(rp_id, client_data_hash, None, &existing_credentials_json)
                .expect("get_assertion_ctap2 should succeed against a seeded credential");

        let response_json = serde_json::json!({
            "id": passkey_types::encoding::base64url(&result.credential_id),
            "rawId": passkey_types::encoding::base64url(&result.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": passkey_types::encoding::base64url(client_data_json.as_bytes()),
                "authenticatorData": passkey_types::encoding::base64url(&result.authenticator_data),
                "signature": passkey_types::encoding::base64url(&result.signature),
                "userHandle": result
                    .user_handle
                    .as_ref()
                    .map(|h| passkey_types::encoding::base64url(h)),
            },
        });
        let pkc: PublicKeyCredential = serde_json::from_value(response_json)
            .expect("reconstructed PublicKeyCredential JSON must deserialize");

        webauthn.finish_passkey_authentication(&pkc, &auth_state).expect(
            "independent webauthn-rs verifier must accept get_assertion_ctap2's real \
             signature over the SAME client_data_hash passed in -- proving the byte-level \
             plumbing, not merely that the call returns Ok",
        );
    }
}

#[cfg(test)]
mod make_credential_ctap2_tests {
    use super::*;
    use crate::credential_store::passkeys_from_json;

    fn fixture_user_id() -> Vec<u8> {
        vec![7u8; 16]
    }

    /// Behavior case 1: `supported_algorithms = [-7]` (ES256) succeeds,
    /// returning an `attestation_object` whose CBOR decode shows
    /// `fmt == "none"`, `authData` present, `attStmt` an empty map --
    /// `create_provider_credential`'s existing default, matched exactly
    /// (T-43-05). Also proves `new_passkey_json` round-trips losslessly
    /// through `passkeys_from_json` (acceptance_criteria), mirroring
    /// `credential_store.rs`'s own
    /// `passkey_round_trip_is_lossless_for_a_fully_populated_passkey` style.
    #[test]
    fn make_credential_ctap2_es256_succeeds_with_none_attestation() {
        let result = make_credential_ctap2(
            "example.com",
            Some("Example"),
            fixture_user_id(),
            "user@example.com",
            Some("User"),
            vec![9u8; 32],
            &[-7],
            &[],
            "[]",
        )
        .expect("make_credential_ctap2 with ES256 in supported_algorithms should succeed");

        assert!(!result.credential_id.is_empty());

        // CBOR-decode the attestation object -- a throwaway ciborium value
        // parse, per this task's own acceptance_criteria.
        let decoded: ciborium::value::Value =
            ciborium::de::from_reader(result.attestation_object.as_slice())
                .expect("attestation_object must be valid CBOR");
        let map = decoded.as_map().expect("attestation object must CBOR-decode to a map");

        let fmt = map
            .iter()
            .find(|(k, _)| k.as_text() == Some("fmt"))
            .map(|(_, v)| v.as_text().expect("fmt must be a text value"))
            .expect("attestation object must have a \"fmt\" key");
        assert_eq!(fmt, "none", "fmt must be \"none\" -- T-43-05, no attestation certificate");

        let auth_data_present = map.iter().any(|(k, _)| k.as_text() == Some("authData"));
        assert!(auth_data_present, "attestation object must have an \"authData\" key");

        let att_stmt = map
            .iter()
            .find(|(k, _)| k.as_text() == Some("attStmt"))
            .map(|(_, v)| v)
            .expect("attestation object must have an \"attStmt\" key");
        assert_eq!(
            att_stmt.as_map().map(Vec::as_slice),
            Some(&[][..]),
            "attStmt must be an empty map -- \"fmt: none\" carries no attestation statement"
        );

        // new_passkey_json round-trips losslessly.
        let round_tripped = passkeys_from_json(&format!("[{}]", result.new_passkey_json))
            .expect("new_passkey_json must parse via passkeys_from_json");
        assert_eq!(round_tripped.len(), 1, "exactly one passkey must round-trip");
        assert_eq!(
            Vec::from(round_tripped[0].credential_id.clone()),
            result.credential_id,
            "round-tripped credential_id must match the returned credential_id"
        );
    }

    /// Behavior case 2: `supported_algorithms = [-257]` (RS256 only, no
    /// ES256) is refused cleanly -- never silently issuing an ES256
    /// credential the RP did not ask for (T-43-06, must_haves.truths).
    #[test]
    fn make_credential_ctap2_rejects_when_es256_not_in_supported_algorithms() {
        let result = make_credential_ctap2(
            "example.com",
            Some("Example"),
            fixture_user_id(),
            "user@example.com",
            Some("User"),
            vec![9u8; 32],
            &[-257],
            &[],
            "[]",
        );
        assert!(
            matches!(result, Err(PvProviderError::InvalidInput(_))),
            "an RP that excludes ES256/-7 must be refused with InvalidInput, never a \
             silently-substituted credential -- got: {result:?}"
        );
    }

    /// Behavior case 3: an `excluded_credential_ids` list containing the
    /// credential ID of an already-registered passkey for the SAME `rp_id`
    /// is honored, not ignored -- proven by first registering a real
    /// credential, then feeding it back in BOTH as `existing_credentials_json`
    /// (required for `exclude_list` to have any effect at all -- see this
    /// function's own doc comment on why an empty store makes exclude_list a
    /// structural no-op) and as `excluded_credential_ids`.
    #[test]
    fn make_credential_ctap2_honors_exclude_list() {
        let rp_id = "example.com";
        let first = make_credential_ctap2(
            rp_id,
            Some("Example"),
            fixture_user_id(),
            "user@example.com",
            Some("User"),
            vec![9u8; 32],
            &[-7],
            &[],
            "[]",
        )
        .expect("first registration should succeed");

        let existing_credentials_json = format!("[{}]", first.new_passkey_json);

        let second = make_credential_ctap2(
            rp_id,
            Some("Example"),
            fixture_user_id(),
            "user@example.com",
            Some("User"),
            vec![10u8; 32],
            &[-7],
            &[first.credential_id.clone()],
            &existing_credentials_json,
        );

        assert!(
            matches!(second, Err(_)),
            "a second registration whose excluded_credential_ids names an existing \
             credential for the SAME rp_id must be refused, not silently re-registered -- \
             got: {second:?}"
        );
    }

    /// The exclude-list check is scoped by `rp_id`, mirroring T-43-09's
    /// existing `rp_id` filter proof for the assertion path
    /// (`get_assertion_ctap2`'s `wrong_rp_id_rejected` test above): a
    /// credential excluded for a DIFFERENT rp_id must not block registration
    /// for this one.
    #[test]
    fn make_credential_ctap2_exclude_list_scoped_by_rp_id() {
        let first = make_credential_ctap2(
            "example.com",
            Some("Example"),
            fixture_user_id(),
            "user@example.com",
            Some("User"),
            vec![9u8; 32],
            &[-7],
            &[],
            "[]",
        )
        .expect("first registration should succeed");

        let existing_credentials_json = format!("[{}]", first.new_passkey_json);

        let second = make_credential_ctap2(
            "other-rp.example",
            Some("Other"),
            fixture_user_id(),
            "user@example.com",
            Some("User"),
            vec![10u8; 32],
            &[-7],
            &[first.credential_id.clone()],
            &existing_credentials_json,
        );

        assert!(
            second.is_ok(),
            "excluded_credential_ids from a DIFFERENT rp_id must not block registration -- \
             got: {second:?}"
        );
    }
}
