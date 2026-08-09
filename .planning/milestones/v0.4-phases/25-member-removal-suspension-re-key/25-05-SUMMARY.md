---
phase: 25-member-removal-suspension-re-key
plan: 05
subsystem: testing
tags: [rust, sqlx, sqlite, integration-tests, atomicity, aead, nonce, fault-injection]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    plan: "25-03"
    provides: "apply_member_removal_rekey (the write sequence under test) and FAULT_INJECT_AFTER_COLLECTION_INDEX (the test-support-gated fault hook this plan drives)"
  - phase: 25-member-removal-suspension-re-key
    plan: "25-02"
    provides: "rewrap_item_key_for_collection — the rewrap-only pv-core primitive whose keys-only/nonce-uniqueness properties this plan asserts directly"
provides:
  - "remove_member_rejects_stale_batch_before_any_write_when_item_deleted_mid_race — the DISTINCT pre-write race guard proof (KEY-07's validate-before-write property)"
  - "remove_member_rolls_back_completely_on_injected_mid_write_fault — the GENUINE mid-transaction atomicity proof (KEY-07's actual close), with a performed-and-reverted kill-and-revert verification"
  - "nonce_uniqueness_large_batch_of_item_key_rewraps / nonce_uniqueness_large_batch_of_collection_key_seals — 200-item SEC-07 nonce-collision proofs in pv-core"
  - "rekey_cost_and_scope_proportional_to_target_collection_only — KEY-06's control-collection byte-identity proof against a much larger, untouched dataset"
  - "remove_member_called_twice_is_idempotent_and_never_rekeys_twice / remove_member_batch_array_order_does_not_affect_post_state — FAM-08 idempotency and order-insensitivity backstops"
