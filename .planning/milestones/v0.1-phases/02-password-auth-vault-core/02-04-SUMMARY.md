---
phase: 02-password-auth-vault-core
plan: 04
subsystem: web-auth
tags: [nextjs, react, i18n, webauthn-prep, lock-state, idle-timer, useSyncExternalStore]

# Dependency graph
requires:
  - phase: 02-password-auth-vault-core (plan 01)
    provides: crypto facade (deriveAuthMaterial/generateUserKey/wrapUserKey/unwrapUserKey/randomSalt/defaultKdfParamsJson) over pv-core WASM
  - phase: 02-password-auth-vault-core (plan 02)
    provides: POST /api/auth/{prelogin,register,login,logout} + GET /api/auth/me wire shapes
provides:
  - "Register → Login → Unlock → auto-lock journey in the browser (AUTH-01, AUTH-02, AUTH-08 client half)"
  - "Lock-state singleton in web/src/lib/crypto/index.ts: setUnlockedUserKey/getUnlockedUserKey/lockVault/isUnlocked/subscribeLockState/useIsUnlocked"
  - "i18n contract: DICTIONARY + t() + LocaleProvider/useLocale in web/src/lib/i18n/, PL/EN, pre-hydration lang script (no FOUC)"
  - "apiFetch base client + typed auth wrappers (prelogin/register/login/logout/me) + ApiClientError with .status"
  - "useIdleTimer(timeoutMs, onIdle) primitive + settings dropdown (auto-lock minutes, language, lock-now, logout)"
