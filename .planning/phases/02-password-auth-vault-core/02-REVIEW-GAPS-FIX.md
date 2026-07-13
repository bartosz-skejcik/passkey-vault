---
phase: 02-password-auth-vault-core
fixed_at: 2026-07-13T23:04:38Z
review_path: .planning/phases/02-password-auth-vault-core/02-REVIEW-GAPS.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 02 (Gap Closure): Code Review Fix Report

**Fixed at:** 2026-07-13T23:04:38Z
**Source review:** .planning/phases/02-password-auth-vault-core/02-REVIEW-GAPS.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (WR-01..WR-04, plus IN-03's untranslated sidebar strings per explicit instruction — other Info items skipped by design)
- Fixed: 5
- Skipped: 0

Each fix was verified with `cd web && npm test` (full suite, 145/145 passing) and
`npx tsc --noEmit` (zero errors) after every change, and committed atomically.

## Fixed Issues

### WR-01: Context-menu "Edit" opens the panel in view mode, not edit mode

**Files modified:** `web/src/app/page.tsx`, `web/src/components/vault/ItemList.tsx`,
`web/src/components/vault/ItemList.test.tsx`, `web/src/components/vault/ItemRow.tsx`,
`web/src/components/vault/ItemRow.test.tsx`, `web/src/components/vault/DetailPanel.tsx`,
`web/src/components/vault/DetailPanel.test.tsx`
**Commit:** 203b007
**Applied fix:** Gave `DetailPanel` an optional `initialMode?: "view" | "edit"` prop,
re-applied whenever `item.id` or `initialMode` changes (needed because the panel is
never remounted between selections, and a same-item re-edit request must still take
effect). `ItemRow` gained an optional `onEditRequest?: (item) => void` prop, wired
to `ItemContextMenu`'s `onEdit` instead of reusing the plain-click `onClick` handler
(falls back to `onClick` when not supplied, so untouched call sites/tests keep
working). `page.tsx` now tracks `openInEditMode` state: `handleSelectItem` (plain
click) clears it, `handleEditRequest` (context-menu Edit) sets it and is threaded
through `ItemList`'s new `onEditRequest` prop. Added tests for the new prop wiring
in `ItemRow.test.tsx`/`ItemList.test.tsx` and for `initialMode` re-entry in
`DetailPanel.test.tsx`.

### WR-02: `handleMove` fire-and-forget produced unhandled promise rejections with no user feedback

**Files modified:** `web/src/lib/vault/errorToast.ts` (new),
`web/src/components/vault/ErrorToast.tsx` (new), `web/src/lib/i18n/dictionary.ts`,
`web/src/components/vault/ItemContextMenu.tsx`,
`web/src/components/vault/ItemContextMenu.test.tsx`, `web/src/app/page.tsx`
**Commit:** 79e0fa5
**Applied fix:** `handleMove` now attaches `.catch()` to the `updateVaultItem(...)`
promise (both 409-after-resync and network/500 failures are surfaced — the fix
suggestion's RevisionConflictError-only special-case was intentionally widened,
since the review's own Issue text says every failure needs feedback, not just
non-conflict ones). Because the menu closes synchronously (same as every other
menu action, and required to keep the existing "closes immediately" test passing),
the failure can't be shown inline once the component unmounts, so it routes through
a new minimal `showErrorToast()` singleton (mirroring `copyToast.ts`'s existing
mount-once-globally pattern that `handleCopy` already relies on for identical
"menu already closed, still need feedback" reasons) rendered via a new `ErrorToast`
component mounted in `page.tsx` alongside `CopyToast`. Added `error.itemMoveFailed`
to the PL/EN dictionary and a new failure-path test in
`ItemContextMenu.test.tsx`. Removed the misleading "fire-and-forget is acceptable"
comment.

### WR-03: `setPreview` called inside the `setCharset` updater (impure updater)

**Files modified:** `web/src/components/generator/GeneratorDialog.tsx`,
`web/src/components/generator/GeneratorPopover.tsx`
**Commit:** 7b83dfe
**Applied fix:** In both components, `toggleCharsetClass` now computes `next`
directly from the current `charset` closure value, calls `setCharset(next)`, then
calls `regenerate(mode, charLength, wordCount, next)` outside the updater —
exactly matching the review's suggested fix. Verified against the existing
`GeneratorDialog.test.tsx`/`GeneratorPopover.test.tsx` suites (all passing).

### WR-04: `ItemRow`'s `role="button"` container held interactive descendants

**Files modified:** `web/src/components/vault/ItemRow.tsx`,
`web/src/components/vault/ItemRow.test.tsx`
**Commit:** 64d3d65
**Applied fix:** Restructured the row: the outer element is now a plain `<div>`
(no `role`, no `tabIndex`, no manual `onKeyDown`) that only owns
`onContextMenu` and the row's visual/selected styling. A new inner native
`<button type="button" data-testid="item-row-select-{id}">` wraps the icon +
name/subtitle block and is the sole activation target — Enter/Space activation
and focusability come for free from being a real `<button>`, so the manual
keydown handler was removed entirely. The kebab-trigger + `ItemContextMenu`
dropdown wrapper remain siblings of this button (not descendants), resolving the
ARIA "no focusable content inside role=button" violation. Updated
`ItemRow.test.tsx`'s click test to target the new `item-row-select-{id}` testid
and added a regression test asserting no `role="button"` on the outer container.
The right-click/context-menu and "selected styling" tests were unaffected since
`onContextMenu`, the row-level testid, and the selected/highlight classes all stay
on the outer container.

### IN-03: Untranslated hardcoded Polish sidebar strings

**Files modified:** `web/src/lib/i18n/dictionary.ts`,
`web/src/components/shell/Sidebar.tsx`, `web/src/components/shell/Sidebar.test.tsx`
**Commit:** 6eb4a93
**Applied fix:** Added `sidebar.account` (pl: "Konto", en: "Account") and
`aria.toggleTheme` (pl: "Przełącz motyw", en: "Toggle theme") to the dictionary,
per the review's suggested keys. Replaced the two hardcoded literals in
`Sidebar.tsx` with `t("sidebar.account")` and `aria-label={t("aria.toggleTheme")}`.
Added a regression test asserting both strings now resolve through `t(...)`
(other Info items — IN-01, IN-02, IN-04 — were explicitly out of scope for this
fix pass and left unchanged).

## Skipped Issues

None — all 5 in-scope findings were fixed.

---

_Fixed: 2026-07-13T23:04:38Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