affects: [25-07, 25-08, 25-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Kill-and-revert verification performed live during development (not committed as a second test): temporarily splice a raw `COMMIT` + `BEGIN IMMEDIATE` into the write loop at the exact fault-injection point, confirm the atomicity test goes RED, then `git checkout --` the file to discard the experiment before the real commit — proves a passing adversarial test is not a tautology."
    - "Snapshot-then-diff via a HashMap keyed by the row's own recipient_user_id/item id (not positional Vec comparison) for the control-collection byte-identity proof — order-independent equality check across an entire collection's rows in one assertion."
tech-stack-note: "No new external dependencies. Pure test-only work against Plan 25-03's already-built handler and Plan 25-02's already-built pv-core primitive — no other new production code, matching this plan's own stated scope."

key-files:
  created: []
  modified:
    - crates/pv-server/tests/family_removal.rs
    - crates/pv-core/src/items.rs
    - crates/pv-core/src/identity.rs
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Kept the pre-write race guard test (remove_member_rejects_stale_batch_before_any_write_when_item_deleted_mid_race) and the genuine mid-write atomicity test (remove_member_rolls_back_completely_on_injected_mid_write_fault) as two SEPARATE, honestly-labeled tests, exactly as CONTEXT.md and the plan's must_haves demand — never presenting the pre-write guard as the KEY-07 atomicity proof."
  - "Performed the kill-and-revert verification as a genuinely temporary, uncommitted code change (raw COMMIT + BEGIN IMMEDIATE spliced into apply_member_removal_rekey's write loop), observed the atomicity test go RED, then reverted via `git checkout -- crates/pv-server/src/routes/families.rs` (a specific-file revert of my own uncommitted edit, not a blanket reset) and re-confirmed GREEN before committing the real test — never left the experimental code in any commit."
  - "Control-collection sizing for the cost/scope test: owner + 8 control-only members = 9 collection_keys rows in the control collection, deliberately excluding the target member from ever reaching it — this is the only reading of the plan's 'shared with all 9 members'/'all 9 rows' wording that is internally consistent with 'their sole reachable collection' (the target's OWN reachable set must be exactly the target collection alone, or KEY-06's own scope guard would reject an incomplete removal batch)."
  - "Used HashMap<key, value> snapshot-then-equality-diff (keyed by recipient_user_id for collection_keys, by item id for vault_items) for the control collection's before/after comparison, rather than N individual scalar assertions — a single assertion proves ALL 9 sealed_keys and ALL 50 items' enc_key/enc_data are simultaneously byte-identical, with no accidental gap from asserting only a subset."
  - "REQUIREMENTS.md: flipped KEY-07 from Partial to Complete — this plan delivers exactly the adversarial kill-mid-batch-and-assert-full-rollback proof that Plan 25-03's own note said was the sole outstanding item blocking KEY-07's Complete status. Did not touch FAM-08/FAM-09 (their outstanding gaps — client UX confirmation gate, suspend-side reachability — are unrelated to this plan's scope)."

requirements-completed: [KEY-07]

coverage:
  - id: D1
    description: "The DISTINCT pre-write race guard: a genuine, reachable race (item deleted between the owner's fetch and the removal request) causes the whole batch to be rejected 409 BEFORE any write is issued — proven by direct SELECTs against the surviving item's enc_key, the owner's sealed_key, and the target's still-existing collection_keys/family_members rows."
    requirement: "KEY-07"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_rejects_stale_batch_before_any_write_when_item_deleted_mid_race"
        status: pass
    human_judgment: false
  - id: D2
    description: "The GENUINE KEY-07 atomicity proof: a batch spanning two collections, with FAULT_INJECT_AFTER_COLLECTION_INDEX firing after the FIRST collection's writes are issued and would durably persist — the WHOLE BEGIN IMMEDIATE transaction rolls back, verified via a separate connection (not the request's own dropped transaction). Kill-and-revert performed live this session (splicing a raw COMMIT+BEGIN IMMEDIATE at the same fault point) confirmed the test genuinely goes RED against a broken (split-transaction) implementation before the experimental code was reverted."
    requirement: "KEY-07"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_rolls_back_completely_on_injected_mid_write_fault"
        status: pass
      - kind: manual_procedural
        ref: "kill-and-revert: temporarily spliced a raw `COMMIT` + `BEGIN IMMEDIATE` into apply_member_removal_rekey's write loop right after collection index 0 (RESEARCH.md Pitfall 4's own 'split the transaction into two' alternative); re-ran the SAME test with FAULT_INJECT_AFTER_COLLECTION_INDEX = Some(0) — it FAILED with `assertion left == right failed: X's owner sealed_key must be UNCHANGED after rollback` (left = post-fault durably-changed value, right = pre-call snapshot), response status was still 500. Reverted via `git checkout -- crates/pv-server/src/routes/families.rs`; re-ran both Task 1 tests to confirm GREEN again before committing."
        status: pass
    human_judgment: false
  - id: D3
    description: "SEC-07: 200 independent item-key rewraps (pv-core::items) and 200 independent Collection Key seals (pv-core::identity) each produce 200 pairwise-distinct nonces, via a HashSet-length check over every produced WrappedKey.nonce/SealedKey.nonce — real statistical power, not incidental distinctness."
    requirement: "SEC-07"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#nonce_uniqueness_large_batch_of_item_key_rewraps"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#nonce_uniqueness_large_batch_of_collection_key_seals"
        status: pass
    human_judgment: false
  - id: D4
    description: "KEY-06 adjacency edge / SC 6: removing the ONE member reachable via a small target collection leaves a SEPARATE, much larger control collection (owner + 8 other members, 50 items, never reachable by the target) provably untouched — exact row-count assertions (1 collection_keys row, 2 vault_items rows changed in target) plus direct byte-identity HashMap-diff assertions over all 9 control sealed_keys and all 50 control items' enc_key/enc_data."
    requirement: "KEY-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#rekey_cost_and_scope_proportional_to_target_collection_only"
        status: pass
    human_judgment: false
  - id: D5
    description: "FAM-08 idempotency edge: removing an already-removed member returns 404 and writes zero additional collection_keys/vault_items rows — the Collection Key is never rotated a second time."
    requirement: "FAM-08"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_called_twice_is_idempotent_and_never_rekeys_twice"
        status: pass
    human_judgment: false
  - id: D6
    description: "Batch array order-insensitivity backstop: submitting the identical valid batch with new_sealed_keys/item_rewraps reversed produces byte-identical post-state to the independently-computed forward-order expectation."
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#remove_member_batch_array_order_does_not_affect_post_state"
        status: pass
    human_judgment: false

# Metrics
duration: ~55min active work
completed: 2026-08-05
status: complete
---

# Phase 25 Plan 05: Adversarial Proofs — Atomicity, Nonce Uniqueness, Scope Proportionality Summary

**Six new adversarial tests proving Phase 25's three hardest guarantees: a GENUINE mid-transaction fault-injection atomicity proof (kept honestly distinct from the pre-write race guard, with a performed-and-reverted kill-and-revert showing it can go RED), 200-item nonce-collision proofs in `pv-core`, and a control-collection byte-identity proof that removal cost/scope are bound to the target collection alone.**

## Performance

- **Duration:** ~55 min active work
- **Tasks:** 3/3 completed
- **Files modified:** 4 (3 test/source files extended, 1 requirements doc updated)

## Accomplishments

- `remove_member_rejects_stale_batch_before_any_write_when_item_deleted_mid_race` — the DISTINCT pre-write completeness guard: a genuine, reachable race (an item deleted between the owner's item-list fetch and the removal request) is rejected 409 before any write, kept honestly separate from the atomicity proof below.
- `remove_member_rolls_back_completely_on_injected_mid_write_fault` — the ACTUAL KEY-07 atomicity proof: a batch spanning two collections, with `FAULT_INJECT_AFTER_COLLECTION_INDEX` firing after the first collection's writes are already issued and would durably persist, proves the ENTIRE transaction rolls back (both collections unchanged, target's rows survive in both), verified via a separate connection.
- **Kill-and-revert performed live this session**: temporarily spliced a raw `COMMIT` + `BEGIN IMMEDIATE` into `apply_member_removal_rekey`'s write loop at the exact fault-injection point (mirroring RESEARCH.md Pitfall 4's own "split the transaction into two" alternative), re-ran the atomicity test, and watched it go RED — proving the test genuinely depends on the transaction boundary, not merely a tautological shape. Reverted via `git checkout --` before committing.
- `nonce_uniqueness_large_batch_of_item_key_rewraps` (pv-core) and `nonce_uniqueness_large_batch_of_collection_key_seals` (pv-core) — 200/200 pairwise-distinct nonces each, closing SEC-07 with real statistical power.
- `rekey_cost_and_scope_proportional_to_target_collection_only` — a small target collection is re-keyed while a separate, much larger control collection (owner + 8 other members, 50 items) is provably untouched: exact row-count assertions for the target, HashMap-diff byte-identity assertions for every control row.
- `remove_member_called_twice_is_idempotent_and_never_rekeys_twice` and `remove_member_batch_array_order_does_not_affect_post_state` — FAM-08 idempotency and array-order backstops.
- `REQUIREMENTS.md`: flipped KEY-07 from Partial to Complete — this plan closes the one outstanding item Plan 25-03 itself flagged.

