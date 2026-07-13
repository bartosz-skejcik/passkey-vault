---
phase: 02-password-auth-vault-core
plan: 05
subsystem: vault
tags: [nextjs, react, useSyncExternalStore, vault-crud, client-side-search, i18n]

# Dependency graph
requires:
  - phase: 02-password-auth-vault-core (plan 01)
    provides: encryptItem/decryptItem/getUnlockedUserKey/subscribeLockState/isUnlocked crypto facade
  - phase: 02-password-auth-vault-core (plan 03)
    provides: "GET/POST /api/vault/items, PUT/DELETE /api/vault/items/{id}, GET/POST/DELETE /api/vault/folders* — exact wire shapes (id/enc_key/enc_data/revision, enc_name)"
  - phase: 02-password-auth-vault-core (plan 04)
    provides: apiFetch base client, i18n dictionary/LocaleProvider, lock-state singleton, MainColumn/TopBar/Sidebar shell
provides:
  - "web/src/lib/vault/{types,api,store,search}.ts — client-side vault item/folder state: fetch-decrypt-on-unlock, client-generated-id create, folder decrypt/create, tag derivation, in-memory client-side search"
  - "web/src/components/vault/{ItemList,ItemRow,DetailPanel,TypePicker,ItemForm,PasskeyPlaceholderSection}.tsx — the full create→list→search→view vertical slice UI"
  - "web/src/app/page.tsx wires TopBar search + '+ Nowy item' → TypePicker → ItemForm → ItemList/DetailPanel, replacing Plan 02-04's empty MainColumn placeholder"
