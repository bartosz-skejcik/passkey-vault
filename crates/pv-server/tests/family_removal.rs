//! Integration tests for `DELETE /api/families/members/{user_id}` — Phase
//! 25's flagship deliverable: atomic, provably-scoped member removal +
//! re-key (FAM-08/FAM-09, KEY-02/KEY-06/KEY-07).
//!
//! Every `pv_core::identity::{seal, unseal_collection_key}` /
//! `pv_core::items::{encrypt_item_for_collection, rewrap_item_key_for_collection}`
//! call in this file is the CLIENT-side simulation the plan requires — the
//! server (`crates/pv-server/src/routes/families.rs`) never calls any of
//! them.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use pv_core::identity::{seal, unseal_collection_key, IdentitySecretKey};
use pv_core::items::{encrypt_item_for_collection, rewrap_item_key_for_collection, CollectionKey};
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

async fn user_id_of(app: &axum::Router, token: &str) -> String {
    let res = req(app, "GET", "/api/auth/me", token, None).await;
    assert_eq!(res.status(), StatusCode::OK, "fetching own user id via /api/auth/me must succeed");
    let body = body_json(res).await;
    body["user_id"].as_str().unwrap().to_string()
}

/// Mirrors `tests/collections.rs`'s own helper of the same name.
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

async fn vault_revision_of(pool: &sqlx::SqlitePool, user_id: &str) -> i64 {
    sqlx::query_scalar("SELECT vault_revision FROM users WHERE id = ?").bind(user_id).fetch_one(pool).await.unwrap()
}

