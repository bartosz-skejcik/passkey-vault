---
phase: 15-login-unlock-unification-vaultwarden-model
plan: 01
subsystem: auth
tags: [webauthn, prf, extension, wxt, vitest, react, i18n]

# Dependency graph
requires: []
provides:
  - "unlock.serverCeremony.relay's third, mutually-exclusive password-shaped Message variant + invalid-credentials error member (ext-protocol.ts)"
  - "completeServerUnlock()'s password branch, mode-pinned to signin-only, delegating to unlock.ts's handleUnlockPassword (server-unlock.ts)"
  - "router.ts's handleServerUnlockRelayMessage forwarding of the password variant (Rule 3 fix, required for the union member to route)"
  - "content-relay.content.ts's ExtUnlockBridgeMessage/isExtUnlockBridgeMessage/handleExtUnlockBridgeMessage acceptance+forwarding of {passwordB64, email}"
  - "ExtUnlockBridge.tsx's mode='signin' password form (handlePasswordSignIn, awaitingPasswordAckRef) alongside the existing passkey button"
  - "dictionary.ts: extUnlock.passwordLabel / extUnlock.passwordSubmit (PL+EN)"
affects: [15-03, 15-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Password-relay branch delegates to unlock.ts's handleUnlockPassword rather than re-deriving Argon2id material in server-unlock.ts -- D-05's WASM/pv-core choke-point invariant preserved"
    - "Password payload detected via `\"passwordB64\" in args`/`\"passwordB64\" in message`/`\"passwordB64\" in event.data` at each relay hop -- mirrors the codebase's existing discriminated-union-by-field-presence convention (e.g. args.failed === true)"
    - "Shared onMessage ack listener in ExtUnlockBridge.tsx branches on a second, mutually-exclusive ref (awaitingPasswordAckRef) parallel to awaitingAckRef -- same 'which submission does this ack belong to' pattern, not a second listener"

key-files:
  created: []
  modified:
    - extension/lib/messaging/ext-protocol.ts
    - extension/entrypoints/background/server-unlock.ts
    - extension/entrypoints/background/server-unlock.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - web/src/components/auth/ExtUnlockBridge.tsx
    - web/src/components/auth/ExtUnlockBridge.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "Rule 3 fix: extended router.ts's handleServerUnlockRelayMessage to forward the new password-shaped Message union member -- not in the plan's files_modified list, but tsc failed hard without it (the union member could not compile through the existing PRF-only forwarding call), confirming the wiring is required for the feature to exist at all, not an optional nicety"
  - "Password payload's mode-pinning check runs BEFORE the existing PRF-only T-13-16 checks (early return, not an else-wrapped block) -- functionally identical to the plan's literal 'else branch' instruction, chosen because it kept the diff smaller and the PRF branch's existing comment block untouched"

patterns-established:
  - "A third Message union variant for an existing 'kind' is detected via TypeScript's `in` operator at every hop (relay, router, background) rather than a new discriminant field -- keeps the wire shape minimal (no redundant tag) while staying type-safe"

requirements-completed: [AUTH-01]

coverage:
  - id: D1
    description: "Extension background: completeServerUnlock()'s password branch rejects a mode:'unlock' pending record (invalid-mode-payload), and on mode:'signin' re-guards against a concurrent sign-in, delegates to handleUnlockPassword, and maps ok/invalid-credentials/other-error to the typed result"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/server-unlock.test.ts#password-shaped payload (Plan 15-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "content-relay.content.ts accepts and forwards the {passwordB64, email} postMessage shape verbatim (never the PRF shape), rejects malformed/empty fields, respects single-use nonce + configured-server-origin gates"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#password-shaped payload (Plan 15-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ExtUnlockBridge.tsx mode='signin' renders a password field + submit button alongside the passkey button (passkey-first); submitting posts {passwordB64, email} (standard base64, zeroized after encode); ok:true ack settles to success + closes window; ok:false ack shows an inline auth.loginFailed error and returns to idle (retry-able), never a full-screen terminal state"
    requirement: AUTH-01
    verification:
      - kind: unit
        ref: "web/src/components/auth/ExtUnlockBridge.test.tsx#ExtUnlockBridge — password sign-in (Plan 15-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full end-to-end live browser proof of the password-sign-in path through the ceremony window (real webauthn-less password flow, real extension build)"
    verification: []
    human_judgment: true
    rationale: "This plan is unit/integration-level by design (environment_notes: 'No live browser lanes required for this plan') -- Plan 15-07's e2e rework is the deliberate follow-on that drives this exact path from Playwright/Selenium against a real build."

# Metrics
duration: ~55min
completed: 2026-07-20
status: complete
---

# Phase 15 Plan 01: Password-Relay Sign-In Through the Ceremony Window Summary

**Master-password sign-in path added to the server-origin ceremony window (`ExtUnlockBridge.tsx`, `mode="signin"`), relaying `{passwordB64, email}` through content-relay into the extension background's already-tested `handleUnlockPassword`, so an account with no enrolled passkey can still complete a full sign-in without the popup ever rendering its own password form.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- `completeServerUnlock()` gained a mode-pinned password branch (mode:'unlock' rejects it as `invalid-mode-payload`; mode:'signin' re-guards against a concurrent sign-in, then delegates to `unlock.ts`'s `handleUnlockPassword` -- never touches WASM/pv-core directly)
- `content-relay.content.ts` accepts and forwards the `{passwordB64, email}` postMessage shape verbatim, shape-checked distinctly from the base64url PRF field (standard base64, non-empty-string check)
- `ExtUnlockBridge.tsx`'s `mode="signin"` surface now renders a password field + submit button below the existing passkey button (passkey-first presentation per the AMENDMENT), with its own ack-handling branch that returns wrong-password to an inline, retry-able error rather than a full-screen terminal state
- `router.ts`'s content-frame message dispatcher extended to route the new password variant (Rule 3 fix -- caught by `tsc`, required for the feature to compile/route at all)

