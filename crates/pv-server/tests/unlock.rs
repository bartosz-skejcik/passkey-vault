//! `crates/pv-server/tests/unlock.rs` — end-to-end integration coverage for
//! AUTH-04's `SessionUser`-gated unlock ceremony pair (`unlock_start`/
//! `unlock_finish`), driven by
//! `webauthn_authenticator_rs::softpasskey::SoftPasskey` (same approved
//! dev-dependency as `tests/passkeys.rs`/`tests/passkey_login.rs`).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use sqlx::Row;
use tower::ServiceExt;
use webauthn_authenticator_rs::{softpasskey::SoftPasskey, AuthenticatorBackend};
use webauthn_rs::prelude::{CreationChallengeResponse, RequestChallengeResponse, Url};

async fn auth_post(app: &axum::Router, uri: &str, token: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut builder = Request::builder().method("POST").uri(uri).header("authorization", format!("Bearer {token}"));
    let request_body = match body {
        Some(b) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&b).unwrap())
        }
        None => Body::empty(),
    };
    let res = app.clone().oneshot(builder.body(request_body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let value: Value = if bytes.is_empty() { json!({}) } else { serde_json::from_slice(&bytes).unwrap() };
    (status, value)
}

fn origin() -> Url {
    Url::parse("http://localhost:3000").unwrap()
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

/// A real, valid `WrappedKey` JSON blob — mirrors `tests/passkeys.rs`'s and
/// `tests/passkey_login.rs`'s own helper of the same name. Randomized per
/// call (fresh key + nonce) — callers comparing against a specific
/// enrollment's blob must capture the exact string used at enrollment time.
fn real_prf_wrapped_uk() -> String {
    let wk = pv_core::prf::wrapping_key_from_prf(&[9u8; 32]).unwrap();
    let uk = pv_core::keys::UserKey::generate();
    let blob = pv_core::keys::wrap_user_key(&wk, &uk).unwrap();
    serde_json::to_string(&blob).unwrap()
}

/// Drives the full two-ceremony enrollment flow (register + prf-wrap),
/// returning the SAME `SoftPasskey` authenticator (needed again for the
/// unlock ceremony against the SAME credential) and the exact
/// `prf_wrapped_uk` blob set at enrollment.
async fn enroll_prf_capable_passkey(app: &axum::Router, token: &str, display_name: &str) -> (SoftPasskey, String) {
    let (status, start_body) =
        auth_post(app, "/api/passkeys/register/start", token, Some(json!({ "display_name": display_name }))).await;
    assert_eq!(status, StatusCode::OK, "register/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: CreationChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let mut authenticator = SoftPasskey::new(true);
    let register_response = authenticator
        .perform_register(origin(), challenge.public_key, 60_000)
        .expect("software authenticator registration must succeed");

    let (status, finish_body) = auth_post(
        app,
        "/api/passkeys/register/finish",
        token,
        Some(json!({ "state_id": state_id, "credential": register_response })),
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
    let (status, wrap_body) = auth_post(
        app,
        &format!("/api/passkeys/{passkey_id}/prf-wrap"),
        token,
        Some(json!({
            "state_id": prf_state_id,
            "credential": auth_response,
            "prf_wrapped_uk": wrapped_uk,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "prf-wrap must succeed: {wrap_body:?}");

    (authenticator, wrapped_uk)
}

#[tokio::test]
async fn unlock_full_ceremony_round_trip() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "unlockroundtrip@example.com").await;

    let (mut authenticator, wrapped_uk) = enroll_prf_capable_passkey(&app, &token, "Unlock Key").await;

    let (status, start_body) = auth_post(&app, "/api/passkeys/unlock/start", &token, None).await;
    assert_eq!(status, StatusCode::OK, "unlock/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();

    let auth_response = authenticator
        .perform_auth(origin(), challenge.public_key, 60_000)
        .expect("unlock authentication must succeed");

    let (status, finish_body) = auth_post(
        &app,
        "/api/passkeys/unlock/finish",
        &token,
        Some(json!({ "state_id": state_id, "credential": auth_response })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "unlock/finish must succeed: {finish_body:?}");
    assert_eq!(
        finish_body["prf_wrapped_uk"].as_str().unwrap(),
        wrapped_uk,
        "prf_wrapped_uk must equal the value set at enrollment"
    );
    assert!(
        finish_body.get("session_token").is_none(),
        "unlock/finish must never return a session_token: {finish_body:?}"
    );
}

#[tokio::test]
async fn unlock_finish_creates_no_session_row() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let email = "unlocknosession@example.com";
    let token = common::register_and_login(&app, email).await;

    let (mut authenticator, _wrapped_uk) = enroll_prf_capable_passkey(&app, &token, "No Session Key").await;

    let user_row =
        sqlx::query("SELECT id FROM users WHERE email = ?").bind(email).fetch_one(&pool).await.unwrap();
    let user_id: String = user_row.try_get("id").unwrap();

    let sessions_before: i64 = sqlx::query("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .try_get("c")
        .unwrap();
    assert_eq!(sessions_before, 1, "exactly the original login's session row must exist before unlock");

    let (status, start_body) = auth_post(&app, "/api/passkeys/unlock/start", &token, None).await;
    assert_eq!(status, StatusCode::OK, "unlock/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();
    let auth_response = authenticator.perform_auth(origin(), challenge.public_key, 60_000).unwrap();

    let (status, finish_body) = auth_post(
        &app,
        "/api/passkeys/unlock/finish",
        &token,
        Some(json!({ "state_id": state_id, "credential": auth_response })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "unlock/finish must succeed: {finish_body:?}");

    let sessions_after: i64 = sqlx::query("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .try_get("c")
        .unwrap();
    assert_eq!(sessions_after, 1, "unlock/finish must not create a new sessions row");
}

#[tokio::test]
async fn unlock_start_returns_404_when_zero_prf_capable_passkeys() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "unlocknoprf@example.com").await;

    let states_before: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM webauthn_states").fetch_one(&pool).await.unwrap().try_get("c").unwrap();

    let (status, body) = auth_post(&app, "/api/passkeys/unlock/start", &token, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "unlock/start with zero PRF-capable passkeys must 404: {body:?}");

    let states_after: i64 =
        sqlx::query("SELECT COUNT(*) AS c FROM webauthn_states").fetch_one(&pool).await.unwrap().try_get("c").unwrap();
    assert_eq!(states_after, states_before, "no webauthn_states row should be created on the 404 path");
}

/// SEC-04: a deliberately regressed sign-counter assertion still fails the
/// ceremony (unchanged, fail-closed webauthn-rs behavior — the classifier
/// added in this plan never weakens `require_valid_counter_value`) AND now
/// sets `counter_anomaly_at`; a genuinely fresh, never-before-unlocked
/// passkey's normal legitimate first ceremony is NOT falsely flagged. Both
/// branches asserted in this single test (must_haves truth 2).
#[tokio::test]
async fn unlock_counter_regression_flags_anomaly_while_normal_ceremony_stays_clean() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let email = "counterregression@example.com";
    let token = common::register_and_login(&app, email).await;

    // --- Setup: enroll one PRF-capable passkey (its own prf-wrap ceremony
    // already performs one real `perform_auth`, moving its stored counter
    // off zero) ---
    let (mut authenticator, _wrapped_uk) = enroll_prf_capable_passkey(&app, &token, "Regression Key").await;

    let regression_row = sqlx::query(
        "SELECT id FROM passkeys WHERE user_id = (SELECT id FROM users WHERE email = ?) AND name = ?",
    )
    .bind(email)
    .bind("Regression Key")
    .fetch_one(&pool)
    .await
    .unwrap();
    let regression_id: String = regression_row.try_get("id").unwrap();

    // One more real, legitimate ceremony — proves the Ok path leaves
    // counter_anomaly_at NULL, matching this credential's normal use.
    let (status, start_body) = auth_post(&app, "/api/passkeys/unlock/start", &token, None).await;
    assert_eq!(status, StatusCode::OK, "unlock/start must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();
    let auth_response = authenticator.perform_auth(origin(), challenge.public_key, 60_000).unwrap();
    let (status, finish_body) = auth_post(
        &app,
        "/api/passkeys/unlock/finish",
        &token,
        Some(json!({ "state_id": state_id, "credential": auth_response })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "a normal legitimate ceremony must succeed: {finish_body:?}");

    let anomaly: Option<String> = sqlx::query("SELECT counter_anomaly_at FROM passkeys WHERE id = ?")
        .bind(&regression_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .try_get("counter_anomaly_at")
        .unwrap();
    assert!(anomaly.is_none(), "counter_anomaly_at must stay NULL after a normal legitimate ceremony");

    // --- Case A (regression): directly tamper the stored counter (JSON path
    // ["cred"]["counter"], NOT ["cred"]["cred"]["counter"]) far above what
    // the SAME authenticator will present next, then run one more real
    // ceremony with it. ---
    let row = sqlx::query("SELECT passkey_json FROM passkeys WHERE id = ?")
        .bind(&regression_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let passkey_json: String = row.try_get("passkey_json").unwrap();
    let mut value: Value = serde_json::from_str(&passkey_json).unwrap();
    value["cred"]["counter"] = json!(999_999);
    let mutated = serde_json::to_string(&value).unwrap();
    sqlx::query("UPDATE passkeys SET passkey_json = ? WHERE id = ?")
        .bind(&mutated)
        .bind(&regression_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, start_body) = auth_post(&app, "/api/passkeys/unlock/start", &token, None).await;
    assert_eq!(status, StatusCode::OK, "unlock/start must still succeed pre-ceremony: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();
    let auth_response = authenticator.perform_auth(origin(), challenge.public_key, 60_000).unwrap();
    let (status, finish_body) = auth_post(
        &app,
        "/api/passkeys/unlock/finish",
        &token,
        Some(json!({ "state_id": state_id, "credential": auth_response })),
    )
    .await;
    assert!(status.is_client_error(), "a regressed-counter ceremony must fail with a 4xx: {status} {finish_body:?}");

    let anomaly: Option<String> = sqlx::query("SELECT counter_anomaly_at FROM passkeys WHERE id = ?")
        .bind(&regression_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .try_get("counter_anomaly_at")
        .unwrap();
    assert!(anomaly.is_some(), "counter_anomaly_at must be non-NULL after a regressed-counter ceremony failure");

    // --- Case B (both-zero exemption / normal-use non-flagging): a second,
    // independently-enrolled fresh passkey completes its first-ever unlock
    // ceremony normally and is NOT falsely flagged, even though the
    // regressed "Regression Key" above is also in unlock/start's candidate
    // set — only a genuine stored>received regression on ITS OWN credential
    // id sets the flag. ---
    let (mut fresh_authenticator, _wrapped_uk2) =
        enroll_prf_capable_passkey(&app, &token, "Fresh Never-Unlocked Key").await;
    let fresh_row = sqlx::query(
        "SELECT id FROM passkeys WHERE user_id = (SELECT id FROM users WHERE email = ?) AND name = ?",
    )
    .bind(email)
    .bind("Fresh Never-Unlocked Key")
    .fetch_one(&pool)
    .await
    .unwrap();
    let fresh_id: String = fresh_row.try_get("id").unwrap();

    let (status, start_body) = auth_post(&app, "/api/passkeys/unlock/start", &token, None).await;
    assert_eq!(status, StatusCode::OK, "unlock/start must succeed with fresh passkey present: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();
    let challenge: RequestChallengeResponse = serde_json::from_value(start_body["challenge"].clone()).unwrap();
    let fresh_auth_response = fresh_authenticator.perform_auth(origin(), challenge.public_key, 60_000).unwrap();
    let (status, finish_body) = auth_post(
        &app,
        "/api/passkeys/unlock/finish",
        &token,
        Some(json!({ "state_id": state_id, "credential": fresh_auth_response })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "fresh passkey's first unlock ceremony must succeed: {finish_body:?}");

    let fresh_anomaly: Option<String> = sqlx::query("SELECT counter_anomaly_at FROM passkeys WHERE id = ?")
        .bind(&fresh_id)
        .fetch_one(&pool)
        .await
        .unwrap()
        .try_get("counter_anomaly_at")
        .unwrap();
    assert!(fresh_anomaly.is_none(), "a fresh passkey's normal first ceremony must not be falsely flagged");
}

#[tokio::test]
async fn unlock_ownership_rejects_cross_user_state() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token_a = common::register_and_login(&app, "unlockownera@example.com").await;
    let token_b = common::register_and_login(&app, "unlockownerb@example.com").await;

    enroll_prf_capable_passkey(&app, &token_a, "Owner A Key").await;
    enroll_prf_capable_passkey(&app, &token_b, "Owner B Key").await;

    let (status, start_body) = auth_post(&app, "/api/passkeys/unlock/start", &token_a, None).await;
    assert_eq!(status, StatusCode::OK, "unlock/start for user A must succeed: {start_body:?}");
    let state_id = start_body["state_id"].as_str().unwrap().to_string();

    // User A's state_id used in a request authenticated as user B's session.
    let (status, body) = auth_post(
        &app,
        "/api/passkeys/unlock/finish",
        &token_b,
        Some(json!({ "state_id": state_id, "credential": bogus_assertion_credential() })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "cross-user state_id must be rejected — same shape as any other invalid/expired state_id: {body:?}"
    );
}
