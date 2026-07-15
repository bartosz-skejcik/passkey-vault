pub mod auth;
pub mod extension_passkeys;
pub mod folders;
pub mod passkeys;
pub mod session;
pub mod sessions;
pub mod sync;
pub mod vault;
pub mod webauthn_state;

use std::path::PathBuf;

use axum::{
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::AppState;

/// Builds the API router, optionally layering a static-directory SPA
/// fallback on top of it. When `static_dir` points at a real directory
/// (Docker-packaged Next.js export, DEPLOY-01), this is the concrete
/// implementation of the single-origin packaging `cors_layer()`'s doc
/// comment already anticipates: the same axum process serves `/healthz`,
/// every `/api/*` route, and the static export all on one port. When
/// `static_dir` is `None` or doesn't exist, degrades to API-only with a
/// warning log — never a panic — which is also the path every existing
/// integration test exercises via `router(state, None)`.
pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/auth/prelogin", post(auth::prelogin))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/passkey-login/start", post(auth::passkey_login_start))
        .route("/api/auth/passkey-login/finish", post(auth::passkey_login_finish))
        .route("/api/vault/items", get(vault::list).post(vault::create))
        .route("/api/vault/items/{id}", put(vault::update).delete(vault::delete))
        .route("/api/vault/folders", get(folders::list).post(folders::create))
        .route("/api/vault/folders/{id}", delete(folders::delete))
        .route("/api/sync", get(sync::pull))
        .route("/api/sync/ws", get(sync::ws_handler))
        .route("/api/passkeys", get(passkeys::list))
        .route("/api/passkeys/register/start", post(passkeys::register_start))
        .route("/api/passkeys/register/finish", post(passkeys::register_finish))
        .route("/api/passkeys/{id}/prf-wrap", post(passkeys::prf_wrap))
        .route("/api/passkeys/unlock/start", post(passkeys::unlock_start))
        .route("/api/passkeys/unlock/finish", post(passkeys::unlock_finish))
        .route("/api/passkeys/{id}", patch(passkeys::rename).delete(passkeys::delete_passkey))
        .route(
            "/api/extension-passkeys",
            get(extension_passkeys::list).post(extension_passkeys::create),
        )
        .route("/api/extension-passkeys/{credential_id}", delete(extension_passkeys::delete_credential))
        .route("/api/sessions", get(sessions::list))
        .route("/api/sessions/{id}", delete(sessions::revoke))
        .with_state(state)
        .layer(cors_layer());

    match static_dir.filter(|d| d.is_dir()) {
        Some(dir) => {
            // NOTE: deliberately `.fallback(...)`, not `.not_found_service(...)` —
            // `not_found_service` unconditionally rewrites the response status to
            // 404 (tower-http `SetStatus`), which would make every SPA-fallback
            // hit report 404 even though `index.html` was served. `.fallback(...)`
            // preserves the served file's natural 200 status, which is what a real
            // SPA client-side route needs to render instead of erroring out.
            let serve = ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")));
            api.fallback_service(serve)
        }
        None => {
            tracing::warn!("PV_STATIC_DIR not set or not a directory — serving API only");
            api
        }
    }
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
///
/// `PV_EXTENSION_ORIGINS` is the production-safe allowlist for the browser
/// extension's own origin(s) (`chrome-extension://<id>`, `moz-extension://<id>`),
/// additive to — never a replacement for — the dev toggle above (CONTEXT.md D-08).
fn cors_layer() -> CorsLayer {
    let dev_cors_enabled = std::env::var("PV_DEV_CORS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let extension_origins_csv = std::env::var("PV_EXTENSION_ORIGINS").unwrap_or_default();
    build_cors_layer(dev_cors_enabled, &extension_origins_csv)
}

/// Pure, env-free core of `cors_layer()` — split out so it is unit-testable
/// against a real HTTP request/response (see `mod tests` below) without
/// mutating process-global env vars, which would be flaky under parallel
/// `cargo test` execution. `extension_origins_csv` is a comma-separated
/// list of allowed origins, e.g. "chrome-extension://<id>,moz-extension://<id>"
/// (CONTEXT.md D-08 — additive to, never replacing, PV_DEV_CORS).
fn build_cors_layer(dev_cors_enabled: bool, extension_origins_csv: &str) -> CorsLayer {
    if dev_cors_enabled {
        return CorsLayer::permissive();
    }
    let origins: Vec<_> = extension_origins_csv
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    if origins.is_empty() {
        CorsLayer::new() // unchanged existing behavior when unset
    } else {
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods(Any)
            .allow_headers(Any)
    }
}

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn probe_router(layer: CorsLayer) -> Router {
        Router::new()
            .route("/probe", get(|| async { "ok" }))
            .layer(layer)
    }

    async fn acao_header_for(layer: CorsLayer, origin: &str) -> Option<String> {
        let app = probe_router(layer);
        let request = Request::builder()
            .uri("/probe")
            .header("origin", origin)
            .body(Body::empty())
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response
            .headers()
            .get("access-control-allow-origin")
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[tokio::test]
    async fn allowlisted_extension_origin_receives_matching_acao_header() {
        let layer = build_cors_layer(false, "chrome-extension://abcdefghijklmnop");
        let acao = acao_header_for(layer, "chrome-extension://abcdefghijklmnop").await;
        assert_eq!(acao.as_deref(), Some("chrome-extension://abcdefghijklmnop"));
    }

    #[tokio::test]
    async fn non_allowlisted_origin_gets_no_acao_header() {
        let layer = build_cors_layer(false, "chrome-extension://abcdefghijklmnop");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None);
    }

    #[tokio::test]
    async fn empty_allowlist_matches_todays_no_cors_layer_behavior() {
        let layer = build_cors_layer(false, "");
        let acao = acao_header_for(layer, "https://evil.example").await;
        assert_eq!(acao, None);
    }

    #[tokio::test]
    async fn dev_cors_flag_stays_permissive_regardless_of_allowlist() {
        let layer = build_cors_layer(true, "chrome-extension://abcdefghijklmnop");
        let acao = acao_header_for(layer, "https://some-unrelated-origin.example").await;
        assert!(acao.is_some());
    }
}
