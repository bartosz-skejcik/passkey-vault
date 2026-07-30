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
