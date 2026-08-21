//! QA-03: an independent, cross-vendor `webauthn-rs` (kanidm) Relying Party
//! verifies a full register-then-authenticate ceremony PRODUCED by
//! `pv-provider`'s own real public entry points
//! (`create_provider_credential`/`get_provider_assertion`) — the SAME
//! functions the extension background calls, unmodified, no test-only
//! bypass.
//!
//! This closes the exact fixture blind spot that hid the v0.2
//! `serialize_bytes_as_base64_string` byte-serialization bug (resolved in
//! `.planning/debug/resolved/firefox-provider-corruption.md`), which no
//! existing test caught because `pv-server`'s own WebAuthn tests pair
//! against kanidm's OWN bundled soft-authenticator crate — the SAME vendor
//! as `webauthn-rs` itself. This file never imports that crate or its
//! bundled soft authenticator; doing so would recreate the exact
//! same-vendor pairing this test exists to avoid.
//!
//! Both `finish_passkey_registration`/`finish_passkey_authentication` calls
//! below perform GENUINE signature/attestation verification over a REAL
//! challenge `webauthn-rs` itself issued — never a shape/`.ok`/`id`-only
//! assertion (see this plan's `must_haves.prohibitions`: the verifier
//! config must never be loosened just to force a pass).
//!
//! 43-04 Task 2 adds a SECOND test,
//! `make_credential_ctap2_attestation_verified_by_independent_webauthn_rs`,
//! settling Open Question 3 (43-RESEARCH.md) empirically: does the
//! CTAP2-level `pv_provider::make_credential_ctap2`'s `fmt:"none"`
//! attestation object satisfy this SAME independent, real `webauthn-rs`
//! verifier? See that test's own doc comment for why it cannot simply reuse
//! this file's existing registration half (`make_credential_ctap2` takes a
//! pre-computed `client_data_hash`, never a WebAuthn options JSON).

use sha2::{Digest, Sha256};
use uuid::Uuid;
use webauthn_rs::prelude::*;

#[test]
fn pv_provider_round_trip_verified_by_independent_webauthn_rs() {
    // Non-localhost origin on both sides (webauthn-rs's builder AND
    // pv_provider's own `origin` argument) — this exact string is already
    // proven to work against pv-provider's own existing test fixtures
    // (crates/pv-provider/src/lib.rs), and avoids needing any
    // localhost-allowance flag on the webauthn-rs side.
    let rp_id = "example.com";
    let rp_origin = "https://example.com";
    let webauthn = WebauthnBuilder::new(rp_id, &Url::parse(rp_origin).unwrap())
        .unwrap()
        .build()
        .unwrap();

    // --- Registration half ---

    let (ccr, reg_state) = webauthn
        .start_passkey_registration(Uuid::new_v4(), "qa03@example.com", "QA-03", None)
        .expect("webauthn-rs start_passkey_registration should succeed");

    let create_request_json =
        serde_json::to_string(&ccr).expect("CreationChallengeResponse must serialize to JSON");

    let create_result = pv_provider::create_provider_credential(&create_request_json, rp_origin)
        .expect(
            "create_provider_credential must accept a real webauthn-rs-issued \
             CreationChallengeResponse (its {\"publicKey\": ...} wrapping IS \
             pv-provider's expected request shape) -- a failure here is a \
             first-class QA-03 finding, not something to route around",
        );

    let reg: RegisterPublicKeyCredential = serde_json::from_str(&create_result.credential_response_json)
        .expect("pv-provider's create response must deserialize as webauthn-rs's own RegisterPublicKeyCredential");

    let webauthn_rs_passkey: Passkey = webauthn
        .finish_passkey_registration(&reg, &reg_state)
        .expect(
            "independent webauthn-rs verifier must accept pv-provider's real \
             attestation response -- this is QA-03's genuine cross-vendor \
             attestation verification",
        );

    // --- Authentication half ---

    let (rcr, auth_state) = webauthn
        .start_passkey_authentication(&[webauthn_rs_passkey])
        .expect("webauthn-rs start_passkey_authentication should succeed");

    let get_request_json =
        serde_json::to_string(&rcr).expect("RequestChallengeResponse must serialize to JSON");

    // Mirrors lib.rs's create_then_get_roundtrip precedent exactly: feed the
    // FIRST ceremony's new_passkey_json (pv-provider's OWN passkey_types
    // representation of the same credential, independently tracked from
    // webauthn-rs's Passkey above) back in as the existing-credentials store.
    let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);

    let get_result = pv_provider::get_provider_assertion(
        &get_request_json,
        rp_origin,
        &existing_credentials_json,
    )
    .expect(
        "get_provider_assertion must accept a real webauthn-rs-issued \
         RequestChallengeResponse against the credential it just registered",
    );

    let pkc: PublicKeyCredential = serde_json::from_str(&get_result.credential_response_json)
        .expect("pv-provider's get response must deserialize as webauthn-rs's own PublicKeyCredential");

    webauthn.finish_passkey_authentication(&pkc, &auth_state).expect(
        "independent webauthn-rs verifier must accept pv-provider's real \
         assertion signature over the REAL challenge webauthn-rs itself \
         issued -- this is QA-03's genuine cross-vendor signature \
         verification, closing the fixture blind spot that hid D-21",
    );

    // Note: `create_result.new_passkey_json` / `get_result.updated_passkey_json`
    // contain private key material and are intentionally never printed or
    // logged anywhere in this test (threat_model T-14-02).
}

