---
phase: 31-the-share-dialog-per-person-access-existing-destinations
plan: 01
subsystem: api
tags: [axum, sqlx, sqlite, access-control, sharing, zero-knowledge]

# Dependency graph
requires: []
provides:
  - "PUT /api/vault/collections/{id}/access/{user_id} (collections::update_access) — in-place access-level edit for an existing collection recipient"
  - "PUT /api/vault/items/{id}/shares/{user_id} (vault::update_share) — in-place access-level edit for an existing item-share recipient"
  - "web/src/lib/vault/api.ts: updateCollectionAccess / updateItemShare thin client wrappers"
affects: [31-02, 31-03, 31-04, 31-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place level EDIT via a single UPDATE ... SET access_level = ? on an existing composite-PK row, bounded IDENTICALLY to the sibling grant route (add_member/create_share) — never a looser check just because it's an UPDATE not an INSERT"
    - "PUT chained onto an existing DELETE-only route() entry (additive to registration, not a new path) — mirrors the file's own established .get(...).post(...) chaining precedent"

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/collections.rs (update_access handler, UpdateAccessRequest)
    - crates/pv-server/src/routes/vault.rs (update_share handler, UpdateItemShareRequest)
    - crates/pv-server/src/routes/mod.rs (PUT chained onto both existing DELETE route entries)
    - crates/pv-server/tests/collections.rs (9 new tests)
    - crates/pv-server/tests/vault.rs (4 new tests)
    - web/src/lib/vault/api.ts (updateCollectionAccess, updateItemShare)
    - .planning/phases/31-.../31-VALIDATION.md (31-01-T1/T2 rows marked done)

key-decisions:
  - "Reused a pre-existing, uncommitted implementation found at session start (matched the plan's spec verbatim) rather than rewriting from scratch — but re-derived proper TDD provenance: reverted it to HEAD, wrote the RED tests against the absent routes (confirmed 405), then re-applied the implementation and confirmed GREEN, so the git history genuinely shows RED before GREEN rather than tests written against already-passing code."
  - "Task 2's may_grant_access_level matrix test uses a family-wide FOLDER (not item_bucket) to isolate the 9-pair matrix from the item_bucket-only equality bound, which is tested independently."

requirements-completed: [MOD-01]

coverage:
  - id: D1
    description: "update_access round-trips an in-place level edit (204), reflected in GET .../access, without touching another recipient's row or sealed_key"
    requirement: "MOD-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_round_trip_changes_level_without_touching_other_recipients"
        status: pass
    human_judgment: false
  - id: D2
    description: "update_access 404s (never upserts) against a (collection_id, user_id) pair with no existing collection_keys row, for both ordinary and family-wide collections"
    requirement: "MOD-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_returns_404_for_no_existing_row_and_does_not_upsert"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_returns_404_when_no_existing_row"
        status: pass
    human_judgment: false
  - id: D3
    description: "update_access is bounded IDENTICALLY to add_member — full 9-pair may_grant_access_level matrix and enforce_item_bucket_declared_level_bound (Declared + LegacyUnknown), each independently falsification-proven"
    requirement: "MOD-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_full_may_grant_access_level_matrix"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_enforces_item_bucket_declared_level_bound"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_enforces_item_bucket_bound_on_legacy_null_level_row"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#update_access_rejects_self_escalation_beyond_held_level"
        status: pass
    human_judgment: false
  - id: D4
    description: "update_share (item-share sibling) round-trips a level edit, 404s on no existing row, rejects a read-only caller at the extractor layer, and rejects a malformed access_level before any DB work"
    requirement: "MOD-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#update_share_round_trip_changes_level"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#update_share_returns_404_for_no_existing_row_and_does_not_upsert"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#update_share_rejects_read_only_caller"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#update_share_rejects_malformed_access_level_before_any_db_work"
        status: pass
    human_judgment: false
  - id: D5
    description: "Client thin wrappers updateCollectionAccess/updateItemShare exist for Wave 2's ShareDialog dispatch logic"
    verification:
      - kind: other
        ref: "web/src/lib/vault/api.ts (compiles as part of the existing TypeScript build; not exercised by a test in this plan — first real consumer is 31-02)"
        status: unknown
    human_judgment: true
    rationale: "No web/TypeScript test in this plan calls these wrappers directly (they have no consumer yet — Wave 2's ShareDialog dispatch is the first caller). Correctness of the wire shape is proven server-side by D1-D4; the wrapper itself is a thin pass-through with no logic to unit test in isolation, matching the plan's own established pattern for revokeCollectionAccess/revokeItemShare."

# Metrics
duration: ~30min
completed: 2026-08-18
status: complete
---

# Phase 31 Plan 01: PUT routes for in-place access-level editing Summary

**Two new PUT routes (`collections::update_access`, `vault::update_share`) that turn an already-granted recipient's access-level change from a 409-producing duplicate INSERT into a single, narrow, identically-bounded UPDATE — closing MOD-01's "editable in place" gap with zero new crypto.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-18T20:31:32Z (last task commit)
- **Tasks:** 2/2
- **Files modified:** 6 (2 source, 2 test, 1 client wrapper, 1 validation doc)

## Accomplishments
- `PUT /api/vault/collections/{id}/access/{user_id}` and `PUT /api/vault/items/{id}/shares/{user_id}` exist, are registered (chained onto the existing DELETE route entries), and apply the exact same authorization bound their grant siblings (`add_member`/`create_share`) already prove correct — never a looser check for being an UPDATE instead of an INSERT.
- Both routes 404 on `rows_affected() == 0` — an in-place edit of an existing row, never a silent upsert.
- Full 9-pair `may_grant_access_level` matrix, the `enforce_item_bucket_declared_level_bound` bound (both `Declared` and `LegacyUnknown` states), and the named self-escalation regression are all independently proven against `update_access`, with a mandatory falsification confirming the item_bucket bound is genuinely load-bearing.
- `web/src/lib/vault/api.ts` exports `updateCollectionAccess`/`updateItemShare`, ready for Wave 2's ShareDialog dispatch logic.

## Task Commits

Each task was committed atomically, with TDD RED/GREEN separated:

1. **Task 1 (TDD RED):** `test(31-01): add failing tests for update_access/update_share round-trip` — `a30f822`
2. **Task 1 (TDD GREEN):** `feat(31-01): add PUT routes for in-place access-level editing` — `5c2eb17`
3. **Task 2 (tests + falsification):** `test(31-01): full authorization-matrix coverage for update_access/update_share` — `601e5ae`

_Note: Task 1 has two commits (test → feat) because the implementation was found already written, uncommitted, at session start (see Deviations below) — it was reverted to HEAD to establish a genuine RED baseline before being re-applied as the GREEN commit._

## Files Created/Modified
- `crates/pv-server/src/routes/collections.rs` — `UpdateAccessRequest` struct + `update_access` handler (mirrors `add_member`'s authorization sequence verbatim, plus the item_bucket declared-level bound, plus the `add_member`-identical `SyncEvent` fan-out)
- `crates/pv-server/src/routes/vault.rs` — `UpdateItemShareRequest` struct + `update_share` handler (`Membership<Item, RequireEdit>`-gated, matching `create_share`'s own gate; bumps the target's own `shared_direct_revision`, no WS push)
- `crates/pv-server/src/routes/mod.rs` — `.put(collections::update_access)` / `.put(vault::update_share)` chained onto the existing `.delete(...)` entries at `/api/vault/collections/{id}/access/{user_id}` and `/api/vault/items/{id}/shares/{user_id}`
- `crates/pv-server/tests/collections.rs` — 9 new tests (round trip, 404-not-upsert x2, full 9-pair matrix, item_bucket bound x2 [Declared + LegacyUnknown], self-escalation regression)
- `crates/pv-server/tests/vault.rs` — 4 new tests (round trip, 404-not-upsert, RequireEdit-rejects-read-only, malformed-level-before-DB-work)
- `web/src/lib/vault/api.ts` — `updateCollectionAccess`/`updateItemShare` thin wrappers, mirroring `revokeCollectionAccess`/`revokeItemShare`'s exact shape
- `.planning/phases/31-.../31-VALIDATION.md` — 31-01-T1/T2 rows marked `✅ done`

## Decisions Made
- **Continuation of pre-existing uncommitted work, with TDD provenance re-derived rather than skipped.** At session start, `git status` showed the exact Task 1 implementation (collections.rs/vault.rs/mod.rs/api.ts diffs) already present, uncommitted, and matching the plan's spec verbatim — almost certainly a prior interrupted execution attempt with no SUMMARY and no commit. Rather than committing it as-is (which would have skipped the plan's own `tdd="true"` RED/GREEN discipline and its Non-Negotiable 4's falsification requirement), the implementation was saved as a patch, reverted to HEAD, and the RED tests were written and confirmed failing (405, route not yet registered) against the clean baseline — then the implementation was re-applied and confirmed GREEN. This produces a git history that genuinely demonstrates RED-before-GREEN rather than tests retrofitted onto already-working code.
- **Task 2's `may_grant_access_level` matrix test isolates the bound under test.** The 9-pair matrix runs against a family-wide **folder** (not `item_bucket`), because `enforce_item_bucket_declared_level_bound` is a no-op for folders (`is_item_bucket_collection` is false) — this keeps the matrix test's pass/fail purely a function of `may_grant_access_level`, with the item_bucket dimension proven by two separate, dedicated tests (`Declared` and `LegacyUnknown`).
- **`LegacyUnknown` item_bucket fixture seeded via raw SQL**, mirroring `family_wide_sharing.rs`'s own established pattern (`family_wide_kind = 'item_bucket'`, `family_wide_access_level` NULL) — the API's own `validate_family_wide_access_level` correctly refuses creating one this way, so no other seeding path exists.

## Deviations from Plan

None beyond the TDD-provenance handling described above — every code path matches the plan's `<action>` text exactly (authorization sequence, request-body shape, 404-on-zero-rows-affected discipline, route-chaining shape, and the deliberate absence of a `sealed_key` field on both new request structs).

## Falsifications (mandatory, exact observed output)

**Task 1, RED confirmation** — before the implementation existed (reverted to HEAD), all four Task 1 tests were run and failed exactly as expected because the PUT verb was not yet registered:

```
update_access_returns_404_for_no_existing_row_and_does_not_upsert ... FAILED
  assertion `left == right` failed: a PUT against a (collection_id, user_id) pair with no existing row must 404
    left: 405
   right: 404

update_access_round_trip_changes_level_without_touching_other_recipients ... FAILED
  assertion `left == right` failed: an in-place level edit must return 204
    left: 405
   right: 204

update_share_returns_404_for_no_existing_row_and_does_not_upsert ... FAILED
  assertion `left == right` failed: a PUT against an (item_id, user_id) pair with no existing row must 404
    left: 405
   right: 404

update_share_round_trip_changes_level ... FAILED
  assertion `left == right` failed: an in-place item-share level edit must return 204
    left: 405
   right: 204
```

Restored (re-applied the implementation) and reran `cargo test --workspace --no-fail-fast` — exit code 0, all suites green, including these four tests.

**Task 2, mandatory falsification of the item_bucket bound** — temporarily commented out the `membership::enforce_item_bucket_declared_level_bound(...)` call inside `update_access` (`crates/pv-server/src/routes/collections.rs`), re-ran the two tests that guard it:

```
update_access_enforces_item_bucket_declared_level_bound ... FAILED
  assertion `left == right` failed: an item_bucket declared at 'read' must refuse a level-edit to 'edit',
  even from an edit-holding caller
    left: 204
   right: 403

update_access_enforces_item_bucket_bound_on_legacy_null_level_row ... FAILED
  assertion `left == right` failed: a LegacyUnknown item_bucket must refuse ANY update_access call
  unconditionally, even a same-level one
    left: 204
   right: 403
```

Both tests genuinely discriminate: without the bound, an edit-holding caller could silently escalate an item_bucket recipient past its declared level. Restored the call (`git diff` confirmed byte-identical to the committed state); reran `cargo test --workspace --no-fail-fast` — exit code 0, all suites green again.

## Issues Encountered

None beyond the pre-existing-uncommitted-work situation described above, handled as documented.

## Verification

`cargo test --workspace --no-fail-fast` — **exit code 0**, all 31 test-result blocks report `ok`, zero failures, across the full workspace (`pv-core`, `pv-server` unit + all integration test binaries including `collections.rs` [30 tests], `vault.rs` [28 tests], `membership_route_sweep.rs`, `family_wide_sharing.rs`, and every other existing suite), plus doc-tests. This is the CI-width command specified in the plan's `<verification>` — never `-p pv-server`, per the plan's non-negotiable #5.

`membership_route_sweep.rs`'s generic per-method loop now genuinely exercises `PUT` on both new route entries (previously skipped at `405 METHOD_NOT_ALLOWED`) — confirmed passing as part of the full-suite run above, asserting the expected `404` for both the unrelated caller U and the resource-unrelated family member B, exactly as `DELETE` already did (W-5, no code change needed — the sweep is self-adjusting from `membership_routes()`).

Both new routes registered in `membership_routes()`; `web/src/lib/vault/api.ts` exports `updateCollectionAccess`/`updateItemShare` — both parts of `<verification>`'s stated acceptance bar are met.

## Next Phase Readiness

Both PUT routes and their client wrappers exist and are proven correct/bounded — Wave 2's ShareDialog dispatch logic (31-02) can call `updateCollectionAccess`/`updateItemShare` for the `(currentLevel, pendingLevel)` "update" branch with no further server-side work needed. No blockers.

**Note for the next plan/verifier:** `requirements.mark-complete MOD-01` (run per this plan's own `requirements: [MOD-01]` frontmatter) marked MOD-01 `[x]`/"Complete" in `REQUIREMENTS.md`. This is premature in substance — MOD-01's actual per-person-row UI (the requirement's own text: "one row per selected person, with an access-level select on the right") is built across 31-02 through 31-05, not this plan, which only closes the server-side Q2 gap (in-place level editing). This plan's own frontmatter listing `MOD-01` is what triggers the mark; the phase-level verifier at `/gsd-verify-work` should re-confirm MOD-01 against the FULL phase's shipped UI, not treat this checkbox as sufficient evidence on its own.

## Self-Check: PASSED

All 8 files verified present on disk (routes, tests, client wrapper, SUMMARY, VALIDATION). All 3 task commit hashes (`a30f822`, `5c2eb17`, `601e5ae`) verified present in `git log`.

---
*Phase: 31-the-share-dialog-per-person-access-existing-destinations*
*Completed: 2026-08-18*
