---
phase: 04-prf-unlock-login-unification
plan: 02
subsystem: auth
tags: [webauthn, passkeys, prf, react, next.js, i18n]

# Dependency graph
requires:
  - phase: 04-prf-unlock-login-unification
    provides: "04-01's four endpoints — passkey-login/start|finish (unauthenticated), unlock/start|finish (SessionUser-gated) — and their exact shipped response shapes"
provides:
  - "web/src/lib/passkeys/login.ts — passkeyLogin(email, onStep)/passkeyUnlock(onStep), pure orchestration functions mirroring enroll.ts's convention"
  - "web/src/lib/auth/prfUnavailable.ts — one-shot flag carrying an honest 'no PRF' explanation across the LoginForm-then-reload handoff to UnlockOverlay"
  - "web/src/components/auth/PasskeyUnlockButton.tsx — shared teal CTA (idle/busy), consumed identically by LoginForm and UnlockOverlay"
  - "LoginForm.tsx/UnlockOverlay.tsx wired end-to-end: a single passkey gesture both authenticates and unlocks, with all 3 AUTH-09 fallback tiers plus cancellation independently tested"
affects: [phase-5-multi-device-sync, phase-6-import-export-totp]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "login.ts mirrors enroll.ts's 'pure function, NO React state' convention — components drive their UI purely off an onStep callback"
    - "buildPrfExtensions asymmetry: map KEYS (credential ids) pass through unmodified (already base64url-encoded server-side), only VALUES (salts) get base64-decoded"
    - "Cancellation (NotAllowedError) is swallowed INSIDE login.ts, never surfaced to the caller as a throw — LoginForm/UnlockOverlay's catch blocks only ever see genuine failures, so neither component needs its own isNotAllowedError check"
    - "Same take-once-at-mount idiom reused three times now: takePendingUnlock (03-02), takePrfUnavailableHint (this plan) — both read exactly once via useState(() => take*())"

key-files:
  created:
    - web/src/lib/passkeys/errors.ts
    - web/src/lib/passkeys/login.ts
    - web/src/lib/passkeys/login.test.ts
    - web/src/lib/auth/prfUnavailable.ts
    - web/src/components/auth/PasskeyUnlockButton.tsx
  modified:
    - web/src/lib/passkeys/api.ts
    - web/src/lib/passkeys/enroll.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/auth/LoginForm.tsx
    - web/src/components/auth/UnlockOverlay.tsx
    - web/src/components/auth/LoginForm.test.tsx
    - web/src/components/auth/UnlockOverlay.test.tsx

key-decisions:
  - "LoginForm/UnlockOverlay never call isNotAllowedError themselves — login.ts's passkeyLogin/passkeyUnlock already swallow NotAllowedError internally and resolve normally, so the components' catch blocks are reserved exclusively for genuine (non-cancellation) failures"
  - "UnlockOverlay merges two independent PRF-unavailable signals (mount-time takePrfUnavailableHint() from a prior LoginForm landing, and a same-session passkeyUnlock() resolving { prfUnavailable: true }) into one boolean (showPrfExplainer) so the tier-2 explainer appears identically regardless of which path triggered it — no page reload required for the same-session case"

patterns-established:
  - "Pattern: ceremony orchestration functions (enroll.ts, login.ts) never throw on user cancellation — they detect isNotAllowedError internally and return/resolve a distinguishable non-error result, keeping component-level try/catch reserved for genuine failures only"

requirements-completed: [AUTH-04, AUTH-09, UI-02]

