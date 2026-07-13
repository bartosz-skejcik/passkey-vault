pub mod auth;
pub mod session;

use axum::{
    routing::{get, post},
    Json, Router,
};
use tower_http::cors::CorsLayer;

use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/auth/prelogin", post(auth::prelogin))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .with_state(state)
        // Permissive CORS is a dev-mode-only convenience: Phase 7's Docker
        // packaging serves both the API and the static web export from one
        // origin in production, so there is no cross-origin surface to guard
        // once packaged.
        .layer(CorsLayer::permissive())
}

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}
