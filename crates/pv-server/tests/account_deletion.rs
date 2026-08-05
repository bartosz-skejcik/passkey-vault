//! Integration tests for `DELETE /api/auth/account` — Phase 25's account
//! deletion endpoint (FAM-10). Proves all three internal branches
//! (owner-dissolution / plain-member self-deletion re-key / no-family simple
//! cascade) plus the direct evidence that a deliberately wrong delete order
//! raises a real `SQLITE_CONSTRAINT_FOREIGNKEY` against the live pool — not
//! merely documented as a risk.
//!
//! Every `pv_core::identity::{seal, unseal_collection_key}` /
//! `pv_core::items::{encrypt_item_for_collection, rewrap_item_key_for_collection}`
//! call in this file is the CLIENT-side simulation the plan requires — the
//! server (`crates/pv-server/src/routes/account.rs`) never calls any of them.

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

use common::{register_and_login, register_second_family_member, register_third_family_member, test_app, test_pool};

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

/// Mirrors `tests/family_removal.rs`'s own helper of the same name.
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

async fn user_row_exists(pool: &sqlx::SqlitePool, user_id: &str) -> bool {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap();
    count > 0
}

/// Task 3 (must_haves truths 2 + 5): an owner with 2 other family members
/// deletes their account. The family dissolves in FK-safe order (every
/// `vault_items` row scoped to any of the family's collections is deleted
/// BEFORE `families`, which is deleted BEFORE `users`) — no
/// `SQLITE_CONSTRAINT_FOREIGNKEY`, `families`/`collection_keys` rows gone for
/// every member, every member's OWN personal `vault_items` left untouched
/// (byte-identical `enc_data`), and no re-key is attempted (no surviving
/// collection exists for one).
#[tokio::test]
async fn owner_account_deletion_dissolves_family_and_leaves_members_personal_data_untouched() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "acctdel-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member1_token = register_second_family_member(&app, &owner_token, "acctdel-member1@example.com").await;
    let member2_token = register_third_family_member(&app, &owner_token, "acctdel-member2@example.com").await;
    let owner_id = user_id_of(&app, &owner_token).await;
    let member1_id = user_id_of(&app, &member1_token).await;
    let member2_id = user_id_of(&app, &member2_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let member1_sk = IdentitySecretKey::generate();
    let member2_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member1_token, member1_sk.public_key().to_bytes()).await;
    publish_keypair(&app, &member2_token, member2_sk.public_key().to_bytes()).await;

    // --- Seed: one shared collection, both members as `read` recipients,
    // one real item in it. ---
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-acctdel-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    for (member_id, member_sk) in [(&member1_id, &member1_sk), (&member2_id, &member2_sk)] {
        let member_sealed = seal(&member_sk.public_key(), ck.expose()).unwrap();
        let add_member_res = req(
            &app,
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            &owner_token,
            Some(json!({
                "recipient_user_id": member_id,
                "sealed_key": serde_json::to_string(&member_sealed).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
        assert_eq!(add_member_res.status(), StatusCode::CREATED);
    }

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
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

    // --- Each member's OWN personal item, outside the collection. ---
    let member1_personal_item_id = uuid::Uuid::new_v4().to_string();
    let member1_personal_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &member1_token,
        Some(json!({
            "id": member1_personal_item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"m1-key\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"m1-data\"}",
        })),
    )
    .await;
    assert_eq!(member1_personal_res.status(), StatusCode::CREATED);
    let member1_enc_data_before: String = sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?")
        .bind(&member1_personal_item_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let member2_personal_item_id = uuid::Uuid::new_v4().to_string();
    let member2_personal_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &member2_token,
        Some(json!({
            "id": member2_personal_item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"m2-key\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"m2-data\"}",
        })),
    )
    .await;
    assert_eq!(member2_personal_res.status(), StatusCode::CREATED);
    let member2_enc_data_before: String = sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?")
        .bind(&member2_personal_item_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    // --- The owner deletes their own account. ---
    let delete_res =
        req(&app, "DELETE", "/api/auth/account", &owner_token, Some(json!({ "collections": [] }))).await;
    assert_eq!(delete_res.status(), StatusCode::NO_CONTENT);

    // --- Assertions: family dissolved, no FK violation surfaced (the 204
    // above already proves that — a constraint violation would have
    // propagated as a 500), collection_keys/family_members gone for both
    // members, the shared collection's item gone, each member's OWN personal
    // item byte-identical and their `users` row untouched. ---
    let families_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM families").fetch_one(&pool).await.unwrap();
    assert_eq!(families_count, 0, "the families row must be gone — the family is dissolved, not re-keyed");

    let family_members_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM family_members").fetch_one(&pool).await.unwrap();
    assert_eq!(family_members_count, 0, "every family_members row must be gone (cascaded via families)");

    let collection_keys_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys").fetch_one(&pool).await.unwrap();
    assert_eq!(
        collection_keys_count, 0,
        "every member's collection_keys row must be gone (cascaded via families -> collections)"
    );

    let shared_item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_items WHERE id = ?")
        .bind(&item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(shared_item_count, 0, "the shared collection's item must be gone (deleted explicitly, step 1)");

    assert!(user_row_exists(&pool, &member1_id).await, "member1's own users row must be untouched");
    assert!(user_row_exists(&pool, &member2_id).await, "member2's own users row must be untouched");
    assert!(!user_row_exists(&pool, &owner_id).await, "the owner's own users row must be gone");

    let member1_enc_data_after: String = sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?")
        .bind(&member1_personal_item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        member1_enc_data_after, member1_enc_data_before,
        "member1's own personal vault_items row must be completely untouched — no re-key is attempted for a \
         dissolved family"
    );

    let member2_enc_data_after: String = sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?")
        .bind(&member2_personal_item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        member2_enc_data_after, member2_enc_data_before,
        "member2's own personal vault_items row must be completely untouched — no re-key is attempted for a \
         dissolved family"
    );
}

/// Task 3 (must_haves truth 3): a plain family member deletes their OWN
/// account, submitting a real, client-computed rewrap batch — mirrors Plan
/// 25-03's client-simulation shape exactly, except the ACTING party (the one
/// unsealing the old CollectionKey via their own `sealed_key`) is the member
/// being removed, not the owner. Asserts `apply_member_removal_rekey` was
/// genuinely called: the owner's `sealed_key` and the item's `enc_key`
/// change, `enc_data` stays byte-identical, and the member's own `users` row
/// is gone.
#[tokio::test]
async fn member_self_deletion_rekeys_owned_collections_and_removes_own_data() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "acctdel-selfdel-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token = register_second_family_member(&app, &owner_token, "acctdel-selfdel-member@example.com").await;
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
        Some(json!({ "enc_name": "enc-acctdel-selfdel-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
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
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

    let enc_data_before: String =
        sqlx::query_scalar("SELECT enc_data FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();

    // --- Simulate the client: the MEMBER (the one deleting themselves)
    // unseals their OWN sealed_key to recover the OLD CollectionKey,
    // generates a NEW one, seals it to the owner (the SOLE remaining
    // recipient once the member is gone), and rewraps the item's Cipher Key.
    let old_ck = unseal_collection_key(&member_sk, &member_sealed).unwrap();
    let new_ck = CollectionKey::generate();
    let new_owner_sealed = seal(&owner_sk.public_key(), new_ck.expose()).unwrap();
    let new_enc_key = rewrap_item_key_for_collection(&old_ck, &new_ck, &encrypted.enc_key, &collection_id, &item_id)
        .unwrap();

    let delete_res = req(
        &app,
        "DELETE",
        "/api/auth/account",
        &member_token,
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
    assert_eq!(delete_res.status(), StatusCode::NO_CONTENT);

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
        "the owner's own sealed_key must now equal the newly-sealed blob — apply_member_removal_rekey ran"
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
    assert_eq!(enc_data_after, enc_data_before, "enc_data must be byte-identical before and after self-deletion");

    assert!(!user_row_exists(&pool, &member_id).await, "the deleting member's own users row must be gone");
    let member_collection_keys_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&collection_id)
            .bind(&member_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_collection_keys_count, 0, "the deleting member's own collection_keys row must be gone");

    let family_row_still_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM families").fetch_one(&pool).await.unwrap();
    assert_eq!(family_row_still_exists, 1, "a plain-member self-deletion must NOT dissolve the family");
}

/// Task 3: a solo user with no family deletes their account — the
/// multi-statement FK-ordered path is never invoked for this case, just a
/// simple `DELETE FROM users` cascade.
#[tokio::test]
async fn no_family_account_deletion_is_a_simple_cascade() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let token = register_and_login(&app, "acctdel-solo@example.com").await;
    let user_id = user_id_of(&app, &token).await;

    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"solo-key\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"solo-data\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let delete_res = req(&app, "DELETE", "/api/auth/account", &token, Some(json!({ "collections": [] }))).await;
    assert_eq!(delete_res.status(), StatusCode::NO_CONTENT);

    assert!(!user_row_exists(&pool, &user_id).await, "the solo user's own users row must be gone");
    let item_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM vault_items WHERE id = ?").bind(&item_id).fetch_one(&pool).await.unwrap();
    assert_eq!(item_count, 0, "the solo user's own item must be gone (cascaded via vault_items.user_id)");
}

/// Task 3 (must_haves truth 6 — the phase's direct FK-enforcement proof): a
/// deliberately wrong delete order (`DELETE FROM users` for the owner BEFORE
/// `DELETE FROM families`) against a REAL seeded owner+family+collection+item
/// fixture raises a genuine `SQLITE_CONSTRAINT_FOREIGNKEY` — direct evidence
/// that Plan 25-01's `PRAGMA foreign_keys` assertion is an active,
/// load-bearing constraint `delete_account_as_owner`'s correct ordering
/// depends on, not documentation.
#[tokio::test]
async fn wrong_delete_order_raises_a_real_foreign_key_violation() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "acctdel-wrongorder-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let owner_id = user_id_of(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "enc_name": "enc-acctdel-wrongorder-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

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
    sqlx::query("UPDATE vault_items SET collection_id = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

    // Issue the WRONG order directly against the live pool: delete the
    // referenced users row while `families.owner_user_id` (no `ON DELETE`
    // action, migration 0014) still points to it.
    let result = sqlx::query("DELETE FROM users WHERE id = ?").bind(&owner_id).execute(&pool).await;

    let err = result.expect_err(
        "deleting the owner's users row BEFORE the families row that references it must raise a real FK violation, \
         not silently succeed",
    );
    match &err {
        sqlx::Error::Database(db_err) => {
            assert!(
                db_err.is_foreign_key_violation(),
                "expected a foreign-key constraint violation, got a different database error: {db_err}"
            );
        }
        other => panic!("expected sqlx::Error::Database (foreign-key violation), got: {other:?}"),
    }

    // The fixture itself is untouched by the failed statement — SQLite
    // rejects the individual violating statement, it does not silently
    // commit a partial change.
    assert!(user_row_exists(&pool, &owner_id).await, "the failed DELETE must not have removed the owner's row");
    let families_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM families").fetch_one(&pool).await.unwrap();
    assert_eq!(families_count, 1, "the families row must still exist — the wrong-order delete never reached it");
}

/// Compensating coverage for `GET /api/families` (Phase 25, `families::get`)
/// — registered as an extra method on the pre-existing literal `/api/families`
/// path (see `routes/mod.rs`'s own comment on that registration) rather than
/// as a new `family_routes()` table entry, so `tests/membership_route_sweep.rs`'s
/// automatic non-member-rejection sweep does not exercise it. This test is
/// the hand-written substitute: an unrelated caller gets 404, and a real
/// family member gets the family's own `{id, name, owner_user_id, created_at}`
/// — the read-side mirror of `POST /api/families`'s own response shape.
#[tokio::test]
async fn family_get_rejects_non_member_and_returns_shape_for_a_real_member() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "acctdel-familyget-owner@example.com").await;
    let create_res =
        req(&app, "POST", "/api/families", &owner_token, Some(json!({ "name": "Family GET Coverage" }))).await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let created_body = body_json(create_res).await;
    let owner_id = user_id_of(&app, &owner_token).await;

    let unrelated_token = register_and_login(&app, "acctdel-familyget-unrelated@example.com").await;
    let unrelated_res = req(&app, "GET", "/api/families", &unrelated_token, None).await;
    assert_eq!(unrelated_res.status(), StatusCode::NOT_FOUND, "a non-member must 404 — existence never leaks");

    let owner_get_res = req(&app, "GET", "/api/families", &owner_token, None).await;
    assert_eq!(owner_get_res.status(), StatusCode::OK);
    let owner_get_body = body_json(owner_get_res).await;
    assert_eq!(owner_get_body["id"], created_body["id"], "GET must mirror POST's own response shape");
    assert_eq!(owner_get_body["name"], "Family GET Coverage");
    assert_eq!(owner_get_body["owner_user_id"], owner_id);
    assert!(owner_get_body["created_at"].is_string());
}
