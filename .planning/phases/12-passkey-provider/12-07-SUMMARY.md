---
phase: 12-passkey-provider
plan: 07
subsystem: extension
tags: [webauthn, content-script, overlay-coordination, wxt, vitest]

# Dependency graph
requires:
  - phase: 12-passkey-provider
    provides: "content-relay.content.ts's provider bridge (handleProviderPageMessage, D-03 validation/nonce/ack/base64url encode-decode, respondToPage) from plans 12-03..12-06"
  - phase: 10-autofill
    provides: "the in-page login overlay (OverlayController: renderFormPrompt/renderFieldDropdown/clearFieldDropdown/dismiss/blockSite) content-relay.content.ts already hosts"
provides:
  - "Passkey-priority overlay coordination: a WebAuthn ceremony forwarded through the provider bridge soft-hides the Phase-10 login overlay (Surface A dropdown + Surface B form prompt) for its duration"
  - "Re-offer on fallthrough/error/rejected-promise outcomes; overlay stays suppressed only on a completed credential response"
  - "A module-level passkeyCeremonyInFlight flag + overlayCoordinator{hide,allow} bridge between the module-level provider bridge and the main()-scoped overlay state"
affects: [12-passkey-provider (secure-phase re-audit), 13 (Firefox parity UAT)]

tech-stack:
  added: []
  patterns:
    - "overlayCoordinator{hide,allow} indirection: a module-level function-object assigned inside main() lets module-level code (handleProviderPageMessage, registered once at document_start, independent of any one main() call) reach into main()-scoped closure state without either side knowing the other's internals"
    - "respondToPage now RETURNS the ProviderResponsePayload kind it posted, so the caller (handleProviderPageMessage) has exactly one place to check credential vs. fallthrough/error instead of re-deriving its own classification"

key-files:
  created: []
  modified:
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts

key-decisions:
  - "hide() uses ONLY the soft/reversible overlay methods (clearFieldDropdown() + renderFormPrompt([])) -- never dismiss()/blockSite(), which permanently suppress for the rest of the page session and would make a fallthrough re-offer impossible"
  - "allow() and initialMatchAndPrompt() share one renderSurfaceBIfMatches() helper so there is exactly one implementation of 'render Surface B if this frame has matches and it isn't blocked' -- no duplicated match-rendering logic"
  - "The passkeyCeremonyInFlight guard is checked once, at entry, in initialMatchAndPrompt() and in handleFocusIn() (right after resolving the field's FillKind, so the unrelated generate-password-trigger branch above it stays unguarded) -- it does not re-check mid-flight, matching the plan's literal instruction"
  - "A credential response keeps the overlay suppressed (nothing left to log into with a fallback credential once a passkey ceremony completed); fallthrough, error (response.failed), AND a rejected ceremony promise (.catch) all clear the flag and re-offer"

requirements-completed: [PROV-01, PROV-02, FILL-01]

