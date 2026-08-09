---
phase: 23-sync-model-extension-shared-data-fan-out
fixed_at: 2026-07-30T22:45:00Z
review_path: .planning/phases/23-sync-model-extension-shared-data-fan-out/23-REVIEW.md
iteration: 2
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-07-30
**Source review:** .planning/phases/23-sync-model-extension-shared-data-fan-out/23-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 9 (BL-01, WR-01 through WR-08 — `fix_scope: critical_warning`, IN-01 through IN-07 excluded)
- Fixed: 9
- Skipped: 0

**Verification performed:**
- `cargo build --workspace` — clean
- `cargo test --workspace` — all tests pass (167 pv-server integration/unit tests across all suites, plus pv-core/pv-provider/pv-wasm), including two NEW `sync_shared.rs` tests that replay the exact BL-01 sequence and would fail against the pre-fix code
- `cd web && npx vitest run` — 504/504 passing (492 baseline + 12 new: 2 in `store.test.ts` — n/a this iteration touched no new cases there beyond the existing CR-03 suite — 4 in `sync.test.ts`, 1 in `ItemContextMenu.test.tsx`, 1 in `DetailPanel.test.tsx`, plus the rewritten `sync.test.ts` shared-revisions describe blocks)
- `cd web && npx tsc --noEmit` — clean

Every fix is committed atomically on branch `gsd-reviewfix/23-73086` (fast-forwarded onto `main` by the cleanup tail). No source files were left in a broken state; no partial/uncommitted changes remain.

**A real bug was caught and fixed mid-pass, not just the review's findings:** my first attempt at WR-03 (moving `move_item`'s Gate 0 read into its own transaction, opened before Gate 2's destination check) self-deadlocked against this codebase's own integration-test harness, which deliberately runs its SQLite pool at `max_connections(1)` (`tests/common/mod.rs`, needed for a non-shared-cache in-memory DB to see its own writes). Opening `tx` before Gate 2 held the pool's one connection while Gate 2 tried to acquire a second — this manifested as five real test failures (500s from a pool-acquire timeout), not a subtle edge case. Caught by running the test suite between fixes (not just at the end), diagnosed correctly, and fixed by re-ordering: both gates stay on the pool (releasing their connection before `tx` opens), and the values that actually feed the mutation's fan-out decisions are freshly re-read from inside `tx`, immediately adjacent to the mutation itself. Documented in `vault.rs`'s own comments so a future reader doesn't reintroduce the same shape.

## Fixed Issues

### BL-01: `move_item` into a collection silently strands a direct-share recipient AND re-creates WR-10's forbidden state

