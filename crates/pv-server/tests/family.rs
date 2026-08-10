//! FAM-01/02/03 integration tests — family create/list/add-member/per-member
//! access breakdown, end-to-end through the real router (`common::test_app`).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use tower::ServiceExt;

/// `POST /api/families` -> `201`, and `GET /api/families/members` immediately
/// after shows exactly one member: the creator, `role == "owner"`, a
/// non-empty `joined_at`.
#[tokio::test]
async fn family_create_creates_sole_member_with_join_timestamp() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let token = common::register_and_login(&app, "owner@example.com").await;

    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/families")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(&json!({ "name": "Test Family" })).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let create_bytes = to_bytes(create_res.into_body(), usize::MAX).await.unwrap();
    let created: Value = serde_json::from_slice(&create_bytes).unwrap();
    let creator_user_id = created["owner_user_id"].as_str().unwrap().to_string();

    let members_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/families/members")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(members_res.status(), StatusCode::OK);

    let members_bytes = to_bytes(members_res.into_body(), usize::MAX).await.unwrap();
    let members: Value = serde_json::from_slice(&members_bytes).unwrap();
    let members = members.as_array().unwrap();
    assert_eq!(members.len(), 1, "family must have exactly one member immediately after creation");
    assert_eq!(members[0]["user_id"].as_str().unwrap(), creator_user_id);
    assert_eq!(members[0]["role"].as_str().unwrap(), "owner");
    let joined_at = members[0]["joined_at"].as_str().unwrap();
    assert!(!joined_at.is_empty(), "joined_at must be a non-empty string");
}

/// A second `POST /api/families` — a genuine duplicate-create attempt, or a
/// client retry after a dropped response (idempotency edge, same mechanism)
/// — must return `409`, never a silent duplicate or a second success.
#[tokio::test]
async fn second_family_create_returns_conflict() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let token = common::register_and_login(&app, "owner2@example.com").await;

    let make_request = || {
        Request::builder()
            .method("POST")
            .uri("/api/families")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::to_vec(&json!({ "name": "Test Family" })).unwrap()))
            .unwrap()
    };

    let first_res = app.clone().oneshot(make_request()).await.unwrap();
    assert_eq!(first_res.status(), StatusCode::CREATED);

    let second_res = app.clone().oneshot(make_request()).await.unwrap();
    assert_eq!(second_res.status(), StatusCode::CONFLICT);
}

/// FAM-02: the member-list endpoint, called immediately after family
/// creation, includes a present, non-empty `joined_at` for the sole member —
/// this exact assertion is already covered by
/// `family_create_creates_sole_member_with_join_timestamp` above (Task 1's
/// tracer test), so this test is a lightweight standalone re-assertion under
/// its own FAM-02-named test id, per this task's own test-name requirement,
/// not a duplicate of the tracer's fuller create+list flow.
#[tokio::test]
async fn member_list_includes_joined_at() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let token = common::register_and_login(&app, "owner3@example.com").await;

    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/families")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(serde_json::to_vec(&json!({ "name": "Test Family" })).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let members_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/families/members")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(members_res.status(), StatusCode::OK);

    let members_bytes = to_bytes(members_res.into_body(), usize::MAX).await.unwrap();
    let members: Value = serde_json::from_slice(&members_bytes).unwrap();
    let members = members.as_array().unwrap();
    assert_eq!(members.len(), 1);
    assert!(!members[0]["joined_at"].as_str().unwrap().is_empty());
}

