# Phase 7: Self-Host Packaging & Deployment - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 12
**Analogs found:** 7 / 12 (5 are new-subsystem infra files with no in-repo code analog — mapped to RESEARCH.md's own worked examples instead)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `crates/pv-server/src/config.rs` (+ `Config::validate()`) | config / crypto-adjacent guard | transform (validate, then use) | same file's existing `Config::from_env()`; `crates/pv-core/src/kdf.rs`'s "validate input length, then use" style | exact (role+shape) |
| `crates/pv-server/src/lib.rs` (`build_pool` + WAL/busy_timeout) | service (DB setup) | request-response (connect once at boot) | same file's existing `.create_if_missing(true)` chain | exact (edit in place, additive builder calls) |
| `crates/pv-server/src/main.rs` (`cfg.validate()?` call + SIGTERM handling in `shutdown_signal`) | entry point | control flow (fail-fast boot sequence) | same file's existing `Config::from_env()?` → `build_pool`/`build_webauthn` sequencing; `shutdown_signal()`'s existing `ctrl_c()` future | exact |
| `crates/pv-server/src/routes/mod.rs` (`router()` + `static_dir` param + SPA fallback) | HTTP routing | request-response | same file's existing `router(state: AppState) -> Router` signature + `cors_layer()`'s doc-comment forward-reference to this exact phase | exact |
| `crates/pv-server/Cargo.toml` (`tower-http` gains `"fs"` feature) | config | — | same file's existing `tower-http = { ..., features = ["trace", "cors"] }` line | exact (edit in place) |
| `crates/pv-server/tests/config_validate.rs` | test (integration) | transform (assert on `Result`) | `crates/pv-server/src/lib.rs`'s own `#[cfg(test)] mod tests` (`build_webauthn_rejects_mismatched_rp_id_origin`, `build_webauthn_accepts_matching_pair`) | exact — same decision-table-of-pass/fail-cases shape, one level up (integration test crate vs. inline `mod tests`) |
| `crates/pv-server/src/main.rs`'s `span_uri_field` pure-fn/pure-test pattern | test (unit, pre-existing) | — | reused as the template for the new `is_localhost_deployment`/URL-parsing helpers inside `config.rs` — factor validation sub-checks into small pure fns, unit-test each independently of a real env | exact |
| `Dockerfile` (repo root, 3-stage build) | build/ops | build pipeline | no in-repo code analog — first Dockerfile in the repo; use RESEARCH.md's "Recommended Project Structure" + Pattern 1 (WASM-artifact staging) verbatim | none (new infra) |
| `docker-compose.yml` / `.env.example` / `.dockerignore` (repo root) | build/ops config | — | no in-repo analog; `.env.example`'s var table mirrors `config.rs`'s existing `PV_*` env var names 1:1 (`PV_ADDR`, `PV_DB_URL`, `PV_SESSION_TTL_HOURS`, `PV_RP_ID`, `PV_ORIGIN`) plus new `PV_STATIC_DIR` | partial (env var names are the analog, file shape is new) |
| `deploy/nginx.conf.example`, `deploy/Caddyfile.example` | ops docs | — | no in-repo analog; closes the gap `main.rs`'s `make_span`/WR-02 doc comment already names by forward-reference ("Phase 7's Docker packaging must separately document...") — that comment is the direct textual source for what these files must contain | none (new infra), but content obligation is pre-specified in-repo |
| `docs/SELF-HOSTING.md` | docs | — | `docs/ARCHITECTURE.md` / `docs/README.md` (existing docs style/tone in `docs/`) | role-match |
| `Config`'s new `PV_STATIC_DIR` field / router param | config wiring | — | `config.rs`'s existing `rp_id`/`rp_origin` fields, whose doc comment already explicitly forward-references "groundwork for Phase 7's DEPLOY-02" — same convention of a field added now for a later-phase consumer | exact |

## Pattern Assignments

### `crates/pv-server/src/config.rs` (+ `Config::validate()`)

**Analog:** same file's existing `Config` struct + `from_env()`, and the field-level doc comment already on `rp_id` (lines 6-9) that names this exact phase.

**Existing shape to extend, not replace:**
```rust
pub struct Config {
    pub addr: String,
    pub db_url: String,
    pub session_ttl_hours: u64,
    pub rp_id: String,
    pub rp_origin: String,
}

impl Config {
    pub fn from_env() -> Result<Self> { ... }
}
```
Add `Config::validate(&self) -> anyhow::Result<()>` as a **separate method**, not inlined into `from_env()` — mirrors this crate's existing separation of "construct" (`from_env`) from "check" (a distinct call site in `main.rs`), and mirrors `pv-core/src/kdf.rs`'s validate-then-use convention cited in 07-RESEARCH.md Pattern 3. Every `anyhow::bail!`/`.context(...)` inside `validate()` must follow the exact `.context("invalid PV_DB_URL")`-style short, specific message already established by `from_env`'s sibling `build_pool`/`build_webauthn` (in `lib.rs`) — name the offending env var literally (`PV_ORIGIN={:?}`, `PV_RP_ID={:?}`) in every error, never a bare "invalid config."

Add a new field for Area 2's static-dir wiring (07-RESEARCH.md Pattern 2 recommends a `router()` parameter over an `AppState`/`Config` field — if plan time confirms that recommendation, `Config` gains no new field for this; if instead threaded through `Config`, add `pub static_dir: Option<String>` read via `PV_STATIC_DIR` in `from_env()`, following the exact `std::env::var("PV_...").ok()` pattern already used for `rp_id`/`rp_origin`/`session_ttl_hours`).

**Test pattern:** keep decision-table cases as an integration test file (`crates/pv-server/tests/config_validate.rs`), constructing bare `Config { .. }` struct literals directly (all fields are `pub`, no builder needed) rather than going through `from_env()`'s env-var indirection — this avoids the flakiness of mutating process env vars across parallel `cargo test` threads. Follow `lib.rs`'s existing `mod tests` naming style (`fn accepts_localhost_default()`, `fn rejects_missing_scheme()`, `fn rejects_rp_id_origin_mismatch()`, `fn rejects_http_for_non_localhost()`) — one `#[test]` per row of the CONTEXT.md Area 3 decision table.

---

### `crates/pv-server/src/lib.rs` (`build_pool` + WAL/busy_timeout pragmas)

**Analog:** same file's existing `build_pool` body — a small, additive edit, not a new function.

```rust
pub async fn build_pool(db_url: &str) -> anyhow::Result<sqlx::SqlitePool> {
    let db_opts: SqliteConnectOptions =
        db_url.parse::<SqliteConnectOptions>().context("invalid PV_DB_URL")?.create_if_missing(true);
    let db = SqlitePoolOptions::new().max_connections(8).connect_with(db_opts).await.context("db connect")?;
    sqlx::migrate!("./migrations").run(&db).await.context("migrations")?;
    Ok(db)
}
```
Chain `.journal_mode(SqliteJournalMode::Wal)` and `.busy_timeout(Duration::from_secs(5))` onto the existing `db_opts` builder chain (import `sqlx::sqlite::SqliteJournalMode` and `std::time::Duration` at the top alongside the existing `sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions}` import) — same `.method(...)` builder-chaining style already used for `.create_if_missing(true)`, no new error-handling branch needed (these builder methods are infallible). The two existing `build_webauthn_rejects_mismatched_rp_id_origin`/`build_webauthn_accepts_matching_pair` tests in this file's `mod tests` are unaffected; no new test is strictly required here since these are non-branching connect-option settings, though a smoke test asserting `PRAGMA journal_mode` reports `wal` after `build_pool("sqlite::memory:")` would follow the same `#[test]` style already present.

---

### `crates/pv-server/src/main.rs` (`cfg.validate()?` call + SIGTERM handling)

**Analog:** same file's existing boot sequence and `shutdown_signal()`.

```rust
let cfg = Config::from_env()?;
let db = build_pool(&cfg.db_url).await?;
let webauthn = build_webauthn(&cfg.rp_id, &cfg.rp_origin)?;
```
Insert `cfg.validate()?;` immediately after `Config::from_env()?` and before `build_pool` — earliest possible failure point, exactly as CONTEXT.md Area 3 and RESEARCH.md Pattern 3 specify. This is a one-line addition to an already-linear `?`-chained sequence, matching the file's existing error-propagation idiom exactly (no new error type, no `match`, just another `?`).

```rust
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
```
Extend with a `tokio::select!` between the existing `ctrl_c()` future and a new `tokio::signal::unix::signal(SignalKind::terminate())` stream (RESEARCH.md Pitfall 4 / Anti-Patterns) — same function name, same call site (`axum::serve(...).with_graceful_shutdown(shutdown_signal())`), only the body's internals change from a single `.await` to a `tokio::select!` of two signal sources, logging which one fired via the existing `tracing::info!("shutting down")` call (extend the message to name which signal, following this file's existing `tracing::info!`/`tracing::debug_span!` structured-logging convention).

