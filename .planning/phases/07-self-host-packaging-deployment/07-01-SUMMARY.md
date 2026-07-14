---
phase: 07-self-host-packaging-deployment
plan: 01
subsystem: infra
tags: [axum, sqlx, sqlite, tower-http, webauthn-rs, docker-readiness, graceful-shutdown]

requires:
  - phase: 03-passkey-authentication
    provides: "Config's rp_id field with its DEPLOY-02 groundwork doc comment; build_webauthn's Url-parsing pattern reused by validate()"
provides:
  - "Config::validate() — fail-fast, named-value startup error on incoherent non-localhost PV_RP_ID/PV_ORIGIN pairs (DEPLOY-02)"
  - "router(state, static_dir: Option<PathBuf>) — single-port API + static Next.js export with SPA fallback, degrading to API-only without panic (DEPLOY-01)"
  - "build_pool WAL journal mode + 5s busy_timeout for SQLite under sync-hub concurrency"
  - "SIGTERM-aware graceful shutdown alongside existing SIGINT — docker stop now drains cleanly"
affects: [07-02-docker-packaging, 07-03-reverse-proxy-deployment]

tech-stack:
  added: []
  patterns:
    - "router() takes an Option<PathBuf> static-dir parameter (not an AppState/Config field) — read once at router-construction time, matching 07-RESEARCH.md Pattern 2"
    - "ServeDir::fallback(...), not ServeDir::not_found_service(...), for SPA fallback — not_found_service forces a 404 status via tower-http's SetStatus wrapper, which breaks a real SPA client-side route"
    - "Config::validate() as a separate post-construction check (construct-then-validate), mirroring build_pool/build_webauthn's own separation"

key-files:
  created:
    - crates/pv-server/tests/router_static_fallback.rs
  modified:
    - crates/pv-server/src/config.rs
    - crates/pv-server/src/lib.rs
    - crates/pv-server/src/main.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/common/mod.rs
    - crates/pv-server/Cargo.toml

key-decisions:
  - "Used ServeDir::fallback(...) instead of the plan's documented ServeDir::not_found_service(...) — the latter unconditionally rewrites the response status to 404 (tower-http SetStatus), which would make every SPA-fallback hit report 404 to the client even though index.html was correctly served"
  - "Localhost exception scoped to the pair via OR (rp_id == localhost OR origin host is a localhost variant), per 07-CONTEXT.md Area 3 — zero-config defaults keep working with no env vars set"
  - "Did not duplicate webauthn-rs's own IP-address rp_id rejection inside Config::validate() — that check stays solely inside build_webauthn's WebauthnBuilder call"

patterns-established:
  - "Fail-fast config validation: Config::from_env() constructs, Config::validate() checks — called from main() before any I/O (DB connect, Webauthn build, socket bind)"
  - "Single-port static+API serving via router()'s optional static_dir parameter, never panicking when absent"

requirements-completed: [DEPLOY-01, DEPLOY-02]

coverage:
  - id: D1
    description: "Config::validate() fails loudly with a named-value error on an incoherent non-localhost PV_RP_ID/PV_ORIGIN pair (missing scheme, http-not-https, rp_id/origin-host mismatch), while the zero-config localhost default remains Ok"
    requirement: "DEPLOY-02"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/config.rs#mod tests (8 cases: zero_config_localhost_default_is_ok, rp_id_localhost_alone_skips_validation_even_with_nonsense_origin, origin_host_localhost_variant_skips_validation, missing_scheme_in_origin_errors_naming_origin_and_https, http_scheme_for_non_localhost_errors_naming_origin_and_https_requirement, rp_id_origin_host_mismatch_errors_naming_both_values, parent_domain_rp_id_is_ok, exact_match_rp_id_is_ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "router() serves a configured static directory with SPA fallback (any unmatched path resolves to index.html with 200) alongside every /api/* route on one port, degrading to API-only with a warning (never a panic) when the directory is absent"
    requirement: "DEPLOY-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/router_static_fallback.rs#unmatched_path_serves_index_html_spa_fallback, #real_file_is_served_verbatim, #api_routes_are_unaffected_by_static_fallback, #missing_static_dir_degrades_to_api_only_without_panic"
        status: pass
    human_judgment: false
  - id: D3
    description: "SQLite connections opened by build_pool use WAL journal mode and a 5s busy_timeout"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/lib.rs#tests::build_pool_enables_wal_journal_mode"
        status: pass
    human_judgment: false
  - id: D4
    description: "main.rs calls cfg.validate()? immediately after Config::from_env()?, before any I/O; PV_STATIC_DIR is threaded into router(); shutdown_signal() traps both SIGINT and SIGTERM"
    requirement: "DEPLOY-01"
    verification:
      - kind: manual_procedural
        ref: "cargo run -p pv-server & then time kill -TERM $! — logged 'shutting down' and exited near-instantly (exit status 0), not hanging for a SIGKILL grace period"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-14
