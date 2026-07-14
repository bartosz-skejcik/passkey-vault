---
phase: 03-passkey-enrollment-account-security
plan: 02
subsystem: server
tags: [axum, sqlx, webauthn, passkeys, sessions, idor, integration-tests]

# Dependency graph
requires:
  - phase: 03-passkey-enrollment-account-security (plan 01)
    provides: "passkeys table (id, user_id, credential_id, passkey_json, name, prf_capable, prf_salt, prf_wrapped_uk, created_at, last_used_at), webauthn_states table, register_start/register_finish/prf_wrap ceremony handlers, SoftPasskey-driven test harness"
provides:
  - "crates/pv-server/src/routes/passkeys.rs — list/rename/delete_passkey handlers (AUTH-05's server-enforced 409 no-stranding guard on delete)"
  - "crates/pv-server/src/routes/sessions.rs — list (current: true marker) and revoke handlers (AUTH-07)"
  - "crates/pv-server/src/routes/auth.rs::me — throttled (5-minute) last_used_at update for the current session, best-effort/non-fatal"
  - "GET/PATCH/DELETE /api/passkeys/{id}, GET /api/sessions, DELETE /api/sessions/{id} routed in mod.rs"
affects: [03-03, 03-04 (frontend Settings panel — Passkeys/Sesje tabs consume this exact API surface)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ownership-scoped CRUD mirrored directly from vault.rs's list/delete shape — every query binds WHERE ... AND user_id = ? to session.user_id, never a client-supplied id alone"
    - "409 defense-in-depth recovery-invariant guard (auth.rs-style SELECT-before-DELETE) reused verbatim from 03-RESEARCH.md's Architecture Pattern 3"
    - "current-session detection: hash the CURRENT request's own bearer token server-side via crypto::hash_token and compare per-row in Rust (not SQL), reusing the exact hashing convention login()/logout()/SessionUser already use — never a client-supplied 'is this me' flag"
    - "Throttled write pattern (UPDATE ... WHERE token_hash = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-5 minutes'))) triggered only from /me, not from every authenticated request, to avoid multiplying SQLite single-writer contention"

key-files:
  created:
    - crates/pv-server/src/routes/sessions.rs
    - crates/pv-server/tests/sessions.rs
  modified:
    - crates/pv-server/src/routes/passkeys.rs
    - crates/pv-server/src/routes/auth.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/passkeys.rs

key-decisions:
  - "delete_passkey's 409 guard SELECTs pw_wrapped_uk from users using session.user_id (never a body/path value) BEFORE issuing any DELETE — the test that proves this (delete_passkey_blocked_without_password_wrap) manipulates the DB pool directly to reach the otherwise-unreachable empty-pw_wrapped_uk state, since no real registration/API flow can ever produce it"
  - "sessions::list takes both SessionUser and HeaderMap so it can independently recompute the caller's own token_hash for the current: true comparison, mirroring auth.rs::logout's existing dual-extractor signature rather than inventing a new pattern"
  - "auth.rs::me's last_used_at update failure is caught and logged, never propagated as an error — the endpoint's primary contract (returning pw_wrapped_uk) must not fail because of a best-effort side write"
  - "All ownership/IDOR tests assert 404 (never 403) for cross-user passkey/session access, matching vault.rs's existing non-existence-revealing convention"

requirements-completed: [AUTH-05, AUTH-06, AUTH-07]

coverage:
  - id: D1
    description: "User can list their enrolled passkeys (name/date/last-used/PRF-capability), rename one, and delete one — all ownership-scoped to the caller's own user_id"
    requirement: "AUTH-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#rename_passkey_persists_new_name"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#rename_passkey_rejects_empty_name"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#delete_passkey_succeeds_with_password_wrap_intact"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#passkeys_ownership_rejects_cross_user_access"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deleting a passkey that would leave the vault without a password/recovery fallback is rejected by the server itself with 409, verified by a direct API integration test — not merely discouraged in the UI"
    requirement: "AUTH-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/passkeys.rs#delete_passkey_blocked_without_password_wrap"
        status: pass
    human_judgment: false
  - id: D3
    description: "User can list their active sessions with exactly one marked as the current session, and revoke any individual session (ownership-scoped)"
    requirement: "AUTH-07"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sessions.rs#sessions_list_marks_current"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sessions.rs#sessions_list_second_login_adds_a_non_current_row"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sessions.rs#sessions_revoke_ownership_check"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sessions.rs#sessions_revoke_removes_row"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-07-14
status: complete
---

# Phase 03 Plan 02: Passkey list/rename/delete + Session list/revoke Summary

**Ownership-scoped CRUD for passkey management (list/rename/delete, with a server-enforced 409 recovery-invariant guard) and session management (list with current-session marking, revoke), directly mirroring vault.rs's established shape — completing AUTH-05/AUTH-06/AUTH-07's backend API surface.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `crates/pv-server/src/routes/passkeys.rs`: added `list` (`PasskeyRow` with `prf_capable` read as `i64 != 0`, never client-supplied), `rename` (trim-then-length-check, `PATCH`), `delete_passkey` (AUTH-05's `SELECT pw_wrapped_uk` guard before any `DELETE`, returning `409` on empty).
- `crates/pv-server/src/routes/sessions.rs` (new): `list` (computes the caller's own `token_hash` from the request's bearer token, marks exactly one row `current: true`, excludes `token_hash` from the response DTO), `revoke` (`DELETE ... WHERE id = ? AND user_id = ?`, no special-casing for the current session — its next lookup 401s naturally).
- `crates/pv-server/src/routes/auth.rs::me`: now also takes `headers: HeaderMap`; adds a throttled (5-minute) `UPDATE sessions SET last_used_at` for the current session, best-effort (logged, non-fatal on failure).
- `crates/pv-server/src/routes/mod.rs`: wired `GET /api/passkeys`, `PATCH/DELETE /api/passkeys/{id}`, `GET /api/sessions`, `DELETE /api/sessions/{id}`; added `pub mod sessions;` and the `patch` routing import.
- `crates/pv-server/tests/passkeys.rs`: 5 new integration tests (rename persists/rejects-empty, delete blocked-without-wrap with row-survival proof, delete succeeds, cross-user IDOR on both rename and delete).
- `crates/pv-server/tests/sessions.rs` (new): 4 integration tests (current-session marking, second-login adds a non-current row, ownership-scoped revoke rejection, revoke-removes-row).

## Task Commits

1. **Task 1: Passkey list/rename/delete + sessions list/revoke + throttled last_used_at**
   - `1accc52` (feat) — passkeys.rs list/rename/delete_passkey, sessions.rs (new), auth.rs::me throttled update, mod.rs routing
2. **Task 2: Integration tests — ownership/IDOR, 409 recovery-invariant, current-session detection**
   - `9a0da2e` (test) — passkeys.rs/sessions.rs integration test coverage

**Plan metadata:** (this commit, pending)

## Files Created/Modified

- `crates/pv-server/src/routes/passkeys.rs` - added `PasskeyRow`/`RenameRequest`, `list`/`rename`/`delete_passkey` handlers
- `crates/pv-server/src/routes/sessions.rs` (new) - `SessionRow`, `list`/`revoke` handlers
- `crates/pv-server/src/routes/auth.rs` - `me()` gained `headers: HeaderMap` param + throttled `last_used_at` update
- `crates/pv-server/src/routes/mod.rs` - new routes wired, `pub mod sessions;`, `patch` import
- `crates/pv-server/tests/passkeys.rs` - `req_json`/`enroll_passkey` test helpers + 5 new tests
- `crates/pv-server/tests/sessions.rs` (new) - `login_again` test helper + 4 new tests

## Decisions Made

- Reused `vault.rs`'s exact ownership-scoped list/delete shape for both `passkeys.rs`'s new handlers and the new `sessions.rs` — no new query pattern invented.
- `sessions::list` takes `HeaderMap` alongside `SessionUser` (same dual-extractor shape as `auth.rs::logout`) specifically to recompute the current request's own `token_hash` for the `current: true` marker — comparison happens in Rust against each row's stored `token_hash`, not in SQL.
- `auth.rs::me`'s `last_used_at` update is deliberately best-effort: a DB write failure there is logged via `tracing::warn!` and swallowed, never surfaced as an `ApiError`, since `/me`'s core contract (`pw_wrapped_uk`) is unrelated to this side effect.
- All new ownership/IDOR tests assert `404`, matching `vault.rs`'s and Plan 03-01's established non-existence-revealing convention (never `403`).

## Deviations from Plan

None — plan executed exactly as written. Every handler signature, query shape, and test matches the plan's `<action>`/`<behavior>` specification (delete guard's `pw_wrapped_uk.is_empty()` check, `sessions::list`'s `token_hash` comparison, the throttled 5-minute `last_used_at` window).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Plan 03-02 complete.** The backend API surface for Plans 03-03/03-04 (frontend Settings panel) is now fully available and tested:

- `GET /api/passkeys` → `[{id, name, prf_capable, created_at, last_used_at}]`
- `PATCH /api/passkeys/{id}` `{name}` → `204` (or `400` on empty/too-long name, `404` cross-user)
- `DELETE /api/passkeys/{id}` → `204` (or `409` if it would strand the vault, `404` cross-user)
- `GET /api/sessions` → `[{id, user_agent, created_at, last_used_at, current}]`
- `DELETE /api/sessions/{id}` → `204` (or `404` cross-user)

For Plans 03-03/03-04: the `409` response from `DELETE /api/passkeys/{id}` needs explicit frontend handling (an inline alert distinct from the generic error path, per 03-PATTERNS.md's `PasskeyDeleteConfirmDialog.tsx` guidance) — this is a real, reachable response shape the UI must handle even though the underlying state is unreachable through any real v0.1 user flow.

---
*Phase: 03-passkey-enrollment-account-security*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 6 created/modified key files verified present on disk. Both task commit hashes (`1accc52`, `9a0da2e`) verified present in git log. `cargo test -p pv-server` (whole crate, 40 tests across unit + auth/passkeys/sessions/vault integration suites) re-verified green immediately before this SUMMARY was written.
