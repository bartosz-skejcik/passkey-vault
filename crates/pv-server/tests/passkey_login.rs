//! `crates/pv-server/tests/passkey_login.rs` — end-to-end integration
//! coverage for AUTH-04's unauthenticated passkey-login ceremony pair
//! (`passkey_login_start`/`passkey_login_finish`), driven by
//! `webauthn_authenticator_rs::softpasskey::SoftPasskey` (same approved
//! dev-dependency as `tests/passkeys.rs` — see that file's doc comment for
//! the Package Legitimacy Gate evidence).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::Engine;
use serde_json::{json, Value};
use sqlx::Row;
use tower::ServiceExt;
use webauthn_authenticator_rs::{softpasskey::SoftPasskey, AuthenticatorBackend};
use webauthn_rs::prelude::{CreationChallengeResponse, RequestChallengeResponse, Url};

async fn post_json(app: &axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let value: Value = if bytes.is_empty() { json!({}) } else { serde_json::from_slice(&bytes).unwrap() };
    (status, value)
}

async fn auth_post_json(app: &axum::Router, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let value: Value = if bytes.is_empty() { json!({}) } else { serde_json::from_slice(&bytes).unwrap() };
    (status, value)
}

fn origin() -> Url {
    Url::parse("http://localhost:3000").unwrap()
}

/// A real, valid `WrappedKey` JSON blob — mirrors pv-core's own
/// `prf_unlock_roundtrip` fixture and `tests/passkeys.rs`'s own helper of
/// the same name. NOTE: this is randomized per call (fresh key + nonce) —
/// callers that need to compare a specific enrollment's wrapped blob against
/// a later response must capture the EXACT string used at enrollment time,
/// not re-call this function.
fn real_prf_wrapped_uk() -> String {
    let wk = pv_core::prf::wrapping_key_from_prf(&[7u8; 32]).unwrap();
    let uk = pv_core::keys::UserKey::generate();
    let blob = pv_core::keys::wrap_user_key(&wk, &uk).unwrap();
    serde_json::to_string(&blob).unwrap()
}

fn bogus_assertion_credential() -> Value {
    json!({
        "id": "AAAA",
        "rawId": "AAAA",
        "response": {
            "authenticatorData": "AAAA",
            "clientDataJSON": "AAAA",
            "signature": "AAAA",
        },
        "type": "public-key",
    })
}

