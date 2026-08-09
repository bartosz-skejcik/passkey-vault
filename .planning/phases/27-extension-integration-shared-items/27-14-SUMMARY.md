---
phase: 27-extension-integration-shared-items
plan: 14
subsystem: extension-vault-sync
tags: [e2e, playwright, hidden-password, read-only, access-level, capture-handler, ReadOnlyAccessError, autofill, gap-closure]

requires:
  - phase: 27-07
    provides: "capture-handler.ts's ReadOnlyAccessError gate (unit-only evidence before this plan) -- this plan supplies the phase's first live proof that a read-only member's write is genuinely refused before any encrypt call"
  - phase: 27-08
    provides: "ItemDetailView.tsx's passwordFieldHidden fail-closed mask (component-test-only evidence before this plan, hand-supplied accessLevel) -- this plan supplies the phase's first live proof over a real hidden_password grant"
  - phase: 27-11
    provides: "the phase's own real-service-worker/CDP/capture-form-server live-proof harness patterns (getServiceWorker, cdpSession/cdpQuery/cdpClick/cdpClickAttr/waitForCdp, captureLoginPage) -- ported verbatim into this plan's new fixture and spec"
provides:
  - "setupAccessLevelFixture(): a real hidden_password DIRECT item share (no collection, sealItemKeyForRecipient) and a real read-access COLLECTION membership -- the two access levels whose entire purpose is restricting behavior, previously exercised by zero live fixture in this phase"
  - "dual-extension-access-levels.spec.ts (NEW): live proof that a hidden_password recipient can still autofill the real plaintext while getting NO reveal/copy affordance in the popup, and that a read-only recipient's real capture-confirm write is refused (ReadOnlyAccessError) with the collection owner's copy staying byte-identical"
  - "A live DOM-fill assertion for a shared item in dual-extension-sharing.spec.ts, closing EXT-07's previously-unverified fill-event gap (only the item's display/TOTP halves had live proof before this plan)"
  - "A service-worker-readiness fix in signInAndUnlock (both dual-extension-sharing.spec.ts and dual-extension-revocation.spec.ts), closing the diagnosed cold-MV3-wake race behind 27-VERIFICATION.md's Gap 5 flake (2/6 verifier attempts)"
affects: []

tech-stack:
  added: []
  patterns:
    - "signInAndUnlock now takes the owning BrowserContext as its first parameter and awaits getServiceWorker(context) as its very first line, before any chrome.runtime.sendMessage call -- closes the cold-MV3-service-worker-wake race that made dual-extension-sharing.spec.ts flaky (2/6 verifier attempts). Applied identically to both dual-extension specs sharing this duplicated helper shape; dual-extension-access-levels.spec.ts's own port ports the ALREADY-FIXED version."
    - "A hidden_password/read-only-restricted fixture item's urls field MUST point at a form-server origin actually reachable by the spec exercising it -- discovered live when the plan's own literal 'urls: [CAPTURE_FORM_ORIGIN]' instruction would have origin-mismatched against Task 3's own dedicated port-8898 server; fixed by introducing ACCESS_LEVELS_FORM_ORIGIN as a distinct, correctly-scoped constant."
    - "A confirmed-successful login fill via AutofillItemRow.tsx's doFill() closes the popup Page object (window.close(), real production UX) -- any live spec driving a fill through to completion on a popup it needs again afterward must check popup.isClosed() and reopen a fresh document (session stays unlocked across the reopen, no re-sign-in needed), mirroring dual-browser.spec.ts's own ensureVaultReady precedent."

key-files:
  created:
    - extension/e2e/dual-extension-access-levels.spec.ts
  modified:
    - extension/e2e/fixtures-account-setup.ts
    - extension/e2e/dual-extension-sharing.spec.ts
    - extension/e2e/dual-extension-revocation.spec.ts
    - .planning/REQUIREMENTS.md
    - .planning/STATE.md

