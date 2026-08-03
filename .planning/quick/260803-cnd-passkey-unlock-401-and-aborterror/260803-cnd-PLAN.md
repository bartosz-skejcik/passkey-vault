---
quick_id: 260803-cnd
title: Fix passkey unlock 401 handling and AbortError misclassification
type: quick
status: planned
---

# Quick Task 260803-cnd: Fix passkey unlock 401 handling and AbortError misclassification

## Background (production bug, confirmed root cause — not re-investigated here)

Bartek could not unlock his vault at vault.blonie.cloud with his passkey. The UI told him
"Nie udało się użyć passkeya. Spróbuj ponownie albo użyj hasła poniżej." — misleading, since his
passkey/PRF enrollment was completely healthy.

Root cause: `POST /api/passkeys/unlock/start` returned HTTP 401 because his session token had
expired (`PV_SESSION_TTL_HOURS=168`, fixed 7-day TTL, no sliding renewal). `unlockFromPassword`
already handles an expired session correctly (clears session, reloads); `handlePasskeyUnlock` did
not — same dead session, two different user outcomes.

Separately, `getAssertionWithTimeout`'s `AbortController`-driven `GESTURE_TIMEOUT_MS` (60s) timeout
produces an `AbortError`, which `isNotAllowedError()` does not match, so it was rethrown and
misclassified identically to a generic hard failure — even though a 60s timeout is much closer to
"the user walked away" than "the passkey is broken".

## Defect 1: 401 handling for expired session during passkey unlock

**Decision: fix lives in the component (`UnlockOverlay.tsx`'s `handlePasskeyUnlock`), NOT inside
`passkeyUnlockCeremony`/`passkeyUnlock` in `login.ts`.**

Rationale:
- `login.ts`'s module doc explicitly documents these ceremony functions as pure, reusable, "NO
  React state" functions consumed by three different callers: `UnlockOverlay.tsx` (this web app's
  own session), `ExtUnlockBridge.tsx` (the extension's server-origin popup, a *different* session
  context), and (indirectly via `passkeyLoginCeremony`) `LoginForm.tsx`. Session-clearing +
  `window.location.reload()` are web-app-specific side effects that would be actively wrong for
  `ExtUnlockBridge.tsx` to inherit silently.
- Confirms existing precedent already in this codebase: `ExtUnlockBridge.tsx`'s own `handleUnlock`
  catch block already special-cases a 401 in `mode === "unlock"` at the *call-site* level (`not-signed-in`
  state), not inside the ceremony function. `UnlockOverlay.tsx`'s `unlockFromPassword` is the other
  existing reference implementation for exactly this session-expiry pattern.
- Therefore: `handlePasskeyUnlock` gets an `err instanceof ApiClientError && err.status === 401`
  branch that mirrors `unlockFromPassword` byte-for-byte (`clearSessionToken()`,
  `clearStoredEmail()`, `window.location.reload()` in try/catch for jsdom).

**`LoginForm.tsx:44` (`handlePasskeyLogin`) — verified NOT to need the same 401 branch.**
Checked `crates/pv-server/src/routes/auth.rs`'s `passkey_login_start`/`passkey_login_finish` and
`crates/pv-server/src/routes/mod.rs`'s route table: both routes take no `SessionUser` extractor —
they are the unauthenticated pre-session sign-in routes. There is no existing session at sign-in
time that could expire and produce a 401; a stray `Authorization` header `apiFetch` might attach
from stale localStorage is simply never read server-side. Documented this as a code comment in
`LoginForm.tsx` rather than silently leaving it unexplained. **No functional change to LoginForm's
401 handling** (it has none, correctly).

