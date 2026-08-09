---
phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta
plan: 01
subsystem: extension
tags: [extension, capture-handler, provider-ceremony, sharing, access-control, wasm-crypto, i18n, playwright]

requires:
  - phase: 27-extension-integration-shared-items
    provides: "27-07's ReadOnlyAccessError gate in confirmUpdateLogin (the exact site B-4/B-10's fixes land at), the sharedToMe/collectionId wire shape decryptDirectSharedRow produces, and the dual-extension-access-levels.spec.ts live-proof harness this plan extends"
provides:
  - "capture-handler.ts's confirmUpdateLogin refuses a direct-share write (sharedToMe:true) unconditionally, before any encrypt call, mirroring web's itemCapabilities.ts::canEditItem"
  - "The same gate's collection-scoped check is now an exact match on \"edit\" -- the hidden_password exception is removed, matching the server's RequireEdit::satisfied_by"
  - "classifySubmit computes a blockedReason (\"direct-share\" | \"no-edit-access\") so the capture-toast opens directly in an honest blocked state, before an Update button is ever offered"
  - "save-update-toast.ts's blocked-render branch: no password preview, no Update/Retry/Dismiss button, non-error tone, genuine DOM absence for preview/actions elements"
  - "router.ts's reactive backstop: DirectShareNotEditableError mapped to {status:\"error\"} in handleCaptureConfirmMessage's catch chain (5 branches, not 4)"
  - "persistUpdatedProviderItem's dormant sharedToMe check, fixed before any future EXT-10 counter-tracking phase could make the bug live"
affects: [28-02, 28-03, milestone-audit-followups]

tech-stack:
  added: []
  patterns:
    - "Client-side write-refusal gates must check sharedToMe as an independent, prior condition before any collection-scope check -- collectionId===null never implies \"safe to write\", only \"not collection-scoped\""
    - "A blocked-write UI state opens directly on first render (computed by the same pure classifier that proposes the action), never as a reaction to a failed confirm -- 'suppressed, not failed'"
    - "Blocked toast states omit sensitive machinery (password preview, confirm button) from the DOM entirely rather than hiding it -- genuine absence, not merely display:none"

key-files:
  created: []
  modified:
    - extension/entrypoints/background/capture-handler.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/lib/autofill/save-update-toast.ts
    - extension/lib/i18n/autofill-dictionary.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/capture-handler.test.ts
    - extension/entrypoints/background/router-capture.test.ts
    - extension/lib/autofill/save-update-toast.test.ts
    - extension/e2e/fixtures-account-setup.ts
    - extension/e2e/dual-extension-access-levels.spec.ts
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts

key-decisions:
  - "save-update-toast.ts's blocked branch never CONSTRUCTS the preview/confirm-button elements at all (not merely .hidden = true) -- a hidden password-preview input still holds the submitted plaintext in the DOM, which is unnecessary exposure for a write that will never be confirmed."
  - "The existing read-only (plain, non-hidden_password) collection-scoped write-refusal test in dual-extension-access-levels.spec.ts was updated from a reactive confirm-then-error flow to the new proactive-block flow, since B-10 routes plain read-only through the SAME blockedReason gate as hidden_password (both are 'no-edit-access')."
  - "Added a small getHiddenPasswordItemRevision()/getHiddenPasswordCollectionItemRevision() closure to the e2e fixture (mirrors revokeMemberBAccess's own pattern) so the live proof of 'owner's item stays byte-unchanged' is a raw authenticated revision check, not a second full popup-unlock+decrypt round trip."

patterns-established:
  - "Mirror an already-correct sibling predicate rather than re-deriving one: capture-handler.ts's new gate is a direct line-for-line port of web/src/lib/vault/itemCapabilities.ts::canEditItem's rule."

requirements-completed: [SHARE-02, SHARE-03, EXT-07]