affects: [02-05 (vault UI consumes useIsUnlocked/apiFetch/dictionary), 02-06 (generator plan reuses strength.ts), 03 (passkey enrollment reuses auth surfaces)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lock state via module-level singleton + useSyncExternalStore(subscribeLockState, isUnlocked, () => false) — no context provider needed for lock state"
    - "Pre-hydration IIFE <script dangerouslySetInnerHTML> for locale (mirrors themeInitScript) — html lang set before first paint, no flash of wrong language"
    - "pendingUnlock take-once holder: LoginForm stashes derived wrapping key so UnlockOverlay skips a second Argon2id pass in the same tab session"
    - "Protection = no data in the render tree while locked; backdrop-blur is cosmetic reinforcement only (MainColumn children mounted only when useIsUnlocked())"

key-files:
  created:
    - web/src/lib/i18n/dictionary.ts
    - web/src/lib/i18n/LocaleContext.tsx
    - web/src/lib/generator/strength.ts
    - web/src/lib/auth/api.ts
    - web/src/lib/auth/session.ts
    - web/src/lib/auth/pendingUnlock.ts
    - web/src/lib/idle/useIdleTimer.ts
    - web/src/components/auth/AuthCard.tsx
    - web/src/components/auth/RegisterForm.tsx
    - web/src/components/auth/LoginForm.tsx
    - web/src/components/auth/UnlockOverlay.tsx
    - web/src/app/self-test/page.tsx
    - web/vitest.setup.ts
  modified:
    - web/src/lib/crypto/index.ts
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/self-test/SelfTestCard.tsx
    - web/src/app/layout.tsx
    - web/src/app/page.tsx
    - web/src/app/globals.css
    - .gitignore

key-decisions:
  - "Session token in plain localStorage (keys pv-session-token/pv-account-email) — CONTEXT.md-locked v0.1 choice; httpOnly-cookie hardening explicitly deferred pre-v1.0"
  - "LoginForm never calls unwrapUserKey — unlock is UnlockOverlay's job, preserving the visibly-distinct unlock step (AUTH-02)"
  - "RegisterForm derives auth material once and reuses the same auth_hash for the follow-up login call — user types the password exactly once and lands unlocked"
  - "useIdleTimer is a timeout-agnostic primitive; the configured minutes (localStorage pv-autolock-minutes, default 15) are read at the page.tsx call site"
  - "lockVault() early-returns without notifying when already locked — repeated idle firings are idempotent (T-02-17)"

patterns-established:
  - "Pattern: all auth components consume the crypto facade via @/lib/crypto — zero direct ./wasm imports (choke-point invariant, grep-verified)"
  - "Pattern: every user-facing string goes through t(locale, key) against DICTIONARY — no hardcoded UI copy in components"

requirements-completed: [AUTH-01, AUTH-02, AUTH-08]

duration: unknown (session interrupted before summary write; closed out by orchestrator)
completed: 2026-07-13
status: complete
---

# Phase 02 Plan 04: Auth UI, Unlock Overlay & i18n Summary

**The browser half of AUTH-01/AUTH-02/AUTH-08: registration (one password entry, lands unlocked), login (lands authenticated-but-locked), the architecturally-distinct unlock overlay over a data-free blurred shell, idle auto-lock that frees the WASM UserKey handle without killing the session, and the PL/EN i18n contract every later component consumes.**

> Note: the executing session was interrupted after all four task commits landed but before this SUMMARY.md was written. The orchestrator verified the work post-hoc (tests, build, and every acceptance-criteria grep) and closed the plan out manually.

## Accomplishments

- **Task 1 (`c46f574`)** — i18n dictionary (54 PL/EN keys covering UI-SPEC's Copywriting Contract + aria tables), `LocaleProvider`/`useLocale`, `scorePasswordStrength`, `apiFetch` + typed auth wrappers matching Plan 02-02's exact wire shapes, localStorage session helpers, take-once `pendingUnlock` holder, `web/.env.local` (gitignored) with the dev API base URL.
- **Task 2 (`bb13126` RED, `c03f93b` GREEN)** — `AuthCard`/`RegisterForm`/`LoginForm` + unauthenticated routing in `page.tsx`. Register derives once → register → login with the same auth_hash → `setUnlockedUserKey` (no unwrap needed). Login stashes the wrapping key via `setPendingUnlock` and never unwraps. 401 surfaces as a single generic inline error (server-side indistinguishability preserved).
- **Task 3 (`fc6c378` RED, `8237fee` GREEN)** — Lock-state singleton in the crypto facade (`setUnlockedUserKey`/`getUnlockedUserKey`/`lockVault`/`isUnlocked`/`subscribeLockState`/`useIsUnlocked` via `useSyncExternalStore`), `useIdleTimer` primitive, `UnlockOverlay` (pending-unlock fast path or password re-derive path; `me()` 401 → clean fall-back to Login), and the hard no-data-behind-the-blur guarantee: `MainColumn` children only mount when unlocked.
- **Task 4 (`076fef8`)** — Sidebar settings dropdown (auto-lock 1/5/15/30/60 min persisted to `pv-autolock-minutes`, PL↔EN switcher, lock-now, logout), `localeInitScript` pre-hydration lang script, self-test moved to `/self-test` route, both Phase 1 UI-REVIEW carry-forwards fixed (fatal-branch retry button; "patrz błąd przy kroku powyżej" reword), light-theme `base-300` token fixed to `oklch(93% 0.004 67.80)`.

## Verification (post-hoc, orchestrator)

- `cd web && npm test` — 6 files, 24 tests, all pass.
- `cd web && npm run build` — static export exits 0 (routes: `/`, `/self-test`).
- Acceptance-criteria greps all pass: `.gitignore` has `web/.env.local`; dictionary spot-check ≥4; `pendingUnlock.ts` has 0 `./wasm` imports; `LoginForm.tsx` has 0 `unwrapUserKey`; `RegisterForm.tsx` has `setUnlockedUserKey`; `UnlockOverlay.tsx` has `backdrop-blur`; `globals.css` has exactly 1 remaining `oklch(98.86% 0.0017 67.80)` (base-200 only).

## Task Commits

1. **Task 1:** `c46f574` (feat) — i18n dictionary + auth API client + strength util
2. **Task 2:** `bb13126` (test RED) + `c03f93b` (feat GREEN) — register/login forms + unauthenticated routing
3. **Task 3:** `fc6c378` (test RED) + `8237fee` (feat GREEN) — unlock overlay, lock-state singleton, idle-timer hook
4. **Task 4:** `076fef8` (feat) — settings dropdown, self-test relocation, carried-forward UI fixes

## Next Phase Readiness

**For Plan 02-05 (vault UI):**

- Reuse `apiFetch` from `@/lib/auth/api` for `/api/vault/*` calls (base URL + Bearer header handled).
- Gate all decrypted-data rendering on `useIsUnlocked()` from `@/lib/crypto` — the locked shell must contain no item data in the DOM (T-02-14 contract already enforced at `page.tsx`).
- Add new UI strings to `DICTIONARY` (keys like `vault.emptyHeading`, `item.save`, `toast.copied` already stubbed in for this phase's copy inventory).

**For Plan 02-06:** `scorePasswordStrength` in `web/src/lib/generator/strength.ts` is the shared strength primitive — extend, don't recreate.

**Human verification still outstanding** (folded into phase-level verification): register→land-unlocked, login→overlay-over-blur with no plaintext behind it (DevTools), 1-minute auto-lock reappears the overlay without logging out, PL↔EN switch with no reload flash.

---
*Phase: 02-password-auth-vault-core*
*Completed: 2026-07-13*

## Self-Check: PASSED

All created/modified files verified present on disk. All task commit hashes verified present in git log (6/6: `c46f574`, `bb13126`, `c03f93b`, `fc6c378`, `8237fee`, `076fef8`). Tests, build, and acceptance-criteria greps re-run and green at close-out.
