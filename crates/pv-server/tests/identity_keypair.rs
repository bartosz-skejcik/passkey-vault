//! Integracyjne testy `/api/identity/*` przeciw realnej (in-memory,
//! migrowanej) bazie SQLite — self-healing keypair upsert (KEY-01) and
//! per-viewer identity verification.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sqlx::Row;
use tower::ServiceExt;

use common::{register_and_login, test_app, test_pool};

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn req(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Option<Value>,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(uri).header("authorization", format!("Bearer {token}"));
    let body = match body {
        Some(b) => {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&b).unwrap())
        }
        None => Body::empty(),
    };
    app.clone().oneshot(builder.body(body).unwrap()).await.unwrap()
}

async fn user_id_of(app: &axum::Router, token: &str) -> String {
    let res = req(app, "GET", "/api/auth/me", token, None).await;
    assert_eq!(res.status(), StatusCode::OK, "fetching own user id via /api/auth/me must succeed");
    let body = body_json(res).await;
    body["user_id"].as_str().unwrap().to_string()
}

fn keypair_body(public_key: &[u8; 32], wrapped_secret_key: &str) -> Value {
    json!({
        "public_key": STANDARD.encode(public_key),
        "wrapped_secret_key": wrapped_secret_key,
    })
}

/// Task 1: `PUT /api/identity/keypair`'s full self-healing-race /
/// idempotent-resubmit / malformed-input-rejected behavior, as sub-assertions
/// within one test function (matching 22-VALIDATION.md's single fixed test
/// name for this behavior).
#[tokio::test]
async fn keypair_upsert_concurrent_race_self_heals_to_canonical() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "keypair-race@example.com").await;

    // Two distinct, well-formed (non-small-order) 32-byte public keys —
    // simulating two devices independently generating a keypair.
    let public_key_a = [0xAAu8; 32];
    let public_key_b = [0xBBu8; 32];

    // First PUT: no existing row — the caller's own submission wins.
    let first = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(keypair_body(&public_key_a, "wrapped-a")),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = body_json(first).await;
    assert_eq!(first_body["public_key"], STANDARD.encode(public_key_a));
    assert_eq!(first_body["wrapped_secret_key"], "wrapped-a");
    assert_eq!(first_body["adopted_existing"], false);

    // Second PUT from the SAME user submitting a DIFFERENT keypair
    // (simulating a second device racing to generate its own) — the row is
    // NOT overwritten; the response returns the FIRST call's values with
    // `adopted_existing: true`.
    let second = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(keypair_body(&public_key_b, "wrapped-b")),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let second_body = body_json(second).await;
    assert_eq!(
        second_body["public_key"],
        STANDARD.encode(public_key_a),
        "loser must receive the WINNING device's canonical public key, not its own"
    );
    assert_eq!(second_body["wrapped_secret_key"], "wrapped-a");
    assert_eq!(second_body["adopted_existing"], true);

    // Third PUT resubmitting the exact same already-stored public_key is
    // idempotent: adopted_existing false (nothing to adopt, it already
    // matches).
    let third = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(keypair_body(&public_key_a, "wrapped-a")),
    )
    .await;
    assert_eq!(third.status(), StatusCode::OK);
    let third_body = body_json(third).await;
    assert_eq!(third_body["public_key"], STANDARD.encode(public_key_a));
    assert_eq!(third_body["adopted_existing"], false);

    // Malformed public_key: wrong length once decoded (16 bytes, not 32) —
    // rejected with 400, never stored, never silently substituted.
    let wrong_length = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(json!({
            "public_key": STANDARD.encode([0x01u8; 16]),
            "wrapped_secret_key": "should-never-be-stored",
        })),
    )
    .await;
    assert_eq!(wrong_length.status(), StatusCode::BAD_REQUEST);

    // Malformed public_key: not valid base64 at all — rejected with 400.
    let not_base64 = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(json!({
            "public_key": "not valid base64 !!!",
            "wrapped_secret_key": "should-never-be-stored",
        })),
    )
    .await;
    assert_eq!(not_base64.status(), StatusCode::BAD_REQUEST);

    // Malformed public_key: decodes to a known small-order X25519 encoding
    // (all-zero, the identity element) — rejected with 400 by
    // `IdentityPublicKey::from_bytes`, never stored.
    let small_order = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(keypair_body(&[0u8; 32], "should-never-be-stored")),
    )
    .await;
    assert_eq!(small_order.status(), StatusCode::BAD_REQUEST);

    // None of the rejected PUTs above disturbed the canonical stored row —
    // a GET still returns the original winning keypair.
    let after_rejections = req(&app, "GET", "/api/identity/keypair", &token, None).await;
    assert_eq!(after_rejections.status(), StatusCode::OK);
    let after_rejections_body = body_json(after_rejections).await;
    assert_eq!(after_rejections_body["public_key"], STANDARD.encode(public_key_a));
    assert_eq!(after_rejections_body["wrapped_secret_key"], "wrapped-a");
}

