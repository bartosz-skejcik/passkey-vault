---
quick_id: 260803-cnd
subsystem: auth
tags: [webauthn, passkeys, session, react, i18n]
key-files:
  created: []
  modified:
    - web/src/lib/passkeys/errors.ts
    - web/src/lib/passkeys/login.ts
    - web/src/components/auth/UnlockOverlay.tsx
    - web/src/components/auth/LoginForm.tsx
    - web/src/components/auth/ExtUnlockBridge.tsx
    - web/src/lib/i18n/dictionary.ts
    - web/src/lib/passkeys/login.test.ts
    - web/src/components/auth/UnlockOverlay.test.tsx
    - web/src/components/auth/LoginForm.test.tsx
    - web/src/components/auth/ExtUnlockBridge.test.tsx
key-decisions:
  - "401 handling lives in the component (UnlockOverlay's handlePasskeyUnlock), not in the ceremony function — mirrors unlockFromPassword and the existing ExtUnlockBridge precedent, since the ceremony functions are shared, session-context-agnostic pure functions"
  - "LoginForm's handlePasskeyLogin verified (not assumed) to need NO 401 branch — passkey-login/start and finish are unauthenticated pre-session routes with no SessionUser extractor"
  - "AbortError becomes its own outcome (timedOut: true) on both PasskeyLoginCeremonyResult and PasskeyUnlockCeremonyResult, surfaced as a dedicated unlock.passkeyTimedOut message rather than folded into silent cancellation or generic failure"
  - "ExtUnlockBridge.tsx's ceremony consumers needed an explicit timedOut check to avoid a correctness regression the AbortError fix would otherwise introduce (misreporting a timeout as 'no PRF-capable passkeys')"
duration: ~55min
completed: 2026-08-03
status: complete
---

# Quick Task 260803-cnd: Fix passkey unlock 401 handling and AbortError misclassification

**Mirrors unlockFromPassword's 401 session-clear-and-reload in handlePasskeyUnlock, and gives a ceremony gesture timeout (AbortError) its own `timedOut` outcome instead of misclassifying it as a generic hard failure.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 defects, fixed as 2 independently-revertable commits
- **Files modified:** 10 (4 source-only, 4 source+tests, 2 tests-only additions folded into source commits)

## Background (production bug, root cause already confirmed — not re-investigated)

Bartek could not unlock his vault at vault.blonie.cloud with his passkey. The UI showed
"Nie udało się użyć passkeya..." even though his passkey/PRF enrollment was completely healthy.
Root cause: `POST /api/passkeys/unlock/start` returned 401 because his session token had expired
(fixed 7-day TTL, no sliding renewal, unchanged by this task). `unlockFromPassword` already handled
this correctly; `handlePasskeyUnlock` did not.

## Accomplishments

1. **Defect 1 — 401 during passkey unlock**: `handlePasskeyUnlock` now clears the dead session and
   reloads on a 401 from `passkeyUnlock()`, byte-for-byte mirroring `unlockFromPassword`'s existing
   401 handling. Verified (via `crates/pv-server/src/routes/auth.rs`/`mod.rs`) that `LoginForm`'s
   passkey sign-in path has no equivalent exposure — its routes are unauthenticated pre-session
   routes with no session to expire — and documented that finding as a code comment rather than
   silently leaving it unexplained.
2. **Defect 2 — AbortError misclassified as hard failure**: `getAssertionWithTimeout`'s
   `GESTURE_TIMEOUT_MS`-fired `AbortError` now resolves as its own outcome (`timedOut: true`) in
   both `passkeyLoginCeremony` and `passkeyUnlockCeremony`, instead of being rethrown and treated
   identically to a genuine hard failure. Surfaced as a new `unlock.passkeyTimedOut` message
   (pl/en) in both `UnlockOverlay` and `LoginForm`.
3. **Non-silent logging**: replaced the bare `catch {}` in both `handlePasskeyUnlock` and
   `handlePasskeyLogin` with `console.error(...)` on the genuine-failure branch (Phase 24 WR-09
   precedent, matching the existing `enroll.ts:141` style) — logs only the error object shape,
   never session tokens/PRF output/wrapping keys/ciphertext.
4. **Regression caught and fixed before it shipped**: changing the ceremony functions' AbortError
   behavior from "throw" to "resolve" would have silently broken two other consumers if left
   unaddressed:
   - `LoginForm.handlePasskeyLogin`'s `if (!cancelled) onAuthed?.()` would have called `onAuthed()`
     for a timed-out (sessionless) ceremony, since `timedOut` ceremonies have `cancelled: false`.
     Fixed by propagating `timedOut` through `passkeyLogin()`'s return shape and gating on it.
   - `ExtUnlockBridge.tsx` (the extension's server-origin popup, consuming the ceremony functions
     directly in both `signin` and `unlock` modes) would have misreported a timeout as "this
     account has no PRF-capable passkeys" (`no-passkeys` state), since a timed-out ceremony's
     resolved shape (`prfBytes`/`prfWrappedUk`/`sessionToken` all `undefined`) is identical to
     that empty-state's shape. Fixed with an explicit `result.timedOut` check in both branches,
     preserving the exact pre-fix terminal state (`extUnlock.failed`/`extUnlock.signinFailed`) —
     a same-behavior fix for that component, not a new outcome.

