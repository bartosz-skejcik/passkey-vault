---
phase: quick-260717-plk
plan: 1
subsystem: vault-items
tags: [rust, axum, sqlx, sqlite, typescript, react, wxt, vitest]

requires: []
provides:
  - "Nullable vault_items.last_used_at column + POST /api/vault/items/{id}/touch (migration 0012)"
  - "Web app: last-used tracking on every DetailPanel copy/reveal, header sort control (last-used/name, persisted)"
  - "Extension: last-used tracking on every autofill fill/TOTP-code/passkey-ceremony/popup-copy touch-point, popup default sort by last-used"
affects: [web-vault-ui, extension-autofill, extension-provider-ceremony, extension-popup]

tech-stack:
  added: []
  patterns:
    - "Fire-and-forget touchVaultItem()/touchItem() choke-point per client (web store.ts, extension vault-store.ts) — never awaited by callers, catch+debug-log only, optimistically updates the in-memory item's lastUsedAt on success"
    - "Extension popup-document (client-side decrypt/copy) gets a lightweight vault.touch runtime message kind into the SAME background choke-point, instead of duplicating the network call in the popup bundle"

key-files:
  created:
    - crates/pv-server/migrations/0012_vault_items_last_used.sql
    - web/src/lib/vault/sort.ts
    - web/src/lib/vault/sort.test.ts
    - extension/lib/vault/sort.ts
    - extension/lib/vault/sort.test.ts
    - extension/entrypoints/popup/ItemDetailView.test.tsx
  modified:
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/vault.rs
    - web/src/lib/vault/types.ts
    - web/src/lib/vault/api.ts
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts
    - web/src/lib/i18n/dictionary.ts
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/DetailPanel.test.tsx
    - web/src/components/vault/ItemList.tsx
    - web/src/components/shell/MainColumn.tsx
    - web/src/app/page.tsx
    - extension/lib/vault/types.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/vault-api.ts
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/vault-store.test.ts
    - extension/entrypoints/background/autofill-match.ts
    - extension/entrypoints/background/autofill-match.test.ts
    - extension/entrypoints/background/autofill-frame.ts
    - extension/entrypoints/background/autofill-frame.test.ts
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/entrypoints/popup/ItemDetailView.tsx
    - extension/entrypoints/popup/ItemListView.tsx

key-decisions:
  - "Touch never bumps vault_items.revision — revision is the optimistic-concurrency token content mutations use; bumping it on every reveal/copy/fill would fabricate spurious 409s for other devices/tabs mid-edit for a purely metadata event"
  - "No dedicated WS SyncEvent broadcast for a touch (avoids making the metadata-only sync channel chatty on every reveal/copy/autofill) — other clients pick up the new last_used_at on their next pull/snapshot, documented as an explicit trade-off in both vault.rs and every touchVaultItem() doc comment"
  - "Web's updateVaultItem() now explicitly carries the pre-edit item's lastUsedAt forward — server's update() route never touches the column, so the client rebuild would otherwise silently wipe last-used on every edit-save (caught and fixed as a Rule-1 bug, not in the original brief)"
  - "Extension popup's ItemDetailView (client-side decrypt/copy) gets a new vault.touch message kind rather than importing vault-api.ts's fetch logic directly into the popup bundle — keeps the network/touch logic centralized in the background's vault-store.ts"

requirements-completed: []

