---
schema_version: 1
open_count: 9
waived_count: 0
fixed_count: 0
total_count: 9
last_updated: 2026-08-06T12:25:48.249Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 24 | deviation | crates/pv-server/src/routes/vault.rs |  | Pre-existing clippy::explicit_auto_deref warnings (18 sites, &mut *tx -> &mut tx) block whole-crate cargo clippy -p pv-server -- -D warnings; unrelated to Plan 24-02's own files, logged in phase deferred-items.md | open |  | 2026-07-31T10:20:38.248Z |  |
| 2 | 24 | stub | web/src/components/settings/FamilyTab.tsx |  | Collection-scope invite ('Family + one folder') is UNCONDITIONALLY DISABLED in the UI (CR-02 fix): personal folders (vault_items.folder_id) and Phase 22 collections (vault_items.collection_id) are distinct tables with unrelated id spaces, and no client-side collections create/list/decrypt capability exists anywhere yet. The option renders disabled with truthful not-yet-available copy rather than failing on submit. The SERVER half is complete and tested (create validates the collection triple; accept inserts a real collection_keys row, re-validates inviter authority, rolls back on conflict, fans out a real WS event). Phase 26 owns the collections UI that unblocks this, and inherits UI-SPEC backstops #4/#5/#6 (folder-picker zero-one-many, long-option truncation, selected-value truncation), which were dissolved here when CR-02 deleted their subject. | open |  | 2026-07-31T11:46:48.811Z |  |
| 3 | 25 | lint-warning | crates/pv-server/src/routes/vault.rs |  | Pre-existing clippy::explicit_auto_deref debt (18 findings) predating this plan's base commit, confirmed via git stash; not fixed here per scope-boundary rule. See 25-03 deferred-items.md. | open |  | 2026-08-05T08:26:19.655Z |  |
| 4 | 26 | deviation | web/e2e/delete-account.spec.ts | 240 | Pre-existing (Plan 26-01 vintage) regression, found not fixed: POST /api/vault/collections body omits the now-required client-minted id field; both live tests in this file 422 on collection creation. | open |  | 2026-08-06T12:25:10.666Z |  |
| 5 | 26 | deviation | web/e2e/remove-member.spec.ts | 287 | Same pre-existing regression as delete-account.spec.ts: POST /api/vault/collections body omits the client-minted id field; both live tests in this file 422 on collection creation. | open |  | 2026-08-06T12:25:16.732Z |  |
| 6 | 26 | deviation | web/e2e/invite-flow.spec.ts | 277 | Stale regression guard: test asserts the 'folder' invite-scope option is disabled (Phase 24 CR-02), but Plan 26-12 already intentionally enabled it; test was never updated. Blocks the rest of that file's describe.serial block via skip cascade. | open |  | 2026-08-06T12:25:21.917Z |  |
| 7 | 26 | deviation | web/src/lib/vault/collections.ts |  | Live-run-discovered gap: no subscribeLockState/onSharedRevisions live-update wiring at all, unlike store.ts's items. A member added to a collection does not see it (or gain a usable Collection Key) until their next unlock/reload. Documented in web/e2e/sharing.spec.ts's own header comment; not fixed (out of this verification-only plan's scope). | open |  | 2026-08-06T12:25:30.857Z |  |
| 8 | 26 | deviation | crates/pv-server/src/routes/vault.rs |  | Live-run-discovered, phase-defining gap: fetch_items_for's collection-scoped SQL arm filters WHERE i.user_id = ? bound to the CALLER, so GET /api/vault/items and GET /api/sync never return a collection-scoped item to a fellow member who does not own it -- only to its own creator. The dedicated GET /api/sync/shared/collection/{id} (pull_shared_collection) read path that would fix it has ZERO client consumers anywhere in web/src (confirmed by grep). Documented in web/e2e/sharing.spec.ts and web/e2e/shared-sync.spec.ts's own header comments; not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope). | open |  | 2026-08-06T12:25:40.082Z |  |
| 9 | 26 | deviation | web/src/lib/vault/store.ts |  | Live-run-discovered gap: no client code anywhere consumes GET /api/sync/shared/direct (the recipient-side read path for a directly-shared, non-collection personal item). The item_shares wire contract, sender-side crypto, and server-side notification pipeline are all real and correct (proven live in web/e2e/sharing.spec.ts test 3), but a recipient's own item list never surfaces a directly-shared item -- confirmed by 26-08-SUMMARY.md's own Next Phase Readiness note and by grep. Not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope). | open |  | 2026-08-06T12:25:48.249Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "24",
    "file": "crates/pv-server/src/routes/vault.rs",
    "line": null,
    "description": "Pre-existing clippy::explicit_auto_deref warnings (18 sites, &mut *tx -> &mut tx) block whole-crate cargo clippy -p pv-server -- -D warnings; unrelated to Plan 24-02's own files, logged in phase deferred-items.md",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-31T10:20:38.248Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "stub",
    "phase": "24",
    "file": "web/src/components/settings/FamilyTab.tsx",
    "line": null,
    "description": "Collection-scope invite ('Family + one folder') is UNCONDITIONALLY DISABLED in the UI (CR-02 fix): personal folders (vault_items.folder_id) and Phase 22 collections (vault_items.collection_id) are distinct tables with unrelated id spaces, and no client-side collections create/list/decrypt capability exists anywhere yet. The option renders disabled with truthful not-yet-available copy rather than failing on submit. The SERVER half is complete and tested (create validates the collection triple; accept inserts a real collection_keys row, re-validates inviter authority, rolls back on conflict, fans out a real WS event). Phase 26 owns the collections UI that unblocks this, and inherits UI-SPEC backstops #4/#5/#6 (folder-picker zero-one-many, long-option truncation, selected-value truncation), which were dissolved here when CR-02 deleted their subject.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-07-31T11:46:48.811Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "lint-warning",
    "phase": "25",
    "file": "crates/pv-server/src/routes/vault.rs",
    "line": null,
    "description": "Pre-existing clippy::explicit_auto_deref debt (18 findings) predating this plan's base commit, confirmed via git stash; not fixed here per scope-boundary rule. See 25-03 deferred-items.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-05T08:26:19.655Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "26",
    "file": "web/e2e/delete-account.spec.ts",
    "line": 240,
    "description": "Pre-existing (Plan 26-01 vintage) regression, found not fixed: POST /api/vault/collections body omits the now-required client-minted id field; both live tests in this file 422 on collection creation.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:10.666Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "26",
    "file": "web/e2e/remove-member.spec.ts",
    "line": 287,
    "description": "Same pre-existing regression as delete-account.spec.ts: POST /api/vault/collections body omits the client-minted id field; both live tests in this file 422 on collection creation.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:16.732Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "26",
    "file": "web/e2e/invite-flow.spec.ts",
    "line": 277,
    "description": "Stale regression guard: test asserts the 'folder' invite-scope option is disabled (Phase 24 CR-02), but Plan 26-12 already intentionally enabled it; test was never updated. Blocks the rest of that file's describe.serial block via skip cascade.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:21.917Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "26",
    "file": "web/src/lib/vault/collections.ts",
    "line": null,
    "description": "Live-run-discovered gap: no subscribeLockState/onSharedRevisions live-update wiring at all, unlike store.ts's items. A member added to a collection does not see it (or gain a usable Collection Key) until their next unlock/reload. Documented in web/e2e/sharing.spec.ts's own header comment; not fixed (out of this verification-only plan's scope).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:30.857Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "26",
    "file": "crates/pv-server/src/routes/vault.rs",
    "line": null,
    "description": "Live-run-discovered, phase-defining gap: fetch_items_for's collection-scoped SQL arm filters WHERE i.user_id = ? bound to the CALLER, so GET /api/vault/items and GET /api/sync never return a collection-scoped item to a fellow member who does not own it -- only to its own creator. The dedicated GET /api/sync/shared/collection/{id} (pull_shared_collection) read path that would fix it has ZERO client consumers anywhere in web/src (confirmed by grep). Documented in web/e2e/sharing.spec.ts and web/e2e/shared-sync.spec.ts's own header comments; not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:40.082Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "26",
    "file": "web/src/lib/vault/store.ts",
    "line": null,
    "description": "Live-run-discovered gap: no client code anywhere consumes GET /api/sync/shared/direct (the recipient-side read path for a directly-shared, non-collection personal item). The item_shares wire contract, sender-side crypto, and server-side notification pipeline are all real and correct (proven live in web/e2e/sharing.spec.ts test 3), but a recipient's own item list never surfaces a directly-shared item -- confirmed by 26-08-SUMMARY.md's own Next Phase Readiness note and by grep. Not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:48.249Z",
    "resolved_at": null
  }
]
````