coverage:
  - id: D1
    description: "passkeyLogin() drives passkey-login/start -> get() -> passkey-login/finish, stashing pendingUnlock material on a PRF-capable match and never on a null/absent PRF result"
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#passkeyLogin drives the full PRF-success path"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#with prf_wrapped_uk: null in the finish response"
        status: pass
    human_judgment: false
  - id: D2
    description: "passkeyLogin() never calls passkey-login/finish on a NotAllowedError cancellation; a genuine ceremony rejection is rethrown and reported as 'failed'"
    requirement: AUTH-09
    verification:
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#never calls passkeyLoginFinish when navigator.credentials.get() rejects with NotAllowedError"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#rethrows and reports 'failed' on a genuine (non-cancellation) ceremony rejection"
        status: pass
    human_judgment: false
  - id: D3
    description: "passkeyUnlock() short-circuits on unlock/start's 404 (zero PRF-capable passkeys) without ever calling navigator.credentials.get(), and its PRF-success path unwraps directly (unwrapUserKey + setUnlockedUserKey), never via pendingUnlock"
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#returns { prfUnavailable: true } and never calls navigator.credentials.get() when unlockStart 404s"
        status: pass
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#PRF-success path calls unwrapUserKey then setUnlockedUserKey directly"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildPrfExtensions passes credential-id map keys through unchanged and only base64-decodes the salt values"
    requirement: AUTH-09
    verification:
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#buildPrfExtensions passes map keys through unchanged and only base64-decodes values"
        status: pass
    human_judgment: false
  - id: D5
    description: "prfUnavailable.ts's one-shot flag returns true exactly once after setPrfUnavailableHint(), then false on a second call"
    requirement: AUTH-09
    verification:
      - kind: unit
        ref: "web/src/lib/passkeys/login.test.ts#returns true once after setPrfUnavailableHint(), then false on a second call"
        status: pass
    human_judgment: false
  - id: D6
    description: "LoginForm renders PasskeyUnlockButton between the email and password fields (DOM order) when WebAuthn is supported, and the tier-1 explainer in its place otherwise; a passkeyLogin success calls onAuthed regardless of PRF availability"
    requirement: UI-02
    verification:
      - kind: automated_ui
        ref: "web/src/components/auth/LoginForm.test.tsx#renders the passkey button below the email field and above the password field"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/LoginForm.test.tsx#renders the tier-1 explainer instead of the button when window.PublicKeyCredential is undefined"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/LoginForm.test.tsx#calls onAuthed when passkeyLogin resolves with a PRF-success"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/LoginForm.test.tsx#still calls onAuthed when passkeyLogin resolves { prfUnavailable: true }"
        status: pass
    human_judgment: false
  - id: D7
    description: "UnlockOverlay's pending === null branch renders PasskeyUnlockButton and merges mount-time + same-session PRF-unavailable signals into one tier-2 explainer with password autoFocus; the pending !== null fast path is untouched"
    requirement: AUTH-09
    verification:
      - kind: automated_ui
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#renders the passkey button in the pending === null branch"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#one-click unlocks from pending material without a password prompt"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#shows the PRF-unavailable explainer and autofocuses the password field when takePrfUnavailableHint() returns true at mount"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#surfaces the PRF-unavailable explainer in the same session when passkeyUnlock resolves { prfUnavailable: true }"
        status: pass
    human_judgment: false
  - id: D8
    description: "Genuine (non-cancellation) failures show unlock.passkeyFailed; NotAllowedError cancellations show no error text at all, on both LoginForm and UnlockOverlay"
    requirement: AUTH-09
    verification:
      - kind: automated_ui
        ref: "web/src/components/auth/LoginForm.test.tsx#shows unlock.passkeyFailed on a genuine passkeyLogin rejection"
        status: pass
      - kind: automated_ui
        ref: "web/src/components/auth/UnlockOverlay.test.tsx#shows unlock.passkeyFailed on a genuine passkeyUnlock rejection"
        status: pass
    human_judgment: false
  - id: D9
    description: "Visual taste (teal CTA styling, spacing, copy tone) matches 04-UI-SPEC.md's locked design — a manual/visual check, not unit-testable"
    verification: []
    human_judgment: true
    rationale: "Component/DOM-order tests prove structure and wiring, not pixel-level visual fidelity (color, spacing rhythm, icon composition) — a human should spot-check the rendered screen against 04-UI-SPEC.md's Screen 1 layout at UAT time."