coverage:
  - id: D1
    description: "Forwarding a provider ceremony soft-hides an already-shown overlay (clearFieldDropdown() + renderFormPrompt([])), never dismiss()/blockSite()"
    requirement: PROV-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#forwarding a ceremony soft-hides an already-shown overlay -- clearFieldDropdown() + renderFormPrompt([]), never dismiss()/blockSite()"
        status: pass
    human_judgment: false
  - id: D2
    description: "Surface A (field dropdown) does not mount while a ceremony is in flight"
    requirement: PROV-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#Surface A: while a ceremony is in flight, focusing a detected login field does not mount the field dropdown"
        status: pass
    human_judgment: false
  - id: D3
    description: "Surface B (initial form prompt) does not mount when a ceremony is already in flight before document-ready fires (conditional-mediation race)"
    requirement: PROV-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#Surface B: the initial form-prompt render is skipped when a ceremony is already in flight before document-ready fires (conditional-mediation race)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Fallthrough, ceremony-error (response.failed), and a rejected ceremony promise all clear the in-flight flag and re-offer the login overlay (Surface B re-renders, Surface A can mount again)"
    requirement: PROV-02
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#on a fallthrough response, the flag clears and the login overlay is re-offered (Surface B re-renders, Surface A can mount again)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#on a ceremony error response (response.failed), the flag also clears and the login overlay is re-offered"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#regression: a ceremony promise that rejects outright (.catch) also clears the flag and re-offers the overlay"
        status: pass
    human_judgment: false
  - id: D5
    description: "A completed credential response keeps the overlay suppressed -- no re-render, Surface A still does not mount"
    requirement: PROV-02
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#on a credential response (passkey used), the overlay stays suppressed -- no re-render, Surface A still does not mount"
        status: pass
    human_judgment: false
  - id: D6
    description: "No security gate weakened: D-03 validation/nonce/ack/base64url/forward behavior in handleProviderPageMessage is unchanged"
    requirement: FILL-01
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts#regression (no security gate weakened): a valid ceremony still acks + forwards + responds exactly as before; an invalid (wrong-origin) request is still silently ignored"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts (Tests 13-15, CR-01, CR-03 -- full pre-existing provider-bridge suite, unmodified assertions, still green)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Live third-party site verification (github.com or similar): passkey ceremony + login overlay coordination behaves correctly in a real browser, matching Bartek's live-review report"
    human_judgment: true
    verification: []
    rationale: "Requires a packaged extension build on a real third-party RP with both a vault passkey and a detectable login form -- exactly the scenario a unit/jsdom suite cannot reproduce (real WebAuthn ceremony UI, real conditional-mediation timing). Playwright UAT is authorized per user memory but the live-review report itself already came from Bartek's own manual testing; this plan is the mechanism fix for that report."

# Metrics
duration: 25min
completed: 2026-07-17
status: complete
---

# Phase 12 Plan 07: Passkey-priority overlay coordination Summary

**Passkey ceremonies now soft-hide the Phase-10 login overlay via a module-level `overlayCoordinator{hide,allow}` bridge, re-offering it only when the ceremony falls through -- fixing Bartek's live-review report of both surfaces showing at once on github.com.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-17
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- `handleProviderPageMessage` now sets a module-level `passkeyCeremonyInFlight` flag and calls `overlayCoordinator?.hide()` right after the request passes all D-03 validation gates, before the forward -- `hide()` calls only the soft/reversible `overlay.clearFieldDropdown()` + `overlay.renderFormPrompt([])`, never `dismiss()`/`blockSite()`.
- `respondToPage` now returns the `ProviderResponsePayload` kind it posted (`"credential" | "fallthrough" | "error"`); the ceremony's `.then()`/`.catch()` handlers use that single classification to decide whether to clear the flag and call `overlayCoordinator?.allow()` (re-offer) -- only a `"credential"` outcome keeps the overlay suppressed.
- `initialMatchAndPrompt()` and `handleFocusIn()`'s Surface A mount path both guard on `passkeyCeremonyInFlight` at entry; a new `renderSurfaceBIfMatches()` helper is shared by `initialMatchAndPrompt()`'s own render and `overlayCoordinator.allow()`'s re-offer, so there is exactly one implementation of "render Surface B if this frame has matches."
- 8 new regression tests added to `extension/entrypoints/__tests__/content-relay.test.ts` covering hide-on-forward, Surface A in-flight guard, Surface B conditional-mediation-race guard, fallthrough/error/rejected re-offer, credential-stays-hidden, and a no-security-regression check (ack/forward/response behavior byte-for-byte unchanged, invalid requests still silently ignored). All 30 tests in the file pass; full suite (514 tests) passes.

## Task Commits

Each task was committed atomically:

1. **Task 1: passkey-priority overlay coordination in content-relay** - `1750186` (fix)

_Note: this was a single-task plan; SUMMARY.md itself is the plan-metadata artifact (per orchestrator instruction, STATE.md/ROADMAP.md were NOT updated by this executor)._

## Files Created/Modified
- `extension/entrypoints/content-relay.content.ts` - module-level `passkeyCeremonyInFlight`/`overlayCoordinator`; `respondToPage` returns its posted kind; `handleProviderPageMessage` sets/clears the flag and calls `hide()`/`allow()` around the existing forward; `initialMatchAndPrompt()`/`handleFocusIn()` guarded; new `renderSurfaceBIfMatches()` helper; `overlayCoordinator` assignment in `main()`
- `extension/entrypoints/__tests__/content-relay.test.ts` - mocked `../../lib/autofill/inpage-overlay` (`createOverlayController`), added the "passkey-priority overlay coordination (12-07, Bartek live-review 2026-07-17)" describe block (8 new tests)

