---
phase: 26-web-app-sharing-ui-family-management
plan: 12a
subsystem: ui
tags: [typescript, react, i18n, vitest, sharing, collections]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-05's useCollections()/collections.ts client store"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-08's ShareDialog.tsx (folder-create variant)"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-09's ItemContextMenu.tsx/DetailPanel.tsx Share entry points"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-10's Sidebar.tsx personal-folder kebab"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-12's declared eventual-consistency-gap threat flag"
provides:
  - "web/src/lib/vault/collections.ts::refreshCollectionsNow() — exported manual refresh trigger"
  - "ShareDialog.tsx's folder-create variant invalidates the collections store immediately on success"
  - "share.shareThisItem / share.shareThisFolder — dedicated entry-point dictionary keys, distinct from ShareDialog's submit CTAs"
affects: [26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "collections.ts exports a manual refresh trigger (refreshCollectionsNow) alongside its existing unlock-triggered private refresh, for callers that mutate collection state outside the unlock/onSharedRevisions lifecycle — the caller wraps the call in try/catch to keep it best-effort, since the store itself does not swallow errors."

key-files:
  created: []
  modified:
    - web/src/lib/vault/collections.ts
    - web/src/components/vault/ShareDialog.tsx
    - web/src/components/vault/ShareDialog.test.tsx
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/vault/ItemContextMenu.tsx
    - web/src/components/vault/ItemContextMenu.test.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/DetailPanel.test.tsx
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/shell/Sidebar.test.tsx

key-decisions:
  - "The collections-store refresh is triggered from inside ShareDialog.tsx::submitFolderVariant (the single production code path both Sidebar's two entry points and FamilyTab's CollectionPicker 'create new' funnel through), not duplicated at each of the 3 call sites that open the dialog — one fix point, both consumers closed."
  - "Placed the refresh call immediately after createCollection succeeds, before the member-grant loop and any seed-item moves — the collection genuinely exists server-side and the caller already holds sealedKeyForSelf at that point, so the picker should reflect it even if a later step in the same submit (a recipient's grant, a seed move) partially fails."
  - "The refresh is wrapped in try/catch at the call site (not inside refreshCollectionsNow itself) — a transient refresh failure must never turn an otherwise-successful folder creation into a visible error; the existing unlock/onSharedRevisions triggers still catch it up later."
  - "Two new dictionary keys, not four — ItemContextMenu.tsx's menu text and DetailPanel.tsx's aria-label share ONE key (share.shareThisItem), and Sidebar's kebab aria-label + menu text share ONE key (share.shareThisFolder), since both entry points at each surface point to the identical action from the caller's perspective."
  - "share.shareThisFolder's literal ('Udostępnij ten folder' / 'Share this folder') matches 26-UI-SPEC.md's own E2 prose verbatim, per gap_2's instruction to prefer an existing UI-SPEC literal over inventing one. share.shareThisItem has no UI-SPEC literal to match (the spec only described the item entry point generically as 'Share…') so it mirrors the same plain register."

requirements-completed: []

coverage:
  - id: D1
    description: "A newly-created collection (via ShareDialog's folder-create variant) is observable through collections.ts's own getCollections()/useCollections() read path immediately after submit, without waiting for a separate unlock/sync tick"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#collections store integration (26-12a gap fix) > a newly-created folder is observable through getCollections() immediately after submit, without a separate unlock/sync tick"
        status: pass
    human_judgment: false
  - id: D2
    description: "The collections store's own cached WasmCollectionKey handle (populated by its own unsealCollectionKey call inside the refresh) is never the dialog's own already-freed submit-time handle -- no leak/double-free introduced into collections.ts's lock-lifecycle discipline"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#collections store integration (26-12a gap fix) > does not leak a WasmCollectionKey handle -- the refreshed collection's unwrapped key is a freshly cached one, not the dialog's own freed submit-time handle"
        status: pass
    human_judgment: false
  - id: D3
    description: "ItemContextMenu.tsx's Share menu entry and DetailPanel.tsx's Share icon aria-label render the dedicated share.shareThisItem key, not ShareDialog's own share.ctaItem submit CTA"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemContextMenu.test.tsx#shows a Share… entry for a personal item, opening ShareDialog with scope: {kind: 'item', item}"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/DetailPanel.test.tsx#renders a Share2 icon button before Edit, opening ShareDialog with scope: {kind: 'item', item}"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sidebar.tsx's personal-folder kebab (trigger aria-label AND its one menu action) renders the dedicated share.shareThisFolder key, not ShareDialog's own share.ctaFolder submit CTA"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#an existing personal folder row exposes a kebab with exactly one action, opening ShareDialog folder-create variant seeded with that folder's id"
        status: pass
    human_judgment: false
  - id: D5
    description: "share.ctaItem / share.ctaFolder are untouched and still back ShareDialog's own submit CTA in both the item and folder variants"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ShareDialog.test.tsx#folder-create variant (brand new, no seed) > shows share.ctaFolder as the submit label"
        status: pass
      - kind: other
        ref: "grep confirms ShareDialog.tsx:450's ctaKey ternary (isFolder ? share.ctaFolder : share.ctaItem) is the only remaining production reference to either key"
        status: pass
    human_judgment: false

# Metrics
duration: ~45min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 12a: Collections Store Invalidation + Entry-Point Copy Fix Summary

**Closes two gaps wave-5 executors correctly declared instead of silently shipping: a freshly-created shared folder is now immediately visible in `CollectionPicker` (`refreshCollectionsNow()` in `collections.ts`, called from `ShareDialog.tsx` after a successful `createCollection`), and the three Share entry points (`ItemContextMenu.tsx`, `DetailPanel.tsx`, `Sidebar.tsx`'s kebab) now render dedicated `share.shareThisItem`/`share.shareThisFolder` labels instead of reusing `ShareDialog`'s own submit-CTA copy.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-06
- **Tasks:** 2 (gap 1: collections store invalidation; gap 2: entry-point copy)
- **Files modified:** 10 (0 created, 10 modified)

## Accomplishments

- **Gap 1 closed — no more stale `CollectionPicker`.** `web/src/lib/vault/collections.ts` gains `refreshCollectionsNow()`, a thin exported wrapper around the module's existing private `refreshCollections()` (same lock-race safety: re-checked before and after each internal `await`). `ShareDialog.tsx::submitFolderVariant` calls it immediately after `createCollection` succeeds, wrapped in a local `try/catch` so a transient refresh failure never turns an otherwise-successful folder creation into a visible error. This is a single fix point — it closes the gap for *every* caller that opens `ShareDialog`'s folder-create variant: Sidebar's "+ New shared folder" trigger, the personal-folder kebab's seeded variant, and `FamilyTab`'s `CollectionPicker` "create new" flow (Plan 26-12).
- **Proven by a real readback, not a spy.** `ShareDialog.test.tsx` gains a "collections store integration" describe block that renders the real (unmocked) `@/lib/vault/collections.ts` module alongside `ShareDialog`, submits a folder creation with pass-through name en/decoding mocks, and asserts `getCollections()` — the exact getter `CollectionPicker.tsx`'s `useCollections()` hook consumes — returns the new collection by name. A second test proves no `WasmCollectionKey` handle leak: the store's own freshly-cached handle (from its own `unsealCollectionKey` call) is never the dialog's own already-freed submit-time handle.
- **Gap 2 closed — entry points no longer borrow submit-button copy.** Two new dictionary keys, `share.shareThisItem` ("Udostępnij ten item" / "Share this item") and `share.shareThisFolder` ("Udostępnij ten folder" / "Share this folder" — matching 26-UI-SPEC.md's own E2 literal verbatim), replace the reused `share.ctaItem`/`share.ctaFolder` at all three declared call sites: `ItemContextMenu.tsx`'s "Share…" menu text, `DetailPanel.tsx`'s Share icon `aria-label`, and `Sidebar.tsx`'s personal-folder kebab (both its trigger `aria-label` and its one menu action's text). `share.ctaItem`/`share.ctaFolder` are untouched and still back `ShareDialog.tsx`'s own submit button in both variants (verified: `ShareDialog.tsx:450`'s `ctaKey` ternary is the only remaining production reference to either key).

## Task Commits

Each gap was committed atomically:

1. **Gap 1: Invalidate collections store after folder creation** — `7fe6cb4` (fix)
2. **Gap 2: Dedicated entry-point copy for the three Share triggers** — `5575de4` (fix)

## Files Created/Modified

- `web/src/lib/vault/collections.ts` — new exported `refreshCollectionsNow()`
- `web/src/components/vault/ShareDialog.tsx` — calls `refreshCollectionsNow()` after a successful `createCollection` in `submitFolderVariant`, best-effort (try/catch)
- `web/src/components/vault/ShareDialog.test.tsx` — new mocks for `@/lib/vault/collections`'s real dependencies (`subscribeLockState`, `isUnlocked`, `unsealCollectionKey`, `decryptItemForCollection`, `listCollections`); new "collections store integration" describe block (2 tests: readback proof, handle-leak guard)
- `web/src/lib/i18n/dictionary.ts` — added `share.shareThisItem` / `share.shareThisFolder`
- `web/src/components/vault/ItemContextMenu.tsx` — "Share…" menu text now `share.shareThisItem`
- `web/src/components/vault/ItemContextMenu.test.tsx` — assertion that the entry renders `share.shareThisItem`
- `web/src/components/vault/DetailPanel.tsx` — Share icon `aria-label` now `share.shareThisItem`
- `web/src/components/vault/DetailPanel.test.tsx` — assertion on the new `aria-label` value
- `web/src/components/shell/Sidebar.tsx` — kebab trigger `aria-label` and menu action text now both `share.shareThisFolder`
- `web/src/components/shell/Sidebar.test.tsx` — assertions on both the trigger `aria-label` and the menu action's text content

## Decisions Made

See `key-decisions` in frontmatter. The two worth restating: (1) the collections-store refresh lives in `ShareDialog.tsx` itself — the one production code path every folder-creation entry point funnels through — rather than being duplicated at each of the 4 components that render `ShareDialog`; (2) `share.shareThisFolder` reuses 26-UI-SPEC.md's own literal ("Udostępnij ten folder") verbatim per gap_2's explicit instruction to prefer an existing spec literal over inventing new copy, while `share.shareThisItem` had no such literal to match and was written in the same plain, non-playful register.

## Deviations from Plan

None — both gaps were fixed exactly as scoped in the objective, with no architectural changes and no scope creep beyond the two declared gaps.

### Auto-fixed Issues

None beyond the declared gap fixes themselves.

---

**Total deviations:** 0.
**Impact on plan:** None — targeted, in-scope fixes only.

## Issues Encountered

- A fresh worktree had no `node_modules` in `web/`/`packages/pv-ui/` and no WASM artifacts — resolved via `npm ci` in both plus `bash scripts/build-wasm.sh`, per the environment note.
- No other issues. Both gaps' fixes were self-contained; no unrelated test breakage.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Both wave-5-declared gaps are closed; no open follow-up items remain from Plans 26-09/26-10/26-12 regarding these two specific defects.
- `refreshCollectionsNow()` is now available for any future caller that mutates collection state outside the unlock/`onSharedRevisions` lifecycle and needs the store to reflect it immediately.
- No blockers for downstream plans in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: resolved (closes 26-12-SUMMARY.md's own `eventual-consistency-gap`) | `web/src/lib/vault/collections.ts`, `web/src/components/vault/ShareDialog.tsx` | Plan 26-12 declared and accepted a gap: a freshly-created collection was invisible in `CollectionPicker` until the next unlock/sync tick, since `collections.ts`'s module-singleton store was never invalidated after `createCollection`. This plan closes it with `refreshCollectionsNow()`, called from `ShareDialog.tsx` immediately after a successful `createCollection`. Residual, accepted risk: the refresh call is best-effort (wrapped in `try/catch`) — if the refresh itself transiently fails (e.g. a dropped network request to `listCollections`), the folder is still created and usable, but the picker won't show it until the NEXT unlock/sync tick, reverting to the exact pre-fix behavior for that one edge case. This is a deliberate trade-off (a failed refresh must never turn a successful share into a visible error) rather than an oversight, and is bounded — it only affects the rare case where the refresh call itself fails, not the common case this plan targets. |
| threat_flag: none (copy-only change) | `web/src/lib/i18n/dictionary.ts`, `web/src/components/vault/ItemContextMenu.tsx`, `web/src/components/vault/DetailPanel.tsx`, `web/src/components/shell/Sidebar.tsx` | Gap 2's fix is pure copy substitution at existing, already-reviewed call sites — no new crypto, network surface, access-control path, or trust boundary. `share.ctaItem`/`share.ctaFolder` remain exactly where they were (ShareDialog's own submit CTAs); the entry-point buttons' `onClick` handlers and suppression guards (`item.undecryptable`, collection-scope backstop) are byte-for-byte unchanged — only the `t(...)` key argument passed to each `aria-label`/text node changed. No new threat surface introduced. |

## Known Stubs

None. Both fixes are fully wired: the collections-store refresh performs a real re-fetch/re-decrypt against the live `listCollections()`/`unsealCollectionKey`/`decryptItemForCollection` path (proven by a real readback test, not a mock spy), and both new dictionary keys carry real PL+EN copy consumed by production code, not placeholder text.

## User-Visible State Correctness (gap 1)

Before this fix, no user-visible state was ever *wrong* — the folder and grants genuinely existed server-side the instant `createCollection`/`addCollectionMember` succeeded, and the server remained the source of truth throughout. The bug was purely a **stale client read**: `CollectionPicker`'s rendered list (backed by `collections.ts`'s module-singleton cache) simply hadn't refreshed yet, so the caller could not select the folder they just created until an unrelated trigger (a subsequent unlock, or A-5's `onSharedRevisions` watermark tick) happened to fire a refresh. No data was lost, corrupted, or misrepresented — only temporarily absent from one specific picker's rendered list.

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 12a*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: web/src/lib/vault/collections.ts (refreshCollectionsNow exported)
- FOUND: web/src/components/vault/ShareDialog.tsx (refreshCollectionsNow call in submitFolderVariant)
- FOUND: web/src/components/vault/ShareDialog.test.tsx (2 new tests in "collections store integration (26-12a gap fix)")
- FOUND: web/src/lib/i18n/dictionary.ts (share.shareThisItem, share.shareThisFolder)
- FOUND: web/src/components/vault/ItemContextMenu.tsx (share.shareThisItem)
- FOUND: web/src/components/vault/DetailPanel.tsx (share.shareThisItem aria-label)
- FOUND: web/src/components/shell/Sidebar.tsx (share.shareThisFolder, both call sites)
- FOUND commit 7fe6cb4 in git log
- FOUND commit 5575de4 in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run (full suite): 77 files, 742 tests passing, zero regressions
- grep confirms share.ctaItem/share.ctaFolder's only remaining production reference is ShareDialog.tsx:450's own submit-CTA ternary
