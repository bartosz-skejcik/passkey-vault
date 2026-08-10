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

    // A-1 (WR-09 fix): the client mints the id BEFORE encrypting enc_name,
    // whose AAD is bound to it — the server must echo this EXACT id back,
    // never mint its own.
    let client_minted_id = "94603aa4-edb2-4268-b4da-a3486d6fb03f";
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "id": client_minted_id, "enc_name": "enc-collection-name", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let create_body = body_json(create_res).await;
    let collection_id = create_body["id"].as_str().unwrap().to_string();
    assert_eq!(
        collection_id, client_minted_id,
        "CollectionResponse.id must echo the client-minted id unchanged (WR-09 fix, A-1)"
    );
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
            "id": "7e53ac8a-9e07-4fd0-afee-30635e544687","enc_name": "enc-fanout-collection",
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
            "id": "e23cf69b-99d1-4551-8304-bd1ae6d4030d","enc_name": "enc-norewrite-collection",
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
            "id": "0b53b15d-7c35-4e78-9c9d-cf50310e6fc2","enc_name": "enc-revoke-collection",
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

/// WR-06: revoking the collection's LAST remaining `collection_keys` row must
/// be rejected with `409`, never silently succeed — `create()`'s own doc
/// comment states "a collection never exists with zero key-holders, even for
/// an instant", and a sole key-holder self-revoking (e.g. an accidental
/// "leave" click, no attacker required) would otherwise permanently orphan
/// every item in the collection with no way to recover them.
#[tokio::test]
async fn revoke_access_rejects_emptying_the_last_key_holder() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "lastkey-owner@example.com").await;
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
        Some(json!({
            "id": "9e6ac28f-0475-4de7-8428-e1ade8282e30","enc_name": "enc-lastkey-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    // The owner is the ONLY key-holder — self-revoking must be rejected.
    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_id}/access/{owner_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(
        revoke_res.status(),
        StatusCode::CONFLICT,
        "revoking the collection's last remaining key-holder must be rejected with 409, never silently succeed"
    );

    // The row must still be there — the rejected request left it untouched.
    let count_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
        .bind(&collection_id)
        .bind(&owner_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let count: i64 = count_row.try_get("n").unwrap();
    assert_eq!(count, 1, "a rejected last-key-holder revocation must leave the collection_keys row in place");

    // The owner still has full access — the collection was never orphaned.
    let get_res = req(&app, "GET", &format!("/api/vault/collections/{collection_id}"), &owner_token, None).await;
    assert_eq!(get_res.status(), StatusCode::OK);
}

/// **W1 (iteration 2) regression.** The last-key-holder guard above is
/// correct for a single sequential request, but the ORIGINAL implementation
/// (`COUNT(*)` then a separate `DELETE`, both against `&state.db` with no
/// `tx`) is a non-transactional TOCTOU: two concurrent revokes against a
/// collection with EXACTLY two key-holders can each observe "the other
/// holder is still present" before either `DELETE` commits, and BOTH
/// succeed — orphaning the collection with zero remaining `collection_keys`
/// rows, exactly the state the guard exists to prevent. The fix folds the
/// "at least one other key-holder still exists" check into the `DELETE`'s
/// own `WHERE ... AND EXISTS (...)` clause so a single atomic SQL statement
/// is the enforcement mechanism, not two independently-awaited round trips.
///
/// Mirrors `tests/passkeys.rs::consume_state_is_atomic_under_concurrent_callers`'s
/// shape: `common::test_pool()` is deliberately `max_connections(1)`, which
/// would serialize any race away and prove nothing, so this test builds its
/// own multi-connection shared-cache in-memory pool and uses a `Barrier` to
/// release both concurrent requests at the same instant, repeated across
/// several trials (a single `tokio::join!` pair is not reliably enough to
/// force the interleaving against a microsecond-scale in-memory query).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn revoke_access_last_key_holder_guard_is_atomic_under_concurrency() {
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Arc;
    use tokio::sync::Barrier;

    const TRIALS: usize = 20;
    let mut double_wins = 0usize;

    for i in 0..TRIALS {
        // Unique shared-cache name per trial so trials (and parallel
        // `cargo test` runs of this file) never collide on the same
        // in-memory database.
        let db_name = format!("w1_revoke_race_{}", uuid::Uuid::new_v4().simple());
        let db_url = format!("file:{db_name}?mode=memory&cache=shared");
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            // Shared-cache in-memory DBs are dropped once the last connection
            // to them closes — keep at least one idle connection alive for
            // the pool's lifetime so migrations + both racing calls see the
            // same DB.
            .min_connections(1)
            .connect(&db_url)
            .await
            .expect("connect shared-cache in-memory sqlite pool");
        sqlx::migrate!("./migrations").run(&pool).await.expect("run migrations");

        let app = test_app(pool.clone());

        let owner_token = register_and_login(&app, &format!("w1-race-owner-{i}@example.com")).await;
        create_family(&app, &owner_token).await;
        let member_token = common::register_second_family_member(
            &app,
            &owner_token,
            &format!("w1-race-member-{i}@example.com"),
        )
        .await;
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
            Some(json!({
                "id": "d2e136cd-f2e8-42f0-ad96-5bb2a74f9ed4","enc_name": "enc-w1-race-collection",
                "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
            })),
        )
        .await;
        assert_eq!(create_res.status(), StatusCode::CREATED);
        let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

        let member_sealed = seal(&member_sk.public_key(), ck.expose()).unwrap();
        let add_res = req(
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
        assert_eq!(add_res.status(), StatusCode::CREATED);

        // Exactly two key-holders now (owner, member). Race two DELETEs —
        // A revoking B, B revoking A — released at the same instant.
        let barrier = Arc::new(Barrier::new(2));
        let app_a = app.clone();
        let app_b = app.clone();
        let owner_token_a = owner_token.clone();
        let member_token_b = member_token.clone();
        let collection_id_a = collection_id.clone();
        let collection_id_b = collection_id.clone();
        let member_id_a = member_id.clone();
        let owner_id_b = owner_id.clone();
        let barrier_a = barrier.clone();
        let barrier_b = barrier.clone();

        let task_a = tokio::spawn(async move {
            barrier_a.wait().await;
            req(
                &app_a,
                "DELETE",
                &format!("/api/vault/collections/{collection_id_a}/access/{member_id_a}"),
                &owner_token_a,
                None,
            )
            .await
            .status()
        });
        let task_b = tokio::spawn(async move {
            barrier_b.wait().await;
            req(
                &app_b,
                "DELETE",
                &format!("/api/vault/collections/{collection_id_b}/access/{owner_id_b}"),
                &member_token_b,
                None,
            )
            .await
            .status()
        });

        let (status_a, status_b) = tokio::join!(task_a, task_b);
        let status_a = status_a.expect("task a must not panic");
        let status_b = status_b.expect("task b must not panic");

        let successes =
            usize::from(status_a == StatusCode::NO_CONTENT) + usize::from(status_b == StatusCode::NO_CONTENT);
        assert!(successes >= 1, "trial {i}: at least one concurrent revoke must succeed");
        if successes == 2 {
            double_wins += 1;
        }

        let remaining_row = sqlx::query("SELECT COUNT(*) as n FROM collection_keys WHERE collection_id = ?")
            .bind(&collection_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let remaining: i64 = remaining_row.try_get("n").unwrap();
        assert!(
            remaining >= 1,
            "trial {i}: the collection must never end up with zero key-holders (orphaned) — got {remaining}"
        );
    }

    assert_eq!(
        double_wins, 0,
        "{double_wins}/{TRIALS} trials had BOTH concurrent last-key-holder revokes succeed — the \
         atomic guard (W1, iteration 2) is broken and the collection was orphaned"
    );
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
            "id": "373b03bd-787e-4730-981c-61438f926d89","enc_name": "enc-guard-collection",
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
            "id": "28d4cbd3-d576-4729-8451-81fb2ae6f1fc","enc_name": "enc-malformed-collection",
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
            "id": "11b8da13-8e30-4deb-946b-221c32f2ad9b","enc_name": "enc-vw6269-source-collection",
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
            "id": "1a3f922f-fbfa-47ae-99fa-a10dd7c07077","enc_name": "enc-vw6269-dest-collection",
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
            "id": "d6b0512c-5166-4d71-b40d-511599444ee7","enc_name": "enc-movegate-collection-a",
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
            "id": "55f4b7e2-7b5e-436a-9701-bc330fe3308b","enc_name": "enc-movegate-collection-b",
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

// --- Iteration 2, CR-01: revocation must be absolute — the creator's own
// ownership must never survive a revoked `collection_keys` grant. ---

/// **CR-01 (iteration 2) regression — the SC#4 case.** A member who created
/// an item inside a collection, then had their OWN collection access
/// revoked, must lose PUT/DELETE/move access to that item on the very next
/// request, via the SAME still-valid bearer token — exactly like any other
/// revoked member. Iteration 1's WR-05 fix folded an unconditional creator
/// `Edit` into the collection branch of `Item::resolve_access`, which meant
/// this exact scenario kept granting `Edit` after revocation (the fold could
/// not tell "creator with no collection_keys row" apart from "revoked member
/// with no collection_keys row" — same DB state). This test must FAIL
/// against that iteration-1 code and pass against the iteration-2 fix.
#[tokio::test]
async fn revoked_creator_loses_edit_on_their_own_created_item_next_request() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "cr01-revoke-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let marek_token = common::register_second_family_member(&app, &owner_token, "cr01-revoke-marek@example.com").await;
    let marek_id = user_id_of(&app, &marek_token).await;
    let marek_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &marek_token, marek_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "661c117a-5965-44b1-8f7e-655761a25aec","enc_name": "enc-cr01-revoke-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    // Marek gets `edit` on the collection so he can create+move an item into it.
    let marek_sealed = seal(&marek_sk.public_key(), ck.expose()).unwrap();
    let add_marek_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": marek_id,
            "sealed_key": serde_json::to_string(&marek_sealed).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_marek_res.status(), StatusCode::CREATED);

    // Marek creates a personal item, then moves it into the shared collection
    // — he is the item's `user_id` (creator) from here on.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &marek_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let move_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &marek_token,
        Some(json!({
            "new_collection_id": collection_id,
            "enc_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"key-blob-scoped\"}",
            "enc_data": "{\"nonce\":\"DDDD\",\"ciphertext\":\"data-blob-scoped\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(move_res.status(), StatusCode::OK, "marek moving his own item into the shared collection must succeed");

    // CR-01 (iteration 3) sanity, BEFORE the revoke: the item must actually
    // be visible via both read paths first — otherwise the "absent after
    // revoke" assertions below would pass vacuously (the item was never
    // there to begin with).
    let list_before_revoke_res = req(&app, "GET", "/api/vault/items", &marek_token, None).await;
    assert_eq!(list_before_revoke_res.status(), StatusCode::OK);
    let list_before_revoke_body = body_json(list_before_revoke_res).await;
    assert!(
        list_before_revoke_body.as_array().unwrap().iter().any(|it| it["id"] == item_id),
        "CR-01 sanity: before revocation, GET /api/vault/items must still list the item Marek created"
    );
    let sync_before_revoke_res = req(&app, "GET", "/api/sync?since=0", &marek_token, None).await;
    assert_eq!(sync_before_revoke_res.status(), StatusCode::OK);
    let sync_before_revoke_body = body_json(sync_before_revoke_res).await;
    assert!(
        sync_before_revoke_body["items"].as_array().unwrap().iter().any(|it| it["id"] == item_id),
        "CR-01 sanity: before revocation, GET /api/sync must still list the item Marek created"
    );

    // The owner revokes MAREK's own access — he created the item, and this
    // must strip him of it exactly as it would for any other member.
    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_id}/access/{marek_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    // CR-01 (iteration 3): revocation must also be enforced on the READ
    // path, via the SAME still-valid bearer token — Marek held the
    // collection's CollectionKey while he was a member and the server does
    // not re-key on revocation (no re-key path in this phase), so
    // continuing to serve fresh ciphertext through GET /api/vault/items or
    // GET /api/sync would be a genuine confidentiality failure, not merely a
    // cosmetic listing bug. This must FAIL against the pre-fix
    // `WHERE user_id = ?` query (the item is still present) and pass once
    // `fetch_items_for` is brought in line with `Item::resolve_access`.
    let list_after_revoke_res = req(&app, "GET", "/api/vault/items", &marek_token, None).await;
    assert_eq!(list_after_revoke_res.status(), StatusCode::OK);
    let list_after_revoke_body = body_json(list_after_revoke_res).await;
    assert!(
        !list_after_revoke_body.as_array().unwrap().iter().any(|it| it["id"] == item_id),
        "CR-01: after revocation, GET /api/vault/items must no longer return the item Marek created — \
         he held the CollectionKey and the server keeps handing him fresh ciphertext otherwise"
    );
    let sync_after_revoke_res = req(&app, "GET", "/api/sync?since=0", &marek_token, None).await;
    assert_eq!(sync_after_revoke_res.status(), StatusCode::OK);
    let sync_after_revoke_body = body_json(sync_after_revoke_res).await;
    assert!(
        !sync_after_revoke_body["items"].as_array().unwrap().iter().any(|it| it["id"] == item_id),
        "CR-01: after revocation, GET /api/sync must no longer return the item Marek created either"
    );

    // Reuse Marek's ORIGINAL still-valid bearer token — no re-login — for
    // every mutating verb on the item HE HIMSELF created. All three must be
    // 404: he provably has NO access left, not merely insufficient access.
    let put_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}"),
        &marek_token,
        Some(json!({
            "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"attempted-update-key\"}",
            "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"attempted-update-data\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        put_res.status(),
        StatusCode::NOT_FOUND,
        "SC#4: a revoked creator must not be able to PUT the item they created — revocation must be absolute"
    );

    let move_out_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &marek_token,
        Some(json!({
            "new_collection_id": Value::Null,
            "enc_key": "{\"nonce\":\"GGGG\",\"ciphertext\":\"attempted-move-out-key\"}",
            "enc_data": "{\"nonce\":\"HHHH\",\"ciphertext\":\"attempted-move-out-data\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        move_out_res.status(),
        StatusCode::NOT_FOUND,
        "SC#4: a revoked creator must not be able to move their own item back to personal scope"
    );

    let delete_res = req(&app, "DELETE", &format!("/api/vault/items/{item_id}"), &marek_token, None).await;
    assert_eq!(
        delete_res.status(),
        StatusCode::NOT_FOUND,
        "SC#4: a revoked creator must not be able to DELETE the item they created"
    );

    // Sanity: the item survives untouched (still in the collection, at
    // revision 2, none of the rejected requests mutated it), and the owner
    // (still a key-holder) retains full access to it.
    let row = sqlx::query("SELECT collection_id, revision FROM vault_items WHERE id = ?")
        .bind(&item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let stored_collection_id: Option<String> = row.try_get("collection_id").unwrap();
    let stored_revision: i64 = row.try_get("revision").unwrap();
    assert_eq!(stored_collection_id.as_deref(), Some(collection_id.as_str()));
    assert_eq!(stored_revision, 2);

    let owner_delete_check_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}"),
        &owner_token,
        Some(json!({
            "enc_key": "{\"nonce\":\"IIII\",\"ciphertext\":\"owner-update-key\"}",
            "enc_data": "{\"nonce\":\"JJJJ\",\"ciphertext\":\"owner-update-data\"}",
            "expected_revision": 2,
        })),
    )
    .await;
    assert_eq!(
        owner_delete_check_res.status(),
        StatusCode::OK,
        "the remaining key-holder (owner) must retain full access to the item"
    );
}

/// **CR-01 (iteration 2) regression — the SHARE-04 / Vaultwarden #6269
/// case, replayed with the hidden_password holder as the item's CREATOR.**
/// The original `hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression`
/// test above always has the OWNER create the item, so the hidden_password
/// member is never its creator — iteration 1's WR-05 fold would have let a
/// creator-turned-hidden_password-holder bypass this exact gate via their
/// ownership grant. This test forces that path: hp_member creates the item
/// (while holding `edit`), is then downgraded to `hidden_password` on the
/// same collection, and must still be rejected when attempting to reassign
/// the item they themselves created.
#[tokio::test]
async fn hidden_password_creator_cannot_reassign_own_item_vaultwarden_6269_regression() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "cr01-hp-creator-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let hp_member_token =
        common::register_second_family_member(&app, &owner_token, "cr01-hp-creator-member@example.com").await;
    let hp_member_id = user_id_of(&app, &hp_member_token).await;
    let hp_member_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &hp_member_token, hp_member_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();

    // SOURCE collection: owner (creator, edit) + hp_member starts at `edit`
    // (so hp_member can actually create+move the item into it).
    let source_ck = CollectionKey::generate();
    let owner_sealed_source = seal(&owner_sk.public_key(), source_ck.expose()).unwrap();
    let create_source_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "7d0cf564-a102-4807-83b5-f04ffc3ed69c","enc_name": "enc-cr01-hp-creator-source-collection",
            "sealed_key": serde_json::to_string(&owner_sealed_source).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_source_res.status(), StatusCode::CREATED);
    let source_collection_id = body_json(create_source_res).await["id"].as_str().unwrap().to_string();

    let hp_member_sealed_edit = seal(&hp_member_sk.public_key(), source_ck.expose()).unwrap();
    let add_hp_member_edit_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{source_collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": hp_member_id,
            "sealed_key": serde_json::to_string(&hp_member_sealed_edit).unwrap(),
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(add_hp_member_edit_res.status(), StatusCode::CREATED);

    // A SEPARATE destination collection the hp_member has no relationship to
    // at all — irrelevant, since the SOURCE check must reject first.
    let dest_ck = CollectionKey::generate();
    let owner_sealed_dest = seal(&owner_sk.public_key(), dest_ck.expose()).unwrap();
    let create_dest_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "941c68c1-6a7e-4dee-a389-8694bf4b3225","enc_name": "enc-cr01-hp-creator-dest-collection",
            "sealed_key": serde_json::to_string(&owner_sealed_dest).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_dest_res.status(), StatusCode::CREATED);
    let dest_collection_id = body_json(create_dest_res).await["id"].as_str().unwrap().to_string();

    // hp_member (NOT the owner) creates the item and moves it into the
    // source collection while still at `edit` — hp_member is now the item's
    // `user_id` (creator).
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &hp_member_token,
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
        &hp_member_token,
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
        "hp_member (edit on the source collection) moving their own personal item into it must succeed"
    );

    // Owner downgrades hp_member: revoke the `edit` grant, re-add at
    // `hidden_password` — the exact revoke+re-add sequence both endpoints
    // this phase ships already support.
    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{source_collection_id}/access/{hp_member_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    let hp_member_sealed_hp = seal(&hp_member_sk.public_key(), source_ck.expose()).unwrap();
    let add_hp_member_hp_res = req(
        &app,
        "POST",
        &format!("/api/vault/collections/{source_collection_id}/members"),
        &owner_token,
        Some(json!({
            "recipient_user_id": hp_member_id,
            "sealed_key": serde_json::to_string(&hp_member_sealed_hp).unwrap(),
            "access_level": "hidden_password",
        })),
    )
    .await;
    assert_eq!(add_hp_member_hp_res.status(), StatusCode::CREATED);

    // THE REGRESSION: hp_member — hidden_password on the item's CURRENT
    // collection, AND the item's own creator — attempts to reassign it.
    // Must be rejected 403 (they provably have SOME access — hidden_password
    // — so this is the insufficient-level case, never the no-access 404
    // case). Iteration 1's WR-05 fold would have let ownership grant `Edit`
    // here regardless of the hidden_password downgrade.
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
        "a hidden_password holder must never reassign an item, even one they created themselves — Vaultwarden #6269"
    );

    // Sanity: the item is untouched, still in the source collection.
    let row = sqlx::query("SELECT collection_id, revision FROM vault_items WHERE id = ?")
        .bind(&item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let stored_collection_id: Option<String> = row.try_get("collection_id").unwrap();
    let stored_revision: i64 = row.try_get("revision").unwrap();
    assert_eq!(stored_collection_id.as_deref(), Some(source_collection_id.as_str()));
    assert_eq!(stored_revision, 2);
}

// --- CR-02 (iteration 3): an `edit` item-share recipient must not be able
// to re-scope the OWNER's personal item into a collection the recipient
// controls — that would strand the owner with a 404 on every verb and no
// recovery path anywhere in the API. ---

/// **CR-02 (iteration 3) regression.** Removing the iteration-1 ownership
/// fold from `Item::resolve_access`'s collection branch (CR-01, iteration 2)
/// was correct and necessary for revocation to be absolute — but it also
/// means a personal item's owner resolves `None` on their own item the
/// moment someone else moves it into a collection the owner holds no grant
/// on. An `edit` item-share recipient must never be able to trigger that:
/// `access_level: "edit"` on a share means "may modify this item's
/// contents", not "may re-scope, delegate, or destroy it". This test must
/// FAIL against code that lacks the CR-02 ownership gate (the move would
/// succeed with `200`, permanently locking Anna out of her own item) and
/// pass once `move_item` rejects a non-owner re-scoping a personal item.
#[tokio::test]
async fn edit_item_share_recipient_cannot_move_owners_personal_item_cr02_regression() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let anna_token = register_and_login(&app, "cr02-anna@example.com").await;
    create_family(&app, &anna_token).await;
    let r_token = common::register_second_family_member(&app, &anna_token, "cr02-r@example.com").await;
    let r_id = user_id_of(&app, &r_token).await;
    let r_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &r_token, r_sk.public_key().to_bytes()).await;

    // Anna creates a personal item and shares it with R at `edit`.
    let item_id = uuid::Uuid::new_v4().to_string();
    let create_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &anna_token,
        Some(json!({
            "id": item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(create_item_res.status(), StatusCode::CREATED);

    let create_share_res = req(
        &app,
        "POST",
        &format!("/api/vault/items/{item_id}/shares"),
        &anna_token,
        Some(json!({
            "recipient_user_id": r_id,
            "sealed_key": "{\"nonce\":\"CCCC\",\"ciphertext\":\"sealed-item-key\"}",
            "access_level": "edit",
        })),
    )
    .await;
    assert_eq!(create_share_res.status(), StatusCode::CREATED);

    // R creates their OWN collection — `collections::create` hard-codes the
    // creator to `edit`, so R fully controls it.
    let ck = CollectionKey::generate();
    let r_sealed = seal(&r_sk.public_key(), ck.expose()).unwrap();
    let create_collection_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &r_token,
        Some(json!({
            "id": "8b570cfe-72be-4498-8cfa-ce2e31c3e62d","enc_name": "enc-cr02-r-collection",
            "sealed_key": serde_json::to_string(&r_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_collection_res.status(), StatusCode::CREATED);
    let r_collection_id = body_json(create_collection_res).await["id"].as_str().unwrap().to_string();

    // THE REGRESSION: R attempts to move Anna's personal item into R's own
    // collection. Must be rejected 403 — R provably has SOME access (the
    // `edit` item share), so this is the insufficient-scope case, never the
    // no-access-at-all 404 case.
    let move_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}/collection"),
        &r_token,
        Some(json!({
            "new_collection_id": r_collection_id,
            "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"attempted-steal-key\"}",
            "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"attempted-steal-data\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(
        move_res.status(),
        StatusCode::FORBIDDEN,
        "CR-02: an `edit` item-share recipient must never be able to re-scope the owner's personal item — \
         `edit` grants content modification, never delegation/re-scoping/destruction"
    );

    // Sanity: the item is untouched — still personal, still at revision 1.
    let row = sqlx::query("SELECT collection_id, revision FROM vault_items WHERE id = ?")
        .bind(&item_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    let stored_collection_id: Option<String> = row.try_get("collection_id").unwrap();
    let stored_revision: i64 = row.try_get("revision").unwrap();
    assert_eq!(stored_collection_id, None);
    assert_eq!(stored_revision, 1);

    // Proving nothing was stranded: Anna, the owner, can still PUT her own
    // item after R's rejected attempt.
    let anna_update_res = req(
        &app,
        "PUT",
        &format!("/api/vault/items/{item_id}"),
        &anna_token,
        Some(json!({
            "enc_key": "{\"nonce\":\"GGGG\",\"ciphertext\":\"anna-update-key\"}",
            "enc_data": "{\"nonce\":\"HHHH\",\"ciphertext\":\"anna-update-data\"}",
            "expected_revision": 1,
        })),
    )
    .await;
    assert_eq!(
        anna_update_res.status(),
        StatusCode::OK,
        "the owner must retain full access to her own item after the rejected re-scope attempt — nothing stranded"
    );
}

// --- Plan 23-03, Task 2 (SYNC-05): membership-change events + SC2 live add/remove test ---

/// Same reserved-character percent-encoding as `tests/sync.rs::url_encode_token`
/// — duplicated here since no shared non-`common` test helper module exists
/// (23-PATTERNS.md).
fn url_encode_token(token: &str) -> String {
    token.replace('+', "%2B").replace('/', "%2F").replace('=', "%3D")
}

/// Live proof of SYNC-05's add/remove membership fan-out (SC 2): B's
/// already-open WS receives an `EntityType::Collection` frame both right
/// after being added to the collection AND after the owner's next item
/// mutation inside it; after B is removed via `revoke_access`, a further
/// owner mutation produces ZERO frames on B's STILL-OPEN socket within
/// 500ms — mirroring `tests/sync.rs::ws_cross_user_isolation`'s
/// timeout-based negative assertion. Proves both `add_member` and
/// `revoke_access` emit correctly-scoped `Collection` events to a real
/// bound socket, not a mocked hub, and that membership resolution is fresh
/// at emit time end-to-end (never cached).
#[tokio::test]
async fn membership_change_events_add_then_remove_live() {
    use futures_util::StreamExt;

    let pool = test_pool().await;
    let (app, port) = common::test_server(pool).await;

    let owner_token = register_and_login(&app, "memberevents-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token =
        common::register_second_family_member(&app, &owner_token, "memberevents-member@example.com").await;
    let member_id = user_id_of(&app, &member_token).await;
    let member_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "b5a78912-b985-4f36-9564-f59520eae771","enc_name": "enc-memberevents-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    // Owner creates a personal item, then moves it into the collection —
    // this is the target of the "owner's next item mutation" below.
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

    // B's WS connects BEFORE being added — "already-open" per this test's
    // own name/spec.
    let url_member = format!("ws://127.0.0.1:{port}/api/sync/ws?token={}", url_encode_token(&member_token));
    let (mut ws_member, _) =
        tokio_tungstenite::connect_async(&url_member).await.expect("member's token upgrades the socket");

    // Owner adds B to the collection — add_member's OWN emitted event
    // (Task 2) reaches B because the recipient set is queried FRESH after
    // the INSERT, naturally including the just-added member.
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

    let add_frame = tokio::time::timeout(std::time::Duration::from_secs(2), ws_member.next())
        .await
        .expect("a Collection frame must arrive within 2s after B is added")
        .expect("stream must not end")
        .expect("frame must not be a protocol error");
    let add_text = match add_frame {
        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
        other => panic!("expected a Text frame, got {other:?}"),
    };
    let add_parsed: Value = serde_json::from_str(&add_text).expect("frame must be valid JSON");
    assert_eq!(add_parsed["entity_type"], "collection");
    assert_eq!(add_parsed["id"], collection_id);

    // The owner's NEXT item mutation inside the collection (an update on the
    // already-collection-scoped item) fans out to B too — B is now a
    // current recipient via collection_keys.
    let owner_update_body = json!({
        "enc_key": "{\"nonce\":\"EEEE\",\"ciphertext\":\"owner-edit-key\"}",
        "enc_data": "{\"nonce\":\"FFFF\",\"ciphertext\":\"owner-edit-data\"}",
        "expected_revision": 2,
    });
    let owner_update_res =
        req(&app, "PUT", &format!("/api/vault/items/{item_id}"), &owner_token, Some(owner_update_body)).await;
    assert_eq!(owner_update_res.status(), StatusCode::OK);

    let mutation_frame = tokio::time::timeout(std::time::Duration::from_secs(2), ws_member.next())
        .await
        .expect("a Collection frame must arrive within 2s after the owner's next item mutation")
        .expect("stream must not end")
        .expect("frame must not be a protocol error");
    let mutation_text = match mutation_frame {
        tokio_tungstenite::tungstenite::Message::Text(text) => text.to_string(),
        other => panic!("expected a Text frame, got {other:?}"),
    };
    let mutation_parsed: Value = serde_json::from_str(&mutation_text).expect("frame must be valid JSON");
    assert_eq!(mutation_parsed["entity_type"], "collection");
    assert_eq!(mutation_parsed["id"], collection_id);

    // Owner revokes B's access — revoke_access's OWN emitted event queries
    // recipients AFTER the DELETE, so B (just removed) is structurally
    // absent and never learns of their own removal through this channel
    // (T-23-10's mitigation).
    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_id}/access/{member_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    // A FURTHER owner mutation, after B's removal, produces ZERO frames on
    // B's still-open socket — mirroring `ws_cross_user_isolation`'s
    // timeout-based negative assertion.
    let owner_update_body_2 = json!({
        "enc_key": "{\"nonce\":\"1111\",\"ciphertext\":\"owner-edit-key-2\"}",
        "enc_data": "{\"nonce\":\"2222\",\"ciphertext\":\"owner-edit-data-2\"}",
        "expected_revision": 3,
    });
    let owner_update_res_2 =
        req(&app, "PUT", &format!("/api/vault/items/{item_id}"), &owner_token, Some(owner_update_body_2)).await;
    assert_eq!(owner_update_res_2.status(), StatusCode::OK);

    let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_member.next()).await;
    assert!(
        result.is_err(),
        "a just-removed collection member's socket must receive ZERO frames from a mutation after their removal"
    );
}

/// Phase 25, Plan 25-03 Task 3 (WR-07 closure): `revoke_access` must bump
/// the REVOKED recipient's own `vault_revision` in the SAME transaction as
/// the DELETE, so their next `GET /api/sync` (polled at their own
/// last-known revision) detects the change and returns a FRESH snapshot —
/// not the cheap `{revision}`-only up-to-date shape — proving the
/// local-prune path is genuinely reachable, not merely that a counter
/// incremented somewhere unobserved.
#[tokio::test]
async fn revoke_access_bumps_revoked_recipients_own_vault_revision_and_they_see_a_fresh_sync() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "wr07-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let member_token = common::register_second_family_member(&app, &owner_token, "wr07-member@example.com").await;
    let member_id = user_id_of(&app, &member_token).await;
    let member_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &member_token, member_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "id": "382a3acb-b071-4b5d-8690-379fef142bca", "enc_name": "enc-wr07-collection", "sealed_key": serde_json::to_string(&owner_sealed).unwrap() })),
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
            "access_level": "read",
        })),
    )
    .await;
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    // The member establishes a baseline revision via a real GET /api/sync
    // pull — a genuine "already synced once" client, not an assumed 0.
    let baseline_res = req(&app, "GET", "/api/sync?since=0", &member_token, None).await;
    assert_eq!(baseline_res.status(), StatusCode::OK);
    let baseline_body = body_json(baseline_res).await;
    let baseline_revision = baseline_body["revision"].as_i64().unwrap();

    // A SECOND poll at the SAME baseline (nothing has changed yet) must be
    // the cheap up-to-date shape — no "items"/"folders" keys — establishing
    // the pre-revoke control this test's post-revoke assertion contrasts
    // against.
    let still_up_to_date_res =
        req(&app, "GET", &format!("/api/sync?since={baseline_revision}"), &member_token, None).await;
    assert_eq!(still_up_to_date_res.status(), StatusCode::OK);
    let still_up_to_date_body = body_json(still_up_to_date_res).await;
    assert!(
        still_up_to_date_body.get("items").is_none(),
        "a repeated poll at the same baseline, before any revoke, must stay the cheap up-to-date shape"
    );

    let revoke_res = req(
        &app,
        "DELETE",
        &format!("/api/vault/collections/{collection_id}/access/{member_id}"),
        &owner_token,
        None,
    )
    .await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    // The revoked member polls AGAIN, at their own SAME baseline revision
    // (still the same, still-valid bearer token — no re-login) — this must
    // now be a FRESH snapshot (carries "items"/"folders"), not the cheap
    // up-to-date shape, proving their next poll actually detects the change.
    let after_revoke_res =
        req(&app, "GET", &format!("/api/sync?since={baseline_revision}"), &member_token, None).await;
    assert_eq!(after_revoke_res.status(), StatusCode::OK);
    let after_revoke_body = body_json(after_revoke_res).await;
    assert!(
        after_revoke_body.get("items").is_some(),
        "the revoked recipient's next sync at their own last-known revision must be a FRESH snapshot, not up-to-date"
    );
    let after_revoke_revision = after_revoke_body["revision"].as_i64().unwrap();
    assert_eq!(
        after_revoke_revision - baseline_revision,
        1,
        "the revoked recipient's own vault_revision must have advanced by exactly 1"
    );

    let member_vault_revision_row: i64 = sqlx::query_scalar("SELECT vault_revision FROM users WHERE id = ?")
        .bind(&member_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        member_vault_revision_row, after_revoke_revision,
        "the DB-stored vault_revision must match the value the sync response itself reported"
    );
}

/// Task 1 (A-1 fix, 26-CONTEXT.md): `id` is rejected BEFORE any DB work when
/// it does not shape-validate as UUID-v4 — mirrors `invitations.rs`'s own
/// fail-closed-before-DB-work discipline. Covers wrong length, non-hex
/// characters, and missing hyphens; each must be a clean 400, and a
/// follow-up `COUNT(*)` proves no `collections` row was ever written for a
/// rejected id.
#[tokio::test]
async fn create_collection_rejects_malformed_id_before_any_db_work() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "malformed-id-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed_key_json = serde_json::to_string(&seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();

    let bad_ids = [
        "too-short",
        // 36 chars, but no hyphens at all — every char here is a valid hex
        // digit read as one long run, so this specifically exercises the
        // hyphen-position check, not just length.
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        // Correct length AND correct hyphen positions, but a non-hex 'z'
        // character — exercises the per-byte hex check independently of
        // shape.
        "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
        // One character short of a real UUID-v4, hyphens shifted by one.
        "c138f38b-37e1-47d0-830a-12666cd34c9",
    ];

    for bad_id in bad_ids {
        let res = req(
            &app,
            "POST",
            "/api/vault/collections",
            &owner_token,
            Some(json!({ "id": bad_id, "enc_name": "enc-malformed-id", "sealed_key": sealed_key_json })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "malformed id {bad_id:?} must be rejected with 400");
    }

    let count_row: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collections").fetch_one(&pool).await.unwrap();
    assert_eq!(count_row, 0, "no collections row may ever be written for a shape-rejected id");
}

/// Task 1 (A-1 fix): submitting the SAME client-minted id twice returns 409
/// Conflict on the second call — proves the `ON CONFLICT ... DO NOTHING
/// RETURNING` + `fetch_optional` idiom is wired, never a raw
/// `?`-propagated `sqlx::Error` falling through to a blanket 500.
#[tokio::test]
async fn create_collection_duplicate_id_returns_409_not_500() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "dup-id-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed_key_json = serde_json::to_string(&seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();
    let dup_id = "5a2f0e4c-6f2a-4a3a-8b8a-6a1f2e3d4c5b";

    let first_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "id": dup_id, "enc_name": "enc-first", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(first_res.status(), StatusCode::CREATED);

    let second_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "id": dup_id, "enc_name": "enc-second", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(
        second_res.status(),
        StatusCode::CONFLICT,
        "a colliding client-minted id must be a clean 409, never an opaque 500"
    );
    let second_body = body_json(second_res).await;
    assert!(
        second_body.get("error").is_some(),
        "the 409 body must carry the standard {{\"error\": ...}} shape, not an empty/panic-shaped body"
    );

    // Only ONE collections row exists for this id — the second, rejected
    // INSERT must never have overwritten or duplicated the first.
    let count_row: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collections WHERE id = ?")
        .bind(dup_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_row, 1, "a collision must never produce a second row nor silently overwrite the first");

    // The original enc_name (from the FIRST, successful create) survived
    // untouched — the rejected second INSERT's DO NOTHING never overwrote it.
    let enc_name_row: String = sqlx::query_scalar("SELECT enc_name FROM collections WHERE id = ?")
        .bind(dup_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(enc_name_row, "enc-first", "a collision must never overwrite the original row's enc_name");
}

/// Task 1 (`collection_id` wire field): `GET /api/vault/items` (both UNION
/// arms of `fetch_items_for`) returns `collection_id` — `null` for a
/// personal item, the real collection id for a collection-scoped one. This
/// is what lets the client dispatch to the correct decryption key instead of
/// unconditionally guessing User Key (26-CONTEXT.md's A-1 companion fix).
#[tokio::test]
async fn list_items_returns_collection_id_null_for_personal_real_id_for_collection_scoped() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "collid-owner@example.com").await;
    create_family(&app, &owner_token).await;
    let owner_id = user_id_of(&app, &owner_token).await;

    // A personal item — never touches a collection.
    let personal_item_id = uuid::Uuid::new_v4().to_string();
    let personal_item_res = req(
        &app,
        "POST",
        "/api/vault/items",
        &owner_token,
        Some(json!({
            "id": personal_item_id,
            "enc_key": "{\"nonce\":\"AAAA\",\"ciphertext\":\"key-blob\"}",
            "enc_data": "{\"nonce\":\"BBBB\",\"ciphertext\":\"data-blob\"}",
        })),
    )
    .await;
    assert_eq!(personal_item_res.status(), StatusCode::CREATED);

    // A collection, and an item seeded directly into it (mirrors
    // `vault.rs::fetch_items_for_is_shared`'s own seeding pattern — this
    // handler's `Membership<Collection, RequireRead>` extractor is what
    // authorizes the collection-scoped arm, not the seeding mechanism).
    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed_key_json = serde_json::to_string(&seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();
    let create_coll_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "d3f1c2b4-5e6a-4b7c-8d9e-0f1a2b3c4d5e",
            "enc_name": "enc-collid-collection",
            "sealed_key": sealed_key_json,
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
    .expect("seed collection-scoped vault_items row");

    let list_res = req(&app, "GET", "/api/vault/items", &owner_token, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_body = body_json(list_res).await;
    let items = list_body.as_array().unwrap();

    let personal_item = items.iter().find(|i| i["id"] == personal_item_id).unwrap();
    assert_eq!(
        personal_item["collection_id"],
        Value::Null,
        "a personal item's collection_id must be null, never omitted or a stray string"
    );

    let coll_item = items.iter().find(|i| i["id"] == coll_item_id).unwrap();
    assert_eq!(
        coll_item["collection_id"].as_str(),
        Some(collection_id.as_str()),
        "a collection-scoped item's collection_id must be the real owning collection's id"
    );
}

// --- suspended flag on GET /api/vault/collections/{id}/access (Plan 26-04,
// Task 1 — extends this endpoint's existing test suite rather than
// replacing it; mirrors vault.rs's item-scoped sibling test) ---

/// An active co-recipient reports `suspended: false`; a co-recipient whose
/// `family_members` row is suspended still appears in the listing (per A-7,
/// `access_list` never filtered even before this field existed) but now
/// reports `suspended: true`.
#[tokio::test]
async fn access_list_flags_suspended_co_recipient_without_filtering() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "access-suspend-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let active_token =
        common::register_second_family_member(&app, &owner_token, "access-suspend-active@example.com").await;
    let active_id = user_id_of(&app, &active_token).await;
    let active_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &active_token, active_sk.public_key().to_bytes()).await;

    let suspended_token =
        common::register_second_family_member(&app, &owner_token, "access-suspend-target@example.com").await;
    let suspended_id = user_id_of(&app, &suspended_token).await;
    let suspended_sk = IdentitySecretKey::generate();
    publish_keypair(&app, &suspended_token, suspended_sk.public_key().to_bytes()).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let owner_sealed = seal(&owner_sk.public_key(), ck.expose()).unwrap();
    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": "3f6f6b0e-7a4e-4b2a-9b7b-6a1e1c7a9f10",
            "enc_name": "enc-access-suspend-collection",
            "sealed_key": serde_json::to_string(&owner_sealed).unwrap(),
        })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let collection_id = body_json(create_res).await["id"].as_str().unwrap().to_string();

    for (recipient_id, sk) in [(&active_id, &active_sk), (&suspended_id, &suspended_sk)] {
        let sealed = seal(&sk.public_key(), ck.expose()).unwrap();
        let add_member_res = req(
            &app,
            "POST",
            &format!("/api/vault/collections/{collection_id}/members"),
            &owner_token,
            Some(json!({
                "recipient_user_id": recipient_id,
                "sealed_key": serde_json::to_string(&sealed).unwrap(),
                "access_level": "read",
            })),
        )
        .await;
        assert_eq!(add_member_res.status(), StatusCode::CREATED);
    }

    let suspend_res =
        req(&app, "POST", &format!("/api/families/members/{suspended_id}/suspend"), &owner_token, None).await;
    assert_eq!(suspend_res.status(), StatusCode::NO_CONTENT);

    let access_res = req(&app, "GET", &format!("/api/vault/collections/{collection_id}/access"), &owner_token, None).await;
    assert_eq!(access_res.status(), StatusCode::OK);
    let entries = body_json(access_res).await;
    let entries = entries.as_array().unwrap();
    assert_eq!(
        entries.len(),
        3,
        "the owner's own collection_keys row plus both co-recipients — a suspended co-recipient's row must still be listed, per A-7"
    );

    let active_entry = entries.iter().find(|e| e["user_id"] == active_id).expect("active co-recipient must be present");
    assert_eq!(active_entry["suspended"], false);

    let suspended_entry =
        entries.iter().find(|e| e["user_id"] == suspended_id).expect("suspended co-recipient must still be present");
    assert_eq!(suspended_entry["suspended"], true);
}