coverage:
  - id: D1
    description: "A direct share (any access level, including hidden_password) refuses a capture-update before any encrypt call; the popup's capture-toast opens directly in the blocked state (update.blockedTitle + update.blockedDirectShareBody), never a generic post-confirm failure."
    requirement: "SHARE-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a DIRECT-shared item (sharedToMe:true) at 'hidden_password' throws DirectShareNotEditableError BEFORE any encrypt call"
        status: pass
      - kind: unit
        ref: "extension/lib/autofill/save-update-toast.test.ts#action:'update' with blockedReason:'direct-share' opens directly in the blocked state -- no preview, no actions, non-error tone"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-extension-access-levels.spec.ts#direct share (hidden_password) write is refused BEFORE any encrypt call, owner's item stays byte-unchanged"
        status: pass
    human_judgment: false
  - id: D2
    description: "A hidden_password collection-scoped share refuses a capture-update before any encrypt call (Warning 1) via the SAME gate as SHARE-02, distinguished in the UI by update.blockedNoEditAccessBody; an edit-level collection-scoped share is unaffected."
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item with 'hidden_password' access throws ReadOnlyAccessError BEFORE any encrypt call (B-10 -- no exception)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item with 'edit' access encrypts via encryptItemForCollection using the cached Collection Key, never encryptItem"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-extension-access-levels.spec.ts#hidden_password COLLECTION share write is refused BEFORE any encrypt call, with the no-edit-access body (not the direct-share body)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Autofill/TOTP for shared items is entirely unaffected by the write-path gate; router.ts's reactive backstop maps DirectShareNotEditableError to {status:'error'}."
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-access-levels.spec.ts#hidden_password autofills without reveal/copy, and read-only writes are refused"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/router-capture.test.ts#maps a DirectShareNotEditableError from confirmUpdateLogin to {status:'error'} instead of leaking/throwing"
        status: pass
    human_judgment: false
  - id: D4
    description: "persistUpdatedProviderItem carries the identical sharedToMe refusal (dormant twin of Blocker 2), fixed before it can ever fire in production."
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#behavior 4: a DIRECTLY-shared item (sharedToMe:true) never calls updateItem/encryptItemForCollection/decryptItem, and logs via console.error"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-08-09
status: complete
---

# Phase 28 Plan 01: Direct-share and hidden_password write refusal Summary

**capture-handler.ts's write gate now refuses `sharedToMe` unconditionally and drops the `hidden_password` edit exception, mirroring web's `itemCapabilities.ts::canEditItem`; the capture-toast opens directly in an honest blocked state instead of failing reactively.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (Task 1 tracer, Task 2 tdd, Task 3 tdd)
- **Files modified:** 13

## Accomplishments

- Closed v0.4 audit Blocker 2 (silent data corruption): a direct-share capture-update no longer silently mis-encrypts the owner's item under the recipient's own User Key. `confirmUpdateLogin` now checks `target.sharedToMe === true` FIRST, before the collection-scoped gate and before any encrypt call, throwing a new `DirectShareNotEditableError`.
- Closed v0.4 audit Warning 1: the extension no longer offers an edit affordance the server will always 403. The `hidden_password` exception was removed from the collection-scoped gate's condition — it's now an exact match on `"edit"`, matching `RequireEdit::satisfied_by` and web's `canEditItem`.
- The capture-toast (`save-update-toast.ts`) now opens DIRECTLY in a named blocked state (`update.blockedTitle` + `update.blockedDirectShareBody`/`update.blockedNoEditAccessBody`) for both cases, computed proactively by `classifySubmit`'s new `blockedReason` field — never a generic post-confirm failure. No password preview or Update/Retry/Dismiss button is ever constructed for a blocked proposal (genuine DOM absence, not merely hidden).
- `router.ts`'s reactive backstop maps the new `DirectShareNotEditableError` to `{status:"error"}`, mirroring the existing `ReadOnlyAccessError`/`CollectionKeyUnavailableError` branches — 5 distinct mapped error branches for `capture.confirm`, not 4.
- Closed v0.4 audit Warning 3 (dormant): `persistUpdatedProviderItem` carries the identical `sharedToMe` refusal as the live gate, fixed before any future EXT-10 counter-tracking phase could make the same corruption class live.
- Live-proven against real crypto: three new/updated Playwright tests in `dual-extension-access-levels.spec.ts` — a direct `hidden_password` share, a collection-scoped `hidden_password` share, and the collection-scoped plain-`read` case — all open the blocked toast proactively and leave the owner's item byte-unchanged (verified via a raw authenticated revision check).

## Task Commits

Each task was committed atomically:

