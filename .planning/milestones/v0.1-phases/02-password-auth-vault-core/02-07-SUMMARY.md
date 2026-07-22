---
phase: 02-password-auth-vault-core
plan: 07
subsystem: ui
tags: [nextjs, react, rust, axum, sqlx, i18n, daisyui, dictionary, clipboard]

# Dependency graph
requires:
  - phase: 02-password-auth-vault-core (plan 05)
    provides: "web/src/lib/vault/{types,api,store,search}.ts and the create->list->search->view vertical slice this plan extends"
  - phase: 02-password-auth-vault-core (plan 06)
    provides: "DeleteConfirmDialog, lib/clipboard.ts copyWithAutoClear/readClipboardSeconds, lib/vault/copyToast.ts showCopyToast, updateVaultItem (revision+1 AD binding), functional Sidebar folders/tags nav, GeneratorPopover/lib/generator/{password,strength}.ts"
provides:
  - "VaultFilter gains an `itemType` variant; filterItems'/matchesFilter's itemType branch — the only new filtering mechanism this plan adds"
  - "Sidebar restructured into four collapsible sections (Categories/Folders/Tags/Tools); Categories exposes All Items + per-ItemType filters + an inert 'Passkeys — soon' entry"
  - "web/src/components/generator/GeneratorDialog.tsx — standalone centered-modal password generator reachable from Sidebar > Tools, copying through the existing auto-clear clipboard path"
  - "pv-server's create/list/update vault-item handlers now surface `updated_at` (RETURNING/SELECT) without loosening any user_id/revision ownership predicate"
  - "web/src/lib/format/relativeTime.ts — formatRelativeTime(updatedAt, t, locale, now) bucketed just-now/minutes/hours/days + 30-day date fallback, SQLite-timestamp normalization"
  - "web/src/components/vault/ItemContextMenu.tsx — kebab/right-click action menu (type-appropriate copy, Move-to-folder via the existing updateVaultItem, Edit via the row's own onClick, Delete via DeleteConfirmDialog only)"
