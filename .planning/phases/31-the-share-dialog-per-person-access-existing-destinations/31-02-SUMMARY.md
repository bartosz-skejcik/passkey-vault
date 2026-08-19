---
phase: 31-the-share-dialog-per-person-access-existing-destinations
plan: 02
subsystem: ui
tags: [react, share-dialog, access-control, row-model, e2e, tdd]

# Dependency graph
requires:
  - phase: 31-01
    provides: "updateCollectionAccess/updateItemShare client wrappers over the new PUT routes"
provides:
  - "ShareDialog.tsx's per-row access model (RecipientRow, reconcileRowAction/reconcileRow) for BOTH folder (mint-new) and item scope"
  - "Item-scope full grant/update/revoke dispatch seeded from listItemShares"
  - "Folder-scope (mint-new) per-row grant dispatch via addCollectionMember, with update/revoke wired but structurally unreachable until 31-03's destination selector"
  - "Family-wide control isolated to its own isFamilyWideSelected-gated render branch, state/handlers byte-for-byte unchanged"
  - "Hidden-password disclosure re-anchored to rows (modal trigger + inline note subject)"
  - "Dialog shell restructured to the Scale & Scroll Contract (single scroll body, pinned footer)"
affects: [31-03, 31-04, 31-05, 31-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "reconcileRowAction (pure) + reconcileRow (async dispatcher taking grant/update/revoke ops) — the single decision+dispatch shape for 'what does this row's pendingLevel vs currentLevel imply', reused identically by both scopes"
    - "Discriminated-union submit signature ({isFamilyWide: true, recipients, level} | {isFamilyWide: false, rows}) replacing positional selected/level/isFamilyWide args on submitItemVariant/submitFolderVariant"
    - "hiddenPasswordRowTarget state disambiguates which completion handler (family-wide's unchanged handleHiddenPasswordAck/Cancel vs new handleRowHiddenPasswordAck/Cancel) the shared hidden-password-ack DialogState's buttons invoke"

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx (row model, reconcileRow, grantCollectionToRows, submitRowsForCollection, submitItemRows, isolated family-wide branch, Scale & Scroll shell)
    - web/src/components/vault/ShareDialog.test.tsx (row-model helpers/assertions, dispatch-count test, contributor-note regression guard)
    - web/src/lib/i18n/dictionary.ts (access.none, share.rowCurrentlyLabel, share.rowNoPublishedKey)
    - web/e2e/sharing.spec.ts (shareExistingFolderWithMember(s), SHARE-02 flow, item-revoke setup — all row-driven)
    - web/e2e/shared-sync.spec.ts (row-driven grant setup)
    - web/e2e/export-disclosure.spec.ts (row-driven grant + hidden-password setup)
    - web/e2e/family-wide-sharing.spec.ts (mutual-exclusivity assertion rewritten against row-list absence)
    - .planning/phases/31-.../31-VALIDATION.md (31-02-T1 row marked done)

key-decisions:
  - "Family-wide isolation done via a NEW hiddenPasswordRowTarget disambiguator, not by modifying handleSelectAccessLevel/handleHiddenPasswordAck/handleHiddenPasswordCancel — those three functions and accessLevel/setAccessLevel/previousAccessLevel are byte-for-byte unchanged from before this plan; only the JSX render condition around the radio group and the Ack/Cancel buttons' onClick target changed."
  - "submitItemVariant/submitFolderVariant's signatures changed from positional (selected, level, isFamilyWide) to a discriminated union — an internal-only refactor (no test asserts the function signature itself), needed because the row path carries per-row levels instead of one shared level; the family-wide branch's OWN behavior and the literal accessLevel value it reads are unchanged."
  - "Folder-scope's row dispatch (submitRowsForCollection) wires update/revoke via updateCollectionAccess/revokeCollectionAccess even though unreachable this plan (currentLevel is always null for a mint-new folder) — a generically-correct function per the plan's own instruction, not a stub, so 31-03 only needs to change how currentLevel is seeded."
  - "Item-scope grant dispatch reuses shareItemWithRecipients (the exact composition ShareDialog.real-wasm.test.ts exercises) called once per grant-action row at that row's own level, rather than widening its shared-level signature."

requirements-completed: [MOD-01, MOD-03]

coverage:
  - id: D1
    description: "Both scopes (folder mint-new, item — including items with real pre-existing shares) render one standing row per family member with its own level control, replacing the shared checkbox+radio UI entirely"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx — 'item variant'/'folder-create variant' describe blocks, row-select assertions"
        status: pass
      - kind: e2e
        ref: "sharing.spec.ts SHARE-01/SHARE-02/SHARE-06, shared-sync.spec.ts, export-disclosure.spec.ts — all row-driven live"
        status: pass
    human_judgment: false
  - id: D2
    description: "Family-wide keeps exactly one, now-isolated source of level truth — its own radio group/state/handlers render and are read ONLY when isFamilyWideSelected, never shared with the row model"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx 'family-wide item contributor-edit note survives Blocker 1's isolation (regression guard)'"
        status: pass
      - kind: e2e
        ref: "family-wide-sharing.spec.ts (11 tests, unmodified assertions except the mutual-exclusivity locator)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Item-scope level EDIT dispatches exactly one updateItemShare call, never a revoke-then-re-add pair — the dispatch-count property 31-06-T2 cites instead of re-deriving at the e2e layer"
    requirement: "MOD-01"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx#'a row transitioning read -> edit on an item that already has a share issues EXACTLY ONE updateItemShare call...' — falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Hidden-password one-time modal fires the first time ANY row (either scope) transitions to hidden_password, and the always-visible inline note's subject re-derives from rows currently at that level — MOD-03 never goes dark mid-migration"
    requirement: "MOD-03"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx 'hidden-password disclosure (D-2/UX-03, E4, re-anchored to rows per 31-02-PLAN.md)' describe block (6 tests)"
        status: pass
      - kind: e2e
        ref: "sharing.spec.ts SHARE-02, export-disclosure.spec.ts hidden_password export test"
        status: pass
    human_judgment: false
  - id: D5
    description: "family-wide-sharing.spec.ts:373-376's mutual-exclusivity assertion migrated off checkboxes (which would resolve to zero elements and pass vacuously) onto a real proof against the row model"
    requirement: "MOD-01"
    verification:
      - kind: e2e
        ref: "family-wide-sharing.spec.ts SC2 test (exercises shareFolderFamilyWide) — falsification-proven (see below)"
        status: pass
    human_judgment: false

# Metrics
duration: ~3h
completed: 2026-08-18
status: complete
---

# Phase 31 Plan 02: Migrate ShareDialog to the per-row access model (both scopes) Summary

**One merged task: `ShareDialog.tsx`'s shared checkbox-list + single global access-level radio is gone, replaced by 31-UI-SPEC.md's per-row model for BOTH the folder (mint-new) and item scope at once, family-wide isolated to its own render branch, hidden-password disclosure re-anchored to rows, and the dialog shell restructured to a single-scroll-region + pinned-footer layout — with all four ShareDialog-driving e2e specs migrated and the whole pre-existing suite green.**

## Performance

- **Duration:** ~3h
- **Completed:** 2026-08-18 (single session)
- **Tasks:** 1/1
- **Files modified:** 8 (1 component, 1 unit test file, 1 dictionary, 4 e2e specs, 1 validation doc)

## Accomplishments

- `RecipientRow`/`reconcileRowAction`/`reconcileRow` (module-level, exported) are the single decision-and-dispatch shape for "what does this row's `pendingLevel` vs `currentLevel` imply, and what network call follows" — the ONLY source of truth the actual dispatch reads, per T-31-06's trust boundary.
- Item scope: rows seed `currentLevel` from `listItemShares(item.id)` (a genuinely new display — the old dialog never showed an item's pre-existing direct shares at all) and dispatch full grant (`shareItemWithRecipients`, one call per grant-action row at that row's OWN level) / update (`updateItemShare`, 31-01's PUT wrapper) / revoke (`revokeItemShare`).
- Folder scope (mint-new only this plan): rows always start at `currentLevel: null`; `grantCollectionToRows` grants each row at its own level via `addCollectionMember`. `submitRowsForCollection`'s update/revoke branches (`updateCollectionAccess`/`revokeCollectionAccess`) are wired and generically correct, structurally unreachable until 31-03 adds a destination selector.
- Family-wide's radio group + `share.accessLevelLabel` heading now render ONLY inside an `isFamilyWideSelected` conditional — `accessLevel`/`setAccessLevel`/`previousAccessLevel`/`handleSelectAccessLevel`/`handleHiddenPasswordAck`/`handleHiddenPasswordCancel` are byte-for-byte unchanged from before this plan; only the render condition and (for the shared Ack/Cancel buttons) which handler gets invoked are new, disambiguated by a new `hiddenPasswordRowTarget` state.
- The hidden-password one-time blocking modal fires the first time ANY row transitions to `hidden_password` (via new `handleRowLevelChange`/`handleRowHiddenPasswordAck`/`handleRowHiddenPasswordCancel`), and the row-scoped inline note's subject derives from "rows currently at `hidden_password`" — never `selectedRecipientIds`, which no longer exists.
- Dialog shell: the card is now `max-h-[85vh] flex-col`, with a single `overflow-y-auto` scrolling body and a `shrink-0 border-t` pinned footer holding Cancel/Save — no nested `max-h-48` scroller for the row list.
- All four ShareDialog-driving e2e specs (`sharing.spec.ts`, `shared-sync.spec.ts`, `export-disclosure.spec.ts`, `family-wide-sharing.spec.ts`) migrated to drive the row `<select>`s instead of the checkbox+radio pair; `family-wide-sharing.spec.ts`'s mutual-exclusivity assertion rewritten against the row list's structural absence (not merely "disabled") once family-wide is checked.

## Task Commits

- **Task 1 (single commit — see Deviations for why):** `feat(31-02): migrate ShareDialog to the per-row access model for both scopes` — `a40dd94`

## Files Created/Modified

- `web/src/components/vault/ShareDialog.tsx` — row model types/dispatch, `grantCollectionToRows`, `submitRowsForCollection`, `submitItemRows`, isolated family-wide branch, Scale & Scroll shell, `buildRows` (existing-access-first, alphabetical-within-group ordering)
- `web/src/components/vault/ShareDialog.test.tsx` — `setRowLevel` helper replaces `selectRecipient`; `chooseAccessLevel` retained for the family-wide-only radio; every family-wide test reordered to check family-wide BEFORE choosing a level (the radio no longer exists until then); new dispatch-count test; new contributor-edit-note isolation regression guard; hidden-password describe block rewritten around row-triggered flow
- `web/src/lib/i18n/dictionary.ts` — `access.none`, `share.rowCurrentlyLabel`, `share.rowNoPublishedKey` (verbatim per 31-UI-SPEC.md; `access.readOnly`/`access.fullEdit`/`access.hiddenPassword` untouched)
- `web/e2e/sharing.spec.ts` — `shareExistingFolderWithMember(s)` helpers, SHARE-02's inline flow, and the item-revoke test's grant step, all row-driven
- `web/e2e/shared-sync.spec.ts` — grant setup row-driven
- `web/e2e/export-disclosure.spec.ts` — grant + hidden-password setup row-driven
- `web/e2e/family-wide-sharing.spec.ts` — mutual-exclusivity assertion rewritten (see Falsifications)
- `.planning/phases/31-.../31-VALIDATION.md` — 31-02-T1 row marked done

## Decisions Made

- **Family-wide isolation via a disambiguator state, not by branching inside the protected functions.** Non-negotiable 1 requires `handleSelectAccessLevel`/`handleHiddenPasswordAck`/`handleHiddenPasswordCancel` to stay byte-for-byte unchanged. Since the SAME shared `hidden-password-ack` `DialogState` now has two possible triggers (family-wide's radio, or any row), a new `hiddenPasswordRowTarget: string | null` state records which one fired; the Ack/Cancel buttons' `onClick` picks `handleRowHiddenPasswordAck`/`Cancel` (new, sibling functions) when it is set, and the untouched `handleHiddenPasswordAck`/`Cancel` otherwise. This satisfies the letter and spirit of the non-negotiable — the protected functions' own bodies never changed — while still supporting the row model's own hidden-password gate.
- **`submitItemVariant`/`submitFolderVariant` signatures changed to a discriminated union.** No test in this file asserts these internal function signatures directly (they are called only from `handleSubmit`), so this was free to change; it was necessary because the row path no longer has one shared `level` to pass positionally. The family-wide branch inside each still reads the literal `accessLevel` state value exactly as before — the value flow is unchanged, only the parameter shape carrying it is.
- **Every family-wide-mode unit test needed reordering (check family-wide, THEN choose a level), not zero edits.** The plan states these tests "should still pass with zero edits" — this held for their ASSERTIONS, but literally could not hold for call ORDER, since the shared radio no longer exists in the DOM until `isFamilyWideSelected` is true. All ~15 such tests were mechanically reordered (verified this is order-independent for what each test actually proves); documented here as the honest exception to "zero edits," not a silent deviation.
- **Two unit tests inside the "family-wide row" describe block were migrated, not left unchanged**, despite nominally being "family-wide-mode" tests: "checking the family-wide row disables every per-person row's own select" and its reverse-direction sibling. Both referenced the OLD individual-recipient checkbox (`input[type=checkbox]` under `share-recipient-${id}`), which the row model deletes — left unmigrated, they would have resolved to zero elements and passed vacuously, exactly the trap the plan names for the e2e layer. Rewritten against the row model: family-wide checked → the row list is structurally absent (a stronger guarantee than "disabled"); a row set to a real level → family-wide's own checkbox becomes disabled (`anyRowActive`).
- **WR-04's "zero selected → generic fallback" sub-case has no analog in the row model** (selecting `hidden_password` on a row IS selecting exactly one row — there is no "level chosen, nobody selected" state). Re-derived as: the note is entirely ABSENT until a row is genuinely at that level (a stronger honesty property — never rendered subject-less because never rendered with no subject), with the single-subject and multi-subject-generic halves of the original property both still asserted.

## Deviations from Plan

### Non-deviations recorded for clarity

**Single commit, not RED/GREEN-separated TDD commits.** The task is `tdd="true"`, but this plan is a large, interdependent migration of an existing 1400+-line component plus its full test suite plus four e2e specs — there is no clean single RED state to commit (removing the old markup breaks dozens of pre-existing tests simultaneously, not one new failing test). TDD discipline was applied at the assertion level instead: the two NEW tests this plan specifically requires (dispatch-count, mutual-exclusivity rewrite) were each falsification-proven — implementation reverted to a broken form, observed genuinely red with exact output recorded, restored, confirmed green — per Non-negotiable 4. This is the same TDD *evidence* bar in spirit; the git history reflects one coherent atomic change rather than an artificial two-commit split that would leave an intermediate commit with dozens of known-broken tests.

**No auto-fixed bugs, no architectural deviations.** Every code path matches the plan's `<action>` text: family-wide isolation as a render-condition change, per-row grant/update/revoke dispatch via `reconcileRow`, hidden-password re-anchored to rows, Scale & Scroll shell restructured, all four e2e specs migrated, zero tests deleted or weakened (two tests were REWRITTEN where their old form was structurally impossible to satisfy in the row model — the WR-04 zero-selected case and the two family-wide-row checkbox tests — each documented above with the replacement property it now proves).

## Falsifications (mandatory, exact observed output)

**1. Dispatch-count test (item-scope update branch, T-31-06/Blocker 7).** Temporarily replaced `submitItemRows`'s `update` op with a revoke-then-re-add pair (`revokeItemShare` then `shareItemWithRecipients`), re-ran the new test alone:

```
FAIL  src/components/vault/ShareDialog.test.tsx > ShareDialog > item-scope reconcileRow dispatch-count (31-02-PLAN.md, T-31-06) > a row transitioning read -> edit on an item that already has a share issues EXACTLY ONE updateItemShare call and ZERO createItemShare/revokeItemShare calls for that userId
AssertionError: expected "spy" to be called 1 times, but got 0 times
 ❯ src/components/vault/ShareDialog.test.tsx:960:35
    958|
    959|       await waitFor(() => expect(onShared).toHaveBeenCalled());
    960|       expect(mockUpdateItemShare).toHaveBeenCalledTimes(1);
```

Restored the single `updateItemShare` call; reran `npm test -- ShareDialog` — 55/55 unit tests green again.

**2. `family-wide-sharing.spec.ts`'s rewritten mutual-exclusivity assertion.** Temporarily made the row list render unconditionally (`isFamilyWideSelected ? null :` → `false ? null :`), re-ran the live SC2 test (which exercises `shareFolderFamilyWide`) against a freshly built server:

```
Error: family-wide is a MODE, not a recipient list -- the per-person row list must be mutually exclusive with it
expect(locator).toHaveCount(expected) failed
Locator:  getByTestId('share-recipient-list')
Expected: 0
Received: 1
```

Restored the `isFamilyWideSelected ? null :` render condition; reran `npm run compile` (clean) and the full four-spec live suite — 21/21 passed again (see Verification).

## Issues Encountered

None beyond the scope of the deviations already documented.

## Verification

Exact results and exit codes of every CI-width command, run in order after the falsifications above were restored:

1. `cd web && npm run compile` — **exit 0**, `tsc --noEmit` clean.
2. `cd web && npm test` — **exit 0**, `Test Files 92 passed (92)`, `Tests 977 passed (977)`.
3. `cd web && npm run build` — **exit 0**, `next build` compiled successfully, TypeScript pass, all 5 static pages generated.
4. `cd web && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0` — **exit 0**, `21 passed (1.5m)`, zero skipped, zero flaky. Covers WR-09 (real folder name), Backstop #6 (real browser layout), KEY-01 (fingerprint publish), SHARE-01/SHARE-02/SHARE-06 (grant/revoke/hidden-password proofs), and every family-wide-mode live test (SC2/SC3/revocation/timing-copy/item-variant) unmodified except the mutual-exclusivity locator.

No test deleted or weakened to reach green — every migrated/rewritten test documented above proves an equivalent or stronger property than the one it replaced.

## Next Phase Readiness

Both scopes now share the row model at their currently-reachable capability: folder mint-new grants per row (update/revoke wired but unreachable until 31-03's destination selector seeds real `currentLevel` values), item scope dispatches full grant/update/revoke against pre-existing shares. `reconcileRow`/`reconcileRowAction`/`submitRowsForCollection`/`grantCollectionToRows` are exported/module-level and ready for 31-03 to extend without re-deriving the dispatch shape. The hidden-password disclosure and family-wide isolation are both stable now, so 31-03 through 31-06 build on a dialog that is internally consistent rather than mid-migration.

**Note for the next plan/verifier (mirrors 31-01's own note):** `requirements.mark-complete MOD-01, MOD-03` (run per this plan's `requirements` frontmatter) will mark both `[x]` in `REQUIREMENTS.md`. This is again premature in isolation — MOD-01's destination-selector half (existing folders, not just mint-new) is 31-03's job, and MOD-03's SC4 (the strengthened hidden-password inline wording) is 31-05's job. The phase-level verifier at `/gsd-verify-work` should re-confirm both against the FULL phase's shipped UI, not treat this checkbox as sufficient evidence on its own.

## Self-Check: PASSED

All 8 modified files verified present on disk with the expected changes (`git show a40dd94 --stat`). Commit hash `a40dd94` verified present in `git log`.

---
*Phase: 31-the-share-dialog-per-person-access-existing-destinations*
*Completed: 2026-08-18*