1. **Task 1: Direct-share + hidden_password write refusal — gate, wire type, and blocked-toast rendering, live-proven** - `c310cb8` (feat)
2. **Task 2: hidden_password collection-scoped refusal (Warning 1), reactive backstop, and unit coverage** - `6071a4d` (feat)
3. **Task 3: persistUpdatedProviderItem dormant fix (Warning 3)** - `0910164` (feat)

_Note: both TDD tasks (2, 3) landed as single `feat` commits — the new production code (router.ts's catch branch, provider-ceremony.ts's sharedToMe check) and its test coverage were authored together per the plan's own guidance ("Task 1's code changes already exist by this point in execution order, so this task is primarily test-authoring against already-correct production code"), since most of the underlying gate logic was already correct from Task 1._

## Files Created/Modified

- `extension/entrypoints/background/capture-handler.ts` - New `DirectShareNotEditableError` class; `confirmUpdateLogin`'s gate now checks `sharedToMe` first, then an exact-match `"edit"` collection-scoped check (hidden_password exception removed); `classifySubmit` computes `blockedReason`.
- `extension/lib/messaging/ext-protocol.ts` - `MessageResponseMap["capture.propose"]` gains `blockedReason?: "direct-share" | "no-edit-access"`.
- `extension/entrypoints/content-relay.content.ts` - Threads `blockedReason` into `showSaveUpdateToast`'s call.
- `extension/lib/autofill/save-update-toast.ts` - New blocked-render branch: opens directly in the blocked state, never constructs preview/confirm-button machinery for it.
- `extension/lib/i18n/autofill-dictionary.ts` - `update.blockedTitle`/`update.blockedDirectShareBody`/`update.blockedNoEditAccessBody`, PL+EN.
- `extension/entrypoints/background/router.ts` - New `DirectShareNotEditableError` catch branch in `handleCaptureConfirmMessage`.
- `extension/entrypoints/background/capture-handler.test.ts` - Updated hidden_password collection-scoped test (now expects refusal); new direct-share/hidden_password/edit-override tests; `classifySubmit` `blockedReason` coverage.
- `extension/entrypoints/background/router-capture.test.ts` - Real re-implementations of `ReadOnlyAccessError`/`CollectionKeyUnavailableError`/`DirectShareNotEditableError` in the mock, plus a new mapping test.
- `extension/lib/autofill/save-update-toast.test.ts` - Coverage for both blocked-render branches plus the `'new'`-action non-narrowing control.
- `extension/e2e/fixtures-account-setup.ts` - New `getHiddenPasswordItemRevision()` closure; new `hidden_password` COLLECTION membership (`hiddenPasswordCollectionId` + own item) with its own revision-check closure.
- `extension/e2e/dual-extension-access-levels.spec.ts` - New CDP text/absence helpers; updated the read-only write-refusal section to the proactive-block flow; two new live tests (direct-share hidden_password, collection-scoped hidden_password).
- `extension/entrypoints/background/provider-ceremony.ts` - `persistUpdatedProviderItem` gains a `sharedToMe` parameter, checked first (fail loud, never write).
- `extension/entrypoints/background/provider-ceremony.test.ts` - `passkeyItem()` helper gains an optional `sharedToMe` parameter; new behavior-4 test for the dormant refusal.

## Decisions Made