/// Task 2 (KEY-02/KEY-06/KEY-07/SC 6 — the phase's flagship happy path):
/// an owner removes a member who reaches ONE collection (as an `edit`
/// recipient, one real item in it) AND holds a direct `item_shares` grant
/// on an UNRELATED personal item owned by the owner. A single
/// `remove_member` call, with a client-precomputed batch built the exact
/// way a real browser tab would (real `CollectionKey` rewrap via `pv-core`),
/// must: remove the target's `collection_keys` row, reseal the remaining
/// recipient's (the owner's) `sealed_key`, rewrap the item's `enc_key` while
/// leaving `enc_data` byte-identical, sever the UNRELATED `item_shares`
/// grant (KEY-02's adjacency fix), delete the target's `family_members`
/// row, bump the target's own `vault_revision` by exactly 1, and reject the
/// target's very next request to a `Membership`-gated route with 404.
#[tokio::test]
async fn remove_member_atomic_rekey_happy_path_touches_exactly_one_collection_and_severs_item_shares() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmremoval-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token =
        common::register_second_family_member(&app, &owner_token, "rmremoval-member@example.com").await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let member_id = user_id_of(&app, &member_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member_sk = IdentitySecretKey::generate();
    // `add_member`'s confused-deputy guard requires a `user_keypairs` row for
    // the RECIPIENT — the owner never needs one published for this test.
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;

    // --- Seed: one shared collection, member as an `edit` recipient, one
    // real item in it (real pv-core crypto, so `rewrap_item_key_for_collection`
    // genuinely opens/reseals it below). ---
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmremoval-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

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

    let item_id = uuid::Uuid::new_v4().to_string();
    let plaintext = br#"{"type":"login","username":"u","password":"p"}"#;
    let encrypted = encrypt_item_for_collection(&ck, plaintext, &collection_id, &item_id, 1).unwrap();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_id,
            "enc_key": serde_json::to_string(&encrypted.enc_key).unwrap(),
            "enc_data": serde_json::to_string(&encrypted.enc_data).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);
    // Deliberate test-fixture shortcut (mirrors `tests/collections.rs`'s own
    // `adding_member_creates_one_wrap_row_no_ciphertext_rewrite` convention):
    // seed `collection_id` directly, bypassing the real move endpoint.
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

    // --- Seed: an UNRELATED personal item, owned by the owner, directly
    // shared to the member — the KEY-02 adjacency case. ---
    let personal_item_id = uuid::Uuid::new_v4().to_string();
    let create_personal_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": personal_item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"personal-key\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"personal-data\"}",
        })),
    )
    .await;
    assert_eq!(create_personal_res.status(), StatusCode::CREATED);

    let personal_item_sealed = seal(&member_sk.public_key(), b"dummy-item-key").unwrap();
    let share_res = req(
        &app,
        "POST",
        &format!("/api/vault/items/{personal_item_id}/shares"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": serde_json::to_string(&personal_item_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(share_res.status(), StatusCode::CREATED);

    // --- Pre-removal snapshots. ---
    let enc_data_before: String = sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?")
        .bind(&item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let member_vault_revision_before = vault_revision_of(&pool, &member_id).await;

    // --- Simulate the client: unseal the owner's own sealed_key to recover
    // the OLD CollectionKey, generate a NEW one, seal it to the owner (the
    // SOLE remaining recipient once the member is removed), and rewrap the
    // item's Cipher Key — exactly the batch a real browser tab would build. ---
    let old_ck = unseal_collection_key(&owner_sk, &owner_sealed).unwrap();
    let new_ck = CollectionKey::generate();
    let new_owner_sealed = seal(&owner_sk.public_key(), new_ck.expose()).unwrap();
    let new_enc_key = rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted.enc_key, &collection_id, &item_id)
        .unwrap();

    let remove_res = req(
        &app,
        "DELETE",
        &format!("/api/families/members/{member_id}"),
        &owner_token,
        Some(json!({
            "collections": [
                {
                    "collection_id": collection_id,
                    "new_sealed_keys": [
                        { "recipient_user_id": owner_id, "sealed_key": serde_json::to_string(&new_owner_sealed).unwrap() }
                    ],
                    "item_rewraps": [
                        { "item_id": item_id, "enc_key": serde_json::to_string(&new_enc_key).unwrap() }
                    ]
                }
            ]
        })),
    )
    .await;
    assert_eq!(remove_res.status(), StatusCode::NO_CONTENT);

    // --- Assertions. ---
    let member_collection_keys_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_collection_keys_count, 0, "the removed member's collection_keys row must be gone");

    let owner_sealed_key_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner_sealed_key_after,
        serde_json::to_string(&new_owner_sealed).unwrap(),
        "the owner's own sealed_key must now equal the newly-sealed blob"
    );

    let enc_key_after: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        enc_key_after,
        serde_json::to_string(&new_enc_key).unwrap(),
        "the item's enc_key must equal the rewrapped blob"
    );

    let enc_data_after: String =
        sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    assert_eq!(enc_data_after, enc_data_before, "SC 6: enc_data must be byte-identical before and after removal");

    let member_item_shares_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
            .bind(&personal_item_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        member_item_shares_count, 0,
        "KEY-02 adjacency: the member's item_shares row on the UNRELATED personal item must also be gone"
    );

    let member_family_row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM family_members WHERE user_id = ?")
        .bind(&member_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(member_family_row_count, 0, "the removed member's family_members row must be gone");

    let member_vault_revision_after = vault_revision_of(&pool, &member_id).await;
    assert_eq!(
        member_vault_revision_after - member_vault_revision_before,
        1,
        "WR-07: the removed member's own vault_revision must be bumped by exactly 1"
    );

    // The removed member's very next request to a Membership-gated route
    // (still the SAME, still-valid bearer token — no re-login) is 404.
    let member_items_after_removal_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}/items"), &member_token, None).await;
    assert_eq!(
        member_items_after_removal_res.status(),
        StatusCode::NOT_FOUND,
        "the removed member's next request must be rejected with 404, not cached access"
    );
}

