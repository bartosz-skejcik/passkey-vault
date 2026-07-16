---
phase: 11-generate-capture
plan: 04
subsystem: extension
tags: [wxt, browser-extension, shadow-dom, in-page-ui, csprng-generator]

# Dependency graph
requires:
  - phase: 11-generate-capture
    plan: 01
    provides: "ext-protocol.ts's generate-request discriminated-union member/MessageResponseMap entry, extension/lib/generator/{password,strength}.ts (scorePasswordMeter), the background's handleGenerateRequest dispatcher"
  - phase: 11-generate-capture
    plan: 02
    provides: "form-detector.ts's classifyForm()/findPasswordFieldPair() signup classifier, content-relay.content.ts's existing handleFocusIn/handleFocusOut pair"
  - phase: 10-autofill
    provides: "lib/autofill/inpage-overlay.ts's imperative attachShadow({mode:'closed'})+inlined-CSS mount pattern (extracted, not modified), fill-dom.ts's setNativeValue(), blocked-origins.ts's isOriginBlocked(), content-relay.content.ts's isConfiguredServerOrigin() suppression gate"
provides:
  - "extension/lib/autofill/inpage-mount.ts's getOrCreateShadowRoot()/getMountHost() -- the shared, lazy, tab/frame-scoped closed shadow-root mount every Phase 11 in-page surface (this plan's generate-popover.ts; Plan 11-05's save/update toast + mismatch modal) reuses unmodified"
  - "extension/lib/autofill/generate-popover.ts's mountGenerateTrigger()/teardownGenerateTrigger()/getGenerateTriggerHost() -- Surface 1's click-triggered RefreshCw trigger + 320px suggestion popover, wired end-to-end to generate-request"
  - "content-relay.content.ts's handleFocusIn/handleFocusOut coordination: a signup-classified password field mounts the generate trigger instead of the Phase 10 'PV' autofill icon, no icon collision, no second parallel focus listener"
