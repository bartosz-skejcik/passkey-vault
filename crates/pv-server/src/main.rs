mod config;
mod routes;

use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cfg = config::Config::from_env()?;

    let db_opts: SqliteConnectOptions = cfg
        .db_url
        .parse::<SqliteConnectOptions>()
        .context("invalid PV_DB_URL")?
        .create_if_missing(true);
    let db = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(db_opts)
        .await
        .context("db connect")?;
    sqlx::migrate!("./migrations").run(&db).await.context("migrations")?;

    let state = AppState { db };
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
