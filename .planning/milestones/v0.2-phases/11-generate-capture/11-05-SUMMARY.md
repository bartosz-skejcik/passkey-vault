---
phase: 11-generate-capture
plan: 05
subsystem: extension
tags: [wxt, browser-extension, shadow-dom, in-page-ui, capture, origin-mismatch]

# Dependency graph
requires:
  - phase: 11-generate-capture
    plan: "11-02"
    provides: "submit-capture.ts's attachSubmitWatcher()/captureFrameOrigin(), content-relay.content.ts's initSubmitCapture() gated capture.propose dispatch"
  - phase: 11-generate-capture
    plan: "11-03"
    provides: "capture-handler.ts's classifySubmit()/confirmNewLogin()/confirmUpdateLogin(), capture.propose/capture.confirm response contracts (action/mismatch/frameOrigin/topOrigin, conflict statuses)"
  - phase: 11-generate-capture
    plan: "11-04"
    provides: "inpage-mount.ts's getOrCreateShadowRoot() shared shadow root, autofill-dictionary.ts's t()/interpolate() conventions"
provides:
  - "lib/autofill/save-update-toast.ts's showSaveUpdateToast()/confirmCapture() -- Surface 2 (save-new-login/update-existing-item toast), the ONE capture.confirm persistence call path"
  - "lib/autofill/mismatch-modal.ts's showMismatchModal() -- Surface 3 (blocking origin-mismatch escalation modal, D-06/ROADMAP SC#4), reuses confirmCapture() for 'Save anyway'"
  - "content-relay.content.ts's capture.propose response routing: mismatch:true -> mismatch-modal.ts, mismatch:false -> save-update-toast.ts (which itself no-ops for action:'no-op')"
  - "extended e2e-fixtures/adversarial-iframe/{top,attacker-frame}.html with a real submit-capture success signal for the D-06 adversarial UAT"