key-decisions:
  - "ACCESS_LEVELS_FORM_ORIGIN (port 8898) is a NEW, distinct constant from CAPTURE_FORM_ORIGIN (port 8897, dual-extension-sharing.spec.ts's own dedicated server) -- the plan's own Task 1 action text literally named CAPTURE_FORM_ORIGIN for both new fixture items, which would have left them origin-mismatched against Task 3's own explicitly-required new port-8898 server (itemMatchesOrigin() requires an exact match; a mismatch would have silently broken both the hidden_password autofill proof and the read-only item's own resolution). Fixed live as a Rule 1 deviation rather than followed literally."
  - "AutofillItemRow.tsx's doFill() closes the popup Page object on a confirmed successful fill -- both this plan's own new fill blocks (Task 2's addition to dual-extension-sharing.spec.ts, and Task 3's own hidden_password autofill step) account for this: Task 2 reopens popupB (needed again for the no-TOTP-affordance/storage-audit/write-proof blocks that follow); Task 3's own fill step is the LAST popupB usage in that test, so no reopen is needed there."
  - "The read-only write-refusal's error signal is asserted via hasAttr(a, 'data-pv-toast-message') && !hasAttr(a, 'hidden') -- not mere node presence. save-update-toast.ts creates the message element (with hidden=true) at toast-mount time, before any confirm click, so a bare presence check would be vacuously true even on a SUCCESSFUL write. The hidden-attribute-removal check is the genuine, non-vacuous 'became visible' signal."
  - "The read-only write-refusal's copy-button-absence check is scoped to the password field's own row (via the honesty note's parent element), never a global count-0 -- a login item's username/notes fields DO have working copy buttons, so a global check would be trivially false. This mirrors the same anchoring discipline used for the reveal-button check (item name + honesty note asserted present first)."

patterns-established: []

requirements-completed: [EXT-07, KEY-01]

coverage:
  - id: D1
    description: "setupAccessLevelFixture(): a real hidden_password DIRECT item share and a real read-access COLLECTION membership, both via genuine crypto (sealItemKeyForRecipient/sealCollectionKey) and real REST calls"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-access-levels.spec.ts#hidden_password autofills without reveal/copy, and read-only writes are refused"
        status: pass
    human_judgment: false
  - id: D2
    description: "A hidden_password recipient's popup detail view masks the password with NO reveal and NO copy affordance (anchored: item name + honesty note asserted present first), while the SAME item still autofills the real plaintext onto a real page's DOM"
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-access-levels.spec.ts#hidden_password autofills without reveal/copy, and read-only writes are refused"
        status: pass
    human_judgment: false
  - id: D3
    description: "A read-only recipient's real capture-confirm write is refused via ReadOnlyAccessError (the toast's error signal becomes genuinely visible, not merely present in the DOM), and the collection owner's copy of the item stays byte-identical afterward"
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-access-levels.spec.ts#hidden_password autofills without reveal/copy, and read-only writes are refused"
        status: pass
    human_judgment: false
  - id: D4
    description: "EXT-07's fill EVENT itself (not merely the shared item's own display) is exercised live: a real click on the shared item's Fill button populates a real page's username/password inputs with the exact shared plaintext"
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared"
        status: pass
    human_judgment: false
  - id: D5
    description: "signInAndUnlock's service-worker-readiness fix, applied to both dual-extension-sharing.spec.ts and dual-extension-revocation.spec.ts, closes the diagnosed cold-MV3-wake race"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts (3 consecutive --retries=0 runs, all green) and extension/e2e/dual-extension-revocation.spec.ts (1 --retries=0 run, green)"
        status: pass
    human_judgment: false
  - id: D6
    description: "KEY-01's traceability row and REQUIREMENTS.md bullet reconciled from Partial to Complete, matching the extension client trigger 27-04/27-11 already shipped and proved live"
    requirement: "KEY-01"
    verification:
      - kind: other
        ref: ".planning/REQUIREMENTS.md's KEY-01 traceability table row and bullet text"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-08-09
status: complete
---

# Phase 27 Plan 14: Access-Level Gap Closure (hidden_password/read-only Live Proof, EXT-07 Fill Event, Flake Fix) Summary

