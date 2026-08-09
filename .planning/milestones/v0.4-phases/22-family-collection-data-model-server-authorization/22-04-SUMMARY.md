---
phase: 22-family-collection-data-model-server-authorization
plan: 04
subsystem: api
tags: [axum, sqlx, authorization, sharing, vaultwarden-cve]

requires:
  - phase: 22-family-collection-data-model-server-authorization
    provides: "Plan 22-01's Membership<R,M>/AccessLevel/MinAccess extractor framework; Plan 22-03's Membership<Collection,_>-gated collections.rs module and parse_access_level_from_request helper"
provides:
  - "Collection-aware vault::update/delete/touch (Membership<Item,_> instead of SessionUser-only scoping)"
  - "PUT /api/vault/items/{id}/collection — move-item endpoint closing Vaultwarden #6269 via a dual edit-on-source-AND-destination gate"
  - "membership.rs::require_collection_edit() — reusable destination-collection authorization helper"
  - "POST/DELETE /api/vault/items/{id}/shares[/{user_id}] — direct per-item sharing (SHARE-02 server half)"
affects: [23-realtime-sync-conflict-resolution, 26-family-collections-ui, 25-family-member-removal-rekey]

tech-stack:
  added: []
  patterns:
    - "Re-encrypt-and-replace move: a cross-collection item move is never a bare `UPDATE ... SET collection_id`; collection_id/enc_key/enc_data always update together in the SAME statement, because collection_id is bound into the item's AEAD associated data"
    - "Dual independent Membership gates in one handler: move_item resolves Membership<Item, RequireEdit> as its function-signature extractor (source) AND calls a body-supplied require_collection_edit() helper inline (destination) — two authorization checks, not one, for a single mutation"

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/membership.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/collections.rs
    - crates/pv-server/tests/vault.rs

key-decisions:
  - "move_item requires edit on BOTH the source collection AND the destination collection — a written-rationale addition beyond CONTEXT.md's literal SHARE-04 text, implemented via a second require_collection_edit() call inside the handler body since the axum extractor mechanism can only read the request's own path {id}, not a body-supplied second resource id"
  - "update/delete/touch's SQL WHERE clauses drop the AND user_id = ? filter entirely — the Membership extractor already proved access before the handler body runs, and for a collection-scoped item that filter would be actively WRONG (user_id on a shared item is the original creator, not every current editor)"
  - "create_share's family-membership confused-deputy guard is deliberately family-wide (not scoped through the item's own collection) — v0.4 has exactly one family, and a PERSONAL item being shared directly has no collection to derive a family from"

requirements-completed: [SHARE-04, SHARE-05]

coverage:
  - id: D1
    description: "update/delete/touch are collection-aware via Membership<Item,_> without regressing personal-item behavior"
    requirement: SHARE-05
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs (full pre-existing 18-test suite, unmodified)"
        status: pass
    human_judgment: false
  - id: D2
    description: "PUT /api/vault/items/{id}/collection closes the Vaultwarden #6269 bypass — a hidden_password holder on the item's current collection cannot reassign it anywhere"
    requirement: SHARE-04
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression"
        status: pass
    human_judgment: false
  - id: D3
    description: "move_item additionally requires edit on the destination collection, not just the source"
    requirement: SHARE-05
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#move_item_rejected_when_caller_lacks_edit_on_destination_collection"
        status: pass
    human_judgment: false
  - id: D4
    description: "Direct per-item shares (create/revoke) exist with the same confused-deputy guard as collection sharing"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#item_share_create_and_revoke_round_trip"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-07-30
status: complete
---

# Phase 22 Plan 04: Vault Item Authorization + Move Endpoint (SHARE-04 Fix) Summary

**Made `vault.rs`'s update/delete/touch collection-aware via `Membership<Item,_>`, built the `PUT /api/vault/items/{id}/collection` move endpoint that closes Vaultwarden #6269 with a dual edit-on-source-AND-destination gate, and added direct per-item sharing (SHARE-02's server half).**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-30T09:09:56Z (base commit)
- **Completed:** 2026-07-30T09:21:29Z
- **Tasks:** 2
- **Files modified:** 5 (`vault.rs`, `membership.rs`, `mod.rs`, `tests/collections.rs`, `tests/vault.rs`)

## Accomplishments

- `vault::update`/`delete`/`touch` now gated by `Membership<Item, RequireEdit>` / `Membership<Item, RequireRead>` instead of raw `SessionUser` — dual-mode: personal items behave byte-for-byte as before, collection-scoped items now resolve access via `collection_keys`/`item_shares`
- `PUT /api/vault/items/{id}/collection` (`move_item`) implements the phase's headline security fix: a `hidden_password` holder on an item's current collection is rejected before the handler body ever runs (structural exclusion via `RequireEdit::satisfied_by`), and a second independent `require_collection_edit()` check gates the destination collection too
- The move is a genuine re-encrypt-and-replace — `collection_id`, `enc_key`, `enc_data` all update in one `UPDATE` statement, never a bare FK reassignment
- Direct per-item sharing (`POST`/`DELETE /api/vault/items/{id}/shares[/{user_id}]`) with the same family-membership + published-keypair confused-deputy guard `collections::add_member` uses
- `mod.rs`'s `membership_routes()` table grows from 4 to 9 entries; two pre-existing literal `.route()` calls for items were removed from `router_with_cors`'s chain as part of this refactor