#[tokio::test]
async fn keypair_get_returns_404_when_absent() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "keypair-absent@example.com").await;

    let res = req(&app, "GET", "/api/identity/keypair", &token, None).await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

/// Task 2: byte-level no-re-encryption proof (KEY-01 SC#5) — a pre-v0.4
/// account generating a keypair on upgrade must not rewrite a single byte of
/// its existing vault's `enc_data`.
#[tokio::test]
async fn keypair_generation_does_not_rewrite_enc_data_bytes() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "no-reencrypt@example.com").await;

    let item_id = uuid::Uuid::new_v4().to_string();
    let create_body = json!({
        "id": item_id,
        "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
        "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob-must-not-change\"}",
    });
    let create_res = req(&app, "POST", "/api/vault/items", &token, Some(create_body)).await;
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let before_res = req(&app, "GET", "/api/vault/items", &token, None).await;
    assert_eq!(before_res.status(), StatusCode::OK);
    let before_body = body_json(before_res).await;
    let enc_data_before = before_body[0]["enc_data"].as_str().unwrap().to_string();

    // Simulate on-upgrade keypair generation.
    let put_res = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &token,
        Some(keypair_body(&[0xCCu8; 32], "wrapped-on-upgrade")),
    )
    .await;
    assert_eq!(put_res.status(), StatusCode::OK);

    let after_res = req(&app, "GET", "/api/vault/items", &token, None).await;
    assert_eq!(after_res.status(), StatusCode::OK);
    let after_body = body_json(after_res).await;
    let enc_data_after = after_body[0]["enc_data"].as_str().unwrap().to_string();

    assert_eq!(
        enc_data_before, enc_data_after,
        "keypair generation must not re-encrypt/rewrite a single byte of enc_data"
    );
}

/// Task 2: `POST /api/identity/verify/{user_id}` is per-viewer, never
/// symmetric — Anna verifying Piotr says nothing about Piotr verifying Anna.
#[tokio::test]
async fn identity_verification_is_per_viewer_not_symmetric() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());
    let viewer_token = register_and_login(&app, "viewer@example.com").await;
    let subject_token = register_and_login(&app, "subject@example.com").await;

    let viewer_id = user_id_of(&app, &viewer_token).await;
    let subject_id = user_id_of(&app, &subject_token).await;

    // Viewer marks subject verified.
    let verify_res =
        req(&app, "POST", &format!("/api/identity/verify/{subject_id}"), &viewer_token, None).await;
    assert_eq!(verify_res.status(), StatusCode::NO_CONTENT);

    // A repeat call is idempotent: still exactly one row for the pair.
    let verify_again_res =
        req(&app, "POST", &format!("/api/identity/verify/{subject_id}"), &viewer_token, None).await;
    assert_eq!(verify_again_res.status(), StatusCode::NO_CONTENT);

    let forward_rows =
        sqlx::query("SELECT COUNT(*) as n FROM identity_verifications WHERE viewer_user_id = ? AND subject_user_id = ?")
            .bind(&viewer_id)
            .bind(&subject_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let forward_count: i64 = forward_rows.try_get("n").unwrap();
    assert_eq!(forward_count, 1, "a repeat verify must refresh, never duplicate, the same pair's row");

    // The reverse direction (subject verifying viewer) has NOT thereby
    // happened — the per-viewer, non-symmetric property.
    let reverse_rows =
        sqlx::query("SELECT COUNT(*) as n FROM identity_verifications WHERE viewer_user_id = ? AND subject_user_id = ?")
            .bind(&subject_id)
            .bind(&viewer_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let reverse_count: i64 = reverse_rows.try_get("n").unwrap();
    assert_eq!(reverse_count, 0, "verifying in one direction must not create a row in the other direction");

    // A user_id that does not exist returns 404.
    let missing_res = req(
        &app,
        "POST",
        &format!("/api/identity/verify/{}", uuid::Uuid::new_v4()),
        &viewer_token,
        None,
    )
    .await;
    assert_eq!(missing_res.status(), StatusCode::NOT_FOUND);
}
