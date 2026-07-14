//! `crates/pv-server/tests/passkeys.rs` — end-to-end integration coverage
//! for AUTH-03's two-ceremony passkey enrollment, driven by a software
//! authenticator (`webauthn_authenticator_rs::softpasskey::SoftPasskey`) so
//! no browser or physical hardware is required. Approved dev-dependency per
//! 03-01-PLAN.md Task 1's Package Legitimacy Gate (crates.io evidence
//! recorded 2026-07-14 — same kanidm/webauthn-rs repository as the already-
//! pinned `webauthn-rs`, 2,031,010 downloads, version parity with the pinned
//! `webauthn-rs = 0.5.5`).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use sqlx::Row;
use tower::ServiceExt;
use uuid::Uuid;
use webauthn_authenticator_rs::{softpasskey::SoftPasskey, AuthenticatorBackend};
use webauthn_rs::prelude::{CreationChallengeResponse, RequestChallengeResponse, Url};

async fn post_json(app: &axum::Router, uri: &str, token: &str, body: Value) -> (StatusCode, Value) {
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

/// Generic `authorization`-only request helper (PATCH/DELETE/GET with no
/// body, or an optional JSON body) — for Task 2's list/rename/delete tests,
/// which don't need the full ceremony round trip `post_json` was built for.
async fn req_json(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder =
        Request::builder().method(method).uri(uri).header("authorization", format!("Bearer {token}"));
    let body = match body {
        Some(b) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&b).unwrap())
        }
        None => Body::empty(),
    };
    let res = app.clone().oneshot(builder.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let value: Value = if bytes.is_empty() { json!({}) } else { serde_json::from_slice(&bytes).unwrap() };
    (status, value)
}