## Task Commits

Each task was committed atomically:

1. **Task 1: KEY-07 — genuine mid-write atomicity fault + distinct pre-write race guard** - `02e7943` (test)
2. **Task 2: SEC-07 nonce uniqueness (200-item) + KEY-06 cost/scope proportionality** - `d0eff68` (test)
3. **Task 3: FAM-08 idempotency + batch array order-insensitivity backstop** - `cb2750e` (test)

**Plan metadata:** SUMMARY.md commit (this file) — see below

## Files Created/Modified

- `crates/pv-server/tests/family_removal.rs` — 6 new tests: the two Task 1 atomicity tests, the Task 2 cost/scope test, and the two Task 3 idempotency/order tests, plus a `register_family_member` N-th-member helper.
- `crates/pv-core/src/items.rs` — `nonce_uniqueness_large_batch_of_item_key_rewraps`.
- `crates/pv-core/src/identity.rs` — `nonce_uniqueness_large_batch_of_collection_key_seals`.
- `.planning/REQUIREMENTS.md` — KEY-07 flipped from Partial to Complete (checkbox + traceability table row + explanatory prose), mirroring Plan 25-03's own established narrative convention.

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Highlights:
- Kept the pre-write race guard and the genuine atomicity proof as two separate, honestly-labeled tests — never conflated.
- Performed the kill-and-revert as a genuinely temporary, uncommitted edit; observed RED; reverted via a specific-file `git checkout --` (never a blanket reset) before committing the real work.
- Control collection sized at owner + 8 members (9 `collection_keys` rows) with the target deliberately excluded, the only internally-consistent reading of the plan's "shared with all 9 members" wording alongside "their sole reachable collection."
- Used `HashMap`-keyed snapshot-then-equality-diff for the control collection's before/after comparison — one assertion proves every row simultaneously, no accidental subset gap.

