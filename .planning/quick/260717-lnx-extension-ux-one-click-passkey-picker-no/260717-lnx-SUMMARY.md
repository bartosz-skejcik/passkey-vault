---
phase: quick-260717-lnx
plan: 1
subsystem: extension-ui
tags: [react, playwright, wxt, webauthn, vitest, css]

requires: []
provides:
  - "One-click multi-match passkey picker in the popup's provider-ceremony consent UI"
  - "NordPass-measured in-page autofill dropdown restyle (352px/60px/52px/32px spec) with a favicon-first icon tile"
  - "Headless Playwright extension e2e harness (headless:true) with a documented, re-verified historical hang risk"
affects: [extension-e2e-harness, phase-12-passkey-provider, phase-10-11-autofill-overlay]

tech-stack:
  added: []
  patterns:
    - "Widened onConfirm(itemId?) callback so a row click both identifies and confirms a ceremony in one gesture (no intermediate React-state round-trip)"
    - "Module-level FAILED_FAVICON_HOSTS Set per bundle (mirrors ItemIconTile.tsx's pattern without cross-bundle imports)"

key-files:
  created: []
  modified:
    - extension/entrypoints/popup/ProviderCeremonyView.tsx
    - extension/entrypoints/popup/ProviderCeremonyView.test.tsx
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/App.test.tsx
    - extension/e2e/dual-browser.spec.ts
    - extension/lib/autofill/inpage-overlay.ts
    - extension/lib/autofill/inpage-overlay.test.ts
    - extension/e2e/fixtures.ts

key-decisions:
  - "Task A additionally touched App.tsx/App.test.tsx (not in Bartek's literal file list) -- required to avoid a stale-closure hazard from the old ceremonySelected React state; documented in the plan's own deviation notes and executed as specified"
  - "Gate 4's Phase 12 e2e run reproduced the documented historical headless-hang finding (13-03-SUMMARY.md) on P12-SC1 -- Task C's headless:true change was NOT reverted, per the plan's explicit instruction to report and let Bartek decide"

requirements-completed: [PROV-02, FILL-01]

coverage:
  - id: D1
    description: "Multi-match get() ceremony: clicking a credential row immediately confirms with that credential, no separate confirm click"
    requirement: "PROV-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ProviderCeremonyView.test.tsx#get, 3 matches: renders exactly 3 credential rows as plain buttons (no radio chooser), no provider-confirm button, clicking a row calls onConfirm with that row's itemId"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Phase 12: provider-ceremony ViewState takeover > clicking a candidate row sends provider.resolveChoice with that itemId (one-click select+confirm), then returns to the list view"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-browser.spec.ts#P12-SC2 (handles both single-match and multi-match paths) -- not independently re-run this pass; Phase 12 e2e group hung on P12-SC1 before reaching SC2 (see Deviations)"
        status: unknown
    human_judgment: true
    rationale: "Gate 4's Phase 12 e2e group did not complete (reproduced the documented headless-hang on P12-SC1, an unrelated create() path); the one-click flow's e2e behavior on P12-SC2 specifically was not exercised live this run and needs a human decision on headed-mode-for-provider-tests before it can be re-verified end-to-end."
  - id: D2
    description: "In-page autofill dropdown restyled to Bartek's NordPass-measured spec (352px container, 60px header, 52px rows, 32px favicon tiles) with favicon-first/glyph-fallback icon tiles"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/inpage-overlay.test.ts#Test 15: the shared stylesheet gives .pv-list a bounded max-height + overflow-y:auto ... (updated to 250px)"
        status: pass
      - kind: unit
        ref: "extension/lib/autofill/inpage-overlay.test.ts#260717-lnx: favicon-first icon tile with glyph fallback > Test 16 / Test 17"
        status: pass
    human_judgment: true
    rationale: "CSS pixel-spec compliance and visual taste (light/dark theme rendering) are not fully provable by jsdom unit assertions alone -- a human visual pass against both vault-light/vault-dark themes is the right final check for a measured design spec."
  - id: D3
    description: "Playwright extension e2e harness runs headless (no visible Chromium window during dev e2e runs)"
    requirement: null
    verification:
      - kind: e2e
        ref: "npx playwright test --project=chromium -g \"P10-SC1\" (headless, unrelated to WebAuthn ceremony) -- passed in 8.7s"
        status: pass
      - kind: e2e
        ref: "npx playwright test --project=chromium -g \"Phase 12\" (headless) -- P12-SC1 hung/timed out at 4.0m on both the initial attempt and its retry"
        status: fail
    human_judgment: true
    rationale: "headless:true is intentionally set per Bartek's explicit instruction even though it reproduces a documented historical hang on the WebAuthn provider-ceremony path -- whether to accept headed-mode-for-provider-tests-only as a follow-up is explicitly a decision for Bartek, not something this executor should resolve unilaterally."

