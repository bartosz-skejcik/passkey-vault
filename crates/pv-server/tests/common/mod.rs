//! Wspólny harness testów integracyjnych: migrowana, in-memory baza + router
//! zbudowany na tym samym `pv_server::routes::router`/`AppState` co binarka.

use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use tower::ServiceExt;

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
    let webauthn = pv_server::build_webauthn("localhost", "http://localhost:3000")
        .expect("test webauthn instance");
    pv_server::routes::router(pv_server::AppState { db: pool, session_ttl_hours: 168, webauthn })
}

/// Registers a fixture user (deterministic `auth_hash`/`salt`/`kdf`/
/// `pw_wrapped_uk` values — vault route tests never need real
/// client-side-derived crypto, just a valid session) and logs in, returning
/// the bearer token string. Shared by `tests/vault.rs` so individual tests
/// don't duplicate this register+login boilerplate.
///
/// `#[allow(dead_code)]`: `common/mod.rs` is compiled once per integration
/// test binary (`tests/auth.rs` and `tests/vault.rs` each get their own
/// copy); `tests/auth.rs` doesn't call this helper, which would otherwise
/// warn there even though `tests/vault.rs` uses it throughout.
#[allow(dead_code)]
pub async fn register_and_login(app: &axum::Router, email: &str) -> String {
    let auth_hash = STANDARD.encode([2u8; 32]);
    let register_body = json!({
        "email": email,
        "kdf": { "m_cost_kib": 65536, "t_cost": 3, "p_cost": 4 },
        "salt": STANDARD.encode([1u8; 16]),
        "auth_hash": auth_hash,
        "pw_wrapped_uk": "{\"nonce\":\"AAAA\",\"ciphertext\":\"BBBB\"}",
    });

    let register_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&register_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(register_res.status(), StatusCode::CREATED, "fixture register must succeed");

    let login_body = json!({ "email": email, "auth_hash": auth_hash });
    let login_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&login_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_res.status(), StatusCode::OK, "fixture login must succeed");

    let bytes = to_bytes(login_res.into_body(), usize::MAX).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    body["session_token"].as_str().unwrap().to_string()
}