**The bare `catch {}` in `handlePasskeyUnlock` also gets non-silent logging** (Phase 24 WR-09
precedent, `enroll.ts:141`'s existing style): `console.error("passkey unlock: ceremony failed",
err)` for the genuine-failure branch only — never the 401/session-clear branch, never any secret
material (session tokens, PRF output, wrapping keys, ciphertext). Applied the same pattern to
`LoginForm.tsx`'s equivalent catch for consistency, since both components share the exact same
"secret failure, no diagnosability" gap that made this bug take a production DB read to diagnose.

## Defect 2: AbortError is its own outcome, not a hard failure

**Decision: add `isAbortError()` to `errors.ts`, and a `timedOut?: boolean` field to both
`PasskeyLoginCeremonyResult` and `PasskeyUnlockCeremonyResult`** (mirroring `cancelled`'s shape).
`getAssertionWithTimeout`'s `AbortError` is caught in both `passkeyLoginCeremony` (~line 218) and
`passkeyUnlockCeremony` (~line 391) and now **resolves** `{ ..., cancelled: false, timedOut: true }`
instead of rethrowing — a new `"timedOut"` value was added to the `LoginStep` union alongside
`"cancelled"`, reported via `onStep`.

This changes the *observable* return shape of `passkeyLogin()`/`passkeyUnlock()` (the thin
wrappers), which required auditing every consumer of those wrappers and the raw ceremony functions
for correctness, not just the two named call sites:

1. **`passkeyLogin()`** (used by `LoginForm.tsx`): the early-return guard
   (`result.cancelled || result.sessionToken === undefined`) already happened to catch the
   timed-out case too (no session token is ever set on a timeout) — but the caller's own
   `cancelled` flag is `false` for a timeout, so `LoginForm.handlePasskeyLogin`'s
   `if (!cancelled) onAuthed?.()` would have called `onAuthed()` for a ceremony that never created
   a session. **Fixed**: `passkeyLogin()`'s return type now also carries `timedOut`, and
   `handlePasskeyLogin` checks it before `cancelled`.
2. **`passkeyUnlock()`** (used by `UnlockOverlay.tsx`): no equivalent bug (nothing auto-unlocks on
   a timeout), but `handlePasskeyUnlock` now shows a dedicated `unlock.passkeyTimedOut` message
   instead of leaving the timeout silent (per the "own outcome" framing — a timeout usually means
   the user intended to complete the gesture and should be told to retry, unlike a deliberate
   cancel).
3. **`ExtUnlockBridge.tsx`** (calls `passkeyLoginCeremony`/`passkeyUnlockCeremony` directly, in both
   `signin` and `unlock` modes): **found and fixed a correctness regression the AbortError fix would
   otherwise have introduced.** Before this fix, an aborted ceremony rethrew and landed in this
   component's outer `catch` → `setState("failed")`. After making the ceremony resolve instead of
   throw, the resolved shape (`prfBytes`/`prfWrappedUk`/`sessionToken` all `undefined`) is
   IDENTICAL to the existing "no PRF-capable passkeys enrolled" shape, and without an explicit
   check the component would have silently and incorrectly shown `no-passkeys` ("this account has
   no PRF-capable passkeys") for a mere gesture timeout. Added `if (result.timedOut) { setState
   ("failed"); postFailureNotice(); return; }` in both branches, checked before the `no-passkeys`
   fallback — this restores the exact pre-fix observable behavior for this component (still
   `"failed"`/`extUnlock.failed`/`extUnlock.signinFailed`), it does not introduce a new UI state
   there. A dedicated timeout-specific message for the extension popup was deliberately **not**
   added — out of scope for this task, and the existing generic failure copy is not actively wrong
   (unlike the no-passkeys misattribution it prevents).

**New i18n key**: `unlock.passkeyTimedOut` (pl/en, added to `web/src/lib/i18n/dictionary.ts`),
used by both `UnlockOverlay.tsx` and `LoginForm.tsx`.

## Files touched

- `web/src/lib/passkeys/errors.ts` — add `isAbortError()`
- `web/src/lib/passkeys/login.ts` — `LoginStep` gains `"timedOut"`; both ceremony result interfaces
  gain `timedOut?: boolean`; both ceremony functions' catch blocks gain an `isAbortError` branch;
  `passkeyLogin()`/`passkeyUnlock()` wrappers propagate `timedOut`
- `web/src/components/auth/UnlockOverlay.tsx` — `handlePasskeyUnlock` gains a 401 branch (mirrors
  `unlockFromPassword`) and a `timedOut` branch; non-silent `console.error` on genuine failure
- `web/src/components/auth/LoginForm.tsx` — `handlePasskeyLogin` gains a `timedOut` branch (must
  gate `onAuthed()` alongside `cancelled`); non-silent `console.error` on genuine failure;
  documents why no 401 branch is needed here
- `web/src/components/auth/ExtUnlockBridge.tsx` — both `handleUnlock` branches (`signin`/`unlock`)
  gain a `result.timedOut` check before the `no-passkeys` fallback, to avoid a correctness
  regression this fix would otherwise introduce
- `web/src/lib/i18n/dictionary.ts` — new `unlock.passkeyTimedOut` key (pl/en)
- Tests: `web/src/lib/passkeys/login.test.ts` (updates 2 existing AbortError tests to assert the
  corrected behavior — they previously asserted the exact misclassification bug being fixed),
  `web/src/components/auth/UnlockOverlay.test.tsx` (new 401 + timedOut tests),
  `web/src/components/auth/LoginForm.test.tsx` (new timedOut test),
  `web/src/components/auth/ExtUnlockBridge.test.tsx` (new timedOut tests, both modes)

## Hard constraints honored

- Both pl/en added for the new string, natural Polish copy (not machine-translated style)
- No session token / PRF output / wrapping key / UserKey / ciphertext ever logged — only the error
  object shape (message/name), matching the existing `enroll.ts:141` precedent
- 7-day session TTL and sliding-renewal question untouched — out of scope by explicit instruction
- Existing `prfUnavailable` (404) and `cancelled` (NotAllowedError) branches unweakened — verified
  via the updated test suite (all pre-existing 404/cancelled tests still pass unmodified except the
  two AbortError tests that encoded the bug itself)

## Verification

- `npm --prefix web run test -- --run`
- `npm --prefix web run typecheck`
- `npm --prefix web run test:e2e`