/// Drives only the FIRST ceremony (`register/start` + `register/finish`) via
/// the software authenticator, returning the enrolled passkey's id. Task 2's
/// list/rename/delete tests don't need `prf_capable = true`, only a real
/// enrolled row — reuses Plan 03-01's enrollment helper shape rather than a
/// second, divergent way of enrolling a test passkey.
async fn enroll_passkey(app: &axum::Router, token: &str, display_name: &str) -> String {
    let (status, start_body) =
        post_json(app, "/api/passkeys/register/start", token, json!({ "display_name": display_name })).await;
    assert_eq!(status, StatusCode::OK, "register/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: CreationChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let mut authenticator = SoftPasskey::new(true);
    let register_response =
        authenticator.perform_register(origin(), challenge.public_key, 60_000).expect("software authenticator registration must succeed");

    let (status, finish_body) = post_json(
        app,
        "/api/passkeys/register/finish",
        token,
        json!({ "state_id": state_id, "credential": register_response }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register/finish must succeed: {finish_body:?}");
    finish_body["passkey_id"].as_str().unwrap().to_string()
}

fn origin() -> Url {
    Url::parse("http://localhost:3000").unwrap()
}

/// A real, valid `WrappedKey` JSON blob — mirrors pv-core's own
/// `prf_unlock_roundtrip` fixture (`crates/pv-core/src/prf.rs`), not a
/// placeholder string, so the assertion under test is the ceremony
/// verification itself, not blob-shape validation.
fn real_prf_wrapped_uk() -> String {
    let wk = pv_core::prf::wrapping_key_from_prf(&[7u8; 32]).unwrap();
    let uk = pv_core::keys::UserKey::generate();
    let blob = pv_core::keys::wrap_user_key(&wk, &uk).unwrap();
    serde_json::to_string(&blob).unwrap()
}

#[tokio::test]
async fn enroll_passkey_full_ceremony_round_trip() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "enroll@example.com").await;

    // Step 1: register/start
    let (status, start_body) =
        post_json(&app, "/api/passkeys/register/start", &token, json!({ "display_name": "YubiKey 5" })).await;
    assert_eq!(status, StatusCode::OK, "register/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: CreationChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    // Drive a real create() ceremony via a software authenticator — `true`
    // falsifies user-verification so `UserVerificationPolicy::Required`
    // (set internally by `start_passkey_registration`) is satisfied without
    // real biometric input.
    let mut authenticator = SoftPasskey::new(true);
    let register_response = authenticator
        .perform_register(origin(), challenge.public_key, 60_000)
        .expect("software authenticator registration must succeed");

    // Step 2: register/finish — embeds the second-ceremony challenge.
    let (status, finish_body) = post_json(
        &app,
        "/api/passkeys/register/finish",
        &token,
        json!({ "state_id": state_id, "credential": register_response }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "register/finish must succeed: {finish_body:?}");
    let passkey_id = finish_body["passkey_id"].as_str().unwrap().to_string();
    assert!(finish_body["prf_challenge"].is_object(), "prf_challenge must be present: {finish_body:?}");
    assert!(finish_body["prf_state_id"].as_str().is_some(), "prf_state_id must be present: {finish_body:?}");

    // Interim state: enrolled, not yet PRF-capable — verified via a direct
    // row read, not just the HTTP status code.
    let row = sqlx::query("SELECT prf_capable, prf_wrapped_uk FROM passkeys WHERE id = ?")
        .bind(&passkey_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let prf_capable: i64 = row.try_get("prf_capable").unwrap();
    let prf_wrapped_uk: Option<String> = row.try_get("prf_wrapped_uk").unwrap();
    assert_eq!(prf_capable, 0, "passkey must not be prf_capable before prf-wrap");
    assert!(prf_wrapped_uk.is_none(), "prf_wrapped_uk must be NULL before prf-wrap");

    // Step 3: drive the embedded second ceremony (get()) via the same
    // software authenticator.
    let prf_state_id = finish_body["prf_state_id"].as_str().unwrap().to_string();
    let prf_challenge: RequestChallengeResponse = serde_json::from_value(finish_body["prf_challenge"].clone()).unwrap();
    let auth_response = authenticator
        .perform_auth(origin(), prf_challenge.public_key, 60_000)
        .expect("software authenticator authentication must succeed");

    // Step 4: prf-wrap — a real, valid wrapped blob (mirrors pv-core's own
    // fixture), not a placeholder string.
    let (status, wrap_body) = post_json(
        &app,
        &format!("/api/passkeys/{passkey_id}/prf-wrap"),
        &token,
        json!({
            "state_id": prf_state_id,
            "credential": auth_response,
            "prf_wrapped_uk": real_prf_wrapped_uk(),
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "prf-wrap must succeed: {wrap_body:?}");
    assert_eq!(wrap_body["prf_capable"], json!(true));

    // Final state: prf_capable = 1, prf_wrapped_uk set — direct row read.
    let row = sqlx::query("SELECT prf_capable, prf_wrapped_uk FROM passkeys WHERE id = ?")
        .bind(&passkey_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let prf_capable: i64 = row.try_get("prf_capable").unwrap();
    let prf_wrapped_uk: Option<String> = row.try_get("prf_wrapped_uk").unwrap();
    assert_eq!(prf_capable, 1, "passkey must be prf_capable after prf-wrap");
    assert!(prf_wrapped_uk.is_some(), "prf_wrapped_uk must be set after prf-wrap");
}

#[tokio::test]
async fn state_expired_or_missing_is_rejected() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "nostate@example.com").await;

    // A state_id that was never issued.
    let bogus_state_id = Uuid::new_v4().to_string();
    let bogus_credential = json!({
        "id": "AAAA",
        "rawId": "AAAA",
        "response": {
            "attestationObject": "AAAA",
            "clientDataJSON": "AAAA",
        },
        "type": "public-key",
    });

    let (status, body) = post_json(
        &app,
        "/api/passkeys/register/finish",
        &token,
        json!({ "state_id": bogus_state_id, "credential": bogus_credential }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "unknown state_id must be a 400, not a panic/500: {body:?}");
}

#[tokio::test]
async fn prf_wrap_rejects_replayed_assertion() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "replay@example.com").await;

    // Run the full ceremony once.
    let (_, start_body) =
        post_json(&app, "/api/passkeys/register/start", &token, json!({ "display_name": "Replay Test" })).await;
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: CreationChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let mut authenticator = SoftPasskey::new(true);
    let register_response = authenticator.perform_register(origin(), challenge.public_key, 60_000).unwrap();

    let (_, finish_body) = post_json(
        &app,
        "/api/passkeys/register/finish",
        &token,
        json!({ "state_id": state_id, "credential": register_response }),
    )
    .await;
    let passkey_id = finish_body["passkey_id"].as_str().unwrap().to_string();
    let prf_state_id = finish_body["prf_state_id"].as_str().unwrap().to_string();
    let prf_challenge: RequestChallengeResponse = serde_json::from_value(finish_body["prf_challenge"].clone()).unwrap();
    let auth_response = authenticator.perform_auth(origin(), prf_challenge.public_key, 60_000).unwrap();

    let wrap_request_body = json!({
        "state_id": prf_state_id,
        "credential": auth_response,
        "prf_wrapped_uk": real_prf_wrapped_uk(),
    });

    // First call succeeds.
    let (status, body) = post_json(
        &app,
        &format!("/api/passkeys/{passkey_id}/prf-wrap"),
        &token,
        wrap_request_body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "first prf-wrap call must succeed: {body:?}");

    // Second, identical call must be rejected — `webauthn_state::consume_state`'s
    // delete-on-consume already removed the `webauthn_states` row on the
    // first call, so a captured/replayed assertion+state pair cannot be
    // reused.
    let (status, body) = post_json(
        &app,
        &format!("/api/passkeys/{passkey_id}/prf-wrap"),
        &token,
        wrap_request_body,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "replayed prf-wrap call must be rejected, not a silent 200: {body:?}");
}

// --- Task 2: list/rename/delete integration coverage ---

#[tokio::test]
async fn rename_passkey_persists_new_name() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "rename@example.com").await;

    let passkey_id = enroll_passkey(&app, &token, "Old Name").await;

    let (status, _) =
        req_json(&app, "PATCH", &format!("/api/passkeys/{passkey_id}"), &token, Some(json!({ "name": "New Name" })))
            .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, list_body) = req_json(&app, "GET", "/api/passkeys", &token, None).await;
    assert_eq!(status, StatusCode::OK);
    let rows = list_body.as_array().unwrap();
    let row = rows.iter().find(|r| r["id"] == passkey_id).unwrap();
    assert_eq!(row["name"], "New Name");
}

#[tokio::test]
async fn rename_passkey_rejects_empty_name() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "renameempty@example.com").await;

    let passkey_id = enroll_passkey(&app, &token, "Original Name").await;

    let (status, _) =
        req_json(&app, "PATCH", &format!("/api/passkeys/{passkey_id}"), &token, Some(json!({ "name": "   " })))
            .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The rejected rename had no side effect — original name survives.
    let (status, list_body) = req_json(&app, "GET", "/api/passkeys", &token, None).await;
    assert_eq!(status, StatusCode::OK);
    let rows = list_body.as_array().unwrap();
    let row = rows.iter().find(|r| r["id"] == passkey_id).unwrap();
    assert_eq!(row["name"], "Original Name");
}