status: complete
---

# Phase 7 Plan 01: Server Readiness (Config Validation, Static Serving, WAL, Graceful Shutdown) Summary

**`Config::validate()` fail-fast RP_ID/ORIGIN checks, `router()`'s `Option<PathBuf>` SPA-fallback static serving, SQLite WAL + busy_timeout in `build_pool`, and SIGTERM-aware graceful shutdown — the pure-Rust server-side prerequisites for Phase 7's single-container Docker packaging.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-07-14T18:XX:XXZ (session start, pre-recorded)
- **Completed:** 2026-07-14T18:58:00Z
- **Tasks:** 4/4 completed
- **Files modified:** 6 (1 new test file, 5 modified)

## Accomplishments
- `Config::validate()` turns an incoherent non-localhost `PV_RP_ID`/`PV_ORIGIN` pair into a specific, named-value startup error (missing scheme, http-not-https, rp_id/origin-host mismatch), while the zero-config localhost default stays untouched — closes DEPLOY-02
- `router(state, static_dir: Option<PathBuf>)` serves a static Next.js export with SPA fallback alongside every existing `/api/*` route on one port, degrading to API-only with a `tracing::warn!` (never a panic) when the directory is absent — closes DEPLOY-01's routing half
- `build_pool` now opens every SQLite connection with WAL journal mode and a 5-second `busy_timeout`, verified against a real on-disk temp file (not `:memory:`, which cannot honor WAL)
- `main.rs`'s `shutdown_signal()` traps both SIGINT and SIGTERM (`docker stop`'s actual default signal) via `tokio::select!`, manually verified to drain and exit promptly instead of hitting a SIGKILL timeout

## Task Commits

Each task was committed atomically:

1. **Task 1: `Config::validate()` — fail-fast RP_ID/ORIGIN decision table** - `d51aa6b` (feat)
2. **Task 2: SQLite WAL mode + busy_timeout in `build_pool`** - `a36df92` (feat)
3. **Task 3: `router()` gains `Option<PathBuf>` static-dir SPA fallback** - `3da3c15` (feat)
4. **Task 4: Wire `main.rs` — `validate()`, `PV_STATIC_DIR`, SIGTERM shutdown** - `19b8536` (feat)

_All four tasks were TDD or cargo-verified in place; no separate RED/GREEN/REFACTOR commit split was used since each task's tests were authored alongside the implementation and committed together per the plan's task structure._

## Files Created/Modified
- `crates/pv-server/src/config.rs` - Adds `Config::validate()` + `is_localhost_deployment()` + 8-case `mod tests`
- `crates/pv-server/src/lib.rs` - `build_pool` chains `.journal_mode(SqliteJournalMode::Wal)` + `.busy_timeout(Duration::from_secs(5))`; new WAL smoke test
- `crates/pv-server/src/routes/mod.rs` - `router()` gains `static_dir: Option<PathBuf>` param, `ServeDir::fallback(...)` SPA mount, degrade-with-warning path
- `crates/pv-server/src/main.rs` - `cfg.validate()?` before any I/O; `PV_STATIC_DIR` threaded to `router()`; `shutdown_signal()` traps SIGINT + SIGTERM
- `crates/pv-server/tests/common/mod.rs` - `test_app`'s `router()` call updated to `(state, None)`; new `test_app_with_static_dir` helper
- `crates/pv-server/tests/router_static_fallback.rs` - New: 4 integration tests covering the SPA-fallback contract
- `crates/pv-server/Cargo.toml` - `tower-http`'s `"fs"` feature added for `ServeDir`/`ServeFile`

