//! Integracyjne testy `/api/auth/*` przeciw realnej (in-memory, migrowanej)
//! bazie SQLite.

mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
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