affects: [02-06 (edit/delete/clipboard/generator/Sidebar-folder-filter build directly on this plan's store.ts and ItemForm.tsx)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "store.ts recombine/split bridge: server's two-column wire shape (enc_key/enc_data strings) <-> crypto facade's single combined-JSON EncryptedItem shape — the ONLY place this translation happens"
    - "Client generates item/folder ids via crypto.randomUUID() BEFORE encryption (AD binding requires the id to exist pre-encryption) — server never generates ids"
    - "useSyncExternalStore snapshot stability: useAllTags() caches a derived array (recomputed only when items itself is reassigned) rather than deriving a fresh array per render, avoiding React's getSnapshot-must-be-stable infinite-loop trap"
    - "Module-level subscribeLockState side effect in store.ts (mirrors lib/crypto/index.ts's own singleton pattern): unlock triggers fetch+decrypt, lock synchronously clears items/folders in memory"
    - "ItemForm.tsx: one component switching on fields.type (not the type prop) for TS discriminated-union narrowing, shared folder-select+tag-input block rendered identically across all 4 item types"

key-files:
  created:
    - web/src/lib/vault/types.ts
    - web/src/lib/vault/api.ts
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/search.ts
    - web/src/components/vault/ItemList.tsx
    - web/src/components/vault/ItemRow.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/TypePicker.tsx
    - web/src/components/vault/ItemForm.tsx
    - web/src/components/vault/PasskeyPlaceholderSection.tsx
  modified:
    - web/src/components/shell/TopBar.tsx
    - web/src/components/shell/MainColumn.tsx
    - web/src/app/page.tsx
    - web/src/lib/i18n/dictionary.ts

key-decisions:
  - "PasskeyPlaceholderSection extracted as a shared component (DetailPanel view mode + ItemForm's login create form both render it) — plan explicitly allowed either extraction or duplication; extraction chosen to avoid drift between the two copies"
  - "ItemForm tracks a local pendingFolder fallback alongside useFolders() so a just-created folder is selectable in the <select> immediately, without waiting on the store's own subscription re-render round-trip"
  - "ui-monospace treatment implemented via Tailwind's font-mono utility (whose font stack starts with ui-monospace) on password/card-number/CVV fields only — note body stays plain textarea, per UI-SPEC's 'secure notes are prose' rule"
  - "MainColumn.tsx (not in this plan's frontmatter files_modified list) was touched anyway — see Deviations"

requirements-completed: [VAULT-01, VAULT-02, VAULT-03, VAULT-04, UI-03]

coverage:
  - id: D1
    description: "Vault store recombines a server row's separate enc_key/enc_data columns into decryptItem's single combined-JSON shape, and splits encryptItem's combined output back into enc_key/enc_data before POSTing — round-trip proven exact"
    requirement: "VAULT-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#recombine/split round-trip"
        status: pass
    human_judgment: false
  - id: D2
    description: "Client generates the item id via crypto.randomUUID() before calling encryptItem, and the store clears its in-memory item/folder arrays the instant the vault locks (no stale plaintext survives a lock event)"
    requirement: "VAULT-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#lock/unlock subscription behavior"
        status: pass
    human_judgment: false
  - id: D3
    description: "Folder decrypt/create plumbing (useFolders/createVaultFolder) and tag derivation (useAllTags) work end-to-end against mocked encryptItem/decryptItem and the vault API client"
    requirement: "VAULT-03"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#folder plumbing"
        status: pass
    human_judgment: false
  - id: D4
    description: "searchItems matches name (case-insensitive, partial), login username, and login URL-derived domain; returns items unchanged for an empty query and [] for no match — pure in-memory, no fetch()"
    requirement: "VAULT-04"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/search.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "ItemRow renders the correct neutral type-icon per item type with no third-party favicon fetch anywhere in web/src/components/vault/; ItemList filters by search query and shows a distinct empty-results state"
    requirement: "UI-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemRow.test.tsx"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/ItemList.test.tsx"
        status: pass
      - kind: other
        ref: "grep -rc 'fetch(\\`https://' web/src/components/vault/ -> 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "ItemForm validates required name, submits a correctly-shaped ItemFields object per type (login/note asserted directly), and the shared folder-select/tag-input block (incl. inline '+ new folder' affordance) is wired to the store's real folder/tag plumbing for all 4 types"
    requirement: "VAULT-03"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemForm.test.tsx"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/TypePicker.test.tsx"
        status: pass
    human_judgment: false
  - id: D7
    description: "End-to-end in a real browser: unlock, create a login item with a new folder + tag, see it in the list immediately, open it and see decrypted fields/resolved folder name/tag chip/passkey placeholder"
    verification: []
    human_judgment: true
    rationale: "Plan's Task 3 acceptance criteria specifies a <human-check> browser verification step; project config sets human_verify_mode: end-of-phase, so this is deferred to phase-level verification rather than blocking this plan's autonomous execution."

duration: ~25min
completed: 2026-07-13
status: complete
---

# Phase 02 Plan 05: Vault Create + List + Search + Detail Summary

**The first real, demoable vault slice — create a login/card/identity/note item (with folder + freeform tags), see it appear instantly in an in-memory-searched list, and open a detail panel showing genuinely decrypted fields, all through the real server API and real AD-bound XChaCha20-Poly1305 encryption, not mocks.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 completed
- **Files modified:** 15 (11 created, 4 modified) — includes `MainColumn.tsx`, touched as a Rule 2 deviation (see below), beyond this plan's originally-scoped 12 files_modified.

## Accomplishments

- `web/src/lib/vault/store.ts`: the recombine/split bridge between the server's two-opaque-column wire shape (`enc_key`/`enc_data`) and the crypto facade's single combined-JSON `EncryptedItem` shape, client-generated item/folder ids via `crypto.randomUUID()`, lock/unlock-driven fetch-decrypt-clear (T-02-19), and folder decrypt/create + tag-derivation plumbing (`useFolders`/`createVaultFolder`/`useAllTags`) ready for the form layer — all built and TDD-proven in Task 1.
- `web/src/lib/vault/search.ts`: instant, purely in-memory `searchItems` over name/username/login-URL-domain — zero network calls (VAULT-04).
- `web/src/components/vault/{ItemList,ItemRow,DetailPanel}.tsx`: the read-mode vault UI — 64px rows with neutral type-icons (no favicon fetch anywhere, T-02-18 mitigated and grep-audited), selected-row styling, search-filtered list with a distinct empty-results state, and a view-mode detail panel resolving folder names/tag chips and rendering the inert login passkey placeholder.
- `web/src/components/vault/{TypePicker,ItemForm,PasskeyPlaceholderSection}.tsx`: the 4-tile type picker and the full create flow — required-name validation, per-type field sets exactly matching UI-SPEC (mono-masked password/card-number/CVV, plain-prose note body), and a shared folder-select (with inline "+ new folder") + tag-input block identical across all four types (VAULT-03's organization model reachable at data-entry time).
- `web/src/app/page.tsx` + `TopBar.tsx`: search is live end-to-end, "+ Nowy item" opens TypePicker → ItemForm in the same side-panel slot the detail view uses, and the whole vertical slice (create → list → search → open) now replaces Plan 02-04's static empty placeholder.

## Task Commits

Each task was committed atomically (TDD RED/GREEN pairs for Tasks 1 and 3):

1. **Task 1: Vault types, API client, store, search index**
   - `1cf6004` (test) — RED: failing tests for recombine/split round-trip, lock/unlock subscription, folder/tag plumbing, search
   - `a322177` (feat) — GREEN: types.ts, api.ts, store.ts, search.ts implemented, all tests pass
2. **Task 2: List + detail view (read mode)**
   - `294a728` (feat) — ItemRow/ItemList/DetailPanel + TopBar search wiring + page.tsx real children + dictionary keys + MainColumn conditional empty state (deviation, see below)
3. **Task 3: Type picker + create forms**
   - `88b38b0` (test) — RED: failing tests for TypePicker and ItemForm
   - `694f871` (feat) — GREEN: TypePicker, ItemForm, PasskeyPlaceholderSection extraction, TopBar "+ Nowy item" wiring, page.tsx create-flow state

**Plan metadata:** (this commit, pending)

## Files Created/Modified

- `web/src/lib/vault/types.ts` - `ItemType`/`ItemFields` discriminated union, `VaultItem`, `Folder`
- `web/src/lib/vault/api.ts` - `listItems/createItem/updateItem/deleteItem/listFolders/createFolder/deleteFolder` against Plan 02-03's exact wire shapes
- `web/src/lib/vault/store.ts` - recombine/split bridge, `getItems/subscribeItems/useVaultItems/createVaultItem`, `getFolders/subscribeFolders/useFolders/createVaultFolder/useAllTags`, lock/unlock side effect
- `web/src/lib/vault/search.ts` - `searchItems` (name/username/domain, in-memory)
- `web/src/components/vault/ItemRow.tsx` - 64px row, neutral type-icon, selected styling
- `web/src/components/vault/ItemList.tsx` - search-filtered list, empty-results state
- `web/src/components/vault/DetailPanel.tsx` - view-mode field rendering, folder/tag resolution, passkey placeholder
- `web/src/components/vault/TypePicker.tsx` - 4-tile type selector
- `web/src/components/vault/ItemForm.tsx` - per-type create form + shared folder/tag block
- `web/src/components/vault/PasskeyPlaceholderSection.tsx` - shared inert passkey section (DetailPanel + ItemForm)
- `web/src/components/shell/TopBar.tsx` - search input live, "+ Nowy item" wired to `onNewItem`
- `web/src/components/shell/MainColumn.tsx` - conditional empty state (see Deviations), migrated to i18n
- `web/src/app/page.tsx` - search/selection/create-flow state, renders the full vault UI
- `web/src/lib/i18n/dictionary.ts` - item-type labels, field labels, folder/tag/aria copy

## Decisions Made

- `PasskeyPlaceholderSection` extracted to a shared component rather than duplicated (plan left this as planner's discretion).
- `ItemForm` keeps a local `pendingFolder` fallback so a newly-created folder is selectable immediately, independent of `useFolders()`'s own re-render timing.
- `ui-monospace` treatment implemented via Tailwind's `font-mono` utility (its font stack literally starts with `ui-monospace`) rather than a custom class, matching the existing `LoginForm.tsx` convention.
- Discriminated-union narrowing in `ItemForm.tsx` switches on `fields.type` (state), not the `type` prop, so TypeScript can actually narrow `fields` to the right variant per branch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] MainColumn unconditionally showed the "vault is empty" heading even once real items existed**
- **Found during:** Task 2 (wiring `ItemList` as `MainColumn`'s real children)
- **Issue:** `MainColumn.tsx` (not listed in this plan's `files_modified`) hardcoded the Fuzzy-Bubbles "Vault jeszcze pusty" empty-state block unconditionally, above `{children}`. Once this plan makes real items exist, that block would still render, misleadingly claiming the vault is empty right next to a populated item list — undermining the plan's own objective of a genuinely demoable create→list loop.
- **Fix:** Added a `showEmptyState` prop (default `true` for the pre-existing self-test page's zero-arg call site), computed in `page.tsx` as `items.length === 0 && !creating`. While touching the file, also migrated its two hardcoded Polish strings to the already-existing `vault.emptyHeading`/`vault.emptyBody` dictionary keys (Plan 02-04 had added the keys but never wired this file to them).
- **Files modified:** `web/src/components/shell/MainColumn.tsx`, `web/src/app/page.tsx`
- **Verification:** `npm test && npm run build` both pass; manual trace of `page.tsx`'s `showEmptyState={items.length === 0 && !creating}` confirms the empty-state block only renders pre-first-item.
- **Committed in:** `294a728` (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] `self-test/page.tsx` and dictionary/DetailPanel needed keys/props one task ahead of their plan-listed task**
- **Found during:** Task 2 (build failure: `<TopBar />` in `self-test/page.tsx` no longer satisfied `TopBar`'s new required props; `DetailPanel`'s folder/tag rendering needed `item.noFolder`/`item.folderLabel`/`item.tagsLabel` dictionary keys the plan's text assigns to Task 3)
- **Issue:** `TopBar`'s `searchQuery`/`onSearchChange` props became required in Task 2, breaking the unrelated self-test page's zero-prop usage; and `DetailPanel` (Task 2) needed 3 dictionary keys the plan's prose explicitly schedules for Task 3's dictionary edit.
- **Fix:** Made `TopBar`'s `searchQuery`/`onSearchChange` optional with safe defaults (`""` / no-op) so `self-test/page.tsx` keeps working unmodified. Added `item.noFolder`/`item.folderLabel`/`item.tagsLabel` to the dictionary during Task 2 instead of Task 3 (Task 3's own action text already anticipates `aria.newFolder` pre-existing from Plan 02-04 and treats these as idempotent additions — no duplicate keys resulted).
- **Files modified:** `web/src/components/shell/TopBar.tsx`, `web/src/lib/i18n/dictionary.ts`
- **Verification:** `npm test && npm run build` both pass after each task; no duplicate dictionary keys (`DICTIONARY` is a `satisfies Record<...>` object literal — a duplicate key would be a TS/build error, and the build is green).
- **Committed in:** `294a728` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 — missing critical functionality, 1 Rule 3 — blocking build/task-ordering issue)
**Impact on plan:** Both fixes were necessary for the plan's own stated objective (a genuinely demoable, non-misleading create→list loop) and to keep every intermediate commit buildable. No architectural scope creep — no new tables, services, or libraries.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — no external service configuration required, no new dependencies added.

## Next Phase Readiness

**For Plan 02-06 (edit/delete/generator/clipboard/Sidebar folder-tag filtering):**

- `web/src/lib/vault/store.ts` exports `updateItem`/`deleteItem`/`deleteFolder` are already implemented in `api.ts` (not yet called by `store.ts` — Plan 02-06's job to add `updateVaultItem`/`deleteVaultItem`/`deleteVaultFolder` wrappers).
- `ItemForm.tsx` is built to accept a `type` prop and start from empty fields; Plan 02-06's edit mode will likely need an `initialFields`/`itemId` variant — reuse the same component rather than forking it, per this plan's own "one component switching on type" pattern.
- `useFolders()`/`useAllTags()`/`createVaultFolder()` are the exact plumbing Plan 02-06's Sidebar folder/tag filter UI should consume — do not recreate them.
- `PasskeyPlaceholderSection` is shared between `DetailPanel` and `ItemForm` — if Plan 02-06 adds an edit form, reuse it a third time rather than re-duplicating the JSX.
- `error.revisionConflict` dictionary key already exists (added in Plan 02-04) but is unused until Plan 02-06 wires the update path's 409 handling.

**Human verification still outstanding** (folded into phase-level verification per `human_verify_mode: end-of-phase`): unlock the vault, click "+ Nowy item", create a login item with a new folder and a tag, confirm it appears in the list immediately, open it, and confirm the detail panel shows the decrypted values, resolved folder name, tag chip, and the inert passkey section.

---
*Phase: 02-password-auth-vault-core*
*Completed: 2026-07-13*