// --- Phase 30 Plan 02 (FSH-01): family_wide_kind on collection create/get/list ---

/// A collection created with NO `family_wide_kind` field at all in the
/// request body behaves identically to every existing fixture in this file —
/// `create`/`get`/`list` all echo `family_wide_kind: null`.
#[tokio::test]
async fn family_wide_kind_absent_defaults_to_null_and_round_trips_as_null() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "fwk-absent-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed_key_json = serde_json::to_string(&seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();
    let id = "aaaaaaaa-1111-4111-8111-111111111111";

    let create_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "id": id, "enc_name": "enc-ordinary", "sealed_key": sealed_key_json })),
    )
    .await;
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let create_body = body_json(create_res).await;
    assert_eq!(create_body["family_wide_kind"], Value::Null, "absent field must default to null on create");

    let get_res = req(&app, "GET", &format!("/api/vault/collections/{id}"), &owner_token, None).await;
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_body = body_json(get_res).await;
    assert_eq!(get_body["family_wide_kind"], Value::Null, "GET must echo null for an ordinary collection");

    let list_res = req(&app, "GET", "/api/vault/collections", &owner_token, None).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let list_body = body_json(list_res).await;
    let entry = list_body.as_array().unwrap().iter().find(|c| c["id"] == id).expect("collection must be listed");
    assert_eq!(entry["family_wide_kind"], Value::Null, "LIST must echo null for an ordinary collection");
}