## Task Commits

1. **Defect 1: 401 handling for expired session during passkey unlock** — `5a5e6ff` (fix)
   - `web/src/components/auth/UnlockOverlay.tsx`, `UnlockOverlay.test.tsx`, `LoginForm.tsx`
2. **Defect 2: AbortError as its own outcome + non-silent logging** — `231321d` (fix)
   - `web/src/lib/passkeys/errors.ts`, `login.ts`, `login.test.ts`
   - `web/src/components/auth/UnlockOverlay.tsx`, `LoginForm.tsx`, `ExtUnlockBridge.tsx` (+ their tests)
   - `web/src/lib/i18n/dictionary.ts`

Kept as two separate commits per the task's explicit commit-hygiene instruction: Defect 1 (a
user-facing, security-adjacent session-handling fix) and Defect 2 (a diagnosability fix) are
independently revertable. Since both defects' code lives inside the same `handlePasskeyUnlock`/
`handlePasskeyLogin` function bodies, true git-hunk-level separation wasn't possible from a single
edit pass — commit 1 was built and verified as a defect-1-only intermediate state (running the
full unit-test suite + typecheck against it) before layering defect 2's changes on top for commit
2 and re-verifying.

## Files Created/Modified

- `web/src/lib/passkeys/errors.ts` — new `isAbortError()` helper, alongside existing `isNotAllowedError()`
- `web/src/lib/passkeys/login.ts` — `LoginStep` gains `"timedOut"`; `PasskeyLoginCeremonyResult`/
  `PasskeyUnlockCeremonyResult` gain `timedOut?: boolean`; both ceremony functions' catch blocks
  gain an `isAbortError` branch (resolve instead of rethrow); `passkeyLogin()`/`passkeyUnlock()`
  wrappers propagate `timedOut`
- `web/src/components/auth/UnlockOverlay.tsx` — `handlePasskeyUnlock`: 401 branch (session
  clear+reload), `timedOut` branch (dedicated message), non-silent `console.error` on genuine failure
- `web/src/components/auth/LoginForm.tsx` — `handlePasskeyLogin`: `timedOut` branch (must gate
  `onAuthed()` alongside `cancelled`), non-silent `console.error`; comment documenting why no 401
  branch is needed here
- `web/src/components/auth/ExtUnlockBridge.tsx` — both `handleUnlock` branches (`signin`/`unlock`)
  gain a `result.timedOut` check before the `no-passkeys` fallback
- `web/src/lib/i18n/dictionary.ts` — new `unlock.passkeyTimedOut` key (pl/en)
- Tests updated/added: `login.test.ts` (2 existing AbortError tests corrected — they previously
  asserted the exact misclassification bug being fixed), `UnlockOverlay.test.tsx` (+2 tests: 401,
  timedOut), `LoginForm.test.tsx` (+1 test: timedOut), `ExtUnlockBridge.test.tsx` (+2 tests:
  timedOut in both modes)

## Decisions Made

See frontmatter `key-decisions`. Full rationale recorded in
`260803-cnd-PLAN.md` in this directory, including why the 401 fix belongs in the component (not
the shared ceremony function) and why `ExtUnlockBridge.tsx` needed a companion fix.

## Deviations from Plan

None beyond what's documented above as accomplishments — the `ExtUnlockBridge.tsx` fix was
identified during implementation as a direct, in-scope consequence of Defect 2's own change (Rule
1: auto-fix a bug the current task's own change would otherwise introduce), not a separate
pre-existing issue.

## Known Stubs

None.

## Issues Encountered

None — all three verification gates (unit tests, typecheck, e2e) passed on the first attempt for
both the intermediate (defect-1-only) and final (both-defects) commit states.

## Verification

- `npm --prefix web run test -- --run` → 560/560 passed (61 test files)
- `npm --prefix web run typecheck` → clean
- `npm --prefix web run test:e2e` → 9/9 passed (Playwright, real rust server + static export;
  these specs are password-only sessions, so they exercise no passkey code paths but confirm no
  regression to the surrounding auth/session/build pipeline)

## Next Steps

None required — this is a standalone bug fix, not part of a phase. The 7-day session TTL / sliding
renewal question remains open by design (explicitly out of scope per the task).

---
*Quick task: 260803-cnd*
*Completed: 2026-08-03*

## Self-Check: PASSED

All 8 modified/created files verified present on disk; both commit hashes (`5a5e6ff`, `231321d`)
verified present in `git log`.
