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
    /// Built once at startup from `PV_RP_ID`/`PV_ORIGIN` (see
    /// `build_webauthn`) — `Webauthn` derives `Clone` internally, no `Arc`
    /// wrapper needed here.
    pub webauthn: webauthn_rs::prelude::Webauthn,
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

/// Buduje `Webauthn` z `PV_RP_ID`/`PV_ORIGIN`, fail-loud na niespójną parę
/// (03-CONTEXT.md — musi rzucić błąd przy starcie, nie po cichu zbudować
/// instancję, która odrzuci każdą ceremonię w runtime; groundwork dla
/// Fazy 7's DEPLOY-02).
pub fn build_webauthn(rp_id: &str, rp_origin: &str) -> anyhow::Result<webauthn_rs::prelude::Webauthn> {
    let origin_url = webauthn_rs::prelude::Url::parse(rp_origin).context("invalid PV_ORIGIN")?;
    let webauthn = webauthn_rs::prelude::WebauthnBuilder::new(rp_id, &origin_url)
        .context("PV_RP_ID must be an effective domain of PV_ORIGIN")?
        .build()
        .context("failed to build Webauthn instance")?;
    Ok(webauthn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_webauthn_rejects_mismatched_rp_id_origin() {
        assert!(build_webauthn("example.com", "https://not-example.com").is_err());
    }

    #[test]
    fn build_webauthn_accepts_matching_pair() {
        assert!(build_webauthn("localhost", "http://localhost:3000").is_ok());
    }
}