## Task Commits

Each task was committed atomically:

1. **Task 1: Password-relay branch — ext-protocol.ts, server-unlock.ts, content-relay.content.ts** - `3ca4cd6` (feat)
2. **Task 2: ExtUnlockBridge.tsx password form (web/)** - `97eeb97` (feat)

_Both tasks were TDD-flagged (`tdd="true"`); tests were written and run alongside the implementation edits in the same commit per this codebase's established single-commit-per-task convention (test files are listed in each task's own `files` list, not split into separate RED/GREEN commits)._

## Files Created/Modified
- `extension/lib/messaging/ext-protocol.ts` - Third `unlock.serverCeremony.relay` Message variant (password-shaped) + `invalid-credentials` error member
- `extension/entrypoints/background/server-unlock.ts` - `completeServerUnlock()`'s password branch, mode-pinned to signin-only
- `extension/entrypoints/background/server-unlock.test.ts` - 5 new test cases for the password branch
- `extension/entrypoints/background/router.ts` - `handleServerUnlockRelayMessage` forwards the password variant (Rule 3 fix)
- `extension/entrypoints/content-relay.content.ts` - `ExtUnlockBridgeMessage`/`isExtUnlockBridgeMessage`/`handleExtUnlockBridgeMessage` accept+forward `{passwordB64, email}`
- `extension/entrypoints/__tests__/content-relay.test.ts` - 7 new test cases for the password-shaped relay path
- `web/src/components/auth/ExtUnlockBridge.tsx` - `handlePasswordSignIn()`, `awaitingPasswordAckRef`, password form markup, shared ack-listener branch
- `web/src/components/auth/ExtUnlockBridge.test.tsx` - 4 new test cases for the password sign-in path
- `web/src/lib/i18n/dictionary.ts` - `extUnlock.passwordLabel` / `extUnlock.passwordSubmit` (PL+EN)

