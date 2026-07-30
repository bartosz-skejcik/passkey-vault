//! Integration tests for `/api/vault/collections` — KEY-02's per-member
//! fan-out and SHARE-06's single-share revocation, against a real router
//! (`common::test_app`) backed by a migrated in-memory SQLite pool.
//!
//! Every `pv_core::identity::seal`/`unseal_collection_key` call in this file
//! is the CLIENT-side simulation the plan requires — the server
//! (`crates/pv-server/src/routes/collections.rs`) never calls these.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pv_core::identity::{seal, unseal_collection_key, IdentitySecretKey};
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

async fn user_id_of(app: &axum::Router, token: &str) -> String {
    let res = req(app, "GET", "/api/auth/me", token, None).await;
    assert_eq!(res.status(), StatusCode::OK, "fetching own user id via /api/auth/me must succeed");
    let body = body_json(res).await;
    body["user_id"].as_str().unwrap().to_string()
}

/// Publishes an identity keypair for `token`'s own account — needed for
/// `add_member`'s confused-deputy guard (Task 2), which requires the
/// recipient to already have a `user_keypairs` row. The bytes published here
/// need not match `public_key` (the server never validates provenance, only
/// existence) — but tests that need a REAL, round-trippable keypair generate
/// their own `IdentitySecretKey` and pass its real `public_key()` bytes.
async fn publish_keypair(app: &axum::Router, token: &str, public_key: [u8; 32]) {
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

async fn create_family(app: &axum::Router, owner_token: &str) {
    let res = req(app, "POST", "/api/families", owner_token, Some(json!({ "name": "Test Family" }))).await;
    assert_eq!(res.status(), StatusCode::CREATED, "family creation must succeed");
}

/// Task 1: `POST /api/vault/collections` wires the creator's own `edit`
/// access transactionally; `GET .../{id}` is 200 for the creator and 404 for
/// an unrelated user; `GET /api/vault/collections` lists only the caller's
/// own collections.
#[tokio::test]
async fn collection_create_wires_creator_edit_access() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "coll-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed = seal(&owner_sk.public_key(), ck.expose()).expect("seal must succeed for a valid public key");
    let sealed_key_json = serde_json::to_string(&sealed).unwrap();

    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-collection-name", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let create_body = body_json(create_res).await;
    let collection_id = create_body["id"].as_str().unwrap().to_string();
    assert_eq!(create_body["access_level"].as_str(), Some("edit"));
    assert_eq!(create_body["sealed_key"].as_str(), Some(sealed_key_json.as_str()));

    // A direct DB query immediately after the 201 response shows exactly
    // one collection_keys row for that collection.
    let count_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ?")
        .bind(&collection_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let count: i64 = count_row.try_get("n").unwrap();
    assert_eq!(count, 1, "a newly created collection must have exactly one collection_keys row (the creator's)");

    // GET by the creator returns 200 with the caller's own access_level/sealed_key.
    let get_res = req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &owner_token, None).await;
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_body = body_json(get_res).await;
    assert_eq!(get_body["access_level"].as_str(), Some("edit"));
    assert_eq!(get_body["sealed_key"].as_str(), Some(sealed_key_json.as_str()));

    // GET by an unrelated authenticated user (no collection_keys row) returns 404.
    let stranger_token = register_and_login(&app, "coll-stranger@example.com").await;
    let stranger_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &stranger_token, None).await;
    assert_eq!(stranger_res.status(), StatusCode::NOT_FOUND);

    // GET /api/vault/collections lists only collections the caller has a row for.
    let list_res = req(&app, "GET", "/api/vault/collections", &owner_token, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_body = body_json(list_res).await;
    let list = list_body.as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["id"].as_str(), Some(collection_id.as_str()));

    // A second FAMILY MEMBER (not a stranger — FamilyMembership<RequireRead>
    // 404s a non-family-member outright, so this isolates the
    // "family member with no collection_keys row of their own" case) sees an
    // empty list, never the owner's collection.
    let other_member_token =
        common::register_second_family_member(&app, &owner_token, "coll-other-member@example.com").await;
    let other_member_list_res = req(&app, "GET", "/api/vault/collections", &other_member_token, None).await;
    assert_eq!(other_member_list_res.status(), StatusCode::OK);
    let other_member_list_body = body_json(other_member_list_res).await;
    assert_eq!(
        other_member_list_body.as_array().unwrap().len(),
        0,
        "a family member with no collection_keys row must see an empty list, not another user's collection"
    );
}

