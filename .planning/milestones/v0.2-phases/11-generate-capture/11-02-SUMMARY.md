---
phase: 11-generate-capture
plan: 02
subsystem: extension
tags: [wxt, browser-extension, dom-detection, mutation-observer, jsdom, vitest]

# Dependency graph
requires:
  - phase: 11-generate-capture
    plan: 01
    provides: "ext-protocol.ts's 'capture.propose' discriminated-union member (flat {kind,frameOrigin,username,password} shape) -- consumed as-is, not reshaped"
  - phase: 10-autofill
    provides: "lib/autofill/detect-login.ts's detectLogin() (reused by submit-capture.ts's captureCredentials()), lib/autofill/blocked-origins.ts's isOriginBlocked(), content-relay.content.ts's isConfiguredServerOrigin() suppression gate"
provides:
  - "extension/lib/autofill/form-detector.ts's classifyForm()/findPasswordFieldPair() -- signup vs. login-submit vs. none DOM classifier, works on <form>-less SPA containers"
  - "extension/lib/autofill/submit-capture.ts's attachSubmitWatcher()/captureFrameOrigin() -- layered submit/click trigger + DOM-removal/URL-change success heuristic + error-absence gate, self-reports ONLY its own frame's location.origin"
  - "content-relay.content.ts's initSubmitCapture() wiring -- gated behind isConfiguredServerOrigin()/isOriginBlocked(), sends capture.propose on genuine success"