/// Creating a collection with `family_wide_kind: "folder"` or
/// `"item_bucket"` succeeds and the value round-trips through both existing
/// read paths (`GET .../{id}` and `GET /api/vault/collections`) with zero new
/// round trips.
#[tokio::test]
async fn family_wide_kind_folder_and_item_bucket_round_trip_through_get_and_list() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "fwk-roundtrip-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed_key_json = serde_json::to_string(&seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();

    for (id, kind) in [
        ("bbbbbbbb-2222-4222-8222-222222222222", "folder"),
        ("cccccccc-3333-4333-8333-333333333333", "item_bucket"),
    ] {
        let create_res = req(
            &app,
            "POST",
            "/api/vault/collections",
            &owner_token,
            Some(json!({ "id": id, "enc_name": "enc-fw", "sealed_key": sealed_key_json, "family_wide_kind": kind })),
        )
        .await;
        assert_eq!(create_res.status(), StatusCode::CREATED, "creating a {kind}-kind collection must succeed");
        let create_body = body_json(create_res).await;
        assert_eq!(create_body["family_wide_kind"].as_str(), Some(kind));

        let get_res = req(&app, "GET", &format!("/api/vault/collections/{id}"), &owner_token, None).await;
        assert_eq!(get_res.status(), StatusCode::OK);
        let get_body = body_json(get_res).await;
        assert_eq!(get_body["family_wide_kind"].as_str(), Some(kind), "GET must echo the stored {kind}");

        let list_res = req(&app, "GET", "/api/vault/collections", &owner_token, None).await;
        assert_eq!(list_res.status(), StatusCode::OK);
        let list_body = body_json(list_res).await;
        let entry = list_body.as_array().unwrap().iter().find(|c| c["id"] == id).expect("collection must be listed");
        assert_eq!(entry["family_wide_kind"].as_str(), Some(kind), "LIST must echo the stored {kind}");
    }
}