/// Task 1 (KEY-02 fan-out proof): owner creates a collection; two other
/// family members are each granted access via independently-`seal()`ed
/// copies of the SAME `CollectionKey` (computed here, client-side, never
/// server-side). All three `collection_keys` rows are read directly from the
/// DB and each recipient's own secret key unseals ONLY their own row — never
/// another recipient's.
///
/// NOTE: this test exercises `POST /api/vault/collections/{id}/members`
/// (Task 2's endpoint) to grow the fan-out beyond the creator's seed row.
/// Landing this assertion in Task 1's test file (per the plan's exact test
/// name and behavior spec) is safe because Task 2 lands in the SAME plan's
/// commit sequence before this test is expected to pass in CI.
#[tokio::test]
async fn collection_key_fan_out_three_members_each_opens_only_own_seal() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "fanout-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member2_token = common::register_second_family_member(&app, &owner_token, "fanout-member2@example.com").await;
    let member3_token = common::register_third_family_member(&app, &owner_token, "fanout-member3@example.com").await;

    let member2_id = user_id_of(&app, &member2_token).await;
    let member3_id = user_id_of(&app, &member3_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member2_sk = IdentitySecretKey::generate();
    let member3_sk = IdentitySecretKey::generate();

    // Publish keypairs for the two recipients — add_member's confused-deputy
    // guard (Task 2) requires a user_keypairs row to exist for the target.
    publish_keypair(&app, &member2_token, member2_sk.public_key().to_bytes()).await;
    publish_keypair(&app, &member3_token, member3_sk.public_key().to_bytes()).await;

    let ck = CollectionKey::generate();

    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-fanout-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    let member2_sealed = seal(&member2_sk.public_key(), ck.expose()).unwrap();
    let add_member2_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member2_id,
            "sealed_key": serde_json::to_string(&member2_sealed).unwrap(),
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(add_member2_res.status(), StatusCode::CREATED);

    let member3_sealed = seal(&member3_sk.public_key(), ck.expose()).unwrap();
    let add_member3_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member3_id,
            "sealed_key": serde_json::to_string(&member3_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member3_res.status(), StatusCode::CREATED);

    // Read all three collection_keys rows directly from the DB.
    let rows = sqlx::query("SELECT recipient_user_id, sealed_key FROM collection_keys WHERE collection_id = ? ORDER BY recipient_user_id ASC")
        .bind(&collection_id)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 3, "N=3 members must yield N=3 distinct collection_keys rows");

    let mut sealed_by_recipient: std::collections::HashMap<String, pv_core::identity::SealedKey> =
        std::collections::HashMap::new();
    for row in rows {
        let recipient_user_id: String = row.try_get("recipient_user_id").unwrap();
        let sealed_key_json: String = row.try_get("sealed_key").unwrap();
        let sealed_key: pv_core::identity::SealedKey = serde_json::from_str(&sealed_key_json).unwrap();
        sealed_by_recipient.insert(recipient_user_id, sealed_key);
    }

    let owner_id = user_id_of(&app, &owner_token).await;
    let owner_row = sealed_by_recipient.get(&owner_id).expect("owner's own row must exist");
    let member2_row = sealed_by_recipient.get(&member2_id).expect("member2's row must exist");
    let member3_row = sealed_by_recipient.get(&member3_id).expect("member3's row must exist");

    // The OWNER's own secret key succeeds and recovers the original
    // CollectionKey bytes.
    let owner_opened = unseal_collection_key(&owner_sk, owner_row).expect("owner must unseal their own row");
    assert_eq!(owner_opened.expose(), ck.expose());

    // Cross-member unseal attempts against the OWNER's row FAIL.
    assert!(
        unseal_collection_key(&member2_sk, owner_row).is_err(),
        "member2's secret key must NOT open the owner's sealed row"
    );
    assert!(
        unseal_collection_key(&member3_sk, owner_row).is_err(),
        "member3's secret key must NOT open the owner's sealed row"
    );

    // Each member's own row unseals correctly under their own secret key and
    // no other's.
    let member2_opened = unseal_collection_key(&member2_sk, member2_row).expect("member2 must unseal their own row");
    assert_eq!(member2_opened.expose(), ck.expose());
    assert!(unseal_collection_key(&owner_sk, member2_row).is_err());
    assert!(unseal_collection_key(&member3_sk, member2_row).is_err());

    let member3_opened = unseal_collection_key(&member3_sk, member3_row).expect("member3 must unseal their own row");
    assert_eq!(member3_opened.expose(), ck.expose());
    assert!(unseal_collection_key(&owner_sk, member3_row).is_err());
    assert!(unseal_collection_key(&member2_sk, member3_row).is_err());
}

