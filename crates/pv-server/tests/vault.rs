//! Integracyjne testy `/api/vault/items` przeciw realnej (in-memory,
//! migrowanej) bazie SQLite — CRUD na zaszyfrowanych blobach, optymistyczna
//! współbieżność (revision) i izolacja między użytkownikami.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pv_core::identity::{seal, IdentitySecretKey};
use pv_core::items::CollectionKey;
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

// 26-13-PLAN.md live-run fix: `POST /api/vault/folders` now requires a
// client-minted `id` (mirrors `collections.rs`'s already-established
// `CreateCollectionRequest.id` contract) -- see `folders.rs::
// CreateFolderRequest`'s own doc comment for the full bug this closes.
fn folder_body(name_ciphertext: &str) -> Value {
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "enc_name": format!("{{\"nonce\":\"AAAA\",\"ciphertext\":\"{name_ciphertext}\"}}"),
    })
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

    // WR-01: assert access BEFORE the revoke too — without this, the 404
    // asserted after the revoke below cannot distinguish "revocation worked"
    // from "the grant never conferred access in the first place" (the exact
    // gap CR-01 shipped through). This assertion fails against the pre-CR-01
    // code, since `item_shares` was silently ignored for personal items.
    let touch_before_revoke_res =
        req(&app, "POST", &format!("/api/vault/items/{item_id}/touch"), &member_token, None).await;
    assert_eq!(
        touch_before_revoke_res.status(),
        StatusCode::OK,
        "a `read` item_shares grant must actually confer access — otherwise the post-revoke 404 proves nothing"
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

// --- is_shared/last_editor_email metadata (Plan 23-01, Task 3 — BLOCKER-1 fix) ---

/// Covers all three of Task 3's behavior bullets in one round trip: (a) a
/// personal item with zero `item_shares` rows returns `is_shared: false` /
/// `last_editor_email: null`; (b) the SAME personal item, after a
/// raw-SQL-seeded `item_shares` row (mirrors this file's own
/// `item_share_create_and_revoke_round_trip` fixture style), returns
/// `is_shared: true`; (c) a collection member's own `GET /api/vault/items`
/// for a collection-scoped item returns `is_shared: true` regardless of
/// `item_shares` — proving `fetch_items_for`'s two arms both populate the
/// new fields without widening either arm's authorization scope (grep-proven
/// separately by this plan's own acceptance criteria).
///
/// (a)'s item is seeded via raw SQL rather than `POST /api/vault/items`:
/// Task 2 (this same plan) made `create()` set `last_editor_user_id` to the
/// CREATOR's own id immediately, so a `POST`-created item already has a
/// non-null last editor — genuinely matching Migration 0015's own "NULL
/// means never edited since this column existed" semantics requires an item
/// that predates any create()/update()/move_item() call, exactly like a
/// pre-Phase-23 row. `create_item_returns_201_with_revision_1` elsewhere in
/// this file already covers the POST-created path.
#[tokio::test]
async fn fetch_items_for_is_shared() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "isshared-owner@example.com").await;
    let owner_id_for_seed =
        body_json(req(&app, "GET", "/api/auth/me", &owner_token, None).await).await["user_id"].as_str().unwrap().to_string();

    // (a) A personal item with zero item_shares rows AND no last_editor_user_id
    // set at all (raw SQL insert — never touched by any handler).
    let personal_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO vault_items (id, user_id, enc_key, enc_data, revision) \
         VALUES (?, ?, '{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}', \
                 '{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}', 1)",
    )
    .bind(&personal_id)
    .bind(&owner_id_for_seed)
    .execute(&pool)
    .await
    .expect("seed a never-touched personal vault_items row");

    let list_res = req(&app, "GET", "/api/vault/items", &owner_token, None).await;
    let items = body_json(list_res).await;
    let items = items.as_array().unwrap();
    let personal_item = items.iter().find(|i| i["id"] == personal_id).unwrap();
    assert_eq!(personal_item["is_shared"], false, "a personal item with no item_shares row must report is_shared: false");
    assert!(personal_item["last_editor_email"].is_null(), "a never-edited item must report last_editor_email: null");

    // (b) The SAME personal item, WITH a raw-SQL-seeded item_shares row.
    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "IsShared Family" }))).await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);
    let member_token = common::register_second_family_member(&app, &owner_token, "isshared-member@example.com").await;
    let member_id =
        body_json(req(&app, "GET", "/api/auth/me", &member_token, None).await).await["user_id"].as_str().unwrap().to_string();

    sqlx::query(
        "INSERT INTO item_shares (item_id, recipient_user_id, sealed_key, access_level) VALUES (?, ?, 'sealed', 'read')",
    )
    .bind(&personal_id)
    .bind(&member_id)
    .execute(&pool)
    .await
    .expect("seed item_shares row on the personal item");

    let list_res_2 = req(&app, "GET", "/api/vault/items", &owner_token, None).await;
    let items_2 = body_json(list_res_2).await;
    let items_2 = items_2.as_array().unwrap();
    let shared_item = items_2.iter().find(|i| i["id"] == personal_id).unwrap();
    assert_eq!(shared_item["is_shared"], true, "a personal item with an item_shares row must report is_shared: true");

    // (c) A collection member's own GET for a collection-scoped item.
    let owner_id =
        body_json(req(&app, "GET", "/api/auth/me", &owner_token, None).await).await["user_id"].as_str().unwrap().to_string();

    let create_coll_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "3fd629b1-1c2f-40c9-8716-05d9b701f110","enc_name": "{\"nonce\":\"AAAA\",\"ciphertext\":\"coll-name\"}",
            "sealed_key": "{\"nonce\":\"BBBB\",\"ciphertext\":\"sealed-coll-key-owner\"}",
        })),
    )
    .await;
    assert_eq!(create_coll_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_coll_res).await["id"].as_str().unwrap().to_string();

    let coll_item_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO vault_items (id, user_id, collection_id, enc_key, enc_data, revision) \
         VALUES (?, ?, ?, '{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob\"}', \
                 '{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob\"}', 1)",
    )
    .bind(&coll_item_id)
    .bind(&owner_id)
    .bind(&collection_id)
    .execute(&pool)
    .await
    .expect("seed collection-scoped vault_items row (collections::create already wired the owner's own collection_keys row)");

    let coll_list_res = req(&app, "GET", "/api/vault/items", &owner_token, None).await;
    let coll_items = body_json(coll_list_res).await;
    let coll_items = coll_items.as_array().unwrap();
    let coll_item = coll_items.iter().find(|i| i["id"] == coll_item_id).unwrap();
    assert_eq!(
        coll_item["is_shared"], true,
        "a collection-scoped item must report is_shared: true regardless of item_shares rows"
    );
}

