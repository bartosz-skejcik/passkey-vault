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