## Decisions Made
- `ServeDir::fallback(...)` instead of the plan-documented `ServeDir::not_found_service(...)` (see Deviations below) — the plan's own `<behavior>` spec required a 200 status for the SPA fallback, which only `.fallback(...)` delivers
- `Config::validate()` implemented as a separate post-construction method rather than folded into `from_env()`, mirroring the crate's existing `build_pool`/`build_webauthn` "construct, then check" convention
- Test fixtures for the WAL smoke test and static-dir fallback tests use real on-disk temp files/directories (via `uuid::Uuid::new_v4()`-namespaced paths under `std::env::temp_dir()`), never `:memory:` or fixed paths, to avoid both the WAL/`:memory:` incompatibility and cross-test collisions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ServeDir::not_found_service` forces HTTP 404 on the SPA fallback — used `.fallback(...)` instead**
- **Found during:** Task 3 (`router()` static-dir SPA fallback)
- **Issue:** The plan's `<interfaces>` section documented `ServeDir::new(dir).not_found_service(ServeFile::new(dir.join("index.html")))` as "the confirmed idiomatic SPA-fallback shape." Verified against `tower-http` 0.6.11's actual source (`src/services/fs/serve_dir/mod.rs`): `not_found_service` is implemented as `self.fallback(SetStatus::new(new_fallback, StatusCode::NOT_FOUND))` — it unconditionally rewrites the response status to 404, regardless of the fallback service's own response. This made the `unmatched_path_serves_index_html_spa_fallback` test fail: the body was correctly `index.html`'s content, but the status was 404 instead of the plan's required 200 (real browsers/SPA routers treat a 404-status HTML response as an error page, not a valid client-side route).
- **Fix:** Used `ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")))` instead of `.not_found_service(...)` — `.fallback(...)` preserves the served file's natural 200 status. Added an inline code comment documenting why, to prevent this from being "fixed" back to the wrong shape by a future reader following the plan's stale interface note.
- **Files modified:** `crates/pv-server/src/routes/mod.rs`
- **Verification:** `cargo test -p pv-server --test router_static_fallback` — all 4 cases pass, including the 200-status SPA-fallback assertion
- **Committed in:** `3da3c15` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bugfix)
**Impact on plan:** Necessary correctness fix — the plan's own `<behavior>` spec required a 200 response for the SPA fallback; the documented API shape could not deliver that. No scope creep, no architectural change.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required. `PV_STATIC_DIR` is a new optional env var (unset by default, preserving today's API-only dev/test behavior); Plan 07-02's Dockerfile will be the first consumer that sets it.

## Next Phase Readiness
- Plan 07-02 (Dockerfile/compose) can now rely on: fail-fast `Config::validate()`, single-port static+API serving via `PV_STATIC_DIR`, WAL-safe SQLite, and SIGTERM-aware graceful shutdown — all four are the literal server-side prerequisites its own plan text names.
- Plan 07-03 (reverse-proxy checks) can rely on the same SIGTERM/graceful-shutdown behavior when validating container stop/restart semantics.
- No blockers. All `cargo build -p pv-server` / `cargo test --workspace` verification is green in this (Docker-unavailable) execution environment; Docker-dependent verification for 07-02/07-03 remains for those plans' own execution.

---
*Phase: 07-self-host-packaging-deployment*
*Completed: 2026-07-14*

## Self-Check: PASSED
All 7 declared files found on disk; all 4 task commit hashes (`d51aa6b`, `a36df92`, `3da3c15`, `19b8536`) found in git log.
