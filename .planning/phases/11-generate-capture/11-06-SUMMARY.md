---
phase: 11-generate-capture
plan: 06
subsystem: extension
tags: [webextension, autofill, react, vitest]

# Dependency graph
requires:
  - phase: 10-phase10-popup-autofill
    provides: handleAutofillMatch/handleMatchFrame popup+overlay autofill channels, OnThisPageSection popup component
provides:
  - "Popup 'Na tej stronie' section suggests origin-matching LOGIN items even when the page has no detected login form (D-11)"
  - "Test coverage pinning the four gating rules (login relaxed, card/identity/totp unchanged, overlay channel unchanged, unreachable stays empty)"
affects: [12-passkey-provider, popup-autofill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Channel-local gate relaxation: a security-relevant gate (detected[kind]) is relaxed in exactly one channel's handler (handleAutofillMatch) while the sibling channel (handleMatchFrame) keeps its own independent gate read from the caller's own payload — no shared code path to accidentally widen."

key-files:
  created: []
  modified:
    - extension/entrypoints/background/autofill-match.ts
    - extension/entrypoints/background/autofill-match.test.ts
    - extension/entrypoints/popup/autofill/OnThisPageSection.tsx
    - extension/entrypoints/popup/autofill/OnThisPageSection.test.tsx

key-decisions:
  - "Relaxation implemented as a single `kind !== 'login'` guard inline in handleAutofillMatch's match loop, not a new helper function — the smallest change that satisfies D-11 without touching frame-guard.ts's itemMatchesOrigin or autofill-frame.ts's independent handleMatchFrame gate."
  - "Deferred (not fixed): npx tsc --noEmit fails on missing generated WASM bindings (lib/crypto/wasm-loader.ts's './wasm/pv_wasm.js') — a pre-existing, untracked build artifact produced by scripts/build-wasm.sh (wired into predev/prebuild, not typecheck). Confirmed pre-existing and out of scope: errors are confined to wasm-loader.ts/vault-session.ts, files this plan never touches."

patterns-established: []

requirements-completed: []

coverage:
  - id: D1
    description: "Popup 'Na tej stronie' section lists origin-matching LOGIN items on a page with no detected login form (D-11 addendum)"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 8: D-11 popup login relaxation (11-06, Bartek 2026-07-16) > login item, origin matches, detected.login is false (page has no login form) -- still included"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/autofill/OnThisPageSection.test.tsx#Test 7 (D-11, 11-06): a login match renders even when detected is all-false"
        status: pass
    human_judgment: true
    rationale: "Unit tests prove the data path (background relaxation -> component rendering) end to end, but the plan's success_criteria explicitly calls for a packaged-build UAT (open the popup on a logged-in dashboard page of a site with a saved login) to confirm the real extension bundle behaves the same way -- that step was not run in this execution."
  - id: D2
    description: "Card/identity items remain detection-gated in the popup channel; TOTP keeps the unchanged 10-08 issuer+detected policy"
    requirement: null
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 8 > card item is still excluded when detected.card is false"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 8 > identity item is still excluded when detected.identity is false"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 8 > totp item with a matching issuer is still excluded when detected.totp is false"
        status: pass
    human_judgment: false
  - id: D3
    description: "In-page overlay channel (autofill-frame.ts handleMatchFrame) is byte-for-byte unchanged -- login gating there still requires detection"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-match.test.ts#Test 8 > overlay channel (handleMatchFrame, autofill-frame.ts) is UNCHANGED by this plan"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 06: Popup login suggestions on form-less pages Summary

**Relaxed the popup-only `handleAutofillMatch` detection gate for login items to origin-match-only, while leaving card/identity/TOTP gating and the entire in-page overlay channel provably unchanged (7 pinning tests + 1 rendering test).**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-16T09:52:53Z
- **Completed:** 2026-07-16T09:55:28Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Popup's "Na tej stronie" section now suggests origin-matching LOGIN items even on pages with no detected login form (e.g. a dashboard after signing in) — matching NordPass behavior, closing the gap deferred from Phase 10 (recorded in 10-VERIFICATION.md).
- Card, identity, and TOTP items remain detection-gated exactly as before — card/identity are origin-free (would otherwise show on every page), TOTP keeps the 10-08 issuer+detected policy.
- The in-page overlay channel (`autofill-frame.ts`'s `handleMatchFrame`) is structurally untouched — it reads its own `message.detected[kind]` from the caller's own frame and shares no code path with the relaxed loop in `handleAutofillMatch`; pinned by a dedicated test.
- Fixed two stale comments in `OnThisPageSection.tsx` that described a "popup-computed, detection-UNGATED" merge `ItemListView.tsx` never actually performs — now describe the real mechanism (relaxation lives in the background).

## Task Commits

Each task was committed atomically (TDD RED/GREEN split for Task 1):

1. **Task 1 RED: pin D-11 popup login relaxation gate** — `44750e6` (test)
2. **Task 1 GREEN: relax popup login gate to origin-only** — `72320bf` (feat)
3. **Task 2: fix stale OnThisPageSection comments, pin form-less rendering** — `33f109f` (docs — comment fix + test, no component logic change)

_Note: Task 1 used the TDD RED/GREEN split — the login test failed against pre-change code, confirming the fix was necessary and correctly scoped._

## Files Created/Modified
- `extension/entrypoints/background/autofill-match.ts` — `handleAutofillMatch`'s match loop skips the `detected[kind]` gate for `kind === "login"` only; origin match (`itemMatchesOrigin`) still required.
- `extension/entrypoints/background/autofill-match.test.ts` — new "Test 8" describe block: login relaxed+included, card/identity/totp still excluded, unreachable still empty, overlay channel (cross-imported `handleMatchFrame`) still requires detection.
- `extension/entrypoints/popup/autofill/OnThisPageSection.tsx` — header comment and `matches` prop docblock rewritten to describe the real post-11-06 mechanism (background relaxes the gate; this component stays purely presentational).
- `extension/entrypoints/popup/autofill/OnThisPageSection.test.tsx` — new rendering test: a login match renders with `detected` all-false; no component logic changed (confirms no hidden detected-based guard existed).

## Decisions Made
- Implemented the relaxation as a single `kind !== "login"` condition added to the existing `if (!detectResponse.detected[kind])` gate in `handleAutofillMatch`'s loop, rather than extracting a new helper — the smallest, most auditable change; `itemMatchesOrigin` (the origin gate) is untouched.
- Confirmed by code inspection (not just the plan's assumption) that `autofill-frame.ts`'s `handleMatchFrame` reads `message.detected[kind]` from its own request payload (the caller's own frame's detection), never `handleAutofillMatch`'s `detectResponse` — the two channels share only pure helpers (`asFillKind`, `maskedHintFor`, `buildFillValues`, `EMPTY_DETECTED`), none of which contain a gate. This means the overlay channel was structurally safe before any code change; the plan's requested pinning test formalizes that guarantee.
- Cross-imported `handleMatchFrame` into `autofill-match.test.ts` (rather than adding a new test file) to keep the overlay-pinning test co-located with the other three D-11 gating-rule tests, satisfying the plan's `files_modified` list (`autofill-frame.test.ts` was not listed) while still fulfilling the "pin it with a test either way" requirement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Ran `npm ci` to restore missing extension dependencies**
- **Found during:** Task 1 (running the plan's `npx vitest` verification command)
- **Issue:** `extension/node_modules` did not exist in this fresh worktree — `npx vitest` failed at config-load time with `ERR_MODULE_NOT_FOUND` for `vitest`/`@vitejs/plugin-react`.
- **Fix:** Ran `npm ci` (exact restore from the existing `package-lock.json`, not a new/unpinned install) — 530 packages installed, `wxt prepare` ran via postinstall.
- **Files modified:** none tracked (node_modules is gitignored)
- **Verification:** `npx vitest run` subsequently executed successfully.
- **Committed in:** n/a (no file changes to commit — node_modules is gitignored)

---

**Total deviations:** 1 auto-fixed (1 blocking — environment bootstrap)
**Impact on plan:** No scope creep. `npm ci` restores exactly the pinned lockfile state; it is not a package-legitimacy risk (no new package name introduced) and is excluded from the package-manager-install carve-out for that reason.

## Issues Encountered
- **Self-correction (git safety):** During tsc verification I mistakenly ran `git stash push` to isolate a baseline comparison — a prohibited operation in worktree mode per the destructive-git-prohibition rule (the stash ref is shared across sibling worktrees). Caught immediately: popped/applied the exact stash entry I had just created (before any other git operation could interleave), verified `git status`/tests matched the pre-stash GREEN state, then dropped only that entry — the pre-existing sibling worktree's stash entry (`On main: dead-04-01-executor-partial-work`) was left untouched. No data was lost; documenting per the transparency expectation even though the recovery was clean.
- `npx tsc --noEmit` (plan's verification step) fails — but on `lib/crypto/wasm-loader.ts` and `entrypoints/background/vault-session.ts`, neither of which this plan touches. Root cause: `./wasm/pv_wasm.js` is a generated file produced by `scripts/build-wasm.sh` (wired into `npm run dev`/`build`'s `predev`/`prebuild` hooks, not into a bare typecheck), and it does not exist in this fresh worktree checkout (not tracked in git). Confirmed pre-existing and out of scope by checking `git log -- lib/crypto/wasm` (no history — the directory has never existed) and running the full `npx vitest run` suite, which showed 253/253 relevant tests passing with only one unrelated suite failure (`router.test.ts`, same missing-WASM root cause) and one unrelated pre-existing unhandled-rejection warning in `App.test.tsx`/`ServerConfigView.tsx`. This plan's own verification targets (`autofill-match`, `autofill-frame`, `OnThisPageSection`) all pass cleanly under `npx vitest run`.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- D-11 is delivered; the popup surface now matches Bartek's NordPass reference behavior for form-less login pages.
- Recommended before closing out this addendum: a packaged-build UAT pass (load the built extension, open the popup on a logged-in dashboard page of a site with a saved login credential, confirm the row appears and a fill attempt shows the existing fill-failed toast since there's no form to fill into) — this execution only verified the data path via unit/component tests, per the plan's own "Verify... manually in the packaged-build UAT" note in Task 2.
- The `./wasm/pv_wasm.js` missing-artifact issue is environment-only (fresh worktree, no WASM build run yet) and not a code defect — any future work in this worktree that needs a clean `tsc --noEmit` or `router.test.ts` pass will need `bash scripts/build-wasm.sh` run first (requires a Rust/cargo toolchain), out of scope for this plan's two TypeScript-only tasks.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*