/// `family_wide_kind: "nonsense"` is rejected with 400 BEFORE any DB work —
/// no row is written for the rejected call.
#[tokio::test]
async fn family_wide_kind_rejects_invalid_value_before_any_db_work() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "fwk-invalid-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck = CollectionKey::generate();
    let sealed_key_json = serde_json::to_string(&seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();
    let id = "dddddddd-4444-4444-8444-444444444444";

    let res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({ "id": id, "enc_name": "enc-bad", "sealed_key": sealed_key_json, "family_wide_kind": "nonsense" })),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST, "an unrecognized family_wide_kind must be rejected with 400");

    let count_row: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collections").fetch_one(&pool).await.unwrap();
    assert_eq!(count_row, 0, "no collections row may ever be written for a rejected family_wide_kind");
}

/// A second concurrent `family_wide_kind: "item_bucket"` create for the SAME
/// family fails cleanly with 409 (`idx_one_item_bucket_per_family`, 30-01),
/// never a raw 500 — the bare `ON CONFLICT DO NOTHING` catches the partial
/// unique index violation through the same `fetch_optional` `None`-branch the
/// id-collision case already handles. A second `"folder"`-kind collection for
/// the SAME family, by contrast, still succeeds — the partial index only
/// scopes `item_bucket`.
#[tokio::test]
async fn second_item_bucket_for_same_family_is_409_but_second_folder_succeeds() {
    let pool = test_pool().await;
    let app = test_app(pool.clone());

    let owner_token = register_and_login(&app, "fwk-conflict-owner@example.com").await;
    create_family(&app, &owner_token).await;

    let owner_sk = IdentitySecretKey::generate();
    let ck1 = CollectionKey::generate();
    let sealed_key_json_1 = serde_json::to_string(&seal(&owner_sk.public_key(), ck1.expose()).unwrap()).unwrap();
    let ck2 = CollectionKey::generate();
    let sealed_key_json_2 = serde_json::to_string(&seal(&owner_sk.public_key(), ck2.expose()).unwrap()).unwrap();

    let first_bucket_id = "eeeeeeee-5555-4555-8555-555555555555";
    let first_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": first_bucket_id, "enc_name": "enc-bucket-1", "sealed_key": sealed_key_json_1,
            "family_wide_kind": "item_bucket",
        })),
    )
    .await;
    assert_eq!(first_res.status(), StatusCode::CREATED, "the first item_bucket for a family must succeed");

    let second_bucket_id = "ffffffff-6666-4666-8666-666666666666";
    let second_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": second_bucket_id, "enc_name": "enc-bucket-2", "sealed_key": sealed_key_json_2,
            "family_wide_kind": "item_bucket",
        })),
    )
    .await;
    assert_eq!(
        second_res.status(),
        StatusCode::CONFLICT,
        "a second item_bucket for the same family must be a clean 409, never an opaque 500"
    );
    let second_body = body_json(second_res).await;
    assert!(second_body.get("error").is_some(), "the 409 body must carry the standard {{\"error\": ...}} shape");

    // No row was written for the rejected second item_bucket.
    let bucket_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collections WHERE family_wide_kind = 'item_bucket'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bucket_count, 1, "only the first item_bucket row may exist for this family");

    // A second FOLDER-kind collection for the same family is unaffected — the
    // partial index only scopes item_bucket, folders stay unbounded.
    let ck3 = CollectionKey::generate();
    let sealed_key_json_3 = serde_json::to_string(&seal(&owner_sk.public_key(), ck3.expose()).unwrap()).unwrap();
    let second_folder_id = "11111111-7777-4777-8777-777777777777";
    let second_folder_res = req(
        &app,
        "POST",
        "/api/vault/collections",
        &owner_token,
        Some(json!({
            "id": second_folder_id, "enc_name": "enc-folder-2", "sealed_key": sealed_key_json_3,
            "family_wide_kind": "folder",
        })),
    )
    .await;
    assert_eq!(
        second_folder_res.status(),
        StatusCode::CREATED,
        "a second folder-kind collection for the same family must still succeed \
         — the bare ON CONFLICT DO NOTHING only trips on the id PK or the item_bucket partial index"
    );
}
