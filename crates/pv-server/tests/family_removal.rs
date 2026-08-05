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

/// Generic N-th-member version of `common::register_second_family_member`/
/// `register_third_family_member` — Task 2's cost-proportionality test needs
/// 9 additional members, more than those two named helpers cover.
async fn register_family_member(app: &axum::Router, owner_token: &str, email: &str) -> String {
    let member_token = register_and_login(app, email).await;
    let member_id = user_id_of(app, &member_token).await;
    let add_res =
        req(app, "POST", "/api/families/members", owner_token, Some(json!({ "user_id": member_id }))).await;
    assert_eq!(add_res.status(), StatusCode::CREATED, "owner adding a new member must succeed");
    member_token
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

// --- Plan 25-05 (KEY-07): a genuine mid-write atomicity fault, plus the
// (distinct) pre-write race guard ---

/// Task 1 — the DISTINCT pre-write race guard (KEEP: real evidence of a real
/// property, but NOT the atomicity proof below). A genuine, reachable race —
/// an item deleted between the owner's item-list fetch and the removal
/// request — causes `remove_member`'s PRE-write completeness check to reject
/// the WHOLE batch (409) before any write is issued at all.
#[tokio::test]
async fn remove_member_rejects_stale_batch_before_any_write_when_item_deleted_mid_race() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmrace-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token = common::register_second_family_member(&app, &owner_token, "rmrace-member@example.com").await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let member_id = user_id_of(&app, &member_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;

    // --- Seed: one shared collection, member as an `edit` recipient, TWO
    // real items in it. ---
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmrace-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
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

    let mut item_ids = Vec::new();
    let mut encrypted_items = Vec::new();
    for i in 0..2 {
        let item_id = uuid::Uuid::new_v4().to_string();
        let plaintext = format!(r#"{{"type":"login","username":"u{i}","password":"p{i}"}}"#);
        let encrypted =
            encrypt_item_for_collection(&ck, plaintext.as_bytes(), &collection_id, &item_id, 1).unwrap();
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
        sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
            .bind(&collection_id)
            .bind(&item_id)
            .execute(&pool)
            .await
            .unwrap();
        item_ids.push(item_id);
        encrypted_items.push(encrypted);
    }
    let (item1_id, item2_id) = (item_ids[0].clone(), item_ids[1].clone());

    // --- Pre-removal snapshots: the SURVIVING item2's enc_key and the
    // owner's own sealed_key for this collection. ---
    let item2_enc_key_before: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item2_id).fetch_one(&pool).await.unwrap();
    let owner_sealed_key_before: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // --- Simulate the owner's client: fetch the (two-item) batch shape,
    // unseal the OLD CollectionKey, generate a NEW one, seal it for the
    // owner (the sole remaining recipient), and rewrap BOTH items' Cipher
    // Keys — exactly the batch a real browser tab would build BEFORE the
    // race below happens. ---
    let old_ck = unseal_collection_key(&owner_sk, &owner_sealed).unwrap();
    let new_ck = CollectionKey::generate();
    let new_owner_sealed = seal(&owner_sk.public_key(), new_ck.expose()).unwrap();
    let new_enc_key_1 =
        rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted_items[0].enc_key, &collection_id, &item1_id)
            .unwrap();
    let new_enc_key_2 =
        rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted_items[1].enc_key, &collection_id, &item2_id)
            .unwrap();

    // --- THE RACE: item1 is deleted directly, AFTER the client's fetch
    // (simulated above) but BEFORE the removal request below is submitted —
    // a genuine, reachable TOCTOU window, not a synthetic one. ---
    sqlx::query("DELETE FROM vault_items WHERE id = ?").bind(&item1_id).execute(&pool).await.unwrap();

    // --- The STALE batch still names the now-deleted item1. ---
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
                        { "item_id": item1_id, "enc_key": serde_json::to_string(&new_enc_key_1).unwrap() },
                        { "item_id": item2_id, "enc_key": serde_json::to_string(&new_enc_key_2).unwrap() }
                    ]
                }
            ]
        })),
    )
    .await;
    assert_eq!(
        remove_res.status(),
        StatusCode::CONFLICT,
        "a stale item set (naming a since-deleted item) must be rejected with 409 BEFORE any write"
    );

    // --- Assertions: via a plain SELECT against the test's own `pool`
    // handle — NO write was issued. ---
    let item2_enc_key_after: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item2_id).fetch_one(&pool).await.unwrap();
    assert_eq!(item2_enc_key_after, item2_enc_key_before, "the surviving item's enc_key must be byte-identical");

    let owner_sealed_key_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner_sealed_key_after, owner_sealed_key_before, "the owner's sealed_key must be byte-identical");

    let member_collection_keys_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_collection_keys_count, 1, "the target's collection_keys row for this collection must still exist");

    let member_family_row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM family_members WHERE user_id = ?")
        .bind(&member_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(member_family_row_count, 1, "the target's family_members row must still exist");
}

