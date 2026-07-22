---
phase: 02-password-auth-vault-core
plan: 02
subsystem: auth
tags: [axum, sqlx, sqlite, sha2, base64, session, bearer-token, tower-http-cors]

# Dependency graph
requires:
  - phase: 02-password-auth-vault-core (plan 01)
    provides: pv_core::kdf::auth_hash_from_password, pv_core::keys::INFO_AUTH_HASH, pv-wasm derive_auth_material single-pass export
provides:
  - "pv-server lib+bin split (pv_server::AppState, pv_server::build_pool) so tests/ can import the router"
  - "Typed ApiError (thiserror) with IntoResponse mapping 400/401/404/409/500 and From<sqlx::Error>"
  - "Server-only crypto helpers: server_rehash, hash_token, constant_time_eq"
  - "SessionUser FromRequestParts<AppState> extractor validating bearer tokens hashed at rest"
  - "migrations/0002_auth_hash.sql — users.auth_hash / users.auth_hash_salt"
  - "Real POST /api/auth/{prelogin,register,login,logout} and GET /api/auth/me endpoints"
  - "crates/pv-server/tests/{common/mod.rs,auth.rs} — in-memory migrated SQLite integration harness"
affects: [02-03 (vault items/folders routes reuse SessionUser/ApiError/runtime-checked-sqlx decision), 02-04 (web client consumes these exact wire shapes)]

# Tech tracking
tech-stack:
  added:
    - "sha2 0.10 (direct pv-server dependency, was transitive via pv-core)"
    - "base64 0.22 (direct pv-server dependency)"
    - "tower-http cors feature (CorsLayer::permissive(), dev-mode only)"
    - "tower 0.5 (dev-dependency, ServiceExt::oneshot for integration tests)"
  patterns:
    - "lib.rs + thin main.rs split so integration tests import pv_server::{AppState, routes::router} directly"
    - "Runtime-checked sqlx::query/query_as (no query!/query_as! macros) — documented deviation from CLAUDE.md's compile-time-checked-queries convention, applies to this plan and 02-03"
    - "ApiError thiserror enum mirroring pv_core::CryptoError's derive shape, IntoResponse instead of anyhow propagation"
    - "Server-side crypto (server_rehash/hash_token/constant_time_eq) deliberately NOT in pv-core — server-only, never runs client-side"

key-files:
  created:
    - crates/pv-server/src/lib.rs
    - crates/pv-server/src/error.rs
    - crates/pv-server/src/crypto.rs
    - crates/pv-server/src/routes/session.rs
    - crates/pv-server/migrations/0002_auth_hash.sql
    - crates/pv-server/tests/common/mod.rs
    - crates/pv-server/tests/auth.rs
  modified:
    - crates/pv-server/Cargo.toml
    - crates/pv-server/src/main.rs
    - crates/pv-server/src/config.rs
    - crates/pv-server/src/routes/auth.rs
    - crates/pv-server/src/routes/mod.rs

key-decisions:
  - "Runtime-checked sqlx::query (not query!/query_as!) throughout — avoids requiring a live DATABASE_URL or committed .sqlx offline cache for every contributor; documented as a deviation from CLAUDE.md's stated convention, applies equally to Plan 02-03"
  - "AppState carries session_ttl_hours: u64 (not the whole Config) so the test harness can fix a TTL without needing env vars"
  - "Bearer token is hashed in its base64 (wire) representation everywhere — login, SessionUser extractor, and logout all hash the same string bytes, never the pre-encoding raw bytes"
  - "server_rehash uses SHA-256 (not a second Argon2id pass) — auth_hash is already a 256-bit HKDF output by the time it reaches the server; documented inline per 02-RESEARCH.md Pitfall 3"

patterns-established:
  - "Pattern: axum FromRequestParts<AppState> extractor (SessionUser) — first one in this codebase, reusable for future protected routes (02-03's vault/folders)"
  - "Pattern: extract_bearer_token(&HeaderMap) shared helper avoids duplicating Authorization-header parsing between the extractor and logout's token-hash-to-delete need"

requirements-completed: [AUTH-01, AUTH-02]