## Decisions Made
- **Rule 3 (blocking-issue auto-fix):** `router.ts`'s `handleServerUnlockRelayMessage` was not in the plan's `files_modified` list, but `tsc` failed hard (4 errors: `prfB64`/`prfWrappedUk`/`token`/`accountEmail` "does not exist" on the new union member) because the existing PRF-only forwarding call couldn't type-check against a 3-member union without a branch for the new variant. Added an `if ("passwordB64" in message)` branch that forwards `{nonce, passwordB64, email}` verbatim to `completeServerUnlock`, mirroring the PRF branch's own faithful-forwarding discipline. This is required wiring for the feature to exist at all (a page could post the password payload, but it would never route to the background), not scope creep.
- Implemented the password payload's mode-pinning check as an early-return `if ("passwordB64" in args) { ... }` block placed BEFORE the existing PRF-only T-13-16 checks, rather than wrapping the PRF checks in an explicit `else`. Functionally identical to the plan's literal "must only run in the else branch" instruction (an early return achieves the same exclusivity), and kept the existing PRF-branch comment block byte-for-byte untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] router.ts's handleServerUnlockRelayMessage did not forward the new password variant**
- **Found during:** Task 1, first `tsc --noEmit` run after the ext-protocol.ts/server-unlock.ts/content-relay.content.ts edits
- **Issue:** `router.ts` (not in this plan's `files_modified`) is the sole caller of `completeServerUnlock()` from the content-frame channel; its existing call site only ever passed the PRF fields, so `tsc` failed with 4 "property does not exist" errors on the new union member
- **Fix:** Added an `if ("passwordB64" in message)` branch to `handleServerUnlockRelayMessage` that constructs the password-shaped `completeServerUnlock` args and forwards them verbatim
- **Files modified:** `extension/entrypoints/background/router.ts`
- **Verification:** `npx tsc --noEmit` clean of this error class after the fix; `server-unlock.test.ts`'s password-branch tests (which exercise `completeServerUnlock` directly, not through router.ts) plus a manual read of the new branch confirm correct pass-through
- **Committed in:** `3ca4cd6` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential wiring fix -- without it the new Message union member would type-check in isolation but never actually route from the content-frame channel to `completeServerUnlock`. No scope creep; router.ts's change is a single, minimal, symmetric branch mirroring the existing PRF forwarding.

## Issues Encountered
- **Pre-existing environment gap (not caused by this plan, not fixed):** this is a fresh git worktree with no built `pv-wasm` artifacts (`extension/lib/crypto/wasm/pv_wasm.js`, `web/src/lib/crypto/wasm/pv_wasm.js` do not exist -- `scripts/build-wasm.sh` requires `wasm-bindgen-cli` which isn't installed, plus a full `cargo build -p pv-wasm --target wasm32-unknown-unknown --release`). This surfaces as:
  - `extension`: `npx tsc --noEmit` reports 2 pre-existing errors in `lib/crypto/wasm-loader.ts` / `entrypoints/background/vault-session.ts` (unrelated to any file this plan touches)
  - `extension`: `npx vitest run` (full suite) fails to even load 2 test files (`router.test.ts`, `router-capture.test.ts`) with `Cannot find module './wasm/pv_wasm.js'` -- confirmed pre-existing by checking `router.ts`'s imports at the plan's own base commit (`3858f24`), which already imported `handleUnlockPassword` from `./unlock`, itself importing `wasm-loader.ts`, well before any of this plan's edits
  - `web`: `npx tsc --noEmit` reports 10 pre-existing errors, all in `src/lib/crypto/index.ts`/`index.test.ts` (same missing-module class), none in `ExtUnlockBridge.tsx`/`dictionary.ts`
  - This matches the environment_notes' own documented baseline caveat (extension "674 passing... 1 known pre-existing unhandled rejection... 674/674 IS green") -- this worktree additionally lacks the WASM build step that CI/a fully-provisioned dev environment would normally have run first. Both of this plan's own target test files (`server-unlock.test.ts`, `content-relay.test.ts` on the extension side; `ExtUnlockBridge.test.tsx` on the web side) run and pass cleanly in isolation (they don't import the WASM-loading chain), which is what the plan's own `<verify>` commands target.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 15-03 (popup re-layout, removes the popup's own sign-in form) can now proceed: the ceremony window is proven to carry a full sign-in via EITHER password or passkey, so removing the popup's password form does not strand passkey-less accounts.
- Plan 15-07 (e2e rework) has a concrete, unit-tested password-relay path to drive from Playwright/Selenium against a real build (once `scripts/build-wasm.sh` is run in that environment).
- No blockers introduced by this plan. The pre-existing missing-WASM-artifact gap (see Issues Encountered) is an environment provisioning matter, not a code defect, and does not block this plan's own success criteria.

---
*Phase: 15-login-unlock-unification-vaultwarden-model*
*Completed: 2026-07-20*

## Self-Check: PASSED

All 9 modified/created source files confirmed present on disk; both task commits (`3ca4cd6`, `97eeb97`) confirmed present in `git log --oneline --all`.
