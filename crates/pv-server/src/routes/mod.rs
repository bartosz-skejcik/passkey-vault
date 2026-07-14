pub mod auth;
pub mod folders;
pub mod session;
pub mod vault;
pub mod webauthn_state;

use axum::{
    routing::{delete, get, post, put},
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
        .route("/api/vault/items", get(vault::list).post(vault::create))
        .route("/api/vault/items/{id}", put(vault::update).delete(vault::delete))
        .route("/api/vault/folders", get(folders::list).post(folders::create))
        .route("/api/vault/folders/{id}", delete(folders::delete))
        .with_state(state)
        .layer(cors_layer())
}

/// Permissive CORS is a dev-mode-only convenience: Phase 7's Docker
/// packaging serves both the API and the static web export from one origin
/// in production, so there is no cross-origin surface to guard once
/// packaged. Before that lands, unconditionally applying `permissive()`
/// would silently reopen an unrestricted cross-origin surface for any
/// topology that isn't single-origin yet (reverse-proxy misconfiguration, a
/// separate dev/staging split, a mobile/extension client) — so it's gated
/// behind an explicit opt-in env var (WR-09) rather than always-on. Set
/// `PV_DEV_CORS=1` for local frontend-against-separate-origin dev only.
fn cors_layer() -> CorsLayer {
    let dev_cors_enabled = std::env::var("PV_DEV_CORS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if dev_cors_enabled {
        CorsLayer::permissive()
    } else {
        CorsLayer::new()
    }
}

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}
