//! Integracyjne testy `/api/vault/items` przeciw realnej (in-memory,
//! migrowanej) bazie SQLite — CRUD na zaszyfrowanych blobach, optymistyczna
//! współbieżność (revision) i izolacja między użytkownikami.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
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

fn item_body(id: &str) -> Value {
    json!({
        "id": id,
        "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
        "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
    })
}

#[tokio::test]
async fn create_item_returns_201_with_revision_1() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "create@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    let res = req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let body = body_json(res).await;
    assert_eq!(body["id"], id);
    assert_eq!(body["revision"], 1);
}

#[tokio::test]
async fn create_item_with_malformed_id_is_bad_request() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "malformed@example.com").await;

    let res = req(&app, "POST", "/api/vault/items", &token, Some(item_body("not-a-uuid"))).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_item_with_duplicate_id_is_conflict() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "dupitem@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    let first = req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;
    assert_eq!(second.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn list_items_returns_only_own_items() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "usera@example.com").await;
    let token_b = register_and_login(&app, "userb@example.com").await;

    let id_a = uuid::Uuid::new_v4().to_string();
    let id_b = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token_a, Some(item_body(&id_a))).await.status(),
        StatusCode::CREATED
    );
    assert_eq!(
        req(&app, "POST", "/api/vault/items", &token_b, Some(item_body(&id_b))).await.status(),
        StatusCode::CREATED
    );

    let list_res = req(&app, "GET", "/api/vault/items", &token_a, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let items = body_json(list_res).await;
    let items = items.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], id_a);
}

#[tokio::test]
async fn update_with_correct_revision_succeeds_and_increments() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "update@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;

    let update_body = json!({
        "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    let res = req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(update_body)).await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = body_json(res).await;
    assert_eq!(body["revision"], 2);
}

#[tokio::test]
async fn update_with_stale_revision_is_conflict_and_blob_unchanged() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "stale@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;

    // Bump to revision 2 first.
    let ok_update = json!({
        "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(ok_update)).await.status(),
        StatusCode::OK
    );

    // Now retry with a stale expected_revision (1, but current is 2).
    let stale_update = json!({
        "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"stale-attempt\"}",
        "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"stale-attempt-data\"}",
        "expected_revision": 1,
    });
    let stale_res = req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(stale_update)).await;
    assert_eq!(stale_res.status(), StatusCode::CONFLICT);

    // Follow-up GET proves no silent overwrite occurred.
    let list_res = req(&app, "GET", "/api/vault/items", &token, None).await;
    let items = body_json(list_res).await;
    let items = items.as_array().unwrap();
    let item = items.iter().find(|i| i["id"] == id).unwrap();
    assert_eq!(item["revision"], 2);
    assert_eq!(item["enc_data"], "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}");
}

#[tokio::test]
async fn delete_removes_item_and_subsequent_ops_404() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "delete@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;

    let delete_res = req(&app, "DELETE", &format!("/api/vault/items/{id}"), &token, None).await;
    assert_eq!(delete_res.status(), StatusCode::NO_CONTENT);

    let update_body = json!({
        "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    let update_res = req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(update_body)).await;
    assert_eq!(update_res.status(), StatusCode::NOT_FOUND);

    let delete_again = req(&app, "DELETE", &format!("/api/vault/items/{id}"), &token, None).await;
    assert_eq!(delete_again.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn update_and_delete_on_other_users_item_returns_404() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "ownera@example.com").await;
    let token_b = register_and_login(&app, "ownerb@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token_a, Some(item_body(&id))).await;

    let update_body = json!({
        "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    let update_res = req(&app, "PUT", &format!("/api/vault/items/{id}"), &token_b, Some(update_body)).await;
    assert_eq!(update_res.status(), StatusCode::NOT_FOUND);

    let delete_res = req(&app, "DELETE", &format!("/api/vault/items/{id}"), &token_b, None).await;
    assert_eq!(delete_res.status(), StatusCode::NOT_FOUND);
}
