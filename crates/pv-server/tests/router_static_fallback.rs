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

// CR-03 (code review, Phase 29): `Referrer-Policy` (and, by the same
// ordering bug, `cors`) used to be layered BEFORE `.fallback_service(...)`
// was attached in `router_with_cors` -- axum 0.8's `Router::fallback_service`
// replaces the fallback slots with the raw, unlayered service, discarding a
// layer applied earlier. Reproduced empirically pre-fix: `/healthz` carried
// the header, `/settings`/`/` (served by the static fallback -- exactly
// where T-24-10's own `invite_id`-via-`Referer` threat lives) did not. This
// is the regression test the review asked for: build the REAL router
// (`router_with_cors` via `test_app_with_static_dir`) against a temp static
// dir and assert the header on BOTH the API route and the fallback-served
// static responses.
#[tokio::test]
async fn referrer_policy_header_reaches_the_static_fallback_not_only_the_api() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    async fn referrer_policy_of(app: axum::Router, uri: &str) -> Option<String> {
        let res = app.oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "{uri} must resolve 200 for this assertion to be meaningful");
        res.headers().get(axum::http::header::REFERRER_POLICY).map(|v| v.to_str().unwrap().to_string())
    }

    let expected = Some("strict-origin-when-cross-origin".to_string());
    assert_eq!(
        referrer_policy_of(app.clone(), "/healthz").await,
        expected,
        "sanity: the API route must still carry the header"
    );
    assert_eq!(
        referrer_policy_of(app.clone(), "/").await,
        expected,
        "the root index.html, served by the static fallback, must carry the header too"
    );
    assert_eq!(
        referrer_policy_of(app, "/settings/whatever").await,
        expected,
        "an SPA-fallback route (the same shape /invite/{{invite_id}} takes) must carry the header"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// WR-03 (code review, Phase 29): `29-05-SUMMARY.md` recorded a `/api/`
// guard on `rewrite_nested_static_route` that did not exist in the code --
// harmless only because no `out/api/*.html` file exists in a real export.
// This test proves the guard is now REAL by placing a file at the exact
// path an unmatched `/api/*` GET would otherwise have been REWRITTEN to
// (`out/api/does-not-exist.html`) and asserting that decoy file's bytes are
// NEVER what comes back for `GET /api/does-not-exist` -- with the guard in
// place the request instead falls through, unrewritten, to the same
// generic `index.html` SPA fallback every other genuinely-unmatched path
// gets (still a 200 -- axum's static-fallback layer has no separate 404
// path for an unmatched GET; a real registered `/api/*` route still 404s/
//401s exactly as it always did, since it's dispatched by the `api` router
// BEFORE the fallback is ever reached).
#[tokio::test]
async fn api_prefixed_unmatched_path_is_never_rewritten_to_a_static_file() {
    let dir = fixture_static_dir();
    std::fs::create_dir_all(dir.join("api")).expect("create out/api dir");
    let decoy = "should never be served for /api/*";
    std::fs::write(dir.join("api").join("does-not-exist.html"), decoy)
        .expect("write decoy out/api/does-not-exist.html fixture");
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let res = app
        .oneshot(Request::builder().uri("/api/does-not-exist").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "falls through to the generic SPA fallback, same as any unmatched path");
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_ne!(
        bytes, decoy.as_bytes(),
        "the /api/*-shadowed static file must NEVER be what a GET /api/* miss resolves to"
    );
    assert_eq!(
        bytes,
        "<!doctype html><title>pv index fixture</title>".as_bytes(),
        "must be the ordinary index.html SPA fallback, not the decoy"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
