---
phase: 30-the-living-group-family-wide-sharing
plan: 15
subsystem: ui
tags: [react, typescript, i18n, vault-store, fsh-02, fsh-05, honesty-ui]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-06's familyWidePending module-singleton (refreshFamilyWidePending / getFamilyWidePendingSnapshot / subscribeFamilyWidePending) fed by sync.ts's pull cycle, and 30-02's ids-only GET /api/families/family-wide-pending"
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-11's ItemRow marker-slot chain (family badge vs AvatarStack vs sharedToMe) that the pending row must NOT fall through into"
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-13's onFamilyWidePending reseal trigger -- the sender-side half of the same signal this plan renders the recipient side of"
provides:
  - "VaultItem.pendingFamilyKey -- a discriminant for a SYNTHETIC placeholder row, independent of (never an overload of) undecryptable"
  - "store.ts's pendingFamilyKeyRows(): one synthetic row per missing family-wide grant, id-prefixed `pending-family-key:{collectionId}`, merged into the SAME items array real rows live in, rebuilt on every completed discovery refresh"
  - "ItemRow's PendingFamilyKeyRow: 30-UI-SPEC.md's exact pending anatomy, dispatched before any decrypt-dependent content is computed"
  - "DetailPanel's pending-family-key-detail note (role=status, never role=alert), checked ahead of every other status-note branch"
  - "Four new i18n keys (pl+en) verbatim from 30-UI-SPEC.md's Copywriting Contract"
