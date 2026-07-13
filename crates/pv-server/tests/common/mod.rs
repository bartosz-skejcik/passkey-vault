//! Wspólny harness testów integracyjnych: migrowana, in-memory baza + router
//! zbudowany na tym samym `pv_server::routes::router`/`AppState` co binarka.

use sqlx::sqlite::SqlitePoolOptions;

/// `max_connections(1)` na zwykłym (bez shared-cache) `sqlite::memory:` URI
/// jest bezpieczne dla tych testów: każdy `oneshot()` obsługuje jedno
/// żądanie na raz, więc nigdy nie potrzeba drugiego równoległego połączenia
/// (patrz 02-RESEARCH.md Pitfall 2 — każde NOWE połączenie do gołego
/// `:memory:` dostaje własną, pustą bazę; przy jednym połączeniu w puli ten
/// problem nie występuje).
pub async fn test_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite pool");
    sqlx::migrate!("./migrations").run(&pool).await.expect("run migrations");
    pool
}

pub fn test_app(pool: sqlx::SqlitePool) -> axum::Router {
    pv_server::routes::router(pv_server::AppState { db: pool, session_ttl_hours: 168 })
}
