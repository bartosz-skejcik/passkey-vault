use std::path::PathBuf;

use anyhow::Context;
use axum::{body::Body, http::Request};
use pv_server::{build_pool, build_webauthn, config::Config, routes, AppState};
use tower_http::trace::TraceLayer;
use tracing::Span;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cfg = Config::from_env()?;
    cfg.validate()?;

    let db = build_pool(&cfg.db_url).await?;
    let webauthn = build_webauthn(&cfg.rp_id, &cfg.rp_origin)?;
    // Fresh per-process secret for the enumeration-resistant dummy
    // `passkey_login_start` branch (WR-01) — see AppState::dummy_secret's
    // doc comment for why this must not be a public/derivable value.
    let dummy_secret: [u8; 32] =
        pv_core::keys::random_bytes(32).try_into().expect("random_bytes(32) must return 32 bytes");

    let state = AppState {
        db,
        session_ttl_hours: cfg.session_ttl_hours,
        webauthn,
        rp_id: cfg.rp_id.clone(),
        dummy_secret,
        sync_hub: pv_server::routes::sync::SyncHub::default(),
    };
    let static_dir = std::env::var("PV_STATIC_DIR").ok().map(PathBuf::from);
    let app = routes::router(state, static_dir)
        .layer(TraceLayer::new_for_http().make_span_with(make_span));

    let listener = tokio::net::TcpListener::bind(&cfg.addr)
        .await
        .with_context(|| format!("bind {}", cfg.addr))?;
    tracing::info!("pv-server listening on http://{}", cfg.addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Traps both SIGINT (Ctrl-C, local dev) and SIGTERM (the signal `docker
/// stop` actually sends by default) so `axum::serve`'s
/// `with_graceful_shutdown` drains in-flight requests and open sync
/// WebSocket connections cleanly on either, instead of every `docker stop`
/// hitting the container runtime's SIGKILL grace-period timeout because only
/// SIGINT was handled.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutting down");
}

/// WR-02: `TraceLayer`'s `DefaultMakeSpan` records the full request `uri`
/// (path + query string) as a span field. `/api/sync/ws` carries the live
/// session bearer token as `?token=...` (unavoidable — the browser
/// `WebSocket` API can't set custom headers on the upgrade request), so at
/// the default `info` filter this DEBUG-level span is never emitted, but any
/// operator who raises `RUST_LOG` to `debug`/`trace` while diagnosing sync
/// issues would otherwise write live session tokens straight into the
/// server's own logs. Redact the query string for this one route only;
/// every other route keeps `DefaultMakeSpan`'s normal full-URI field.
///
/// This only covers pv-server's own tracing output — Phase 7's Docker
/// packaging must separately document that the reverse-proxy (nginx/Caddy)
/// access-log config strips the `token` query param for this route, since a
/// reverse proxy logs the raw request line before this middleware ever runs.
fn make_span(request: &Request<Body>) -> Span {
    let uri = span_uri_field(request.uri());
    tracing::debug_span!(
        "request",
        method = %request.method(),
        uri = %uri,
        version = ?request.version(),
    )
}

/// Pure helper factored out of `make_span` so the redaction decision is
/// unit-testable without spinning up a tracing subscriber: `/api/sync/ws`
/// reports path-only (dropping `?token=...`), every other route reports the
/// full `uri` (path + query) exactly as `DefaultMakeSpan` would.
fn span_uri_field(uri: &axum::http::Uri) -> String {
    if uri.path() == "/api/sync/ws" {
        uri.path().to_string()
    } else {
        uri.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::span_uri_field;

    #[test]
    fn redacts_the_query_string_for_the_ws_sync_route() {
        let uri: axum::http::Uri = "/api/sync/ws?token=super-secret-session-token".parse().unwrap();
        let field = span_uri_field(&uri);
        assert_eq!(field, "/api/sync/ws");
        assert!(!field.contains("super-secret-session-token"));
        assert!(!field.contains("token="));
    }

    #[test]
    fn keeps_the_full_uri_for_every_other_route() {
        let uri: axum::http::Uri = "/api/sync?since=42".parse().unwrap();
        assert_eq!(span_uri_field(&uri), "/api/sync?since=42");

        let uri: axum::http::Uri = "/api/vault/items".parse().unwrap();
        assert_eq!(span_uri_field(&uri), "/api/vault/items");
    }
}