affects: [11-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every Phase 11 in-page UI surface mounts into inpage-mount.ts's SAME shared closed shadow root via getOrCreateShadowRoot() -- never a second host per tab/frame; individual surfaces append their own scoped <style> block into that shared root, same convention inpage-overlay.ts already used for its own separate host"
    - "Generation always round-trips through sendMessage({kind:'generate-request',...}) -- generate-popover.ts never imports generateCharacterPassword/generatePassphrase directly, even though scorePasswordMeter (a pure heuristic over the returned string, not a generator) IS imported and called locally"
    - "A single focusin/focusout listener pair on content-relay.content.ts now branches on classifyForm() BEFORE the existing collectFocusableFields() kind lookup -- a signup password field is handled entirely by the new branch (mount generate trigger, return early) so the Phase 10 'PV' icon never gets a chance to mount for the same field"

key-files:
  created:
    - extension/lib/autofill/inpage-mount.ts
    - extension/lib/autofill/inpage-mount.test.ts
    - extension/lib/autofill/generate-popover.ts
    - extension/lib/autofill/generate-popover.test.ts
  modified:
    - extension/lib/i18n/autofill-dictionary.ts
    - extension/entrypoints/content-relay.content.ts

key-decisions:
  - "inpage-mount.ts is a plain extraction of inpage-overlay.ts's own attachShadow({mode:'closed'})+inlined-<style> pattern, NOT WXT's createShadowRootUi -- confirmed via the plan's own X-1/REPAIR note and by grep across extension/ (no createShadowRootUi, cssInjectionMode, or React path exists anywhere in this codebase)."
  - "No @font-face rule or web-accessible-resource font of any kind in either inpage-mount.ts's shared base stylesheet or generate-popover.ts's own GENERATE_CSS block -- font-family falls back to system-ui, matching inpage-overlay.ts's existing OVERLAY_CSS convention exactly (T-11-12; supersedes 11-UI-SPEC.md's self-hosted-@font-face row per orchestrator decision 2026-07-16)."
  - "Added inpage-mount.test.ts and generate-popover.test.ts (not in the plan's own files_modified list, and this plan's tasks are not tdd=\"true\") to match this codebase's own 100%-of-siblings test convention in lib/autofill/ -- every other module there (form-detector.ts, submit-capture.ts, inpage-overlay.ts, fill-dom.ts, etc.) has a co-located *.test.ts file; the plan's <verify> block only required tsc --noEmit + a font-URL grep, but leaving these two new modules with zero test coverage would have been the only untested pair in the directory."
  - "generate-popover.ts reuses fill-dom.ts's setNativeValue() (framework-safe value write + input/change event dispatch) for the apply action rather than reimplementing the React-controlled-input bypass -- same rationale fill-dom.ts's own header comment documents (10-RESEARCH.md Pitfall 5)."

patterns-established:
  - "getOrCreateShadowRoot()/getMountHost() (inpage-mount.ts) is the canonical mount accessor for every future Phase 11 in-page surface -- Plan 11-05's toast/modal call the SAME function, never attachShadow() a second time."

requirements-completed: [CAP-01]

coverage:
  - id: D1
    description: "getOrCreateShadowRoot() mounts a single closed-mode shadow-root host per tab/frame, lazily on first call, and returns the SAME instance on every subsequent call -- the injected stylesheet contains no @font-face rule or third-party font URL"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/inpage-mount.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "mountGenerateTrigger() renders a 40px trigger anchored to a signup password field; clicking it opens a 320px popover, issues a generate-request per mode (character default, switches to passphrase), shows the preview/strength meter, and 'Use this password' fills BOTH the new- and confirm-password fields via setNativeValue() then tears the trigger/popover down; an {error} response shows generate.failed with regenerate still enabled; mounting a second trigger tears down the first"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/generate-popover.test.ts (7 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "content-relay.content.ts's handleFocusIn mounts the generate trigger (not the Phase 10 'PV' icon) for a classifyForm()==='signup' password field, gated behind isConfiguredServerOrigin()/isOriginBlocked() (X-4); handleFocusOut tears the generate trigger down in the SAME handler that tears down the Phase 10 icon (no second parallel focus/teardown path)"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts (9 pre-existing tests, unaffected by this plan's additive wiring)"
        status: pass
    human_judgment: true
    rationale: "The signup-branch wiring itself has no dedicated unit test in content-relay.test.ts (the plan's own <verification> block scopes automated checks to tsc --noEmit + a human-check UAT item); its sub-behaviors are proven at the unit level individually (form-detector.test.ts's classifyForm/findPasswordFieldPair, generate-popover.test.ts's mount/apply/teardown), but the live-DOM icon-collision-avoidance and trigger-vs-native-suggestion-popover timing (Pitfall C) genuinely need a human/browser check -- deferred to end-of-phase UAT per the project's human_verify_mode config, matching this plan's own <done> criterion."

duration: 18min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 04: Generate-Password Popover (Surface 1) Summary

**A shared, lazy, closed-Shadow-DOM mount extracted from `inpage-overlay.ts`'s own pattern, plus a click-triggered `RefreshCw` password-suggestion popover wired exclusively through the background's `generate-request` handler and `form-detector.ts`'s signup classifier — the user-facing half of CAP-01.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-07-16T10:05:00Z (approx.)
- **Completed:** 2026-07-16T10:23:30Z
- **Tasks:** 2 completed
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- `inpage-mount.ts`'s `getOrCreateShadowRoot()` mounts a single closed-mode shadow-root host per tab/frame, lazily on first call, reused unmodified by every Phase 11 in-page surface — extracted from `inpage-overlay.ts`'s own `attachShadow({mode:'closed'})`+inlined-`<style>` pattern, not WXT's `createShadowRootUi` (X-1/REPAIR confirmed against the real codebase)
- `generate-popover.ts`'s `mountGenerateTrigger()` renders a 40px click-triggered `RefreshCw` trigger anchored to any `form-detector.ts`-classified `signup` password field, opening a 320px popover (title, Characters/Passphrase segmented toggle, `ui-monospace` preview with `Eye`/`EyeOff` reveal, length range, character-set checkboxes, strength meter, regenerate, coral "Use this password" apply) — every generated value comes exclusively from `sendMessage({kind:'generate-request',...})`, never a local generator call
- Applying fills **both** the new-password and confirm-password fields (when `findPasswordFieldPair()` resolved a real pair) via `fill-dom.ts`'s framework-safe `setNativeValue()`, then closes the popover
- `content-relay.content.ts`'s existing `handleFocusIn`/`handleFocusOut` pair now coordinates the two field-corner affordances: a signup password field mounts the generate trigger instead of the Phase 10 "PV" autofill icon (no stacking/collision), gated behind the same `isConfiguredServerOrigin()`/`isOriginBlocked()` sequence (X-4) as every other in-page surface in this codebase
- No `@font-face` rule or web-accessible-resource font anywhere in either new module's injected stylesheet (T-11-12) — `font-family` falls back to `system-ui`, matching `inpage-overlay.ts`'s existing `OVERLAY_CSS` convention exactly

## Task Commits

Each task was committed atomically:

1. **Task 1: Shadow-root mount lifecycle, no font-fetch surface** - `f878a0a` (feat)
2. **Task 2: Generate-password popover (Surface 1) wired to generate-request + field pairing** - `dd417cd` (feat)

**Plan metadata:** committed by orchestrator after wave merge (worktree mode)

## Files Created/Modified

- `extension/lib/autofill/inpage-mount.ts` - `getOrCreateShadowRoot()`/`getMountHost()`, the shared lazy closed-shadow-root mount extracted from `inpage-overlay.ts`'s own pattern
- `extension/lib/autofill/inpage-mount.test.ts` - 4 tests (mount lifecycle, singleton reuse, lazy mount, no-font-URL stylesheet check)
- `extension/lib/autofill/generate-popover.ts` - `mountGenerateTrigger()`/`teardownGenerateTrigger()`/`getGenerateTriggerHost()`, Surface 1's trigger + popover, sole generation path is `sendMessage({kind:'generate-request'})`
- `extension/lib/autofill/generate-popover.test.ts` - 7 tests (mount/trigger-click/mode-switch/apply-fills-both-fields/error-state/teardown/single-instance-at-a-time)
- `extension/lib/i18n/autofill-dictionary.ts` - added `generate.*` copy (verbatim PL/EN from 11-UI-SPEC.md's Copywriting Contract table) plus `aria.showPassword`/`aria.hidePassword`, re-scoped into this file's own `AUTOFILL_DICTIONARY`/`t()` accessor
- `extension/entrypoints/content-relay.content.ts` - `handleFocusIn` branches on `classifyForm()==='signup'` before the existing kind lookup (mounts the generate trigger, returns early, suppressing the Phase 10 icon); `handleFocusOut` tears the generate trigger down in the same handler that tears down the Phase 10 icon

## Decisions Made

- `inpage-mount.ts` is a plain, imperative extraction of `inpage-overlay.ts`'s own mount pattern — confirmed via the plan's X-1/REPAIR note and by grep (no `createShadowRootUi`/`cssInjectionMode`/React path exists anywhere under `extension/`).
- Added `inpage-mount.test.ts` and `generate-popover.test.ts` even though neither was in the plan's `files_modified` list and neither task carries `tdd="true"` — every other module in `lib/autofill/` has a co-located test file, and the plan's own `<verify>` block (tsc + a font-URL grep) would have left these two new modules as the only untested pair in the directory. Not a plan violation — additive coverage matching an unambiguous, 100%-consistent existing convention.
- Reused `fill-dom.ts`'s `setNativeValue()` for the apply action instead of reimplementing the React-controlled-input value-setter bypass — same rationale that module's own header comment documents (10-RESEARCH.md Pitfall 5), avoiding a second, subtly-different implementation of the same fix.
- `aria.showPassword`/`aria.hidePassword` were added to `AUTOFILL_DICTIONARY` (not just left in `lib/i18n/dictionary.ts`, where they already existed) because `autofill-dictionary.ts`'s own `t()` accessor is scoped to its OWN dictionary object's `keyof` union — a caller inside this file's module (generate-popover.ts) cannot reach `dictionary.ts`'s `DICTIONARY` object through it. Same PL/EN strings, re-scoped rather than re-translated (see X-2 note inline in `autofill-dictionary.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `extension/node_modules` in fresh worktree**
- **Found during:** Task 1, first `npx tsc --noEmit` attempt
- **Issue:** This worktree's `extension/node_modules` was absent (fresh checkout), blocking type-checking, test execution, and access to `lucide-react`'s SVG icon source needed for Task 2's `RefreshCw`/`Eye`/`EyeOff` markup.
- **Fix:** Ran `npm ci` inside `extension/` per this plan's own `phase_context` note ("restore with npm ci").
- **Files modified:** None (dependency install only, not committed — `node_modules` is gitignored).
- **Verification:** `npx tsc --noEmit` and `npx vitest run` both execute.
- **Committed in:** N/A (no source change; environment setup only)

**2. [Minor plan-text correction, no code impact] `aria.showPassword`/`aria.hidePassword` already existed in `lib/i18n/dictionary.ts`**
- **Found during:** Task 2, before editing `autofill-dictionary.ts`
- **Issue:** The plan's own text states these two keys "do not exist in either extension dictionary today" — a grep showed they already exist in `lib/i18n/dictionary.ts` (the POPUP dictionary), added by an earlier phase. The plan's underlying instruction (add them to `autofill-dictionary.ts`) was still correct and necessary, since that file's `t()` accessor is scoped to its own separate dictionary object.
- **Fix:** Added the two keys to `AUTOFILL_DICTIONARY` with the same PL/EN strings as `dictionary.ts`'s existing entries (re-scoped, not re-translated), with an inline comment documenting the correction for a future reader.
- **Files modified:** `extension/lib/i18n/autofill-dictionary.ts`
- **Verification:** `npx tsc --noEmit` — `generate-popover.ts`'s `t(locale, "aria.showPassword"/"aria.hidePassword")` calls type-check against `AUTOFILL_DICTIONARY`'s `keyof` union.
- **Committed in:** `dd417cd` (Task 2 commit)

---

**Total deviations:** 2 (1 Rule 3 - blocking environment setup, 1 minor plan-text correction with no behavioral impact)
**Impact on plan:** No scope creep, no architectural changes. Both fixes were prerequisites for correctly completing Task 2 as specified.

## Issues Encountered

- **`tsc --noEmit` has the same 3 pre-existing, unrelated errors** documented in 11-01-SUMMARY.md/11-02-SUMMARY.md (`entrypoints/background/vault-session.ts`, `lib/crypto/wasm-loader.ts` — missing generated WASM build artifact, `wasm-bindgen-cli` not installed in this worktree). Confirmed none of this plan's files appear in the error output.
- **`entrypoints/background/router.test.ts` fails to load** (module-load error, not a test failure), same root cause as above (`router.ts` imports from `./autofill-match`, which transitively imports the missing WASM module). Confirmed pre-existing via the same reasoning documented in 11-01-SUMMARY.md; this plan's own `<verification>` block does not include `router.test.ts` or the full suite.
- Full `npx vitest run` across the whole extension package: **313 tests pass**, only the one pre-existing `router.test.ts` load failure and one pre-existing unrelated unhandled-rejection warning in `App.test.tsx`/`ServerConfigView.tsx` (neither touches this plan's files) — confirmed by direct inspection of the failure output.
- Neither issue blocks this plan's own success criteria: both plan-specified verification commands (`tsc --noEmit` showing zero NEW errors; the font-URL grep) pass cleanly, and both new modules' own test suites (11 tests total) pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `inpage-mount.ts`'s `getOrCreateShadowRoot()`/`getMountHost()` are ready for Plan 11-05's save/update toast and origin-mismatch modal to mount into the SAME shared shadow root — no second `attachShadow()` call needed.
- `generate-popover.ts`'s trigger/popover pattern (module-scope singleton, teardown-before-remount, reposition-on-scroll/resize) is a directly reusable template for Plan 11-05's own toast/modal lifecycle if useful, though those surfaces have their own distinct mount/dismiss semantics (persistent toast vs. this plan's ephemeral click-triggered popover).
- Manual UAT (trigger/popover/apply flow on a fixture signup page, icon-collision check against the Phase 10 "PV" icon, no-trigger-on-configured/blocked-origin check, and the native-suggestion-popover timing check per Pitfall C) is deferred to end-of-phase UAT per this plan's own `<done>` criterion and the project's `human_verify_mode: end-of-phase` config — not performed in this execution.
- Concern carried over from 11-01/11-02: install `wasm-bindgen-cli` and run `scripts/build-wasm.sh` (or accept the pre-existing gap) to get a fully clean `tsc --noEmit`/full-suite baseline — currently 3 pre-existing `tsc` errors and 1 pre-existing test-file load failure, both unrelated to Phase 11.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*
