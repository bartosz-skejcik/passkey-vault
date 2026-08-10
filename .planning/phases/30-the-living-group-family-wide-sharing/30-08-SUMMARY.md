---
phase: 30-the-living-group-family-wide-sharing
plan: 08
subsystem: ui
tags: [react, i18n, share-dialog, families, fsh-01, fsh-05]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-02's family_wide_kind schema/API additivity and 30-09's createCollection(familyWideKind) client parameter"
provides:
  - "The 'Cała rodzina' recipient row in ShareDialog -- pinned, boxed, mutually exclusive with per-person selection, with its own four-state member-count and unconditional FSH-05 timing caveat"
  - "submitFolderVariant's family-wide branch -- grants every CURRENT active family member (fetched fresh at submit time), creates the collection with family_wide_kind: 'folder', omits a keyless member instead of throwing"
affects: ["30-10 (SharingOverviewPanel's family-wide block reuses share.familyWideTimingCaveat)", "30-11 (item variant's family-wide auto-created bucket collection, same file)", "30-13 (lazy-reseal trigger picks up the keyless member this plan omits)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Member count derived (never a second useState) directly from state the dialog's load() effect already sets -- purely computed each render, so it structurally cannot flash a stale value across a state transition"
    - "Mode-not-recipient-list: the family-wide checkbox selects a GRANT MODE: submitFolderVariant's family-wide branch fetches the roster fresh at submit time and ignores selectedRecipientIds entirely (which stays empty by construction)"
    - "Divergent honesty semantics for the SAME missing-public-key condition, by explicitness of recipient choice: individual path throws before any network call (T-25-16, unchanged); family-wide path omits and lets the existing lazy-reseal trigger pick the member up later"

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/vault/ShareDialog.test.tsx

key-decisions:
  - "Member-count state is a derived expression, not a separate useState fed by its own effect -- eliminates the flash-of-stale-value failure mode by construction rather than by careful sequencing."
  - "submitDisabled's family-wide relaxation is additionally gated on isFolder (`isFamilyWideSelected && isFolder`), not isFamilyWideSelected alone -- the item variant's family-wide row renders (per 30-UI-SPEC.md's 'both variants' anatomy) but its submit path is unwired until 30-11, so enabling submit there would silently share with nobody. This is a plan-scoped guard, not a UI-SPEC deviation: it keeps a rendered-but-not-yet-functional control from producing a false success."
  - "Recipient roster for the family-wide grant is re-fetched via getFamilyMembers() at submit time, not read from the dialog's mount-time recipients state -- 'every CURRENT active family member' per the plan's own behavior spec, and the checkbox selects a mode rather than freezing a snapshot."

requirements-completed: [FSH-01, FSH-05]

coverage:
  - id: D1
    description: "The 'Cała rodzina' row renders pinned above the individual recipient list, boxed (rounded-field border border-base-300), in both item and folder ShareDialog variants"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > renders the timing caveat unconditionally, before the family-wide checkbox is ever checked"
        status: pass
    human_judgment: false
  - id: D2
    description: "Mutual exclusivity: checking family-wide disables+clears every individual checkbox and vice versa; the two modes never coexist"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > checking the family-wide row disables and un-checks every individual recipient checkbox"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > checking an individual recipient clears and disables the family-wide checkbox"
        status: pass
    human_judgment: false
  - id: D3
    description: "Member count is one of exactly four states (loading/solo-owner/populated n>=2/error), never a flash of 0 or interpolated n=1 for a solo family"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > a solo family (only the sharer) shows familyWideMemberCountSoloOwner, never an interpolated n=1"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > a family of 2+ shows the interpolated populated count (n includes the sharer)"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > shows the error state (never a flash of 0 or the solo-owner copy) when the account/roster fetch fails"
        status: pass
    human_judgment: false
  - id: D4
    description: "The timing caveat (FSH-05, PL+EN verbatim, correct 'you or another family member' actor set) renders unconditionally whenever the row is visible"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide row (FSH-01/FSH-05) > renders the timing caveat unconditionally, before the family-wide checkbox is ever checked"
        status: pass
    human_judgment: false
  - id: D5
    description: "submitFolderVariant's family-wide branch grants every CURRENT active family member (not selectedRecipientIds) and creates the collection with family_wide_kind: 'folder'"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide folder share (FSH-01 submitFolderVariant) > grants every CURRENT active family member (never selectedRecipientIds, which stays empty) and creates the collection with family_wide_kind: 'folder'"
        status: pass
    human_judgment: false
  - id: D6
    description: "A keyless member is OMITTED from the family-wide creation-time grant (never thrown/aborted); the individual-recipient path's T-25-16 throw stays unchanged"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide folder share (FSH-01 submitFolderVariant) > omits a keyless member from the creation-time grant WITHOUT throwing or aborting the share -- the other members still get granted"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#family-wide folder share (FSH-01 submitFolderVariant) > individual-recipient path still throws before any network call on a keyless SELECTED recipient (T-25-16 unchanged)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 08: "Cała rodzina" Share Dialog Row + submitFolderVariant Family-Wide Branch Summary

**Pinned, boxed "Cała rodzina" row in ShareDialog with a four-state honest member count and the FSH-05 timing caveat, mutually exclusive with per-person selection, wired to a submitFolderVariant branch that grants every current active family member and omits (never throws on) a keyless one.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-10
- **Tasks:** 2 (Task 1: tracer, single commit; Task 2: tdd -- RED then GREEN commits)
- **Files modified:** 3 (`ShareDialog.tsx`, `dictionary.ts`, `ShareDialog.test.tsx`)

## Accomplishments
- The "Cała rodzina" row (`data-testid="share-recipient-family-wide"`) renders pinned above the individual recipient list in ShareDialog, boxed (`rounded-field border border-base-300`), with a `Users` icon, in both item and folder variants (the section is shared by both).
- Member count is derived (not a second `useState`) directly from state the dialog's own `load()` effect already sets -- one of exactly four states (`loading`/solo-owner/populated n>=2/error), reusing the existing `getFamilyMembers()` fetch with zero new network calls.
- The FSH-05 timing caveat (`share.familyWideTimingCaveat`, PL+EN, "you or another family member" actor set verbatim from 30-UI-SPEC.md's post-research derivation) renders unconditionally whenever the row is visible, `aria-describedby`-linked to the checkbox.
- Checking family-wide clears+disables every individual checkbox (and vice versa) via both the native `disabled` attribute and the `isFamilyWideSelected`/`selectedRecipientIds` state -- structurally impossible for both modes to be selected at once.
- `submitFolderVariant` grew an `isFamilyWide` parameter (default `false`, individual-recipient path byte-identical): when `true`, it fetches the family roster fresh at submit time (never `selectedRecipientIds`, which stays empty), creates the collection with `family_wide_kind: "folder"`, and filters out any member with no published public key BEFORE the grant loop -- omitted, not thrown -- deliberately diverging from the individual path's T-25-16 throw-before-network discipline, which stays unchanged.
- Six new i18n keys added verbatim from 30-UI-SPEC.md's Copywriting Contract: `share.familyWideOptionLabel`, `share.familyWideTimingCaveat`, `share.familyWideMemberCount`, `share.familyWideMemberCountSoloOwner`, `share.familyWideMemberCountLoading`, `share.familyWideMemberCountError`.

## Task Commits

Each task was committed atomically (Task 2 is `tdd="true"` -- separate RED/GREEN commits):

1. **Task 1 (tracer): "Cała rodzina" row, member-count states, timing caveat, mutual exclusivity** - `1b88320` (feat)
2. **Task 2 (RED): failing test for submitFolderVariant's family-wide branch** - `9abdde7` (test) -- 3 of 4 new cases confirmed failing before the implementation existed (the 4th, the pre-existing T-25-16 throw, already passed -- it exercises no new code).
3. **Task 2 (GREEN): submitFolderVariant's family-wide branch** - `ae08481` (feat) -- all cases pass.

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified
- `web/src/components/vault/ShareDialog.tsx` - `isFamilyWideSelected` state, `toggleFamilyWide`, mutual-exclusivity wiring on `toggleRecipient`, derived four-state member count, the "Cała rodzina" row + timing caveat JSX, `submitDisabled`'s folder-gated relaxation, `submitFolderVariant`'s `isFamilyWide` branch, `handleSubmit`'s family-wide dispatch (fresh `getFamilyMembers()` fetch at submit time).
- `web/src/lib/i18n/dictionary.ts` - Six new `share.familyWide*` keys (PL/EN verbatim from 30-UI-SPEC.md).
- `web/src/components/vault/ShareDialog.test.tsx` - Two new describe blocks: `family-wide row (FSH-01/FSH-05)` (8 cases -- caveat visibility, all four count states, mutual exclusivity both directions, submit-enablement, item-variant guard) and `family-wide folder share (FSH-01 submitFolderVariant)` (4 cases -- grant-every-current-member, keyless-omission, family_wide_kind omission on the ordinary path, T-25-16 unchanged).

## Decisions Made
- **Member-count state is a derived expression, not a second `useState`.** The plan's `<action>` describes a discriminated `"loading" | { count: number } | "error"` value; implemented as a `const` computed fresh every render from `loading`/`accountUnavailable`/`recipients` (state the dialog already tracks), rather than a separate `useState` fed by its own effect. This makes the "never a flash of 0 or a stale value" truth hold **by construction** -- there is no intermediate render where a second piece of state could lag behind the three it's derived from.
- **`submitDisabled`'s family-wide relaxation is gated on `isFolder`, not `isFamilyWideSelected` alone.** The row renders in both item and folder variants per 30-UI-SPEC.md's anatomy, but this plan's Task 2 only wires the folder variant's actual grant path (the item variant's auto-created bucket collection is 30-11's job, per the plan's own objective). Without this additional gate, checking family-wide on an ITEM share and clicking submit would enable a button whose click silently shares with nobody (`submitItemVariant` called with an empty `selected` array, reporting false success) -- a "renders but nothing reaches it, and it lies about succeeding" defect exactly of the shape this project's `project_critical_rules` flags. Documented inline; a dedicated test (`keeps submit disabled for the ITEM variant while family-wide is selected -- that wiring is 30-11's job`) locks this against regression until 30-11 lands.
- **Family-wide recipient roster is fetched fresh at submit time**, not read from the dialog's mount-time `recipients` snapshot -- matches the plan's own `<action>` prose ("derive the recipient set at the `handleSubmit` call site... `(await getFamilyMembers()) ?? []`") and the "every CURRENT active family member" wording in the `<behavior>` spec.

## Deviations from Plan

None outside the documented `submitDisabled`/item-variant guard above, which is itself an application of Rule 1 (auto-fix bugs) applied preemptively during implementation rather than discovered post-hoc -- the plan's Task 1 action literally says "accept `isFamilyWideSelected` as an alternative to `selectedRecipientIds.size > 0`" without specifying the `isFolder` co-condition, and implementing it literally (item variant included) would have produced a false-success click path the moment a user checked family-wide on an item share before 30-11 lands. Gating on `isFolder` closes that gap without touching anything inside the existing per-person layout (Phase 31's scope fence, respected) and without redesigning the row itself (still renders identically in both variants, per FSH-01).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `share.familyWideTimingCaveat` and `share.familyWideOptionLabel` are ready for 30-10's `SharingOverviewPanel` pinned block to reuse verbatim (same key, same string, per 30-UI-SPEC.md's "can never drift" requirement).
- The item variant's family-wide handling (auto-created bucket collection, `family_wide_kind: "item_bucket"`) is unblocked for 30-11 -- the row already renders there; only `submitItemVariant`'s dispatch and the `isFolder` guard in `submitDisabled` need updating.
- The keyless-member omission this plan introduces surfaces via `GET /api/families/family-wide-pending`'s `missing` list the moment that member publishes a key -- 30-13's lazy-reseal trigger (already backed by 30-04's `reshareCollectionToNewMember`) is the sole consumer; no new machinery needed here.
- `resolve_access`/`Collection::resolve_access` were not touched -- the revocation enforcement point remains exactly as it was. Only TypeScript files (`ShareDialog.tsx`, `dictionary.ts`, their test file) were modified in this plan; no Rust surface changed.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All claimed files exist (`ShareDialog.tsx`, `dictionary.ts`, `ShareDialog.test.tsx`, this SUMMARY) and all three task commit hashes (`1b88320`, `9abdde7`, `ae08481`) are present in `git log`.