// --- 409 conflict attribution (Plan 23-03, Task 1 — SYNC-06) ---

async fn publish_keypair_for_conflict_test(app: &axum::Router, token: &str, public_key: [u8; 32]) {
    let res = req(
        app,
        "PUT",
        "/api/identity/keypair",
        token,
        Some(json!({
            "public_key": STANDARD.encode(public_key),
            "wrapped_secret_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
        })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK, "publishing an identity keypair must succeed");
}

/// Covers Task 1's shared-item behavior bullet: a PUT with a stale
/// `expected_revision` on a collection-scoped item, attempted by a SECOND
/// member (not the last editor), returns a 409 whose body carries a
/// non-null `last_editor_email` matching the OWNER's own email — the actual
/// last person to have successfully edited the item (D-03: full email).
#[tokio::test]
async fn stale_revision_conflict_attribution_on_shared_item_returns_last_editor_email() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let owner_token = register_and_login(&app, "conflict-attribution-owner@example.com").await;
    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Conflict Attribution Family" })))
            .await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);

    let member_token =
        common::register_second_family_member(&app, &owner_token, "conflict-attribution-member@example.com").await;
    let member_me_res = req(&app, "GET", "/api/auth/me", &member_token, None).await;
    let member_id = body_json(member_me_res).await["user_id"].as_str().unwrap().to_string();
    let member_sk = IdentitySecretKey::generate();
    publish_keypair_for_conflict_test(&app, &member_token, member_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_coll_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "9f150841-91e6-439a-b428-ed7cf9661a50","enc_name": "{\"nonce\":\"AAAA\",\"ciphertext\":\"coll-name\"}",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_coll_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_coll_res).await["id"].as_str().unwrap().to_string();

    let member_sealed = seal(&member_sk.public_key(), ck.expose()).unwrap();
    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": serde_json::to_string(&member_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    // Owner creates a personal item, then moves it into the shared collection.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(&app, "POST", "/api/vault/items", &owner_token, Some(item_body(&item_id))).await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let move_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &owner_token,
        Some(json!({
            "new_collection_id": collection_id,
            "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-scoped\"}",
            "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-scoped\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(move_res.status(), StatusCode::OK);

    // The OWNER edits the item, becoming its current last_editor_user_id.
    let owner_update_body = json!({
        "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"owner-edit-key\"}",
        "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"owner-edit-data\"}",
        "expected_revision": 2,
    });
    let owner_update_res =
        req(&app, "PUT", &format!("/api/vault/items/{item_id}"), &owner_token, Some(owner_update_body)).await;
    assert_eq!(owner_update_res.status(), StatusCode::OK);

    // The MEMBER now attempts a stale-revision update (still believes
    // expected_revision is 2) — the 409 must attribute the conflict to the
    // OWNER's own email.
    let member_stale_update_body = json!({
        "enc_key": "{\"nonce\":\"1111\",\"ciphertext\":\"member-stale-key\"}",
        "enc_data": "{\"nonce\":\"2222\",\"ciphertext\":\"member-stale-data\"}",
        "expected_revision": 2,
    });
    let member_stale_res =
        req(&app, "PUT", &format!("/api/vault/items/{item_id}"), &member_token, Some(member_stale_update_body)).await;
    assert_eq!(member_stale_res.status(), StatusCode::CONFLICT);
    let member_stale_body = body_json(member_stale_res).await;
    assert_eq!(member_stale_body["error"], "stale revision");
    assert_eq!(
        member_stale_body["last_editor_email"].as_str(),
        Some("conflict-attribution-owner@example.com"),
        "a shared item's 409 must attribute the conflict to the actual last editor's email"
    );
}

/// Covers Task 1's personal-item behavior bullet: a PUT with a stale
/// `expected_revision` on a PERSONAL item (never shared) returns the EXACT
/// existing `{"error": "stale revision"}` body — no `last_editor_email` key
/// at all, zero wording/shape change for a single-user vault.
#[tokio::test]
async fn stale_revision_conflict_attribution_on_personal_item_has_no_last_editor_email_key() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "conflict-attribution-personal@example.com").await;

    let id = uuid::Uuid::new_v4().to_string();
    req(&app, "POST", "/api/vault/items", &token, Some(item_body(&id))).await;

    let ok_update = json!({
        "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-2\"}",
        "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-2\"}",
        "expected_revision": 1,
    });
    assert_eq!(
        req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(ok_update)).await.status(),
        StatusCode::OK
    );

    let stale_update = json!({
        "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"stale-attempt\"}",
        "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"stale-attempt-data\"}",
        "expected_revision": 1,
    });
    let stale_res = req(&app, "PUT", &format!("/api/vault/items/{id}"), &token, Some(stale_update)).await;
    assert_eq!(stale_res.status(), StatusCode::CONFLICT);
    let stale_body = body_json(stale_res).await;
    let mut keys: Vec<&str> = stale_body.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["error"],
        "a personal item's 409 body must contain exactly the `error` key — no `last_editor_email` key at all"
    );
    assert_eq!(stale_body["error"], "stale revision");
}