/// 43-04 Task 2, Open Question 3: does `ciborium`'s `fmt:"none"` attestation
/// object (produced by `pv_provider::make_credential_ctap2`) satisfy a REAL
/// third-party RP verifier? Settled empirically here -- not assumed, not
/// deferred.
///
/// Unlike `pv_provider_round_trip_verified_by_independent_webauthn_rs` above
/// (which drives the WebAuthn-CLIENT-level `create_provider_credential`,
/// letting `passkey_client::Client` build/hash `clientDataJSON` internally),
/// this test drives the CTAP2-level `make_credential_ctap2` directly, which
/// takes a pre-computed `client_data_hash` and never sees the JSON that
/// produced it (`43-RESEARCH.md`'s "Anti-patterns to avoid" -- SHA-256 is
/// not invertible). This test therefore hand-constructs the matching
/// `clientDataJSON` bytes itself -- the EXACT split an OS-level caller
/// (iOS) performs -- retaining both the hash (fed into
/// `make_credential_ctap2`) and the original JSON bytes (fed into
/// `webauthn-rs`'s own `finish_passkey_registration`, which needs the raw
/// JSON to re-derive and compare the hash itself, per WebAuthn's own
/// verification algorithm).
#[test]
fn make_credential_ctap2_attestation_verified_by_independent_webauthn_rs() {
    let rp_id = "example.com";
    let rp_origin = "https://example.com";
    let webauthn = WebauthnBuilder::new(rp_id, &Url::parse(rp_origin).unwrap())
        .unwrap()
        .build()
        .unwrap();

    // A genuine webauthn-rs-issued challenge -- never a hardcoded/static one.
    let (ccr, reg_state) = webauthn
        .start_passkey_registration(Uuid::new_v4(), "qa-43-04@example.com", "43-04", None)
        .expect("webauthn-rs start_passkey_registration should succeed");
    let challenge_bytes: &[u8] = &ccr.public_key.challenge;
    let challenge_b64 = pv_provider_base64url(challenge_bytes);
    let client_data_json = serde_json::json!({
        "type": "webauthn.create",
        "challenge": challenge_b64,
        "origin": rp_origin,
    })
    .to_string();
    let client_data_hash = Sha256::digest(client_data_json.as_bytes()).to_vec();

    let result = pv_provider::make_credential_ctap2(
        rp_id,
        Some("Example"),
        vec![11u8; 16],
        "qa-43-04@example.com",
        Some("QA 43-04"),
        client_data_hash,
        &[-7],
        &[],
        "[]",
    )
    .expect("make_credential_ctap2 should succeed against a real webauthn-rs challenge");

    let reconstruct = |attestation_object: &[u8]| -> RegisterPublicKeyCredential {
        let response_json = serde_json::json!({
            "id": pv_provider_base64url(&result.credential_id),
            "rawId": pv_provider_base64url(&result.credential_id),
            "response": {
                "attestationObject": pv_provider_base64url(attestation_object),
                "clientDataJSON": pv_provider_base64url(client_data_json.as_bytes()),
            },
            "type": "public-key",
        });
        serde_json::from_value(response_json)
            .expect("reconstructed RegisterPublicKeyCredential JSON must deserialize")
    };

    // --- Positive leg: the genuine attestation object, unmodified. ---
    let reg = reconstruct(&result.attestation_object);
    webauthn.finish_passkey_registration(&reg, &reg_state).expect(
        "independent webauthn-rs verifier must accept make_credential_ctap2's real \
         attestation object -- this is Open Question 3's genuine empirical settlement, \
         closed by evidence, not assumption",
    );

    // --- Negative control (L-3/L-9): corrupt one byte of the attestation
    // object and re-run registration finish against a FRESH challenge/state
    // (a `PasskeyRegistration` state is single-use). Proves the check can
    // actually fail, not merely that it returns `Ok` unconditionally.
    let (ccr2, reg_state2) = webauthn
        .start_passkey_registration(Uuid::new_v4(), "qa-43-04b@example.com", "43-04b", None)
        .expect("webauthn-rs start_passkey_registration (second) should succeed");
    let challenge_bytes2: &[u8] = &ccr2.public_key.challenge;
    let client_data_json2 = serde_json::json!({
        "type": "webauthn.create",
        "challenge": pv_provider_base64url(challenge_bytes2),
        "origin": rp_origin,
    })
    .to_string();
    let client_data_hash2 = Sha256::digest(client_data_json2.as_bytes()).to_vec();
    let result2 = pv_provider::make_credential_ctap2(
        rp_id,
        Some("Example"),
        vec![12u8; 16],
        "qa-43-04b@example.com",
        Some("QA 43-04b"),
        client_data_hash2,
        &[-7],
        &[],
        "[]",
    )
    .expect("second make_credential_ctap2 call should succeed");

    // Corrupting an arbitrary/tail byte of a `fmt:"none"` attestation object
    // is NOT guaranteed to be caught: "none" attestation carries no
    // attestation statement to verify at all, and a corrupted PUBLIC KEY
    // byte alone (e.g. the last byte, part of the EC point's y-coordinate)
    // is never cryptographically checked at registration time -- confirmed
    // empirically (an earlier draft of this test flipped the last byte and
    // `finish_passkey_registration` returned `Ok`, silently accepting a
    // different public key than the one actually returned). What IS
    // verified is `authData`'s `rpIdHash` (`webauthn-rs-core-0.5.5/src/core.rs`,
    // `register_credential_internal`: `if data.attestation_object.auth_data
    // .rp_id_hash != self.rp_id_hash { return Err(...) }`) -- so this
    // negative control corrupts THAT byte specifically, via a genuine CBOR
    // decode/re-encode (never a raw-offset guess into the wire format).
    let corrupted_attestation_object = corrupt_rp_id_hash_byte(&result2.attestation_object);

    let response_json2 = serde_json::json!({
        "id": pv_provider_base64url(&result2.credential_id),
        "rawId": pv_provider_base64url(&result2.credential_id),
        "response": {
            "attestationObject": pv_provider_base64url(&corrupted_attestation_object),
            "clientDataJSON": pv_provider_base64url(client_data_json2.as_bytes()),
        },
        "type": "public-key",
    });
    let reg2: RegisterPublicKeyCredential = serde_json::from_value(response_json2)
        .expect("reconstructed corrupted RegisterPublicKeyCredential JSON must deserialize");

    let corrupted_result = webauthn.finish_passkey_registration(&reg2, &reg_state2);
    assert!(
        corrupted_result.is_err(),
        "a corrupted attestation object must be rejected by the independent webauthn-rs \
         verifier, proving this check is genuinely falsifiable -- got: {corrupted_result:?}"
    );
}