The `#[cfg(test)] mod tests` block at the bottom (`span_uri_field` unit tests) is the template for any new pure-fn extraction here — if the SIGTERM/SIGINT select logic needs a testable seam, factor it the same way `span_uri_field` was factored out of `make_span` (pure helper, directly unit-tested, no tracing subscriber needed).

---

### `crates/pv-server/src/routes/mod.rs` (`router()` + static-dir SPA fallback)

**Analog:** same file's existing `router(state: AppState) -> Router` function and its `cors_layer()` doc comment, which already names this exact phase by forward-reference ("Phase 7's Docker packaging serves both the API and the static web export from one origin in production").

```rust
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        // ...all existing /api/* routes, unchanged...
        .with_state(state)
        .layer(cors_layer())
}
```
Add a second parameter per RESEARCH.md Pattern 2's recommendation (`Option<PathBuf>`, not a new `AppState` field, since a static dir path is read once at router-construction time rather than per-request the way `AppState`'s cloned fields are): `pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router`. Build the `/api/*` sub-router exactly as today, then conditionally `.fallback_service(ServeDir::new(&dir).not_found_service(ServeFile::new(dir.join("index.html"))))` only when `static_dir.filter(|d| d.is_dir())` is `Some` — logging `tracing::warn!(...)` and falling through to API-only when `None`/not-a-directory, so every existing call site in `crates/pv-server/tests/*.rs` that calls `router(state)` today needs updating to `router(state, None)` and continues to pass unmodified otherwise. This directly follows the file's existing "small function, additive change, doc-comment names the phase" convention already visible in `cors_layer()`.