/// FAM-03: the owner can add an existing registered user, then query exactly
/// which collections/item shares that member can reach — empty lists (not
/// omitted, not erroring) since no sharing exists yet in this plan's scope.
/// Also proves the 403-vs-404 split: the non-owner member themselves hitting
/// the SAME endpoint gets `403` (they provably have SOME family access, just
/// not owner-level), never `404`.
#[tokio::test]
async fn owner_sees_per_member_access_breakdown() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let owner_token = common::register_and_login(&app, "owner4@example.com").await;

    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/families")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::from(serde_json::to_vec(&json!({ "name": "Test Family" })).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let member_token = common::register_second_family_member(&app, &owner_token, "member4@example.com").await;

    let me_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/auth/me")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let me_bytes = to_bytes(me_res.into_body(), usize::MAX).await.unwrap();
    let me_body: Value = serde_json::from_slice(&me_bytes).unwrap();
    let member_user_id = me_body["user_id"].as_str().unwrap().to_string();

    let access_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/families/members/{member_user_id}/access"))
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(access_res.status(), StatusCode::OK);
    let access_bytes = to_bytes(access_res.into_body(), usize::MAX).await.unwrap();
    let access_body: Value = serde_json::from_slice(&access_bytes).unwrap();
    assert_eq!(access_body["collections"].as_array().unwrap().len(), 0);
    assert_eq!(access_body["item_shares"].as_array().unwrap().len(), 0);

    // Non-owner member hitting the SAME endpoint gets 403, not 404 — they
    // provably have SOME family access, just insufficient (member, not
    // owner) role.
    let non_owner_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/families/members/{member_user_id}/access"))
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(non_owner_res.status(), StatusCode::FORBIDDEN);
}

// --- Phase 30 Plan 02 (FSH-02/FSH-03): GET /api/families/family-wide-pending ---

/// Creates a `family_wide_kind`-set collection owned (keyed) by `owner_token`
/// alone — mirrors `tests/collections.rs`'s own creation pattern, kept local
/// to this file since `tests/common/mod.rs` has no collection-creation
/// helper today.
async fn create_family_wide_collection(app: &axum::Router, owner_token: &str, id: &str, kind: &str) {
    let owner_sk = pv_core::identity::IdentitySecretKey::generate();
    let ck = pv_core::items::CollectionKey::generate();
    let sealed_key_json =
        serde_json::to_string(&pv_core::identity::seal(&owner_sk.public_key(), ck.expose()).unwrap()).unwrap();

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/vault/collections")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "id": id, "enc_name": "enc-fwp", "sealed_key": sealed_key_json, "family_wide_kind": kind,
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED, "seeding a family_wide_kind collection must succeed");
}

async fn family_wide_pending(app: &axum::Router, token: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/families/family-wide-pending")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

/// A caller with zero family-wide collections gets `{missing: [], resealable: []}` —
/// the documented empty-edge shape, not an omitted field or an error.
#[tokio::test]
async fn family_wide_pending_empty_when_no_family_wide_collections_exist() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let owner_token = common::register_and_login(&app, "fwp-empty-owner@example.com").await;

    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/families")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::from(serde_json::to_vec(&json!({ "name": "FWP Empty Family" })).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let res = family_wide_pending(&app, &owner_token).await;
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let raw = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(!raw.contains("sealed_key"), "response body must never contain a sealed_key field: {raw}");
    assert!(!raw.contains("enc_name"), "response body must never contain an enc_name field: {raw}");
    let body: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(body["missing"].as_array().unwrap().len(), 0);
    assert_eq!(body["resealable"].as_array().unwrap().len(), 0);
}

