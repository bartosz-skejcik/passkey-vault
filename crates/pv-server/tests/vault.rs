//! Integracyjne testy `/api/vault/items` przeciw realnej (in-memory,
//! migrowanej) bazie SQLite — CRUD na zaszyfrowanych blobach, optymistyczna
//! współbieżność (revision) i izolacja między użytkownikami.

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

#[tokio::test]
async fn create_and_list_both_include_a_non_empty_updated_at() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "updatedat@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    let res = req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let body = body_json(res).await;
    assert!(body["updated_at"].as_str().is_some_and(|s| !s.is_empty()));

    let list_res = req(&app, "GET", "/api/vault/items", &token, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let items = body_json(list_res).await;
    let items = items.as_array().unwrap();
    let item = items.iter().find(|i| i["id"] == id).unwrap();
    assert!(item["updated_at"].as_str().is_some_and(|s| !s.is_empty()));
}

#[tokio::test]
async fn update_response_includes_a_non_empty_updated_at() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "updateupdatedat@example.com").await;

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
    assert!(body["updated_at"].as_str().is_some_and(|s| !s.is_empty()));
}

// --- Last-used tracking (quick-260717) ---

#[tokio::test]
async fn create_and_list_include_a_null_last_used_at_before_any_touch() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "lastused-null@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    let res = req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;
    assert_eq!(res.status(), StatusCode::CREATED);

    let list_res = req(&app, "GET", "/api/vault/items", &token, None).await;
    let items = body_json(list_res).await;
    let items = items.as_array().unwrap();
    let item = items.iter().find(|i| i["id"] == id).unwrap();
    assert!(item["last_used_at"].is_null());
}

#[tokio::test]
async fn touch_sets_last_used_at_without_bumping_revision() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "touch@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;

    let touch_res = req(&app, "POST", &format!("/api/vault/items/{id}/touch"), &token, None).await;
    assert_eq!(touch_res.status(), StatusCode::OK);
    let touch_body = body_json(touch_res).await;
    assert!(touch_body["last_used_at"].as_str().is_some_and(|s| !s.is_empty()));

    let list_res = req(&app, "GET", "/api/vault/items", &token, None).await;
    let items = body_json(list_res).await;
    let items = items.as_array().unwrap();
    let item = items.iter().find(|i| i["id"] == id).unwrap();
    assert!(item["last_used_at"].as_str().is_some_and(|s| !s.is_empty()));
    // Revision is untouched — a touch is metadata-only, never a content
    // mutation, so it must never fabricate a stale-revision 409 elsewhere.
    assert_eq!(item["revision"], 1);
}

#[tokio::test]
async fn touch_on_missing_item_is_404() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "touchmissing@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    let touch_res = req(&app, "POST", &format!("/api/vault/items/{id}/touch"), &token, None).await;
    assert_eq!(touch_res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn touch_on_other_users_item_is_404() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "touchownera@example.com").await;
    let token_b = register_and_login(&app, "touchownerb@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token_a, Some(item_body(&id))).await;

    let touch_res = req(&app, "POST", &format!("/api/vault/items/{id}/touch"), &token_b, None).await;
    assert_eq!(touch_res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn touch_requires_auth() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let id = uuid::Uuid::new_v4().to_string();
    let touch_res = req(&app, "POST", &format!("/api/vault/items/{id}/touch"), "not-a-real-token", None).await;
    assert_eq!(touch_res.status(), StatusCode::UNAUTHORIZED);
}

// --- Folders (Task 2) ---

fn folder_body(name_ciphertext: &str) -> Value {
    json!({ "enc_name": format!("{{\"nonce\":\"AAAA\",\"ciphertext\":\"{name_ciphertext}\"}}") })
}

#[tokio::test]
async fn create_folder_returns_201_with_id() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "folder1@example.com").await;

    let res = req(&app, "POST", "/api/vault/folders", &token, Some(folder_body("work"))).await;
    assert_eq!(res.status(), StatusCode::CREATED);
    let body = body_json(res).await;
    assert!(body["id"].as_str().is_some());
}

#[tokio::test]
async fn list_folders_returns_only_own_folders() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "folderusera@example.com").await;
    let token_b = register_and_login(&app, "folderuserb@example.com").await;

    req(&app, "POST", "/api/vault/folders", &token_a, Some(folder_body("a-folder"))).await;
    req(&app, "POST", "/api/vault/folders", &token_b, Some(folder_body("b-folder"))).await;

    let list_res = req(&app, "GET", "/api/vault/folders", &token_a, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let folders = body_json(list_res).await;
    let folders = folders.as_array().unwrap();
    assert_eq!(folders.len(), 1);
}