/// Task 1 — the ACTUAL KEY-07 atomicity proof: a GENUINE mid-transaction
/// fault. A batch spans TWO collections (X then Y); `FAULT_INJECT_AFTER_COLLECTION_INDEX`
/// is set to `Some(0)` so the handler fully processes and issues EVERY write
/// for collection X (which would durably persist on their own), THEN
/// observes the injected fault and returns BEFORE Y is ever touched. The
/// WHOLE transaction must roll back — X's already-issued writes included —
/// proving the surrounding `BEGIN IMMEDIATE` transaction boundary itself is
/// load-bearing, not merely the pre-write completeness check above.
#[tokio::test]
async fn remove_member_rolls_back_completely_on_injected_mid_write_fault() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmatomic-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token =
        common::register_second_family_member(&app, &owner_token, "rmatomic-member@example.com").await;
    let bystander_token =
        common::register_third_family_member(&app, &owner_token, "rmatomic-bystander@example.com").await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let member_id = user_id_of(&app, &member_token).await;
    let bystander_id = user_id_of(&app, &bystander_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member_sk = IdentitySecretKey::generate();
    let bystander_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;
    publish_keypair(&app, &bystander_token, bystander_sk.public_key().to_bytes()).await;

    // --- Collection X: shared by O, M, B — M's removal leaves TWO remaining
    // recipients (O and B). ---
    let ck_x = CollectionKey::generate();
    let owner_sealed_x = seal(&owner_sk.public_key(), ck_x.expose()).unwrap();
    let create_x_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmatomic-x", "sealed_key": serde_json::to_string(&owner_sealed_x).unwrap() })),
    )
    .await;
    assert_eq!(create_x_res.status(), StatusCode::CREATED);
    let collection_x_id = body_json(create_x_res).await["id"].as_str().unwrap().to_string();

    let member_sealed_x = seal(&member_sk.public_key(), ck_x.expose()).unwrap();
    let add_member_x_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_x_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": serde_json::to_string(&member_sealed_x).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member_x_res.status(), StatusCode::CREATED);

    let bystander_sealed_x = seal(&bystander_sk.public_key(), ck_x.expose()).unwrap();
    let add_bystander_x_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_x_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": bystander_id,
            "sealed_key": serde_json::to_string(&bystander_sealed_x).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_bystander_x_res.status(), StatusCode::CREATED);

    let item_x_id = uuid::Uuid::new_v4().to_string();
    let encrypted_x =
        encrypt_item_for_collection(&ck_x, br#"{"type":"login"}"#, &collection_x_id, &item_x_id, 1).unwrap();
    let create_item_x_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_x_id,
            "enc_key": serde_json::to_string(&encrypted_x.enc_key).unwrap(),
            "enc_data": serde_json::to_string(&encrypted_x.enc_data).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_item_x_res.status(), StatusCode::CREATED);
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_x_id)
        .bind(&item_x_id)
        .execute(&pool)
        .await
        .unwrap();

    // --- Collection Y: shared by O and M only — M's removal leaves ONE
    // remaining recipient (O). ---
    let ck_y = CollectionKey::generate();
    let owner_sealed_y = seal(&owner_sk.public_key(), ck_y.expose()).unwrap();
    let create_y_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmatomic-y", "sealed_key": serde_json::to_string(&owner_sealed_y).unwrap() })),
    )
    .await;
    assert_eq!(create_y_res.status(), StatusCode::CREATED);
    let collection_y_id = body_json(create_y_res).await["id"].as_str().unwrap().to_string();

    let member_sealed_y = seal(&member_sk.public_key(), ck_y.expose()).unwrap();
    let add_member_y_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_y_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": member_id,
            "sealed_key": serde_json::to_string(&member_sealed_y).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_member_y_res.status(), StatusCode::CREATED);

    let item_y_id = uuid::Uuid::new_v4().to_string();
    let encrypted_y =
        encrypt_item_for_collection(&ck_y, br#"{"type":"note"}"#, &collection_y_id, &item_y_id, 1).unwrap();
    let create_item_y_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": item_y_id,
            "enc_key": serde_json::to_string(&encrypted_y.enc_key).unwrap(),
            "enc_data": serde_json::to_string(&encrypted_y.enc_data).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_item_y_res.status(), StatusCode::CREATED);
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_y_id)
        .bind(&item_y_id)
        .execute(&pool)
        .await
        .unwrap();

    // --- Pre-call snapshots, via the test's OWN `pool` handle. ---
    let x_owner_sealed_before: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_x_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let x_bystander_sealed_before: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_x_id)
    .bind(&bystander_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let x_item_enc_key_before: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_x_id).fetch_one(&pool).await.unwrap();

    let y_owner_sealed_before: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_y_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let y_item_enc_key_before: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_y_id).fetch_one(&pool).await.unwrap();

    let member_ck_x_count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_x_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_ck_x_count_before, 1, "sanity: M must hold a collection_keys row for X before removal");
    let member_ck_y_count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_y_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_ck_y_count_before, 1, "sanity: M must hold a collection_keys row for Y before removal");

    // --- Simulate the owner's client building a NORMAL, FULLY VALID batch
    // for BOTH collections (X first, then Y). ---
    let old_ck_x = unseal_collection_key(&owner_sk, &owner_sealed_x).unwrap();
    let new_ck_x = CollectionKey::generate();
    let new_owner_sealed_x = seal(&owner_sk.public_key(), new_ck_x.expose()).unwrap();
    let new_bystander_sealed_x = seal(&bystander_sk.public_key(), new_ck_x.expose()).unwrap();
    let new_enc_key_x =
        rewrap_item_key_for_collection(&old_ck_x, &new_ck_x, &encrypted_x.enc_key, &collection_x_id, &item_x_id)
            .unwrap();

    let old_ck_y = unseal_collection_key(&owner_sk, &owner_sealed_y).unwrap();
    let new_ck_y = CollectionKey::generate();
    let new_owner_sealed_y = seal(&owner_sk.public_key(), new_ck_y.expose()).unwrap();
    let new_enc_key_y =
        rewrap_item_key_for_collection(&old_ck_y, &new_ck_y, &encrypted_y.enc_key, &collection_y_id, &item_y_id)
            .unwrap();

    let request_body = json!({
        "collections": [
            {
                "collection_id": collection_x_id,
                "new_sealed_keys": [
                    { "recipient_user_id": owner_id, "sealed_key": serde_json::to_string(&new_owner_sealed_x).unwrap() },
                    { "recipient_user_id": bystander_id, "sealed_key": serde_json::to_string(&new_bystander_sealed_x).unwrap() }
                ],
                "item_rewraps": [
                    { "item_id": item_x_id, "enc_key": serde_json::to_string(&new_enc_key_x).unwrap() }
                ]
            },
            {
                "collection_id": collection_y_id,
                "new_sealed_keys": [
                    { "recipient_user_id": owner_id, "sealed_key": serde_json::to_string(&new_owner_sealed_y).unwrap() }
                ],
                "item_rewraps": [
                    { "item_id": item_y_id, "enc_key": serde_json::to_string(&new_enc_key_y).unwrap() }
                ]
            }
        ]
    });

    // --- Set the fault-injection hook: fire immediately AFTER collection
    // index 0 (X)'s writes complete, BEFORE collection index 1 (Y) is ever
    // touched. Reset it IMMEDIATELY after the call returns, before any
    // assertion — so a panicking assertion below can never leak
    // fault-injection state to a later test sharing this thread. ---
    pv_server::routes::families::FAULT_INJECT_AFTER_COLLECTION_INDEX.with(|f| f.set(Some(0)));
    let remove_res =
        req(&app, "DELETE", &format!("/api/families/members/{member_id}"), &owner_token, Some(request_body))
            .await;
    pv_server::routes::families::FAULT_INJECT_AFTER_COLLECTION_INDEX.with(|f| f.set(None));

    assert_eq!(
        remove_res.status(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "the injected fault (apply_member_removal_rekey returns ApiError::Internal directly) must surface as 500"
    );

    // --- Assertions: via plain SELECTs against the test's own `pool`
    // handle (never the request's own, already-dropped transaction) — the
    // ENTIRE transaction rolled back, not merely the injection point.
    // Collection X's writes WERE issued and would have durably persisted on
    // their own, but were never committed. ---
    let x_owner_sealed_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_x_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(x_owner_sealed_after, x_owner_sealed_before, "X's owner sealed_key must be UNCHANGED after rollback");

    let x_bystander_sealed_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_x_id)
    .bind(&bystander_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        x_bystander_sealed_after, x_bystander_sealed_before,
        "X's bystander sealed_key must be UNCHANGED after rollback"
    );

    let x_item_enc_key_after: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_x_id).fetch_one(&pool).await.unwrap();
    assert_eq!(x_item_enc_key_after, x_item_enc_key_before, "X's item enc_key must be UNCHANGED after rollback");

    let y_owner_sealed_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_y_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(y_owner_sealed_after, y_owner_sealed_before, "Y (never even attempted) must be unchanged");

    let y_item_enc_key_after: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_y_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        y_item_enc_key_after, y_item_enc_key_before,
        "Y's item enc_key (never even attempted) must be unchanged"
    );

    let member_ck_x_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_x_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_ck_x_count_after, 1, "M's collection_keys row for X must still exist — the DELETE never committed");

    let member_ck_y_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_y_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_ck_y_count_after, 1, "M's collection_keys row for Y must still exist — Y was never attempted");

    let member_family_row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM family_members WHERE user_id = ?")
        .bind(&member_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(member_family_row_count, 1, "M's family_members row must still exist — the DELETE never committed");
}