## Deviations from Plan

None — plan executed exactly as written. All six tests match the plan's `<action>` specifications; no production code changed outside the temporary, reverted kill-and-revert experiment (which per the plan's own instruction was never meant to be committed).

## Kill-and-Revert Verification (required evidence)

Performed against `remove_member_rolls_back_completely_on_injected_mid_write_fault` (not the pre-write guard test, which is a different property):

1. **Change made:** in `crates/pv-server/src/routes/families.rs`'s `apply_member_removal_rekey` write loop, immediately after collection index 0's writes and before the existing `FAULT_INJECT_AFTER_COLLECTION_INDEX` check, spliced in:
   ```rust
   if i == 0 {
       sqlx::query("COMMIT").execute(&mut **tx).await?;
       sqlx::query("BEGIN IMMEDIATE").execute(&mut **tx).await?;
   }
   ```
   This durably persists collection 0's writes via a raw mid-loop COMMIT before the injected fault fires — exactly RESEARCH.md Pitfall 4's own named "split the transaction into two" alternative mechanism.
2. **Re-ran** `remove_member_rolls_back_completely_on_injected_mid_write_fault` with the same `FAULT_INJECT_AFTER_COLLECTION_INDEX = Some(0)`.
3. **Observed RED:**
   ```
   test remove_member_rolls_back_completely_on_injected_mid_write_fault ... FAILED
   thread '...' panicked at crates/pv-server/tests/family_removal.rs:807:5:
   assertion `left == right` failed: X's owner sealed_key must be UNCHANGED after rollback
     left: "{...durably-changed sealed_key bytes...}"
    right: "{...pre-call snapshot bytes...}"
   ```
   The response status was still `500` (the fault still fired), but collection X's `sealed_key` was durably different from its pre-call snapshot — proving the test's assertions genuinely depend on the transaction boundary, not just on the response code.
4. **Reverted** via `git checkout -- crates/pv-server/src/routes/families.rs` (specific-file revert of my own uncommitted experimental edit).
5. **Re-ran** both Task 1 tests (`rejects_stale_batch_before_any_write`, `rolls_back_completely_on_injected_mid_write_fault`) — both GREEN again, confirmed before the Task 1 commit.

## Issues Encountered

