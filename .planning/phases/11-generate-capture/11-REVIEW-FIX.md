---
phase: 11-generate-capture
fixed_at: 2026-07-16T13:07:00Z
review_path: .planning/phases/11-generate-capture/11-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-07-16T13:07:00Z
**Source review:** .planning/phases/11-generate-capture/11-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05 — Info findings IN-01..IN-03 were out of scope this pass)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: Origin-mismatch (D-06) decided from self-reported `payload.frameOrigin`, not the sender-supplied origin

**Files modified:** `extension/entrypoints/background/router.ts`, `extension/entrypoints/background/capture-handler.test.ts`, `extension/entrypoints/background/router-capture.test.ts`
**Commit:** `a9ce0ed`
**Applied fix:** `handleCaptureProposeMessage` now feeds `guard.origin` (the `assertContentSender`-derived, browser-verified frame origin) into `classifySubmit`, never `message.frameOrigin`. The self-reported payload field is discarded by construction at the point the trust decision is made. Pinned by `router-capture.test.ts`'s "CR-01: uses the TRUSTED sender-derived origin for classifySubmit" test, which sends a deliberately lying `payload.frameOrigin` and asserts the trusted value is what reaches `classifySubmit`.

### WR-01: `capture.confirm` persisted `urls:[message.frameOrigin]` and never re-derived origin at confirm time

**Files modified:** `extension/entrypoints/background/router.ts` (same commit as CR-01 — shared root cause)
**Commit:** `a9ce0ed`
**Applied fix:** `handleCaptureConfirmMessage` now builds `fields.frameOrigin = guard.origin` (the same sender-derived, browser-verified value CR-01 uses at propose time) instead of `message.frameOrigin`, so both `confirmNewLogin`'s and `confirmUpdateLogin`'s persisted `urls` are always the TRUSTED origin — satisfying `buildLoginFields`'s own doc-comment invariant. Revision handling was already correctly re-validated (409 → `RevisionConflictError`); origin re-derivation now matches. Pinned by `router-capture.test.ts`'s "CR-01/WR-01: persists a NEW/UPDATE login using the TRUSTED sender-derived frameOrigin" tests.

### WR-02: Mismatch-modal focus trap ineffective inside the closed shadow root

**Files modified:** `extension/lib/autofill/mismatch-modal.ts`, `extension/lib/autofill/mismatch-modal.test.ts`
**Commit:** `dc2370c`
**Applied fix:** The Tab/Shift+Tab trap now reads `shadow.activeElement` (the `ShadowRoot` reference the module itself holds via `getOrCreateShadowRoot()`) instead of `doc.activeElement`, which always resolves to the shadow host per the DOM spec's closed-shadow-root retargeting and was therefore never equal to the tracked first/last button. Also pins focus to the panel itself (`tabIndex=-1`, programmatically focusable) when every button is disabled (busy spinner / post-success state), so Tab has somewhere to land instead of escaping the modal entirely. Contrary to the review's caveat that this is "jsdom-invisible," this project's jsdom (v25.0.1) *does* correctly model shadow-root retargeting — verified empirically, then confirmed by temporarily reverting the fix and observing the new regression tests fail (`shadow.activeElement` assertions mismatched exactly as the bug would predict).

### WR-03: `capture.propose` classified against `getItems()` without ensuring the vault cache was hydrated

**Files modified:** `extension/entrypoints/background/router.ts` (same commit as CR-01/WR-01/WR-04 — shared root cause), `extension/entrypoints/background/router-capture.test.ts`
**Commit:** `a9ce0ed`
**Applied fix:** `handleCaptureProposeMessage` now `await ensureHydrated()`s before calling `getItems()`/`classifySubmit`, mirroring `handleMatchFrame`'s/`handleFillFrame`'s own ensureHydrated()-before-getItems() discipline in `autofill-frame.ts`. On a locked/null result it fails closed to `{ action: "no-op", ..., mismatch: true }` rather than classifying against a possibly-empty cache. Pinned by `router-capture.test.ts`'s "WR-03: gates on ensureHydrated() before classifying" test.