fn pv_provider_base64url(bytes: &[u8]) -> String {
    passkey_types::encoding::base64url(bytes)
}

/// Decodes a `fmt:"none"` WebAuthn attestation object (as produced by
/// `Response::as_webauthn_bytes()`, `{"fmt": ..., "attStmt": ..., "authData":
/// <bytes>}`), flips the FIRST byte of `authData` (the first byte of its
/// `rpIdHash`), and re-encodes -- via genuine CBOR decode/encode
/// (`ciborium`), never a raw byte-offset guess into the wire format.
fn corrupt_rp_id_hash_byte(attestation_object: &[u8]) -> Vec<u8> {
    let decoded: ciborium::value::Value = ciborium::de::from_reader(attestation_object)
        .expect("attestation_object must be valid CBOR");
    let map = decoded.into_map().expect("attestation object must be a CBOR map");

    let mut fmt = None;
    let mut auth_data = None;
    let mut att_stmt = None;
    for (k, v) in map {
        match k.as_text() {
            Some("fmt") => fmt = Some(v),
            Some("authData") => auth_data = Some(v),
            Some("attStmt") => att_stmt = Some(v),
            _ => {}
        }
    }

    let mut auth_data_bytes = auth_data
        .expect("attestation object must have an authData key")
        .into_bytes()
        .expect("authData must be a CBOR byte string");
    auth_data_bytes[0] ^= 0xFF;

    let corrupted = ciborium::value::Value::Map(vec![
        (
            ciborium::value::Value::Text("fmt".to_string()),
            fmt.expect("attestation object must have a fmt key"),
        ),
        (
            ciborium::value::Value::Text("attStmt".to_string()),
            att_stmt.expect("attestation object must have an attStmt key"),
        ),
        (
            ciborium::value::Value::Text("authData".to_string()),
            ciborium::value::Value::Bytes(auth_data_bytes),
        ),
    ]);
    let mut out = Vec::new();
    ciborium::ser::into_writer(&corrupted, &mut out)
        .expect("re-encoding the corrupted attestation object must succeed");
    out
}
