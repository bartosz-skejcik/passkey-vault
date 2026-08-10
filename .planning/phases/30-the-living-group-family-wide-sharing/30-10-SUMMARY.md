---
phase: 30-the-living-group-family-wide-sharing
plan: 10
subsystem: ui
tags: [react, i18n, sharing-overview, families, fsh-05]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-02's family_wide_kind field on CollectionRow, and 30-08's share.familyWide* i18n keys (familyWideOptionLabel, familyWideTimingCaveat, familyWideMemberCount/SoloOwner/Loading/Error)"
provides:
  - "The pinned sharing-overview-family-wide block in SharingOverviewPanel -- a single block (not a third tab, not a per-share row set) above sharing-overview-tabs, showing the live member count, the FSH-05 timing caveat, and a flat list of family-wide folders/items"
affects: ["Phase 34 (VIS-02/VIS-03 -- the item-badge/individually-shared-item gaps this block deliberately does not touch)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Family-wide share list and member count resolved together in the panel's existing load() effect and applied to state in ONE batched update, so 'both resolved before render' holds by construction rather than by careful sequencing"
    - "item_bucket items decrypted via the same unsealCollectionKey/decryptItemForCollection + recombineEncryptedItem idiom RemoveMemberDialog.tsx's resolveFolder already established, reused rather than reinvented"

key-files:
  created: []
  modified:
    - web/src/components/vault/SharingOverviewPanel.tsx
    - web/src/components/vault/SharingOverviewPanel.test.tsx

key-decisions:
  - "familyWideCollections is derived from rawCollections.filter(family_wide_kind !== null) with NO additional edit-access filter, per the plan's literal <action> text -- a family-wide share's audience IS the family (UI-SPEC's own framing: 'the audience IS the family, described once by the count line above'), so every family member who holds a collection_keys row for a family-wide collection sees the block, not only whoever happens to hold edit access on it."
  - "Folder names are resolved via a lookup into the ALREADY-decrypted useCollections() store (cross-referenced by id against rawCollections, the same idiom editableCollections already uses) rather than a second raw enc_name decrypt -- no new WASM call for the folder branch."
  - "item_bucket items are decrypted per-item (never one entry for the whole bucket), reusing RemoveMemberDialog.tsx's resolveFolder/recombineEncryptedItem pattern verbatim rather than inventing a new decrypt path."
  - "The block's own visibility gate (familyWideShares !== null && count !== 'loading' && length > 0) and its two resolved state variables are both written from the SAME load() effect's single final setState batch (never reset to an intermediate value on a background re-run), so the 'no half-resolved flash' truth holds structurally, not by timing luck."

requirements-completed: [FSH-05]

coverage:
  - id: D1
    description: "The pinned sharing-overview-family-wide block renders above sharing-overview-tabs only when the caller has >= 1 family-wide share, never a '0 family-wide shares' heading"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > renders no sharing-overview-family-wide element when the caller has zero family-wide collections"
        status: pass
    human_judgment: false
  - id: D2
    description: "A family-wide folder and a family-wide item_bucket (2 items) render as 3 flat <li> entries -- the bucket is never rendered as a single folder row -- with no revoke-shaped testid anywhere inside the block"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > renders exactly 3 <li> entries -- 1 family-wide folder + 2 item_bucket items -- with no revoke-shaped testid anywhere inside"
        status: pass
    human_judgment: false
  - id: D3
    description: "A getCollectionItems rejection for the bucket renders the block with the folder entry present and the bucket's entries simply absent -- not a crash"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > a getCollectionItems rejection for the bucket renders the block with the folder entry present and the bucket's entries simply absent -- not a crash"
        status: pass
    human_judgment: false
  - id: D4
    description: "Each family-wide share's name truncates rather than overflowing, matching the existing folder-row truncate pattern"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > a realistic long family-wide share name truncates inside the list, matching the existing folder-row truncate pattern"
        status: pass
    human_judgment: false
  - id: D5
    description: "Member count is one of exactly four states (solo-owner/populated/error visible in this surface; loading is structurally unreachable since the block waits for both resolutions) -- never an interpolated n=1"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > a family of 1 (solo owner) shows familyWideMemberCountSoloOwner in the block's count line, never an interpolated n=1"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > a family of 2+ shows the interpolated populated count (n includes the sharer)"
        status: pass
    human_judgment: false
  - id: D6
    description: "familyWideMemberCountError renders in place of the count on a roster fetch failure, with no retry control; the (static) timing caveat still renders regardless"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#Task 1 (30-10) -- pinned family-wide block > familyWideMemberCountError renders in place of the count on a roster fetch failure, with the (static) timing caveat still rendering"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 10: Pinned Family-Wide Block in SharingOverviewPanel Summary

**A single pinned `sharing-overview-family-wide` block above the folder/person tab switcher, showing the live member count (ShareDialog's own four-state discriminant, reused) and the SAME `share.familyWideTimingCaveat` copy 30-08 already shipped, listing every family-wide folder by decrypted name and every `item_bucket` item individually (never as one bucket row), degrading safely on any partial fetch failure.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-10
- **Tasks:** 1 (tracer -- implementation and tests landed in one commit)
- **Files modified:** 2 (`SharingOverviewPanel.tsx`, `SharingOverviewPanel.test.tsx`)

## Accomplishments
- `sharing-overview-family-wide` renders pinned immediately above `sharing-overview-tabs`, gated on BOTH the family-wide-share list and the member count having resolved AND at least one family-wide share existing -- never a half-resolved flash, never a "0 family-wide shares" heading.
- Member count reuses ShareDialog.tsx's exact four-state discriminant (`loading | {count} | error`) and the SAME `getFamilyMembers()`-shaped fetch, added once to the panel's existing `load()` effect's `Promise.all` -- no duplicated logic, no new network call shape.
- The FSH-05 timing caveat renders via `share.familyWideTimingCaveat`, byte-identical to 30-08's ShareDialog copy -- the two required locations share one i18n key and can never drift.
- A family-wide FOLDER's name is resolved via a lookup into the already-decrypted `useCollections()` store (no second decrypt); a family-wide `item_bucket`'s items are decrypted individually (owner's own `unsealCollectionKey` + `decryptItemForCollection`, reusing `RemoveMemberDialog.tsx`'s `resolveFolder`/`recombineEncryptedItem` idiom) and rendered as flat `<li>` entries with a `Share2` icon, never as a single folder-shaped row for the bucket.
- Partial fetch failures degrade gracefully at every layer: a rejected `getCollectionItems` for one bucket leaves any resolved folder entries rendered; an unresolvable identity key/sealed key leaves item_bucket entries simply absent; a rejected roster fetch renders `familyWideMemberCountError` (no retry control) while the caveat still renders.
- No revoke action exists anywhere inside the block (deliberately absent, per 30-UI-SPEC.md) -- verified by a test asserting no `data-testid` resembling a revoke button renders inside it.

## Task Commits

Task 1 was a `type="tracer"` task -- real implementation and its own test coverage landed together in one atomic commit (the plan's own action text does not separately schedule a TDD RED/GREEN split for this task, and this codebase's established precedent for tracer tasks, per 30-08's Task 1, is a single commit):

1. **Task 1 (tracer): pinned family-wide block** - `7f2dd3e` (feat)

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified
- `web/src/components/vault/SharingOverviewPanel.tsx` -- `FamilyWideEntry` interface, `recombineEncryptedItem` local helper, `familyWideShares`/`familyMemberCountState` state, `load()` effect's new `getFamilyMembers()` fetch + family-wide folder/item resolution logic, `familyWideVisible`/`familyWideMemberCountText` derived render values, the `sharing-overview-family-wide` block JSX (count line, caveat line, `<ul>` list) inserted immediately above `sharing-overview-tabs`.
- `web/src/components/vault/SharingOverviewPanel.test.tsx` -- `makeFamilyMember`/`makeCollectionItemRow` fixtures, `@/lib/families/api`'s `getFamilyMembers` mock, `@/lib/vault/api`'s `getCollectionItems` mock, a new wholesale `@/lib/crypto` mock (plus `@/lib/identity/ensure`) required by the item_bucket decrypt path -- extended to also satisfy `AvatarStack.tsx`'s transitive `isUnlocked`/`subscribeLockState` imports so every PRE-EXISTING test in this file keeps passing unchanged -- and a new `Task 1 (30-10) -- pinned family-wide block` describe block (7 tests: zero-shares hidden, 3-entry mixed folder+bucket render with no revoke testid, bucket-rejection partial-failure degrade, truncation, solo-owner count, populated count, roster-fetch-error count).

## Decisions Made
- **No edit-access filter on `familyWideCollections`.** The plan's `<action>` text derives the family-wide list from `rawCollections.filter((c) => c.family_wide_kind !== null)` with no `editableIds` gate (unlike the existing "By folder" tab, which explicitly restricts to edit-level access). This is not an oversight: 30-UI-SPEC.md's own rationale for the block states the audience for a family-wide share's information "IS the family" -- every member who holds a `collection_keys` row for a family-wide collection has a legitimate reason to see it and the timing caveat, not only whoever happens to have created it. Implemented literally as specified.
- **Folder names reuse the already-decrypted `collections` store rather than re-decrypting `enc_name`.** The plan's `<action>` explicitly permits "reuse whatever this file/collections.ts already uses to decrypt a collection's enc_name" -- since `useCollections()` already carries every collection's decrypted `name` by the time `load()` runs, a plain id lookup (same cross-reference idiom `editableCollections` already uses) is both simpler and avoids a redundant WASM call.
- **Member-count "loading" text is structurally unreachable in this surface** (unlike ShareDialog, where the row must always render immediately). The block's own visibility gate requires the count to have already resolved before the block renders at all, so the `familyWideMemberCountLoading` branch in `familyWideMemberCountText`'s ternary exists only for type-completeness against the shared three-state type, never for an actual render. This matches 30-UI-SPEC.md's explicit "the block does not render at all until BOTH... have resolved" truth.

## Deviations from Plan

None outside the two documented decisions above, both directly following the plan's own `<action>` text rather than deviating from it.

## Issues Encountered
- The wholesale `@/lib/crypto` mock this plan's item_bucket decrypt path required broke every pre-existing test in the file, because `AvatarStack.tsx` (rendered by the existing "By folder" tab) transitively imports `isUnlocked`/`subscribeLockState` from the same module via `lib/vault/shareRecipients.ts`. Fixed by adding no-op implementations of both to the mock (Rule 3 -- blocking issue, not a scope change) rather than partially mocking with `importOriginal`, matching this test file's existing full-replacement mock style for every other module.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `sharing-overview-family-wide`'s testids (`-count`, `-caveat`, `-list`) are stable and match 30-UI-SPEC.md's contract exactly -- available for a future live/e2e pass (30-17) to assert against.
- The panel's known VIS-03 defect (individually-shared items missing from the existing By-folder/By-person tabs) was NOT touched by this plan and remains Phase 34's scope, as instructed -- this plan's item_bucket branch is scoped exclusively to the NEW `sharing-overview-family-wide` block, not a fix to the pre-existing aggregation.
- `resolve_access`/`Collection::resolve_access` were not touched -- only `web/src/components/vault/SharingOverviewPanel.tsx` and its test file changed; no Rust surface was modified.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All claimed files exist (`SharingOverviewPanel.tsx`, `SharingOverviewPanel.test.tsx`, this SUMMARY) and the task commit hash (`7f2dd3e`) is present in `git log`.
