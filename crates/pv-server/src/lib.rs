//! Biblioteka `pv-server` — dzielona przez binarkę (`main.rs`) i testy
//! integracyjne (`tests/`), żeby oba mogły budować identyczny router i
//! AppState bez duplikacji logiki setupu bazy/migracji.

pub mod config;
pub mod crypto;
pub mod error;
pub mod routes;

use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::time::Duration;

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
    /// Same value threaded into `build_webauthn`'s `rp_id` — carried
    /// separately because `webauthn_rs::prelude::Webauthn` exposes no public
    /// `rp_id` getter (only `get_allowed_origins()` is public). The
    /// enumeration-resistant dummy path in `routes::auth::passkey_login_start`
    /// never calls `start_passkey_authentication` (so never gets a real
    /// `rpId` for free) and needs its own source of truth to byte-match the
    /// real path's `rpId` field (Phase 4, AUTH-04).
    pub rp_id: String,
    /// Server-only key mixed into the dummy `passkey_login_start` branch's
    /// per-email `allowCredentials` derivation (WR-01). Never serialized or
    /// sent to any client. Without this, the derivation formula (per-email
    /// hash) would be entirely public (open-source server) — an attacker
    /// could precompute the exact expected dummy credential id for any
    /// candidate email and use an exact-match test as an account-existence
    /// oracle. Generated fresh at process startup — it only needs to be
    /// stable for the lifetime of one running server (so repeated probes of
    /// the same email within one uptime are byte-stable, matching a real
    /// account's stable passkey list), not persisted across restarts.
    pub dummy_secret: [u8; 32],
    /// In-process per-user WebSocket fan-out hub (SYNC-02, Plan 05-02) — see
    /// `routes::sync::SyncHub`'s own doc comment. `Clone`-internally shape
    /// (`Arc<Mutex<...>>`), mirroring this struct's `webauthn` field
    /// precedent for a shared resource built once and cloned cheaply per
    /// request via axum's `State` extractor.
    pub sync_hub: crate::routes::sync::SyncHub,
}

/// Łączy się z bazą (tworząc plik, jeśli brakuje) i uruchamia migracje.
/// Wspólna ścieżka dla `main.rs` (produkcyjny URL) i testowego harnessu
/// (`sqlite::memory:`) — różni się tylko `db_url`.
pub async fn build_pool(db_url: &str) -> anyhow::Result<sqlx::SqlitePool> {
    let db_opts: SqliteConnectOptions = db_url
        .parse::<SqliteConnectOptions>()
        .context("invalid PV_DB_URL")?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
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

    /// WAL mode requires real file-backed storage — `sqlite::memory:` cannot
    /// honor it, so this smoke test MUST use a real on-disk temp file (see
    /// 07-RESEARCH.md / this plan's `<interfaces>`), or the assertion below
    /// would not actually exercise the new `journal_mode`/`busy_timeout`
    /// builder calls.
    #[tokio::test]
    async fn build_pool_enables_wal_journal_mode() {
        let path = std::env::temp_dir().join(format!("pv-test-wal-{}.db", uuid::Uuid::new_v4()));
        let db_url = format!("sqlite://{}", path.display());

        let pool = build_pool(&db_url).await.expect("build_pool against real temp file");
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .expect("PRAGMA journal_mode");
        assert_eq!(journal_mode.to_lowercase(), "wal");

        drop(pool);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(format!("{}-wal", path.display()));
        let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    }
}