coverage:
  - id: D1
    description: "POST /api/auth/register creates a user with a server-side re-hash of the client auth_hash (never stored verbatim); duplicate email returns 409 with no second row created"
    requirement: "AUTH-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#register_then_duplicate_email_returns_conflict"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/auth/login verifies auth_hash via constant-time comparison and issues a session token + pw_wrapped_uk; wrong auth_hash and unknown email both return an identical 401 body"
    requirement: "AUTH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#login_with_wrong_auth_hash_is_unauthorized"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#login_with_nonexistent_email_returns_same_shape_as_wrong_auth_hash"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#full_register_login_me_logout_flow"
        status: pass
    human_judgment: false
  - id: D3
    description: "SessionUser extractor rejects requests with no/invalid/expired bearer token with 401; GET /api/auth/me returns 200 with user_id/email/pw_wrapped_uk for a valid session"
    requirement: "AUTH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#me_without_token_is_unauthorized"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#full_register_login_me_logout_flow"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /api/auth/logout deletes the session row by token_hash; the same token then fails on a subsequent /me call"
    requirement: "AUTH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#full_register_login_me_logout_flow"
        status: pass
    human_judgment: false
  - id: D5
    description: "Prelogin responses are shape-identical and deterministic for unknown vs. real accounts (anti-enumeration)"
    requirement: "AUTH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#prelogin_unknown_email_is_shape_identical_and_deterministic"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/auth.rs#prelogin_unknown_email_dummy_salt_differs_from_real_account"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 02 Plan 02: Password Auth API Summary

**Real axum auth API (`prelogin`/`register`/`login`/`logout`/`me`) over a hashed bearer-token `SessionUser` extractor, backed by a new `pv-server` lib+bin split and an in-memory integration-test harness — the server never stores a password, a wrapping key, or a client-computed auth_hash verbatim.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 12 (7 created, 5 modified) + Cargo.lock

## Accomplishments
- Split `pv-server` into a thin `main.rs` binary and a real `lib.rs` (`AppState`, `build_pool`) so integration tests can exercise the exact same router the binary serves.
- Added a typed `ApiError` (thiserror, `IntoResponse` for 400/401/404/409/500, `From<sqlx::Error>` that logs and never leaks DB internals).
- Added server-only `crypto.rs` (`server_rehash`, `hash_token`, hand-rolled constant-time `constant_time_eq`) — deliberately outside `pv-core` since this logic never runs client-side.
- Added the first `FromRequestParts` extractor in the codebase (`SessionUser`), validating bearer tokens hashed at rest against `sessions.token_hash`.
- Implemented real `prelogin` (DB lookup + anti-enumeration deterministic dummy salt), `register` (atomic `INSERT ... ON CONFLICT DO NOTHING`), `login` (constant-time auth_hash verification, session issuance), `logout` (session deletion), and `me` (returns `pw_wrapped_uk` to an authenticated session).
- Added `crates/pv-server/tests/{common/mod.rs,auth.rs}` — an in-memory, migrated-SQLite integration harness using `tower::ServiceExt::oneshot`, covering every `<behavior>` case in the plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: lib+bin split, ApiError, SessionUser extractor, migration, test harness** - `cff1f3e` (feat)
2. **Task 2: prelogin/register/login/logout/me handlers** - TDD, two commits:
   - `5f1045c` (test) — RED: failing integration tests for all 6 behaviors
   - `e19d96f` (feat) — GREEN: real handlers, all tests pass

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `crates/pv-server/src/lib.rs` - New library crate root: `AppState`, `build_pool`
- `crates/pv-server/src/main.rs` - Rewritten as a thin binary calling into `pv_server::`
- `crates/pv-server/src/error.rs` - `ApiError` (thiserror) + `IntoResponse` + `From<sqlx::Error>`
- `crates/pv-server/src/crypto.rs` - `server_rehash`, `hash_token`, `constant_time_eq`
- `crates/pv-server/src/routes/session.rs` - `SessionUser` extractor + `extract_bearer_token` helper
- `crates/pv-server/src/routes/auth.rs` - Real `prelogin`/`register`/`login`/`logout`/`me` handlers
- `crates/pv-server/src/routes/mod.rs` - Registers new routes, adds `CorsLayer::permissive()`
- `crates/pv-server/src/config.rs` - `session_ttl_hours` from `PV_SESSION_TTL_HOURS` (default 168)
- `crates/pv-server/migrations/0002_auth_hash.sql` - `users.auth_hash`/`auth_hash_salt` columns
- `crates/pv-server/tests/common/mod.rs` - `test_pool`/`test_app` harness helpers
- `crates/pv-server/tests/auth.rs` - Integration tests for all 6 `<behavior>` cases
- `crates/pv-server/Cargo.toml` - `sha2`, `base64` direct deps; `tower-http` cors feature; `tower` dev-dep