affects: ["30-16 (e2e falsification of the pending state)", "Phase 33 FamilyTab", "Phase 34 recipient-side visuals", "any future consumer of the merged items array -- synthetic rows now live in it"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synthetic rows in the real array, discriminated by a reserved id prefix AND a boolean flag -- visible everywhere the list is, distinguishable everywhere it matters"
    - "Component-split instead of early-return for a state that must be decided before any other rendering: React's rules of hooks make a true top-of-render branch impossible inside a component that later calls useState/useRef/useEffect, so the pending row is its own component and 'never reaches the marker chain' becomes structural rather than conditional"
    - "Derived-state subscription: store.ts subscribes to the discovery store so a pending row is not merely 'correct once' (correct in a test that primes the snapshot first, permanently absent in the running app)"

key-files:
  created: []
  modified:
    - packages/pv-ui/vault/types.ts
    - web/src/lib/vault/store.ts
    - web/src/components/vault/ItemRow.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/ExportDialog.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "`pendingFamilyKey` is a NEW field, never a second meaning for `undecryptable`. `undecryptable` means 'a prior successful decrypt exists; the latest merge failed, so a retained stale copy is showing' -- an integrity signal that must keep its alarming treatment. Pending means 'never decrypted at all, and correctly so'. Both directions are falsified by test: an undecryptable item never renders the pending anatomy or note, and a pending row never carries undecryptable."
  - "The synthetic row's id encodes its collection (`pending-family-key:{collectionId}`) and the row itself carries NO `collectionId`. Real ids are UUIDs, so the prefix cannot collide; omitting `collectionId` keeps collection-scoped consumers (ShareDialog's folder counts, the family badge, DetailPanel's sharedFolderName) from ever mistaking a placeholder for a real member of that folder."
  - "Nothing is fabricated: no name (the real one is inside unreachable enc_data), no updatedAt/lastUsedAt (the ids-only response carries none, and the trailing metadata slot is omitted ENTIRELY rather than showing a stale or invented value). `fields` exists only because VaultItem requires it and is never rendered."
  - "A grant whose collection already has a real decrypted row is skipped. A discovery snapshot is at most one pull cycle stale, and 'waiting for your key' next to items that already decrypted would be the same dishonesty pointing the other way."
  - "Synthetic rows are suppressed while locked and cleared by the lock branch like every real source -- a placeholder surviving a lock would be the one piece of vault state that did."
  - "The pending row stays SELECTABLE (a real <button>) precisely so DetailPanel's note is reachable. An unreachable detail branch would have been this project's signature defect (FamilyRekeyNotice, earlier this same phase)."
  - "DetailPanel suppresses Share/Edit/Delete and the entire view body for a pending row: each affordance acts on a server row that does not exist for this member yet, and an empty field column would read as 'this item is empty' instead of 'your key hasn't arrived'."

patterns-established:
  - "Falsify the ordering, not just the rendering: the DetailPanel test builds a fixture where pending, undecryptable and sharedToMe would ALL fire and asserts only the pending note renders -- plus the mirror test that a genuine undecryptable item still gets the alarming banner."
  - "When a plan injects synthetic entries into a shared array, audit that array's OTHER consumers in the same plan. ExportDialog was silently writing placeholders to disk."

requirements-completed: [FSH-02, FSH-05]

coverage:
  - id: D1
    description: "A missing family-wide grant becomes exactly one synthetic pending row in the merged item list, id-prefixed and collision-proof, with no name, timestamp or collectionId fabricated"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#merges one synthetic pending row per missing grant, with a collision-proof id and no fabricated metadata"
        status: pass
    human_judgment: false
  - id: D2
    description: "The synthetic row disappears on the SAME merge pass its backing missing entry does (quiet arrival of the real item, no stale placeholder surviving the sync cycle that resolved it)"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#drops the synthetic row on the SAME merge pass its backing missing entry disappears (the key arrived)"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#suppresses the synthetic row for a collection that ALREADY has a real decrypted row (a momentarily stale discovery snapshot never doubles an item up)"
        status: pass
    human_judgment: false
  - id: D3
    description: "FSH-02 empty edge-probe: a newcomer joining a family with ZERO family-wide shares anywhere gets no synthetic row and no grant -- the absence is correct, not a failure"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#FSH-02 empty (edge-probe): a newcomer joining a family with ZERO family-wide shares gets no synthetic row at all"
        status: pass
    human_judgment: false
  - id: D4
    description: "The pending item row renders 30-UI-SPEC.md's anatomy: generic clock tile, two placeholder text lines, no icon tile, no sharing marker, no trailing metadata slot, no kebab -- and stays selectable"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#renders the generic pending anatomy -- placeholder name, explanation, and a neutral clock tile"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#shows no item-type icon tile, no sharing marker, no trailing metadata and no kebab -- there is no real item to describe or act on yet"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#is still selectable, so the detail panel's pending explanation is reachable"
        status: pass
    human_judgment: false
  - id: D5
    description: "The pending state is never a decrypt-failure catch-all: a genuinely undecryptable REAL item keeps the existing retained-last-known-good path in the store, the normal row in the list, and the alarming banner in the panel -- and never gains the pending discriminant, anatomy or note (the backstop the UI-SPEC flags)"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#a genuinely undecryptable REAL item is completely unaffected -- it keeps the existing retained-last-known-good path and never gains the pending discriminant"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#a genuinely undecryptable REAL item never renders the pending anatomy -- a decrypt failure is not dressed up as a calm wait"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#a genuinely undecryptable item still gets the alarming banner and NEVER the calm pending note"
        status: pass
    human_judgment: false
  - id: D6
    description: "The detail panel renders pending-family-key-detail with role=status/aria-live=polite (never role=alert) and both copy lines, checked BEFORE undecryptable and sharedToMe on a fixture where all three would otherwise fire"
    requirement: "FSH-02"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#renders both lines of the note with role=status, never role=alert"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#is checked BEFORE undecryptable and sharedToMe -- a fixture where all three would fire renders only the pending note"
        status: pass
    human_judgment: false
  - id: D7
    description: "No impossible operation is offered on a placeholder: no Share/Edit/Delete in the panel, no context menu in the row, no field rows, and no placeholder written into a vault export"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#offers no Share/Edit/Delete affordance for a pending placeholder -- there is no server row to act on"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#shows the generic placeholder name instead of an empty heading, and no field rows at all"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ExportDialog.test.tsx#never writes a pending placeholder into the exported file"
        status: pass
    human_judgment: false
  - id: D8
    description: "The pending row's visual calm reads as 'waiting', not as a disguised error, at real size in both themes -- the taste call 30-UI-SPEC.md's colorless treatment is making"
    verification: []
    human_judgment: true
    rationale: "Whether a colorless placeholder row reads as reassuring-but-honest rather than as a broken/empty row is a perceptual judgment no assertion captures; 30-16's live e2e pass is where it can be seen in situ."

# Metrics
duration: ~35min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 15: The Pending-Newcomer State Summary

**A newcomer whose family-wide key hasn't arrived now sees an explicit, generic, calm placeholder row — built entirely from the discovery endpoint's ids-only `missing` list, structurally incapable of masking a genuine decrypt failure, and self-resolving on the sync pass that delivers the key.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-10
- **Tasks:** 2 (plus one unplanned fix, below)
- **Files modified:** 6 production, 4 test
- **Server/Rust files touched:** 0 — `resolve_access` untouched

## Accomplishments

- **The discriminant is its own field, not a second meaning for an existing one.** `VaultItem.pendingFamilyKey` is set exclusively by `store.ts`'s own merge from the positive `missing` list. `undecryptable` keeps its single meaning ("a prior successful decrypt exists; the latest merge failed"). Both directions are proven: an undecryptable item never gains the pending flag, anatomy or note; a pending row never carries `undecryptable`.
- **The rows are merged into the SAME array real rows live in** (`recomputeItems()`), so a pending grant is exactly as visible as a real item — the point of the whole decision, whose inverse (silently dropping a row's existence) is what FSH-02 exists to prevent.
- **Nothing is fabricated.** No name (`fields.name` is `""`, and the row renders a translator string instead), no `updatedAt`/`lastUsedAt`, no `collectionId`. The trailing metadata slot is omitted **entirely**, not populated with a stale or invented value — the ids-only response has nothing to put there.
- **The placeholder is self-resolving because the store subscribes to its source.** `subscribeFamilyWidePending(() => recomputeItems())` means the pass that no longer sees the grant is the pass that drops the placeholder — no animation, no toast, quiet arrival. Without that subscription the row would have been "correct once": correct in a test that primes the snapshot before importing the store, and permanently wrong in the running app, where the discovery response lands long after the list paints.
- **`ItemRow` dispatches to a dedicated `PendingFamilyKeyRow` component** rather than early-returning. React's rules of hooks forbid returning before `ItemRow`'s own `useState`/`useRef`/`useEffect`, so a true "top of render, before `primaryText` is even computed" branch is only achievable by splitting. The upside is structural: the pending row *cannot* reach `ItemIconTile`, the marker-slot chain, the metadata slot or the context menu, because none of them exist in that component.
- **The row is still selectable, and the panel branch it reaches is checked first.** An unreachable detail branch would have been this project's signature defect — the one this very phase already produced once (`FamilyRekeyNotice`, built and tested but mounted nowhere).
- **No impossible operations on a placeholder:** no kebab in the row, no Share/Edit/Delete in the panel, no field rows, and (after the fix below) no placeholder in an export file.

## Task Commits

1. **Task 1 (tracer, TDD): synthetic pending rows in the item list** — `2cab89e` (failing tests), `90997d0` (implementation)
2. **Task 2: pending-family-key detail-panel note** — `102a3f2`
3. **Unplanned fix found while executing Task 1** — `9cc6a21`

**Plan metadata:** this SUMMARY's own commit (docs, immediately following).

## Files Created/Modified

- `packages/pv-ui/vault/types.ts` — `VaultItem.pendingFamilyKey`, with a doc comment stating explicitly why it is not `undecryptable` and what a row carrying it does and does not contain.
- `web/src/lib/vault/store.ts` — `PENDING_FAMILY_KEY_ID_PREFIX`, `pendingFamilyKeyRows()`, its call from `recomputeItems()`, and the `subscribeFamilyWidePending` module-level subscription.
- `web/src/components/vault/ItemRow.tsx` — `PendingFamilyKeyRow` + a shared `rowClassName()` (so a placeholder and a real row cannot drift apart in height or selected-state treatment); `ItemRow` is now a two-line dispatcher over `RealItemRow`.
- `web/src/components/vault/DetailPanel.tsx` — the `pending-family-key-detail` note at the top of the status-note chain; placeholder heading; action-group and view-body suppression.
- `web/src/components/vault/ExportDialog.tsx` — one filtered read (see Deviations).
- `web/src/lib/i18n/dictionary.ts` — `vault.pendingFamilyKeyItemName`, `vault.pendingFamilyKeyRow`, `share.pendingFamilyKeyNote`, `share.pendingFamilyKeyNoteDetail`, pl+en, verbatim from the Copywriting Contract. None interpolates anything, so no count governs a declined noun (the phase-29 "1 wpisów" trap is structurally absent here).

## Decisions Made

See `key-decisions` in the frontmatter. The two most load-bearing:

1. **A separate field plus a reserved id prefix, rather than reusing `undecryptable` or inferring from a caught exception.** The honesty risk this plan exists to manage is the inverse of DEBT-03's: a calm "your key is on its way" printed over a genuine integrity failure. That risk is eliminated at the source — the flag is only ever set from a positive `missing` entry, so there is no code path by which a decrypt exception can produce it.
2. **The row carries no `collectionId`.** The linkage lives in the id. This keeps every collection-scoped consumer (folder item counts, the family badge, the panel's shared-folder note) from treating a placeholder as a real member of that folder, without any of them needing to learn about pending rows.

## Deviations from Plan

1. **One extra production file: `web/src/components/vault/ExportDialog.tsx` (+ its test).** Task 1's synthetic rows land in the merged `items` array, which `ExportDialog` reads — so the dialog was writing a fabricated empty note into the user's export file. This was **proven, not assumed**: the test failed against the unfiltered dialog (`["item-1", "pending-family-key:c9"]` vs `["item-1"]`) before the one-line filter. Committed separately as `fix(30-15)` rather than folded into a task commit. The plan's `files_modified` did not anticipate it; shipping a plan that puts a fake item in vault exports was not an option.
2. **DetailPanel changes beyond the plan's literal instruction.** The plan asked only for the status-note branch. Also suppressed: the Share/Edit/Delete action group, the entire view body, and the empty heading. Each would otherwise offer an operation that can never succeed (the WINDOWS #11 / `4450dc0` shape this codebase has hit three times) or render a column of empty labels reading as "this item is empty".
3. **No lint gate exists.** `npx eslint` in `web/` fails with "couldn't find an eslint.config.js" (ESLint 10 with no flat config in the repo). Not substituted with anything — `tsc --noEmit` for both `web/` and `extension/` was run instead and is clean.

**Total deviations:** 3. **Impact on plan:** additive only; no planned behavior was skipped or weakened.

## Verify-Command Audit (non-vacuity)

Both of the plan's `<automated>` blocks use `vitest -t "pending"` — a **name filter that exits 0 when it matches nothing**, exactly the failure class this phase has produced three times. Both were confirmed to run something by observing RED first:

| Verify command | Non-vacuity evidence |
|---|---|
| `npx vitest run src/lib/vault/store.test.ts src/components/vault/ItemRow.test.tsx -t "pending"` | Before implementation: **8 failed, 2 passed**. After: **10 passed**. |
| `npx vitest run src/components/vault/DetailPanel.test.tsx -t "pending"` | Ran against the pre-change `DetailPanel.tsx` (restored from a scratchpad copy, no `git stash`): **4 failed, 1 passed**. The 1 that passed is the undecryptable-regression backstop, which correctly passes in both states. After: **5 passed**. |

`set -o pipefail` was kept on every block.

## Verification

```
cd web && npx vitest run src/lib/vault/store.test.ts \
        src/components/vault/ItemRow.test.tsx \
        src/components/vault/DetailPanel.test.tsx   # 171 passed
cd web && npx vitest run                            # 92 files, 964 passed
cd web && npx tsc --noEmit                          # clean
cd extension && npm run compile                     # clean (pv-ui type change is additive)
cd extension && npx vitest run                      # 60 files, 788 passed
git diff --name-only HEAD~4..HEAD | grep crates     # no matches -- resolve_access untouched
```

## Issues Encountered

- **`ItemRow`'s hook order made a literal early return impossible.** The plan asked for a branch "before `primaryText`/`subtitle` are even computed", but `useState`/`useRef`/`useEffect` run *after* those consts in the existing component. Splitting into a dispatcher + two components honors the intent more strongly than an early return would have.
- **The synthetic row needs a `fields` object** because `VaultItem` requires one. It is an empty `note` — never rendered (both ItemRow and DetailPanel branch on the discriminant before touching it), but it does mean a pending row would currently pass an `itemType: "note"` sidebar filter. Not worth widening `filterItems` in shared `pv-ui` for; noted here as the one place a placeholder is treated like a note.

## Follow-ups for 30-16

- The live e2e falsification the UI-SPEC's backstop asks for (a genuine decrypt failure must NOT render the pending copy in the running app) is 30-16's; unit-level falsification of that backstop is in place here in all three layers.
- Worth an eye during e2e: the pending row under an active `itemType` sidebar filter (see Issues above).

## User Setup Required

None.
