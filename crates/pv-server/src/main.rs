use anyhow::Context;
use pv_server::{build_pool, build_webauthn, config::Config, routes, AppState};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cfg = Config::from_env()?;

    let db = build_pool(&cfg.db_url).await?;
    let webauthn = build_webauthn(&cfg.rp_id, &cfg.rp_origin)?;

    let state = AppState { db, session_ttl_hours: cfg.session_ttl_hours, webauthn };
    let app = routes::router(state).layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&cfg.addr)
        .await
        .with_context(|| format!("bind {}", cfg.addr))?;
    tracing::info!("pv-server listening on http://{}", cfg.addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