affects: [03 (passkey enrollment will eventually need to flip the Passkeys sidebar entry from inert to functional and may want the same context-menu pattern for passkey-specific actions)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GeneratorDialog deliberately duplicates GeneratorPopover's generate()/regenerate() shape rather than sharing a hook — a centered modal vs. an anchored dropdown are different enough visual containers that the plan's own acceptance criteria required file-disjointness (grep -c GeneratorPopover == 0) to keep the two gap-closure surfaces independently reviewable"
    - "ItemRow's outer element changed from a native <button> to a <div role=\"button\" tabIndex={0}> — a native <button> cannot legally contain another interactive <button> (the kebab trigger), and this project's rule is to fix that structurally rather than special-case around it"
    - "Event-bubbling containment: a single stopPropagation() at the dropdown-wrapper level (not on every individual menu action) plus a second stopPropagation() wrapper around the conditionally-rendered DeleteConfirmDialog — both needed once ItemRow's own onClick became reachable by any DOM descendant click, which wasn't a concern while the row was a plain button with no nested interactive children"
    - "ItemContextMenu is state-driven via DaisyUI's `dropdown-open` class (not the framework's default focus-within collapse) because a right-click trigger doesn't reliably move DOM focus the way a click does — closing relies on a document-level pointerdown listener scoped to the menu's wrapper ref"

key-files:
  created:
    - web/src/components/generator/GeneratorDialog.tsx
    - web/src/lib/format/relativeTime.ts
    - web/src/components/vault/ItemContextMenu.tsx
  modified:
    - web/src/lib/vault/types.ts
    - web/src/lib/vault/search.ts
    - web/src/lib/vault/api.ts
    - web/src/lib/vault/store.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/shell/Sidebar.tsx
    - web/src/components/vault/ItemRow.tsx
    - crates/pv-server/src/routes/vault.rs

key-decisions:
  - "Passkeys sidebar entry is rendered as a genuinely `disabled` native button (not a styled-to-look-disabled clickable one) — enrollment stays entirely out of scope for this plan per 02-CONTEXT.md's Phase 3 boundary"
  - "GeneratorDialog reads generator/strength pure functions directly instead of wrapping GeneratorPopover, keeping the two gap-closure UI surfaces (dropdown-anchored vs. centered-modal) independently modifiable without cross-plan coupling"
  - "ItemRow's health-dot/type-badge trailing cluster is fully retired (not hidden) — the leading icon tile already communicates type, and the health-dot was an inert Phase-2 placeholder for out-of-scope HEALTH-01 (v0.3)"
  - "pv-server's INSERT/UPDATE queries add `RETURNING updated_at` and switch from `.execute()` to `.fetch_optional()`, preserving the exact same `None`-means-conflict/stale-revision disambiguation the old `rows_affected() == 0` check drove — no ownership/concurrency predicate changed, only which columns come back on success"

requirements-completed: [UI-03, VAULT-04, VAULT-06]

coverage:
  - id: D1
    description: "Sidebar groups navigation into four labeled sections (Categories/Folders/Tags/Tools); selecting a category (Logins/Cards/Identities/Notes) filters the visible item list client-side via a new VaultFilter itemType variant; the Passkeys category entry is genuinely disabled and never invokes onFilterChange"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "web/src/components/shell/Sidebar.test.tsx#Sidebar Categories/Tools restructure"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/search.test.ts#filterItems filters to items whose fields.type matches the itemType filter"
        status: pass
    human_judgment: false
  - id: D2
    description: "Sidebar's Tools section opens a standalone, self-contained GeneratorDialog (centered modal, not the existing anchored popover) whose Copy action writes through the existing auto-clearing clipboard helper and closes"
    requirement: "VAULT-04"
    verification:
      - kind: unit
        ref: "web/src/components/generator/GeneratorDialog.test.tsx"
        status: pass
      - kind: other
        ref: "grep -c GeneratorPopover web/src/components/generator/GeneratorDialog.tsx -> 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every item row shows a real, server-derived relative last-updated time (just-now/minutes/hours/days/30-day date fallback) sourced from pv-server's newly-exposed updated_at column, replacing the old static type-badge/health-dot cluster; ownership/concurrency predicates on create/list/update are unchanged"
    requirement: "VAULT-06"
    verification:
      - kind: unit
        ref: "web/src/lib/format/relativeTime.test.ts"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#renders the formatted relative time"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#create_and_list_both_include_a_non_empty_updated_at, update_response_includes_a_non_empty_updated_at"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every item row exposes a kebab button (hover/focus-revealed) and a right-click handler that both open the same ItemContextMenu without firing the row's own selection onClick; the menu offers type-appropriate copy actions (all through the existing auto-clear clipboard helper, never a raw clipboard write), a Move-to-folder submenu that reuses updateVaultItem's existing AD-binding/optimistic-concurrency path, Edit (reusing the row's own click handler), and Delete (only ever opening the existing DeleteConfirmDialog, never deleting directly)"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemContextMenu.test.tsx"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx#kebab + right-click context menu"
        status: pass
      - kind: other
        ref: "grep -c 'navigator\\.clipboard\\.writeText' web/src/components/vault/ItemContextMenu.tsx -> 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "End-to-end in a real browser: expand Categories and filter by each item type, confirm Passkeys stays inert; open the Tools generator, generate and copy a password, confirm it lands on the OS clipboard and auto-clears; confirm item rows show a believable, updating relative time; right-click and kebab-click a row, exercise every menu action (copy, move to a folder, edit, delete-with-confirmation) and confirm each behaves identically to its pre-existing counterpart"
    verification: []
    human_judgment: true
    rationale: "Exercises real OS clipboard semantics, DaisyUI dropdown-open visual layering, and multi-control interaction sequencing (right-click vs. kebab vs. outside-click-to-close) that unit tests approximate but cannot fully confirm; project config sets human_verify_mode: end-of-phase, so this is deferred to phase-level verification alongside 02-06's outstanding UAT items."

duration: ~50min
completed: 2026-07-14
status: complete
---

# Phase 02 Plan 07: Gap Closure — Sidebar Categories/Tools, Relative Time, Item Context Menu Summary

**Closes UAT gaps GAP-02-02/03/04: a Categories/Folders/Tags/Tools sidebar with a working standalone password generator, server-truthful relative "last updated" timestamps on every item row, and a kebab/right-click action menu that reuses every existing safe clipboard/concurrency/delete primitive.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 completed (all TDD RED/GREEN pairs)
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments

- `web/src/lib/vault/types.ts` + `search.ts`: `VaultFilter` gains an `itemType` variant; `filterItems`'s `matchesFilter` routes it — the single new client-side filtering mechanism this plan adds.
- `web/src/components/shell/Sidebar.tsx`: restructured into four collapsible sections — Categories (All Items + Logins/Cards/Identities/Notes + a genuinely-disabled "Passkeys — soon" entry), Folders and Tags (unchanged internals, same testids), and Tools (opens the new generator).
- `web/src/components/generator/GeneratorDialog.tsx`: standalone centered-modal password generator, structurally independent of the existing `GeneratorPopover.tsx`, copying through the same auto-clear clipboard path.
- `crates/pv-server/src/routes/vault.rs`: `create`/`list`/`update` handlers now surface `updated_at` (via `RETURNING`/`SELECT`), with every `WHERE user_id = ?` (and, for update, `AND revision = ?`) ownership/concurrency predicate unchanged.
- `web/src/lib/format/relativeTime.ts`: `formatRelativeTime` — just-now/minutes/hours/days buckets, a 30-day-and-older locale-formatted date fallback, and SQLite-timestamp-format normalization.
- `web/src/components/vault/ItemRow.tsx`: retires the static type-badge/health-dot trailing cluster in favor of the real relative-time span; root element becomes a `<div role="button">` (a native `<button>` can't legally nest the new kebab trigger `<button>`); gains a hover/focus-revealed kebab button and a right-click handler, both opening the same menu without firing the row's own selection `onClick`.
- `web/src/components/vault/ItemContextMenu.tsx`: type-appropriate copy actions (login username/password, card number, identity email, none for notes) all through `copyWithAutoClear`; a Move submenu calling the exact same `updateVaultItem(...)` DetailPanel's edit flow uses; Edit reusing the row's own click handler; Delete only ever requesting `DeleteConfirmDialog`.

## Task Commits

Each task was committed atomically (TDD RED/GREEN pairs):

1. **Task 1: Sidebar Categories/Folders/Tags/Tools restructure + GeneratorDialog (GAP-02-02)**
   - `4f8a0f7` (test) — RED: failing tests for itemType filter, Sidebar category buttons/disabled Passkeys/Tools trigger, GeneratorDialog behavior
   - `74c32b5` (feat) — GREEN: VaultFilter itemType variant, Sidebar restructure, GeneratorDialog
2. **Task 2: Server-truthful relative last-updated time on item rows (GAP-02-03)**
   - `8451ef0` (test) — RED: failing Rust integration tests + relativeTime/ItemRow/store unit tests
   - `f2ab675` (feat) — GREEN: pv-server RETURNING updated_at, web/src/lib/format/relativeTime.ts, store.ts/api.ts/types.ts threading, ItemRow relative-time rendering
3. **Task 3: Item row context menu — kebab + right-click (GAP-02-04)**
   - `0c33c86` (test) — RED: failing ItemContextMenu/ItemRow tests
   - `c63832e` (feat) — GREEN: ItemContextMenu component, ItemRow kebab/right-click wiring + stopPropagation containment

**Plan metadata:** (this commit, pending)

## Files Created/Modified

- `web/src/components/generator/GeneratorDialog.tsx` - standalone centered-modal password generator
- `web/src/lib/format/relativeTime.ts` - server-timestamp-driven relative time formatting
- `web/src/components/vault/ItemContextMenu.tsx` - kebab/right-click item action menu
- `web/src/lib/vault/types.ts` - VaultFilter itemType variant, VaultItem.updatedAt
- `web/src/lib/vault/search.ts` - filterItems itemType branch
- `web/src/lib/vault/api.ts` - ItemRow/createItem/updateItem wire shapes gain updated_at
- `web/src/lib/vault/store.ts` - updatedAt threaded through decrypt/create/update
- `web/src/lib/i18n/dictionary.ts` - sidebar/time/action/aria keys (PL/EN)
- `web/src/components/shell/Sidebar.tsx` - Categories/Folders/Tags/Tools restructure
- `web/src/components/vault/ItemRow.tsx` - relative time, kebab trigger, right-click, delete dialog wiring
- `crates/pv-server/src/routes/vault.rs` - updated_at on create/list/update responses

## Decisions Made

- Passkeys sidebar entry is a genuinely `disabled` native button, not a styled-to-look-inert clickable one — no click handler is attached at all, so even a synthetic dispatch can't trigger it.
- `GeneratorDialog` intentionally does not import or wrap `GeneratorPopover.tsx` — a centered modal and an anchored dropdown are different enough visual/interaction containers that keeping them file-disjoint (enforced by a negative grep in the plan's acceptance criteria) keeps both gap-closure surfaces independently reviewable and avoids a shared-hook abstraction neither plan actually needed.
- `ItemRow`'s trailing badge/health-dot cluster is fully removed, not hidden — the leading icon tile already communicates item type, and the health-dot was an inert Phase-2 placeholder for out-of-scope HEALTH-01 (v0.3).
- pv-server's create/update queries switch from `.execute()` + `rows_affected()` to `RETURNING ... ` + `.fetch_optional()` — the `None`-means-conflict-or-stale-revision disambiguation logic is byte-for-byte the same, only the success path now also yields the row's `updated_at`.
- A single `stopPropagation()` on the context-menu's outer dropdown wrapper (not on each of the menu's four categories of actions individually) and a second `stopPropagation()` wrapper around the conditionally-rendered `DeleteConfirmDialog` were added — required once `ItemRow`'s root itself became the row's `onClick` target with nested interactive descendants, which wasn't a concern while the row was a plain `<button>` with no nested interactive children.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Event bubbling from context-menu/delete-dialog clicks into row selection**
- **Found during:** Task 3 GREEN, while implementing ItemRow's kebab/right-click wiring
- **Issue:** Once `ItemRow`'s root element itself carries `onClick={onClick}` (item selection) and now contains nested interactive children (the kebab trigger, `ItemContextMenu`'s copy/move/edit/delete buttons, and the conditionally-rendered `DeleteConfirmDialog`), a click on any of those descendants would bubble up and also fire the row's own `onClick` — e.g. cancelling or confirming a delete would simultaneously re-select/open the item as an unwanted side effect. The plan's `<action>` text only described stopping propagation on the kebab trigger's own click handler, which is insufficient once the menu itself renders further nested buttons.
- **Fix:** Moved the `stopPropagation()` to the dropdown wrapper `<div>` (catches the kebab trigger and every `ItemContextMenu` action in one place) and added a second `stopPropagation()` wrapper `<div>` around the conditionally-rendered `DeleteConfirmDialog`.
- **Files modified:** `web/src/components/vault/ItemRow.tsx`
- **Verification:** `ItemRow.test.tsx`'s kebab/right-click describe block passes; manual trace of the click-bubbling path confirmed no `onClick` firing during any menu or delete-dialog interaction.
- **Committed in:** `c63832e` (Task 3 GREEN commit)

**2. [Rule 1 - Bug] Acceptance-criteria grep tripped by a doc-comment mention of the sibling component**
- **Found during:** Task 1 GREEN, acceptance-criteria verification pass
- **Issue:** `GeneratorDialog.tsx`'s initial doc comment explained its structural relationship to `GeneratorPopover.tsx` by name — the acceptance criteria's `grep -c "GeneratorPopover"` check (enforcing file-disjointness between the two gap-closure plans' generator surfaces) counts any occurrence, including comments, so the file failed the check despite never importing that component.
- **Fix:** Reworded the comment to describe the same design rationale without naming the sibling file.
- **Files modified:** `web/src/components/generator/GeneratorDialog.tsx`
- **Verification:** `grep -c "GeneratorPopover" web/src/components/generator/GeneratorDialog.tsx` → 0.
- **Committed in:** `74c32b5` (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes were necessary for the plan's own stated correctness (event-bubbling containment was implicit in the behavior spec's "does not call the row's onClick" requirement; the grep-check fix required no logic change). No scope creep — no new server endpoints, no new data model, no architectural changes.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Phase 2 gap closure (this plan) is complete** alongside `02-08` (the phase's other gap-closure plan, tracked separately). Combined with `02-04`/`02-05`/`02-06`, all ten of Phase 2's locked requirement IDs plus the user's UAT-requested Categories/Tools sidebar, relative-time, and context-menu refinements are now implemented.

**For Phase 3 (passkey enrollment/management):**
- The Sidebar's `sidebar-nav-passkeys` disabled entry is the exact spot Phase 3 will need to flip to a functional filter/entry point once passkey enrollment exists — currently intentionally inert, not a stub to silently leave broken.
- `ItemContextMenu.tsx`'s per-type copy-action pattern (`copyActionsFor`) is a reusable shape if Phase 3 needs a passkey-specific row action (e.g. "View passkey details") — extend the `fields.type === "login"` branch rather than forking a second menu component.
- `web/src/lib/format/relativeTime.ts` has no dependencies on vault-item-specific types (`formatRelativeTime` takes a bare optional ISO/SQLite-format string) — reusable as-is for any future server-timestamp display (e.g. a passkey's `last_used_at`).

**Human verification still outstanding** (folded into phase-level verification per `human_verify_mode: end-of-phase`): Category filter selection across all four item types plus the inert Passkeys entry; the Tools generator dialog end-to-end (generate, copy, real OS clipboard auto-clear); item-row relative time rendering and updating; kebab vs. right-click menu parity and every menu action (copy/move/edit/delete) in a real browser.

---
*Phase: 02-password-auth-vault-core*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 12 created/modified key files verified present on disk. All 6 task commit hashes verified present in git log (`4f8a0f7`, `74c32b5`, `8451ef0`, `f2ab675`, `0c33c86`, `c63832e`). `cargo test -p pv-server` (13/13) and `cd web && npm test` (132/132) both re-verified green immediately before this SUMMARY was written.
