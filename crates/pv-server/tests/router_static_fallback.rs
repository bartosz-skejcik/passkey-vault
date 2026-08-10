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
    // WR-01/WR-04 (code review, Phase 29): mirrors the real Next.js export's
    // flat `<route>.html` shape (`out/settings.html`) that
    // `rewrite_nested_static_route` exists to serve for a bare `/settings`
    // request -- see that function's own doc comment for the full "why".
    std::fs::write(dir.join("settings.html"), "<!doctype html><title>pv settings fixture</title>")
        .expect("write settings.html fixture");
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

// WR-01 (code review, Phase 29): the happy path
// `rewrite_nested_static_route` exists for -- a bare nested route resolves
// to its real flat `<route>.html` file, not the root SPA's `index.html`.
#[tokio::test]
async fn nested_route_serves_its_own_flat_html_file_not_the_root_spa() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let res = app.oneshot(Request::builder().uri("/settings").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        bytes,
        "<!doctype html><title>pv settings fixture</title>".as_bytes(),
        "GET /settings must serve settings.html's own bytes, never index.html's"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// WR-04 (code review, Phase 29): the rewrite used to check `GET` only, so
// `HEAD /settings` still took the pre-fix path (directory redirect, no
// index.html inside out/settings/, fall through to the root SPA) while GET
// took the fixed one -- proven here by comparing HEAD's own Content-Length
// against GET's: if HEAD had silently resolved to index.html instead, the
// two content-lengths would differ (settings.html and index.html are
// deliberately different lengths in the fixture above).
#[tokio::test]
async fn head_request_to_a_nested_route_matches_get_not_the_root_spa() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let get_res =
        app.clone().oneshot(Request::builder().uri("/settings").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_len = get_res.headers().get(axum::http::header::CONTENT_LENGTH).cloned();

    let head_res = app
        .oneshot(Request::builder().method("HEAD").uri("/settings").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(head_res.status(), StatusCode::OK);
    let head_len = head_res.headers().get(axum::http::header::CONTENT_LENGTH).cloned();

    assert!(get_len.is_some(), "sanity: GET must report a Content-Length");
    assert_eq!(
        head_len, get_len,
        "HEAD /settings must report the SAME Content-Length as GET /settings (settings.html), \
         not the root index.html's -- a mismatch means HEAD silently fell through to the SPA"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// WR-01/WR-02 (code review, Phase 29): explicit regression coverage for the
// two traversal-attempt forms WR-01's own fix suggestion names verbatim.
// NOTE (honesty about what this proves): `ServeDir` sanitises the decoded
// path independently either way, so end-to-end this assertion holds even
// against the PRE-fix guard (the review's own words: "the rewrite is
// currently still safe... that safety rests on an unstated coincidence").
// What WR-02's actual fix changes is the GUARD's own internal correctness
// (decode-then-validate explicitly, rather than inspecting the raw encoded
// literal while `ServeDir` acts on the decoded one) -- a structural
// robustness property this black-box HTTP test cannot discriminate
// pre-/post-fix, since the outer defense (`ServeDir`) covers for it either
// way. Kept here anyway because it is real, valuable defense-in-depth
// coverage of the full pipeline, and is exactly what WR-01 asked for.
#[tokio::test]
async fn percent_encoded_traversal_attempts_never_escape_the_static_root() {
    let dir = fixture_static_dir();
    let secret_path = dir.parent().unwrap().join(format!("pv-static-secret-{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&secret_path, "top secret, must never be served").expect("write secret sibling file");
    let secret_name = secret_path.file_name().unwrap().to_str().unwrap().to_string();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    for uri in [format!("/..%2f{secret_name}"), format!("/%2e%2e%2f{secret_name}")] {
        let res = app
            .clone()
            .oneshot(Request::builder().uri(uri.as_str()).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert_ne!(
            bytes,
            "top secret, must never be served".as_bytes(),
            "{uri} must never resolve to the secret sibling file outside the static root"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&secret_path);
}

// WR-07 (code review, Phase 29): the existence-probe failure path used to
// collapse `unwrap_or(false)` -- a REAL I/O error (ENOTDIR here, but the
// same collapse covered permissions/a broken volume mount in the Docker
// deployment this project ships as its core value) was silently treated as
// "route doesn't exist" with nothing logged. This test forces a genuine
// `Err` (not `Ok(false)`) out of `tokio::fs::try_exists` by making a path
// SEGMENT a plain file rather than a directory (`blocked` is a file;
// `blocked/inner.html` cannot exist beneath a non-directory -- confirmed
// empirically to return `Err(NotADirectory)`, not `Ok(false)`, on this
// platform) and asserts the request still resolves safely to the ordinary
// SPA fallback -- never a panic, a hang, or (the old defect this whole
// middleware exists to fix) a silently wrong response. The `tracing::warn!`
// this path now emits is not independently captured by this test (this
// crate has no tracing-capture test harness yet); the fail-SAFE behavior it
// protects is what's asserted here.
#[tokio::test]
async fn existence_probe_io_error_falls_through_safely_never_panics() {
    let dir = fixture_static_dir();
    std::fs::write(dir.join("blocked"), "im a file, not a directory").expect("write blocking file fixture");
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    let res = app
        .oneshot(Request::builder().uri("/blocked/inner").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "must fail through to the SPA fallback, never panic or error out");
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        bytes,
        "<!doctype html><title>pv index fixture</title>".as_bytes(),
        "the ENOTDIR probe failure must resolve to the ordinary index.html SPA fallback"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// WR-01 (code review, Phase 29): the query-preservation branch
// (`rewrite_nested_static_route` re-appends `?query` after rewriting the
// path to `<route>.html`) had zero executable assertions before this plan.
// A dropped query string on `/settings?tab=security` would silently lose
// client-side routing state the settings page reads from `location.search`.
#[tokio::test]
async fn query_string_survives_the_nested_route_rewrite() {
    let dir = fixture_static_dir();
    let pool = common::test_pool().await;
    let app = common::test_app_with_static_dir(pool, dir.clone());

    // A settings.html fixture doesn't need to introspect its own query
    // string for this assertion -- what matters is that the REQUEST reaches
    // the server successfully rewritten (200, settings.html's own bytes),
    // proving the rewrite's query-append branch produced a URI axum could
    // still parse and route, not a malformed one that fell through instead.
    let res = app
        .oneshot(Request::builder().uri("/settings?tab=security").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        bytes,
        "<!doctype html><title>pv settings fixture</title>".as_bytes(),
        "a query string must not break the rewrite -- still settings.html, not a fallback/error"
    );

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