**Closed 27-VERIFICATION.md's Gap 3 -- "the exact repeat shape of Phase 26's own two shipped-but-broken features" -- with one new live spec proving `hidden_password` still autofills with no reveal/copy affordance, and a real `read`-access write is refused via `ReadOnlyAccessError` with the owner's copy staying unchanged; also closed Gap 4 (EXT-07's fill event, previously only display/TOTP-proven) and Gap 5 (the diagnosed cold-service-worker-wake flake), and reconciled KEY-01's stale "Partial" bookkeeping.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-09
- **Tasks:** 3/3 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **Task 1 (fixture):** `setupAccessLevelFixture()` provisions a real `hidden_password` DIRECT item share (`sealItemKeyForRecipient`, no collection) and a real `read`-access COLLECTION membership -- the two access levels whose ENTIRE purpose is restricting behavior, and the exact gap 27-VERIFICATION.md named (every existing fixture in this phase granted `edit` only). `setupSharedFixture`'s own `sharedItemName` item gained a real `urls` entry and its id/username/password are now exposed, needed by Task 2's fill assertion.
- **Task 2 (EXT-07 fill event + Gap 5 flake fix):** `dual-extension-sharing.spec.ts` gained a live DOM-fill block after the TOTP proof -- a real click on the shared item's "Na tej stronie" Fill button populates a real page's `#u`/`#p` inputs with the exact shared plaintext, closing the fill-event evidence gap 27-VERIFICATION.md named for EXT-07 (only display/TOTP had live proof before). Both `dual-extension-sharing.spec.ts` and `dual-extension-revocation.spec.ts`'s `signInAndUnlock` now await a real service-worker-readiness barrier (`getServiceWorker(context)`) as their very first line, closing the diagnosed cold-MV3-wake race behind Gap 5 (2/6 verifier attempts failed at exactly this point). 3/3 consecutive green `--retries=0` runs of the sharing spec; 1/1 green `--retries=0` run of the revocation spec.
- **Task 3 (live hidden_password/read-only coverage + bookkeeping):** New `dual-extension-access-levels.spec.ts` proves, in one test: (1) a `hidden_password` recipient's popup detail view masks the password with NO reveal and NO copy affordance, anchored by first asserting the item's own name and the honesty note are genuinely present; (2) the SAME item still autofills the real plaintext onto a real page via a genuine DOM-fill drive; (3) a `read`-access recipient's real capture-confirm write is refused (the toast's error signal becomes genuinely visible, verified by hidden-attribute removal, not mere DOM presence) before any encrypt call; (4) the collection owner's copy of the item stays byte-identical afterward -- the real, load-bearing proof of refusal. `REQUIREMENTS.md`'s KEY-01 row and bullet reconciled from Partial to Complete. `STATE.md`'s Blockers/Concerns section records `capture-handler.ts`'s `buildLoginFields()` rename finding.
- Full extension unit suite: 762/762 green (unchanged from baseline). `npx tsc --noEmit`: clean throughout all three tasks.

## Task Commits

Each task was committed atomically:

