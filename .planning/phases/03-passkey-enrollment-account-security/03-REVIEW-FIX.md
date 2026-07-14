---
phase: 03-passkey-enrollment-account-security
fixed_at: 2026-07-14T00:00:00Z
review_path: .planning/phases/03-passkey-enrollment-account-security/03-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-07-14
**Source review:** .planning/phases/03-passkey-enrollment-account-security/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (5 warnings + IN-02, IN-03 per explicit dispatch instructions — IN-01 out of scope)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### WR-01: Ceremony-state consume is not atomic — weakens single-use / anti-replay (T-03-04)

**Files modified:** `crates/pv-server/src/routes/webauthn_state.rs`, `crates/pv-server/tests/passkeys.rs`
**Commit:** `644f386`
**Applied fix:** Collapsed `consume_state`'s SELECT-then-DELETE into a single atomic `DELETE ... RETURNING state_json, prf_salt, passkey_id ... WHERE ... expires_at > datetime('now')`. Exactly one concurrent caller can now ever win a given `state_id`. Added `consume_state_is_atomic_under_concurrent_callers`, a new integration test that builds its own multi-connection shared-cache in-memory SQLite pool (the shared `common::test_pool()` is deliberately `max_connections(1)`, which would serialize any race away) and drives 200 trials of two `tokio::spawn`ed callers released simultaneously via a `Barrier` on a multi-thread runtime. Verified this test reliably fails (200/200 double-wins) against the pre-fix SELECT-then-DELETE implementation and passes cleanly against the fix. The pre-existing sequential replay test (`prf_wrap_rejects_replayed_assertion`) still passes unmodified.

### WR-02: `sessions.user_agent` is never written — AUTH-07 device info is non-functional

**Files modified:** `crates/pv-server/src/routes/auth.rs`, `crates/pv-server/tests/auth.rs`
**Commit:** `79b20c7`
**Applied fix:** `login` now takes `headers: HeaderMap`, reads `header::USER_AGENT` (falling back to `None` on missing/non-UTF-8 headers rather than failing the request), and the `sessions` INSERT now includes the `user_agent` column (which already existed from migration 0005 — no new migration needed). Added `login_persists_user_agent_and_sessions_list_returns_it`, an integration test asserting a login request's `User-Agent` header round-trips through the `sessions` table to `GET /api/sessions`'s response. `sessions.rs::list`/`SessionRow` already selected and serialized `user_agent`, so no changes were needed there.

### WR-03: Hardcoded Polish "Bez PRF" in enrollment dialog bypasses i18n

**Files modified:** `web/src/components/settings/EnrollPasskeyDialog.tsx`
**Commit:** `df91df4`
**Applied fix:** Replaced the literal `Bez PRF` string with `{t("passkeys.noPrfBadge")}` — the dictionary key already existed (`{ pl: "Bez PRF", en: "No PRF" }`, used by `PasskeysTab.tsx`), so no dictionary changes were needed. Existing `EnrollPasskeyDialog.test.tsx` only asserts on `data-testid` presence (its `t()` mock is an identity function), so no test changes were required; it was re-run to confirm no regression.

### WR-04: Raw assertion JSON (may carry PRF extension output) is POSTed to the server

**Files modified:** `web/src/lib/passkeys/enroll.ts`, `web/src/lib/passkeys/enroll.test.ts`
**Commit:** `40b0fb6`
**Applied fix:** Before calling `prfWrap`, the serialized assertion (`assertion.toJSON()`) now has `clientExtensionResults.prf` deleted if present, so the raw PRF eval output can never reach the server even if a future browser starts serializing it there — defense-in-depth for the zero-knowledge boundary. Added a new test simulating a hypothetical browser that DOES serialize the PRF secret into `toJSON()`, asserting it's stripped before `prfWrap` is called; the existing PRF-success-path test (whose mock `toJSON()` has no `clientExtensionResults`) continues to pass unchanged, confirming the strip is a no-op when there's nothing to strip.

### WR-05: `webauthn_states` rows are never cleaned up — unbounded growth

**Files modified:** `crates/pv-server/src/routes/webauthn_state.rs`, `crates/pv-server/tests/passkeys.rs`
**Commit:** `fd44c9b`
**Applied fix:** `persist_state` now opportunistically runs `DELETE FROM webauthn_states WHERE expires_at <= datetime('now')` (best-effort — a failure here logs a warning but does not block issuing the new ceremony state) before inserting each new row, piggybacking on the existing `idx_webauthn_states_expiry` index. Added `persist_state_sweeps_expired_rows`, which backdates a row's `expires_at` into the past (rather than waiting out the real 5-minute TTL) and asserts the next `persist_state` call sweeps it while leaving the fresh row intact. Verified this test fails against the pre-fix code (2 rows remain instead of 1) and passes against the fix.

### IN-02: PRF-derived `WasmWrappingKey` handle is not explicitly freed

**Files modified:** `web/src/lib/passkeys/enroll.ts`, `web/src/lib/passkeys/enroll.test.ts`
**Commit:** `efc02af`
**Applied fix:** Wrapped the `wrapUserKey`/`prfWrap` sequence that consumes `wrappingKey` in a `try { ... } finally { wrappingKey.free(); }` block, matching the project's deterministic-zeroization discipline for key material. Extended the PRF-success-path test to assert `.free()` is called exactly once, and added a new test asserting `.free()` still runs when `prfWrap` rejects (proving the `finally` fires on the error path too, not just the happy path).

### IN-03: Step-2 failures are indistinguishable from "authenticator lacks PRF"

**Files modified:** `web/src/lib/passkeys/enroll.ts`, `web/src/lib/passkeys/enroll.test.ts`
**Commit:** `e752062`
**Applied fix:** Kept the deliberate outward UI behavior unchanged (a step-2 failure after a successful step-1 registration still reports `doneNoPrf`, per the existing Pitfall-3 no-orphaned-credential rationale, and 03-UI-SPEC.md's 7-state design has no separate screen for this case — scoped minimally per dispatch instructions, not the full Phase-4 fallback taxonomy). Added an observability-layer distinction in the `catch` block: an expected `NotAllowedError` (user dismissed the second prompt) logs nothing, but any other failure (a bad `wrapUserKey`, a genuine `prfWrap` server rejection, a transient network error) now logs via `console.error` with the original error object, so it's no longer silently indistinguishable from an honest "no PRF support" outcome. Added two tests: one confirming the expected-dismissal path does NOT log, and one confirming a genuine `prfWrap` rejection DOES log (with the correct message and original error), while the UI-visible step sequence stays `doneNoPrf` in both cases.

## Skipped Issues

None — all 7 in-scope findings were fixed.

---

_Fixed: 2026-07-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
