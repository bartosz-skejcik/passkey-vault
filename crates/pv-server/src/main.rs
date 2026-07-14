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