/// Task 2 (KEY-02 no-rewrite proof): adding a member to a collection that
/// already has an item in it creates exactly one new `collection_keys` row
/// and rewrites NOT ONE BYTE of the item's `enc_data`.
///
/// NOTE (deliberate test-fixture shortcut): this test seeds
/// `vault_items.collection_id` via a raw SQL `UPDATE` executed directly
/// against `common::test_pool()`'s pool — the real "move an item into a
/// collection" endpoint does not exist until Plan 22-04. This bypasses the
/// production move path entirely; do not confuse this with it.
#[tokio::test]
async fn adding_member_creates_one_wrap_row_no_ciphertext_rewrite() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "norewrite-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member2_token =
        common::register_second_family_member(&app, &owner_token, "norewrite-member2@example.com").await;
    let member2_id = user_id_of(&app, &member2_token).await;
    let member2_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member2_token, member2_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-norewrite-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    // Create a personal vault item via the existing production endpoint.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob-must-not-change\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    // Deliberate test-fixture shortcut (see this test's doc comment above):
    // seed collection_id directly, bypassing the real move endpoint (Plan
    // 22-04).
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

    let before_res = req(&app, "GET", "/api/vault/items", &owner_token, None).await;
    assert_eq!(before_res.status(), StatusCode::OK);
    let before_body = body_json(before_res).await;
    let enc_data_before = before_body[0]["enc_data"].as_str().unwrap().to_string();

    let count_before_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ?")
        .bind(&collection_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let count_before: i64 = count_before_row.try_get("n").unwrap();

    let member2_sealed = seal(&member2_sk.public_key(), ck.expose()).unwrap();
    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member2_id,
            "sealed_key": serde_json::to_string(&member2_sealed).unwrap(),
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    let count_after_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ?")
        .bind(&collection_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let count_after: i64 = count_after_row.try_get("n").unwrap();
    assert_eq!(count_after - count_before, 1, "adding a member must create EXACTLY one new collection_keys row");

    let after_res = req(&app, "GET", "/api/vault/items", &owner_token, None).await;
    assert_eq!(after_res.status(), StatusCode::OK);
    let after_body = body_json(after_res).await;
    let enc_data_after = after_body[0]["enc_data"].as_str().unwrap().to_string();

    assert_eq!(
        enc_data_before, enc_data_after,
        "adding a member must not rewrite a single byte of the item's enc_data"
    );
}

/// Task 2 (SHARE-06): revocation is enforced on the VERY NEXT request, via
/// the SAME still-valid bearer token (no re-login) — proving the
/// "never cached, always resolved fresh from the DB" property end-to-end.
#[tokio::test]
async fn revoked_share_loses_access_on_next_request_same_session() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "revoke-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member2_token = common::register_second_family_member(&app, &owner_token, "revoke-member2@example.com").await;
    let member2_id = user_id_of(&app, &member2_token).await;
    let member2_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member2_token, member2_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-revoke-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    let member2_sealed = seal(&member2_sk.public_key(), ck.expose()).unwrap();
    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member2_id,
            "sealed_key": serde_json::to_string(&member2_sealed).unwrap(),
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    // The second member's OWN session successfully reads the collection.
    let member2_get_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &member2_token, None).await;
    assert_eq!(member2_get_res.status(), StatusCode::OK);

    // The FIRST (edit) member revokes the second member's access.
    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_id}/access/{member2_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    // Reuse the SECOND member's ORIGINAL still-valid bearer token — no
    // re-login — to GET the collection again: must now be 404, proving
    // revocation is enforced on the very next request via the SAME session.
    let member2_get_after_revoke_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &member2_token, None).await;
    assert_eq!(member2_get_after_revoke_res.status(), StatusCode::NOT_FOUND);

    // Sanity: the owner still retains their own access — only the revoked
    // member's own share was removed, not the whole collection.
    let owner_get_res = req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &owner_token, None).await;
    assert_eq!(owner_get_res.status(), StatusCode::OK);

    let remaining_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
        .bind(&collection_id)
        .bind(&member2_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let remaining: i64 = remaining_row.try_get("n").unwrap();
    assert_eq!(remaining, 0, "the revoked member's collection_keys row must be gone");
}

