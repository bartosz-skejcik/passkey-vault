//! Biblioteka `pv-server` — dzielona przez binarkę (`main.rs`) i testy
//! integracyjne (`tests/`), żeby oba mogły budować identyczny router i
//! AppState bez duplikacji logiki setupu bazy/migracji.

pub mod config;
pub mod crypto;
pub mod error;
pub mod routes;

use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    /// Session TTL used when issuing new bearer tokens on login. Carried on
    /// `AppState` (not re-read from env per request) so the test harness can
    /// set a fixed value without needing a live environment.
    pub session_ttl_hours: u64,
}

/// Łączy się z bazą (tworząc plik, jeśli brakuje) i uruchamia migracje.
/// Wspólna ścieżka dla `main.rs` (produkcyjny URL) i testowego harnessu
/// (`sqlite::memory:`) — różni się tylko `db_url`.
pub async fn build_pool(db_url: &str) -> anyhow::Result<sqlx::SqlitePool> {
    let db_opts: SqliteConnectOptions =
        db_url.parse::<SqliteConnectOptions>().context("invalid PV_DB_URL")?.create_if_missing(true);
    let db = SqlitePoolOptions::new().max_connections(8).connect_with(db_opts).await.context("db connect")?;
    sqlx::migrate!("./migrations").run(&db).await.context("migrations")?;
    Ok(db)
}
