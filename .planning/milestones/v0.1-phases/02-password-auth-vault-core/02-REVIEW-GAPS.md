---
phase: 02-password-auth-vault-core
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - crates/pv-server/src/routes/vault.rs
  - web/src/components/generator/GeneratorDialog.tsx
  - web/src/components/generator/GeneratorPopover.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/ItemContextMenu.tsx
  - web/src/components/vault/ItemRow.tsx
  - web/src/lib/format/relativeTime.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/search.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/types.ts
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 02 (Gap Closure): Code Review Report

**Reviewed:** 2026-07-14
**Depth:** standard
**Files Reviewed:** 14 (source; test files read for coverage context)
**Status:** issues_found

## Summary

This review covers only the gap-closure diff `58a0b2f..HEAD` (plans 02-07/02-08:
sidebar restructure + category filtering, `GeneratorDialog`, `updated_at`
threading + `relativeTime`, `ItemContextMenu`, `ItemRow` button→div conversion,
`DetailPanel` reveal toggle, `GeneratorPopover` viewport fix).

**The five explicitly-flagged security concerns all check out clean:**

1. **Revealed-state leak across items / after lock** — `revealedKeys` is reset
   via `useEffect(..., [item.id])` on every item switch, AND `DetailPanel`
   unmounts on lock (page.tsx renders it only when `selectedItem !== null`, and
   the store empties `items` on the lock event, so `selectedItem` becomes
   `null`). No plaintext survives a lock. CVV stays permanently masked
   (`MONO_FIELDS` ∧ ¬`REVEALABLE_FIELDS`). Clean.
2. **Clipboard actions bypassing auto-clear** — every copy path
   (`ItemContextMenu.handleCopy`, `GeneratorDialog.handleCopy`,
   `DetailPanel.handleCopy`) routes through `copyWithAutoClear(...)`. No raw
   `navigator.clipboard.writeText`. Clean.
3. **`updated_at` threading leaking sensitive data** — it is server-side
   metadata (`datetime('now')`) only; nothing plaintext is added to any
   server-visible column or wire type. Clean.
4. **Event-bubbling containment** — the kebab/menu wrapper and the
   `DeleteConfirmDialog` wrapper both `stopPropagation`, so no nested action
   re-triggers the row's `onClick`. Clean.
5. **`vault.rs` `RETURNING` refactor** — `ON CONFLICT DO NOTHING RETURNING`
   correctly maps `fetch_optional` `None` to the same conflict signal
   `rows_affected() == 0` produced; the 404-vs-409 disambiguation on `update`
   is preserved. Clean.

Remaining findings are correctness / robustness / a11y defects (no
BLOCKER/Critical).

## Warnings

### WR-01: Context-menu "Edit" opens the panel in view mode, not edit mode

**File:** `web/src/components/vault/ItemRow.tsx:126`, `web/src/components/vault/ItemContextMenu.tsx:104-107`
**Issue:** `ItemRow` wires the menu's edit action as `onEdit={onClick}`, and
`onClick` is `() => onSelect(item)` (ItemList.tsx:43), which only selects the
item. `DetailPanel` always mounts in `mode="view"` (DetailPanel.tsx:48) with no
prop to start in edit. So choosing "Edytuj/Edit" from the context menu does the
exact same thing as a plain row click — it opens the read-only view, not the
edit form. The menu item does not perform the action its label promises; the
user then has to click the pencil inside the panel anyway.
**Fix:** Thread an intent to open in edit mode, e.g. give `DetailPanel` an
`initialMode?: "view" | "edit"` prop and pass a distinct handler for the menu:
```tsx
// page.tsx: track how the panel was opened
const [openInEdit, setOpenInEdit] = useState(false);
// ItemRow: distinct edit handler instead of reusing onClick
onEdit={() => onEditRequest(item)}   // sets selectedItemId + openInEdit=true
// DetailPanel: const [mode, setMode] = useState(initialMode ?? "view");
```

### WR-02: `handleMove` fire-and-forget produces an unhandled promise rejection and no failure feedback