duration: 25min
completed: 2026-07-14
status: complete
---

# Phase 4 Plan 2: Wire Passkey Login/Unlock into LoginForm & UnlockOverlay Summary

**A single `navigator.credentials.get()` gesture now both authenticates (session created) and unlocks (User Key unwrapped) via a shared teal `PasskeyUnlockButton`, with all three AUTH-09 fallback tiers (no-WebAuthn-support, PRF-unavailable, genuine-failure) plus silent cancellation independently tested on both `LoginForm` and `UnlockOverlay`.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-14T11:20:24+02:00
- **Tasks:** 3
- **Files modified:** 5 created, 7 modified

## Accomplishments
- `web/src/lib/passkeys/login.ts` — `passkeyLogin(email, onStep)`/`passkeyUnlock(onStep)`, pure orchestration functions (no React state) mirroring `enroll.ts`'s convention. Every combination of PRF-success/null/404/cancel/genuine-failure routes to the correct side effect: `setPendingUnlock` (login PRF-success), `setPrfUnavailableHint` (null/absent PRF), `unwrapUserKey` + `setUnlockedUserKey` directly (unlock PRF-success), or a silent no-op (cancellation) — never surfaced as an error to the caller.
- `web/src/lib/auth/prfUnavailable.ts` — one-shot take-once flag (identical idiom to `pendingUnlock.ts`) letting a post-passkey-login "no PRF" landing on `UnlockOverlay` carry an honest explanation instead of looking like an ordinary reload.
- `web/src/lib/passkeys/errors.ts` — `isNotAllowedError` hoisted out of `enroll.ts` (predicted by 03-RESEARCH.md Pitfall 4), now shared by both `enroll.ts` and `login.ts`.
- `web/src/components/auth/PasskeyUnlockButton.tsx` — shared, pure-presentational teal CTA (idle/busy, `Fingerprint`+`Loader2`), rendered identically inside `LoginForm` and `UnlockOverlay`.
- `LoginForm.tsx`/`UnlockOverlay.tsx` fully wired per 04-UI-SPEC.md's Screen 1 layout: Email → PasskeyUnlockButton/tier-1 line → tier-2/tier-3 line → divider → password (LoginForm), and the equivalent inside `UnlockOverlay`'s `pending === null` branch only — the existing one-click "Odblokuj" fast path (`pending !== null`) is completely untouched, exactly as 04-RESEARCH.md's Pattern 5 predicted.
- Full `unlock.*` i18n dictionary coverage (PL/EN) added verbatim from 04-UI-SPEC.md's Copywriting Contract.
- Full component/unit test coverage for every fallback tier: 10 new `login.test.ts` cases, 6 new `LoginForm.test.tsx` cases, 6 new `UnlockOverlay.test.tsx` cases — 200/200 tests green across the whole `web/` suite.

## Task Commits

Each task was committed atomically (Task 2 and 3 followed the TDD RED→GREEN gate sequence, `tdd="true"`):

1. **Task 1: API client additions + hoist isNotAllowedError into errors.ts** - `791fea3` (feat)
2. **Task 2 RED: failing test for login.ts orchestration** - `f0cc96e` (test)
2. **Task 2 GREEN: implement passkeyLogin/passkeyUnlock orchestration** - `7c804b2` (feat)
3. **Task 3 RED: failing tests for PasskeyUnlockButton wiring** - `91f63ee` (test)
3. **Task 3 GREEN: wire PasskeyUnlockButton into LoginForm/UnlockOverlay** - `e6d40af` (feat)

**Plan metadata:** (this commit) - `docs(04-02): complete plan`