#[tokio::test]
async fn delete_passkey_blocked_without_password_wrap() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "strand@example.com").await;

    let passkey_id = enroll_passkey(&app, &token, "Strand Test").await;

    // Construct the otherwise-unreachable state directly against the test's
    // own DB pool handle — no real registration/API flow can ever leave
    // pw_wrapped_uk empty; this is the ONLY way to reach this state, which is
    // itself proof the invariant is structurally sound in the real API
    // surface.
    let user_row = sqlx::query("SELECT user_id FROM passkeys WHERE id = ?")
        .bind(&passkey_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let user_id: String = user_row.try_get("user_id").unwrap();
    sqlx::query("UPDATE users SET pw_wrapped_uk = '' WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = req_json(&app, "DELETE", &format!("/api/passkeys/{passkey_id}"), &token, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "delete must be blocked with 409: {body:?}");

    // The delete was genuinely blocked, not merely reported as blocked while
    // still executing — the row must still exist.
    let row = sqlx::query("SELECT id FROM passkeys WHERE id = ?")
        .bind(&passkey_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(row.is_some(), "passkey row must survive a blocked delete");
}

#[tokio::test]
async fn delete_passkey_succeeds_with_password_wrap_intact() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "normaldelete@example.com").await;

    let passkey_id = enroll_passkey(&app, &token, "Normal Delete").await;

    let (status, body) = req_json(&app, "DELETE", &format!("/api/passkeys/{passkey_id}"), &token, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "delete must succeed: {body:?}");

    let row = sqlx::query("SELECT id FROM passkeys WHERE id = ?")
        .bind(&passkey_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(row.is_none(), "passkey row must be gone after a successful delete");
}

#[tokio::test]
async fn passkeys_ownership_rejects_cross_user_access() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token_a = common::register_and_login(&app, "passkeyownera@example.com").await;
    let token_b = common::register_and_login(&app, "passkeyownerb@example.com").await;

    let passkey_id = enroll_passkey(&app, &token_a, "User A's Passkey").await;

    let (status, body) =
        req_json(&app, "PATCH", &format!("/api/passkeys/{passkey_id}"), &token_b, Some(json!({ "name": "Hijacked" })))
            .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "cross-user rename must be 404, not 403: {body:?}");

    let (status, body) = req_json(&app, "DELETE", &format!("/api/passkeys/{passkey_id}"), &token_b, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "cross-user delete must be 404, not 403: {body:?}");
}
