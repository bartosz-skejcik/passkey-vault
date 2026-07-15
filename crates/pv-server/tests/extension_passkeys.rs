//! `crates/pv-server/tests/extension_passkeys.rs` — integration coverage for
//! `/api/extension-passkeys`, the extension-scoped PRF passkey blob CRUD
//! (09-CONTEXT AMENDMENT 2026-07-15). No `SoftPasskey`/webauthn-authenticator-rs
//! usage anywhere in this file — there is no ceremony to drive; the server
//! never verifies these credentials (opacity/zero-knowledge is the point).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn req(
    app: &axum::Router,
    method: &str,
    uri: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(t) = token {
        builder = builder.header("authorization", format!("Bearer {t}"));
    }
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

fn fixture_body(credential_id: &str, prf_wrapped_uk: &str) -> Value {
    json!({
        "credential_id": URL_SAFE_NO_PAD.encode(credential_id.as_bytes()),
        "prf_salt": STANDARD.encode([3u8; 32]),
        "prf_wrapped_uk": prf_wrapped_uk,
    })
}

#[tokio::test]
async fn create_requires_bearer_token_and_roundtrips_opaque_blob() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "extpasskey1@example.com").await;

    // No bearer token -> 401.
    let (status, _) = req(
        &app,
        "POST",
        "/api/extension-passkeys",
        None,
        Some(fixture_body("cred-a", "not-even-json-{{")),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "unauthenticated POST must 401");

    // Valid token + arbitrary non-JSON-shaped opaque string -> 200, proving
    // the server never parses/rewrites prf_wrapped_uk.
    let opaque = "not-even-json-{{";
    let (status, body) =
        req(&app, "POST", "/api/extension-passkeys", Some(&token), Some(fixture_body("cred-a", opaque))).await;
    assert_eq!(status, StatusCode::OK, "valid POST must succeed: {body:?}");
    assert!(body["id"].as_str().is_some(), "response must contain an id: {body:?}");

    let (status, list_body) = req(&app, "GET", "/api/extension-passkeys", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    let rows = list_body.as_array().unwrap();
    assert_eq!(rows.len(), 1, "exactly one row must exist: {list_body:?}");
    assert_eq!(
        rows[0]["prf_wrapped_uk"].as_str().unwrap(),
        opaque,
        "prf_wrapped_uk must round-trip byte-identical — server never parsed it"
    );
}

#[tokio::test]
async fn duplicate_credential_id_conflicts() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "extpasskey2@example.com").await;

    let body = fixture_body("dup-cred", "blob-1");
    let (status, _) = req(&app, "POST", "/api/extension-passkeys", Some(&token), Some(body.clone())).await;
    assert_eq!(status, StatusCode::OK);

    let (status, resp) = req(&app, "POST", "/api/extension-passkeys", Some(&token), Some(body)).await;
    assert_eq!(status, StatusCode::CONFLICT, "duplicate credential_id must 409: {resp:?}");
}

#[tokio::test]
async fn cross_user_scoping_on_list_and_delete() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token_a = common::register_and_login(&app, "extpasskeya@example.com").await;
    let token_b = common::register_and_login(&app, "extpasskeyb@example.com").await;

    let cred_id_b64 = URL_SAFE_NO_PAD.encode(b"user-a-cred");
    let (status, _) = req(
        &app,
        "POST",
        "/api/extension-passkeys",
        Some(&token_a),
        Some(fixture_body("user-a-cred", "user-a-blob")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // User B's GET does not see user A's row.
    let (status, list_body) = req(&app, "GET", "/api/extension-passkeys", Some(&token_b), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().unwrap().len(), 0, "user B must not see user A's rows: {list_body:?}");

    // User B's DELETE of user A's credential_id -> 404, user A's row survives.
    let (status, _) = req(
        &app,
        "DELETE",
        &format!("/api/extension-passkeys/{cred_id_b64}"),
        Some(&token_b),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "cross-user delete must 404");

    let (status, list_a) = req(&app, "GET", "/api/extension-passkeys", Some(&token_a), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_a.as_array().unwrap().len(), 1, "user A's row must survive the cross-user delete attempt");
}

#[tokio::test]
async fn owner_delete_succeeds_and_list_becomes_empty() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "extpasskeydelete@example.com").await;

    let cred_id_b64 = URL_SAFE_NO_PAD.encode(b"own-cred");
    let (status, _) = req(
        &app,
        "POST",
        "/api/extension-passkeys",
        Some(&token),
        Some(fixture_body("own-cred", "own-blob")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) =
        req(&app, "DELETE", &format!("/api/extension-passkeys/{cred_id_b64}"), Some(&token), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "owner delete must 204");

    let (status, list_body) = req(&app, "GET", "/api/extension-passkeys", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list_body.as_array().unwrap().len(), 0, "list must be empty after delete: {list_body:?}");
}

#[tokio::test]
async fn empty_fields_rejected_with_bad_request() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool.clone());
    let token = common::register_and_login(&app, "extpasskeyvalidate@example.com").await;

    let (status, resp) = req(
        &app,
        "POST",
        "/api/extension-passkeys",
        Some(&token),
        Some(json!({
            "credential_id": "",
            "prf_salt": STANDARD.encode([3u8; 32]),
            "prf_wrapped_uk": "some-blob",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "empty credential_id must 400: {resp:?}");

    let (status, resp) = req(
        &app,
        "POST",
        "/api/extension-passkeys",
        Some(&token),
        Some(json!({
            "credential_id": URL_SAFE_NO_PAD.encode(b"some-cred"),
            "prf_salt": STANDARD.encode([3u8; 32]),
            "prf_wrapped_uk": "",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "empty prf_wrapped_uk must 400: {resp:?}");
}
