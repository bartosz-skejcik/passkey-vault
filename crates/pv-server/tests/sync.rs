//! Integracyjne testy `GET /api/sync` przeciw realnej (in-memory, migrowanej)
//! bazie SQLite — tani cheap-check, pełny snapshot przy nieaktualnej
//! rewizji, atomiczny bump vault_revision przy mutacjach, izolacja między
//! użytkownikami. Also covers `GET /api/sync/ws` (Plan 05-02, SYNC-02) via a
//! real-socket harness (`test_server`) — `oneshot()` cannot exercise a WS
//! upgrade handshake at all (05-RESEARCH.md Pitfall 2).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use common::{register_and_login, test_app, test_pool, test_server};

/// The session token is standard base64 (`A-Za-z0-9+/=`) — placed verbatim
/// into a WS URL query string, `+` would be decoded as a space by axum's
/// `Query` extractor (form-urlencoded convention), silently breaking the
/// token match and returning 401. Percent-encode the three reserved chars
/// base64's alphabet can contain.
fn url_encode_token(token: &str) -> String {
    token.replace('+', "%2B").replace('/', "%2F").replace('=', "%3D")
}

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

fn item_body(id: &str) -> Value {
    json!({
        "id": id,
        "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
        "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
    })
}

#[tokio::test]
async fn pull_up_to_date_returns_no_body() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "sync-uptodate@example.com").await;

    // Fresh user starts at vault_revision 0 per the migration's default.
    let res = req(&app, "GET", "/api/sync?since=0", &token, None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = body_json(res).await;
    assert_eq!(body["revision"], 0);
    assert!(body.get("items").is_none(), "up-to-date response must not include an items key");
    assert!(body.get("folders").is_none(), "up-to-date response must not include a folders key");
}

#[tokio::test]
async fn pull_stale_returns_full_snapshot() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "sync-stale@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await.status(),
        StatusCode::CREATED
    );

    let res = req(&app, "GET", "/api/sync?since=0", &token, None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = body_json(res).await;
    assert_eq!(body["revision"], 1);
    let items = body["items"].as_array().expect("stale response must include items array");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], id);
    let folders = body["folders"].as_array().expect("stale response must include folders array (even if empty)");
    assert_eq!(folders.len(), 0);
}

#[tokio::test]
async fn mutation_bumps_vault_revision() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "sync-bump@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();

    // Mutation 1: create.
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await.status(),
        StatusCode::CREATED
    );
    let rev_after_create = body_json(req(&app, "GET", "/api/sync?since=0", &token, None).await).await["revision"]
        .as_i64()
        .unwrap();

    // Mutation 2: update.
    let update_body = json!({
        "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(update_body)).await.status(),
        StatusCode::OK
    );
    let rev_after_update = body_json(req(&app, "GET", "/api/sync?since=0", &token, None).await).await["revision"]
        .as_i64()
        .unwrap();

    // Mutation 3: delete.
    assert_eq!(
        req(&app, "DELETE", &format!("/api/vault/items/{id}"), &token, None).await.status(),
        StatusCode::NO_CONTENT
    );
    let rev_after_delete = body_json(req(&app, "GET", "/api/sync?since=0", &token, None).await).await["revision"]
        .as_i64()
        .unwrap();

    assert!(rev_after_create > 0, "create must bump revision above 0");
    assert!(rev_after_update > rev_after_create, "update must bump revision further");
    assert!(rev_after_delete > rev_after_update, "delete must bump revision further");
}

#[tokio::test]
async fn sync_is_scoped_to_the_authenticated_user() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "sync-scope-a@example.com").await;
    let token_b = register_and_login(&app, "sync-scope-b@example.com").await;

    let id_a = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token_a, Some(item_body(&id_a))).await.status(),
        StatusCode::CREATED
    );

    // B's own state is untouched — still up-to-date at revision 0, never a
    // leaked view of A's mutation.
    let res_b = req(&app, "GET", "/api/sync?since=0", &token_b, None).await;
    assert_eq!(res_b.status(), StatusCode::OK);
    let body_b = body_json(res_b).await;
    assert_eq!(body_b["revision"], 0);
    assert!(body_b.get("items").is_none(), "user B must not see any effect of user A's mutation");
}

#[tokio::test]
async fn ws_rejects_invalid_token() {
    let pool = test_pool().await;
    let (_app, port) = test_server(pool).await;

    let url = format!("ws://127.0.0.1:{port}/api/sync/ws?token=not-a-real-token");
    let result = tokio_tungstenite::connect_async(&url).await;
    assert!(result.is_err(), "an invalid ?token= must never complete the WS handshake");
}

#[tokio::test]
async fn ws_event_contains_no_ciphertext() {
    let pool = test_pool().await;
    let (app, port) = test_server(pool).await;
    let token = register_and_login(&app, "sync-ws-nociphertext@example.com").await;

    let url = format!("ws://127.0.0.1:{port}/api/sync/ws?token={}", url_encode_token(&token));
    let (mut ws_stream, _) = tokio_tungstenite::connect_async(&url).await.expect("valid token upgrades the socket");

    let id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await.status(),
        StatusCode::CREATED
    );

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws_stream.next())
        .await
        .expect("WS frame must arrive within 2s")
        .expect("stream must not end")
        .expect("frame must not be a protocol error");

    let text = match msg {
        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
        other => panic!("expected a Text frame, got {other:?}"),
    };
    let parsed: Value = serde_json::from_str(&text).expect("frame must be valid JSON");
    let obj = parsed.as_object().expect("frame must be a JSON object");
    let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["change_type", "entity_type", "id", "revision"],
        "SyncEvent frame must carry exactly these four keys — no ciphertext field"
    );
    assert_eq!(parsed["entity_type"], "item");
    assert_eq!(parsed["change_type"], "create");
}

#[tokio::test]
async fn ws_cross_user_isolation() {
    let pool = test_pool().await;
    let (app, port) = test_server(pool).await;
    let token_a = register_and_login(&app, "sync-ws-isolation-a@example.com").await;
    let token_b = register_and_login(&app, "sync-ws-isolation-b@example.com").await;

    let url_b = format!("ws://127.0.0.1:{port}/api/sync/ws?token={}", url_encode_token(&token_b));
    let (mut ws_stream_b, _) = tokio_tungstenite::connect_async(&url_b).await.expect("B's token upgrades the socket");

    let id_a = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token_a, Some(item_body(&id_a))).await.status(),
        StatusCode::CREATED
    );

    let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_stream_b.next()).await;
    assert!(result.is_err(), "user B's socket must never receive user A's SyncEvent");
}
