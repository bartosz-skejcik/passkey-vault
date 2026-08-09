---
phase: 26-web-app-sharing-ui-family-management
plan: 11
subsystem: ui
tags: [typescript, react, i18n, sharing, aggregation, vitest]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-04's listItemShares/getCollectionAccessList endpoints + suspended flag"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-06's accessLevel.ts (accessLevelKey/higherAccess), AvatarStack.tsx, full i18n dictionary pass"
provides:
  - "web/src/components/vault/SharingOverviewPanel.tsx -- D-1's Sharing overview, By-folder / By-person tabs, entirely client-side aggregated (A-8)"
affects: [26-10 (Sidebar trigger wiring), 26-12, 26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side per-person aggregation keyed by user_id, with a `${kind}:${resourceId}` dedup key per grant so a resource reachable via two different fetch sources collapses to one entry at the higher access level (higherAccess), while a person's row itself always appears exactly once regardless of how many distinct grants they hold."
    - "Data fetch effect is keyed to the underlying reactive stores (useCollections()/useVaultItems()), never to UI tab state -- switching tabs is a pure render toggle over already-resolved state, guaranteeing zero redundant refetch by construction rather than by a manual cache check."

key-files:
  created:
    - web/src/components/vault/SharingOverviewPanel.tsx
    - web/src/components/vault/SharingOverviewPanel.test.tsx
  modified: []

key-decisions:
  - "'Edit-or-owner reason to manage' (E6's own wording) is implemented as a single check: the caller's own access_level on a collection (from listCollections()'s per-caller access_level field) equals 'edit'. The collection creator's own collection_keys row is hard-coded to 'edit' server-side (collections.rs::create), so this one check correctly captures both real owners and full-edit co-managers, and correctly EXCLUDES a folder the caller only has read/hidden-password access to (someone else is the one sharing that folder, not the caller) -- verified by a test asserting getCollectionAccessList is never called for the excluded collection."
  - "Added a 'highest access level' summary badge on each By-person row (not explicitly named in the UI-SPEC's row description, but the most literal reading of the task's own behavior text: 'a member reachable via both paths appears exactly once, at the higher access level, reuses higherAccess'). The badge is a genuinely useful glance-level answer to '\"what CAN Anna see\" at most' -- the expanded breakdown below it still lists every individual grant at its own level, so the summary badge summarizes, it never hides."
  - "'By folder' recipient count (sharing.sharedWithLabel) and the expanded per-recipient badge list both exclude the caller's OWN collection_keys row (access_list includes the creator's own row) -- a caller wouldn't want to see themselves listed as someone they're 'sharing with'."
  - "The data-loading effect depends on [collections, items] (the two reactive store snapshots), not on `tab` -- this is what makes 'switching tabs never refetches' true by construction, verified by a fetch-call-count assertion across two tab switches, rather than needing a separate memoization/cache layer."

requirements-completed: [SHARE-03, UX-05]

coverage:
  - id: D1
    description: "By-folder tab lists one row per collection the caller has edit-or-owner reason to manage (access_level === 'edit'), showing folder name, AvatarStack, and sharing.sharedWithLabel's count; a read-only collection is excluded and its access list is never even fetched"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#By-folder tab lists one row per edit-or-owner collection with name, AvatarStack, and the sharedWithLabel count; excludes a read-only collection"
        status: pass
    human_judgment: false
  - id: D2
    description: "By-person tab groups getCollectionAccessList + listItemShares entries by user_id; a member reachable via two distinct grants appears exactly once, with a higherAccess-computed summary badge, and both underlying grants still visible on expand"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#By-person tab groups collection-access and direct item-share entries by user_id; a member reachable via two different paths appears exactly once, at the higher access level"
        status: pass
    human_judgment: false
  - id: D3
    description: "The component never calls getMemberAccess (RESEARCH.md Pitfall 2 / the owner-only, wrong-question endpoint), proven by a spy assertion across a full render + tab-switch + expand interaction cycle"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#never calls getMemberAccess across a full render + tab-switch + expand interaction cycle"
        status: pass
    human_judgment: false
  - id: D4
    description: "A suspended recipient renders with a distinct treatment in the By-person tab (family.statusSuspended badge) and is never omitted, per A-7"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#a suspended recipient renders with a distinct treatment in the By-person tab, never omitted"
        status: pass
    human_judgment: false
  - id: D5
    description: "A realistic >=40-char folder name, item name, and email each truncate with a title attribute in both tabs, without row overflow"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#a realistic long folder name, item name, and email do not overflow the row container (E6 overflow backstop)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Switching between By-folder and By-person twice does not trigger a redundant getCollectionAccessList/listItemShares fetch"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#switching tabs twice does not refetch data already resolved for the other tab"
        status: pass
    human_judgment: false
  - id: D7
    description: "Panel opens defaulted to By-folder; a loading spinner renders while both groupings' data resolve; the empty state renders sharing.emptyHeading/sharing.emptyBody when the caller shares nothing at all"
    requirement: "SHARE-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#opens defaulted to the By-folder tab"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#renders a loading spinner while both groupings' data resolve"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/SharingOverviewPanel.test.tsx#renders the empty state when the caller shares nothing at all"
        status: pass
    human_judgment: false

# Metrics
duration: 40min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 11: Sharing Overview Panel -- By Folder / By Person Summary

**`SharingOverviewPanel.tsx`: D-1's dedicated Sharing overview, By-folder/By-person tabs entirely client-side aggregated (A-8) from `useCollections()` + `getCollectionAccessList` + `listItemShares`, never `getMemberAccess`.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-06
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- **`SharingOverviewPanel.tsx` built from scratch** as a fixed-right-panel overlay (the exact `SettingsPanel.tsx` shell), with a full-width By-folder/By-person segmented toggle as the panel's primary visual anchor per UI-SPEC E6's focal-point note, opened defaulted to "By folder".
- **"By folder" tab** lists one row per collection where the caller's own `access_level` (from `listCollections()`) is `"edit"` -- correctly capturing both real owners and full-edit co-managers while excluding a folder the caller only has read/hidden-password access to. Each row shows the folder name, the reused `AvatarStack` (circle-stack variant, self excluded from the recipient set), and `sharing.sharedWithLabel`'s interpolated count; expanding reveals every recipient's own access-level badge, suspended recipients marked distinctly.
- **"By person" tab** aggregates `getCollectionAccessList` results across every edit-or-owner collection plus `listItemShares` results across every personally-shared item (items with `isShared && collectionId == null`), grouped by `user_id`. A member reachable via two distinct grants appears exactly once, with a `higherAccess`-computed summary badge on the collapsed row and the full per-grant breakdown (folder vs. item, each with its own access-level badge) on expand.
- **Never calls `getMemberAccess`** (RESEARCH.md Pitfall 2, the owner-only endpoint that answers the wrong question) -- proven by a spy assertion across a full render + tab-switch + expand interaction cycle, not merely by code inspection.
- **Suspended recipients never filtered** (A-7) -- distinct `family.statusSuspended` badge treatment in the By-person tab, and `AvatarStack`'s own established suspended ring treatment (reused, not reimplemented) in the By-folder tab.
- **Zero redundant refetch on tab switch**, by construction: the data-loading effect is keyed to `[collections, items]` (the reactive stores), never to `tab` state -- switching tabs is a pure render toggle over already-resolved data.
- **Truncation backstop**: a realistic >=40-char folder name, item name, and email all truncate with a `title` attribute in both tabs, matching this codebase's established `truncate`+`title` idiom.

## Task Commits

Both tasks (component + tests, including the Task 2 backstop/suspended/refetch tests) were committed together as they touch the same two files and were developed and verified as one coherent unit:

1. **Tasks 1+2: SharingOverviewPanel.tsx + SharingOverviewPanel.test.tsx** - `2321af5` (feat)

## Files Created/Modified

- `web/src/components/vault/SharingOverviewPanel.tsx` (new) - D-1's Sharing overview, By-folder/By-person tabs
- `web/src/components/vault/SharingOverviewPanel.test.tsx` (new) - 9 tests: tab default, loading, empty state, By-folder aggregation + edit-filter, By-person aggregation + dedup-at-higher-access, getMemberAccess-avoidance spy, truncation backstop, suspended treatment, no-redundant-refetch

## Decisions Made

- "Edit-or-owner reason to manage" implemented as `access_level === "edit"` on the caller's own `listCollections()` row -- the collection creator's row is hard-coded to `"edit"` server-side, so this single check is sufficient and was verified to correctly exclude a read-only collection (its `getCollectionAccessList` is asserted never called).
- Added a "highest access level" summary badge on each By-person row, computed via `higherAccess` across all of that person's distinct grants -- the most literal reading of the task's "a member reachable via both paths appears exactly once, at the higher access level" behavior text, and a genuinely useful glance-level answer to "what CAN this person see, at most" without hiding the underlying per-grant breakdown (still shown on expand).
- The caller's own row is excluded from both the By-folder recipient count/expanded list and the By-person aggregation (a caller wouldn't want to see themselves listed as someone they share with).
- No new dictionary keys were added -- kind distinction between folder and item entries in the By-person breakdown uses icons (`Folder` vs `Share2`) rather than new textual labels, since `files_modified` scoped this plan to `SharingOverviewPanel.*` only and every needed copy key already existed from Plan 26-06's dictionary pass.

