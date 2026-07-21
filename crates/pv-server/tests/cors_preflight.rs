//! SEC-01: real-server proof that a genuine Firefox-shaped OPTIONS
//! preflight receives an explicit `Access-Control-Allow-Headers` value that
//! lists `authorization` (never the literal `*`). Uses a genuinely bound
//! `TcpListener` + `reqwest::Client` round-trip — `tower::oneshot()` cannot
//! stand in for a real HTTP client/server exchange here (19-01-PLAN.md Task
//! 2's `<behavior>`: this is a proof about the actual header VALUE on a real
//! socket, not just preflight status).

mod common;

use common::{serve_router, test_app_with_cors, test_pool};

const TEST_UUID_ORIGIN: &str = "moz-extension://a1b2c3d4-e5f6-4789-a012-3456789abcde";

async fn preflight_allow_headers(request_headers_value: &str) -> String {
    let pool = test_pool().await;
    let app = test_app_with_cors(pool, TEST_UUID_ORIGIN);
    let (_app, port) = serve_router(app).await;

    let client = reqwest::Client::new();
    let response = client
        .request(reqwest::Method::OPTIONS, format!("http://127.0.0.1:{port}/api/vault/items"))
        .header("Origin", TEST_UUID_ORIGIN)
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", request_headers_value)
        .send()
        .await
        .expect("real OPTIONS preflight round-trip must succeed");

    assert!(response.status().is_success(), "preflight status: {}", response.status());

    response
        .headers()
        .get("access-control-allow-headers")
        .expect("access-control-allow-headers must be present on an allowed-origin preflight")
        .to_str()
        .expect("header value must be valid ASCII/UTF-8")
        .to_lowercase()
}

#[tokio::test]
async fn preflight_allow_headers_lists_authorization_lowercase_order() {
    let allow_headers = preflight_allow_headers("authorization,content-type").await;
    assert!(
        allow_headers.contains("authorization"),
        "access-control-allow-headers must contain authorization: {allow_headers}"
    );
    assert_ne!(allow_headers, "*", "must never be the literal wildcard");
}

#[tokio::test]
async fn preflight_allow_headers_lists_authorization_regardless_of_request_casing_and_order() {
    // tower-http lowercases and the explicit list must not depend on the
    // request's own Access-Control-Request-Headers casing/order.
    let allow_headers = preflight_allow_headers("Content-Type, Authorization").await;
    assert!(
        allow_headers.contains("authorization"),
        "access-control-allow-headers must contain authorization: {allow_headers}"
    );
    assert_ne!(allow_headers, "*", "must never be the literal wildcard");
}