## Task Commits

Each task was committed atomically:

1. **Task 1: Collection-aware update/delete/touch + the move endpoint (SHARE-04 fix)** - `619f41f` (feat)
2. **Task 2: Direct per-item shares (SHARE-02 server half)** - `57602d0` (feat)

**Plan metadata:** (this commit, docs: complete plan)

_Note: both tasks were `tdd="true"` but landed as single commits each — tests and implementation were authored together per task rather than as separate RED/GREEN commits, matching this plan's `<verify>` blocks which pin combined pass/fail assertions rather than a strict two-phase gate._

## Files Created/Modified

- `crates/pv-server/src/routes/vault.rs` - `update`/`delete`/`touch` refactored to `Membership<Item,_>`; added `MoveItemRequest`/`MoveItemResponse`/`move_item()`, `CreateItemShareRequest`/`create_share()`/`revoke_share()`
- `crates/pv-server/src/routes/membership.rs` - added `require_collection_edit()`, the reusable destination-collection authorization helper `move_item` calls
- `crates/pv-server/src/routes/mod.rs` - removed two literal `/api/vault/items/{id}` and `/api/vault/items/{id}/touch` route entries from `router_with_cors`'s chain; added five entries (update/delete, touch, move, create_share, revoke_share) to `membership_routes()`
- `crates/pv-server/tests/collections.rs` - added `hidden_password_holder_cannot_reassign_item_vaultwarden_6269_regression` and `move_item_rejected_when_caller_lacks_edit_on_destination_collection`
- `crates/pv-server/tests/vault.rs` - added `item_share_create_and_revoke_round_trip`

## Decisions Made

- **Dual-gate move endpoint:** `move_item`'s function signature declares `source: Membership<Item, RequireEdit>` as its ONE compile-time-enforced gate (the source collection); the destination collection is checked via a second, explicit `require_collection_edit()` call inside the handler body, since axum's extractor mechanism only reads the request's own path `{id}` and cannot be re-invoked against a body-supplied second resource id. Both checks run BEFORE any DB mutation.
- **Dropped `AND user_id = ?` filters:** Once the `Membership` extractor has already proven access, a redundant ownership filter in the SQL `WHERE` clause is not just superfluous but actively wrong for a collection-scoped item — `vault_items.user_id` is the item's original creator, not every current editor with `edit` access via `collection_keys`/`item_shares`.
- **Family-wide (not collection-scoped) confused-deputy guard for item shares:** `create_share`'s "is the recipient a family member" check queries `family_members` directly rather than deriving the family through the item's collection, because a PERSONAL item (`collection_id IS NULL`) has no collection to derive a family from in the first place, and v0.4 has exactly one family per instance.

## Deviations from Plan

None - plan executed exactly as written, including the written-rationale destination-collection-edit deviation from CONTEXT.md's literal SHARE-04 text, which the plan's own objective already pre-authorized and documented.

## Issues Encountered

- The plan's pinned `<verify>` commands (`cargo test -p pv-server <name1> <name2> -- --test-threads=1`) pass two positional test-name filters directly to `cargo test`, which cargo 1.97 rejects (`cargo test` only accepts one `TESTNAME` positional argument before `--`). Adapted by invoking the same two filters as harness-level args (`cargo test -p pv-server --test collections -- <name1> <name2> --test-threads=1`), which is functionally equivalent (the rustc test harness ORs multiple filter strings) and produced the exact pinned `test result: ok. 2 passed` output. No code change — verification-tooling adaptation only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SHARE-04 (Vaultwarden #6269 closure) and SHARE-05 (uniform authorization across `vault.rs`) are both fully implemented and regression-tested.
- SHARE-02's server half (direct per-item shares) is ready for Phase 26's UI to consume.
- `require_collection_edit()` is now a general-purpose, reusable second-gate helper any future body-supplied-resource-id authorization need (Phase 24 invitations, Phase 25 member removal) can call directly.
- Full `cargo test --workspace` is green (0 failures across every test binary in the workspace); every pre-existing `pv-server` test, including all of Plans 22-01/22-02/22-03's output, is unmodified and passing.

---
*Phase: 22-family-collection-data-model-server-authorization*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: 619f41f (Task 1 commit)
- FOUND: 57602d0 (Task 2 commit)
- FOUND: crates/pv-server/src/routes/vault.rs
- FOUND: crates/pv-server/src/routes/membership.rs
- FOUND: .planning/phases/22-family-collection-data-model-server-authorization/22-04-SUMMARY.md