duration: ~45min
completed: 2026-07-17
status: needs-decision
---

# Quick Task 260717-lnx: Extension UX — One-Click Passkey Picker, NordPass Dropdown Restyle, Headless E2E Summary

**One-click multi-match passkey picker, a 352px/60px/52px/32px NordPass-measured in-page dropdown restyle with favicon-first icon tiles, and a headless Playwright harness that reproduces a documented historical WebAuthn-ceremony hang on P12-SC1.**

## Performance

- **Duration:** ~45 min (including WASM rebuild, two WXT builds, and a ~10-minute e2e investigation)
- **Completed:** 2026-07-17
- **Tasks:** 3/3 completed and committed
- **Files modified:** 8

## Accomplishments

- **Task A (one-click passkey picker):** `ProviderCeremonyView`'s multi-match `get()` chooser is now plain, directly-clickable buttons (zero `role="radio"` elements); a single row click both identifies and confirms the ceremony via a widened `onConfirm(itemId?)` callback. `App.tsx`'s dead `ceremonySelected` React state (a stale-closure hazard for a direct row click) was removed. Rows disable while `busy` to prevent a duplicate `provider.resolveChoice` mid-flight.
- **Task B (NordPass-measured dropdown restyle):** `inpage-overlay.ts`'s shared `OVERLAY_CSS` now matches Bartek's live-CDP-measured NordPass spec: 352px panel width, 60px header, 52px/10px-radius rows with a 12px icon-text gap, 8px offset below the anchored field, and a recalculated 250px list `max-height`. Every row's bare 16x16 glyph was replaced with a 32x32/8px-radius icon tile that shows the current page's own same-origin favicon first, falling back to the existing per-kind glyph on error, backed by a module-level `FAILED_FAVICON_HOSTS` cache (mirrors `ItemIconTile.tsx`'s pattern, deliberately not shared/imported across bundles).
- **Task C (headless e2e harness):** `fixtures.ts`'s `launchPersistentContext` now runs `headless: true` (was `false`) per Bartek's explicit request to stop headed Chromium windows from flashing/stealing focus during dev e2e runs.

## Task Commits

Each task was committed atomically:

1. **Task A: One-click passkey picker** - `1cf9b49` (feat)
2. **Task B: NordPass-measured in-page dropdown restyle + favicon icon tile** - `ddc8800` (feat)
3. **Task C: Force headless Playwright harness** - `115e68d` (fix)

_Plan metadata commit is created separately by the orchestrator per this task's constraints (SUMMARY/STATE/ROADMAP are not committed by this executor)._

## Files Created/Modified

- `extension/entrypoints/popup/ProviderCeremonyView.tsx` - multi-match rows are one-click buttons; `onConfirm(itemId?)` widened; CTA button wrapped to render only for create/single-match
- `extension/entrypoints/popup/ProviderCeremonyView.test.tsx` - rewritten multi-match tests (no radio assertions), new busy-disabled-row test
- `extension/entrypoints/popup/App.tsx` - removed dead `ceremonySelected` state; `onConfirm` handler resolves `itemId ?? singleMatch?.itemId`
- `extension/entrypoints/popup/App.test.tsx` - rewrote the "selecting a candidate then confirming" test to a single row click
- `extension/e2e/dual-browser.spec.ts` - `P12-SC2` now waits for either `provider-confirm` OR a candidate row and branches accordingly
- `extension/lib/autofill/inpage-overlay.ts` - NordPass-measured CSS spec + `buildIconTile()` favicon/fallback helper
- `extension/lib/autofill/inpage-overlay.test.ts` - updated max-height/offset assertions, new favicon-first/fallback/cache-persistence tests
- `extension/e2e/fixtures.ts` - `headless: true`, replaced the headed-mode-required comment with a 2026-07-17 re-enable rationale pointing at gate 4 as the re-verification step

## Decisions Made

- **Task A necessarily touched `App.tsx`/`App.test.tsx`** (not in Bartek's literal 3-file spec) — required to avoid the exact stale-closure hazard the plan's own deviation notes called out (React state updates are not synchronous; a literal "call onSelect then onConfirm in one click handler" would read stale state). This was pre-authorized in the plan's `<objective>` deviation notes, not an unplanned deviation by this executor.
- **Did not revert Task C's `headless: true`** after gate 4 reproduced the documented historical hang on P12-SC1. Per the plan's explicit instruction, this is reported as a finding for Bartek's decision, not silently patched around.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing WASM bindings blocked 2 test files and the type-check**

- **Found during:** Gate 1 (full unit suite) — `router.test.ts`/`router-capture.test.ts` failed to load with `Cannot find module './wasm/pv_wasm.js'`; gate 2 then also failed on a `PublicPath` type mismatch for `/wasm/pv_wasm_bg.wasm`.
- **Issue:** `npm install`'s `postinstall` ran `wxt prepare` before any WASM artifacts existed in this fresh worktree checkout — a pre-existing environment gap unrelated to this plan's own changes, exactly the scenario gate 3's own instructions anticipated ("If either fails due to missing WASM bindings, run `bash scripts/build-wasm.sh`").
- **Fix:** Ran `bash scripts/build-wasm.sh` from the repo root (builds both `web/` and `extension/` WASM glue+binary), then re-ran `npx wxt prepare` to regenerate the `PublicPath` type union so it included the new `/wasm/pv_wasm_bg.wasm` public asset.
- **Files modified:** none tracked by this plan (generated artifacts: `extension/lib/crypto/wasm/pv_wasm.js`, `extension/public/wasm/pv_wasm_bg.wasm`, `web/src/lib/crypto/wasm/pv_wasm.js`, `web/public/wasm/pv_wasm_bg.wasm`, `.wxt/types/paths.d.ts` — none committed, pre-existing build prerequisites gitignored/generated outside this plan's file list)
- **Verification:** Gate 1 went from 44/46 test files (503 tests) to 46/46 (533 tests); gate 2 went from a type error to a clean pass.
- **Committed in:** N/A — build artifacts only, not part of any task's file list, correctly left uncommitted.

**2. [Rule 1 - Bug] Two pre-existing reposition tests still asserted the OLD +4px field-dropdown offset**

- **Found during:** Task B's own verify step (`npm --prefix extension test -- lib/autofill/inpage-overlay`).
- **Issue:** `Test 9`/`Test 10` in `inpage-overlay.test.ts` hardcoded `rect.bottom + 4` px expectations that the plan itself made stale by changing the offset to `+8` — these two tests were not in the plan's explicit enumerated new-tests list but are directly invalidated by Task B's own required offset change.
- **Fix:** Updated both assertions to the new `+8` offset value, with a comment noting the plan's own spec change.
- **Files modified:** `extension/lib/autofill/inpage-overlay.test.ts`
- **Verification:** `npm --prefix extension test -- lib/autofill/inpage-overlay` — 20/20 passing.
- **Committed in:** `ddc8800` (Task B commit)

---

**Total deviations:** 2 auto-fixed (1 blocking/environment prerequisite, 1 bug/stale-test-value). No scope creep — both were required for the plan's own stated gates to run at all.

## Issues Encountered

**Gate 4's Phase 12 e2e run reproduced the documented historical headless-hang finding (13-03-SUMMARY.md).**

- Command: `npx playwright test --project=chromium -g "Phase 12"` (from `extension/`, headless per Task C).
- Result: `P12-SC1: on a third-party site, navigator.credentials.create() registers a new ES256 passkey...` timed out at **4.0m** on its initial attempt, then timed out again at **4.0m** on its automatic retry (`playwright.config.ts` sets `retries: 2`). The process was manually terminated after confirming the second timeout to avoid an indefinite third attempt.
- This is the exact `create()` → `provider-confirm` click → WASM ceremony path documented in `13-03-SUMMARY.md`'s original headless-hang finding — **unrelated to Task A's multi-match changes** (P12-SC1 is a single-credential `create()` flow using the unchanged `provider-confirm` button, never the multi-match row-click path Task A modified).
- To rule out a general headless-mode regression from Task C (rather than a WebAuthn-specific one), gate 4's second command was run: `npx playwright test --project=chromium -g "P10-SC1"` — **passed cleanly in 8.7s** under the same headless mode, confirming the hang is specific to the provider-ceremony WASM/service-worker execution path, not a blanket headless regression across the extension.
- **Per the plan's explicit instruction, Task C's `headless: true` change was NOT reverted.** This is reported here as a finding requiring Bartek's decision on whether to accept a headed-mode carve-out for provider-ceremony tests specifically, as a follow-up.
- Because the Phase 12 e2e group did not complete, `P12-SC2` (which exercises Task A's one-click multi-match flow end-to-end) was **not** independently re-verified live this run — Task A's one-click behavior is fully covered by passing unit tests (`ProviderCeremonyView.test.tsx`, `App.test.tsx`'s Phase 12 describe block), but the live e2e path for it remains unverified pending a decision on the headless/headed question above.

## Gate Results (actual, captured output)

1. **Full unit suite** (`npm --prefix extension test`): **PASS** — **533/533 tests passing** across 46 test files (baseline was 530; net +3, consistent with Task A's rewritten multi-match tests and Task B's 2 new favicon tests). A single pre-existing unhandled-rejection warning (`ServerConfigView.tsx:111` cross-test leak surfacing during `App.test.tsx`) is unrelated to this plan's changes and was present before these changes too — out of scope per the deviation rules' scope boundary.
2. **Type-check** (`npm --prefix extension run compile`): **PASS** — clean, no errors (after the WASM-bindings/wxt-prepare fix above).
3. **Extension builds** (`npx wxt build -b chrome` / `-b firefox`): **PASS** — both built cleanly (Chrome 1.89MB total, Firefox 1.89MB total, including the WASM binary).
4. **Scoped e2e re-run** (from `extension/`, headless):
   - `-g "Phase 12"`: **FAIL/HANG** — `P12-SC1` timed out at 4.0m x2 (attempt + retry). Reproduction of the documented 13-03-SUMMARY.md historical headless-hang risk. See "Issues Encountered" above.
   - `-g "P10-SC1"`: **PASS** — 1/1 passing in 8.7s, confirming the hang is WebAuthn-ceremony-specific, not a general headless regression.

## User Setup Required

None - no external service configuration required.

## Incidental Environment Artifact (not committed)

`extension/package-lock.json` has a small, unrelated drift (`@playwright/test` version range normalized from `^1.61.1` to `1.61.1`) from running `npm install` in this fresh worktree (its `node_modules` did not exist prior to this run). This is not part of any task's file list and was deliberately left uncommitted — flagging it here rather than silently including it in an unrelated commit or discarding it.

## Next Phase Readiness

- Tasks A and B are fully unit-tested and ready; Task A's live e2e re-verification (`P12-SC2`) is pending the headless/headed decision below.
- **Blocker for Bartek's decision:** whether to accept headed-mode specifically for the Phase 12 provider-ceremony e2e tests (leaving `headless: true` for everything else per this task's intent), or another mitigation, given the reproduced hang on `P12-SC1`. `13-03-SUMMARY.md` has the original investigation; this run reconfirms it verbatim on the same test.

---
*Quick task: 260717-lnx*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 8 modified source files and both plan/summary docs confirmed present on disk; all 3 task commit hashes (`1cf9b49`, `ddc8800`, `115e68d`) confirmed present in `git log`.
