---
phase: 30-the-living-group-family-wide-sharing
plan: 11
subsystem: web-ui
tags: [typescript, react, family-sharing, item-list, i18n]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-09's CollectionRow.family_wide_kind wire field (the client-side name this plan reads family-wideness from)"
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-02's server-side CollectionResponse.family_wide_kind on create/get/list"
provides:
  - "Collection.familyWideKind -- the collections store's own copy of family_wide_kind, normalized so an ABSENT wire field is indistinguishable from an explicit null"
  - "isFamilyWideCollection(collectionId) -- synchronous, zero-fetch, fail-closed lookup; the boolean input for any surface that must distinguish a family-wide share from a person-to-person one"
  - "ItemRow's family badge (data-testid item-row-family-badge) -- one Users marker INSTEAD OF AvatarStack on an owner-side family-wide item"
  - "vault.familyBadgeAria (pl/en)"
affects: [30-12, 30-13, 30-15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Subscribe-without-reading: calling useCollections() purely for its useSyncExternalStore subscription while a sibling module-level synchronous lookup supplies the actual value. Keeps a render-body store read from being 'correct once' when the store's async refresh lands after the consuming list has already painted."

key-files:
  created: []
  modified:
    - web/src/lib/vault/collections.ts
    - web/src/lib/vault/collections.test.ts
    - web/src/lib/vault/collections.real-wasm.test.ts
    - web/src/components/vault/ItemRow.tsx
    - web/src/components/vault/ItemRow.test.tsx
    - web/src/components/vault/CollectionPicker.test.tsx
    - web/src/components/vault/SharingOverviewPanel.test.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "Collection.familyWideKind is REQUIRED (string | null), not optional, even though the wire field it comes from (CollectionRow.family_wide_kind, 30-09) is optional. The wire type must tolerate an omitting server; the STORE type is what every UI consumer reads, so 'absent' and 'null' must already be collapsed by the time they get here. refreshCollections does that with `row.family_wide_kind ?? null`. Cost: three pre-existing test fixtures that build Collection literals had to state familyWideKind: null explicitly -- accepted deliberately, because the alternative (weakening the store type to optional) would let every future construction site stay silent about a field that governs whether an item is badged as family-wide."
  - "ItemRow calls useCollections() without using its return value. isFamilyWideCollection is a plain module read that does not re-run on its own; items and collections are two independent unlock-time fetches with no ordering between them, so without the subscription a family-wide item whose collection metadata lands after the list paints would stay badge-less in the running app while every test that primes the store before rendering still passed. This is a deviation from the plan's literal action text and is recorded as such below."
  - "The badge branch sits AFTER the sharedToMe branch in the existing ternary chain rather than carrying its own `item.sharedToMe !== true` condition. Being in that chain's else IS the owner-side guard the plan asks for -- one guard, not two that could drift."

patterns-established:
  - "Falsify a rendering branch by disabling it, not by trusting a green suite: the badge branch was replaced with `false ?` and the suite re-run, confirming 3 of the 7 new tests genuinely fail without it (the other 4 are guard tests that SHOULD stay green -- they assert the badge's absence)."

requirements-completed: [FSH-01]

coverage:
  - id: D1
    description: "isFamilyWideCollection is a synchronous, zero-fetch, fail-closed lookup: true for familyWideKind 'folder' and 'item_bucket'; false for null, for an omitted wire field, for null/undefined/unknown ids, and on a never-refreshed store"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#collections.ts: isFamilyWideCollection -- familyWide synchronous lookup (30-11-PLAN.md Task 1) > returns true for a collection whose familyWideKind is 'folder'"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > returns true for a collection whose familyWideKind is 'item_bucket' (the second family-wide kind, never only 'folder')"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > returns false for a collection whose familyWideKind is null (an ordinary, person-to-person shared collection)"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > returns false when the server row omits family_wide_kind entirely (a pre-Phase-30 response is not a family-wide share)"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > returns false -- never throws -- for null, undefined, and an id absent from the store"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > returns false for every id before the store has ever refreshed -- the familyWide lookup fails CLOSED"
        status: pass
    human_judgment: false
  - id: D2
    description: "family_wide_kind is threaded onto Collection itself (undefined normalized to null) and re-read on every refresh, so the badge reads already-loaded metadata rather than issuing a fetch"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > threads familyWideKind onto the Collection record itself"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.test.ts#... > re-reads familyWideKind on every refresh -- a collection that stops being family-wide stops badging without a reload"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.real-wasm.test.ts (real-WASM decrypt path) > whole-object toEqual now asserts familyWideKind: null for a row carrying no family_wide_kind"
        status: pass
    human_judgment: false
  - id: D3
    description: "An owner-side item in a family-wide collection renders ONE Users badge and NOT AvatarStack -- never both, never N avatars"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > renders the family badge, and NOT AvatarStack, for an owner-side item in a family-wide collection"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > an item shared with specific people (not family-wide) still renders AvatarStack and no family badge"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > a personal item in no collection renders neither the family badge nor AvatarStack"
        status: pass
    human_judgment: false
  - id: D4
    description: "The badge is independent of recipient resolution BY CONSTRUCTION -- it issues no recipient fetch and has no loading/error state, verified at the real call site (AvatarStack is rendered unmocked in this suite)"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > the family badge fires no recipient fetch of its own -- it has no loading or error state to get wrong"
        status: pass
    human_judgment: false
  - id: D5
    description: "Recipient-side rendering is unchanged (VIS-02, Phase 34's job): a sharedToMe item keeps today's item-shared-with-you marker even when its collection IS family-wide"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > a sharedToMe item keeps the shared-with-you marker and never shows the family badge, even when its collection IS family-wide"
        status: pass
    human_judgment: false
  - id: D6
    description: "The badge is keyed on the item's own collectionId, carries role=img and the vault.familyBadgeAria accessible name from the i18n engine (pl + en), and its row subscribes to the collections store so late-arriving metadata is not missed"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > the family badge is keyed on the item's OWN collectionId and carries the vault.familyBadgeAria accessible name"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#ItemRow family badge (30-11, FSH-01) > the family badge's row subscribes to the collections store, so late-arriving metadata is not missed"
        status: pass
      - kind: other
        ref: "web/src/lib/i18n/dictionary.ts -- vault.familyBadgeAria present with both pl and en; no interpolation, so no count can govern a declined noun"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 11: Family Badge in the Item List Summary

**An owner-side item shared with the whole family now carries one `Users` badge instead of N avatars, driven by a synchronous collections-store lookup that has no fetch — and therefore no loading or error state — by construction.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-10T13:48:00Z
- **Completed:** 2026-08-10T14:02:00Z
- **Tasks:** 2
- **Files modified:** 8 (0 created, 8 modified)

## Accomplishments

- `Collection.familyWideKind` — `refreshCollections` now threads the server's `family_wide_kind` onto every collection, collapsing the optional wire field's `undefined` into `null` so no consumer ever has to distinguish "server omitted it" from "server said null".
- `isFamilyWideCollection(collectionId)` — deliberately the same `.find()`-with-fallback shape as the neighbouring `getCollectionAccessLevel`. Purely synchronous over already-refreshed in-memory metadata, so there is no promise to be pending. Fails **closed** on a `null`/`undefined`/unknown id and on a never-refreshed store: the dangerous direction here is badging an ordinary person-to-person share as family-wide, which would tell the owner their item is more widely shared than it is.
- `ItemRow`'s marker slot gained a third branch between the `sharedToMe` marker and `AvatarStack`. A family-wide item renders one `Users` badge **instead of** the avatar stack — the locked decision that "a five-person family rendered as five avatars is indistinguishable from five separate per-person shares."
- The recipient side is untouched, as VIS-02 requires: a family-wide item shared **to** the caller still renders today's `item-shared-with-you` marker, and that is proven by a test, not just by inspection.
- `vault.familyBadgeAria` (pl "Udostępnione całej rodzinie" / en "Shared with the whole family") — no interpolation at all, so there is no count here that could govern a declined noun (the phase-29 "1 wpisów" trap is structurally absent, not merely avoided).

## Task Commits

1. **Task 1 RED: failing tests for isFamilyWideCollection** — `7857e9a` (test) — 8 cases, all failing with "isFamilyWideCollection is not a function"
2. **Task 1 GREEN: Collection.familyWideKind + isFamilyWideCollection()** — `322f4a9` (feat)
3. **Task 2: family badge in ItemRow's marker slot** — `d5a5b00` (feat)

## Files Created/Modified

- `web/src/lib/vault/collections.ts` — `Collection.familyWideKind`; `row.family_wide_kind ?? null` in the refresh mapping; `isFamilyWideCollection()`
- `web/src/lib/vault/collections.test.ts` — 8 new tests; the `row()` fixture helper gained an optional third arg that OMITS `family_wide_kind` unless asked, so every pre-existing test in the file exercises the missing-key path for free
- `web/src/lib/vault/collections.real-wasm.test.ts` — whole-object `toEqual` updated to state `familyWideKind: null` (kept whole-object rather than loosened to `objectContaining`, so the absent-normalizes-to-null contract stays observable through the real-WASM path too)
- `web/src/components/vault/ItemRow.tsx` — `Users` import; `useCollections()` subscription; the badge branch
- `web/src/components/vault/ItemRow.test.tsx` — `isFamilyWideCollection` added to the wholesale module mock (defaulting to `false`, so every pre-existing expectation still describes pre-badge behavior); 7 new tests
- `web/src/components/vault/CollectionPicker.test.tsx`, `web/src/components/vault/SharingOverviewPanel.test.tsx` — existing `Collection` fixtures now state `familyWideKind: null`
- `web/src/lib/i18n/dictionary.ts` — `vault.familyBadgeAria`

## Decisions Made

- **Store type required, wire type optional.** See `key-decisions`. 30-09 correctly made `CollectionRow.family_wide_kind` optional so a rolling-restart response can omit it; this plan deliberately did NOT propagate that optionality into the store type. Normalization happens once, at the boundary.
- **One guard, not two.** The plan's action text asked for `item.sharedToMe !== true AND isFamilyWideCollection(...)`. Placing the badge branch inside the existing ternary chain after the `sharedToMe` arm makes the first half of that condition structural. Two independently-maintained guards for the same invariant is how they drift.

## Deviations from Plan

### 1. [Rule 1 — Bug] `ItemRow` subscribes to the collections store (`useCollections()`), which the plan did not specify

- **Found during:** Task 2, reasoning about when `collections` is actually populated relative to when the item list first paints.
- **Issue:** `isFamilyWideCollection` is a plain module-level read in the render body. It does not re-run when the store later refreshes. Items and collections are two independent unlock-time fetches with no ordering guarantee between them, and `ItemRow` previously subscribed to neither. If collection metadata resolved *after* the list painted, a family-wide item would render badge-less until some unrelated state change forced a re-render — while every test that primes the store before calling `render()` stayed green. That is precisely this project's signature defect shape ("true in the artifact, false in reality"), so it was fixed rather than shipped.
- **Fix:** `ItemRow` now calls `useCollections()` for its `useSyncExternalStore` subscription without reading the returned array (the value comes from `isFamilyWideCollection`, which reads the same module state). Commented in place so the bare call is not mistaken for a leftover.
- **Files modified:** `web/src/components/vault/ItemRow.tsx` (already in scope), `web/src/components/vault/ItemRow.test.tsx` (already in scope)
- **Verification:** new test `> the family badge's row subscribes to the collections store, so late-arriving metadata is not missed`
- **Committed in:** `d5a5b00`

### 2. [Rule 2 — Adjacent] Three test files outside `files_modified` updated for the now-required `Collection.familyWideKind`

- **Found during:** Task 1, `npx tsc --noEmit` after adding the field.
- **Issue:** `familyWideKind` as a REQUIRED field broke three pre-existing files that construct `Collection` literals: `CollectionPicker.test.tsx` (8 sites), `SharingOverviewPanel.test.tsx` (1 factory), and — caught only by the full suite, not by `tsc` — `collections.real-wasm.test.ts`'s whole-object `toEqual`.
- **Options considered:** weaken the store type to `familyWideKind?: string | null` (zero out-of-scope edits, but then every future construction site can silently omit the field that governs family-wide badging), or state `null` explicitly at the three fixture sites.
- **Fix:** kept the field required; updated the fixtures. Note this is the *opposite* call from 30-09's own deviation, and deliberately so: that one was about a **wire** type that must tolerate an old server, this one is about a **store** type every UI consumer reads.
- **Files modified:** `web/src/components/vault/CollectionPicker.test.tsx`, `web/src/components/vault/SharingOverviewPanel.test.tsx`, `web/src/lib/vault/collections.real-wasm.test.ts`
- **Verification:** `npx tsc --noEmit` → clean (exit 0); full `npx vitest run` → 91 files / 928 tests passing
- **Committed in:** `322f4a9` (the first two), `d5a5b00` (the real-WASM one, found when the full suite ran)

---

**Total deviations:** 2 (1 Rule 1 bug fix, 1 Rule 2 adjacent-file fix). No scope creep: no new component, no new fetch, no server change.

## Verify-Command Audit

The phase's standing warning about gates that cannot fail was taken literally; both `<automated>` blocks were checked for vacuity before being trusted.

- Both plan verify commands use `vitest -t "<filter>"`, which **exits 0 when the filter matches nothing**. Neither was vacuous: `-t "familyWide"` matched **8** tests and `-t "family badge"` matched **7**, confirmed from vitest's own "N passed" line each run.
- `set -o pipefail` was kept on every block, and exit-status propagation through `| tail` was verified empirically rather than assumed: the RED run reported `EXIT=1` through the pipe.
- **Substituted/added beyond the plan** (recorded per the phase instruction): `npx tsc --noEmit` (caught deviation 2) and a full `npx vitest run` across all 91 web test files (caught the real-WASM fixture the targeted filters missed entirely — the plan's own `<verification>` line, which runs only two files, would have passed while the suite was red).
- **Falsification of Task 2's gate:** the badge branch was temporarily replaced with `false ?` and the suite re-run. 3 of the 7 new tests failed; the other 4 stayed green, correctly, because they assert the badge's *absence*. The branch was then restored from a scratchpad copy and confirmed present.

## Issues Encountered

None. No lint config exists in `web/` (no `eslint.config.*`; `package.json` exposes only `compile`/`typecheck`/`test`/`test:e2e`), so `tsc --noEmit` plus the vitest suite are the full available static gate.

## Zero-Knowledge / Security Notes

- No server, crypto, or route code was touched. `resolve_access` in `crates/pv-server/src/routes/membership.rs` is untouched — `git diff HEAD~3 --stat -- crates/` is empty.
- T-30-18 (accepted, low): the badge renders only from the caller's own already-fetched `collections` store and the item's own `collectionId`, both already authorized. It reveals nothing the existing `AvatarStack`/`sharedToMe` markers did not already reveal — and strictly less, since it replaces a list of named recipients with a single unnamed marker.

## Next Phase Readiness

- `isFamilyWideCollection()` is the one place any later surface should ask "is this family-wide?" — it needs no fetch, no hook, and no loading state, so it can be called from anywhere in a render body (paired with a `useCollections()` subscription wherever staleness would matter).
- Recipient-side rendering of a family-wide item is deliberately still today's generic shared-with-me marker. Phase 34 (`AvatarStack.tsx`) and 30-12/30-13's pending-newcomer states own that surface; nothing here forecloses it.
- No blockers for dependent plans.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All modified files verified present on disk; all three commit hashes verified in `git log`.
