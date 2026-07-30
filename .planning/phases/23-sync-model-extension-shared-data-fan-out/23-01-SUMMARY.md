---
phase: 23-sync-model-extension-shared-data-fan-out
plan: 01
subsystem: api
tags: [sync, websocket, sqlite, sqlx, axum, sharing, fan-out]

# Dependency graph
requires:
  - phase: 22-family-collection-data-model-server-authorization
    provides: "Membership<Item/Collection, M> extractor, collection_keys/item_shares tables, vault_items.collection_id"
provides:
  - "collections.revision (per-collection counter) + vault_items.last_editor_user_id columns (Migration 0015)"
  - "EntityType::Collection + SyncHub::publish_to_recipients (emit-time-fresh, never-cached membership fan-out)"
  - "update()/delete()/move_item() close all three Phase-22-left TODO(phase-23, WR-09) fan-out handoffs"
  - "VaultItem.is_shared/last_editor_email metadata, fetch_items_for's SELECT-column-list-only extension"
affects: [23-02-shared-pull-read-endpoints, 23-03-409-attribution-collection-events, 23-05-client-sync-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolve_recipients/bump_collection_revision/bump_recipients_vault_revision helper trio: resolved fresh inside the mutation's own transaction, never cached, reused identically by update/delete/move_item"
    - "EntityType::Collection carries the collection id in SyncEvent's existing `id` field — the type never gains a fifth field; T-05-04's doc comment extended to cover sensitive metadata generally, not just ciphertext/key material"
    - "last_editor_user_id always appended LAST in a SET-clause/INSERT-column list and bound LAST, so enc_key/enc_data's bound parameter position is provably unaffected by the new column"
    - "delete() resolves recipients BEFORE the DELETE runs — item_shares rows cascade-delete the instant the row disappears, so resolution order is load-bearing, not stylistic"

key-files:
  created:
    - crates/pv-server/migrations/0015_sync_shared_fanout.sql
    - crates/pv-server/tests/sync_shared.rs
  modified:
    - crates/pv-server/src/routes/sync.rs
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/tests/vault.rs

key-decisions:
  - "owner_user_id for resolve_recipients is read off each mutation's own row (via an extended RETURNING clause, not a second SELECT) rather than the caller's membership.caller_user_id — the two differ for a shared item, and using the caller would silently exclude the item's true owner from the fan-out"
  - "delete()'s existing global-vault_revision-as-event-revision convention for a personal item's Item-typed delete event is preserved via one extra read of the CALLER's own already-bumped vault_revision after the batched multi-recipient bump, since the batched UPDATE deliberately has no RETURNING (N rows affected, not 1)"
  - "move_item() publishes up to TWO independent Collection-typed events (one per non-null side of {source, destination}), each to its OWN resolved recipient set — never the union — so a source-only holder never learns the destination's new revision and vice versa"
  - "Task 3's fetch_items_for_is_shared test seeds its 'never touched' personal item via raw SQL rather than POST /api/vault/items, since Task 2 made create() set last_editor_user_id to the creator's own id immediately — a POST-created item is never actually untouched post-Phase-23"

patterns-established:
  - "Multi-recipient shared-mutation fan-out: resolve recipients fresh inside the mutation's tx -> bump collection revision(s) (RETURNING, single-row) + bump recipients' vault_revision (batched WHERE id IN (...), execute-only, never per-recipient loop) -> tx.commit() -> publish_to_recipients per resolved set"

requirements-completed: [SYNC-04, SYNC-05]

coverage:
  - id: D1
    description: "Additive migration 0015: collections.revision (per-collection counter) + vault_items.last_editor_user_id (nullable, 409-attribution source)"
    requirement: "SYNC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/common/mod.rs::test_pool (sqlx::migrate! applies 0015 for every test in the suite)"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#collection_revision_bump_visible_to_other_member_live"
        status: pass
    human_judgment: false
  - id: D2
    description: "EntityType::Collection variant + SyncHub::publish_to_recipients, resolving membership fresh at emit time, never cached"
    requirement: "SYNC-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#collection_event_frame_has_exactly_four_keys"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#non_member_websocket_receives_zero_frames_on_shared_mutation"
        status: pass
    human_judgment: false
  - id: D3
    description: "update()/delete()/move_item() close all three Phase-22-left TODO(phase-23, WR-09) fan-out handoffs: shared mutation bumps the collection's revision AND every current recipient's vault_revision in one transaction, then fans out after commit"
    requirement: "SYNC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#collection_revision_bump_visible_to_other_member_live"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#delete_bumps_collection_revision_and_notifies_other_member_live"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#move_item_bumps_both_collections_each_notified_only_own_recipients"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#non_member_websocket_receives_zero_frames_across_move_and_delete"
        status: pass
    human_judgment: false
  - id: D4
    description: "VaultItem gains is_shared/last_editor_email; fetch_items_for's SELECT column list extended with authorization WHERE/JOIN clauses proven byte-identical to their pre-Phase-23 shape"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#fetch_items_for_is_shared"
        status: pass
      - kind: other
        ref: "grep -F 'WHERE user_id = ? AND collection_id IS NULL' / 'WHERE i.user_id = ?' / 'JOIN collection_keys ck ON ck.collection_id = i.collection_id AND ck.recipient_user_id = ?' crates/pv-server/src/routes/vault.rs (all three still match, byte-identical)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-30
status: complete
---

# Phase 23 Plan 01: Sync Model Extension Fan-Out Tracer Summary

**Server-side multi-recipient sync fan-out (SQLite/axum/tokio broadcast): a per-collection revision counter, three closed WR-09 handoffs in vault.rs, and a live 2-session/1-real-WS proof that a shared item's edit reaches every current recipient's WebSocket.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-30T14:20:00Z (approx.)
- **Completed:** 2026-07-30T14:43:03Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Migration 0015 gives every collection its own `revision` counter (SYNC-04) and adds `vault_items.last_editor_user_id` (Plan 23-03's future 409-attribution source), both additive.
- `EntityType::Collection` + `SyncHub::publish_to_recipients` extend the WS fan-out mechanism without widening `SyncEvent`'s four-field shape or re-keying the hub away from `user_id`.
- All three Phase-22-left `TODO(phase-23, WR-09)` blocks in `vault.rs` (`update`, `delete`, `move_item`) are closed: a shared mutation now bumps the affected collection's revision AND every current recipient's `vault_revision`, inside one transaction, then publishes after commit to the freshly-resolved recipient set.
- `move_item()` correctly bumps and separately notifies BOTH the source and destination collections when both exist — a source-only holder never learns the destination's new revision, and vice versa.
- `VaultItem` gains `is_shared`/`last_editor_email`, closing the read-side gap Plans 23-02/23-05 depend on, with `fetch_items_for`'s authorization WHERE/JOIN clauses grep-proven byte-identical to their pre-Phase-23 shape.
- A new `tests/sync_shared.rs` (6 tests) proves the fan-out mechanism live: 2+ real sessions, real WebSocket connections, real collection/item fixtures — no mocked hub.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0015 + fan-out core helpers + close update()'s TODO** - `418c946` (feat)
2. **Task 2: Close delete()/move_item()'s TODOs; extend the tracer test** - `fd6bdb0` (feat)
3. **Task 3: VaultItem gains is_shared/last_editor_email (BLOCKER-1 fix)** - `2d7c13a` (feat)

## Files Created/Modified

- `crates/pv-server/migrations/0015_sync_shared_fanout.sql` - additive migration: `collections.revision`, `vault_items.last_editor_user_id`
- `crates/pv-server/src/routes/sync.rs` - `EntityType::Collection`, `SyncHub::publish_to_recipients`, extended T-05-04 doc comment
- `crates/pv-server/src/routes/vault.rs` - `resolve_recipients`/`bump_collection_revision`/`bump_recipients_vault_revision` helpers; closed `update`/`delete`/`move_item` TODOs; `last_editor_user_id` writes in `create`/`update`/`move_item`; `VaultItem.is_shared`/`last_editor_email` + `fetch_items_for`'s extended SELECT
- `crates/pv-server/tests/sync_shared.rs` - new: 6 live integration tests (2-3 real sessions, real WS connections)
- `crates/pv-server/tests/vault.rs` - new `fetch_items_for_is_shared` test

## Decisions Made

- `resolve_recipients`'s `owner_user_id` argument is read off each mutation's own row (via an extended `RETURNING` clause on `update`/`delete`'s SELECT, avoiding a second query) rather than `membership.caller_user_id` — the plan explicitly calls out that these differ for a shared item and using the caller would silently exclude the item's true owner from the fan-out.
- `delete()`'s pre-existing "global-vault_revision-as-event-revision" convention (used for a personal item's `Item`-typed delete event, since the deleted row has no per-row revision left to report) is preserved via one extra `SELECT vault_revision FROM users WHERE id = ?` for the CALLER specifically, after the batched multi-recipient bump — the batched bump deliberately has no `RETURNING` (N rows affected, not 1), so this one extra read (not a per-recipient loop) is how the caller's own already-bumped value is recovered for the response event.
- `move_item()` publishes up to TWO independent `Collection`-typed events — one per non-null side of `{source, destination}` — each to its OWN resolved recipient set, never the union, matching the plan's explicit "a source-only holder should not learn the destination collection's new revision number and vice versa."
- Task 3's `fetch_items_for_is_shared` test seeds its "never touched" personal item via raw SQL rather than `POST /api/vault/items`: Task 2's `create()` change (setting `last_editor_user_id` to the creator's own id immediately) means a POST-created item is never actually untouched post-Phase-23, so a genuinely NULL `last_editor_email` requires bypassing the create endpoint, matching Migration 0015's own "NULL means never edited since this column existed" semantics.

## Deviations from Plan

None — plan executed exactly as written. The one design tension surfaced during implementation (below) was resolved by re-reading the plan's own literal instructions, not by deviating from them.

**Note (not a deviation, documented for future-phase awareness):** `resolve_recipients` unions `collection_keys` + `item_shares` + owner regardless of whether an `item_shares` recipient also holds a `collection_keys` row for the same collection. For a collection-scoped item that ALSO carries a direct `item_shares` grant (an edge case the schema permits but the product doesn't currently create through any UI path), that item_shares recipient would receive the `Collection`-typed event even without collection membership. This is the plan's own explicit instruction (Task 1's action text: publish to "the full resolved set"), not an invention of this implementation, and CONTEXT.md's SC 4 test scope (a genuine outsider with zero grants) does not cover this narrower edge case. Flagged here for Phase 25/26 planning awareness, not filed as a defect since no requirement currently exercises this combination.

## Issues Encountered

- Initial `fetch_items_for_is_shared` test assumed a `POST`-created item would have `last_editor_email: null` (per Task 3's literal test description), but Task 2 (same plan, earlier task) already made `create()` set `last_editor_user_id` to the creator's own id — so the assumption was stale relative to Task 2's own change. Resolved by seeding that specific item via raw SQL instead, which is the only way to get a genuinely untouched row post-Phase-23 and matches Migration 0015's own documented semantics.
- No other issues — all three tasks' acceptance criteria (grep checks + `cargo test`) passed on first or second attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The fan-out mechanism (`resolve_recipients`/`bump_collection_revision`/`bump_recipients_vault_revision`/`publish_to_recipients`) is `pub(crate)`, ready for Plan 23-03's `collections.rs` event emission and Plan 23-02's shared-pull read endpoints to reuse directly.
- `VaultItem.is_shared`/`last_editor_email` are populated end-to-end and ready for Plans 23-02/23-05's UI consumption.
- No blockers. `cargo test --workspace` is green (all pre-existing tests plus 6 new `sync_shared.rs` tests and 1 new `vault.rs` test).

---
*Phase: 23-sync-model-extension-shared-data-fan-out*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: crates/pv-server/migrations/0015_sync_shared_fanout.sql
- FOUND: crates/pv-server/tests/sync_shared.rs
- FOUND: .planning/phases/23-sync-model-extension-shared-data-fan-out/23-01-SUMMARY.md
- FOUND: commit 418c946 (Task 1)
- FOUND: commit fd6bdb0 (Task 2)
- FOUND: commit 2d7c13a (Task 3)