/// A second member, added AFTER a family-wide collection was created, lacks a
/// `collection_keys` row for it — their own query shows it in `missing`; the
/// OWNER (who holds a key for it, by construction of `create()`'s own
/// fan-out seed) sees the (collection, member) pairing in `resealable`. Also
/// proves the response never leaks `enc_name`/`sealed_key` on a non-empty
/// path.
#[tokio::test]
async fn family_wide_pending_missing_for_new_member_resealable_for_existing_keyholder() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let owner_token = common::register_and_login(&app, "fwp-missing-owner@example.com").await;

    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/families")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::from(serde_json::to_vec(&json!({ "name": "FWP Family" })).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let collection_id = "22222222-8888-4888-8888-888888888888";
    create_family_wide_collection(&app, &owner_token, collection_id, "folder").await;

    // Member added AFTER the family-wide collection already existed — no
    // collection_keys row for them (this endpoint's own lazy-reseal
    // rationale, 30-DECISION-FSH-02.md).
    let member_token = common::register_second_family_member(&app, &owner_token, "fwp-member@example.com").await;
    let me_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/auth/me")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let me_bytes = to_bytes(me_res.into_body(), usize::MAX).await.unwrap();
    let me_body: Value = serde_json::from_slice(&me_bytes).unwrap();
    let member_user_id = me_body["user_id"].as_str().unwrap().to_string();

    // The NEW member's own query: the collection shows up in `missing`.
    let member_res = family_wide_pending(&app, &member_token).await;
    assert_eq!(member_res.status(), StatusCode::OK);
    let member_bytes = to_bytes(member_res.into_body(), usize::MAX).await.unwrap();
    let member_raw = String::from_utf8(member_bytes.to_vec()).unwrap();
    assert!(!member_raw.contains("sealed_key"), "missing entries must never carry sealed_key: {member_raw}");
    assert!(!member_raw.contains("enc_name"), "missing entries must never carry enc_name: {member_raw}");
    let member_body: Value = serde_json::from_str(&member_raw).unwrap();
    let missing = member_body["missing"].as_array().unwrap();
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0]["collection_id"].as_str(), Some(collection_id));
    assert_eq!(missing[0]["kind"].as_str(), Some("folder"));
    assert_eq!(member_body["resealable"].as_array().unwrap().len(), 0, "the new member holds no key to reseal from");

    // The OWNER's own query: the (collection, new-member) pairing shows up
    // in `resealable` — the owner already holds a key and could reseal it.
    let owner_res = family_wide_pending(&app, &owner_token).await;
    assert_eq!(owner_res.status(), StatusCode::OK);
    let owner_bytes = to_bytes(owner_res.into_body(), usize::MAX).await.unwrap();
    let owner_raw = String::from_utf8(owner_bytes.to_vec()).unwrap();
    assert!(!owner_raw.contains("sealed_key"), "resealable entries must never carry sealed_key: {owner_raw}");
    assert!(!owner_raw.contains("enc_name"), "resealable entries must never carry enc_name: {owner_raw}");
    let owner_body: Value = serde_json::from_str(&owner_raw).unwrap();
    assert_eq!(owner_body["missing"].as_array().unwrap().len(), 0, "the owner already holds its own key");
    let resealable = owner_body["resealable"].as_array().unwrap();
    assert_eq!(resealable.len(), 1);
    assert_eq!(resealable[0]["collection_id"].as_str(), Some(collection_id));
    assert_eq!(resealable[0]["recipient_user_id"].as_str(), Some(member_user_id.as_str()));
}

/// A suspended member gets `403`, not the response body — same gate every
/// other family-scoped read already enforces (T-30-03).
#[tokio::test]
async fn family_wide_pending_rejects_suspended_member_with_403() {
    let pool = common::test_pool().await;
    let app = common::test_app(pool);
    let owner_token = common::register_and_login(&app, "fwp-suspend-owner@example.com").await;

    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/families")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::from(serde_json::to_vec(&json!({ "name": "FWP Suspend Family" })).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);

    let member_token =
        common::register_second_family_member(&app, &owner_token, "fwp-suspended-member@example.com").await;
    let me_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/auth/me")
                .header("authorization", format!("Bearer {member_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let me_bytes = to_bytes(me_res.into_body(), usize::MAX).await.unwrap();
    let me_body: Value = serde_json::from_slice(&me_bytes).unwrap();
    let member_user_id = me_body["user_id"].as_str().unwrap().to_string();

    let suspend_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/families/members/{member_user_id}/suspend"))
                .header("authorization", format!("Bearer {owner_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(suspend_res.status(), StatusCode::NO_CONTENT);

    let res = family_wide_pending(&app, &member_token).await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN, "a suspended member must get 403, not the response body");
}
