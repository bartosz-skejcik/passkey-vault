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
    let dummy_secret: [u8; 32] =
        pv_core::keys::random_bytes(32).try_into().expect("random_bytes(32) must return 32 bytes");
    pv_server::routes::router(
        pv_server::AppState {
            db: pool,
            session_ttl_hours: 168,
            webauthn,
            rp_id: "localhost".to_string(),
            dummy_secret,
            sync_hub: Default::default(),
        },
        None,
    )
}

/// Same `AppState` construction as `test_app`, but threads `Some(static_dir)`
/// into `router()` instead of `None` — used only by
/// `tests/router_static_fallback.rs` to exercise the SPA-fallback contract
/// (Phase 7, DEPLOY-01).
///
/// `#[allow(dead_code)]`: `common/mod.rs` is compiled once per integration
/// test binary; only `tests/router_static_fallback.rs` calls this helper,
/// which would otherwise warn in every other test binary compiling this same
/// `common` module (mirrors `register_and_login`'s/`test_server`'s own
/// treatment below).
#[allow(dead_code)]
pub fn test_app_with_static_dir(pool: sqlx::SqlitePool, static_dir: std::path::PathBuf) -> axum::Router {
    let webauthn = pv_server::build_webauthn("localhost", "http://localhost:3000")
        .expect("test webauthn instance");
    let dummy_secret: [u8; 32] =
        pv_core::keys::random_bytes(32).try_into().expect("random_bytes(32) must return 32 bytes");
    pv_server::routes::router(
        pv_server::AppState {
            db: pool,
            session_ttl_hours: 168,
            webauthn,
            rp_id: "localhost".to_string(),
            dummy_secret,
            sync_hub: Default::default(),
        },
        Some(static_dir),
    )
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

/// Binds a real `TcpListener` and serves the given `app` `Router` from it in
/// a background task, returning `(app, port)`. `oneshot()` cannot perform a
/// real HTTP Upgrade handshake (05-RESEARCH.md Pitfall 2) and cannot prove a
/// genuinely bound-socket preflight (Task 2, 19-01-PLAN.md), so both
/// `tests/sync.rs`'s WS tests and `tests/cors_preflight.rs` need an actual
/// socket to connect against.
///
/// CRITICAL: the caller must keep using the SAME `app` `Router` clone this
/// function was given for driving further requests — `Router` is cheaply
/// `Clone` (internally `Arc`-based), so both clones share the exact same
/// `AppState`. Building a fresh router instead would construct a DIFFERENT
/// `AppState` and silently diverge from what's actually being served.
///
/// `#[allow(dead_code)]`: not every integration test binary that compiles
/// this `common` module calls this helper (mirrors `register_and_login`'s
/// own treatment above).
#[allow(dead_code)]
pub async fn serve_router(app: axum::Router) -> (axum::Router, u16) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind ephemeral port");
    let port = listener.local_addr().unwrap().port();
    let serve_app = app.clone();
    tokio::spawn(async move {
        axum::serve(listener, serve_app).await.expect("test server crashed");
    });
    (app, port)
}

/// `test_server(pool)` is `serve_router(test_app(pool))` — kept as a named
/// wrapper since `tests/sync.rs` calls it this way throughout.
///
/// `#[allow(dead_code)]`: only `tests/sync.rs` calls this helper (mirrors
/// `register_and_login`'s own treatment above).
#[allow(dead_code)]
pub async fn test_server(pool: sqlx::SqlitePool) -> (axum::Router, u16) {
    serve_router(test_app(pool)).await
}

/// Same `AppState` construction as `test_app`, but calls
/// `pv_server::routes::build_cors_layer` directly and threads the result
/// through `router_with_cors` instead of going through the env-reading
/// `cors_layer()` wrapper — mirrors `test_app_with_static_dir`'s established
/// `test_app_with_X()` precedent and avoids mutating process env vars under
/// parallel `cargo test` (19-01-PLAN.md Open Question 2's resolution). Used
/// by `tests/cors_preflight.rs` (SEC-01's real-server preflight proof).
///
/// `#[allow(dead_code)]`: only `tests/cors_preflight.rs` calls this helper
/// (mirrors `test_app_with_static_dir`'s own treatment above).
#[allow(dead_code)]
pub fn test_app_with_cors(pool: sqlx::SqlitePool, extension_origins_csv: &str) -> axum::Router {
    let webauthn = pv_server::build_webauthn("localhost", "http://localhost:3000")
        .expect("test webauthn instance");
    let dummy_secret: [u8; 32] =
        pv_core::keys::random_bytes(32).try_into().expect("random_bytes(32) must return 32 bytes");
    let cors = pv_server::routes::build_cors_layer(false, extension_origins_csv);
    pv_server::routes::router_with_cors(
        pv_server::AppState {
            db: pool,
            session_ttl_hours: 168,
            webauthn,
            rp_id: "localhost".to_string(),
            dummy_secret,
            sync_hub: Default::default(),
        },
        None,
        cors,
    )
}