/// Task 2 (KEY-06's adjacency edge / SC 6's scope-vs-payload distinction): a
/// target member is removed from a SMALL "target" collection while a
/// SEPARATE, much LARGER "control" collection — shared with the owner and 8
/// OTHER family members, holding 50 items, and NEVER reachable by the
/// target — is provably untouched. Exact row-count/byte-diff assertions for
/// the target collection's writes; byte-identical snapshots for every one
/// of the control collection's rows.
#[tokio::test]
async fn rekey_cost_and_scope_proportional_to_target_collection_only() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmscope-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let owner_sk = IdentitySecretKey::generate();

    // The ONE member being removed — the target collection is their SOLE
    // reachable collection (never added to control below).
    let target_token = common::register_second_family_member(&app, &owner_token, "rmscope-target@example.com").await;
    let target_id = user_id_of(&app, &target_token).await;
    let target_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &target_token, target_sk.public_key().to_bytes()).await;

    // 8 control-collection-only members (owner + these 8 = the "9 rows"
    // control's collection_keys ends up with).
    let mut control_ids = Vec::new();
    let mut control_sks = Vec::new();
    for i in 0..8 {
        let email = format!("rmscope-control-{i}@example.com");
        let token = register_family_member(&app, &owner_token, &email).await;
        let id = user_id_of(&app, &token).await;
        let sk = IdentitySecretKey::generate();
        publish_keypair(&app, &token, sk.public_key().to_bytes()).await;
        control_ids.push(id);
        control_sks.push(sk);
    }

    // --- Target collection: owner + target only, 2 items. ---
    let ck_target = CollectionKey::generate();
    let owner_sealed_target = seal(&owner_sk.public_key(), ck_target.expose()).unwrap();
    let create_target_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmscope-target", "sealed_key": serde_json::to_string(&owner_sealed_target).unwrap() })),
    )
    .await;
    assert_eq!(create_target_res.status(), StatusCode::CREATED);
    let target_collection_id = body_json(create_target_res).await["id"].as_str().unwrap().to_string();

    let target_sealed = seal(&target_sk.public_key(), ck_target.expose()).unwrap();
    let add_target_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{target_collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": target_id,
            "sealed_key": serde_json::to_string(&target_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_target_res.status(), StatusCode::CREATED);

    let mut target_item_ids = Vec::new();
    let mut target_encrypted_items = Vec::new();
    for i in 0..2 {
        let item_id = uuid::Uuid::new_v4().to_string();
        let plaintext = format!(r#"{{"type":"login","username":"target{i}"}}"#);
        let encrypted =
            encrypt_item_for_collection(&ck_target, plaintext.as_bytes(), &target_collection_id, &item_id, 1)
                .unwrap();
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
        sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
            .bind(&target_collection_id)
            .bind(&item_id)
            .execute(&pool)
            .await
            .unwrap();
        target_item_ids.push(item_id);
        target_encrypted_items.push(encrypted);
    }

    // --- Control collection: owner + all 8 control members (NOT the
    // target), 50 items — much larger, sharing the same database. ---
    let ck_control = CollectionKey::generate();
    let owner_sealed_control = seal(&owner_sk.public_key(), ck_control.expose()).unwrap();
    let create_control_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmscope-control", "sealed_key": serde_json::to_string(&owner_sealed_control).unwrap() })),
    )
    .await;
    assert_eq!(create_control_res.status(), StatusCode::CREATED);
    let control_collection_id = body_json(create_control_res).await["id"].as_str().unwrap().to_string();

    for (id, sk) in control_ids.iter().zip(control_sks.iter()) {
        let sealed = seal(&sk.public_key(), ck_control.expose()).unwrap();
        let add_res = req(
            &app,
            "POST",
            &format!("/api/vault/collections/{control_collection_id}/members"),
            &owner_token,
            Some(json!({
                "recipient_user_id": id,
                "sealed_key": serde_json::to_string(&sealed).unwrap(),
                "access_level": "edit",
            })),
        )
        .await;
        assert_eq!(add_res.status(), StatusCode::CREATED);
    }

    for i in 0..50 {
        let item_id = uuid::Uuid::new_v4().to_string();
        let plaintext = format!(r#"{{"type":"login","username":"control{i}"}}"#);
        let encrypted =
            encrypt_item_for_collection(&ck_control, plaintext.as_bytes(), &control_collection_id, &item_id, 1)
                .unwrap();
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
        sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
            .bind(&control_collection_id)
            .bind(&item_id)
            .execute(&pool)
            .await
            .unwrap();
    }

    // --- Snapshot the control collection's FULL state (all 9 collection_keys
    // rows, all 50 items' enc_key/enc_data) via direct SELECT. ---
    let control_sealed_keys_before: std::collections::HashMap<String, String> = {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT recipient_user_id, sealed_key FROM collection_keys WHERE collection_id = ?",
        )
        .bind(&control_collection_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        rows.into_iter().collect()
    };
    assert_eq!(control_sealed_keys_before.len(), 9, "control collection must have exactly 9 collection_keys rows (owner + 8 control members)");

    let control_items_before: std::collections::HashMap<String, (String, String)> = {
        let rows: Vec<(String, String, String)> =
            sqlx::query_as("SELECT id, enc_key, enc_data FROM vault_items WHERE collection_id = ?")
                .bind(&control_collection_id)
                .fetch_all(&pool)
                .await
                .unwrap();
        rows.into_iter().map(|(id, enc_key, enc_data)| (id, (enc_key, enc_data))).collect()
    };
    assert_eq!(control_items_before.len(), 50, "control collection must have exactly 50 items");

    // --- Also snapshot the target collection's total collection_keys/item
    // counts (pre-removal: 2 rows — owner+target — and 2 items). ---
    let target_collection_keys_count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ?")
            .bind(&target_collection_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(target_collection_keys_count_before, 2);

    // --- Simulate the owner's client: rewrap only the TARGET collection's
    // batch. ---
    let old_ck_target = unseal_collection_key(&owner_sk, &owner_sealed_target).unwrap();
    let new_ck_target = CollectionKey::generate();
    let new_owner_sealed_target = seal(&owner_sk.public_key(), new_ck_target.expose()).unwrap();
    let mut item_rewraps_json = Vec::new();
    for (item_id, encrypted) in target_item_ids.iter().zip(target_encrypted_items.iter()) {
        let new_enc_key = rewrap_item_key_for_collection(
            &old_ck_target,
            &new_ck_target,
            &encrypted.enc_key,
            &target_collection_id,
            item_id,
        )
        .unwrap();
        item_rewraps_json.push(json!({ "item_id": item_id, "enc_key": serde_json::to_string(&new_enc_key).unwrap() }));
    }

    let start = std::time::Instant::now();
    let remove_res = req(
        &app,
        "DELETE",
        &format!("/api/families/members/{target_id}"),
        &owner_token,
        Some(json!({
            "collections": [
                {
                    "collection_id": target_collection_id,
                    "new_sealed_keys": [
                        { "recipient_user_id": owner_id, "sealed_key": serde_json::to_string(&new_owner_sealed_target).unwrap() }
                    ],
                    "item_rewraps": item_rewraps_json
                }
            ]
        })),
    )
    .await;
    let elapsed = start.elapsed();
    assert_eq!(remove_res.status(), StatusCode::NO_CONTENT);
    assert!(
        elapsed < std::time::Duration::from_secs(2),
        "secondary, non-blocking signal: removal should complete quickly despite the much larger control dataset sharing the database (took {elapsed:?})"
    );

    // --- Assertions: exactly the TARGET collection's rows were touched. ---
    let target_collection_keys_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ?")
            .bind(&target_collection_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        target_collection_keys_count_after, 1,
        "exactly 1 collection_keys row (the owner's) must remain in the target collection"
    );

    let owner_sealed_target_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&target_collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner_sealed_target_after,
        serde_json::to_string(&new_owner_sealed_target).unwrap(),
        "the owner's sealed_key in the target collection must be the newly-sealed blob"
    );

    let target_items_after: Vec<(String, String)> =
        sqlx::query_as("SELECT id, enc_key FROM vault_items WHERE collection_id = ?")
            .bind(&target_collection_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(target_items_after.len(), 2, "exactly 2 vault_items rows exist in the target collection");
    for (id, enc_key_after) in &target_items_after {
        let idx = target_item_ids.iter().position(|i| i == id).unwrap();
        assert_ne!(
            enc_key_after, &serde_json::to_string(&target_encrypted_items[idx].enc_key).unwrap(),
            "each target item's enc_key must have been rewrapped (changed) — item {id}"
        );
    }

    // --- Assertions: every one of the control collection's rows is
    // byte-identical to its pre-call snapshot — cost/scope proven bound to
    // the target collection alone. ---
    let control_sealed_keys_after: std::collections::HashMap<String, String> = {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT recipient_user_id, sealed_key FROM collection_keys WHERE collection_id = ?",
        )
        .bind(&control_collection_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        rows.into_iter().collect()
    };
    assert_eq!(
        control_sealed_keys_after, control_sealed_keys_before,
        "every one of the control collection's 9 sealed_key values must be byte-identical — direct assertion, not inference"
    );

    let control_items_after: std::collections::HashMap<String, (String, String)> = {
        let rows: Vec<(String, String, String)> =
            sqlx::query_as("SELECT id, enc_key, enc_data FROM vault_items WHERE collection_id = ?")
                .bind(&control_collection_id)
                .fetch_all(&pool)
                .await
                .unwrap();
        rows.into_iter().map(|(id, enc_key, enc_data)| (id, (enc_key, enc_data))).collect()
    };
    assert_eq!(
        control_items_after, control_items_before,
        "every one of the control collection's 50 items' enc_key/enc_data must be byte-identical — direct assertion, not inference"
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

/// Task 2 (FAM-09's suspend-side live proof — the CONTEXT.md "verify this is
/// actually true rather than assuming it" instruction): a suspended member's
/// STILL-VALID, never-reissued bearer token is rejected on its very next
/// request, and reinstatement restores access on the very next request after
/// THAT — with byte-identical `enc_key`/`sealed_key` across the whole cycle,
/// proving nothing was ever re-wrapped.
#[tokio::test]
async fn suspended_member_loses_and_regains_live_access_on_next_request_with_identical_keys() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let (owner_token, member_token, _owner_id, member_id, collection_id) = seed_owner_member_and_shared_collection(
        &app,
        &pool,
        "live-cycle-owner@example.com",
        "live-cycle-member@example.com",
    )
    .await;

    let item_id: String =
        sqlx::query_scalar("SELECT id FROM vault_items WHERE collection_id = ?").bind(&collection_id).fetch_one(&pool).await.unwrap();
    let enc_key_before: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    let sealed_key_before: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&member_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Member can reach the collection's items BEFORE suspension.
    let pre_suspend_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}/items"), &member_token, None).await;
    assert_eq!(pre_suspend_res.status(), StatusCode::OK, "member must have access before suspension");

    // Owner suspends the member.
    let suspend_res =
        req(&app, "POST", &format!("/api/families/members/{member_id}/suspend"), &owner_token, None).await;
    assert_eq!(suspend_res.status(), StatusCode::NO_CONTENT);

    // The member's very next request — SAME bearer token, no re-login, no
    // token action of any kind — is rejected exactly as a non-member's
    // would be.
    let items_after_suspend_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}/items"), &member_token, None).await;
    assert_eq!(
        items_after_suspend_res.status(),
        StatusCode::NOT_FOUND,
        "a suspended member's live next request must be denied, on the same still-valid token"
    );
    let collection_after_suspend_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &member_token, None).await;
    assert_eq!(
        collection_after_suspend_res.status(),
        StatusCode::NOT_FOUND,
        "a suspended member's live next request to the collection itself must also be denied"
    );

    // Owner reinstates the member.
    let reinstate_res =
        req(&app, "POST", &format!("/api/families/members/{member_id}/reinstate"), &owner_token, None).await;
    assert_eq!(reinstate_res.status(), StatusCode::NO_CONTENT);

    // The member's very next request — SAME token, never reissued —
    // succeeds again, with byte-identical keys to what they held before
    // suspension.
    let items_after_reinstate_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}/items"), &member_token, None).await;
    assert_eq!(
        items_after_reinstate_res.status(),
        StatusCode::OK,
        "reinstatement must restore access on the very next request, same token"
    );
    let items_after_reinstate_body = body_json(items_after_reinstate_res).await;
    let items_array = items_after_reinstate_body.as_array().unwrap();
    let item_entry = items_array.iter().find(|i| i["id"].as_str() == Some(item_id.as_str())).unwrap();
    assert_eq!(
        item_entry["enc_key"].as_str().unwrap(),
        enc_key_before,
        "the item's enc_key after reinstatement must be byte-identical to the pre-suspension snapshot"
    );

    let collection_after_reinstate_res =
        req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &member_token, None).await;
    assert_eq!(collection_after_reinstate_res.status(), StatusCode::OK);
    let collection_after_reinstate_body = body_json(collection_after_reinstate_res).await;
    assert_eq!(
        collection_after_reinstate_body["sealed_key"].as_str().unwrap(),
        sealed_key_before,
        "the collection's sealed_key after reinstatement must be byte-identical to the pre-suspension snapshot"
    );
}