## Deviations from Plan

None - plan executed exactly as written. `files_modified` matches the plan's declared list exactly (`SharingOverviewPanel.tsx`, `SharingOverviewPanel.test.tsx`); no other files were touched, verified via `git status --short` before the commit.

## Issues Encountered

- A fresh worktree had no `node_modules` in `web/` or `packages/pv-ui/` and no WASM artifacts -- resolved per the environment note (`npm ci` in both, `bash scripts/build-wasm.sh`) before `npx tsc --noEmit`/`npx vitest run` could run. No test in this plan touches real WASM/crypto (the component's own data sources are pure REST fetches plus already-decrypted store data), so the WASM build was only needed to satisfy the sibling test suite during the full-suite regression run, not this plan's own tests.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `SharingOverviewPanel.tsx` is ready for Sidebar wiring (a sibling plan's Sidebar trigger, `sharing.navLabel`/`Share2` icon per the UI-SPEC's component inventory) -- it only needs an `onClose` callback, matching `SettingsPanel`'s own prop contract exactly.
- No blockers for downstream plans in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigate | `web/src/components/vault/SharingOverviewPanel.tsx` | T-26-18 (Information Disclosure, from this plan's own threat register, high severity): this panel could over- or under-report exposure if its aggregation source were wrong. Mitigated by sourcing exclusively from calls the caller is already server-authorized for (`useCollections()`, `getCollectionAccessList`, `listItemShares`), each independently gated by the server's own `Membership<*, RequireRead/RequireEdit>` extractors -- this component adds no new authorization surface and never calls `getMemberAccess`, verified by a spy assertion. Reviewer should check: any future edit to this file that adds a new data source re-derives its access filter from the caller's OWN membership, never from an owner-only or cross-account endpoint. |
| threat_flag: rendering-honesty | `web/src/components/vault/SharingOverviewPanel.tsx` | Under-reporting risk specific to this panel's OWN aggregation logic (distinct from the mitigate row above, which covers the data SOURCE): the "By folder" tab's `access_level === "edit"` filter is a genuine, intentional narrowing (a read-only collaborator legitimately isn't "sharing" someone else's folder) -- but a future edit that widens or narrows this predicate incorrectly could make the panel silently omit or fabricate what the caller is exposing, which is exactly the dishonesty this panel exists to prevent (26-CONTEXT.md's whole D-1 framing). Reviewer should check: any change to the edit-or-owner predicate is re-verified against a live `getCollectionAccessList` call count assertion (the read-only-exclusion test in this plan), not just a visual spot-check. |
| threat_flag: accept (per this plan's own threat register) | `web/src/components/vault/SharingOverviewPanel.tsx` | T-26-19 (Repudiation, low severity, accepted): a stale aggregation can show a recipient who was just revoked, until the next store re-render triggered by `onSharedRevisions`/personal-snapshot re-merge (Plan 26-05/A-5). No invalidation hook was added here, matching the same eventual-consistency posture `shareRecipients.ts` (Plan 26-06) already accepted for `AvatarStack`. Reviewer should check: this panel's data is never treated as an access-control DECISION anywhere downstream -- it is a display-only "what am I exposing" summary. |

## Self-Check: PASSED

- FOUND: web/src/components/vault/SharingOverviewPanel.tsx
- FOUND: web/src/components/vault/SharingOverviewPanel.test.tsx
- FOUND commit 2321af5 in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run src/components/vault/SharingOverviewPanel.test.tsx: 9/9 tests passing
- cd web && npx vitest run (full suite): 74 files, 677 tests passing, zero regressions

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 11*
*Completed: 2026-08-06*
