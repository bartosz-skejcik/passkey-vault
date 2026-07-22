---
phase: 10-autofill-login-totp-card-identity
plan: 09
subsystem: extension-autofill
tags: [webextension, typescript, vitest, wxt, tdd, origin-matching, access-control, content-script, background-service-worker]

requires:
  - phase: 10-autofill-login-totp-card-identity
    provides: "10-01's extension/lib/messaging/ext-protocol.ts Message union/MessageResponseMap shape and entrypoints/background/frame-guard.ts's originFromContentSender()/itemMatchesOrigin() origin/frame access-control gate; 10-04's entrypoints/background/autofill-match.ts (the popup-driven handlers whose EMPTY_DETECTED/asFillKind/maskedHintFor/buildFillValues helpers this plan exports and reuses); 10-05's content-relay.content.ts/fill-dom.ts (the content.detect/content.fill listener this plan's handleFillFrame dispatches to)"
provides:
  - "extension/lib/messaging/ext-protocol.ts extended additively with autofill.matchFrame/autofill.fillFrame kinds + response shapes -- the content-script-driven counterpart to 10-01/10-04's popup-driven autofill.match/autofill.fill"
  - "extension/entrypoints/background/autofill-frame.ts: assertContentSender()/handleMatchFrame()/handleFillFrame() -- the content-relay <-> background channel that lets the in-page overlay (Plan 10-10) know which items match its own frame and fill it, origin-locked to the platform-provided sender"
  - "extension/entrypoints/background/router.ts's registerAutofillFrameChannel() -- a SECOND, independent runtime.onMessage listener dispatching only the two content-frame kinds, leaving the popup router's WR-01 sender gate and session.*/vault.* privilege tier completely untouched"
  - "extension/entrypoints/background/autofill-match.ts's EMPTY_DETECTED/asFillKind/maskedHintFor/buildFillValues now exported (previously module-private) -- the shared decrypt/lookup/derive surface both the popup-driven and content-frame-driven autofill channels reuse"
affects: [10-10]

tech-stack:
  added: []
  patterns:
    - "Two channels, two listeners: registerMessageRouter() (popup-privilege tier, WR-01-gated) and registerAutofillFrameChannel() (content-script tier, assertContentSender-gated) are independent runtime.onMessage listeners on the same background context, each stepping aside (returning undefined) for kinds it does not own -- no shared dispatch table, no shared sender gate"
    - "Sender-derived trust, never payload-derived: assertContentSender(sender) resolves origin/tabId/frameId from platform-provided MessageSender fields only; autofill.matchFrame/autofill.fillFrame's request shapes carry no origin field at all, so a spoofed-origin payload has no field to write to"
    - "Reuse via export, not duplication: autofill-frame.ts imports autofill-match.ts's EMPTY_DETECTED/asFillKind/maskedHintFor/buildFillValues and frame-guard.ts's originFromContentSender/itemMatchesOrigin rather than re-implementing the popup-driven channel's decrypt/lookup/derive logic a second time"

key-files:
  created:
    - extension/entrypoints/background/autofill-frame.ts
    - extension/entrypoints/background/autofill-frame.test.ts
  modified:
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/autofill-match.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/entrypoints/background.ts

key-decisions:
  - "autofill-match.ts's EMPTY_DETECTED/asFillKind/maskedHintFor/buildFillValues changed from module-private to exported, not duplicated into autofill-frame.ts -- the plan's own action text required this ('extract a shared helper from autofill-match.ts if needed rather than copy-paste'); all four are pure functions/data with no dependency on autofill-match.ts's popup-driven active-tab resolution, so exporting them introduces no coupling beyond a straightforward import"
  - "assertContentSender() refuses on sender.tab===undefined (popup/options sender) rather than checking sender.origin against the extension's own origin (assertPopupSender's approach) -- the content-frame channel's positive requirement is 'a real content-script sender', and sender.tab being defined is the platform-provided signal for that, mirroring frame-guard.ts's own documented distinction between a tab-hosted extension page and a genuine content script"
  - "handleMatchFrame's refused-sender branch returns pageState:'restricted' (not 'ok') -- distinct from handleAutofillMatch's locked branch, which reuses pageState:'ok' with empty matches (10-04's own precedent, since that branch has no dedicated contract member). A refused sender here is a different failure mode (not a content script of this extension at all, vs. a legitimate sender whose vault happens to be locked) and 'restricted' already exists in AutofillMatchResult's pageState union for exactly this kind of non-actionable state"
  - "handleFillFrame's refused-sender and content.fill-delivery-failure branches both return reason:'target-unreachable' -- the response contract (frozen by 10-01/this plan's Task 1) offers no dedicated 'forbidden-sender' member, and 'target-unreachable' is the closest existing value-free reason that does not leak WHY the request was refused (never distinguishing 'not a content script' from 'content-relay didn't answer' to the caller)"
  - "background.ts (not in this plan's stated files_modified) was edited to call registerAutofillFrameChannel() -- this plan's own Task 3 action text explicitly requires it ('Call registerAutofillFrameChannel() from background.ts's main() right after registerMessageRouter()'); the plan's frontmatter files_modified list is incomplete on this point, not a contradiction the executor had to resolve"

