---
phase: 19-server-supply-chain-hardening
plan: 02
subsystem: auth
tags: [webauthn-rs, sqlx, sqlite, tracing, sign-counter, clone-detection]

# Dependency graph
requires: []
provides:
  - "counter_anomaly_at column on passkeys (additive migration 0013)"
  - "handle_finish_auth_error() shared classifier in passkeys.rs, reused by auth.rs::passkey_login_finish"
  - "Regression test proving fail-closed ceremony behavior + non-flagging of normal ceremonies"
affects: [passkey-security-auditing, admin-passkey-management-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared classifier function for WebauthnError handling, called from all finish_passkey_authentication call sites"
    - "Additive-only ALTER TABLE ADD COLUMN, mirrors 0004's never-decompose-passkey_json rule"

key-files:
  created:
    - crates/pv-server/migrations/0013_passkey_counter_anomaly.sql
  modified:
    - crates/pv-server/src/routes/passkeys.rs
    - crates/pv-server/src/routes/auth.rs
    - crates/pv-server/tests/unlock.rs

key-decisions:
  - "Interpreted CONTEXT.md's 'do NOT hard-fail ceremonies' as 'do not newly weaken webauthn-rs's existing require_valid_counter_value hard-fail' — this plan adds operator-visible signal on an ALREADY-rejected path, per 19-RESEARCH.md Open Question 1 interpretation (a)"
  - "Both branches (regression-flagged, normal-ceremony-not-flagged) asserted within a single test function per the plan's must_haves truth 2, using a second independently-enrolled passkey to prove no cross-credential false positives"

patterns-established:
  - "handle_finish_auth_error(db, user_id, credential_id, context, generic_message, e) — classify WebauthnError::CredentialPossibleCompromise vs. any other variant; only base64url credential_id + user_id + fixed context label ever logged/persisted"

requirements-completed: [SEC-04]

coverage:
  - id: D1
    description: "A deliberately regressed sign-counter assertion fails unlock_finish with the same 4xx as today AND sets passkeys.counter_anomaly_at to a non-NULL timestamp"
    requirement: "SEC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/unlock.rs#unlock_counter_regression_flags_anomaly_while_normal_ceremony_stays_clean"
        status: pass
    human_judgment: false
  - id: D2
    description: "A normal legitimate ceremony (including a fresh, never-before-unlocked passkey's first unlock) does NOT get falsely flagged, even when another regressed credential exists in the same candidate set"
    requirement: "SEC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/unlock.rs#unlock_counter_regression_flags_anomaly_while_normal_ceremony_stays_clean"
        status: pass
    human_judgment: false
  - id: D3
    description: "handle_finish_auth_error() is reused verbatim across all 3 finish_passkey_authentication call sites (prf_wrap, unlock_finish, auth.rs::passkey_login_finish), with passkey_login_finish's enumeration-safe error text unchanged"
    requirement: "SEC-04"
    verification:
      - kind: unit
        ref: "grep -n 'fn handle_finish_auth_error' crates/pv-server/src/routes/passkeys.rs (exactly one definition)"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/passkey_login.rs#passkey_login_finish_dummy_state_id_and_real_ceremony_failure_same_shape"
        status: pass
    human_judgment: false

# Metrics
duration: 45min
completed: 2026-07-21
status: complete
---

# Phase 19 Plan 02: Sign-Counter Anomaly Surfacing Summary

**Surfaced webauthn-rs's already-active `CredentialPossibleCompromise` sign-counter-regression rejection with a distinguishable `tracing::warn!` log line and a persisted `passkeys.counter_anomaly_at` timestamp, via one shared classifier reused across all 3 finish-ceremony handlers, without weakening the existing fail-closed behavior.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-07-21T11:13:00Z
- **Completed:** 2026-07-21T11:58:49Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Additive migration `0013_passkey_counter_anomaly.sql` adds `passkeys.counter_anomaly_at TEXT` (NULL = never observed, non-NULL = timestamp of last detected regression)
- `handle_finish_auth_error()` classifier in `passkeys.rs`: on `WebauthnError::CredentialPossibleCompromise`, logs base64url `credential_id` + `user_id` + fixed `context` label (never `passkey_json`/`prf_salt`/`prf_wrapped_uk`) and runs a `user_id`-scoped `UPDATE`; any other `WebauthnError` variant preserves the pre-existing generic `?e`-Debug warn shape — no behavior change on the happy path or non-regression failures
- All 3 `finish_passkey_authentication` call sites (`prf_wrap`, `unlock_finish` in `passkeys.rs`; `passkey_login_finish` in `auth.rs`) now route through the same classifier, with `passkey_login_finish` passing its existing `ENUMERATION_SAFE_FINISH_ERROR` constant unchanged as `generic_message`
- New integration test `unlock_counter_regression_flags_anomaly_while_normal_ceremony_stays_clean` proves: (1) a normal legitimate ceremony leaves `counter_anomaly_at` NULL, (2) a deliberately tampered stored counter (`passkey_json`'s `["cred"]["counter"]` bumped to 999999) still fails the next real ceremony with a 4xx AND sets `counter_anomaly_at` non-NULL, (3) a second, independently-enrolled fresh passkey's first-ever unlock ceremony is NOT falsely flagged even with the regressed credential present in the same candidate set

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration + shared classifier + wire into prf_wrap/unlock_finish** - `af75749` (feat)
2. **Task 2: Wire the classifier into auth.rs::passkey_login_finish** - `030db0a` (feat)
3. **Task 3: Counter-regression + both-zero-exemption regression test** - `f462102` (test)

_Note: No TDD RED-then-GREEN split — Tasks 1-2 landed the migration/classifier first (existing tests still passed unmodified, proving no observable behavior change), then Task 3 added the new regression test, which passed on first run against the already-landed classifier._

## Files Created/Modified
- `crates/pv-server/migrations/0013_passkey_counter_anomaly.sql` - Additive `ALTER TABLE passkeys ADD COLUMN counter_anomaly_at TEXT`
- `crates/pv-server/src/routes/passkeys.rs` - Added `WebauthnError` import, `handle_finish_auth_error()` classifier, wired into `prf_wrap` and `unlock_finish`
- `crates/pv-server/src/routes/auth.rs` - Imported `handle_finish_auth_error`, wired into `passkey_login_finish` with `ENUMERATION_SAFE_FINISH_ERROR` preserved as `generic_message`
- `crates/pv-server/tests/unlock.rs` - New regression test covering both the anomaly-flagged and non-flagged branches

## Decisions Made
- Interpreted CONTEXT.md's "do NOT hard-fail ceremonies" instruction (which predates this session's finding that `require_valid_counter_value` is already `true` by default) as "do not newly weaken the library's existing protection" — this plan only adds operator-visible signal on an already-rejected path; it never changes whether a ceremony succeeds or fails. Recorded per 19-RESEARCH.md's explicit recommendation to surface this interpretation to Bartek.
- Chose to assert both the regression-flagged branch and the non-flagged branches (normal ceremony on the same credential, plus a second independently-enrolled fresh passkey) within a SINGLE test function rather than splitting into separate tests, per the plan's must_haves truth 2 ("Both branches ... are asserted in the same new test").

## Deviations from Plan

None - plan executed exactly as written. All tasks compiled and passed on first attempt with no auto-fixes required.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Migration 0013 runs automatically via `sqlx::migrate!` on next server boot (proven by `test_pool()` running it inside every integration test in this plan's verification run).

## Next Phase Readiness
- `counter_anomaly_at` is now available for a future admin/audit surface (not built in this plan — out of scope) to list flagged credentials
- `handle_finish_auth_error()` is the single reusable classification point for any future `finish_passkey_authentication` call site added elsewhere in the codebase
- Full `cargo test --workspace` (152 tests across all suites) stayed green after this plan's changes — no regression in unrelated suites

---
*Phase: 19-server-supply-chain-hardening*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created/modified files and all 3 task commit hashes verified present in the worktree and `git log`.
