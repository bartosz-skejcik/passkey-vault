---
phase: 25-member-removal-suspension-re-key
plan: 03
subsystem: api
tags: [rust, axum, sqlx, sqlite, authorization, membership, crypto, key-rotation]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    plan: "25-01"
    provides: "family_members.status suspension gate wired into Collection/Item::resolve_access"
  - phase: 25-member-removal-suspension-re-key
    plan: "25-02"
    provides: "rewrap_item_key_for_collection — the rewrap-only pv-core primitive this plan calls"
provides:
  - "GET /api/vault/collections/{id}/items (collection_items) — the collection's FULL item set from every author"
  - "DELETE /api/families/members/{user_id} (remove_member) — owner-only atomic member removal + re-key"
  - "apply_member_removal_rekey — the ONE shared write-sequence helper Plan 25-06's self-deletion also calls"
  - "FAULT_INJECT_AFTER_COLLECTION_INDEX — test-support-feature-gated fault-injection hook for Plan 25-05"
  - "collections::revoke_access now bumps the revoked recipient's own vault_revision (WR-07 closure)"
affects: [25-05, 25-06, 25-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-referential [dev-dependencies] entry (pv-server depending on itself with a feature flag) to expose a #[cfg(feature = ...)]-gated test-only hook to a separate tests/*.rs integration-test crate, while keeping it genuinely absent from a production cargo build"
    - "Two-phase re-key transaction: verify the ENTIRE client-supplied batch against fresh in-tx SELECTs (collection set, item-id set, remaining-recipient set) before applying ANY write — a mismatch anywhere rejects the whole batch, never a partial apply"
tech-stack-note: "No new external dependencies. The Cargo.toml change is a workspace-internal feature/dev-dependency wiring trick, not a new crate."

key-files:
  created:
    - crates/pv-server/tests/family_removal.rs
  modified:
    - crates/pv-server/Cargo.toml
    - crates/pv-server/src/routes/collections.rs
    - crates/pv-server/src/routes/families.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/membership_route_sweep.rs
    - crates/pv-server/tests/collections.rs
    - crates/pv-server/tests/sync_shared.rs

key-decisions:
  - "Kept the plan's exact sequential per-row UPDATE/DELETE shape in apply_member_removal_rekey's write phase — no multi-row UPSERT — per the plan's own empirically-verified rejection of that alternative."
  - "Used state.db.acquire() for the post-commit fan-out loop (resolve_collection_members/SELECT revision), since the consumed tx cannot be reused after tx.commit() and the pool itself doesn't satisfy the &mut SqliteConnection signature those helpers require without an explicit connection checkout."
  - "Fixed clippy findings introduced by this plan's own new code (unused doc comment on a macro invocation, missing-const-for-thread-local, one redundant explicit auto-deref) — all clean now. Did NOT touch the 18 pre-existing clippy::explicit_auto_deref findings in vault.rs (confirmed present on this plan's own base commit via git stash) — out of scope per the executor's scope-boundary rule; logged in deferred-items.md and the WINDOWS.md ledger."
  - "Extended tests/membership_route_sweep.rs's per-route id substitution for both new routes even though that file is not in the plan's stated files_modified — required to keep this pre-existing structural test (which iterates membership_routes()/family_routes() and panics on an unmapped path) from breaking."
  - "Updated a pre-existing test (tests/sync_shared.rs::revoked_creator_of_shared_item_receives_zero_events_and_no_vault_revision_bump) whose old assertion directly contradicted Task 3's new, intentional behavior. Rewrote it to assert BOTH the new WR-07 property (revoke itself bumps the revoked recipient's own vault_revision by exactly 1) AND the original CR-01 property it still upholds (a LATER, unrelated mutation by another member does not bump it again)."
  - "REQUIREMENTS.md: marked KEY-02, KEY-06, SEC-07 fully Complete (this plan's server-side work + tests genuinely satisfy their full text). Left KEY-07, FAM-08, FAM-09 as PARTIAL with explanatory notes (mirroring this file's own established narrative convention) rather than flipping their checkboxes — KEY-07's explicit fault-injection kill-and-revert proof is Plan 25-05's own deliverable; FAM-08's 'second confirmation' is a client-side UX gate that doesn't exist yet; FAM-09's SUSPENDED half has no way to be reached via the API until Plan 25-04's handler lands. This mirrors Plan 25-01-SUMMARY.md's own precedent of not prematurely auto-checking a row that is genuinely only Partial."

requirements-completed: [KEY-02, KEY-06, SEC-07]

coverage:
  - id: D1
    description: "collection_items (GET /api/vault/collections/{id}/items) returns a collection's FULL item set (id, enc_key, enc_data) from every author, Membership<Collection, RequireRead>-gated"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_atomic_rekey_happy_path_touches_exactly_one_collection_and_severs_item_shares (used as the removed-member 404 probe)"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/membership_route_sweep.rs#membership_route_sweep_rejects_non_member_on_every_route"
        status: pass
    human_judgment: false
  - id: D2
    description: "apply_member_removal_rekey: KEY-06 scope guard (submitted collection set must exactly match target's actual collection_keys), KEY-07 race guard (submitted item-id set and remaining-recipient set must exactly match fresh in-tx state), sequential per-row rewrap writes, item_shares severance, family_members delete, own vault_revision bump, per-collection revision bump — one BEGIN IMMEDIATE transaction"
    requirement: "KEY-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_atomic_rekey_happy_path_touches_exactly_one_collection_and_severs_item_shares"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_zero_collection_access_is_a_no_op_rekey"
        status: pass
    human_judgment: false
  - id: D3
    description: "remove_member (DELETE /api/families/members/{user_id}): owner-only, confused-deputy-guarded, rejects self-removal, atomic re-key, post-commit fan-out excluding the removed member"
    requirement: "FAM-08"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_atomic_rekey_happy_path_touches_exactly_one_collection_and_severs_item_shares"
        status: pass
    human_judgment: false
  - id: D4
    description: "The removed member's very next request to a Membership-gated route returns 404, on the same still-valid bearer token"
    requirement: "FAM-09"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_atomic_rekey_happy_path_touches_exactly_one_collection_and_severs_item_shares"
        status: pass
    human_judgment: false
  - id: D5
    description: "FAULT_INJECT_AFTER_COLLECTION_INDEX gated behind a new test-support Cargo feature (self-referential [dev-dependencies] entry), empirically confirmed absent from a production cargo build"
    requirement: "KEY-07"
    verification:
      - kind: manual_procedural
        ref: "one-time reproduction this session: temporary reference from main.rs, `cargo build -p pv-server --bin pv-server` fails with E0425 (item not found); reference reverted before commit"
        status: pass
    human_judgment: false
  - id: D6
    description: "collections::revoke_access bumps the revoked recipient's own vault_revision in the same transaction as the guarded DELETE (WR-07 closure)"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#revoke_access_bumps_revoked_recipients_own_vault_revision_and_they_see_a_fresh_sync"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#revoked_creator_of_shared_item_receives_zero_events_and_no_vault_revision_bump"
        status: pass
    human_judgment: false

# Metrics
duration: ~25min active work
completed: 2026-08-05
status: complete
---

# Phase 25 Plan 03: Atomic Member Removal + Re-key Summary

**`DELETE /api/families/members/{user_id}` atomically removes a family member and re-keys exactly the collections they could reach, in one `BEGIN IMMEDIATE` transaction, calling `pv-core`'s rewrap-only primitive (never touching item payload ciphertext) — plus the WR-07 vault_revision-bump retrofit onto the sibling `revoke_access` path.**

## Performance

- **Duration:** ~25 min active work
- **Tasks:** 3/3 completed
- **Files modified:** 7 (1 new integration-test file, 6 extended)

## Accomplishments

- `collections::collection_items` (`GET /api/vault/collections/{id}/items`) — returns a collection's FULL item set from every author, the fetch `vault::fetch_items_for` structurally cannot serve.
- `families::apply_member_removal_rekey` — the single, shared write-sequence helper: verifies the client-supplied batch's collection set, item-id set, and remaining-recipient set against fresh in-transaction `SELECT`s (KEY-06/KEY-07 guards, 409 on any mismatch, no partial apply), then applies plain sequential per-row `UPDATE`/`DELETE` writes, severs every `item_shares` row the target held (KEY-02 adjacency), deletes the target's `family_members` row, bumps the target's own `vault_revision`, and bumps every touched collection's revision.
- `families::remove_member` (`DELETE /api/families/members/{user_id}`) — owner-only, confused-deputy-guarded, rejects self-removal, wraps `apply_member_removal_rekey` in a `BEGIN IMMEDIATE` transaction, fans out post-commit over a fresh connection.
- `FAULT_INJECT_AFTER_COLLECTION_INDEX` — a `pub`, `#[cfg(feature = "test-support")]`-gated thread-local, wired via a new `test-support` Cargo feature and a self-referential `[dev-dependencies]` entry — empirically reproduced this session as genuinely absent from a production binary build.
- `collections::revoke_access` now bumps the revoked recipient's own `vault_revision` in the same transaction as the guarded `DELETE` (WR-07 closure), with a new regression test proving their next sync is a fresh snapshot, not the cheap up-to-date shape.
- Both new routes wired into `membership_routes()`/`family_routes()` with bumped cardinality tripwires; `tests/membership_route_sweep.rs`'s per-route id substitution extended for both.

## Task Commits

Each task was committed atomically:

1. **Task 1: collection_items + remove_member atomic re-key — handler and wiring** - `d85404e` (feat)
2. **Task 2: Integration tests — happy path (with item_shares severance) + zero-collection degenerate case** - `1422304` (test)
3. **Task 3: WR-07 retrofit onto collections::revoke_access + regression test** - `8db65da` (fix)
4. **Deviation fix: update CR-01 regression test for WR-07's new behavior; log pre-existing deferred item** - `9e70947` (fix)

**Plan metadata:** SUMMARY.md commit (this file) — see below

## Files Created/Modified

- `crates/pv-server/tests/family_removal.rs` (new) — happy-path tracer test (with `item_shares` severance) + zero-collection degenerate-case test
- `crates/pv-server/Cargo.toml` — new `test-support` feature + self-referential `[dev-dependencies]` entry
- `crates/pv-server/src/routes/collections.rs` — `collection_items` handler + `CollectionItemRow`; `revoke_access` gains the WR-07 own-counter bump
- `crates/pv-server/src/routes/families.rs` — `remove_member`, `apply_member_removal_rekey`, request types, `FAULT_INJECT_AFTER_COLLECTION_INDEX`
- `crates/pv-server/src/routes/mod.rs` — both routes registered, cardinality tripwires bumped (`membership_routes()` 10→11, `family_routes()` 6→7)
- `crates/pv-server/tests/membership_route_sweep.rs` — per-route id substitution extended for both new paths
- `crates/pv-server/tests/collections.rs` — new `revoke_access_bumps_revoked_recipients_own_vault_revision_and_they_see_a_fresh_sync` test
- `crates/pv-server/tests/sync_shared.rs` — updated `revoked_creator_of_shared_item_receives_zero_events_and_no_vault_revision_bump` to assert both the new WR-07 property and the preserved CR-01 property

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Highlights:
- Kept the plan's exact sequential per-row write shape — no multi-row UPSERT.
- Used `state.db.acquire()` for the post-commit fan-out loop, since the consumed `tx` can't be reused after `commit()`.
- Fixed all clippy findings this plan's own new code introduced; documented (did not fix) 18 pre-existing `clippy::explicit_auto_deref` findings in `vault.rs`, confirmed present on this plan's own base commit.
- Extended `tests/membership_route_sweep.rs` (not in the plan's `files_modified`) to keep a pre-existing structural test from panicking on the two new routes.
- Updated a pre-existing test in `tests/sync_shared.rs` whose old assertion directly encoded the OPPOSITE of Task 3's new, intentional behavior.
- REQUIREMENTS.md: marked KEY-02/KEY-06/SEC-07 Complete; left KEY-07/FAM-08/FAM-09 as PARTIAL with explanatory notes rather than auto-checking them (mirroring Plan 25-01's own precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `tests/membership_route_sweep.rs` would panic on the two new routes**
- **Found during:** Task 1
- **Issue:** This pre-existing structural test iterates `membership_routes()`/`family_routes()` and calls `panic!` for any path with no registered id-substitution mapping in its `substitute()` function. Registering `GET /api/vault/collections/{id}/items` and `DELETE /api/families/members/{user_id}` without extending `substitute()` would break this test on the very commit that adds the routes.
- **Fix:** Added the two missing match arms.
- **Files modified:** `crates/pv-server/tests/membership_route_sweep.rs`
- **Verification:** `cargo test -p pv-server --test membership_route_sweep` passes.
- **Committed in:** `d85404e` (part of Task 1's commit)

**2. [Rule 1 - Bug] `tests/sync_shared.rs`'s CR-01 regression test asserted the exact opposite of Task 3's new behavior**
- **Found during:** Task 3, while running the FULL `cargo test -p pv-server` suite (not just the plan's own stated verification commands) to confirm no regressions
- **Issue:** `revoked_creator_of_shared_item_receives_zero_events_and_no_vault_revision_bump` asserted a revoked recipient's `vault_revision` must NEVER move as a result of `revoke_access` — directly contradicted by WR-07's new, intentional one-time revoke-triggered bump.
- **Fix:** Rewrote the test to assert BOTH properties together: the revoke event itself bumps the revoked recipient's own `vault_revision` by exactly 1 (new, WR-07), and a LATER, unrelated mutation by another member does not bump it again (preserved, CR-01's original property — the fan-out audience for ongoing activity still excludes them).
- **Files modified:** `crates/pv-server/tests/sync_shared.rs`
- **Verification:** `cargo test -p pv-server --test sync_shared` — all 16 tests pass. Full `cargo test -p pv-server` (every test binary in the crate) — all green.
- **Committed in:** `9e70947`

---

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1)
**Impact on plan:** Both fixes were necessary to keep the pre-existing test suite green after this plan's intentional, planned behavior changes; no scope creep — no new functionality was added beyond what the plan specified.

## Issues Encountered

**Pre-existing `clippy::explicit_auto_deref` debt in `vault.rs` (18 findings), confirmed unrelated to this plan.** `cargo clippy -p pv-server --all-targets -- -D warnings` fails crate-wide due to 18 findings in `vault.rs`, all pre-existing `&mut *tx` call sites the pinned clippy version now flags as redundant. Reproduced via `git stash` against this plan's own base commit with zero changes from this plan — genuinely pre-existing, out of scope per the executor's scope-boundary rule (only auto-fix issues DIRECTLY caused by the current task's changes). Every clippy finding this plan's own new/changed files introduced was found and fixed (an unused doc comment on a macro invocation, a missing-const-for-thread-local suggestion, one redundant explicit auto-deref) — `cargo clippy -p pv-server --test <name> -- -D warnings` run in isolation against each of this plan's own changed test files surfaces only the same 18 pre-existing `vault.rs` errors, nothing new. Documented in `.planning/phases/25-member-removal-suspension-re-key/deferred-items.md` and logged to the `.planning/WINDOWS.md` broken-windows ledger (entry #3 — note entry #1 from Phase 24 already tracks the identical debt).

**Plan text's `<verification>` block names a test filter that matches zero tests.** `cargo test -p pv-server routes::mod::tests` (as literally written in the plan) matches nothing — the real module path (the file is `routes/mod.rs`, but Rust doesn't include the literal segment `mod` in the module path) is `routes::tests`, not `routes::mod::tests`. Ran the corrected filter instead: `cargo test -p pv-server --lib routes::tests` — all 23 tests pass, including `membership_routes_table_has_expected_cardinality` and `router_literal_routes_match_documented_allowlist`. No code change needed; noting this only so a future reader isn't misled by a trivially "0 passed, 0 failed" run of the plan's literal command.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigated-as-designed | `crates/pv-server/src/routes/families.rs` | T-25-06 (Elevation of Privilege, `remove_member`'s `target_user_id`) fully closed as planned: confused-deputy guard rejects a target with no `family_members` row in the CALLER's own resolved `family_id` (404) before any write, mirroring `collections::add_member`'s identical guard shape. |
| threat_flag: mitigated-as-designed | `crates/pv-server/src/routes/families.rs` | T-25-07 (Tampering, `remove_member`'s client-supplied batch) fully closed: `apply_member_removal_rekey` re-verifies the collection set, item-id set, AND remaining-recipient set against fresh in-transaction `SELECT`s before any write — any mismatch rejects the WHOLE batch (409), never a partial apply. Exercised by both `tests/family_removal.rs` tests (happy path proves the correct-batch success path; the zero-collection test proves the empty-batch edge doesn't special-case around the guard). |
| threat_flag: mitigated-as-designed | `crates/pv-server/src/routes/families.rs` | T-25-09 (Elevation of Privilege, self-targeting) fully closed: explicit `target_user_id == membership.caller_user_id` rejection (400) before any DB work. |
| threat_flag: partial-proof-deferred | `crates/pv-server/src/routes/families.rs` | T-25-02 (carried — Denial of Service/Tampering, transaction atomicity): the REAL mechanism is in place (single `BEGIN IMMEDIATE` transaction, real SQLite ACID guarantees — no error path in `apply_member_removal_rekey` can leave a partial write, by construction) and the fault-injection hook (`FAULT_INJECT_AFTER_COLLECTION_INDEX`) is wired and empirically confirmed absent from a production build. The adversarial kill-mid-batch-and-assert-full-rollback PROOF is explicitly Plan 25-05's own deliverable, not this plan's — flagged so the security auditor doesn't mistake "mechanism exists" for "adversarially proven" before 25-05 lands. |
| threat_flag: new-surface | `crates/pv-server/src/routes/collections.rs` | `GET /api/vault/collections/{id}/items` is new, INTENTIONALLY broader surface than `vault::fetch_items_for` — it returns every author's items in the collection, not just the caller's own. This is deliberate (the caller's `Membership<Collection, RequireRead>` grant already authorizes the WHOLE collection) and matches the co-recipient visibility model `collections::access_list` already established for membership metadata; extending it to item ciphertext blobs (still opaque — `enc_key`/`enc_data`, never decrypted server-side) is a proportionate widening, not a new trust-boundary crossing. Covered by the route-sweep structural test (non-member gets 404). |
| threat_flag: new-surface | `crates/pv-server/src/routes/families.rs` | `DELETE /api/families/members/{user_id}` is a new, owner-only mutating endpoint, registered via `family_routes()` (never a literal `.route()` call) — covered by the SEC-06/SHARE-05 route-sweep structural test and the bumped cardinality tripwire, so a future route added the wrong way trips a pre-existing guard immediately. |
| threat_flag: accepted | (carried from plan's own threat_model) | T-25-08 (Information Disclosure, ex-member's cached local vault state): explicitly out of THIS plan's scope — the `vault_revision`/`collections.revision` bumps this plan performs are the signal; actual client-side cache pruning is Plan 25-07/25-08's job. |
| threat_flag: scope-boundary-honored | `crates/pv-server/src/routes/families.rs` | Direct `item_shares` grants remain revoke-only for the removed target (their own rows are deleted, step 4) — the underlying items' Cipher Keys are deliberately NOT rewrapped for any OTHER remaining direct-share recipient on those same items. This is the plan's own stated, accepted scope boundary (UX-04's honesty disclosure is the compensating control), not an oversight introduced by this implementation. |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `apply_member_removal_rekey` is `pub(crate)` and ready for Plan 25-06's plain-member self-deletion to call with `target=self` — CONTEXT.md's locked FAM-10 instruction ("the same function, not a parallel implementation") is satisfied structurally: there is exactly one place this write sequence is written.
- `FAULT_INJECT_AFTER_COLLECTION_INDEX` is ready for Plan 25-05's kill-mid-batch atomicity proof — the hook, the `test-support` feature, and the self-referential `[dev-dependencies]` wiring are all in place and empirically verified (this session) to be visible to `cargo test`'s dev-dependency graph and absent from a production `cargo build`.
- `collection_items` is ready for Plan 25-07's client to call to build the real removal batch (exactly as this plan's own integration test simulates).
- No blockers. No stubs. The one deferred item (pre-existing `vault.rs` clippy debt) is documented in `deferred-items.md` and the `WINDOWS.md` ledger, not silently dropped.

## Self-Check: PASSED

- `crates/pv-server/tests/family_removal.rs` — FOUND
- `crates/pv-server/Cargo.toml` (test-support feature) — FOUND
- `crates/pv-server/src/routes/collections.rs` (collection_items) — FOUND
- `crates/pv-server/src/routes/families.rs` (remove_member, apply_member_removal_rekey) — FOUND
- `crates/pv-server/src/routes/mod.rs` (both routes registered) — FOUND
- `.planning/phases/25-member-removal-suspension-re-key/deferred-items.md` — FOUND
- Commit `d85404e` (feat: Task 1) — FOUND in git log
- Commit `1422304` (test: Task 2) — FOUND in git log
- Commit `8db65da` (fix: Task 3) — FOUND in git log
- Commit `9e70947` (fix: deviation) — FOUND in git log

---
*Phase: 25-member-removal-suspension-re-key*
*Plan: 03*
*Completed: 2026-08-05*