/// Task 2 (KEY-02/KEY-06's own recommended resolution to RESEARCH.md's Open
/// Question 1): a plain family member with ZERO `collection_keys` rows is
/// removed with an empty `collections: []` batch — a zero-write re-key, no
/// special-cased branch, no error.
#[tokio::test]
async fn remove_member_zero_collection_access_is_a_no_op_rekey() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmzero-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token = common::register_second_family_member(&app, &owner_token, "rmzero-member@example.com").await;
    let member_id = user_id_of(&app, &member_token).await;

    let collection_keys_count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys").fetch_one(&pool).await.unwrap();
    let vault_items_count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_items").fetch_one(&pool).await.unwrap();
    let member_vault_revision_before = vault_revision_of(&pool, &member_id).await;

    let remove_res = req(
        &app,
        "DELETE",
        &format!("/api/families/members/{member_id}"),
        &owner_token,
        Some(json!({ "collections": [] })),
    )
    .await;
    assert_eq!(remove_res.status(), StatusCode::NO_CONTENT);

    let member_family_row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM family_members WHERE user_id = ?")
        .bind(&member_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(member_family_row_count, 0, "the removed member's family_members row must be gone");

    let collection_keys_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys").fetch_one(&pool).await.unwrap();
    let vault_items_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_items").fetch_one(&pool).await.unwrap();
    assert_eq!(collection_keys_count_before, collection_keys_count_after, "zero collection_keys rows must be written");
    assert_eq!(vault_items_count_before, vault_items_count_after, "zero vault_items rows must be written");

    let member_vault_revision_after = vault_revision_of(&pool, &member_id).await;
    assert_eq!(
        member_vault_revision_after - member_vault_revision_before,
        1,
        "the removed member's own vault_revision must still be bumped, even on a zero-write re-key"
    );
}

// --- Plan 25-04 (FAM-07/FAM-09): reversible suspend/reinstate ---

/// Seeds owner + member + one shared collection (member as an `edit`
/// recipient) with one real item in it, mirroring the happy-path fixture
/// above but without any removal — this plan's suspend/reinstate tests need
/// a member who genuinely holds `collection_keys`/`vault_items` access to
/// snapshot and later prove untouched.
async fn seed_owner_member_and_shared_collection(
    app: &axum::Router,
    pool: &sqlx::SqlitePool,
    owner_email: &str,
    member_email: &str,
) -> (String, String, String, String, String) {
    let owner_token = register_and_login(app, owner_email).await;
    create_family(app, &owner_token).await;
    let member_token = common::register_second_family_member(app, &owner_token, member_email).await;
    let owner_id = user_id_of(app, &owner_token).await;
    let member_id = user_id_of(app, &member_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member_sk = IdentitySecretKey::generate();
    publish_keypair(app, &member_token, member_sk.public_key().to_bytes()).await;

    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-suspend-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    let member_sealed = seal(&member_sk.public_key(), ck.expose()).unwrap();
    let add_member_res = req(
        app,
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

    let item_id = uuid::Uuid::new_v4().to_string();
    let plaintext = br#"{"type":"login","username":"u","password":"p"}"#;
    let encrypted = encrypt_item_for_collection(&ck, plaintext, &collection_id, &item_id, 1).unwrap();
    let create_item_res = req(
        app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_id,
            "enc_key": serde_json::to_string(&encrypted.enc_key).unwrap(),
            "enc_data": serde_json::to_string(&encrypted.enc_data).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);
    // Deliberate test-fixture shortcut (mirrors the happy-path removal test
    // above and `tests/collections.rs`'s own established convention): seed
    // `collection_id` directly, bypassing the real move endpoint.
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(pool)
        .await
        .unwrap();

    (owner_token, member_token, owner_id, member_id, collection_id)
}

/// Reads a member's own `status` field out of a fresh `GET
/// /api/families/members` response — the ONLY read-side surface for
/// suspension state.
async fn member_status_via_list(app: &axum::Router, caller_token: &str, target_user_id: &str) -> String {
    let res = req(app, "GET", "/api/families/members", caller_token, None).await;
    assert_eq!(res.status(), StatusCode::OK, "GET /api/families/members must succeed");
    let body = body_json(res).await;
    let members = body.as_array().unwrap();
    let entry = members
        .iter()
        .find(|m| m["user_id"].as_str() == Some(target_user_id))
        .unwrap_or_else(|| panic!("target user {target_user_id} not found in members response"));
    entry["status"].as_str().unwrap().to_string()
}

/// Task 1 (FAM-07's flagship proof, must_haves truths 2/3/6): suspending and
/// then reinstating a member touches ONLY `family_members.status` — the
/// member's own `collection_keys.sealed_key` and the shared item's
/// `vault_items.enc_key` are byte-identical before, during, and after the
/// whole cycle. `GET /api/families/members`'s `status` field reflects each
/// transition too (the only read-side surface for suspension state).
#[tokio::test]
async fn suspend_then_reinstate_touches_only_family_members_status() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let (owner_token, _member_token, _owner_id, member_id, collection_id) = seed_owner_member_and_shared_collection(
        &app,
        &pool,
        "suspend-owner@example.com",
        "suspend-member@example.com",
    )
    .await;

    let sealed_key_before: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let item_id: String =
        sqlx::query_scalar("SELECT id FROM vault_items WHERE collection_id = ?").bind(&collection_id).fetch_one(&pool).await.unwrap();
    let enc_key_before: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();

    // --- Suspend ---
    let suspend_res =
        req(&app, "POST", &format!("/api/families/members/{member_id}/suspend"), &owner_token, None).await;
    assert_eq!(suspend_res.status(), StatusCode::NO_CONTENT);

    let status_after_suspend: String =
        sqlx::query_scalar("SELECT status FROM family_members WHERE user_id = ?").bind(&member_id).fetch_one(&pool).await.unwrap();
    assert_eq!(status_after_suspend, "suspended");
    assert_eq!(
        member_status_via_list(&app, &owner_token, &member_id).await,
        "suspended",
        "GET /api/families/members must reflect the suspended status"
    );

    let sealed_key_after_suspend: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(sealed_key_after_suspend, sealed_key_before, "suspend must not touch collection_keys.sealed_key");
    let enc_key_after_suspend: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    assert_eq!(enc_key_after_suspend, enc_key_before, "suspend must not touch vault_items.enc_key");

    // --- Reinstate ---
    let reinstate_res =
        req(&app, "POST", &format!("/api/families/members/{member_id}/reinstate"), &owner_token, None).await;
    assert_eq!(reinstate_res.status(), StatusCode::NO_CONTENT);

    let status_after_reinstate: String =
        sqlx::query_scalar("SELECT status FROM family_members WHERE user_id = ?").bind(&member_id).fetch_one(&pool).await.unwrap();
    assert_eq!(status_after_reinstate, "active");
    assert_eq!(
        member_status_via_list(&app, &owner_token, &member_id).await,
        "active",
        "GET /api/families/members must reflect the active status again"
    );

    let sealed_key_after_reinstate: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&member_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        sealed_key_after_reinstate, sealed_key_before,
        "reinstate must not touch collection_keys.sealed_key — SAME bytes across the whole cycle"
    );
    let enc_key_after_reinstate: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        enc_key_after_reinstate, enc_key_before,
        "reinstate must not touch vault_items.enc_key — SAME bytes across the whole cycle"
    );
}