**Files modified:** `crates/pv-server/src/routes/vault.rs`, `crates/pv-server/tests/sync_shared.rs`
**Commit:** `6ec2fcd` (combined with WR-03/WR-08 — see rationale below; the fix tool stages/commits at file granularity, and all three touch `move_item`'s same transaction body)

**Applied fix:** `move_item`'s `bump_direct_share_revision` call is now UNCONDITIONAL on both directions of the move (previously gated on `req.new_collection_id.is_none()`), so a direct-share recipient's cheap-check counter moves whenever the item's `collection_id` changes in either direction — not only "ends up personal". When the move is INTO a collection (`req.new_collection_id.is_some()`), `move_item` now also `DELETE`s any `item_shares` rows on the item inside the same transaction, closing the reverse path into WR-10's "writable but unreadable" state (share a personal item directly, then move it into a collection the recipient isn't a member of). Both changes run inside the existing mutation transaction, in the correct order (bump before delete, since the bump needs to read the about-to-be-deleted rows).

**New regression tests** (`sync_shared.rs`): `share_then_move_into_collection_bumps_recipients_direct_revision_and_revokes_their_access` replays the review's exact sequence — create a personal item, share it directly, move it into a collection the recipient does not belong to — and asserts (a) the recipient's direct-bucket cheap-check revision changes, and (b) the recipient can no longer `PUT`/`DELETE` the item (404, not a silent no-op). `create_share_on_collection_scoped_item_is_bad_request` closes a separate gap the review flagged: WR-10's own guard (from iteration 1) had zero test coverage by name.

### WR-03: `move_item`'s Gate 0 read still ran on a different connection than the mutation it gates

**Files modified:** `crates/pv-server/src/routes/vault.rs` (same commit `6ec2fcd`)

**Applied fix:** the values that actually feed `resolve_recipients`/the collection-revision-bump decisions (`current_collection`, `owner_user_id`) are now re-read from INSIDE the mutation's own transaction, immediately before they're used — not from the earlier pre-tx pool read, which only survives for Gate 0's fast-fail ownership check (which must, by this function's own documented ordering requirement, run before Gate 2's destination check). The transaction now opens with `BEGIN IMMEDIATE` (matching `delete()`'s own WR-04-iteration-1 precedent) since its first statement is this re-read, not the eventual `UPDATE`.

**Important constraint discovered and respected:** Gate 2 (the destination-collection authorization check) MUST complete and release its pool connection before `tx` opens — this codebase's test harness runs its pool at `max_connections(1)`, and opening `tx` first self-deadlocks Gate 2's own connection acquisition. Documented inline so this isn't silently reintroduced.

### WR-04: `create_share`'s WR-10 guard read `collection_id` outside its own transaction

**Files modified:** `crates/pv-server/src/routes/vault.rs` (same commit `6ec2fcd`, see the file-granularity note above — this landed in the same commit as BL-01/WR-03/WR-08 despite being a separate function, because the commit tool stages whole files, not hunks, and I did not want to force an artificial second empty-diff commit)

**Applied fix:** the transaction now begins FIRST, and the guard's `SELECT collection_id FROM vault_items WHERE id = ?` — along with the `is_family_member`/`has_keypair` checks that follow it — all run on `&mut *tx` instead of `&state.db`, closing the same TOCTOU shape as BL-01/WR-03: a concurrent `move_item` into a collection between the read and the `INSERT` can no longer slip the forbidden row through.

### WR-08: dropping the owner from `resolve_recipients`' collection arm silently un-notified them on a collection→personal move

**Files modified:** `crates/pv-server/src/routes/vault.rs` (same commit `6ec2fcd`)

**Applied fix:** `move_item`'s bump-audience union (`all_recipients`) now explicitly inserts the item's own `owner_user_id` whenever the move leaves the item personal (`req.new_collection_id.is_none()`) — covering the case where the owner was not a member of the SOURCE collection (reachable: creator revoked, then a remaining edit-capable member moves the item back out). This widens ONLY the `vault_revision`-bump audience, never a `Collection`-typed event's audience (`source_collection_members`/`dest_collection_members` are untouched).

### WR-05: `add_member`/`revoke_access` publish a `Collection` event whose revision provably didn't move

**Files modified:** `crates/pv-server/src/routes/sync.rs`, `crates/pv-server/src/routes/collections.rs`
**Commit:** `1812536` (combined with WR-06 — both touch the same handlers' adjacent code, see rationale below)

**Applied fix:** documented the gap explicitly in the wire contract rather than silently carrying it forward, per the instruction that an honest documented limitation beats a silent one. `sync.rs`'s `EntityType::Collection` doc comment now states plainly that a membership-change event's `revision` is `collections.revision`, unbumped by a pure membership change, and that clients MUST therefore treat receipt of ANY `Collection`-typed event as an unconditional re-fetch trigger — never gated on comparing this event's `revision` against a cached value. Cross-referenced from both `add_member`'s and `revoke_access`'s own comments in `collections.rs` so a reader at either call site finds the same explanation.

**Why not bump `collections.revision` instead:** iteration 1's rationale still holds — doing so would silently change the asserted revision values several existing `tests/collections.rs`/`tests/sync_shared.rs` fixtures depend on, and CONTEXT.md's own locked design call ("only item mutations bump it") would need to be explicitly overturned, which is a product/design decision beyond this fix pass's scope, not a code defect to silently patch.

### WR-06: two different definitions of "a collection's event audience" coexisted

**Files modified:** `crates/pv-server/src/routes/collections.rs` (same commit `1812536`)

**Applied fix:** deleted `collections.rs`'s own `resolve_collection_recipients` (a bare `SELECT recipient_user_id FROM collection_keys WHERE collection_id = ?`) entirely and imported `vault.rs::resolve_collection_members` instead — the SAME `collection_keys` + `collections` + `family_members` join `Collection::resolve_access` itself uses. `add_member` and `revoke_access` now both call the one shared definition. This closes the divergence the review flagged (a stale `collection_keys` row for someone no longer in the owning family would previously have received an event from `collections.rs`'s copy while `Membership<Collection, _>` denied them 404 — CR-01's exact leak shape, not reachable today since no family-removal endpoint exists yet, but Phase 25 will make it reachable).

### WR-01: the CR-03 fix's decrypt-failure retry became an unbounded full-snapshot re-download loop

**Files modified:** `web/src/lib/vault/store.ts`, `web/src/lib/i18n/dictionary.ts`
**Commit:** `0224ab7`

**Applied fix:** added `failedMergeAttempts`, a counter of consecutive merges where at least one row failed to decrypt. The watermark is now withheld for up to `MAX_FAILED_MERGE_RETRIES` (3) consecutive attempts (giving a transient race a few chances to self-heal), then advances anyway so the WS/poll loop stops re-downloading and re-decrypting the entire snapshot forever — every affected row stays flagged `undecryptable: true` regardless (the flag, not the watermark, is what keeps `updateVaultItem`'s save-guard and the UI warning active). Reset to 0 on any fully-clean merge and on every `startSync()` (unlock), mirroring `sync.ts`'s existing `sharedPullDisabled` re-arm pattern. Reworded `sync.itemUndecryptableWarning`'s copy (PL+EN) away from "Try refreshing the page" (which cannot help — a refresh re-locks the vault and re-runs the identical failing decrypt) to the honest remedy: this is an AEAD integrity-failure signal, and the right next step is reporting it to the server operator, not refreshing.

### WR-02: `UndecryptableItemError` (and any other edit-mode error) was silently swallowed

**Files modified:** `web/src/components/vault/ItemContextMenu.tsx`, `web/src/components/vault/DetailPanel.tsx`, plus their test files
**Commit:** `d73c8c7`

**Applied fix:** `ItemContextMenu`'s Edit entry is now hidden for `item.undecryptable === true`, mirroring `DetailPanel`'s own existing guard (previously only the passkey-type guard existed here). `DetailPanel`'s `onError` handler is now exhaustive — a non-`RevisionConflictError` (a network failure, or `UndecryptableItemError` racing a background sync) now sets a new `saveError` state that renders a generic `item-save-error-banner` (reusing the existing `error.itemSaveFailed` i18n string, matching the same key `ItemForm`'s own create-mode path already uses for this error class), instead of the spinner simply stopping with nothing shown or saved.

### WR-07: the shared-revisions pull fired unconditionally for every family member, even with no consumer wired up

**Files modified:** `web/src/lib/vault/sync.ts`, `web/src/lib/vault/sync.test.ts`
**Commit:** `beb6e36`

**Applied fix:** added the review's suggested one-line gate — `if (sharedPullDisabled || callbacks.onSharedRevisions === undefined) return;` — so the `GET /api/sync/shared` round trip is skipped entirely (not fetched-then-discarded) for every caller who hasn't wired up `onSharedRevisions` (today: everyone, since `store.ts` doesn't consume it yet — that's Phase 26/27 work per CONTEXT.md). Rewrote the existing test suite: every test that expects the call to actually fire now passes a real `onSharedRevisions` callback; added a new describe block asserting the call is skipped (and the personal pull is unaffected) when the callback is absent, and that a later `startSync()` with a real callback resumes it.

## Skipped Issues

None — all 9 in-scope findings were fixed.

## Notes for the human reviewer

- **BL-01, WR-03, WR-04, and WR-08 all landed in a single commit (`6ec2fcd`)** despite being four separate findings. This is a tooling artifact, not editorial judgment: the commit helper stages/commits at whole-file granularity, and all four touch `crates/pv-server/src/routes/vault.rs` (BL-01/WR-03/WR-08 inside `move_item`, WR-04 inside the separate `create_share` function in the same file). I deliberately staged `move_item`'s hunks alone via a manual patch first, intending WR-04 as its own commit, but the second `--files vault.rs` invocation picked up the whole file's remaining diff. The change itself is correct and independently verified; only the commit boundary is coarser than ideal.
- **WR-05 is a documented gap, not a fix, by design** — see its own entry above. This mirrors iteration 1's WR-06 disposition (same underlying finding, renumbered by the reviewer between iterations) and carries the same rationale forward: bumping `collections.revision` on a membership change is a legitimate follow-up, but it is a product/design decision (overturning CONTEXT.md's locked "only item mutations bump it" call, and updating ~4 existing tests' asserted values) rather than a code defect this fix pass should silently reinterpret.
- **A genuine mid-fix bug (the single-connection-pool self-deadlock) was caught by running `cargo test -p pv-server --tests` between fixes**, not just at the end — five real test failures (500s), diagnosed to a specific, fixable cause, not silenced or worked around by weakening a test or a gate. Worth noting for future fix passes touching `move_item`/`create_share`: this codebase's own test harness (`tests/common/mod.rs`) runs its SQLite pool at exactly 1 connection, so any change that opens a transaction before an unrelated pool-based read/check will self-deadlock there even though production (`max_connections(8)`) would tolerate it.
- All six hard invariants from `23-CONTEXT.md` were re-checked against the final diff and hold: `GET /api/sync`'s scope is untouched; fan-out membership is resolved fresh at emit time in every changed code path (no caching introduced); `SyncEvent` still carries exactly four fields; every revision bump still shares a transaction with its mutation; no `enc_data` rewrite, `last_editor_user_id` still appended/bound last; non-membership still returns 404, never 403 (unaffected by any of this iteration's changes).

---

_Fixed: 2026-07-30_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