1. **Task 1: setupAccessLevelFixture() -- real hidden_password + read-only fixtures** - `bb29be5` (test)
2. **Task 2: live EXT-07 fill-event proof + service-worker-readiness fix (Gap 4/5)** - `6ef8299` (test)
3. **Task 3: live hidden_password/read-only coverage + REQUIREMENTS.md/STATE.md bookkeeping** - `f93261f` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/e2e/fixtures-account-setup.ts` - `SharedFixtureResult` gains `sharedItemId`/`sharedItemUsername`/`sharedItemPassword`; `sharedItemName`'s item now carries a real `urls` entry; new `setupAccessLevelFixture()`/`AccessLevelFixtureResult`; new `ACCESS_LEVELS_FORM_PORT`/`ACCESS_LEVELS_FORM_ORIGIN` constants
- `extension/e2e/dual-extension-sharing.spec.ts` - `signInAndUnlock` gains the service-worker-readiness fix (context param); a live fill-event assertion block for the shared login item; a popup-reopen guard for the fill's own `window.close()` side effect
- `extension/e2e/dual-extension-revocation.spec.ts` - gains `getServiceWorker` (ported) and the same `signInAndUnlock` service-worker-readiness fix
- `extension/e2e/dual-extension-access-levels.spec.ts` (NEW) - the live hidden_password/read-only proof, its own dedicated port-8898 form server, all helpers ported verbatim from the already-fixed `dual-extension-sharing.spec.ts`
- `.planning/REQUIREMENTS.md` - KEY-01 bullet + traceability row reconciled to Complete
- `.planning/STATE.md` - `buildLoginFields()` rename finding recorded under Blockers/Concerns

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found live] Fixture items' `urls` field would have origin-mismatched against Task 3's own dedicated form server**
- **Found during:** Task 1/Task 3 boundary (discovered while authoring Task 3's own form server)
- **Issue:** The plan's Task 1 action text literally named `CAPTURE_FORM_ORIGIN` (port 8897, `dual-extension-sharing.spec.ts`'s own dedicated server) for both new fixture items' `urls` field. Task 3's own action text separately directs standing up a NEW dedicated server on port 8898 for this spec, explicitly because 8897 (among other ports) is "already claimed by sibling spec files." Following both instructions literally would have left `hiddenPasswordItemId`/`readOnlyItemId` pointing at an origin (8897) different from the one the new spec's own live browser actually navigates to (8898) -- `itemMatchesOrigin()` requires an exact match, so this would have silently broken the hidden_password autofill proof (no fill button would ever match) and the read-only item's own capture-confirm resolution (a submission at the wrong origin resolves as a brand-new item, not an update to the existing one, defeating the read-only-refusal test's entire premise).
- **Fix:** Added `ACCESS_LEVELS_FORM_PORT`/`ACCESS_LEVELS_FORM_ORIGIN` (port 8898) as new, distinct exported constants in `fixtures-account-setup.ts`, and pointed both new fixture items' `urls` fields at it instead of `CAPTURE_FORM_ORIGIN`.
- **Files modified:** `extension/e2e/fixtures-account-setup.ts`
- **Verification:** Both live sub-proofs (hidden_password autofill, read-only write resolution) pass with `--retries=0`, 2/2 consecutive runs.
- **Committed in:** `f93261f` (Task 3 commit)

**2. [Rule 1 - Bug, found live] The plan's own claim that popupB stays open across the new fill block does not hold**
- **Found during:** Task 2, first live run
- **Issue:** The plan's Task 2 action text asserted "popupB's subsequent `.getByText(...)` call still works after the reload() since the background session stays unlocked across a popup document reload" -- but `AutofillItemRow.tsx`'s `doFill()` calls `window.close()` on the POPUP ITSELF after a CONFIRMED successful login fill (real, intentional production UX, per `dual-browser.spec.ts`'s own `ensureVaultReady` doc comment: "A successful UI-driven 'Fill' gesture ... closes the popup window on success"). The plan's assumption held for the RELOAD (which happens BEFORE the fill click) but not for the CLOSE (which happens AFTER it) -- the next block in the existing test (`popupB.getByText(fixture.sharedItemName, ...).click()`) would have run against a closed Page.
- **Fix:** Added a guard immediately after the fill block: `if (popupB.isClosed()) { popupB = await extContextB.newPage(); ... }`, reopening a fresh popup document (no re-sign-in needed -- the background session stays unlocked across a document close/reopen, only the document itself is torn down). Changed `const popupB` to `let popupB` to allow the reassignment.
- **Files modified:** `extension/e2e/dual-extension-sharing.spec.ts`
- **Verification:** 3/3 consecutive green `--retries=0` runs after the fix.
- **Committed in:** `6ef8299` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 -- bugs found live during test authoring, both in the new/extended test files only, no production code touched)
**Impact on plan:** Both fixes were necessary for the live proofs to be genuine and non-vacuous rather than silently broken. No scope creep -- both stay entirely within this plan's own file list.

## Issues Encountered

- Running the full `chromium` Playwright project (`npx playwright test --project=chromium --retries=0`, no file filter) fails fast on `dual-browser.spec.ts`/`store-screenshots.spec.ts`'s missing `PV_UAT_PASSWORD`/`PV_DEMO_PASSWORD` env vars -- a documented, pre-existing environment gap unrelated to this plan (also hit and recorded by 27-11-SUMMARY.md). Ran every spec this plan modified individually instead: `dual-extension-sharing.spec.ts` (3/3 green), `dual-extension-revocation.spec.ts` (1/1 green), `dual-extension-access-levels.spec.ts` (2/2 green), plus `two-context-spike.spec.ts` as a cheap cross-spec sanity check (1/1 green). `dual-extension-ceremony.spec.ts` (headed, chromium-ceremony project) was not re-run since this plan touches neither its file nor the fixture function (`setupSharedPasskeyCollectionFixture`) it imports.

## User Setup Required

None - no external service configuration required. A local `pv-server` running with `PV_STATIC_DIR` pointed at `web/out` and `PV_EXTENSION_ORIGINS` set was already running for this session, matching this phase's own standing live-harness requirement (confirmed via `ps eww` before starting).

## Next Phase Readiness

- This closes gap-closure plans 12-14 from 27-VERIFICATION.md's `gaps_found` (10/14) verdict. Gap 3 (zero live coverage of `hidden_password`/read-only) and Gap 4 (EXT-07's fill event) are closed with genuine, non-vacuous live evidence. Gap 5 (the sign-in flake) is closed with 3 consecutive green `--retries=0` runs of the previously-flaky spec -- no masking retry was needed, so no "known flake" comment was added to the spec file.
- Gaps 1 (E2-error backstop, UI-SPEC) and 2 (MV3-wake partial picker, 27-06 backstop) were 27-12's and 27-13's own scope respectively, not this plan's -- 27-12 is already committed (`712043f`); 27-13's status is independent of this plan's own completion per its own frontmatter (`depends_on: []`).
- `capture-handler.ts`'s `buildLoginFields()` rename finding (accepted, out of scope, Phase 11 pre-existing) is now recorded in `STATE.md`'s Blockers/Concerns for a future phase, alongside the same finding 27-11-SUMMARY.md first surfaced.
- Full extension unit suite: 762/762 green. `npx tsc --noEmit`: clean.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: extension/e2e/dual-extension-access-levels.spec.ts
- FOUND: extension/e2e/fixtures-account-setup.ts
- FOUND: extension/e2e/dual-extension-sharing.spec.ts
- FOUND: extension/e2e/dual-extension-revocation.spec.ts
- FOUND: .planning/REQUIREMENTS.md
- FOUND: .planning/STATE.md
- FOUND commit: bb29be5
- FOUND commit: 6ef8299
- FOUND commit: f93261f
