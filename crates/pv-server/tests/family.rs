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
