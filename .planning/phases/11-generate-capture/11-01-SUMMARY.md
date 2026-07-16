---
phase: 11-generate-capture
plan: 01
subsystem: extension
tags: [wxt, browser-extension, csprng, messaging-protocol, generator]

# Dependency graph
requires:
  - phase: 09-session-unlock-popup-sync
    provides: "ext-protocol.ts's {kind,payload} discriminated-union convention, router.ts's popup-facing handle()/isProtocolMessage()"
  - phase: 10-autofill
    provides: "registerAutofillFrameChannel()'s content-frame dispatch mechanism (isContentFrameMessage()/handleContentFrameMessage()), assertContentSender() in autofill-frame.ts, frame-guard.ts's MessageSender type"
provides:
  - "ext-protocol.ts's generate-request/capture.propose/capture.confirm discriminated-union members and MessageResponseMap entries -- the single choke-point contract Plans 11-02 through 11-05 build against"
  - "extension/lib/generator/{password,strength,wordlist}.ts -- byte-for-byte port of v0.1's CSPRNG password/passphrase generator"
  - "entrypoints/background/generate-handler.ts's handleGenerateRequest -- background-only generate-request dispatcher wired into registerAutofillFrameChannel()"
affects: [11-02, 11-03, 11-04, 11-05, generate-popover, capture-flow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Content-script-driven message kinds (generate-request, and later capture.propose/capture.confirm) are dispatched by registerAutofillFrameChannel(), never the popup router's handle()/isProtocolMessage() -- mirrors Phase 10's autofill.matchFrame/autofill.fillFrame precedent exactly."
    - "Background handlers with heavy transitive deps (wasm-loader via vault-session/vault-store) require those three modules mocked in any test that imports a sibling of autofill-frame.ts's handleMatchFrame/handleFillFrame, even when the code under test (assertContentSender) doesn't touch them -- module-eval-time import cost, not a real dependency."

key-files:
  created:
    - extension/lib/generator/password.ts
    - extension/lib/generator/password.test.ts
    - extension/lib/generator/strength.ts
    - extension/lib/generator/wordlist.ts
    - extension/entrypoints/background/generate-handler.ts
    - extension/entrypoints/background/generate-handler.test.ts
  modified:
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts

key-decisions:
  - "GenerateCharacterOptions defined inline in ext-protocol.ts (not imported from Task 2's generator module) to avoid a forward dependency from Task 1's file onto a not-yet-created Task 2 file."
  - "generate-request/capture.propose/capture.confirm dispatched via the SAME registerAutofillFrameChannel() listener as autofill.matchFrame/fillFrame -- confirmed against the freshness-audit note that the popup router's addListener-level sender check drops every content-script sender before isProtocolMessage()/handle() ever runs."
  - "handleGenerateRequest is a pure, synchronous function (no await) -- generation needs zero unlocked-key/session state per RESEARCH.md's explicit finding; this is an enforced invariant, not an accident."
  - "Added explicit length/wordCount bounds (8-64 chars, 3-10 words) matching v0.1's own GeneratorPopover.tsx UI constants -- the plan's threat_model (T-11-01) requires rejecting out-of-range values to prevent an unbounded-loop hang, which was missing from the initial implementation (Rule 2 fix, see Deviations)."
  - "No @webext-core/fake-browser or WxtVitest introduced -- every existing background test in this codebase (autofill-frame.test.ts, router.test.ts, ext-passkey.test.ts, etc.) mocks wxt/browser directly via vi.mock; generate-handler.test.ts follows that established, proven pattern instead of the plan's fallback instruction."

patterns-established:
  - "Content-frame message kinds with no origin-scoped state (generate-request) carry no origin field at all, matching autofill.matchFrame's precedent -- nothing for a caller to spoof by construction."

requirements-completed: [CAP-01]

coverage:
  - id: D1
    description: "ext-protocol.ts carries generate-request/capture.propose/capture.confirm discriminated-union members and matching MessageResponseMap entries, with JSON-transport-safety fixtures for all three"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/lib/messaging/ext-protocol.test.ts (44 tests, includes 3 new fixture round-trips)"
        status: pass
    human_judgment: false
  - id: D2
    description: "generateCharacterPassword/generatePassphrase/scorePasswordStrength/scorePasswordMeter ported byte-for-byte into extension/lib/generator/ (confirmed identical via diff against web/src/lib/generator/)"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/lib/generator/password.test.ts (9 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "generate-request round-trips through registerAutofillFrameChannel()'s content-frame dispatch to handleGenerateRequest -- both modes produce correct output, invalid mode and generator throws return typed errors, non-content-script sender rejected, out-of-range length/wordCount rejected"
    requirement: "CAP-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/generate-handler.test.ts (8 tests)"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 01: Generate-Capture Protocol + CSPRNG Generator Summary

**ext-protocol.ts's generate-request/capture.propose/capture.confirm contract, a byte-for-byte port of v0.1's CSPRNG password/passphrase generator, and a background-only generate-request handler wired into the content-frame channel with DoS-hang protection added beyond the plan's original scope.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-16T11:50:00Z (approx.)
- **Completed:** 2026-07-16T11:58:40Z
- **Tasks:** 3 completed
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments

- Extended `ext-protocol.ts` with the three Phase 11 message kinds (`generate-request`, `capture.propose`, `capture.confirm`) plus response-map entries, matching Phase 9's existing `{kind,payload}` discriminated-union convention exactly
- Ported `web/src/lib/generator/{password,strength,wordlist}.ts` verbatim into `extension/lib/generator/` via TDD (RED: copied tests fail against nonexistent source; GREEN: byte-for-byte `cp`, diff-confirmed identical)
- Wired `generate-request` into `registerAutofillFrameChannel()`'s content-frame dispatch (the same listener as Phase 10's `autofill.matchFrame`/`autofill.fillFrame`, never the popup router) via a new pure, synchronous `handleGenerateRequest` in `generate-handler.ts`
- Added length/wordCount bounds validation (Rule 2 fix) closing a real DoS-hang gap the threat model explicitly required but the initial implementation missed

## Task Commits

Each task was committed atomically (Task 2 and Task 3 used TDD, each with separate RED/GREEN commits):

1. **Task 1: Define generate-request/capture.propose/capture.confirm in ext-protocol.ts** - `564dbe4` (feat)
2. **Task 2: Port the v0.1 CSPRNG password/passphrase generator verbatim** - `39b79a5` (test, RED) → `7c8e8aa` (feat, GREEN)
3. **Task 3: Wire generate-request to the ported generator on the content-frame channel** - `ef3025e` (test, RED) → `5393411` (feat, GREEN) → `054119e` (fix, Rule 2 deviation)

**Plan metadata:** committed by orchestrator after wave merge (worktree mode)

## Files Created/Modified

- `extension/lib/messaging/ext-protocol.ts` - Added `generate-request`/`capture.propose`/`capture.confirm` union members, `GenerateCharacterOptions` type, response-map entries
- `extension/lib/messaging/ext-protocol.test.ts` - Added exhaustiveness fixtures for the 3 new kinds (required for `tsc` to pass — `MessageFixtureMap`/`ResponseFixtureMap` are keyed by `Message["kind"]`)
- `extension/lib/generator/password.ts` - Byte-for-byte port of `generateCharacterPassword`/`generatePassphrase` (CSPRNG rejection sampling)
- `extension/lib/generator/password.test.ts` - Byte-for-byte port of the original test suite (relative imports needed no adjustment)
- `extension/lib/generator/strength.ts` - Byte-for-byte port of `scorePasswordStrength`/`scorePasswordMeter`
- `extension/lib/generator/wordlist.ts` - Byte-for-byte port of the 7776-entry EFF wordlist
- `extension/entrypoints/background/generate-handler.ts` - New: `handleGenerateRequest(payload, sender)` — `assertContentSender` guard, mode dispatch, length/wordCount bounds check, error-typed failure paths
- `extension/entrypoints/background/generate-handler.test.ts` - New: 8 tests (2 mode-success, 1 invalid-mode, 1 generator-throw, 3 bounds-check, 1 sender-rejection)
- `extension/entrypoints/background/router.ts` - `registerAutofillFrameChannel()`'s `isContentFrameMessage()`/`handleContentFrameMessage()` now recognize `generate-request` as a third content-frame kind
- `extension/entrypoints/background/router.test.ts` - Added a `./generate-handler` mock for isolation (matching the file's existing per-handler-module mocking precedent)

## Decisions Made

- `GenerateCharacterOptions` defined inline in `ext-protocol.ts` rather than imported from the generator module, avoiding a forward dependency from Task 1 onto Task 2's not-yet-created file at Task 1's own verification time.
- `handleGenerateRequest` kept pure/synchronous (no `await`) — generation has zero dependency on the unlocked User Key or `chrome.storage.session`, matching RESEARCH.md's explicit finding; this is documented in the handler's own header comment as an enforced invariant for future reviewers.
- Followed the codebase's existing `vi.mock("wxt/browser", ...)` direct-mocking convention for `generate-handler.test.ts` rather than introducing `@webext-core/fake-browser`/`WxtVitest` — confirmed via grep that no existing background test uses either, and the plan's own instruction was conditional ("if WxtVitest isn't wired yet, install... before writing the test"); the already-proven pattern was sufficient and consistent with precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected `MessageSender` import source in `generate-handler.ts`**
- **Found during:** Task 3, first `tsc --noEmit` run after implementation
- **Issue:** Imported `type MessageSender` from `./autofill-frame`, but that file only *imports* `MessageSender` locally from `./frame-guard` — it doesn't re-export it. This produced a new `tsc` error not present before the change.
- **Fix:** Changed the import to `import type { MessageSender } from "./frame-guard"` (the type's actual canonical source, same as `autofill-frame.ts` itself uses).
- **Files modified:** `extension/entrypoints/background/generate-handler.ts`
- **Verification:** `tsc --noEmit` returns to only the 3 pre-existing unrelated errors (see Issues Encountered)
- **Committed in:** `5393411` (Task 3 GREEN commit)

**2. [Rule 2 - Missing Critical] Added length/wordCount bounds validation**
- **Found during:** Post-Task-3 threat-model reconciliation pass (T-11-01 disposition: mitigate)
- **Issue:** The plan's own threat register requires generate-handler.ts to "reject out-of-range `length`/`wordCount`... rather than letting a malformed request crash the router or hang on an unbounded loop," but the initial implementation only caught *thrown* generator errors — an absurd `length` (e.g. `100_000_000`) doesn't throw, it drives `generateCharacterPassword`'s `for` loop into a real multi-second-or-worse service-worker hang.
- **Fix:** Added explicit bounds checks (`length` 8-64, `wordCount` 3-10) before calling either generator function, returning a typed `{error}` for anything outside range. Bounds match v0.1's own `GeneratorPopover.tsx` UI constants (`CHAR_MIN_LENGTH`/`CHAR_MAX_LENGTH`/`PASSPHRASE_MIN_WORDS`/`PASSPHRASE_MAX_WORDS`) rather than an arbitrary new choice.
- **Files modified:** `extension/entrypoints/background/generate-handler.ts`, `extension/entrypoints/background/generate-handler.test.ts` (3 new tests)
- **Verification:** `vitest run entrypoints/background/generate-handler` (8/8 pass)
- **Committed in:** `054119e`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical/threat-model mitigation)
**Impact on plan:** Both fixes necessary for correctness (Rule 1) and DoS-hang prevention explicitly required by this plan's own threat register (Rule 2). No scope creep — no architectural changes, no new dependencies.

## Issues Encountered

- **`tsc --noEmit` has 3 pre-existing, unrelated errors** in `entrypoints/background/vault-session.ts` and `lib/crypto/wasm-loader.ts`, caused by the missing generated WASM build artifact (`extension/lib/crypto/wasm/`) — this fresh worktree checkout has no `wasm-bindgen-cli` installed and `scripts/build-wasm.sh` was never run. Confirmed pre-existing via `git log` (last touched in Phase 10, unrelated to Phase 11) and by direct inspection of the error output (none of this plan's files appear in it). Documented in `.planning/phases/11-generate-capture/deferred-items.md`; not fixed here (out of scope — building the WASM artifact is a Rust/cargo toolchain step, not a code bug, and none of this plan's `files_modified` touch the WASM crate).
- **`router.test.ts` fails to load** (module-load error, not a test failure) with the same missing-WASM root cause: `router.ts` imports `handleAutofillFill`/`handleAutofillMatch`/`handleAutofillTotpCode` from `./autofill-match`, which `router.test.ts` has never mocked — confirmed via `git show` on this plan's base commit that the gap predates Phase 11 entirely, and via `git stash` that the failure is identical with only this plan's Task 1/2 commits applied (before any Task 3 edits to `router.ts`/`router.test.ts`). This plan's own `<verification>` block does not include `router.test.ts` or the full suite, so left as documented, out-of-scope debt in `deferred-items.md` for a future plan or a `wasm-bindgen-cli` install to pick up.
- Neither issue blocks this plan's own success criteria: all 3 plan-specified verification commands (`tsc --noEmit` showing zero NEW errors, `vitest run lib/generator`, `vitest run entrypoints/background/generate-handler`) pass cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ext-protocol.ts` now carries all three Phase 11 message-kind definitions (types only for `capture.*`) — Plans 11-02 through 11-05 can build against this contract without further edits to that file until Plan 11-03 registers the `capture.*` handlers.
- The ported generator (`extension/lib/generator/`) is ready for Plan 11-04's generate popover to call through `generate-request`.
- Concern for a future plan/session: install `wasm-bindgen-cli` and run `scripts/build-wasm.sh` (or accept the pre-existing gap) to get a fully clean `tsc --noEmit`/full-suite baseline — currently 3 pre-existing tsc errors and 1 pre-existing test-file load failure, both unrelated to Phase 11 and documented in `deferred-items.md`.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 8 created/modified files verified present on disk; all 6 task commits
(`564dbe4`, `39b79a5`, `7c8e8aa`, `ef3025e`, `5393411`, `054119e`) verified
present in git log.
