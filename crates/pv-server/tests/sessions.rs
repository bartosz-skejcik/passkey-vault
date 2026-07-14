//! Integracyjne testy `/api/sessions` przeciw realnej (in-memory, migrowanej)
//! bazie SQLite — listowanie z markerem `current: true` na WŁASNYM tokenie
//! wywołującego oraz odwoływanie (revoke) pojedynczej sesji, obejmujące
//! izolację między użytkownikami (IDOR).

mod common;

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use tower::ServiceExt;

use common::{register_and_login, test_app, test_pool};

async fn body_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn req(app: &axum::Router, method: &str, uri: &str, token: &str) -> axum::response::Response {
    let builder = Request::builder().method(method).uri(uri).header("authorization", format!("Bearer {token}"));
    app.clone().oneshot(builder.body(Body::empty()).unwrap()).await.unwrap()
}

/// Logs the same fixture user in a SECOND time (a second
/// `POST /api/auth/login` call, same credentials `register_and_login`
/// already established) — yields a second, independent `sessions` row/bearer
/// token for the same user without duplicating `register_and_login`'s
/// registration step.
async fn login_again(app: &axum::Router, email: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let auth_hash = STANDARD.encode([2u8; 32]);
    let login_body = json!({ "email": email, "auth_hash": auth_hash });
    let login_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_res.status(), StatusCode::OK, "second login must succeed");
    let bytes = to_bytes(login_res.into_body(), usize::MAX).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    body["session_token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn sessions_list_marks_current() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token = register_and_login(&app, "sessionsingle@example.com").await;

    let list_res = req(&app, "GET", "/api/sessions", &token).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let rows = body_json(list_res).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 1, "one login must yield exactly one session row");
    assert_eq!(rows[0]["current"], json!(true));
}

#[tokio::test]
async fn sessions_list_second_login_adds_a_non_current_row() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_first = register_and_login(&app, "sessiondouble@example.com").await;
    let _token_second = login_again(&app, "sessiondouble@example.com").await;

    let list_res = req(&app, "GET", "/api/sessions", &token_first).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let rows = body_json(list_res).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 2, "two logins must yield two session rows");

    let current_count = rows.iter().filter(|r| r["current"] == json!(true)).count();
    assert_eq!(current_count, 1, "exactly one row must be marked current");

    let non_current_count = rows.iter().filter(|r| r["current"] == json!(false)).count();
    assert_eq!(non_current_count, 1, "exactly one row must be marked non-current");
}

#[tokio::test]
async fn sessions_revoke_ownership_check() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_a = register_and_login(&app, "sessionownera@example.com").await;
    let token_b = register_and_login(&app, "sessionownerb@example.com").await;

    let list_res = req(&app, "GET", "/api/sessions", &token_a).await;
    let rows = body_json(list_res).await;
    let session_a_id = rows.as_array().unwrap()[0]["id"].as_str().unwrap().to_string();

    let revoke_res = req(&app, "DELETE", &format!("/api/sessions/{session_a_id}"), &token_b).await;
    assert_eq!(revoke_res.status(), StatusCode::NOT_FOUND, "cross-user revoke must be 404, not 403");

    // User A's session is still listable/unrevoked.
    let list_res = req(&app, "GET", "/api/sessions", &token_a).await;
    assert_eq!(list_res.status(), StatusCode::OK);
    let rows = body_json(list_res).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], session_a_id);
}

#[tokio::test]
async fn sessions_revoke_removes_row() {
    let pool = test_pool().await;
    let app = test_app(pool);
    let token_first = register_and_login(&app, "sessionrevoke@example.com").await;
    let _token_second = login_again(&app, "sessionrevoke@example.com").await;

    let list_res = req(&app, "GET", "/api/sessions", &token_first).await;
    let rows = body_json(list_res).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    // Revoke the NON-current (second) session.
    let non_current_id = rows.iter().find(|r| r["current"] == json!(false)).unwrap()["id"].as_str().unwrap().to_string();

    let revoke_res = req(&app, "DELETE", &format!("/api/sessions/{non_current_id}"), &token_first).await;
    assert_eq!(revoke_res.status(), StatusCode::NO_CONTENT);

    let list_res = req(&app, "GET", "/api/sessions", &token_first).await;
    let rows = body_json(list_res).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 1, "only the surviving (current) session must remain listed");
    assert_eq!(rows[0]["current"], json!(true));
}