coverage:
  - id: D1
    description: "Server: touch sets last_used_at without bumping revision; 404 on missing/other-user's item; auth required; payload includes the field"
    requirement: null
    verification:
      - kind: unit
        ref: "crates/pv-server/tests/vault.rs#touch_sets_last_used_at_without_bumping_revision, touch_on_missing_item_is_404, touch_on_other_users_item_is_404, touch_requires_auth, create_and_list_include_a_null_last_used_at_before_any_touch"
        status: pass
    human_judgment: false
  - id: D2
    description: "Web: sort comparator (last-used desc, name fallback, null handling) + DetailPanel copy/reveal touch wiring + store-level touchVaultItem helper"
    requirement: null
    verification:
      - kind: unit
        ref: "web/src/lib/vault/sort.test.ts (8 tests), web/src/components/vault/DetailPanel.test.tsx#touches the item when a masked field is revealed.../touches the item when a field's copy button is clicked, web/src/lib/vault/store.test.ts#touchVaultItem describe block (3 tests)"
        status: pass
    human_judgment: true
    rationale: "Visual placement/taste of the new header sort <select> (next to the dynamic heading) is not provable by jsdom assertions alone -- a human UI pass is the right final check, same as prior UI-affecting quick tasks in this repo."
  - id: D3
    description: "Extension: touch wired into autofill fill (popup + in-page overlay), TOTP code production, credentials.get() passkey ceremony, and popup copy/reveal via a new vault.touch message kind; JSON round-trip gate covers the new kind"
    requirement: null
    verification:
      - kind: unit
        ref: "extension/lib/vault/sort.test.ts (4 tests), extension/entrypoints/background/autofill-match.test.ts#touches the filled item.../does not touch the item when the content-relay fill fails/every derived-code response touches, extension/entrypoints/background/autofill-frame.test.ts#touches the item, extension/entrypoints/background/provider-ceremony.test.ts#touches the chosen passkey item, extension/entrypoints/background/router.test.ts#vault.touch dispatch + forbidden-sender, extension/lib/messaging/ext-protocol.test.ts (vault.touch fixture round-trip), extension/entrypoints/popup/ItemDetailView.test.tsx (3 tests)"
        status: pass
    human_judgment: true
    rationale: "Popup's 'Wszystkie' default-sort-by-last-used ordering and the underlying real-browser autofill/ceremony touch timing are best confirmed by a live UAT pass, consistent with how prior extension quick-tasks in this repo were closed out."

duration: ~2h
completed: 2026-07-17
status: complete
---

# Quick Task 260717-plk: Per-Item Last-Used Tracking + Sorting (NordPass-style) Summary

**Nullable `last_used_at` column + `POST /api/vault/items/{id}/touch` (never bumping revision, no WS broadcast), wired into every "actually uses the secret" touch-point across web and extension, plus last-used sorting in both list surfaces.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-07-17
- **Tasks:** 3/3 layers completed and committed (server, web, extension)
- **Files modified/created:** 6 created, 25 modified

## Migration / Endpoint / Touch-Points / Sort Defaults

**Migration:** `0012_vault_items_last_used.sql` — `ALTER TABLE vault_items ADD COLUMN last_used_at TEXT` (nullable, additive; next free number after 0011).