### WR-04: `confirmUpdateLogin` trusted the payload `itemId` with no origin/ownership re-check

**Files modified:** `extension/entrypoints/background/capture-handler.ts`, `extension/entrypoints/background/router.ts`, `extension/entrypoints/background/capture-handler.test.ts`, `extension/entrypoints/background/router-capture.test.ts`
**Commit:** `a9ce0ed`
**Applied fix:** Added `OwnershipMismatchError` to `capture-handler.ts`. `confirmUpdateLogin` now re-fetches the target item from `getItems()` and refuses (throwing `OwnershipMismatchError`) unless it is a `login`-type item that both `itemMatchesOrigin`s the trusted `fields.frameOrigin` and username-matches — mirroring `handleAutofillFill`'s own re-verification (T-10-14). `router.ts`'s `handleCaptureConfirmMessage` maps this new error to `{ status: "error", message }`. Pinned by 5 new `capture-handler.test.ts` tests (missing item, wrong origin, wrong username, non-login item, and the still-passing legitimate-match case) and `router-capture.test.ts`'s "WR-04: maps an OwnershipMismatchError... to {status:'error'}" test.

### WR-05: Unguarded element removal threw an uncaught NotFoundError during focus-churn teardown (packaged-build UAT)

**Files modified:** `extension/lib/autofill/generate-popover.ts`, `extension/lib/autofill/generate-popover.test.ts`, `extension/lib/autofill/inpage-overlay.ts`, `extension/lib/autofill/inpage-overlay.test.ts`
**Commit:** `434844d`
**Applied fix:** Added a `safeRemove()` helper (try/catch around `Element#remove()`) to both `generate-popover.ts` and its sibling `inpage-overlay.ts` (the Phase 10 field-icon/dropdown teardown, which content-relay.content.ts's `handleFocusOut` runs from the SAME handler as the Phase 11 generate-trigger teardown — confirmed as the "sibling focusout teardown with the same pattern"). Applied at every teardown removal site: `teardownGenerateTrigger`/`closePopover` (trigger, popover) and `clearPromptPanel`/`clearDropdown`/`destroy` (prompt panel, dropdown panel, field icon, overlay host). Added regression tests in both files that monkey-patch `.remove()` to throw the exact Chrome `NotFoundError` the UAT observed and assert teardown no longer throws; confirmed both new tests fail against the pre-fix bare `.remove()` calls by temporarily reverting the fix and re-running.

## Skipped Issues

None — all 6 in-scope findings were fixed.

## Verification

Run inside an isolated git worktree (`gsd-reviewfix/11-*`), with `node_modules`, `lib/crypto/wasm/`, and `public/wasm/` (gitignored build artifacts not tracked by git) symlinked in from the main working tree so the suite/build could run unmodified:

- `npx vitest run` — **362/362 tests passed** (38 test files), up from the 346-test baseline plus 16 new regression tests across `router-capture.test.ts` (new file, 7 tests), `capture-handler.test.ts` (+3), `mismatch-modal.test.ts` (+3), `generate-popover.test.ts` (+1), `inpage-overlay.test.ts` (+1), and 1 test file's existing suite adjusted (not net-new) for the WR-04 ownership check. One pre-existing, unrelated unhandled rejection in `App.test.tsx`/`ServerConfigView.tsx` (present identically in the baseline run before any fixes) — out of this review's scope, not introduced by these changes.
- `npx tsc --noEmit` — **clean**, no errors in any modified or new file.
- `npx wxt build` — **succeeded**, produced a valid `chrome-mv3` packaged build (858.85 kB total, including the fixed `background.js`, `content-relay.js`, and `popup` bundles).

All fixes were regression-tested by temporarily reverting each one and confirming the newly added test(s) fail against the pre-fix code, then restoring the fix and confirming green — not just "test exists," but "test actually catches the bug."

---

_Fixed: 2026-07-16T13:07:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
