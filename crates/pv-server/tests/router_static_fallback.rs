//! Phase 7, DEPLOY-01 — the `router()` SPA-fallback contract: when a static
//! directory (the Docker-packaged Next.js export) is configured and exists,
//! any unmatched client-side route resolves to `index.html`, real files in
//! that directory are served verbatim, and every existing `/api/*` route
//! (including `/healthz`) is unaffected. When the directory is missing or
//! not configured, `router()` degrades to API-only without panicking.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use tower::ServiceExt;

fn fixture_static_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("pv-static-fixture-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("create fixture static dir");
    std::fs::write(dir.join("index.html"), "<!doctype html><title>pv index fixture</title>")
        .expect("write index.html fixture");
    std::fs::write(dir.join("robots.txt"), "User-agent: *\nDisallow: /pv-robots-fixture")
        .expect("write robots.txt fixture");
    dir
}

#[tokio::test]
async fn unmatched_path_serves_index_html_spa_fallback() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let res = app
        .oneshot(Request::builder().uri("/settings/whatever").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(bytes, "<!doctype html><title>pv index fixture</title>".as_bytes());

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn real_file_is_served_verbatim() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let res = app
        .oneshot(Request::builder().uri("/robots.txt").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(bytes, "User-agent: *\nDisallow: /pv-robots-fixture".as_bytes());

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn api_routes_are_unaffected_by_static_fallback() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let res = app
        .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body, serde_json::json!({ "status": "ok" }));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn missing_static_dir_degrades_to_api_only_without_panic() {
    let missing_dir = std::env::temp_dir().join(format!("pv-static-missing-{}", uuid::Uuid::new_v4()));
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, missing_dir);

    let healthz_res = app
        .clone()
        .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(healthz_res.status(), StatusCode::OK);

    let unmatched_res = app
        .oneshot(Request::builder().uri("/settings/whatever").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(unmatched_res.status(), StatusCode::NOT_FOUND);
}