## Decisions Made
- `respondToPage`'s new return value (the posted `ProviderResponsePayload["kind"]`) is additive only -- every existing `postToPage(...)` call site/argument inside it is byte-for-byte unchanged; only `return` statements were added. This keeps "credential vs. not" classified in exactly one place instead of re-deriving it in `handleProviderPageMessage`.
- The guard in `handleFocusIn()` sits after the `kind === undefined` early-return (i.e., specifically gates the login-overlay Surface A mount), not at the very top of the handler -- the generate-password-trigger branch above it is a separate, unrelated affordance and is deliberately left unguarded, per the plan's `<action>` instructions.
- `overlayCoordinator` and `passkeyCeremonyInFlight` are reassigned/reset on every `main()` invocation (mirrors the file's own `overlay`/`frameMatches`/`registeredProviderListener` idempotency-for-tests convention) -- in production `main()` runs exactly once, so this only matters for repeated test invocations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file path adjusted from the plan's literal `content-relay.content.test.ts` to the codebase's established `entrypoints/__tests__/content-relay.test.ts`**
- **Found during:** Task 1 (before writing any test code)
- **Issue:** The plan's `files_modified` frontmatter lists `extension/entrypoints/content-relay.content.test.ts`, but that file doesn't exist -- the actual, pre-existing test suite for this content script lives at `extension/entrypoints/__tests__/content-relay.test.ts`. That file's own header comment documents WHY: a `content-relay.test.ts` sitting directly in `entrypoints/` collides with `content-relay.content.ts` under WXT's entrypoint-name-derivation glob (`find-entrypoints.mjs` derives a name from the string before the first `.`/`/`), and `npx wxt build` fails hard with "Multiple entrypoints with the same name detected." The plan's literal path would reproduce that exact build failure.
- **Fix:** Added all 8 new tests to the existing `entrypoints/__tests__/content-relay.test.ts` file instead, following its established mocking conventions (hoisted `vi.fn()` spies, `wxt/browser` mock, `flushMicrotasks()` helper pattern already used by the pre-existing "passkey-provider bridge" describe block).
- **Files modified:** `extension/entrypoints/__tests__/content-relay.test.ts`
- **Verification:** `npm --prefix extension test -- --run content-relay.test.ts` (30/30 pass); `npx wxt build -b chrome`/`-b firefox` both succeed (no entrypoint collision)
- **Committed in:** `1750186` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking -- file-path collision avoidance)
**Impact on plan:** No scope creep; the fix follows a precedent the codebase's own test file already documents for exactly this collision.

## Issues Encountered
- A test-only race (not a production bug): the outer `beforeEach()`'s own `contentRelay.main()` call starts a fire-and-forget `initialMatchAndPrompt()` promise chain against the then-empty document (since `document` is shared across every `it` in this file, per its own header comment). In the Surface-B conditional-mediation-race test specifically, that stale chain would resume mid-test (after the test's own `mountLoginForm()` populated the DOM) and call `renderFormPrompt` unguarded, since its own entry-guard check had already passed before the ceremony flag was set. Fixed by draining that stale chain (`await flushMicrotasks()`) at the very start of that one test, while the document is still empty so it resolves as a harmless no-match early return -- documented inline in the test.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Mechanism-level fix for Bartek's live-review report is complete and unit-tested; the `human_judgment: true` D7 item (live third-party-site re-verification, e.g. github.com with both a vault passkey and a login form) is the remaining open loop before this can be considered fully closed for the live-review report.
- No STATE.md/ROADMAP.md changes were made by this executor per the orchestrator's explicit instruction -- phase 12 was already sealed (see `9a40407`/`3283823` in the git log) and this is a targeted gap-closure plan layered on top of that sealed phase.

---
*Phase: 12-passkey-provider*
*Completed: 2026-07-17*