affects: [11-03, 11-04, 11-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Success-heuristic detection layers THREE independent signals (submit/click trigger, MutationObserver DOM-removal, setInterval URL-change poll) plus an error-absence gate within a bounded give-up window -- never a single naive submit-event listener (Pitfall A's known SPA/AJAX-login failure mode)"
    - "URL-change detection via setInterval poll (not MutationObserver) because MutationObserver cannot observe history.pushState/replaceState -- the two DOM-lib modules split cleanly by which browser API each signal actually requires"
    - "Frame-origin self-report reads ONLY location.origin, never window.top/window.parent -- a content script's own claim about its origin is always independently re-verified server/background-side, never trusted at face value (D-06)"

key-files:
  created:
    - extension/lib/autofill/form-detector.ts
    - extension/lib/autofill/form-detector.test.ts
    - extension/lib/autofill/submit-capture.ts
    - extension/lib/autofill/submit-capture.test.ts
  modified:
    - extension/entrypoints/content-relay.content.ts

key-decisions:
  - "form-detector.ts and submit-capture.ts import zero messaging modules (X-1) -- content-relay.content.ts is the sole caller that wires attachSubmitWatcher's onSuccess to sendMessage({kind:'capture.propose',...}), keeping both DOM libs pure and independently jsdom-fixture-testable with no browser extension runtime required."
  - "content-relay.content.ts's findLoginContainers() falls back to document.body as the 'container' for a <form>-less SPA login (no narrower wrapper element can be reliably inferred) -- attachSubmitWatcher still works correctly against document.body since its internal detectLogin(container) call resolves the same fields as detectLogin(document) would."
  - "URL-change detection uses a 200ms setInterval poll bounded by the same 3000ms give-up window, since MutationObserver has no way to observe history.pushState/replaceState (the mechanism most SPA logins use to redirect after a successful AJAX call) -- this is additive to, not a replacement for, the MutationObserver-based DOM-removal signal."
  - "The error-absence gate does NOT tear down the watcher when an error signal is present at the moment a DOM/URL success signal fires -- it simply declines to fire onSuccess and keeps watching, in case the error clears and a genuine success follows later within the same 3000ms window."

patterns-established:
  - "attachSubmitWatcher(container, onSuccess) is a pure, DOM-only export with no messaging import -- any future capture-adjacent detector should follow the same caller-supplies-the-callback shape rather than importing sendMessage directly into a DOM-lib module."

requirements-completed: [CAP-01, CAP-02, CAP-03]

coverage:
  - id: D1
    description: "classifyForm()/findPasswordFieldPair() correctly distinguish signup (2+ password fields, or one with autocomplete=new-password), login-submit (one password field, no new-password signal), and none (zero password fields) -- including a <form>-less SPA container"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/form-detector.test.ts (7 tests: 5 classifyForm fixtures + 2 findPasswordFieldPair fixtures)"
        status: pass
    human_judgment: false
  - id: D2
    description: "attachSubmitWatcher() fires onSuccess exactly once on a genuine success signal (DOM removal or history.pushState URL change with no error signal present) and never on a false positive (error signal present, or neither signal within the 3000ms window) -- no leaked timer/observer after give-up"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/submit-capture.test.ts (5 tests: 4 attachSubmitWatcher fixtures + 1 captureFrameOrigin fixture, using vi.useFakeTimers())"
        status: pass
    human_judgment: false
  - id: D3
    description: "content-relay.content.ts wires attachSubmitWatcher onto every classifyForm()-positive container, gated behind isConfiguredServerOrigin()/isOriginBlocked() (X-4), and sends sendMessage({kind:'capture.propose', frameOrigin, username, password}) on genuine success -- matching Wave 1's ext-protocol.ts message shape verbatim, no reshaping"
    requirement: "CAP-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts (9 pre-existing tests, unaffected by this plan's additive wiring)"
        status: pass
    human_judgment: true
    rationale: "The submit-capture -> capture.propose dispatch itself has no dedicated unit test in this plan (not in the plan's own <verification> block); its behavior is proven at the unit level for attachSubmitWatcher (D2) and the message shape is proven correct by static/type inspection against ext-protocol.ts, but the end-to-end wiring inside a real browser DOM against a live page is unverified until Plan 11-03's handler exists to receive it."

duration: 6min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 02: Form Classification + Submit-Capture Heuristic Summary

**A signup-vs-login-submit DOM classifier (form-detector.ts) and a layered submit/DOM-removal/URL-change success heuristic with an error-absence gate (submit-capture.ts), wired into content-relay.content.ts's gated `capture.propose` dispatch.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-16T10:03:43Z
- **Completed:** 2026-07-16T10:09:44Z (approx.)
- **Tasks:** 2 completed
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `classifyForm()`/`findPasswordFieldPair()` classify a container (`<form>` or plain `<form>`-less element) as `signup`/`login-submit`/`none` purely from its `input[type=password]` descendants, correctly handling a `<div>`-based SPA login with no `<form>` wrapper at all (Pitfall A)
- `attachSubmitWatcher()` layers a submit/submit-button-click trigger, a `MutationObserver`-based container-removal signal, a `setInterval`-based URL-change poll (needed because `MutationObserver` cannot observe `history.pushState`), and a `[role="alert"]`/`[aria-invalid="true"]` error-absence gate, all bounded by a 3000ms give-up window with guaranteed cleanup (no leaked timer/observer)
- `captureFrameOrigin()` self-reports strictly `location.origin`, verified via `vi.spyOn(window, "top"/"parent")` to never be read (D-06)
- `content-relay.content.ts`'s new `initSubmitCapture()` gates the whole feature behind the exact same `isConfiguredServerOrigin()`/`isOriginBlocked()` sequence the Phase 10 overlay already uses (X-4), and sends `capture.propose` with the flat `{frameOrigin, username, password}` shape Wave 1 already defined in `ext-protocol.ts` — consumed as-is, not reshaped

## Task Commits

Each task was committed atomically via TDD (RED then GREEN):

1. **Task 1: Classify signup vs. login-submit forms (DOM scoring)** - `118efae` (test, RED) → `90f21a1` (feat, GREEN)
2. **Task 2: Submit-capture success heuristic + frame-origin self-report + gated content-relay wiring** - `20ab8c4` (test, RED) → `71dc966` (feat, GREEN)

**Plan metadata:** committed by orchestrator after wave merge (worktree mode)

## Files Created/Modified

- `extension/lib/autofill/form-detector.ts` - `classifyForm()`/`findPasswordFieldPair()`, pure DOM scoring, no `<form>` assumption
- `extension/lib/autofill/form-detector.test.ts` - 7 tests (5 classifyForm fixtures + 2 findPasswordFieldPair fixtures)
- `extension/lib/autofill/submit-capture.ts` - `attachSubmitWatcher()`/`captureFrameOrigin()`, layered success heuristic, no messaging import (X-1)
- `extension/lib/autofill/submit-capture.test.ts` - 5 tests (4 attachSubmitWatcher fixtures + 1 captureFrameOrigin fixture) using `vi.useFakeTimers()`
- `extension/entrypoints/content-relay.content.ts` - added `findLoginContainers()`/`initSubmitCapture()`, wired at `main()`'s document_idle entry alongside the existing `initialMatchAndPrompt()` call

## Decisions Made

- `submit-capture.ts` reuses `detect-login.ts`'s `detectLogin()` (Phase 10 precedent) inside `captureCredentials()` rather than re-scanning the DOM with a second, differently-styled algorithm — per this task's own `read_first` instruction.
- URL-change detection is a `setInterval` poll, not part of the `MutationObserver`, since `MutationObserver` structurally cannot observe `history.pushState`/`replaceState` — the mechanism most SPA logins use to redirect after a successful AJAX call. This is additive to the DOM-removal signal, not a replacement.
- `findLoginContainers()` in `content-relay.content.ts` falls back to `document.body` as the "container" for a `<form>`-less SPA login, since no narrower wrapper element can be reliably inferred from the DOM alone; `attachSubmitWatcher` works correctly against `document.body` because its internal `detectLogin(container)` call resolves the same fields `detectLogin(document)` would.
- The error-absence gate keeps the watcher alive (does not tear down) when an error signal is present at the moment a DOM/URL success signal fires — it declines to call `onSuccess` but keeps watching in case the error clears and a genuine success follows later within the same window, rather than treating "error present once" as a permanent give-up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing `extension/node_modules` in fresh worktree**
- **Found during:** Task 1, first `npx vitest run` attempt
- **Issue:** This worktree's `extension/node_modules` was absent (fresh checkout), blocking all test execution.
- **Fix:** Ran `npm ci` inside `extension/` per this plan's own `phase_context` note ("restore with npm ci").
- **Files modified:** None (dependency install only, not committed — `node_modules` is gitignored).
- **Verification:** `npx vitest run lib/autofill/form-detector` executes (fails RED as expected, then passes GREEN).
- **Committed in:** N/A (no source change; environment setup only)

**2. [Rule 3 - Blocking] `form-detector.test.ts` needed a jsdom environment override**
- **Found during:** Task 1, first GREEN verification run — tests failed with `ReferenceError: document is not defined`
- **Issue:** This project's `vitest.config.ts` "background" project defaults to `environment: "node"`; DOM-heavy autofill tests must opt into jsdom per-file via a `// @vitest-environment jsdom` docblock (documented in `vitest.config.ts`'s own header comment and already the convention in `detect-login.test.ts`). The initial RED test file was missing this docblock.
- **Fix:** Added `// @vitest-environment jsdom` as the first line of `form-detector.test.ts` (the RED-phase commit's content had already been written and committed at that point; the fix was folded into the same GREEN commit rather than amending the RED commit, per the "never amend, always new commit" rule).
- **Files modified:** `extension/lib/autofill/form-detector.test.ts`
- **Verification:** `npx vitest run lib/autofill/form-detector` — all 7 tests pass
- **Committed in:** `90f21a1` (Task 1 GREEN commit)

- `submit-capture.test.ts` was authored WITH the `// @vitest-environment jsdom` docblock from the start (lesson carried over from Task 1), so no equivalent fix was needed for Task 2.

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking test-infrastructure issues, neither touching this plan's own `files_modified` source logic)
**Impact on plan:** Both fixes were prerequisites for running any test at all in this fresh worktree; no scope creep, no architectural changes.

## Issues Encountered

- **`tsc --noEmit` has the same 3 pre-existing, unrelated errors** documented in 11-01-SUMMARY.md (`entrypoints/background/vault-session.ts`, `lib/crypto/wasm-loader.ts` — missing generated WASM build artifact, `wasm-bindgen-cli` not installed in this worktree). Confirmed none of this plan's files appear in the error output; not fixed here (out of scope, Rust/cargo toolchain step, not a code bug).
- No new `tsc` errors introduced by `form-detector.ts`, `submit-capture.ts`, or the `content-relay.content.ts` wiring.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `form-detector.ts`'s `classifyForm()`/`findPasswordFieldPair()` are ready for Plan 11-04's generate-popover trigger logic (signup detection is the entry condition for offering a generated password).
- `submit-capture.ts`'s `attachSubmitWatcher()`/`captureFrameOrigin()` are wired end-to-end through `content-relay.content.ts` to `sendMessage({kind:'capture.propose',...})` — Plan 11-03 needs to register the actual background handler (mismatch computation via the sender's real origin, vault-item matching) for this call to receive a meaningful response instead of an unhandled-message rejection (currently swallowed via `.catch()`).
- Plan 11-05's UI response handling (toast/modal for the capture proposal) has no dependency on this plan beyond the `capture.propose` message already being sent — the response shape (`{action, itemId?, currentRevision?, frameOrigin, topOrigin, mismatch}`) was defined in Wave 1 and is unchanged by this plan.
- Concern for a future plan/session (carried over from 11-01): install `wasm-bindgen-cli` and run `scripts/build-wasm.sh` to get a fully clean `tsc --noEmit` baseline — currently 3 pre-existing errors, unrelated to Phase 11.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 6 created/modified files verified present on disk; all 4 task commits
(`118efae`, `90f21a1`, `20ab8c4`, `71dc966`) verified present in git log.