#[tokio::test]
async fn delete_folder_removes_it_and_cross_user_delete_is_404() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "folderdela@example.com").await;
    let token_b = register_and_login(&app, "folderdelb@example.com").await;

    let create_res = req(&app, "POST", "/api/vault/folders", &token_a, Some(folder_body("to-delete"))).await;
    let created = body_json(create_res).await;
    let folder_id = created["id"].as_str().unwrap().to_string();

    // Other user cannot delete it.
    let cross_delete = req(&app, "DELETE", &format!("/api/vault/folders/{folder_id}"), &token_b, None).await;
    assert_eq!(cross_delete.status(), StatusCode::NOT_FOUND);

    // Owner can delete it.
    let own_delete = req(&app, "DELETE", &format!("/api/vault/folders/{folder_id}"), &token_a, None).await;
    assert_eq!(own_delete.status(), StatusCode::NO_CONTENT);

    // Deleting again is 404.
    let delete_again = req(&app, "DELETE", &format!("/api/vault/folders/{folder_id}"), &token_a, None).await;
    assert_eq!(delete_again.status(), StatusCode::NOT_FOUND);
}

// --- Direct per-item shares (Plan 22-04, Task 2 — SHARE-02 server half) ---

/// Covers all three of Task 2's behavior bullets in one round trip: create
/// succeeds for a valid family member with a published identity keypair,
/// create rejects a non-family-member recipient with 400 (same
/// confused-deputy guard as `collections::add_member`), and revoke removes
/// the row — verified via a direct SQL count against `item_shares`
/// before/after the `DELETE` call (the primary, deterministic assertion),
/// plus a live-endpoint proof via `POST .../touch` (no single-item `GET`
/// route exists — `vault.rs` only serves `GET /api/vault/items` as a list).
#[tokio::test]
async fn item_share_create_and_revoke_round_trip() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "share-owner@example.com").await;

    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Share Test Family" }))).await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);

    let member_token = common::register_second_family_member(&app, &owner_token, "share-member@example.com").await;

    let member_me_res = req(&app, "GET", "/api/auth/me", &member_token, None).await;
    assert_eq!(member_me_res.status(), StatusCode::OK);
    let member_id = body_json(member_me_res).await["user_id"].as_str().unwrap().to_string();

    // create_share's confused-deputy guard also requires a published
    // user_keypairs row for the recipient (mirrors collections::add_member).
    let publish_keypair_res = req(
        &app,
        "PUT",
        "/api/identity/keypair",
        &member_token,
        Some(json!({
            "public_key": STANDARD.encode([9u8; 32]),
            "wrapped_secret_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
        })),
    )
    .await;
    assert_eq!(publish_keypair_res.status(), StatusCode::OK);

    // A registered user who is NOT a member of the owner's family.
    let outsider_token = register_and_login(&app, "share-outsider@example.com").await;
    let outsider_me_res = req(&app, "GET", "/api/auth/me", &outsider_token, None).await;
    let outsider_id = body_json(outsider_me_res).await["user_id"].as_str().unwrap().to_string();

    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(&app, "POST", "/api/vault/items", &owner_token, Some(item_body(&item_id))).await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    // Create succeeds for a valid family member with a published keypair.
    let create_share_res = req(
        &app,
        "POST",
        &format!("/api/vault/items/{item_id}/shares"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"sealed-item-key\"}",
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(create_share_res.status(), StatusCode::CREATED);

    let count_after_create_row =
        sqlx::query("SELECT COUNT(*) as n FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
            .bind(&item_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let count_after_create: i64 = count_after_create_row.try_get("n").unwrap();
    assert_eq!(count_after_create, 1, "create_share must insert exactly one item_shares row");

    // Create rejects a non-family-member recipient with 400 — never silently
    // wrap-and-store a sealed key for an outsider.
    let create_share_outsider_res = req(
        &app,
        "POST",
        &format!("/api/vault/items/{item_id}/shares"),
        &owner_token,
        Some(json!({
            "recipient_user_id": outsider_id,
            "sealed_key": "{\"nonce\":\"DDDD\",\"ciphertext\":\"sealed-item-key-outsider\"}",
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(
        create_share_outsider_res.status(),
        StatusCode::BAD_REQUEST,
        "create_share must never wrap-and-store a sealed key for a non-family-member recipient"
    );

    // Revoke removes the row — the primary, deterministic assertion via a
    // direct SQL count.
    let revoke_res =
        req(&app, "DELETE", &format!("/api/vault/items/{item_id}/shares/{member_id}"), &owner_token, None).await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    let count_after_revoke_row =
        sqlx::query("SELECT COUNT(*) as n FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
            .bind(&item_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let count_after_revoke: i64 = count_after_revoke_row.try_get("n").unwrap();
    assert_eq!(count_after_revoke, 0, "revoke_share must remove the item_shares row");

    // Live-endpoint proof, in addition to the SQL count above: the former
    // recipient's ONLY grant on this item (the just-revoked item_shares row)
    // is gone, so POST .../touch (Membership<Item, RequireRead>) now 404s for
    // them.
    let touch_after_revoke_res =
        req(&app, "POST", &format!("/api/vault/items/{item_id}/touch"), &member_token, None).await;
    assert_eq!(
        touch_after_revoke_res.status(),
        StatusCode::NOT_FOUND,
        "the revoked recipient must lose access on the very next request via the same still-valid session"
    );
}