/// Task 1 (T-25-10/T-25-11): owner attempting to suspend/reinstate
/// THEMSELVES is rejected with 400 (server-side self-lockout guard, not
/// merely a hidden UI affordance); an owner attempting against a random
/// non-member user id gets 404 (confused-deputy guard).
#[tokio::test]
async fn suspend_reinstate_reject_self_target_and_non_member() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "susp-reject-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let owner_id = user_id_of(&app, &owner_token).await;

    let self_suspend_res =
        req(&app, "POST", &format!("/api/families/members/{owner_id}/suspend"), &owner_token, None).await;
    assert_eq!(self_suspend_res.status(), StatusCode::BAD_REQUEST, "owner cannot suspend themselves");

    let self_reinstate_res =
        req(&app, "POST", &format!("/api/families/members/{owner_id}/reinstate"), &owner_token, None).await;
    assert_eq!(self_reinstate_res.status(), StatusCode::BAD_REQUEST, "owner cannot reinstate themselves");

    let non_member_id = uuid::Uuid::new_v4().to_string();
    let non_member_suspend_res =
        req(&app, "POST", &format!("/api/families/members/{non_member_id}/suspend"), &owner_token, None).await;
    assert_eq!(
        non_member_suspend_res.status(),
        StatusCode::NOT_FOUND,
        "a target with no family_members row in the caller's family must 404"
    );

    let non_member_reinstate_res =
        req(&app, "POST", &format!("/api/families/members/{non_member_id}/reinstate"), &owner_token, None).await;
    assert_eq!(
        non_member_reinstate_res.status(),
        StatusCode::NOT_FOUND,
        "a target with no family_members row in the caller's family must 404"
    );
}