## Decisions Made
- Runtime-checked `sqlx::query` throughout (no `query!`/`query_as!` macros) — documented deviation from CLAUDE.md's compile-time-checked-queries convention; avoids requiring `DATABASE_URL`/`.sqlx` cache setup for every contributor. Applies equally to Plan 02-03's vault/folders routes (not re-litigated there).
- `AppState` carries `session_ttl_hours: u64` directly (not the whole `Config`) so the test harness can fix a TTL value without reading env vars.
- Bearer tokens are hashed consistently in their base64 (wire) representation across `login`, `SessionUser`, and `logout` — see Deviations below for why this needed a fix mid-implementation.
- `server_rehash` uses SHA-256, not a second Argon2id pass — `auth_hash` is already a 256-bit HKDF output before the server sees it; a second slow KDF adds CPU cost with no additional offline-guessing resistance (per 02-RESEARCH.md Pitfall 3 / palant.info critique).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed bearer-token hash mismatch between login and SessionUser extractor**
- **Found during:** Task 2 GREEN implementation, running `cargo test -p pv-server`
- **Issue:** `login` hashed the raw pre-base64-encoding random bytes (`crypto::hash_token(&token)`) before storing `token_hash`, while `SessionUser`'s extractor and `logout` both hash the base64 *string* bytes read from the `Authorization` header (`crypto::hash_token(token.as_bytes())` where `token` is the decoded header string, never re-decoded from base64). Every session lookup after a real login therefore mismatched, and `/me` returned 401 immediately after a successful login — caught by the `full_register_login_me_logout_flow` integration test.
- **Fix:** Changed `login` to hash `token_b64.as_bytes()` (the same on-the-wire representation) instead of the raw pre-encoding bytes, with an inline comment explaining why the representations must match.
- **Files modified:** `crates/pv-server/src/routes/auth.rs`
- **Verification:** `cargo test -p pv-server` — all 8 integration tests pass, including the full register→login→me→logout flow.
- **Committed in:** `e19d96f` (Task 2 GREEN commit — found and fixed before that commit, so it's folded into the single GREEN commit rather than a separate fix commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — the plan's own literal spec (hash the token, verify at lookup time) only works if both sides hash the same representation; the plan text didn't spell out which representation, and the natural reading of "hash the raw token" for `login` diverged from `session.rs`'s "hash the header string" reading. No scope creep — same functions (`crypto::hash_token`), same route surface.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required. New env var `PV_SESSION_TTL_HOURS` is optional (default 168, i.e. 7 days).

## Next Phase Readiness

**Wire shapes for Plan 02-04's web client:**

`POST /api/auth/prelogin` — request `{ "email": string }` — response `{ "kdf": { "m_cost_kib": u32, "t_cost": u32, "p_cost": u32 }, "salt": string (base64) }` (200, always — shape-identical whether or not the account exists).

`POST /api/auth/register` — request `{ "email": string, "kdf": KdfParams, "salt": string (base64, >=16 bytes decoded), "auth_hash": string (base64, >=16 bytes decoded), "pw_wrapped_uk": string (opaque JSON, forwarded verbatim) }` — response `{ "user_id": string }` with status 201; 409 `{ "error": string }` on duplicate email; 400 `{ "error": string }` on malformed email/salt/auth_hash.

`POST /api/auth/login` — request `{ "email": string, "auth_hash": string (base64) }` — response `{ "session_token": string (base64), "pw_wrapped_uk": string }` with status 200; 401 `{ "error": "unauthorized" }` for both wrong auth_hash and unknown email (identical body).

`POST /api/auth/logout` — request: none (body), `Authorization: Bearer <session_token>` header required — response: 204 No Content; 401 if the token is missing/invalid/expired.

`GET /api/auth/me` — request: `Authorization: Bearer <session_token>` header required — response `{ "user_id": string, "email": string, "pw_wrapped_uk": string }` with status 200; 401 if the token is missing/invalid/expired.

- `pv-server` now has a working lib+bin split, a `SessionUser` extractor, and a runtime-checked-sqlx convention that Plan 02-03's vault/folders routes should reuse directly (same `ApiError`, same extractor, same query style).
- No blockers for Plan 02-03 (vault items/folders CRUD) or Plan 02-04 (web auth screens) — both wire shapes and the extractor are stable.

---
*Phase: 02-password-auth-vault-core*
*Completed: 2026-07-13*

## Self-Check: PASSED

All created files verified present on disk (7/7). All task commit hashes verified present in git log (3/3: `cff1f3e`, `5f1045c`, `e19d96f`).