// --- GET /api/vault/items/{id}/shares (Plan 26-04, Task 1 — SHARE-02/UX-05) ---

/// Covers all three of Task 1's behavior bullets for the item-scoped
/// endpoint in one round trip: an active recipient appears with
/// `suspended: false`, a recipient whose family_members row is suspended
/// still appears (per A-7, never omitted) with `suspended: true`, and the
/// response body never carries a `sealed_key` key at all (T-22-16, asserted
/// by key-absence on BOTH array entries, not merely "not checked").
#[tokio::test]
async fn list_item_shares_returns_active_and_flags_suspended_recipient() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "shares-list-owner@example.com").await;
    let create_family_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Shares List Family" }))).await;
    assert_eq!(create_family_res.status(), StatusCode::CREATED);

    let active_token =
        common::register_second_family_member(&app, &owner_token, "shares-list-active@example.com").await;
    let active_id = body_json(req(&app, "GET", "/api/auth/me", &active_token, None).await).await["user_id"]
        .as_str()
        .unwrap()
        .to_string();

    let suspended_token =
        common::register_second_family_member(&app, &owner_token, "shares-list-suspended@example.com").await;
    let suspended_id = body_json(req(&app, "GET", "/api/auth/me", &suspended_token, None).await).await["user_id"]
        .as_str()
        .unwrap()
        .to_string();

    for (token, key_byte) in [(&active_token, 1u8), (&suspended_token, 2u8)] {
        let publish_res = req(
            &app,
            "PUT",
            "/api/identity/keypair",
            token,
            Some(json!({
                "public_key": STANDARD.encode([key_byte; 32]),
                "wrapped_secret_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
            })),
        )
        .await;
        assert_eq!(publish_res.status(), StatusCode::OK);
    }

    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(&app, "POST", "/api/vault/items", &owner_token, Some(item_body(&item_id))).await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    for (recipient_id, ciphertext) in [(&active_id, "sealed-active"), (&suspended_id, "sealed-suspended")] {
        let create_share_res = req(
            &app,
            "POST",
            &format!("/api/vault/items/{item_id}/shares"),
            &owner_token,
            Some(json!({
                "recipient_user_id": recipient_id,
                "sealed_key": format!("{{\"nonce\":\"CCCC\",\"ciphertext\":\"{ciphertext}\"}}"),
                "access_level": "read",
            })),
        )
        .await;
        assert_eq!(create_share_res.status(), StatusCode::CREATED);
    }

    let suspend_res =
        req(&app, "POST", &format!("/api/families/members/{suspended_id}/suspend"), &owner_token, None).await;
    assert_eq!(suspend_res.status(), StatusCode::NO_CONTENT);

    // The owner (has real access via Membership<Item, RequireRead> — owner
    // ownership grant) lists the shares.
    let list_res = req(&app, "GET", &format!("/api/vault/items/{item_id}/shares"), &owner_token, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_body = list_res.into_body();
    let bytes = to_bytes(list_body, usize::MAX).await.unwrap();
    let raw_text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(
        !raw_text.contains("sealed_key") && !raw_text.contains("sealed-active") && !raw_text.contains("sealed-suspended"),
        "GET /shares response must never carry a sealed_key field or its contents (T-22-16): {raw_text}"
    );

    let entries: Value = serde_json::from_str(&raw_text).unwrap();
    let entries = entries.as_array().unwrap();
    assert_eq!(entries.len(), 2, "both recipients must appear — suspension flags, never filters (A-7)");

    let active_entry = entries.iter().find(|e| e["user_id"] == active_id).expect("active recipient must be present");
    assert_eq!(active_entry["suspended"], false, "an active recipient must report suspended: false");

    let suspended_entry =
        entries.iter().find(|e| e["user_id"] == suspended_id).expect("suspended recipient must still be present, per A-7");
    assert_eq!(
        suspended_entry["suspended"], true,
        "a recipient whose family_members row is suspended must be flagged, never omitted (A-7)"
    );

    for entry in entries {
        let mut keys: Vec<&str> = entry.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["access_level", "created_at", "email", "suspended", "user_id"],
            "each CoRecipientRecord entry must be exactly this closed field set — never sealed_key"
        );
    }
}

/// A caller with no relationship to the item (not the owner, no `item_shares`
/// row) gets 404, never a data leak about who else the item is shared with.
#[tokio::test]
async fn list_item_shares_for_non_member_is_404() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let owner_token = register_and_login(&app, "shares-list-owner2@example.com").await;
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(&app, "POST", "/api/vault/items", &owner_token, Some(item_body(&item_id))).await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let stranger_token = register_and_login(&app, "shares-list-stranger@example.com").await;
    let stranger_res = req(&app, "GET", &format!("/api/vault/items/{item_id}/shares"), &stranger_token, None).await;
    assert_eq!(
        stranger_res.status(),
        StatusCode::NOT_FOUND,
        "a non-member must get 404, never confirming the item's existence or its recipient list"
    );
}
