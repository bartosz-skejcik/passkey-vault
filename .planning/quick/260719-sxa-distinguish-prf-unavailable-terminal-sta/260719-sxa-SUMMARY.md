---
phase: quick-260719-sxa
plan: 1
subsystem: web (passkey ceremony helpers + ExtUnlockBridge)
tags: [webauthn, prf, firefox, ext-unlock-bridge, i18n]
dependency-graph:
  requires: []
  provides:
    - "PasskeyLoginCeremonyResult.prfBrowserGap / PasskeyUnlockCeremonyResult.prfBrowserGap"
    - "ExtUnlockBridge 'prf-unavailable' terminal state (signin + unlock modes)"
  affects:
    - web/src/lib/passkeys/login.ts
    - web/src/components/auth/ExtUnlockBridge.tsx
tech-stack:
  added: []
  patterns:
    - "Three-way ceremony result split (full success / browser-gap / no-match) replacing a two-case collapse, mirrored identically across login and unlock ceremonies"
key-files:
  created: []
  modified:
    - web/src/lib/passkeys/login.ts
    - web/src/lib/passkeys/login.test.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/auth/ExtUnlockBridge.tsx
    - web/src/components/auth/ExtUnlockBridge.test.tsx
decisions:
  - "prfBrowserGap check placed BEFORE the existing prfBytes-undefined collapse check in both handleUnlock branches (signin/unlock) -- a browser-gap result also leaves prfBytes/prfWrappedUk undefined, so ordering determines which terminal state wins."
  - "No extension-side protocol change: postFailureNotice()'s {source, nonce, failed:true} envelope reused byte-for-byte for the new prf-unavailable state, exactly as for no-passkeys/not-signed-in/failed."
metrics:
  duration: "~6 min"
  completed: 2026-07-19
status: complete
---

# Phase quick-260719-sxa Plan 1: Distinguish PRF-unavailable terminal state Summary

Split `login.ts`'s two-case PRF collapse into three distinct ceremony outcomes (full success / browser-gap / no-match) and wired a dedicated `prf-unavailable` terminal state into `ExtUnlockBridge.tsx` (both signin and unlock modes), so a Firefox/macOS user whose passkey worked server-side but whose browser returned no PRF bytes sees accurate copy instead of the generic "no passkeys" message.

## What Was Built

**Task 1 — `web/src/lib/passkeys/login.ts` + `login.test.ts`** (commit `6e44467`)

