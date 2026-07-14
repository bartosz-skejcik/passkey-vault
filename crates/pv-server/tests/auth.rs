//! Integracyjne testy `/api/auth/*` przeciw realnej (in-memory, migrowanej)
//! bazie SQLite.

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use tower::ServiceExt;

use common::{test_app, test_pool};

/// Dowodzi, że sam harness działa (migracje się stosują, router odpowiada),
/// zanim dalsze testy w tym pliku zaczną wywoływać realne endpointy auth.
#[tokio::test]
async fn harness_boots_and_migrates() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let response = app
        .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn post_json(app: &axum::Router, uri: &str, body: Value) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
}

fn b64(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(bytes)
}

fn register_body(email: &str) -> Value {
    json!({
        "email": email,
        "kdf": { "m_cost_kib": 65536, "t_cost": 3, "p_cost": 4 },
        "salt": b64(&[1u8; 16]),
        "auth_hash": b64(&[2u8; 32]),
        "pw_wrapped_uk": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
    })
}

#[tokio::test]
async fn prelogin_unknown_email_is_shape_identical_and_deterministic() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let r1 = post_json(&app, "/api/auth/prelogin", json!({ "email": "ghost@example.com" })).await;
    assert_eq!(r1.status(), StatusCode::OK);
    let body1 = body_json(r1).await;

    let r2 = post_json(&app, "/api/auth/prelogin", json!({ "email": "ghost@example.com" })).await;
    let body2 = body_json(r2).await;

    // Same unknown email -> same dummy salt every time.
    assert_eq!(body1["salt"], body2["salt"]);
    // Response shape has exactly the same fields a real account would have.
    assert!(body1.get("kdf").is_some());
    assert!(body1.get("salt").is_some());
}

#[tokio::test]
async fn prelogin_unknown_email_dummy_salt_differs_from_real_account() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let register_res = post_json(&app, "/api/auth/register", register_body("real@example.com")).await;
    assert_eq!(register_res.status(), StatusCode::CREATED);

    let real = post_json(&app, "/api/auth/prelogin", json!({ "email": "real@example.com" })).await;
    let real_body = body_json(real).await;

    let ghost = post_json(&app, "/api/auth/prelogin", json!({ "email": "ghost2@example.com" })).await;
    let ghost_body = body_json(ghost).await;

    assert_ne!(real_body["salt"], ghost_body["salt"]);
}

#[tokio::test]
async fn register_then_duplicate_email_returns_conflict() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let first = post_json(&app, "/api/auth/register", register_body("dup@example.com")).await;
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = post_json(&app, "/api/auth/register", register_body("dup@example.com")).await;
    assert_eq!(second.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn login_with_wrong_auth_hash_is_unauthorized() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let email = "loginwrong@example.com";
    let reg = post_json(&app, "/api/auth/register", register_body(email)).await;
    assert_eq!(reg.status(), StatusCode::CREATED);

    let login_res = post_json(
        &app,
        "/api/auth/login",
        json!({ "email": email, "auth_hash": b64(&[9u8; 32]) }),
    )
    .await;
    assert_eq!(login_res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_with_nonexistent_email_returns_same_shape_as_wrong_auth_hash() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let email = "loginexists@example.com";
    let reg = post_json(&app, "/api/auth/register", register_body(email)).await;
    assert_eq!(reg.status(), StatusCode::CREATED);

    let wrong_hash_res = post_json(
        &app,
        "/api/auth/login",
        json!({ "email": email, "auth_hash": b64(&[9u8; 32]) }),
    )
    .await;
    assert_eq!(wrong_hash_res.status(), StatusCode::UNAUTHORIZED);
    let wrong_hash_body = body_json(wrong_hash_res).await;

    let unknown_email_res = post_json(
        &app,
        "/api/auth/login",
        json!({ "email": "nobody@example.com", "auth_hash": b64(&[2u8; 32]) }),
    )
    .await;
    assert_eq!(unknown_email_res.status(), StatusCode::UNAUTHORIZED);
    let unknown_email_body = body_json(unknown_email_res).await;

    assert_eq!(wrong_hash_body, unknown_email_body);
}

#[tokio::test]
async fn full_register_login_me_logout_flow() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let email = "flow@example.com";
    let reg = post_json(&app, "/api/auth/register", register_body(email)).await;
    assert_eq!(reg.status(), StatusCode::CREATED);

    let login_res = post_json(
        &app,
        "/api/auth/login",
        json!({ "email": email, "auth_hash": b64(&[2u8; 32]) }),
    )
    .await;
    assert_eq!(login_res.status(), StatusCode::OK);
    let login_body = body_json(login_res).await;
    let token = login_body["session_token"].as_str().unwrap().to_string();
    assert_eq!(login_body["pw_wrapped_uk"], register_body(email)["pw_wrapped_uk"]);

    // /me with valid token
    let me_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_res.status(), StatusCode::OK);
    let me_body = body_json(me_res).await;
    assert_eq!(me_body["email"], email);

    // logout
    let logout_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout_res.status(), StatusCode::NO_CONTENT);

    // /me with now-deleted token -> 401
    let me_after_logout = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_after_logout.status(), StatusCode::UNAUTHORIZED);
}

/// WR-02 regression: `login`'s INSERT previously never captured the
/// `User-Agent` header, leaving `sessions.user_agent` permanently NULL and
/// `SessionsTab`'s AUTH-07 device display always falling back to
/// "unknown device". Asserts the header now round-trips through
/// login -> `sessions` table -> `GET /api/sessions`.
#[tokio::test]
async fn login_persists_user_agent_and_sessions_list_returns_it() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let email = "useragent@example.com";
    let reg = post_json(&app, "/api/auth/register", register_body(email)).await;
    assert_eq!(reg.status(), StatusCode::CREATED);

    let ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
    let login_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .header("user-agent", ua)
                .body(Body::from(
                    serde_json::to_vec(&json!({ "email": email, "auth_hash": b64(&[2u8; 32]) })).unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_res.status(), StatusCode::OK);
    let token = body_json(login_res).await["session_token"].as_str().unwrap().to_string();

    let list_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/sessions")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_res.status(), StatusCode::OK);
    let rows = body_json(list_res).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0]["user_agent"],
        json!(ua),
        "the login request's User-Agent header must be persisted and returned, not NULL"
    );
}

#[tokio::test]
async fn me_without_token_is_unauthorized() {
    let pool = test_pool().await;
    let app = test_app(pool);

    let res = app
        .oneshot(Request::builder().uri("/api/auth/me").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}