- **DOM-absence over hidden-attribute for the blocked toast's sensitive elements.** The plan's own action text said "hide bodyEl/previewRow"; the implementation instead never constructs the preview/confirm-button elements at all for a blocked proposal. A hidden `<input type="password">` still holds the submitted plaintext in its `value` attribute — genuine absence is the stronger, still-plan-compliant choice (the toast's visible behavior is identical either way; this is purely a DOM-hygiene refinement). This was iterated during Task 2 once the stricter unit test made the distinction observable.
- **Both plain `read` and `hidden_password` collection-scoped access now route through the identical `blockedReason: "no-edit-access"` gate**, per 28-UI-SPEC.md's own design ("covers BOTH plain read-only and hidden_password collection-scoped access"). This meant the PRE-EXISTING read-only write-refusal test (added in Phase 27) had to be updated from its old reactive confirm-then-error assertion to the new proactive-block assertion — not a new defect, but a necessary consequence of Task 1's own gate correctly generalizing beyond just `hidden_password`.
- **A small raw-revision-check closure was added to the e2e fixture** (`getHiddenPasswordItemRevision`/`getHiddenPasswordCollectionItemRevision`) rather than a second popup-unlock+decrypt round trip, mirroring `revokeMemberBAccess`'s own established "capture the token in this closure, never return it" pattern — satisfies the plan's "raw authenticated request as member A" acceptance criterion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Task 1's own live e2e verify required updating the PRE-EXISTING read-only write-refusal test**
- **Found during:** Task 1 (running the tracer's `<verify>` playwright command)
- **Issue:** The gate fix correctly generalizes the collection-scoped refusal to ALL non-edit access levels (not just `hidden_password`), so the existing `dual-extension-access-levels.spec.ts` test's plain-`read` write-refusal section — which clicked a confirm button and asserted a REACTIVE error — no longer matched reality: there is no confirm button to click anymore (the toast now opens proactively blocked).
- **Fix:** Updated that section to assert the new proactive-block shape (message visible on first render, no confirm button in the DOM at all, correct blocked-body copy).
- **Files modified:** `extension/e2e/dual-extension-access-levels.spec.ts`
- **Verification:** `npx playwright test --project=chromium e2e/dual-extension-access-levels.spec.ts --retries=0` — all tests pass.
- **Committed in:** `c310cb8` (Task 1 commit)

**2. [Rule 2 - Missing Critical] router-capture.test.ts's mock lacked ReadOnlyAccessError/CollectionKeyUnavailableError/DirectShareNotEditableError, and had zero coverage of the new mapping**
- **Found during:** Task 2 (satisfying the acceptance criterion "router.ts's catch chain has 5 distinct mapped error branches for capture.confirm, not 4")
- **Issue:** `router-capture.test.ts`'s `./capture-handler` mock only exported `LockedVaultError`/`OwnershipMismatchError` — real re-implementations of the other three error classes were missing, and the new `DirectShareNotEditableError` mapping had no dedicated test (Task 2's own `<files>` list named `router.ts` but not `router-capture.test.ts`).
- **Fix:** Added real re-implementations of the three missing classes to the mock (mirroring `OwnershipMismatchError`'s own shape) and a new test proving the `DirectShareNotEditableError → {status:"error"}` mapping.
- **Files modified:** `extension/entrypoints/background/router-capture.test.ts`
- **Verification:** `npx vitest run router-capture` — 10 passed (was 9).
- **Committed in:** `6071a4d` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug/regression fix, 1 missing critical test coverage)
**Impact on plan:** Both were necessary consequences of correctly implementing the plan's own gate logic and acceptance criteria — no scope creep beyond what Task 1/2's own text required.

## Issues Encountered

- Initial implementation of `save-update-toast.ts`'s blocked branch followed the plan's literal "hide bodyEl/previewRow" wording, which left the (hidden) password-preview `<input>` present in the DOM with the submitted plaintext as its value. The new unit tests (`save-update-toast.test.ts`) written for Task 2 asserted genuine absence, surfacing this as a stricter — and, on reflection, more correct — requirement; the implementation was refined to never construct those elements at all for a blocked proposal, and the corresponding e2e assertions (`cdpClassIsHidden` → `cdpClassIsAbsent`) were updated to match.
- The new hidden_password COLLECTION item's baseline revision is `2`, not `1` (create-then-move-into-collection bumps revision once, mirroring `readOnlyItemId`'s own construction) — an initial e2e assertion expected `1` and failed against the real server; corrected to `2` with an explanatory comment.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `hidden_password`/direct-share write semantics are now consistent across web, extension, and server for both SHARE-02 and SHARE-03 — no known drift remains in this specific area.
- `persistUpdatedProviderItem`'s dormant fix means Plan 02/03's own scope (Blocker 3's 404-discriminant/suspension work, per 28-RESEARCH.md) is unaffected by this plan and can proceed independently — no shared file conflicts with Plans 02/03's own `<files>` lists.
- Full extension unit suite: 780 passed (baseline 768 + 12 new tests), 100% green. `tsc --noEmit` clean. `cargo test --workspace`: green (unaffected, no Rust files touched this plan).

---
*Phase: 28-close-v0-4-audit-gaps-client-side-consumption-of-sharing-sta*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 13 modified/created source files and the SUMMARY.md itself confirmed present on disk. All 3 task commit hashes (`c310cb8`, `6071a4d`, `0910164`) confirmed present in `git log`.