/// Task 2 confused-deputy guard (T-22-11, RESEARCH.md Pitfall 9):
/// `add_member` targeting a `recipient_user_id` who is NOT a family member
/// is rejected with `400`, never silently wrapping-and-storing for an
/// outsider.
#[tokio::test]
async fn add_member_rejects_non_family_member() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let owner_token = register_and_login(&app, "guard-owner@example.com").await;
    create_family(&app, &owner_token).await;

    // A registered user who is NOT a member of the owner's family.
    let outsider_token = register_and_login(&app, "guard-outsider@example.com").await;
    let outsider_id = user_id_of(&app, &outsider_token).await;
    let outsider_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &outsider_token, outsider_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-guard-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    let outsider_sealed = seal(&outsider_sk.public_key(), ck.expose()).unwrap();
    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": outsider_id,
            "sealed_key": serde_json::to_string(&outsider_sealed).unwrap(),
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(
        add_member_res.status(),
        StatusCode::BAD_REQUEST,
        "add_member must never wrap-and-store a sealed key for a non-family-member recipient"
    );
}

/// Task 2 (this plan's authored prohibition): a malformed/unrecognized
/// `access_level` on `POST .../members` is rejected with `400`, never
/// silently coerced to a working/permissive default.
#[tokio::test]
async fn add_member_rejects_malformed_access_level() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "malformed-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member2_token =
        common::register_second_family_member(&app, &owner_token, "malformed-member2@example.com").await;
    let member2_id = user_id_of(&app, &member2_token).await;
    let member2_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member2_token, member2_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-malformed-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    let member2_sealed = seal(&member2_sk.public_key(), ck.expose()).unwrap();
    let add_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member2_id,
            "sealed_key": serde_json::to_string(&member2_sealed).unwrap(),
            "access_level": "super-admin-mode",
        })),
    )
    .await;
    assert_eq!(
        add_member_res.status(),
        StatusCode::BAD_REQUEST,
        "a malformed access_level must be rejected with 400, never silently defaulted"
    );

    // The row must NOT have been created despite the rejection.
    let count_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
        .bind(&collection_id)
        .bind(&member2_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let count: i64 = count_row.try_get("n").unwrap();
    assert_eq!(count, 0, "a rejected malformed access_level must never leave a collection_keys row behind");
}

// --- Plan 22-04, Task 1: the move endpoint (SHARE-04 / Vaultwarden #6269) ---