`main.rs`'s call site (`routes::router(state)`) becomes `routes::router(state, std::env::var("PV_STATIC_DIR").ok().map(PathBuf::from))`, read the same `std::env::var(...).ok()` way `PV_DEV_CORS` is already read inside `cors_layer()` in this same file.

---

### `crates/pv-server/Cargo.toml` (`tower-http` `"fs"` feature)

**Analog:** the existing dependency line itself.

```toml
tower-http = { version = "0.6", features = ["trace", "cors"] }
```
→
```toml
tower-http = { version = "0.6", features = ["trace", "cors", "fs"] }
```
Single-line edit, no new dependency entry, no `[workspace.dependencies]` change needed (this crate declares `tower-http` directly rather than via `.workspace = true`, matching its current form — confirmed by reading the file).

---

### `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore`, `deploy/*.example` — new infra, no in-repo analog

**Analog:** none — first Docker/reverse-proxy artifacts in this repo. Use 07-RESEARCH.md's own "Recommended Project Structure," "Architecture Patterns" diagram, and Patterns 1/4/5's complete worked code examples as the template verbatim rather than searching for an in-repo precedent that doesn't exist. The one concrete in-repo tie-in: `.env.example`'s variable names must exactly match `config.rs`'s existing `std::env::var("PV_...")` calls (`PV_ADDR`, `PV_DB_URL`, `PV_SESSION_TTL_HOURS`, `PV_RP_ID`, `PV_ORIGIN`) plus the new `PV_STATIC_DIR` — no invented/renamed variables, per CONTEXT.md Area 3's explicit "no `PV_PUBLIC_URL` alias" decision.