## Files Created/Modified
- `web/src/lib/passkeys/api.ts` - added `passkeyLoginStart`/`passkeyLoginFinish`/`unlockStart`/`unlockFinish`, matching 04-01's exact shipped response shapes
- `web/src/lib/passkeys/errors.ts` (new) - `isNotAllowedError`, hoisted from `enroll.ts`
- `web/src/lib/passkeys/enroll.ts` - imports `isNotAllowedError` instead of redefining it (pure refactor)
- `web/src/lib/passkeys/login.ts` (new) - `passkeyLogin`/`passkeyUnlock`/`buildPrfExtensions` orchestration
- `web/src/lib/passkeys/login.test.ts` (new) - 10 tests covering every branch combination
- `web/src/lib/auth/prfUnavailable.ts` (new) - one-shot `setPrfUnavailableHint`/`takePrfUnavailableHint` flag
- `web/src/lib/i18n/dictionary.ts` - 7 new `unlock.*` keys (PL/EN)
- `web/src/components/auth/PasskeyUnlockButton.tsx` (new) - shared teal CTA
- `web/src/components/auth/LoginForm.tsx` - `handlePasskeyLogin`, capability pre-check, email pre-fill, reordered JSX
- `web/src/components/auth/UnlockOverlay.tsx` - `handlePasskeyUnlock`, mount-time PRF-unavailable hint + same-session merge, reordered JSX inside `pending === null` branch only
- `web/src/components/auth/LoginForm.test.tsx` - 6 new tests (DOM order, onAuthed on success/prfUnavailable, tier-3 failure, cancellation no-op)
- `web/src/components/auth/UnlockOverlay.test.tsx` - 6 new tests (button presence, tier-1/tier-2/tier-3, cancellation no-op)

## Decisions Made
- `LoginForm`/`UnlockOverlay` never call `isNotAllowedError` themselves — `login.ts`'s `passkeyLogin`/`passkeyUnlock` already swallow `NotAllowedError` internally and resolve normally (never throw for that case), so the components' `catch` blocks are reserved exclusively for genuine (non-cancellation) failures. Confirmed via Task 2's contract before writing Task 3, per the plan's own instruction to "confirm Task 2's exact contract before deciding."
- `UnlockOverlay` merges two independent PRF-unavailable signals — the mount-time `takePrfUnavailableHint()` (a prior `LoginForm` landing) and a same-session `passkeyUnlock()` resolving `{ prfUnavailable: true }` (404 pre-check or post-ceremony null) — into one `showPrfExplainer` boolean, so the tier-2 explainer appears identically regardless of which path triggered it, without requiring a page reload for the same-session case (per the plan's explicit instruction not to require reload here).

## Deviations from Plan

None — plan executed exactly as written. `node_modules` and the WASM bindings (`web/src/lib/crypto/wasm/`) were missing at the start of this session (fresh worktree checkout); ran `npm install` and `npm run predev` (the project's own build-wasm.sh hook) before any verification could run — this is normal worktree setup, not a plan deviation, and both are gitignored/regenerated so no files were committed for this.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The full unified login/unlock flow (AUTH-04's "single passkey gesture" requirement) is now demoable end-to-end in a real browser with a PRF-capable authenticator: `LoginForm` → session + vault unlock in one gesture; `UnlockOverlay` reload/auto-lock → one-click unlock via `PasskeyUnlockButton`.
- All 3 AUTH-09 fallback tiers (no-WebAuthn-support, PRF-unavailable, genuine mid-ceremony failure) plus cancellation are independently tested and visually distinct per 04-UI-SPEC.md.
- Manual/visual UAT still recommended (see coverage item D9): confirm the rendered teal CTA, spacing, and copy tone against 04-UI-SPEC.md's Screen 1 in an actual browser with a real or virtual authenticator (Chrome's WebAuthn DevTools panel supports PRF simulation) — unit/component tests prove structure and wiring, not pixel-level visual fidelity.
- No further backend plumbing needed — 04-01's four endpoints are fully consumed by this plan.

---
*Phase: 04-prf-unlock-login-unification*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 13 created/modified files and all 5 task commits (`791fea3`, `f0cc96e`, `7c804b2`, `91f63ee`, `e6d40af`) verified present on disk / in git log.
