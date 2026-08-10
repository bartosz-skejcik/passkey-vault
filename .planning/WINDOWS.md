---
schema_version: 1
open_count: 5
waived_count: 0
fixed_count: 9
total_count: 14
last_updated: 2026-08-10T11:45:31.000Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 24 | deviation | crates/pv-server/src/routes/vault.rs |  | Pre-existing clippy::explicit_auto_deref warnings (18 sites, &mut *tx -> &mut tx) block whole-crate cargo clippy -p pv-server -- -D warnings; unrelated to Plan 24-02's own files, logged in phase deferred-items.md | open |  | 2026-07-31T10:20:38.248Z |  |
| 2 | 24 | stub | web/src/components/settings/FamilyTab.tsx |  | Collection-scope invite ('Family + one folder') is UNCONDITIONALLY DISABLED in the UI (CR-02 fix): personal folders (vault_items.folder_id) and Phase 22 collections (vault_items.collection_id) are distinct tables with unrelated id spaces, and no client-side collections create/list/decrypt capability exists anywhere yet. The option renders disabled with truthful not-yet-available copy rather than failing on submit. The SERVER half is complete and tested (create validates the collection triple; accept inserts a real collection_keys row, re-validates inviter authority, rolls back on conflict, fans out a real WS event). Phase 26 owns the collections UI that unblocks this, and inherits UI-SPEC backstops #4/#5/#6 (folder-picker zero-one-many, long-option truncation, selected-value truncation), which were dissolved here when CR-02 deleted their subject. | fixed |  | 2026-07-31T11:46:48.811Z | 2026-08-07T09:53:30.064Z |
| 3 | 25 | lint-warning | crates/pv-server/src/routes/vault.rs |  | Pre-existing clippy::explicit_auto_deref debt (18 findings) predating this plan's base commit, confirmed via git stash; not fixed here per scope-boundary rule. See 25-03 deferred-items.md. | open |  | 2026-08-05T08:26:19.655Z |  |
| 4 | 26 | deviation | web/e2e/delete-account.spec.ts | 240 | Pre-existing (Plan 26-01 vintage) regression, found not fixed: POST /api/vault/collections body omits the now-required client-minted id field; both live tests in this file 422 on collection creation. | fixed |  | 2026-08-06T12:25:10.666Z | 2026-08-06T13:02:12.354Z |
| 5 | 26 | deviation | web/e2e/remove-member.spec.ts | 287 | Same pre-existing regression as delete-account.spec.ts: POST /api/vault/collections body omits the client-minted id field; both live tests in this file 422 on collection creation. | fixed |  | 2026-08-06T12:25:16.732Z | 2026-08-06T13:02:20.512Z |
| 6 | 26 | deviation | web/e2e/invite-flow.spec.ts | 277 | Stale regression guard: test asserts the 'folder' invite-scope option is disabled (Phase 24 CR-02), but Plan 26-12 already intentionally enabled it; test was never updated. Blocks the rest of that file's describe.serial block via skip cascade. | fixed |  | 2026-08-06T12:25:21.917Z | 2026-08-06T13:02:20.580Z |
| 7 | 26 | deviation | web/src/lib/vault/collections.ts |  | Live-run-discovered gap: no subscribeLockState/onSharedRevisions live-update wiring at all, unlike store.ts's items. A member added to a collection does not see it (or gain a usable Collection Key) until their next unlock/reload. Documented in web/e2e/sharing.spec.ts's own header comment; not fixed (out of this verification-only plan's scope). | fixed |  | 2026-08-06T12:25:30.857Z | 2026-08-06T13:46:09.368Z |
| 8 | 26 | deviation | crates/pv-server/src/routes/vault.rs |  | Live-run-discovered, phase-defining gap: fetch_items_for's collection-scoped SQL arm filters WHERE i.user_id = ? bound to the CALLER, so GET /api/vault/items and GET /api/sync never return a collection-scoped item to a fellow member who does not own it -- only to its own creator. The dedicated GET /api/sync/shared/collection/{id} (pull_shared_collection) read path that would fix it has ZERO client consumers anywhere in web/src (confirmed by grep). Documented in web/e2e/sharing.spec.ts and web/e2e/shared-sync.spec.ts's own header comments; not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope). | fixed |  | 2026-08-06T12:25:40.082Z | 2026-08-06T13:46:16.458Z |
| 9 | 26 | deviation | web/src/lib/vault/store.ts |  | Live-run-discovered gap: no client code anywhere consumes GET /api/sync/shared/direct (the recipient-side read path for a directly-shared, non-collection personal item). The item_shares wire contract, sender-side crypto, and server-side notification pipeline are all real and correct (proven live in web/e2e/sharing.spec.ts test 3), but a recipient's own item list never surfaces a directly-shared item -- confirmed by 26-08-SUMMARY.md's own Next Phase Readiness note and by grep. Not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope). | fixed |  | 2026-08-06T12:25:48.249Z | 2026-08-06T13:46:16.526Z |
| 10 | 26 | deviation | web/e2e/sharing.spec.ts |  | Live-run-discovered order-dependent hang: with WR-01/WR-02's 422 fixed, delete-account.spec.ts's member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner test now runs its real server-side collection re-key path (previously never reached -- it always 422'd first). Whatever state that leaves behind causes a LATER, otherwise-unrelated test (sharing.spec.ts's WR-09 and Backstop #6 tests, both via createLoginItemViaUI) to hang for the full 120s test timeout waiting for item-form-login to detach after a real-browser item-create submit, in two brand-new never-before-seen accounts. Reproduced deterministically (bisected to this exact pairing sharing across one Playwright DB): passes standalone or paired with the OTHER delete-account test (owner_account_deletion...), fails whenever member_self_deletion_live_rekeys... runs first in the same DB. Root cause not yet isolated (candidates: SQLite WAL contention/lock left by the rekey transaction, or a client-side fetch that never resolves) -- out of this verification-only plan's scope (test-file-only remit); production code (crates/pv-server rekey path or web item-create client) was not touched. | fixed |  | 2026-08-06T13:02:31.851Z | 2026-08-06T13:23:40.861Z |
| 11 | 26 | deviation | web/src/lib/vault/store.ts |  | Latent ordering hazard found while root-causing WINDOWS #10 (.planning/debug/rekey-order-dependent-hang.md), deliberately NOT fixed there to keep that fix minimal and root-cause-scoped. createVaultItem (store.ts:376-391) awaits POST /api/vault/items and THEN mutates local state (items = [...items, item]; recomputeAllTags(); notifyListeners()). Any throw in that post-await bookkeeping propagates out of createVaultItem into ItemForm.tsx:401's catch, which renders 'Failed to save item. Please try again.' over a write the server ALREADY accepted with 201 -- observed live in the #10 probe transcript. The user is invited to retry into duplicate rows. updateVaultItem (529-535) and deleteVaultItem (540-545) share the identical shape. This repo already fixed one instance of exactly this class (commit 4450dc0, 'WR-12 stop reporting failure after the server mutation already succeeded'), so the pattern is known and recurring. #10's fix removes the ONE known trigger (a tags-less plaintext) but not the hazard itself. | open |  | 2026-08-06T13:24:13.762Z |  |
| 12 | 26 | stub | web/src/components/vault/ExportDialog.tsx |  | Hidden-password masking (SHARE-03, closed in 26-VERIFICATION-FIX blocker 1) does not extend to vault export: ExportDialog calls getItems() -- the merged view, which since 26-14 includes items shared TO the caller -- and buildCsvExport/buildJsonExport emit fields.password verbatim (toCsv.ts:59). A hidden_password recipient can still obtain the plaintext via Settings -> Export in two clicks. Deliberately not fixed: it is inside what D-2's disclosure already discloses (an explicit whole-vault export is a deliberate recovery act, not 'accidentally seeing it on screen'), and silently blanking a password in a user's own BACKUP is unnoticed data loss -- an honest fix needs an explicit in-file marker, i.e. new export-format surface plus i18n. share.hiddenPasswordRecipientNote was worded 'this view masks it' rather than 'hidden in the interface' precisely so no shipped copy overclaims because of this. Owner of the follow-up decides blank-vs-marker for BOTH exporters, and owes the same in the extension (Phase 27). See 26 deferred-items.md. | open |  | 2026-08-07T09:54:44.142Z |  |
| 13 | 26 | stub | web/src/components/vault/ShareDialog.tsx |  | CR-01's partial-share recovery is SESSION-SCOPED only (26-VERIFICATION.md W-2, independently re-verified 2026-08-07 and confirmed correct). Retrying through the SAME open dialog is genuinely idempotent (createdCollectionRef, tested). But NO UI entry point anywhere adds a member to an EXISTING shared collection: the only ShareDialogScope folder variants constructed are existingFolderId=<personal folder id> (Sidebar:323) and null (Sidebar:422, FamilyTab:695), both of which MINT A NEW COLLECTION, and the Sidebar's shared-folder rows (Sidebar:404-417) are plain non-interactive divs with no kebab/share/delete. So closing the dialog after a partial failure strands the half-granted collection permanently; reopening mints a second one and seed items already moved into the first now fail decryptItem on the re-move as fresh seedMoveFailed. The orphan persists visibly in the Shared folders sidebar with no delete affordance. Not fixed in the verification-fix pass because the fix is a NEW UI SURFACE, not a guard: a kebab on the shared-folder row, a third ShareDialogScope variant (existingCollectionId), and a different crypto path in submit (unseal the caller's own sealed_key and re-seal the RECOVERED Collection Key, not WasmCollectionKey.generate()) -- feature work with its own real-WASM proof obligation. CR-01's unscoped claim 'no manual DB surgery' is recorded as NOT TRUE. See 26 deferred-items.md. | open |  | 2026-08-07T09:54:53.167Z |  |
| 14 | 30 | stub | web/src/app/page.tsx |  | FamilyRekeyNotice built and tested but not mounted -- outside 30-05's files_modified/wave file-disjointness boundary; needs a one-line <FamilyRekeyNotice /> mount next to CopyToast/ErrorToast | fixed |  | 2026-08-10T11:38:54.812Z | 2026-08-10T11:45:31.000Z |

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
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-07-31T11:46:48.811Z",
    "resolved_at": "2026-08-07T09:53:30.064Z"
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
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:10.666Z",
    "resolved_at": "2026-08-06T13:02:12.354Z"
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "26",
    "file": "web/e2e/remove-member.spec.ts",
    "line": 287,
    "description": "Same pre-existing regression as delete-account.spec.ts: POST /api/vault/collections body omits the client-minted id field; both live tests in this file 422 on collection creation.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:16.732Z",
    "resolved_at": "2026-08-06T13:02:20.512Z"
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "26",
    "file": "web/e2e/invite-flow.spec.ts",
    "line": 277,
    "description": "Stale regression guard: test asserts the 'folder' invite-scope option is disabled (Phase 24 CR-02), but Plan 26-12 already intentionally enabled it; test was never updated. Blocks the rest of that file's describe.serial block via skip cascade.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:21.917Z",
    "resolved_at": "2026-08-06T13:02:20.580Z"
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "26",
    "file": "web/src/lib/vault/collections.ts",
    "line": null,
    "description": "Live-run-discovered gap: no subscribeLockState/onSharedRevisions live-update wiring at all, unlike store.ts's items. A member added to a collection does not see it (or gain a usable Collection Key) until their next unlock/reload. Documented in web/e2e/sharing.spec.ts's own header comment; not fixed (out of this verification-only plan's scope).",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:30.857Z",
    "resolved_at": "2026-08-06T13:46:09.368Z"
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "26",
    "file": "crates/pv-server/src/routes/vault.rs",
    "line": null,
    "description": "Live-run-discovered, phase-defining gap: fetch_items_for's collection-scoped SQL arm filters WHERE i.user_id = ? bound to the CALLER, so GET /api/vault/items and GET /api/sync never return a collection-scoped item to a fellow member who does not own it -- only to its own creator. The dedicated GET /api/sync/shared/collection/{id} (pull_shared_collection) read path that would fix it has ZERO client consumers anywhere in web/src (confirmed by grep). Documented in web/e2e/sharing.spec.ts and web/e2e/shared-sync.spec.ts's own header comments; not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope).",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:40.082Z",
    "resolved_at": "2026-08-06T13:46:16.458Z"
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "26",
    "file": "web/src/lib/vault/store.ts",
    "line": null,
    "description": "Live-run-discovered gap: no client code anywhere consumes GET /api/sync/shared/direct (the recipient-side read path for a directly-shared, non-collection personal item). The item_shares wire contract, sender-side crypto, and server-side notification pipeline are all real and correct (proven live in web/e2e/sharing.spec.ts test 3), but a recipient's own item list never surfaces a directly-shared item -- confirmed by 26-08-SUMMARY.md's own Next Phase Readiness note and by grep. Not fixed (new client-fetch-path-sized change, outside this verification-only plan's scope).",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T12:25:48.249Z",
    "resolved_at": "2026-08-06T13:46:16.526Z"
  },
  {
    "id": 10,
    "kind": "deviation",
    "phase": "26",
    "file": "web/e2e/sharing.spec.ts",
    "line": null,
    "description": "Live-run-discovered order-dependent hang: with WR-01/WR-02's 422 fixed, delete-account.spec.ts's member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner test now runs its real server-side collection re-key path (previously never reached -- it always 422'd first). Whatever state that leaves behind causes a LATER, otherwise-unrelated test (sharing.spec.ts's WR-09 and Backstop #6 tests, both via createLoginItemViaUI) to hang for the full 120s test timeout waiting for item-form-login to detach after a real-browser item-create submit, in two brand-new never-before-seen accounts. Reproduced deterministically (bisected to this exact pairing sharing across one Playwright DB): passes standalone or paired with the OTHER delete-account test (owner_account_deletion...), fails whenever member_self_deletion_live_rekeys... runs first in the same DB. Root cause not yet isolated (candidates: SQLite WAL contention/lock left by the rekey transaction, or a client-side fetch that never resolves) -- out of this verification-only plan's scope (test-file-only remit); production code (crates/pv-server rekey path or web item-create client) was not touched.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-06T13:02:31.851Z",
    "resolved_at": "2026-08-06T13:23:40.861Z"
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "26",
    "file": "web/src/lib/vault/store.ts",
    "line": null,
    "description": "Latent ordering hazard found while root-causing WINDOWS #10 (.planning/debug/rekey-order-dependent-hang.md), deliberately NOT fixed there to keep that fix minimal and root-cause-scoped. createVaultItem (store.ts:376-391) awaits POST /api/vault/items and THEN mutates local state (items = [...items, item]; recomputeAllTags(); notifyListeners()). Any throw in that post-await bookkeeping propagates out of createVaultItem into ItemForm.tsx:401's catch, which renders 'Failed to save item. Please try again.' over a write the server ALREADY accepted with 201 -- observed live in the #10 probe transcript. The user is invited to retry into duplicate rows. updateVaultItem (529-535) and deleteVaultItem (540-545) share the identical shape. This repo already fixed one instance of exactly this class (commit 4450dc0, 'WR-12 stop reporting failure after the server mutation already succeeded'), so the pattern is known and recurring. #10's fix removes the ONE known trigger (a tags-less plaintext) but not the hazard itself.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-06T13:24:13.762Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "stub",
    "phase": "26",
    "file": "web/src/components/vault/ExportDialog.tsx",
    "line": null,
    "description": "Hidden-password masking (SHARE-03, closed in 26-VERIFICATION-FIX blocker 1) does not extend to vault export: ExportDialog calls getItems() -- the merged view, which since 26-14 includes items shared TO the caller -- and buildCsvExport/buildJsonExport emit fields.password verbatim (toCsv.ts:59). A hidden_password recipient can still obtain the plaintext via Settings -> Export in two clicks. Deliberately not fixed: it is inside what D-2's disclosure already discloses (an explicit whole-vault export is a deliberate recovery act, not 'accidentally seeing it on screen'), and silently blanking a password in a user's own BACKUP is unnoticed data loss -- an honest fix needs an explicit in-file marker, i.e. new export-format surface plus i18n. share.hiddenPasswordRecipientNote was worded 'this view masks it' rather than 'hidden in the interface' precisely so no shipped copy overclaims because of this. Owner of the follow-up decides blank-vs-marker for BOTH exporters, and owes the same in the extension (Phase 27). See 26 deferred-items.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-07T09:54:44.142Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "stub",
    "phase": "26",
    "file": "web/src/components/vault/ShareDialog.tsx",
    "line": null,
    "description": "CR-01's partial-share recovery is SESSION-SCOPED only (26-VERIFICATION.md W-2, independently re-verified 2026-08-07 and confirmed correct). Retrying through the SAME open dialog is genuinely idempotent (createdCollectionRef, tested). But NO UI entry point anywhere adds a member to an EXISTING shared collection: the only ShareDialogScope folder variants constructed are existingFolderId=<personal folder id> (Sidebar:323) and null (Sidebar:422, FamilyTab:695), both of which MINT A NEW COLLECTION, and the Sidebar's shared-folder rows (Sidebar:404-417) are plain non-interactive divs with no kebab/share/delete. So closing the dialog after a partial failure strands the half-granted collection permanently; reopening mints a second one and seed items already moved into the first now fail decryptItem on the re-move as fresh seedMoveFailed. The orphan persists visibly in the Shared folders sidebar with no delete affordance. Not fixed in the verification-fix pass because the fix is a NEW UI SURFACE, not a guard: a kebab on the shared-folder row, a third ShareDialogScope variant (existingCollectionId), and a different crypto path in submit (unseal the caller's own sealed_key and re-seal the RECOVERED Collection Key, not WasmCollectionKey.generate()) -- feature work with its own real-WASM proof obligation. CR-01's unscoped claim 'no manual DB surgery' is recorded as NOT TRUE. See 26 deferred-items.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-07T09:54:53.167Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "stub",
    "phase": "30",
    "file": "web/src/app/page.tsx",
    "line": null,
    "description": "FamilyRekeyNotice built and tested but not mounted -- outside 30-05's files_modified/wave file-disjointness boundary; needs a one-line <FamilyRekeyNotice /> mount next to CopyToast/ErrorToast",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-10T11:38:54.812Z",
    "resolved_at": "2026-08-10T11:45:31.000Z"
  }
]
````