`deploy/nginx.conf.example` and `deploy/Caddyfile.example`'s access-log token-stripping sections have a direct textual source in this repo: `main.rs`'s `make_span`/`span_uri_field` doc comment (already quoted in 07-CONTEXT.md and 07-RESEARCH.md) explicitly obligates these two files to document the proxy-side half of the redaction its own WR-02 fix only covers server-side. Both example configs' comments should cross-reference that doc comment by name (mirroring this project's established forward/back-reference convention already used across `config.rs`/`main.rs`/`routes/mod.rs`).

---

### `docs/SELF-HOSTING.md`

**Analog:** `docs/ARCHITECTURE.md` (existing docs-directory tone/structure — read at plan time for heading style/voice before writing this file, since it's the closest available style precedent in `docs/`).

## Shared Patterns

### `anyhow::Context`-chained, specifically-worded errors
**Source:** `crates/pv-server/src/lib.rs`'s `build_pool`/`build_webauthn` (`.context("invalid PV_DB_URL")`, `.context("db connect")`, `.context("migrations")`, `.context("PV_RP_ID must be an effective domain of PV_ORIGIN")`)
**Apply to:** every new `Config::validate()` failure branch — same idiom, no new error style, each message must name the specific offending env var and value.

### Small pure functions, independently unit-tested
**Source:** `crates/pv-server/src/main.rs`'s `span_uri_field` (factored out of `make_span` purely so it's testable without a tracing subscriber)
**Apply to:** `Config::validate()`'s sub-checks (`is_localhost_deployment`, the scheme check, the rp_id/host relationship check) — factor each into a small named helper so `crates/pv-server/tests/config_validate.rs` can assert on them directly.

### Doc comments that forward/back-reference phases by name
**Source:** `config.rs`'s `rp_id` field comment ("groundwork for Phase 7's DEPLOY-02"); `main.rs`'s WR-02 comment ("Phase 7's Docker packaging must separately document..."); `routes/mod.rs`'s `cors_layer()` comment ("Phase 7's Docker packaging serves both... from one origin")
**Apply to:** every new doc comment this phase writes should close these three loops explicitly by name (e.g. `Config::validate()`'s doc comment should say "implements the validation promised by `rp_id`'s field comment above, closing DEPLOY-02") — this project's established convention, not a new one to invent.

### Test call-site updates for a widened function signature
**Source:** none needed previously in this crate (no prior `router()` signature change) — but the general convention (integration tests build `AppState`/`router()` directly, per `07-CONTEXT.md`/`07-RESEARCH.md` and `crates/pv-server/tests/` file listing: `auth.rs`, `passkey_login.rs`, `passkeys.rs`, `sessions.rs`, `sync.rs`, `unlock.rs`, `vault.rs`) means **every** file in `crates/pv-server/tests/` that currently calls `router(state)` must be updated to `router(state, None)` in the same commit that changes the signature — grep for `router(` across `crates/pv-server/tests/*.rs` before landing the signature change to catch every call site.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `Dockerfile` | build/ops | build pipeline | First Dockerfile in the repo; 07-RESEARCH.md's 3-stage diagram + Pattern 1 (WASM staging) is the template instead |
| `docker-compose.yml`, `.env.example`, `.dockerignore` | build/ops config | — | First Docker Compose artifacts; 07-RESEARCH.md's "Code Examples" section has a complete worked `docker-compose.yml` |
| `deploy/nginx.conf.example` | ops docs | — | First reverse-proxy config in the repo; 07-RESEARCH.md Pattern 4 has the complete worked example |
| `deploy/Caddyfile.example` | ops docs | — | First reverse-proxy config in the repo; 07-RESEARCH.md Pattern 5 has the complete worked example |
| `docs/SELF-HOSTING.md` | docs | — | No prior self-hosting walkthrough doc; use `docs/ARCHITECTURE.md`'s tone as a style (not content) precedent |

## Metadata

**Analog search scope:** `crates/pv-server/src/config.rs`, `crates/pv-server/src/main.rs`, `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/src/lib.rs`, `crates/pv-server/Cargo.toml`, `crates/pv-server/tests/`, `docs/`
**Files scanned:** 7 read in full (`config.rs`, `main.rs`, `routes/mod.rs`, `lib.rs`, `Cargo.toml`) + directory listings (`tests/`, `docs/`) + 06-PATTERNS.md read as format precedent
**Pattern extraction date:** 2026-07-14