// --- Plan 25-05 (FAM-08 idempotency + order-insensitivity backstop) ---

/// Task 3 (FAM-08 idempotency edge): calling `remove_member` a second time
/// against an already-removed target returns `404` and writes ZERO
/// additional `collection_keys`/`vault_items` rows — a duplicate removal
/// never rotates a Collection Key a second time.
#[tokio::test]
async fn remove_member_called_twice_is_idempotent_and_never_rekeys_twice() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmtwice-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token = common::register_second_family_member(&app, &owner_token, "rmtwice-member@example.com").await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let member_id = user_id_of(&app, &member_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;

    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmtwice-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
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
    let encrypted = encrypt_item_for_collection(&ck, b"secret", &collection_id, &item_id, 1).unwrap();
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
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

    let old_ck = unseal_collection_key(&owner_sk, &owner_sealed).unwrap();
    let new_ck = CollectionKey::generate();
    let new_owner_sealed = seal(&owner_sk.public_key(), new_ck.expose()).unwrap();
    let new_enc_key =
        rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted.enc_key, &collection_id, &item_id).unwrap();

    let batch = json!({
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
    });

    // --- First call: a genuine, successful removal. ---
    let first_remove_res =
        req(&app, "DELETE", &format!("/api/families/members/{member_id}"), &owner_token, Some(batch.clone()))
            .await;
    assert_eq!(first_remove_res.status(), StatusCode::NO_CONTENT);

    let sealed_key_after_first: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let enc_key_after_first: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();

    // --- Second call: SAME target (now removed), SAME batch — must be a
    // pure no-op, rejected before any write. ---
    let second_remove_res =
        req(&app, "DELETE", &format!("/api/families/members/{member_id}"), &owner_token, Some(batch)).await;
    assert_eq!(
        second_remove_res.status(),
        StatusCode::NOT_FOUND,
        "removing an already-removed member must 404, not silently re-apply"
    );

    let sealed_key_after_second: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        sealed_key_after_second, sealed_key_after_first,
        "the Collection Key must NOT be rotated a second time — sealed_key byte-identical"
    );

    let enc_key_after_second: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        enc_key_after_second, enc_key_after_first,
        "the item's enc_key must NOT be rewrapped a second time — byte-identical"
    );
}