requirements-completed: []

coverage:
  - id: D1
    description: "Message contract extended with autofill.matchFrame/autofill.fillFrame -- the content-script-driven counterpart to 10-01's popup-driven autofill.match/autofill.fill, no origin field on either request shape by construction"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/lib/messaging/ext-protocol.test.ts (38 tests, incl. 2 new JSON-round-trip fixtures for autofill.matchFrame/autofill.fillFrame)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "autofill-frame.ts's assertContentSender()/handleMatchFrame()/handleFillFrame() -- the content-relay-only sender guard, origin-scoped metadata-only match (payload origin ignored by construction), and fill-time origin re-verification with frame-addressed delivery, built via strict TDD (RED then GREEN)"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/autofill-frame.test.ts (11 tests covering the plan's 5 required behaviors: assertContentSender accept/refuse x4, origin-scoped match, payload-origin-ignored adversarial case, refused-sender restricted result, fill origin-mismatch refusal, frame-addressed dispatch with no leaked field value, locked fail-closed, refused-sender fill refusal)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "registerAutofillFrameChannel() wired into router.ts as a second, independent runtime.onMessage listener and called from background.ts's main(); the popup router's WR-01 gate and session.*/vault.* privilege tier remain textually unchanged"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts (14 tests, incl. 2 new 'registerAutofillFrameChannel' cases proving a content-script sender is accepted on the new listener for autofill.matchFrame while the SAME sender is still refused by the popup router for session.status)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit && npx vitest run (full suite, 236/236 across 27 files) && npx wxt build -b chrome"
        status: pass
    human_judgment: false
  - id: D4
    description: "The content-frame channel refuses the popup-privilege tier and foreign senders -- a page's content script can never reach session.*/vault.* through this new channel, and a foreign extension or unparseable-origin sender is refused by assertContentSender before either handler touches ensureHydrated/getItems"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "autofill-frame.test.ts's assertContentSender describe block (foreign extension id, popup/options sender, unparseable-origin sender all refused) plus router.test.ts's registerAutofillFrameChannel case (content-sender session.status still refused by the OTHER listener)"
        status: pass
    human_judgment: true
    rationale: "The predicate logic and the two-listener separation are fully unit-proven at this plan's scope, but the full in-browser adversarial proof (a real cross-origin content script/hostile page never reaching session.*/vault.* through either listener, in a real packaged Chrome/Firefox build) remains a UAT-level property this plan's own scope does not exercise -- matching 10-01's SUMMARY's identical precedent for the sibling popup-driven gate."

duration: 25min
completed: 2026-07-15
status: complete
---

# Phase 10 Plan 09: Content-Frame Autofill Channel -- Match/Fill for the In-Page Overlay Summary

**A second, independently-gated `runtime.onMessage` listener (`registerAutofillFrameChannel()`) that lets a content script ask "what matches MY frame" and "fill MY frame" via `autofill.matchFrame`/`autofill.fillFrame`, with every trust decision derived from the platform-provided sender -- never the request payload -- and the popup's `session.*`/`vault.*` privilege tier left completely unreachable.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-15
- **Tasks:** 3 (Task 2 was TDD: RED then GREEN, no REFACTOR needed)
- **Files modified:** 8 (2 created, 6 modified, including 2 files outside the plan's stated `files_modified` -- see Deviations)

## Accomplishments

- `extension/lib/messaging/ext-protocol.ts` extended additively (Phase 9/10's existing kinds untouched) with `autofill.matchFrame` (carries the caller's own `detected` map, no origin field) and `autofill.fillFrame` (same value-free response shape as `autofill.fill`).
- `extension/entrypoints/background/autofill-frame.ts` created: `assertContentSender()` (the single guard -- refuses a foreign extension id, a popup/options sender with no `tab`, or a sender whose origin cannot be resolved at all), `handleMatchFrame()` (metadata-only match gated on the sender's own resolved origin, ignoring any origin-looking field a caller might smuggle onto the payload), `handleFillFrame()` (re-derives sender origin/tabId/frameId from scratch -- TOCTOU defense -- re-checks `itemMatchesOrigin`, dispatches `content.fill` to the exact resolved `{tabId, frameId}`).
- `extension/entrypoints/background/autofill-match.ts`'s `EMPTY_DETECTED`/`asFillKind`/`maskedHintFor`/`buildFillValues` exported (were module-private) so `autofill-frame.ts` reuses the exact same decrypt/lookup/derive logic instead of duplicating it.
- `extension/entrypoints/background/router.ts`'s `registerAutofillFrameChannel()` -- a second, independent listener, wired into `background.ts`'s `main()` right after `registerMessageRouter()` -- dispatches only the two new kinds and steps aside for everything else, leaving the popup router's WR-01 gate and `assertPopupSender()` tier check textually unchanged.

## Task Commits

1. **Task 1: Extend the contract with the content-frame kinds** -- `21acd05` (feat)
2. **Task 2: autofill-frame.ts -- content-frame handlers + sender guard (TDD)** -- `b40e3ef` (test, RED) -> `605cf9d` (feat, GREEN)
3. **Task 3: Register the content-frame channel as a second listener** -- `3a6f556` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/lib/messaging/ext-protocol.ts` -- additive `autofill.matchFrame`/`autofill.fillFrame` kinds + response shapes
- `extension/lib/messaging/ext-protocol.test.ts` -- 2 new JSON-round-trip fixtures (Rule 3, not in `files_modified` -- see Deviations)
- `extension/entrypoints/background/autofill-frame.ts` -- `assertContentSender()`/`handleMatchFrame()`/`handleFillFrame()` (new)
- `extension/entrypoints/background/autofill-frame.test.ts` -- 11 tests covering the plan's 5 required behaviors (new)
- `extension/entrypoints/background/autofill-match.ts` -- `EMPTY_DETECTED`/`asFillKind`/`maskedHintFor`/`buildFillValues` changed from module-private to exported (Rule 3, not in `files_modified`)
- `extension/entrypoints/background/router.ts` -- `registerAutofillFrameChannel()`, `isContentFrameMessage()`, `handleContentFrameMessage()` added
- `extension/entrypoints/background/router.test.ts` -- 2 new `registerAutofillFrameChannel` cases (not in `files_modified` -- see Deviations)
- `extension/entrypoints/background.ts` -- `registerAutofillFrameChannel()` call added (not in `files_modified` -- see Deviations)

## Decisions Made

See frontmatter `key-decisions` for the full record. Summary:

- **Reused, did not duplicate** `autofill-match.ts`'s four popup-driven helpers by exporting them -- the plan's own action text required this.
- **`assertContentSender()` gates on `sender.tab !== undefined`**, not an origin comparison, to distinguish a genuine content script from a popup/options document -- the inverse discriminator from `assertPopupSender()`'s own approach, appropriate because this channel's positive requirement is exactly "a real content-script sender".
- **`handleMatchFrame`'s refused-sender branch returns `pageState: "restricted"`**, distinct from the locked branch's `"ok"` -- a refused sender is a different, non-actionable failure mode from a legitimate sender whose vault happens to be locked.
- **`handleFillFrame`'s refused-sender and delivery-failure branches share `reason: "target-unreachable"`** -- the frozen response contract has no dedicated "forbidden sender" reason, and this choice never leaks *why* a request was refused back to the caller.
- **`background.ts` was edited** even though the plan's frontmatter `files_modified` omits it -- Task 3's own action text explicitly requires the `registerAutofillFrameChannel()` call site there.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added JSON-round-trip fixtures for the 2 new message kinds in `ext-protocol.test.ts`**
- **Found during:** Task 1
- **Issue:** `ext-protocol.test.ts`'s `MESSAGE_FIXTURES`/`RESPONSE_FIXTURES` are typed as mapped-object types keyed by `Message["kind"]` -- TypeScript requires every key present. Adding `autofill.matchFrame`/`autofill.fillFrame` to the `Message` union without adding fixtures fails `tsc` (not just the test file's own assertions). Identical situation to 10-01's Task 1, same fix.
- **Fix:** Added one request-side and one response-side fixture per new kind, following the file's existing convention.
- **Files modified:** `extension/lib/messaging/ext-protocol.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npx vitest run lib/messaging/ext-protocol.test.ts` -- 38/38 passing.
- **Committed in:** `21acd05` (Task 1 commit)

**2. [Rule 3 - Blocking] Exported `autofill-match.ts`'s `EMPTY_DETECTED`/`asFillKind`/`maskedHintFor`/`buildFillValues`**
- **Found during:** Task 2 (RED, before writing the test file)
- **Issue:** These four were module-private in `autofill-match.ts`. The plan's own action text forbids duplicating this logic in `autofill-frame.ts` ("do NOT duplicate that logic; import it (extract a shared helper from autofill-match.ts if needed rather than copy-paste)"). Without exporting them, `autofill-frame.ts` could not exist without either re-implementing the field-mapping/masking logic a second time or leaving `handleMatchFrame`/`handleFillFrame` unable to build matches/fill values at all.
- **Fix:** Added the `export` keyword to all four declarations in `autofill-match.ts`; no logic changed.
- **Files modified:** `extension/entrypoints/background/autofill-match.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `autofill-match.test.ts`'s existing 9 tests still pass unchanged (pure additive export, no behavior touched).
- **Committed in:** `b40e3ef` (Task 2 RED commit, alongside the failing test file that imports `EMPTY_DETECTED`)

**3. [Rule 3 - Blocking] Edited `background.ts` (not in this plan's stated `files_modified`)**
- **Found during:** Task 3
- **Issue:** Task 3's own action text explicitly requires "Call `registerAutofillFrameChannel()` from `background.ts`'s `main()` right after `registerMessageRouter()`", but the plan's frontmatter `files_modified` list omits `extension/entrypoints/background.ts` entirely. Without this call, the new listener is defined but never registered -- the whole feature would silently not exist at runtime despite `router.ts` type-checking and unit-testing correctly.
- **Fix:** Added the import and call site in `background.ts`'s `main()`, immediately after `registerMessageRouter()`, matching the file's existing synchronous-registration convention and its own header comment's rationale (an MV3 service worker that misses registering a listener on a given wake silently drops messages fired during that wake window).
- **Files modified:** `extension/entrypoints/background.ts`
- **Verification:** `npx wxt build -b chrome` succeeds, packaging `content-relay.js`/`background.js` as before; `npx tsc --noEmit` exits 0.
- **Committed in:** `3a6f556` (Task 3 commit)

**4. [Rule 2 - Missing Critical] Added a `router.test.ts` case proving the two-listener separation**
- **Found during:** Task 3 (per the plan's own instruction to add this coverage)
- **Issue:** Without an integration-level test exercising both listeners against the SAME content-script sender shape, `registerAutofillFrameChannel()`'s core safety property ("the popup router's WR-01 gate is unchanged") would be asserted only by code comments and a `grep`, not a pinned regression test -- exactly the gap 10-01's own post-hoc Rule 2 fix (commit `42efc33`) addressed for the sibling `assertPopupSender()` guard.
- **Fix:** Added a case dispatching `autofill.matchFrame` through `listeners[1]` (the new channel) and `session.status` through `listeners[0]` (the popup router) with the identical content-script sender object, asserting the first is accepted and dispatched to `handleMatchFrame` while the second returns `undefined`.
- **Files modified:** `extension/entrypoints/background/router.test.ts`
- **Verification:** `npx vitest run entrypoints/background/router.test.ts` -- 14/14 passing.
- **Committed in:** `3a6f556` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (3 Rule 3/blocking, 1 Rule 2/missing-critical-coverage). All necessary for correctness (tsc would not compile without #1; the feature would not exist at runtime without #2/#3) and for proving the plan's own stated two-listener separation actually holds (#4). No scope creep beyond what each blocking issue required.

## Issues Encountered

- Pre-existing, unrelated unhandled rejection in `entrypoints/popup/App.test.tsx` (`TypeError: Cannot read properties of undefined (reading 'request')` at `entrypoints/popup/ServerConfigView.tsx:95:32`) persists across this plan's changes -- already documented in `.planning/phases/10-autofill-login-totp-card-identity/deferred-items.md` by 10-01 as confirmed-present-on-clean-`HEAD`, out of scope for this plan's `files_modified`.
- No environment bootstrap needed: `node_modules` and the gitignored WASM build artifacts were already present in this checkout (sequential executor on `main`, not a fresh worktree), matching the orchestrator's `resolved_facts`.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- `extension/entrypoints/background/autofill-frame.ts`'s `handleMatchFrame`/`handleFillFrame` are ready to be driven by Plan 10-10's in-page overlay (`sendMessage<"autofill.matchFrame">`/`"autofill.fillFrame"`, already typed in `ext-protocol.ts` since this plan) via `browser.runtime.sendMessage` from within the ISOLATED-world content script -- no further background-side wiring needed.
- `registerAutofillFrameChannel()` is live and registered at every service-worker wake, alongside `registerMessageRouter()`.
- `requirements-completed` left empty for FILL-01..04, matching every prior Phase 10 plan's precedent (10-01/10-04/10-05's SUMMARYs): this plan delivers the content-frame channel's security layer, not user-facing overlay UI -- that is Plan 10-10's job.
- No blockers. The full in-browser adversarial proof that a real hostile content script never reaches `session.*`/`vault.*` through either listener remains a UAT-level property outside this plan's own scope (coverage D4's `rationale`).

---
*Phase: 10-autofill-login-totp-card-identity*
*Completed: 2026-07-15*

## Self-Check: PASSED

All claimed files (extension/entrypoints/background/autofill-frame.ts,
extension/entrypoints/background/autofill-frame.test.ts, this SUMMARY)
confirmed present on disk. All 4 task commit hashes (21acd05, b40e3ef,
605cf9d, 3a6f556) confirmed present in git log.