- Added `prfBrowserGap: boolean` to both `PasskeyLoginCeremonyResult` and `PasskeyUnlockCeremonyResult`.
- `passkeyLoginCeremony` and `passkeyUnlockCeremony` now have three distinct return sites instead of the prior two-case collapse:
  - Full PRF success: `prfUnavailable: false, prfBrowserGap: false` (unchanged behavior, field added).
  - Server verified the assertion and returned a PRF-capable `prf_wrapped_uk`, but `extractPrfBytes()` is `undefined` (the browser itself returned no PRF bytes — Firefox's documented `{}` gap): `prfUnavailable: true, prfBrowserGap: true`.
  - `prf_wrapped_uk === null` (no PRF-capable credential matched at all) / `unlockStart()` 404 (zero PRF-capable passkeys registered): `prfUnavailable: true, prfBrowserGap: false` (unchanged externally-observable outcome, field added explicitly).
- `cancelled: true` (NotAllowedError) outcomes untouched in both ceremonies.
- `passkeyLogin`/`passkeyUnlock` (the thin wrapper functions) intentionally left untouched — their own `{prfUnavailable, cancelled}` return shape doesn't need the finer distinction.
- 4 new tests added directly against `passkeyLoginCeremony`/`passkeyUnlockCeremony` (not the wrappers), covering the browser-gap branch and the pre-existing no-match/404 branch with the new field asserted explicitly.

**Task 2 — `dictionary.ts` + `ExtUnlockBridge.tsx` + `ExtUnlockBridge.test.tsx`** (commit `40ba92d`)

- Two new dictionary keys (D-03 tone, matching the existing `extUnlock.*` style):
  - `extUnlock.prfUnavailable` (unlock mode)
  - `extUnlock.signinPrfUnavailable` (signin mode)
  - Final PL/EN copy — see "Final Copy" section below.
- `BridgeState` gained `"prf-unavailable"`, placed between `"not-signed-in"` and `"failed"`.
- In `handleUnlock`, both the signin branch and the unlock branch now check `result.prfBrowserGap` immediately after the existing `cancelled` check and **before** the existing `prfBytes === undefined` collapse check (ordering is load-bearing: a browser-gap result also leaves `prfBytes`/`prfWrappedUk` undefined). On a match: `setState("prf-unavailable"); postFailureNotice();` — same envelope, same wire path as `no-passkeys`/`not-signed-in`/`failed`.
- New render branch for `state === "prf-unavailable"`, styled neutrally (`text-sm text-base-content/70`, not `text-error`) since the passkey itself did not fail, placed after `not-signed-in` and before `failed`.
- `awaitingAckRef`'s doc comment updated to list `prf-unavailable` among the terminal states protected from a late content-relay ack overwrite — no code change to the guard itself, since `prf-unavailable` only ever calls `postFailureNotice()` (never `postAndWaitForAck()`), structurally identical to `no-passkeys`/`not-signed-in`.
- 3 new tests added (matching the plan's explicit specification, see "Test count note" below):
  1. Unlock mode: browser-gap ceremony result → `prf-unavailable` state rendered + `postFailureNotice()`'s exact envelope asserted.
  2. Unlock mode, inside the existing late-ack-guard `describe` block: a late `ok: false` ack for the same nonce does not clobber the already-rendered `prf-unavailable` state.
  3. Signin mode: browser-gap ceremony result → `extUnlock.signinPrfUnavailable` rendered + same failure envelope asserted.

## Final Copy (dictionary.ts)

```
"extUnlock.prfUnavailable": {
  pl: "Passkey zadziałał, ale ta przeglądarka nie zwróciła sekretu PRF potrzebnego do odblokowania sejfu (ograniczenie przeglądarki lub urządzenia). Odblokuj hasłem — albo spróbuj w Chrome, gdzie PRF działa.",
  en: "Your passkey worked, but this browser didn't return the PRF secret needed to unlock your vault (a browser or device limitation). Unlock with your password instead — or try Chrome, where PRF works.",
},
"extUnlock.signinPrfUnavailable": {
  pl: "Zalogowano passkeyem, ale ta przeglądarka nie zwróciła sekretu PRF potrzebnego do odblokowania sejfu (ograniczenie przeglądarki lub urządzenia). Zaloguj się hasłem — albo spróbuj w Chrome, gdzie PRF działa.",
  en: "You signed in with your passkey, but this browser didn't return the PRF secret needed to unlock your vault (a browser or device limitation). Sign in with your password instead — or try Chrome, where PRF works.",
},
```

These are byte-for-byte the strings specified in the plan.

## Commits

| Commit | Task | Files |
|--------|------|-------|
| `6e44467` | Task 1 | `web/src/lib/passkeys/login.ts`, `web/src/lib/passkeys/login.test.ts` |
| `40ba92d` | Task 2 | `web/src/lib/i18n/dictionary.ts`, `web/src/components/auth/ExtUnlockBridge.tsx`, `web/src/components/auth/ExtUnlockBridge.test.tsx` |

## Verification Gate Results (exact output)

**Task 1** — `cd web && npx vitest run src/lib/passkeys/login.test.ts`
```
✓ src/lib/passkeys/login.test.ts (19 tests) 8ms
Test Files  1 passed (1)
     Tests  19 passed (19)
```
`grep -c 'prfBrowserGap' web/src/lib/passkeys/login.ts` → `11` (well over the required minimum of 8: 2 interface fields + 9 return-site assignments across both ceremony functions).

**Task 2 final gate** — `cd web && npx vitest run && npx tsc --noEmit && NEXT_PUBLIC_API_BASE_URL="" npm run build && test "$(grep -rl '127.0.0.1:8620' out --include='*.js' | wc -l | tr -d ' ')" = "0" && echo GATE_OK`

- **vitest**: `Test Files 55 passed (55)` / `Tests 463 passed (463)`, zero skips. (`src/components/auth/ExtUnlockBridge.test.tsx (29 tests)`, `src/lib/passkeys/login.test.ts (19 tests)`.)
- **tsc --noEmit**: clean, no output.
- **Static export build** (`NEXT_PUBLIC_API_BASE_URL="" npm run build`): completed cleanly — `✓ Compiled successfully`, `✓ Generating static pages using 5 workers (4/4)`.
- **Poisoned-URL grep** (`grep -rl "127.0.0.1:8620" web/out --include="*.js" | wc -l`): `0`.
- **git-status-outside-web diff** (`git status --porcelain -- . ':!web'` before vs. after the whole plan): empty diff — confirmed via `diff /tmp/pv-260719-sxa-pre.txt /tmp/pv-260719-sxa-post.txt` producing no output, both immediately before Task 2's edits and again after the full gate ran (a second `bash scripts/build-wasm.sh` invocation via `prebuild` regenerates the gitignored `extension/lib/crypto/wasm/*` / `extension/public/wasm/*` artifacts, which stay untracked and outside this diff).
- Final `echo GATE_OK` printed.

**Test count vs. plan's stated arithmetic**: The plan's `<done>` criterion said "≥ 456 + 4 (Task 1) + 4 (Task 2) = 464 or more", but Task 2's own `<action>` text explicitly specifies exactly **3** new `ExtUnlockBridge.test.tsx` tests (unlock-mode browser-gap, unlock-mode late-ack-guard, signin-mode browser-gap) — no fourth test is described anywhere in the task body. I implemented exactly the 3 tests specified in the action text rather than fabricating an unspecified 4th test to hit the arithmetic total. Actual final count: 456 baseline + 4 (Task 1, login.test.ts) + 3 (Task 2, ExtUnlockBridge.test.tsx) = **463**, all green, zero skips. This is a plan-arithmetic discrepancy (off by one in the stated total), not a shortfall in test coverage against what the plan's action text actually asked for.

## Baseline environment note

This worktree had no `web/node_modules` and no `web/src/lib/crypto/wasm/*` (gitignored, wasm-pack-generated) artifacts on first checkout — `npm install` (from the existing `package-lock.json`, no dependency changes) and `bash scripts/build-wasm.sh` were run once to establish a runnable baseline before Task 1's verify command could execute. Both are gitignored build outputs, confirmed via `git check-ignore -v` and the empty `git status --porcelain -- . ':!web'` diff throughout — no plan-scope files were affected.

## Confirmation: unchanged behavior

- `no-passkeys`/`not-signed-in`/`failed`/`cancelled` states: all pre-existing tests for these states pass unmodified (no assertions changed) — verified in the full 463-test green run above.
- Zero files outside `web/` modified (verified twice via the empty git-status diff).
- `passkeyLogin`/`passkeyUnlock` wrapper functions untouched — only their internal `passkeyLoginCeremony`/`passkeyUnlockCeremony` callees gained the new field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `web/node_modules` and WASM build artifacts in this fresh worktree**
- **Found during:** Task 1's initial verify attempt (`npx vitest run` failed at config load with `Cannot find module 'vitest/config'`).
- **Issue:** This worktree checkout had no `node_modules` installed and no `web/src/lib/crypto/wasm/pv_wasm.js` (gitignored, generated by `bash scripts/build-wasm.sh` from `crates/pv-wasm`) — both are build prerequisites, not plan-scope files, and their absence blocked every subsequent verify step.
- **Fix:** Ran `cd web && npm install` (installs from the existing, unmodified `package-lock.json` — no `package.json`/`package-lock.json` changes) and `bash scripts/build-wasm.sh` (regenerates the gitignored WASM glue/binary for both `web/` and `extension/` — the script's own single-source-of-truth design regenerates both targets together; `extension/` output is a gitignored build artifact, not a tracked file, confirmed via `git check-ignore -v` and the empty outside-web diff).
- **Files modified:** None tracked — `node_modules/` and `web/src/lib/crypto/wasm/*` / `extension/lib/crypto/wasm/*` / `web/public/wasm/*` / `extension/public/wasm/*` are all gitignored.
- **Commit:** N/A (no tracked file changes).

No other deviations — plan executed exactly as written otherwise.

## Known Stubs

None.

## Threat Flags

None — this plan's threat model (T-quicksxa-01/02/03, all `accept`/`mitigate` dispositions logged in the PLAN.md's own threat register) fully covers the new surface introduced. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries were introduced beyond what the plan already modeled.

## Self-Check: PASSED

Files verified to exist:
- FOUND: `web/src/lib/passkeys/login.ts`
- FOUND: `web/src/lib/passkeys/login.test.ts`
- FOUND: `web/src/lib/i18n/dictionary.ts`
- FOUND: `web/src/components/auth/ExtUnlockBridge.tsx`
- FOUND: `web/src/components/auth/ExtUnlockBridge.test.tsx`

Commits verified to exist in `git log`:
- FOUND: `6e44467`
- FOUND: `40ba92d`