/// Drives the full two-ceremony enrollment flow (register + prf-wrap),
/// returning the SAME `SoftPasskey` authenticator (needed again for the
/// passkey-login ceremony against the SAME credential) and the exact
/// `prf_wrapped_uk` blob set at enrollment (compared byte-for-byte against
/// `passkey-login/finish`'s response).
async fn enroll_prf_capable_passkey(app: &axum::Router, token: &str, display_name: &str) -> (SoftPasskey, String) {
    let (status, start_body) =
        auth_post_json(app, "/api/passkeys/register/start", token, json!({ "display_name": display_name })).await;
    assert_eq!(status, StatusCode::OK, "register/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: CreationChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let mut authenticator = SoftPasskey::new(true);
    let register_response = authenticator
        .perform_register(origin(), challenge.public_key, 60_000)
        .expect("software authenticator registration must succeed");

    let (status, finish_body) = auth_post_json(
        app,
        "/api/passkeys/register/finish",
        token,
        json!({ "state_id": state_id, "credential": register_response }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register/finish must succeed: {finish_body:?}");

    let passkey_id = finish_body["passkey_id"].as_str().unwrap().to_string();
    let prf_state_id = finish_body["prf_state_id"].as_str().unwrap().to_string();
    let prf_challenge: RequestChallengeResponse = serde_json::from_value(finish_body["prf_challenge"].clone()).unwrap();
    let auth_response = authenticator
        .perform_auth(origin(), prf_challenge.public_key, 60_000)
        .expect("software authenticator authentication must succeed");

    let wrapped_uk = real_prf_wrapped_uk();
    let (status, wrap_body) = auth_post_json(
        app,
        &format!("/api/passkeys/{passkey_id}/prf-wrap"),
        token,
        json!({
            "state_id": prf_state_id,
            "credential": auth_response,
            "prf_wrapped_uk": wrapped_uk,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "prf-wrap must succeed: {wrap_body:?}");

    (authenticator, wrapped_uk)
}

/// Drives ONLY the first ceremony (register/start + register/finish) — the
/// enrolled passkey is never `prf-wrap`ped, so `prf_capable = 0`.
async fn enroll_non_prf_passkey(app: &axum::Router, token: &str, display_name: &str) -> SoftPasskey {
    let (status, start_body) =
        auth_post_json(app, "/api/passkeys/register/start", token, json!({ "display_name": display_name })).await;
    assert_eq!(status, StatusCode::OK, "register/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: CreationChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let mut authenticator = SoftPasskey::new(true);
    let register_response = authenticator
        .perform_register(origin(), challenge.public_key, 60_000)
        .expect("software authenticator registration must succeed");

    let (status, finish_body) = auth_post_json(
        app,
        "/api/passkeys/register/finish",
        token,
        json!({ "state_id": state_id, "credential": register_response }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register/finish must succeed: {finish_body:?}");

    authenticator
}

#[tokio::test]
async fn passkey_login_full_ceremony_with_prf_creates_session_and_returns_wrap() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let email = "prflogin@example.com";
    let token = common::register_and_login(&app, email).await;

    let (mut authenticator, wrapped_uk) = enroll_prf_capable_passkey(&app, &token, "PRF Key").await;

    let sessions_before: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM sessions").fetch_one(&pool).await.unwrap().try_get("c").unwrap();

    let (status, start_body) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": email })).await;
    assert_eq!(status, StatusCode::OK, "passkey-login/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let auth_response = authenticator
        .perform_auth(origin(), challenge.public_key, 60_000)
        .expect("software authenticator authentication must succeed");

    let (status, finish_body) = post_json(
        &app,
        "/api/auth/passkey-login/finish",
        json!({ "state_id": state_id, "credential": auth_response }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "passkey-login/finish must succeed: {finish_body:?}");
    assert!(finish_body["session_token"].as_str().is_some(), "a session_token must be returned: {finish_body:?}");
    assert_eq!(
        finish_body["prf_wrapped_uk"].as_str().unwrap(),
        wrapped_uk,
        "prf_wrapped_uk must equal the value set at enrollment"
    );

    let sessions_after: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM sessions").fetch_one(&pool).await.unwrap().try_get("c").unwrap();
    assert_eq!(sessions_after, sessions_before + 1, "a NEW sessions row must be created");
}

#[tokio::test]
async fn passkey_login_without_prf_credential_returns_null_wrap() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let email = "noprflogin@example.com";
    let token = common::register_and_login(&app, email).await;

    let mut authenticator = enroll_non_prf_passkey(&app, &token, "No PRF Key").await;

    let sessions_before: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM sessions").fetch_one(&pool).await.unwrap().try_get("c").unwrap();

    let (status, start_body) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": email })).await;
    assert_eq!(status, StatusCode::OK, "passkey-login/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let auth_response = authenticator
        .perform_auth(origin(), challenge.public_key, 60_000)
        .expect("software authenticator authentication must succeed");

    let (status, finish_body) = post_json(
        &app,
        "/api/auth/passkey-login/finish",
        json!({ "state_id": state_id, "credential": auth_response }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "passkey-login/finish must succeed: {finish_body:?}");
    assert!(finish_body["session_token"].as_str().is_some(), "a session must still be created: {finish_body:?}");
    assert!(
        finish_body["prf_wrapped_uk"].is_null(),
        "prf_wrapped_uk must be null for a non-PRF-capable credential: {finish_body:?}"
    );

    let sessions_after: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM sessions").fetch_one(&pool).await.unwrap().try_get("c").unwrap();
    assert_eq!(sessions_after, sessions_before + 1, "a NEW sessions row must still be created");
}

#[tokio::test]
async fn passkey_login_start_shape_parity_unknown_vs_zero_passkey_email() {
    let app = common::test_app(common::test_pool().await);

    // (a) never-registered email.
    let (status, unknown_body) =
        post_json(&app, "/api/auth/passkey-login/start", json!({ "email": "neverexists@example.com" })).await;
    assert_eq!(status, StatusCode::OK, "unknown-email start must still return 200: {unknown_body:?}");

    // (b) registered email, zero enrolled passkeys.
    let zero_email = "zeropasskeys@example.com";
    common::register_and_login(&app, zero_email).await;
    let (status, zero_body) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": zero_email })).await;
    assert_eq!(status, StatusCode::OK, "zero-passkey start must still return 200: {zero_body:?}");

    // (c) a REAL response, from a user with an enrolled (non-PRF) passkey.
    let real_email = "realshapecompare@example.com";
    let real_token = common::register_and_login(&app, real_email).await;
    enroll_non_prf_passkey(&app, &real_token, "Shape Compare Key").await;
    let (status, real_body) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": real_email })).await;
    assert_eq!(status, StatusCode::OK, "real start must return 200: {real_body:?}");

    let key_set = |body: &Value| -> Vec<String> {
        let mut keys: Vec<String> =
            body["challenge"]["publicKey"].as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    };

    let unknown_keys = key_set(&unknown_body);
    let zero_keys = key_set(&zero_body);
    let real_keys = key_set(&real_body);

    assert_eq!(
        unknown_keys, zero_keys,
        "unknown-email and zero-passkey-email dummy responses must have identical top-level publicKey key sets"
    );
    assert_eq!(
        unknown_keys, real_keys,
        "dummy and real publicKey key sets must match exactly (04-RESEARCH.md Assumption A2)"
    );

    // WR-01: key-set equality alone left three value-level oracles open.
    // Compare the actual VALUES for every field that must byte-match across
    // dummy and real responses (everything except `challenge` — freshly
    // random on every call by design — and the credential ids themselves,
    // which are only expected to match in shape, not content).
    for (label, body) in [("unknown", &unknown_body), ("zero-passkey", &zero_body)] {
        assert_eq!(
            body["challenge"]["publicKey"]["userVerification"],
            real_body["challenge"]["publicKey"]["userVerification"],
            "{label} dummy userVerification must byte-match the real path's value (WR-01 finding 3): {body:?}"
        );
        assert_eq!(
            body["challenge"]["publicKey"]["rpId"], real_body["challenge"]["publicKey"]["rpId"],
            "{label} dummy rpId must byte-match the real path's value: {body:?}"
        );
        assert_eq!(
            body["challenge"]["publicKey"]["timeout"], real_body["challenge"]["publicKey"]["timeout"],
            "{label} dummy timeout must byte-match the real path's value: {body:?}"
        );

        let allow_credentials = body["challenge"]["publicKey"]["allowCredentials"].as_array().unwrap();
        assert!(
            (1..=2).contains(&allow_credentials.len()),
            "{label} dummy allowCredentials count must be a realistic 1-2, not a fixed single entry \
             (WR-01 finding 1): {body:?}"
        );
        for cred in allow_credentials {
            assert_eq!(cred["type"], "public-key");
            let id_b64 = cred["id"].as_str().expect("allowCredentials[i].id must be a string");
            let id_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(id_b64).unwrap();
            assert_eq!(
                id_bytes.len(),
                32,
                "{label} dummy credential id must be a realistic 32 bytes, not the previous fixed \
                 16-byte truncation (WR-01 finding 2): {body:?}"
            );
        }
    }
}

#[tokio::test]
async fn passkey_login_start_dummy_allow_credentials_stable_across_repeat_probes_same_email() {
    let app = common::test_app(common::test_pool().await);
    let email = "repeatprobe@example.com";

    let (status_a, body_a) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": email })).await;
    assert_eq!(status_a, StatusCode::OK, "first probe must succeed: {body_a:?}");
    let (status_b, body_b) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": email })).await;
    assert_eq!(status_b, StatusCode::OK, "second probe must succeed: {body_b:?}");

    // The credential ids must be byte-stable across repeat probes of the
    // SAME unknown email (WR-01) — a real account's allowCredentials list
    // doesn't change between refreshes either, so a dummy response whose ids
    // shuffled on every call would itself be an oracle. The challenge itself
    // (fresh randomness by design) is deliberately excluded from this
    // comparison.
    assert_eq!(
        body_a["challenge"]["publicKey"]["allowCredentials"], body_b["challenge"]["publicKey"]["allowCredentials"],
        "repeat probes of the same email must return byte-identical dummy allowCredentials: {body_a:?} vs {body_b:?}"
    );
    assert_ne!(
        body_a["challenge"]["publicKey"]["challenge"], body_b["challenge"]["publicKey"]["challenge"],
        "the challenge itself must still be fresh randomness on every call: {body_a:?} vs {body_b:?}"
    );

    // A DIFFERENT email must not collide onto the same dummy ids.
    let (_, body_other) =
        post_json(&app, "/api/auth/passkey-login/start", json!({ "email": "otherprobe@example.com" })).await;
    assert_ne!(
        body_a["challenge"]["publicKey"]["allowCredentials"],
        body_other["challenge"]["publicKey"]["allowCredentials"],
        "different emails must not derive the same dummy allowCredentials"
    );
}

#[tokio::test]
async fn passkey_login_finish_dummy_state_id_and_real_ceremony_failure_same_shape() {
    let app = common::test_app(common::test_pool().await);

    // (a) a dummy-path state_id (never persisted).
    let (_, start_body) =
        post_json(&app, "/api/auth/passkey-login/start", json!({ "email": "dummystatefinish@example.com" })).await;
    let dummy_state_id = start_body["state_id"].as_str().unwrap().to_string();

    let (status_a, body_a) = post_json(
        &app,
        "/api/auth/passkey-login/finish",
        json!({ "state_id": dummy_state_id, "credential": bogus_assertion_credential() }),
    )
    .await;

    // (b) a REAL persisted state, but a syntactically-valid-yet-cryptographically-wrong credential.
    let email = "realbadcredfinish@example.com";
    let token = common::register_and_login(&app, email).await;
    enroll_non_prf_passkey(&app, &token, "Real Bad Cred Key").await;
    let (_, real_start_body) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": email })).await;
    let real_state_id = real_start_body["state_id"].as_str().unwrap().to_string();

    let (status_b, body_b) = post_json(
        &app,
        "/api/auth/passkey-login/finish",
        json!({ "state_id": real_state_id, "credential": bogus_assertion_credential() }),
    )
    .await;

    assert_eq!(status_a, StatusCode::BAD_REQUEST, "dummy-path finish must be 400: {body_a:?}");
    assert_eq!(status_b, StatusCode::BAD_REQUEST, "real-path-wrong-credential finish must be 400: {body_b:?}");
    assert_eq!(status_a, status_b, "both failure modes must share the same HTTP status");
    assert_eq!(body_a["error"], body_b["error"], "both failure modes must share the same error message string");
}

#[tokio::test]
async fn prf_salt_keys_match_credential_id_encoding() {
    let app = common::test_app(common::test_pool().await);
    let email = "saltencoding@example.com";
    let token = common::register_and_login(&app, email).await;
    enroll_prf_capable_passkey(&app, &token, "Salt Encoding Key").await;

    let (status, start_body) = post_json(&app, "/api/auth/passkey-login/start", json!({ "email": email })).await;
    assert_eq!(status, StatusCode::OK, "passkey-login/start must succeed: {start_body:?}");

    let allow_credentials = start_body["challenge"]["publicKey"]["allowCredentials"].as_array().unwrap();
    assert_eq!(allow_credentials.len(), 1, "exactly one enrolled credential must be listed: {start_body:?}");
    let cred_id = allow_credentials[0]["id"].as_str().unwrap();

    let prf_salts = start_body["prf_salts"].as_object().unwrap();
    assert!(
        prf_salts.contains_key(cred_id),
        "prf_salts map must contain a key byte-equal to allowCredentials[0].id: {start_body:?}"
    );
}

#[tokio::test]
async fn passkey_login_finish_resolves_user_id_from_state_row() {
    let app = common::test_app(common::test_pool().await);

    let (_, start_body) =
        post_json(&app, "/api/auth/passkey-login/start", json!({ "email": "neverdummyresolve@example.com" })).await;
    let state_id = start_body["state_id"].as_str().unwrap().to_string();

    let (status, body) = post_json(
        &app,
        "/api/auth/passkey-login/finish",
        json!({ "state_id": state_id, "credential": bogus_assertion_credential() }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "finish against a dummy (never-persisted) state_id must be 400 — consume_state_any_user cannot resolve \
         a user_id for a state that was never written: {body:?}"
    );
}
