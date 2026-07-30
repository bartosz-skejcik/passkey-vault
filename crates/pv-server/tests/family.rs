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