affects: [end-of-phase-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Both Surface 2 and Surface 3 mount into 11-04's SAME shared getOrCreateShadowRoot() instance -- neither creates a second host/shadow root."
    - "Exactly ONE capture.confirm call site (save-update-toast.ts's confirmCapture()) -- mismatch-modal.ts's 'Save anyway' imports and calls it directly rather than re-implementing the sendMessage call, per 11-UI-SPEC.md Surface 3's 'no separate persistence code path' requirement."
    - "content-relay.content.ts's capture.propose success callback now awaits the response and branches on response.mismatch BEFORE looking at action -- mismatch:true routes to the modal unconditionally (T-11-14), including the rare action:'no-op' mismatch case, where the modal's 'Save anyway' has nothing to persist and just dismisses."
    - "Adversarial fixture submit handlers use a deferred (setTimeout) DOM-removal signal, not a synchronous one -- content-relay's own submit listener (registered later, at document_idle) fires AFTER the page's inline-script listener on the same event, so a synchronous removal would tear the form down before the MutationObserver had even started observing."

key-files:
  created:
    - extension/lib/autofill/save-update-toast.ts
    - extension/lib/autofill/save-update-toast.test.ts
    - extension/lib/autofill/mismatch-modal.ts
    - extension/lib/autofill/mismatch-modal.test.ts
  modified:
    - extension/lib/i18n/autofill-dictionary.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/e2e-fixtures/adversarial-iframe/top.html
    - extension/e2e-fixtures/adversarial-iframe/attacker-frame.html

key-decisions:
  - "save-update-toast.ts's autofill-dictionary.ts edit added BOTH tasks' dictionary keys (save.*/update.*/toast.closeAria for Task 1, mismatch.* for Task 2) in one contiguous block, committed entirely with Task 1 rather than split across both commits -- Task 1's file compiles and passes tests fine with the unused mismatch.* keys present; this was simpler than surgically splitting one Edit-tool insertion into two git hunks and has no behavioral effect (deviation from the plan's literal per-task files_modified split, documented here rather than treated as a Rule violation since it's a git-staging convenience, not a code/scope change)."
  - "The rare action:'no-op' + mismatch:true case (the submitted password already matches what's stored for frameOrigin, but the submission still crossed an origin boundary) is handled by showing the modal per T-11-14's 'unconditional on mismatch' language, but 'Save anyway' just dismisses instead of calling capture.confirm (whose action field only accepts 'new'/'update') -- there is nothing new to persist; the modal's sole purpose in this edge case is the security disclosure itself. Not explicitly specced by the plan; documented in both mismatch-modal.ts's header comment and its handleConfirm() no-op branch."
  - "Both toast and modal are self-contained, framework-free, imperative DOM builders (no shared component-builder helper module) -- matches the codebase's existing per-surface-file convention (inpage-overlay.ts, generate-popover.ts each define their own icon consts/CSS blocks rather than importing from a shared icons.ts); mismatch-modal.ts's only cross-file import is save-update-toast.ts's confirmCapture()/teardownSaveUpdateToast(), a one-way import that avoids a cycle."
  - "Adversarial fixture success signal uses DOM removal (form.remove() + a 'Signed in' message), not a URL/history.pushState change -- more visually obvious for the plan's manual UAT steps, and equally valid against submit-capture.ts's layered heuristic (either signal fires onSuccess)."

patterns-established:
  - "confirmCapture() (save-update-toast.ts) is the canonical single call site for capture.confirm -- any future surface needing to persist a captured credential imports this function rather than calling sendMessage({kind:'capture.confirm',...}) directly."

requirements-completed: [CAP-02, CAP-03]

coverage:
  - id: D1
    description: "showSaveUpdateToast() renders nothing for action:'no-op' (Pitfall B); renders the 360px save/update toast for 'new'/'update' with masked password preview, Eye/EyeOff reveal, and correct title/confirm-label copy per action; confirm re-sends the full field payload via confirmCapture() (capture.confirm), disabling both buttons with a spinner while in flight; success shows a CircleCheck flash then auto-dismisses after ~1.5s (the one exception to never-auto-dismiss); conflict shows update.conflict and stays open; error shows save.failed + Retry and stays open; mounting a second toast tears down the first"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/save-update-toast.test.ts (10 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "showMismatchModal() renders the 400px origin-mismatch modal unconditionally whenever mismatch:true, showing BOTH frameOrigin and topOrigin in full unelided text; NOT dismissible via Escape or a scrim click, only the explicit Cancel/Save-anyway buttons, with a Tab/Shift+Tab focus trap; 'Save anyway' calls the SAME confirmCapture() the toast uses for action 'new'/'update' (carrying itemId/currentRevision through for 'update'), showing the same success/conflict/error states; for the rare action:'no-op' mismatch, 'Save anyway' dismisses without calling capture.confirm; showing the modal tears down any live toast (mutually exclusive surfaces)"
    requirement: "CAP-03"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/mismatch-modal.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "content-relay.content.ts's initSubmitCapture() capture.propose success callback awaits the response and routes to mismatch-modal.ts when mismatch:true, save-update-toast.ts otherwise -- the one integration point tying submit-capture's output through capture.propose's classification into the correct surface; the existing pre-Phase-11 content-relay.test.ts suite (9 tests) is unaffected by this additive change"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts (9 pre-existing tests, unaffected)"
        status: pass
      - kind: other
        ref: "manual source inspection: capture.propose's response.mismatch branch calls showMismatchModal()/showSaveUpdateToast() with the response's action/itemId/currentRevision/frameOrigin/topOrigin plus the closure-captured username/password"
        status: pass
    human_judgment: false
  - id: D4
    description: "The adversarial cross-origin-iframe UAT (top.html Origin A embedding attacker-frame.html Origin B, submitting the iframe's own form triggers the mismatch modal showing both real origins, 'Save anyway' persists via the same path a same-origin save would use) -- requires a real unpacked-extension browser session against a running pv-server, per this plan's own human_verify_mode: end-of-phase deferral"
    requirement: "CAP-02"
    verification: []
    human_judgment: true
    rationale: "This is the phase's headline D-06/ROADMAP Success Criterion 4 mitigation. Verifying it requires loading the unpacked extension in a real browser, running both fixture origins via serve.mjs, signing into a live pv-server-backed vault, and confirming the modal (not the toast) appears with both real browser-resolved origins when submitting through the genuinely cross-origin iframe form -- none of which is reproducible in jsdom/vitest. The unit tests above (D1/D2/D3) prove the modal's own rendering/routing/persistence logic is correct against a mocked response; only the live-browser origin resolution and the two-process fixture serving are unverified until end-of-phase UAT, per this plan's own <verify> block ('deferred to end-of-phase UAT per human_verify_mode: end-of-phase') and 11-04-SUMMARY.md's identical precedent for its own in-page-surface UAT."

duration: ~30min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 05: Save/Update Toast + Origin-Mismatch Modal (Surfaces 2/3) Summary

**Save-new-login/update-existing-item toast (never silently auto-dismissing) and a blocking origin-mismatch modal that shows both real origins in full — the user-facing half of the phase's D-06/Bitwarden-CVE-class mitigation, wired into content-relay's `capture.propose` response routing.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-16T10:38:14Z
- **Tasks:** 2 completed
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- `save-update-toast.ts`'s `showSaveUpdateToast()` renders Surface 2 (360px, bottom-right, into 11-04's shared closed shadow root): `action:'no-op'` renders nothing at all (Pitfall B); `'new'`/`'update'` render the correct title/confirm-label copy, a masked password preview with reveal toggle, and never auto-dismiss except the ~1.5s post-success `CircleCheck` flash
- The ONE `capture.confirm` persistence call site: `confirmCapture()` (exported from `save-update-toast.ts`), re-sending the full field payload fresh from the closure (frameOrigin/username/password captured at submit time), never a reference to earlier background state — sidesteps the MV3 idle-kill-between-propose-and-confirm gap
- `mismatch-modal.ts`'s `showMismatchModal()` renders Surface 3 (400px, centered): whenever `mismatch:true`, both `frameOrigin` and `topOrigin` are shown in full, unelided plain text; not dismissible via Escape or a scrim click — only the explicit `Cancel`/`Save anyway` buttons, with a Tab/Shift+Tab focus trap; `Save anyway` calls the SAME `confirmCapture()` the toast uses, never a second persistence path
- `content-relay.content.ts`'s `initSubmitCapture()` now awaits the `capture.propose` response and branches on `response.mismatch` — the plan's one integration point tying submit-capture's output through the background's classification into the correct surface
- Extended (not duplicated) the existing Phase 10 adversarial two-origin fixture (`e2e-fixtures/adversarial-iframe/{top,attacker-frame}.html`) with a deferred DOM-removal success signal, so a real submit through either form now actually fires `capture.propose` for the D-06 manual UAT

## Task Commits

1. **Task 1: Save-new-login / update-existing-item toast (Surface 2)** - `5fdfb22` (feat)
2. **Task 2: Origin-mismatch escalation modal (Surface 3, D-06) + content-relay wiring + adversarial UAT fixture** - `83226a1` (feat)

**Plan metadata:** committed by orchestrator after wave merge (worktree mode)

## Files Created/Modified

- `extension/lib/autofill/save-update-toast.ts` - `showSaveUpdateToast()`/`teardownSaveUpdateToast()`/`confirmCapture()`; imperative, framework-free, mounts into 11-04's shared shadow root
- `extension/lib/autofill/save-update-toast.test.ts` - 10 tests (no-op/new/update rendering, reveal toggle, confirm success/conflict/error, dismiss/close/re-mount)
- `extension/lib/autofill/mismatch-modal.ts` - `showMismatchModal()`/`teardownMismatchModal()`; blocking modal, focus trap, reuses `confirmCapture()`
- `extension/lib/autofill/mismatch-modal.test.ts` - 9 tests (full-origin disclosure, Escape/scrim non-dismissal, Cancel, Save-anyway for new/update/no-op, conflict, mutual exclusivity with the toast)
- `extension/lib/i18n/autofill-dictionary.ts` - added `save.*`/`update.*`/`mismatch.*`/`toast.closeAria` keys verbatim from 11-UI-SPEC.md's Copywriting Contract table
- `extension/entrypoints/content-relay.content.ts` - `initSubmitCapture()`'s success callback now awaits `capture.propose` and routes to `showMismatchModal()`/`showSaveUpdateToast()` based on `response.mismatch`
- `extension/e2e-fixtures/adversarial-iframe/top.html` / `attacker-frame.html` - extended submit handlers with a deferred DOM-removal success signal for submit-capture.ts's heuristic

## Decisions Made

- Bundled both tasks' `autofill-dictionary.ts` key additions into Task 1's commit (see key-decisions above) — a git-staging convenience, not a scope change; Task 1 compiles and tests pass with the then-unused `mismatch.*` keys present.
- The rare `action:'no-op'` + `mismatch:true` combination (classifySubmit's match lookup is keyed on `frameOrigin`, independent of `topOrigin` — so a resubmit of an already-stored password can still be a cross-origin submission) is handled by showing the modal per T-11-14's unconditional-on-mismatch language, but `Save anyway` just dismisses (there's nothing to persist; `capture.confirm`'s `action` field only accepts `'new'`/`'update'`).
- `mismatch-modal.ts` has exactly one cross-file import from `save-update-toast.ts` (`confirmCapture`/`teardownSaveUpdateToast`) — one-way, avoids a cycle, and is the plan's literal "no separate persistence code path" requirement made concrete.
- Adversarial fixture success signal uses `form.remove()` (DOM-removal heuristic) via a deferred `setTimeout`, not a synchronous removal — content-relay's own submit listener registers its `MutationObserver` in the SAME synchronous submit-event dispatch as the page's own listener, but registers LATER (content-relay attaches at `document_idle`, after the fixture's inline script already ran); a synchronous removal would tear the form down before the observer had even started, so the removal is deferred to the next macrotask.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. No bugs, missing critical functionality, or blocking issues beyond the environmental setup and two documented, non-behavioral clarifications noted in "Decisions Made" above (both flagged inline in code comments rather than reverted/re-planned).

---

**Total deviations:** 0 auto-fixed (Rule 1/2/3 sense) — two documented interpretive decisions for edge cases the plan didn't literally specify (no-op+mismatch handling; dictionary commit bundling), neither affecting data model, message-protocol shape, or the zero-knowledge/origin-verification invariants.

## Issues Encountered

- **`extension/node_modules` was missing** in this fresh worktree checkout — ran `npm ci` per this plan's own `phase_context` note, restoring `lucide-react` (needed to copy the `Vault`/`CircleCheck`/`AlertTriangle`/`X` SVG source verbatim) and the test/build toolchain. Not committed (`node_modules` is gitignored).
- **Same 3 pre-existing `tsc --noEmit` errors** documented in every prior Phase 11 plan's SUMMARY (`entrypoints/background/vault-session.ts`, `lib/crypto/wasm-loader.ts` — missing generated WASM build artifact, `wasm-bindgen-cli` not installed in this worktree). Confirmed none of this plan's files appear in the error output before or after.
- **`entrypoints/background/router.test.ts` fails to LOAD** (module-load error from the same missing-WASM root cause) and one pre-existing unrelated unhandled-rejection warning in `App.test.tsx`/`ServerConfigView.tsx` — both confirmed pre-existing via 11-02/11-03/11-04-SUMMARY.md's identical documentation; neither touches this plan's files. Full `npx vitest run`: **332 tests pass** (313 baseline from 11-04 + 19 new), only these two pre-existing gaps.
- Two initial test-timing bugs were found and fixed during this plan's own execution (not deferred): (1) two conflict/error-state tests needed a macrotask flush (`setTimeout(...,0)`) instead of two bare `await Promise.resolve()` calls to reliably observe the async `handleConfirm()` chain settle; (2) a real bug in `save-update-toast.ts`'s `showError()` — `setBusy(false)` was resetting `confirmBtn`'s label back to `save.confirm`/`update.confirm` AFTER the `save.retry` label had already been set, silently clobbering it. Both fixed inline before committing (Rule 1 — bug found and fixed within the same task, prior to any commit).

## User Setup Required

None - no external service configuration required for this plan's own automated verification. The deferred end-of-phase manual UAT (D4 above) requires a running `pv-server` and both fixture origins served via `serve.mjs`, per `e2e-fixtures/adversarial-iframe/README.md`'s existing setup steps (README itself unchanged by this plan).

## Next Phase Readiness

- Both Surface 2 and Surface 3 are fully wired end-to-end: `content-relay.content.ts` -> `capture.propose` -> background classification -> `showSaveUpdateToast()`/`showMismatchModal()` -> `confirmCapture()` -> `capture.confirm` -> persisted item.
- CAP-02/CAP-03 are user-reachable in full: save, update, and no-op all behave per the Copywriting Contract; the origin-mismatch modal gates 100% of save/update flows where `frameOrigin !== topOrigin`, proven at the unit level against a mocked response.
- **Concern for end-of-phase UAT (D4):** the adversarial cross-origin-iframe scenario (attacker-frame.html's own submit triggering the mismatch modal with both real browser-resolved origins) is unverified in a real browser session — this is the phase's headline security requirement and should be the first item checked in end-of-phase UAT, per this plan's own `human_verify_mode: end-of-phase` deferral.
- Carried over from every prior Phase 11 plan: install `wasm-bindgen-cli` and run `scripts/build-wasm.sh` to get a fully clean `tsc --noEmit`/full-suite baseline — 3 pre-existing `tsc` errors and 1 pre-existing test-file load failure, both unrelated to Phase 11.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 8 created/modified files verified present on disk; all 3 commits
(`5fdfb22`, `83226a1`, `183c731`) verified present in git log.