/// The headline regression this plan exists to close (SHARE-04, Vaultwarden
/// #6269): a member with `hidden_password` access on an item's CURRENT
/// collection must never be able to reassign it to a different collection —
/// even one the caller has full `edit` access to — because doing so would
/// let them accidentally expose the password to themselves in the
/// destination scope. `hidden_password` sits directly adjacent to `edit` in
/// the access-level vocabulary but must never be conflated with it at this
/// gate (`RequireEdit::satisfied_by`'s exact-match design, Plan 22-01).
#[tokio::test]
async fn hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "vw6269-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let hp_member_token =
        common::register_second_family_member(&app, &owner_token, "vw6269-hp-member@example.com").await;
    let hp_member_id = user_id_of(&app, &hp_member_token).await;
    let hp_member_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &hp_member_token, hp_member_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();

    // SOURCE collection: owner (creator, edit) + hp_member at hidden_password.
    let source_ck = CollectionKey::generate();
    let owner_sealed_source = seal(&owner_sk.public_key(), source_ck.expose()).unwrap();
    let create_source_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-vw6269-source-collection",
            "sealed_key": serde_json::to_string(&owner_sealed_source).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_source_res.status(), StatusCode::CREATED);
    let source_collection_id = body_json(create_source_res).await["id"].as_str().unwrap().to_string();

    let hp_member_sealed = seal(&hp_member_sk.public_key(), source_ck.expose()).unwrap();
    let add_hp_member_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{source_collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": hp_member_id,
            "sealed_key": serde_json::to_string(&hp_member_sealed).unwrap(),
            "access_level": "hidden_password",
        })),
    )
    .await;
    assert_eq!(add_hp_member_res.status(), StatusCode::CREATED);

    // A SEPARATE destination collection ("any other collection", per the
    // plan's wording) — the hp_member has no relationship to it at all,
    // which is irrelevant to this test's assertion, since the SOURCE check
    // (this test's actual subject) rejects the caller before the
    // destination check ever runs.
    let dest_ck = CollectionKey::generate();
    let owner_sealed_dest = seal(&owner_sk.public_key(), dest_ck.expose()).unwrap();
    let create_dest_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-vw6269-dest-collection",
            "sealed_key": serde_json::to_string(&owner_sealed_dest).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_dest_res.status(), StatusCode::CREATED);
    let dest_collection_id = body_json(create_dest_res).await["id"].as_str().unwrap().to_string();

    // Owner creates a personal item, then uses the real move_item endpoint
    // (this same plan's own output — no forward-dependency concern) to place
    // it into the source collection.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let move_into_source_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &owner_token,
        Some(json!({
            "new_collection_id": source_collection_id,
            "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-scoped\"}",
            "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-scoped\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(
        move_into_source_res.status(),
        StatusCode::OK,
        "owner (edit on the source collection) moving their own personal item into it must succeed"
    );

    // THE REGRESSION: hp_member (hidden_password on the item's CURRENT
    // collection) attempts to reassign it to the dest collection — rejected
    // 403 (they provably have SOME access — hidden_password — so this is the
    // insufficient-level case, never the no-access-at-all 404 case).
    let hp_move_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &hp_member_token,
        Some(json!({
            "new_collection_id": dest_collection_id,
            "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"attempted-reassign-key\"}",
            "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"attempted-reassign-data\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        hp_move_res.status(),
        StatusCode::FORBIDDEN,
        "a hidden_password holder on the item's current collection must never be able to reassign it — Vaultwarden #6269"
    );
}

/// The written-rationale destination-collection gate (beyond CONTEXT.md's
/// literal SHARE-04 text, documented in 22-04-PLAN.md's objective): an
/// edit-capable member of the SOURCE collection but only read-capable on a
/// SEPARATE destination collection is rejected 403; the same caller with
/// edit on BOTH succeeds.
#[tokio::test]
async fn move_item_rejected_when_caller_lacks_edit_on_destination_collection() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "movegate-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let mover_token = common::register_second_family_member(&app, &owner_token, "movegate-mover@example.com").await;
    let mover_id = user_id_of(&app, &mover_token).await;
    let mover_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &mover_token, mover_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();

    // Collection A: owner (creator, edit) + mover (edit).
    let ck_a = CollectionKey::generate();
    let owner_sealed_a = seal(&owner_sk.public_key(), ck_a.expose()).unwrap();
    let create_a_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-movegate-collection-a",
            "sealed_key": serde_json::to_string(&owner_sealed_a).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_a_res.status(), StatusCode::CREATED);
    let collection_a_id = body_json(create_a_res).await["id"].as_str().unwrap().to_string();

    let mover_sealed_a = seal(&mover_sk.public_key(), ck_a.expose()).unwrap();
    let add_mover_a_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_a_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": mover_id,
            "sealed_key": serde_json::to_string(&mover_sealed_a).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_mover_a_res.status(), StatusCode::CREATED);

    // Collection B: owner (creator, edit) + mover (read only, at first).
    let ck_b = CollectionKey::generate();
    let owner_sealed_b = seal(&owner_sk.public_key(), ck_b.expose()).unwrap();
    let create_b_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "enc_name": "enc-movegate-collection-b",
            "sealed_key": serde_json::to_string(&owner_sealed_b).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_b_res.status(), StatusCode::CREATED);
    let collection_b_id = body_json(create_b_res).await["id"].as_str().unwrap().to_string();

    let mover_sealed_b_read = seal(&mover_sk.public_key(), ck_b.expose()).unwrap();
    let add_mover_b_read_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_b_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": mover_id,
            "sealed_key": serde_json::to_string(&mover_sealed_b_read).unwrap(),
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(add_mover_b_read_res.status(), StatusCode::CREATED);

    // Owner creates a personal item, then moves it into collection A.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let move_into_a_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &owner_token,
        Some(json!({
            "new_collection_id": collection_a_id,
            "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"scoped-to-a-key\"}",
            "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"scoped-to-a-data\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(move_into_a_res.status(), StatusCode::OK);

    // Mover (edit on A, read-only on B) attempts to move the item A -> B:
    // rejected — edit on the SOURCE alone is not sufficient.
    let move_a_to_b_denied_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &mover_token,
        Some(json!({
            "new_collection_id": collection_b_id,
            "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"attempted-a-to-b-key\"}",
            "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"attempted-a-to-b-data\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        move_a_to_b_denied_res.status(),
        StatusCode::FORBIDDEN,
        "edit on the SOURCE collection alone must not be sufficient to move an item into a DESTINATION collection the caller only holds read on"
    );

    // Upgrade mover's access on B to edit: revoke the read grant, re-add with edit.
    let revoke_b_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_b_id}/access/{mover_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_b_res.status(), StatusCode::NO_CONTENT);

    let mover_sealed_b_edit = seal(&mover_sk.public_key(), ck_b.expose()).unwrap();
    let add_mover_b_edit_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_b_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": mover_id,
            "sealed_key": serde_json::to_string(&mover_sealed_b_edit).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_mover_b_edit_res.status(), StatusCode::CREATED);

    // Now the mover (edit on BOTH source and destination) succeeds — the
    // positive path proving the gate isn't just failing everything closed.
    let move_a_to_b_allowed_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &mover_token,
        Some(json!({
            "new_collection_id": collection_b_id,
            "enc_key": "{\"nonce\":\"GGGG\",\"ciphertext\":\"scoped-to-b-key\"}",
            "enc_data": "{\"nonce\":\"HHHH\",\"ciphertext\":\"scoped-to-b-data\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        move_a_to_b_allowed_res.status(),
        StatusCode::OK,
        "edit on BOTH source and destination collections must succeed"
    );
    let move_body = body_json(move_a_to_b_allowed_res).await;
    assert_eq!(move_body["collection_id"].as_str(), Some(collection_b_id.as_str()));
    assert_eq!(move_body["revision"], 3);
}