**File:** `web/src/components/vault/ItemContextMenu.tsx:97-102`
**Issue:** `void updateVaultItem(...)` discards the returned promise. But
`updateVaultItem` *throws* on every non-happy path: it re-throws
`RevisionConflictError` after re-syncing on a 409, and re-throws any other error
(network/500) as-is (store.ts:243-249). Because the promise is only `void`-ed
and never `.catch`-ed, **every** move conflict and every network failure becomes
an unhandled promise rejection, and the user gets zero feedback that the move
failed (the menu already closed). The inline comment ("RevisionConflictError
handling already re-syncs the store on 409") is misleading — re-syncing still
throws, and that throw is unhandled here.
**Fix:**
```tsx
function handleMove(folderId: string | null) {
  onClose();
  updateVaultItem(item.id, { ...item.fields, folderId }, item.revision).catch(
    (err) => {
      // RevisionConflictError already re-synced the store; surface anything else
      if (!(err instanceof RevisionConflictError)) showMoveFailedToast();
    },
  );
}
```

### WR-03: `setPreview` called inside a `setState` updater (impure updater)

**File:** `web/src/components/generator/GeneratorDialog.tsx:104-110`, `web/src/components/generator/GeneratorPopover.tsx:114-120`
**Issue:** `toggleCharsetClass` calls `regenerate(...)` — which calls
`setPreview(...)` — from *inside* the `setCharset((prev) => { ...; return next; })`
updater. React requires updater functions to be pure and free of side effects;
under StrictMode the updater is intentionally double-invoked, so
`generateCharacterPassword` (a CSPRNG call) runs twice per toggle and can emit
the "Cannot update a component while rendering a different component"-class
warnings. It happens to produce a consistent final value today, but it is a
fragile anti-pattern.
**Fix:** Compute `next` in the updater, then trigger regeneration from an effect
or after the state setter returns:
```tsx
function toggleCharsetClass(key: keyof CharacterPasswordOptions) {
  const next = { ...charset, [key]: !charset[key] };
  setCharset(next);
  regenerate(mode, charLength, wordCount, next); // outside the updater
}
```

### WR-04: `ItemRow` `role="button"` contains nested interactive descendants

**File:** `web/src/components/vault/ItemRow.tsx:65-133`
**Issue:** The button→div conversion correctly restores Enter/Space activation
(`onKeyDown` at 71-76) and `tabIndex={0}`. However the row is `role="button"`
while containing interactive descendants: the kebab `<button>` (112-120) and the
entire `ItemContextMenu` `<ul>` of `<button>`s / `<details>`. The ARIA spec
forbids interactive content inside a `button` role ("presentational children") —
assistive tech may flatten or hide the kebab and menu actions, and the double
tab-stop (row + kebab) is ambiguous. The conversion swapped an invalid
`<button>`-in-`<button>` nesting for an ARIA-invalid interactive-in-role=button
nesting; the underlying structural issue is not resolved.
**Fix:** Prefer a non-button clickable region (e.g. keep the row a plain
container with a dedicated primary click target) or move the row's activation
onto an inner element so the actions are siblings, not descendants, of the
button-roled node. At minimum, don't give the outer container `role="button"`
when it hosts other controls.

## Info

### IN-01: Move to the item's current folder is not short-circuited

**File:** `web/src/components/vault/ItemContextMenu.tsx:97-102`
**Issue:** Selecting the folder the item already lives in still fires a full
`updateVaultItem`, re-encrypting and bumping the revision + `updated_at` for a
no-op move.
**Fix:** `if (folderId === item.fields.folderId) { onClose(); return; }` before
calling `updateVaultItem`.

### IN-02: Hardcoded `localStorage` theme key literal

**File:** `web/src/components/shell/Sidebar.tsx:125`
**Issue:** `localStorage.setItem("pv-theme", next)` uses a bare string literal
while the rest of the module imports named constants
(`CLIPBOARD_SECONDS_KEY`, `AUTOLOCK_MINUTES_KEY`). A drift between this literal
and the pre-hydration script in `layout.tsx` would silently break theme
persistence.
**Fix:** Export a `THEME_STORAGE_KEY` constant and reuse it in both places.

### IN-03: Untranslated hardcoded UI strings in the sidebar

**File:** `web/src/components/shell/Sidebar.tsx:402,484`
**Issue:** `<div ...>Konto</div>` (account label) and
`aria-label="Przełącz motyw"` (theme toggle) are hardcoded Polish, bypassing the
`t(...)` dictionary that every other string in this phase uses. They will not
switch to English via the locale toggle.
**Fix:** Add `sidebar.account` / `aria.toggleTheme` keys and use `t(...)`.

### IN-04: Revealed field stays revealed across an edit→view round trip

**File:** `web/src/components/vault/DetailPanel.tsx:62-65`
**Issue:** `revealedKeys` is reset only on `item.id` change. Revealing a
password, entering edit mode, then returning to view (same `item.id`) leaves the
field revealed. Not a cross-item leak (same item the user chose to reveal) and
not persisted after lock, so low impact — but re-masking on `mode` transition
back to `view` would be more defensive for a security surface.
**Fix:** Add `mode` to the reset effect deps, or reset `revealedKeys` in
`onCreated`/when leaving edit mode.

---

_Reviewed: 2026-07-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