/// Task 3: submitting the IDENTICAL valid batch with its internal
/// `new_sealed_keys`/`item_rewraps` arrays in REVERSED order produces the
/// IDENTICAL post-state (byte-identical `enc_key`/`sealed_key` values) as
/// the original order — the batch rewrap is order-insensitive.
#[tokio::test]
async fn remove_member_batch_array_order_does_not_affect_post_state() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "rmorder-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token = common::register_second_family_member(&app, &owner_token, "rmorder-member@example.com").await;
    let bystander_token =
        common::register_third_family_member(&app, &owner_token, "rmorder-bystander@example.com").await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let member_id = user_id_of(&app, &member_token).await;
    let bystander_id = user_id_of(&app, &bystander_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member_sk = IdentitySecretKey::generate();
    let bystander_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;
    publish_keypair(&app, &bystander_token, bystander_sk.public_key().to_bytes()).await;

    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-rmorder-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
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

    let bystander_sealed = seal(&bystander_sk.public_key(), ck.expose()).unwrap();
    let add_bystander_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": bystander_id,
            "sealed_key": serde_json::to_string(&bystander_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_bystander_res.status(), StatusCode::CREATED);

    let mut item_ids = Vec::new();
    let mut encrypted_items = Vec::new();
    for i in 0..2 {
        let item_id = uuid::Uuid::new_v4().to_string();
        let plaintext = format!(r#"{{"type":"login","username":"u{i}"}}"#);
        let encrypted =
            encrypt_item_for_collection(&ck, plaintext.as_bytes(), &collection_id, &item_id, 1).unwrap();
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
        sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
            .bind(&collection_id)
            .bind(&item_id)
            .execute(&pool)
            .await
            .unwrap();
        item_ids.push(item_id);
        encrypted_items.push(encrypted);
    }

    // --- Build the (position-independent) expected values ONCE, in the
    // natural forward order. ---
    let old_ck = unseal_collection_key(&owner_sk, &owner_sealed).unwrap();
    let new_ck = CollectionKey::generate();
    let new_owner_sealed = seal(&owner_sk.public_key(), new_ck.expose()).unwrap();
    let new_bystander_sealed = seal(&bystander_sk.public_key(), new_ck.expose()).unwrap();
    let new_enc_key_1 =
        rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted_items[0].enc_key, &collection_id, &item_ids[0])
            .unwrap();
    let new_enc_key_2 =
        rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted_items[1].enc_key, &collection_id, &item_ids[1])
            .unwrap();

    // --- Submit with `new_sealed_keys`/`item_rewraps` REVERSED from their
    // natural construction order (bystander before owner; item2 before
    // item1). ---
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
                        { "recipient_user_id": bystander_id, "sealed_key": serde_json::to_string(&new_bystander_sealed).unwrap() },
                        { "recipient_user_id": owner_id, "sealed_key": serde_json::to_string(&new_owner_sealed).unwrap() }
                    ],
                    "item_rewraps": [
                        { "item_id": item_ids[1].clone(), "enc_key": serde_json::to_string(&new_enc_key_2).unwrap() },
                        { "item_id": item_ids[0].clone(), "enc_key": serde_json::to_string(&new_enc_key_1).unwrap() }
                    ]
                }
            ]
        })),
    )
    .await;
    assert_eq!(remove_res.status(), StatusCode::NO_CONTENT, "a reversed-order batch must still succeed");

    // --- Assertions: the resulting DB state is IDENTICAL to the values
    // computed once above, independently of submission order. ---
    let owner_sealed_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&owner_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner_sealed_after,
        serde_json::to_string(&new_owner_sealed).unwrap(),
        "owner's sealed_key must match the independently-computed forward-order expectation"
    );

    let bystander_sealed_after: String = sqlx::query_scalar(
        "SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
    )
    .bind(&collection_id)
    .bind(&bystander_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        bystander_sealed_after,
        serde_json::to_string(&new_bystander_sealed).unwrap(),
        "bystander's sealed_key must match the independently-computed forward-order expectation"
    );

    let item1_enc_key_after: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_ids[0]).fetch_one(&pool).await.unwrap();
    assert_eq!(
        item1_enc_key_after,
        serde_json::to_string(&new_enc_key_1).unwrap(),
        "item1's enc_key must match the independently-computed forward-order expectation"
    );

    let item2_enc_key_after: String =
        sqlx::query_scalar("SELECT enc_key FROM vault_items WHERE id = ?").bind(&item_ids[1]).fetch_one(&pool).await.unwrap();
    assert_eq!(
        item2_enc_key_after,
        serde_json::to_string(&new_enc_key_2).unwrap(),
        "item2's enc_key must match the independently-computed forward-order expectation"
    );
}