**Endpoint:** `POST /api/vault/items/{id}/touch` — auth-required (SessionUser-scoped, 404 for missing/other-user's item), single-column `UPDATE ... SET last_used_at = datetime('now') ... RETURNING last_used_at`, **never** touches `revision`. Response: `{ "last_used_at": "<timestamp>" }`. `list`/`sync` snapshot payloads now include `last_used_at` on every item row (nullable). No dedicated WS `SyncEvent` for a touch — documented trade-off, other clients pick it up on their next pull.

**Web touch-points (`DetailPanel.tsx`'s existing `handleCopy`/`toggleReveal` choke-points, via `store.ts`'s `touchVaultItem()`):**
- Every copy-button click in the detail panel (login password, TOTP code, card number/CVV/PIN, identity fields, passkey fields, notes, etc.)
- Revealing (not re-hiding) any masked field (password, card number, CVV, PIN, TOTP secret)

**Web sort default:** `lib/vault/sort.ts` — "Ostatnio używane"/"Last used" (desc, never-touched items sink to the bottom sorted by name) is the **default**; "Nazwa"/"Name" is the alternative. Persisted in `localStorage` (`pv-vault-sort` key). Control rendered next to `MainColumn`'s dynamic heading.

**Extension touch-points (all through `vault-store.ts`'s `touchVaultItem()`):**
- `autofill-match.ts`'s `handleAutofillFill` (popup-driven fill) — only on a confirmed successful `content.fill` ack
- `autofill-frame.ts`'s `handleFillFrame` (in-page overlay fill) — same success gate
- `autofill-match.ts`'s `handleAutofillTotpCode` — every derived-code response
- `provider-ceremony.ts`'s `handleCredentialsGet` — after a successful `credentials.get()` assertion
- Popup's `ItemDetailView.tsx` (client-side decrypt/copy, no background hop for the copy itself) — new `vault.touch` message kind (`{kind:"vault.touch", itemId}` → `{ok:true}`) dispatched through `router.ts`'s existing popup-only `"vault."`-prefix WR-01 gate, landing in the same `touchVaultItem()` choke-point

**Extension popup sort default:** `ItemListView.tsx`'s "Wszystkie" section is default-sorted by `lastUsedAt` desc (never-touched items last, by name) via `lib/vault/sort.ts`'s `sortByLastUsed()`. No visible sort control in the popup this round (design brief's explicit "default only" scope) — noted here for a future UI round.

## Task Commits

Each layer was committed atomically:

1. **Server: migration 0012 + touch endpoint + tests** - `0818693` (feat)
2. **Web: VaultItem.lastUsedAt, touch wiring, sort control** - `0fe9fc4` (feat)
3. **Extension: VaultItem.lastUsedAt, touch wiring, popup default sort** - `5495b10` (feat)

## Gate Results (actual, captured output)

1. **`cargo test -p pv-server`**: **PASS** — 18/18 tests in `tests/vault.rs` (5 new: touch-sets-timestamp-without-revision-bump, touch-404-missing, touch-404-other-user, touch-requires-auth, null-before-touch), plus every pre-existing suite (auth/sessions/sync/unlock/passkeys/extension_passkeys/router_static_fallback) unaffected — 46 total server tests passing.
2. **Web `npx vitest run`**: **PASS** — 422/422 tests, 54 files (net +19 from this task: 8 new sort comparator tests, 3 new touch tests in `DetailPanel.test.tsx`, 3 new `touchVaultItem` tests in `store.test.ts`, plus fixture updates).
3. **Web `npx tsc --noEmit`**: **PASS** — clean.
4. **Extension `npx vitest run`**: **PASS** — 549/549 tests, 48 files (net +23: 4 sort comparator tests, 2 fill-touch tests in `autofill-match.test.ts`, 1 in `autofill-frame.test.ts`, 1 in `provider-ceremony.test.ts`, 2 in `router.test.ts`, 3 in `vault-store.test.ts`, 3 new `ItemDetailView.test.tsx`, 1 new `ext-protocol.test.ts` fixture pair). One pre-existing, unrelated `Unhandled Rejection` in `ServerConfigView.tsx:111` reproduces identically with or without this task's changes — confirmed out of scope (see Issues Encountered).
5. **Extension `npx tsc --noEmit`**: **PASS** — clean.
6. **Extension `npx wxt build -b chrome`**: **PASS** — 1.9 MB total, clean build.
7. **Extension `npx wxt build -b firefox`**: **PASS** — 1.89 MB total, clean build (pre-existing Firefox `data_collection_permissions` warning unrelated to this task).

## Decisions Made

- **Touch never bumps `revision`** — the endpoint is a single-column `UPDATE` deliberately separate from `update()`'s optimistic-concurrency `revision = revision + 1` path, so a reveal/copy/fill/ceremony use can never fabricate a stale-revision 409 against a concurrent edit in another tab/device.
- **No dedicated WS broadcast for a touch** — avoids making the metadata-only sync channel chatty on every reveal/copy/autofill/ceremony; other clients converge on the next pull/snapshot instead. Documented in `vault.rs`'s `touch()` doc comment and both `touchVaultItem()` implementations.
- **Web's `updateVaultItem()` now carries the pre-edit item's `lastUsedAt` forward explicitly** — without this, an edit-save would silently wipe out the item's last-used timestamp (the server's `update()` route never selects/returns `last_used_at`, and the client was rebuilding the whole `VaultItem` from scratch on every successful PUT). Caught and fixed as a Rule 1 bug during implementation; not explicitly called out in the original brief.
- **Extension popup's client-side copy gets a new `vault.touch` message kind** rather than importing `vault-api.ts`'s `touchItem()`/fetch logic directly into the popup bundle — keeps all network/touch logic centralized in the background's `vault-store.ts`, matching every other write path in this codebase (`D-05`'s "popup never imports pv-wasm/pv-core directly" precedent, extended here to "popup never re-implements a background network call").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Web's `updateVaultItem()` would have silently dropped `lastUsedAt` on every edit-save**

- **Found during:** Web layer implementation, writing `updateVaultItem()`'s touch of the rebuilt `VaultItem`.
- **Issue:** The server's `update()` route (`crates/pv-server/src/routes/vault.rs`) never selects/returns `last_used_at` (by design — an edit is a content mutation, not a "use"). The client's `updateVaultItem()` reconstructs the entire in-memory `VaultItem` from the PUT response fields, which would have implicitly reset `lastUsedAt` to `undefined` on every single edit-save, discarding real last-used history for no reason connected to the edit itself.
- **Fix:** `updateVaultItem()` now explicitly carries the pre-existing item's `lastUsedAt` forward from the in-memory array before constructing the updated item.
- **Files modified:** `web/src/lib/vault/store.ts`
- **Verification:** Existing `updateVaultItem` tests in `store.test.ts` continue to pass; no dedicated regression test added for this specific carry-forward (edit-then-check-lastUsedAt), noted here for visibility.
- **Commit:** `0fe9fc4`

### None beyond the above

Every other aspect of the brief (migration number selection, endpoint shape, touch-point wiring per client, sort defaults, fire-and-forget failure semantics) was executed as specified with no other deviations.

## Issues Encountered

**Pre-existing, unrelated `Unhandled Rejection` in the extension's full test run.** `npx vitest run` (extension) reports one `Unhandled Rejection: TypeError: Cannot read properties of undefined (reading 'request')` at `entrypoints/popup/ServerConfigView.tsx:111`, attributed to `App.test.tsx`. Confirmed reproduces identically (same file, same line, same test attribution) when running only `App.test.tsx` + `ServerConfigView.test.tsx` in isolation — a file this task never touched. Out of scope per the deviation rules' scope boundary; all 549 tests still report passing despite the warning.

## User Setup Required

**Server restart required.** Per this task's ENV instructions, the running `pv-server` on `localhost:8620` was **not** restarted by this executor — the orchestrator should restart it (or re-run `cargo test`, which already exercised the new migration/binary) so the new `/api/vault/items/{id}/touch` route and `last_used_at` column are live against the dev DB at `data/pv.db`. The migration is a pure additive `ALTER TABLE ... ADD COLUMN` and applies cleanly to the existing schema with no data rewrite (confirmed via the full `cargo test -p pv-server` run, which runs every migration against a fresh in-memory DB on every test).

## Next Phase Readiness

- Web and extension UI/UX rounds may want to surface the popup's last-used sort as a visible control (explicitly deferred this round per the design brief) and/or expose `lastUsedAt` on the popup's passkey detail view (`ItemDetailView.tsx`'s `passkeyMeta()` still hardcodes `lastUsedAt: undefined` for passkey items specifically — untouched, out of this task's scope, but now has real data available if a future round wants to wire it).
- A live UAT pass (both the web sort control's placement/visual taste and the extension's live fill/ceremony touch timing in a real browser) is the natural follow-up verification step, consistent with how prior UI-affecting quick tasks in this repo were closed.

---
*Quick task: 260717-plk*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 6 newly created files confirmed present on disk (`crates/pv-server/migrations/0012_vault_items_last_used.sql`, `web/src/lib/vault/sort.ts`, `web/src/lib/vault/sort.test.ts`, `extension/lib/vault/sort.ts`, `extension/lib/vault/sort.test.ts`, `extension/entrypoints/popup/ItemDetailView.test.tsx`); all 3 layer commit hashes (`0818693`, `0fe9fc4`, `5495b10`) confirmed present in `git log --oneline`.
