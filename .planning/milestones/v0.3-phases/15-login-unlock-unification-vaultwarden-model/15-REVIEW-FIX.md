---
phase: 15-login-unlock-unification-vaultwarden-model
fixed_at: 2026-07-20T21:44:00Z
review_path: .planning/phases/15-login-unlock-unification-vaultwarden-model/15-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-07-20T21:44:00Z
**Source review:** .planning/phases/15-login-unlock-unification-vaultwarden-model/15-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 1 (the single Warning; the 3 Info items were explicitly out of scope for this run)
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-01: Wrong-password retry in the ceremony window flips to a dead-end "failed" screen after 8s

**Files modified:** `web/src/components/auth/ExtUnlockBridge.tsx`, `web/src/components/auth/ExtUnlockBridge.test.tsx`
**Commit:** 866a34f
**Applied fix:** In `ExtUnlockBridge.tsx`'s shared `onMessage` listener, the
password-ack branch (`awaitingPasswordAckRef.current` block) now sets
`settledRef.current = true` unconditionally at the top of the branch,
mirroring the passkey ack path's unconditional settle, instead of only inside
the `event.data.ok` true-branch. Previously, a wrong-password ack left
`settledRef.current` false, so the pending `RESULT_TIMEOUT_MS` (8s) timer
armed by that same attempt could fire later and overwrite the inline-retry
`idle` form with the terminal `failed` full-screen state, forcing the user to
close and reopen the ceremony window. Verified the code matched the review's
cited lines exactly before editing (no drift). Added a fake-timer regression
test to `ExtUnlockBridge.test.tsx` ("WR-01 fix: the inline retry form
survives past the original attempt's RESULT_TIMEOUT_MS...") that submits a
wrong password, receives an `ok:false` ack, advances fake timers 9s past
`RESULT_TIMEOUT_MS`, and asserts the terminal `extUnlock.failed` state never
appears and the inline retry form/error remain intact.

**Verification:**
- `cd web && npx vitest run --reporter=dot` — 55 test files, 474 tests, all
  passed (including the new regression test and the full pre-existing
  `ExtUnlockBridge` suite, 35/35 in that file).
- `cd web && npx tsc --noEmit` — clean, no errors.
- Extension side untouched, per scope.

## Skipped Issues

None — the single in-scope finding was fixed. The 3 Info items (IN-01, IN-02,
IN-03) were explicitly out of scope for this fix pass per the orchestrator's
instructions and were not attempted.

---

_Fixed: 2026-07-20T21:44:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
