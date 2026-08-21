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
    ctap2::{self, Aaguid},
    webauthn::{
        CredentialCreationOptions, CredentialRequestOptions, PublicKeyCredentialDescriptor,
        PublicKeyCredentialType,
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