**Pre-existing `clippy::explicit_auto_deref` debt in `vault.rs` (18 findings)** — same crate-wide debt already documented in Plan 25-03's own SUMMARY and `deferred-items.md`/`WINDOWS.md`. `cargo clippy -p pv-server --test family_removal -- -D warnings` fails only due to these 18 pre-existing findings, confirmed unrelated to any file this plan touches (this plan added zero production code; `cargo build -p pv-server --bin pv-server` — the actual production build — succeeds cleanly). Out of scope per the executor's scope-boundary rule; not re-logged as a new entry since it is the identical, already-tracked debt.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigated-and-proven | `crates/pv-server/src/routes/families.rs` (tested via `tests/family_removal.rs`) | T-25-02 (carried from Plan 25-03 as `partial-proof-deferred`): now fully closed. The adversarial kill-mid-batch-and-assert-full-rollback proof this plan's Task 1 delivers, PLUS the live kill-and-revert verification (split-transaction experiment genuinely went RED before being reverted), together prove the `BEGIN IMMEDIATE` transaction boundary is load-bearing — not merely "mechanism exists," as Plan 25-03 itself flagged as outstanding. |
| threat_flag: mitigated-and-proven | `crates/pv-core/src/items.rs`, `crates/pv-core/src/identity.rs` | T-25-12 (nonce collision at scale): the 200-item property tests over both `WrappedKey.nonce` and `SealedKey.nonce` give this collision check real statistical power for the first time in this codebase — closing RESEARCH.md Pitfall 7. No collision found across 400 total nonce generations (200 rewraps + 200 seals). |
| threat_flag: mitigated-and-proven | `crates/pv-server/tests/family_removal.rs` | T-25-13 (cost/scope leakage across unrelated collections): the control-collection test proves, via direct byte-identity assertion over ALL 9 `sealed_key` values and ALL 50 items' `enc_key`/`enc_data`, that an unrelated collection sharing the same database is provably untouched by a removal — not merely unmeasured or inferred from a timing signal. |
| threat_flag: no-new-surface | `crates/pv-server/tests/family_removal.rs`, `crates/pv-core/src/items.rs`, `crates/pv-core/src/identity.rs` | This plan is pure test-only work against Plan 25-02's and 25-03's already-built primitives/handler — no new network endpoint, no new auth path, no new file access pattern, no schema change. The `#[cfg(feature = "test-support")]`-gated fault hook this plan drives was already verified absent from a production build in Plan 25-03; this plan adds no new production-reachable surface. |
| threat_flag: accepted | (kill-and-revert experiment, this session only) | The temporary raw `COMMIT`/`BEGIN IMMEDIATE` splice used to prove the atomicity test can go RED was NEVER committed to any git history — verified via `git diff --stat crates/pv-server/src/routes/families.rs` showing zero changes immediately after the `git checkout --` revert, and the file's post-revert content confirmed byte-identical to its pre-experiment state before any subsequent commit. |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- KEY-07, SEC-07, KEY-06, and FAM-08's idempotency edge are now all proven with adversarial, non-trivially-passing tests. `REQUIREMENTS.md` reflects KEY-07's Complete status.
- `apply_member_removal_rekey` and `FAULT_INJECT_AFTER_COLLECTION_INDEX` remain exactly as Plan 25-03 left them (no production code changed by this plan) — Plan 25-06's self-deletion path and any future caller can rely on the same, now-adversarially-proven atomicity guarantee.
- No blockers. No stubs. The one deferred item (pre-existing `vault.rs` clippy debt) is the same already-tracked debt from Plan 25-03 — not a new finding.

## Self-Check: PASSED

- `crates/pv-server/tests/family_removal.rs` — FOUND (10 tests total, all passing)
- `crates/pv-core/src/items.rs` (nonce_uniqueness_large_batch_of_item_key_rewraps) — FOUND
- `crates/pv-core/src/identity.rs` (nonce_uniqueness_large_batch_of_collection_key_seals) — FOUND
- `.planning/REQUIREMENTS.md` (KEY-07 flipped to Complete) — FOUND
- Commit `02e7943` (test: Task 1) — FOUND in git log
- Commit `d0eff68` (test: Task 2) — FOUND in git log
- Commit `cb2750e` (test: Task 3) — FOUND in git log
- Kill-and-revert temporary edit — CONFIRMED absent from git history (reverted via `git checkout --` before any commit)

---
*Phase: 25-member-removal-suspension-re-key*
*Plan: 05*
*Completed: 2026-08-05*
