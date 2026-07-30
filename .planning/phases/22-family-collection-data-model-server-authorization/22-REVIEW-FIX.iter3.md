---
phase: 22-family-collection-data-model-server-authorization
fixed_at: 2026-07-30T11:55:00Z
review_path: .planning/phases/22-family-collection-data-model-server-authorization/22-REVIEW.md
iteration: 2
findings_in_scope: 7
fixed: 5
skipped: 2
status: partial
---

# Phase 22: Code Review Fix Report — Iteration 2

**Fixed at:** 2026-07-30T11:55:00Z
**Source review:** .planning/phases/22-family-collection-data-model-server-authorization/22-REVIEW.md (iteration 2 — fix verification)
**Iteration:** 2

**Summary:**
- Findings in scope: 7 (CR-01, WR-01 through WR-06)
- Fixed: 5 (CR-01, WR-01, WR-02, WR-03, WR-04)
- Skipped: 2 (WR-05 — no action needed, confirmed correct as-is; WR-06 — out of this iteration's directed scope, needs a product decision)

**This pass's whole priority, per the fix directive:** iteration 1's WR-05 fix (folding an unconditional creator `Edit` into the collection branch of `Item::resolve_access`) introduced a worse bug than the one it closed — it made collection-access revocation meaningless for any item the revoked member had created, because "creator with no `collection_keys` row" and "just-revoked member with no `collection_keys` row" are the exact same DB predicate. CR-01 below withdraws that fold entirely, per the iteration-2 review's own explicit retraction of its iteration-1 suggestion.

**Verification (real output, run against this fix worktree HEAD, commit `129ca3d`):**
- `cargo test --workspace` — **all green**, 0 failed. `pv-core` (24 tests), `pv-server` lib (52 tests) + 16 integration test binaries (vault, collections, sync, unlock, sessions, passkeys, family, identity_keypair, membership_route_sweep, router_static_fallback, auth, folders, health, etc.), `pv-wasm`, `pv-provider` — every suite passed, including all pre-existing tests unmodified except where a finding explicitly required strengthening/reversing one (see below).
- `cargo clippy --workspace --all-targets` — **zero warnings, zero errors**, exit 0.
- `bash scripts/check-supply-chain.sh` — **exit 0**; `advisories ok, bans ok, licenses ok, sources ok`. Two pre-existing, unrelated warnings noted (duplicate `thiserror-impl` v1/v2 lock entries; one yanked `spin 0.9.8` transitive via `flume`→`sqlx-sqlite`) — identical to iteration 1's report, neither introduced by this pass.

**Sanity check required by the fix directive — "the two new regression tests must FAIL if you revert your `membership.rs` change":**
Explicitly verified, not assumed. For every source-level fix in this pass I reverted just that fix (via `git stash`/manual patch-and-restore inside the fix worktree, never touching the commit history) and reran the new regression test(s) against the reverted code, then restored the fix and reran to confirm green again:

| Fix | Test(s) | Result against **reverted** code | Result against **fixed** code |
|---|---|---|---|
| CR-01 | `item_resolve_access_collection_branch_creator_with_no_grant_has_no_access` (unit) | N/A — new unit test's assertion IS the reverted assertion; the OLD test (`..._creator_never_loses_own_item`) that this test supersedes asserted the opposite and would itself pass on old code / fail on new — confirmed by construction | pass |
| CR-01 | `revoked_creator_loses_edit_on_their_own_created_item_next_request` (integration) | **FAILED** — `left: 200, right: 404` on the PUT assertion (revoked creator still had Edit) | pass |
| CR-01 | `hidden_password_creator_cannot_reassign_own_item_vaultwarden_6269_regression` (integration) | **FAILED** — `left: 404, right: 403` (ownership fold let the SOURCE gate pass with `Edit`; the request failed later, at the destination gate, for the wrong reason — proving the source gate itself was defeated) | pass |
| WR-01/W1 | `revoke_access_last_key_holder_guard_is_atomic_under_concurrency` | **FAILED at trial 0** — `the collection must never end up with zero key-holders — got 0` (reproduced the orphaning race on the very first trial) | pass |
| WR-02/W2 | `item_resolve_access_item_shares_rejects_recipient_outside_owners_family` (unit) | **FAILED** — `left: Some(Edit), right: None` | pass |
| WR-03/W3 | `router_wrapper_and_whole_file_route_scan_has_no_blind_spot` | **FAILED** — caught an injected `.route("/api/secret", ...)` appended to `router()`'s own body (the exact blind spot the finding describes) | pass |
| WR-04/W4 | `pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt` | **FAILED** — caught an injected bare `"hkdf_expand_key"` reference in a file other than `mod.rs` (which is self-excluded, as documented) | pass |

Every fix's regression coverage is real, not vacuous.

## Fixed Issues

### CR-01: the creator's implicit `Edit` survives collection-access revocation — SC#4's "enforced on the very next request" is false for any item the revoked member created

**Files modified:** `crates/pv-server/src/routes/membership.rs`, `crates/pv-server/tests/collections.rs`
**Commit:** `7274b49`
**Commit status:** fixed: requires human verification (authorization-logic change — please re-read the final `Item::resolve_access` collection branch once before this ships)

Dropped the iteration-1 WR-05 fold (`combine_access(combine_access(owner_access, collection_access), item_share_access)`) from the collection branch of `Item::resolve_access` entirely, per the iteration-2 review's own explicit withdrawal of that suggestion. The collection branch now resolves ONLY `combine_access(collection_access, item_share_access)` — a collection-scoped item's access comes from the `collection_keys` row (plus any direct `item_shares` override) and nothing else, so revocation is absolute regardless of who created the item. The personal-item branch (`collection_id IS NULL`) is untouched — the owner's ownership grant there is correct and unrelated, since a personal item's very definition IS "owned by its creator."

Updated the doc comments on `Item` and around the `owner_access` computation to explain why the fold is deliberately absent (the same DB predicate cannot distinguish "creator, never granted" from "member, just revoked").

Rewrote the iteration-1 unit test `item_resolve_access_collection_branch_creator_never_loses_own_item` (which asserted the now-withdrawn `Some(Edit)` behavior — i.e., it encoded the exact bug this pass fixes) into `item_resolve_access_collection_branch_creator_with_no_grant_has_no_access`, asserting `None`. This is the one pre-existing test this pass changed the *assertion* of (not just its fixture), and it's explicitly authorized by the finding, which withdrew its own iteration-1 suggestion.

Added two new adversarial integration tests to `tests/collections.rs`, both proven to fail against the iteration-1 code (see the sanity-check table above):
- `revoked_creator_loses_edit_on_their_own_created_item_next_request` — the SC#4 case: a member creates an item inside a shared collection, has their own collection access revoked, and must get `404` on `PUT`/`DELETE`/`PUT .../collection` for the item they themselves created, via their still-valid session token.
- `hidden_password_creator_cannot_reassign_own_item_vaultwarden_6269_regression` — the SHARE-04/#6269 case, replayed with the `hidden_password` holder as the item's own creator (the existing regression test always has the *owner* create the item, so this exact path — the one iteration-1's fold broke — was previously untested).

The `fetch_items_for` listing-layer half of the finding's suggested fix (a `UNION` arm so a creator's moved item stops appearing, undecryptable, in their own list) is explicitly Phase 23 scope per the finding's own text ("If the `fetch_items_for` half is judged Phase 23 scope... the `resolve_access` half must still land now") — not built here.

### WR-01 (W1): the last-key-holder guard was a non-transactional TOCTOU — two concurrent revokes could still orphan a collection

**Files modified:** `crates/pv-server/src/routes/collections.rs`, `crates/pv-server/tests/collections.rs`
**Commit:** `0abd26f`
**Commit status:** fixed: requires human verification (concurrency-sensitive authorization logic)

Replaced the separate `COUNT(*)` + `DELETE` in `collections::revoke_access` with a single atomic `DELETE ... WHERE ... AND EXISTS (SELECT 1 FROM collection_keys WHERE collection_id = ? AND recipient_user_id <> ?)` statement, so SQLite's single-statement execution is the enforcement mechanism instead of two independently-awaited round trips. `rows_affected() == 0` is disambiguated into `404` (no such grant) vs `409` (grant exists but is the last key-holder) via one follow-up `SELECT`, mirroring `vault::update`/`vault::move_item`'s existing revision-disambiguation shape.

Added `revoke_access_last_key_holder_guard_is_atomic_under_concurrency`, mirroring `tests/passkeys.rs::consume_state_is_atomic_under_concurrent_callers`'s shape: a dedicated multi-connection shared-cache in-memory pool, a `Barrier` releasing two concurrent `DELETE` requests at the same instant, 20 trials. Proven to fail on the very first trial against the pre-fix two-statement version (orphaned collection reproduced deterministically), and green against the fix.

### WR-02 (W2): the `family_members` join from WR-07 (iteration 1) was applied to `collection_keys` only — `item_shares` stayed unjoined on a surface CR-01 just widened to every item

**Files modified:** `crates/pv-server/src/routes/membership.rs`
**Commit:** `fa273f2`
**Commit status:** fixed: requires human verification (authorization-logic change)

Joined `family_members` into the `item_shares` resolution query in `Item::resolve_access`, mirroring `Collection::resolve_access`'s existing join: `fm_o` pins the item OWNER's family (bound to `owner_user_id`, never a client-controlled value), and `fm_r` requires the recipient (bound via the `WHERE` clause to `caller_user_id`) to still hold a `family_members` row in that SAME family. A stale `item_shares` row for a recipient no longer in the owner's family can no longer resolve to access.

Updated the unit test fixture for `item_resolve_access_personal_branch_honors_item_shares_grant` to seed both the owner's and the recipient's `family_members` rows (the join now requires this invariant, which every real `create_share` call already satisfies via its own confused-deputy guard). Added `item_resolve_access_item_shares_rejects_recipient_outside_owners_family`, proven to fail against the unjoined query.

Not exploitable today (no member-removal endpoint exists — Phase 25 owns it), but Phase 25 now inherits a resolver that is consistent between its two grant tables instead of half so.

### WR-03 (W3): the route scan had two blind spots — the `router()` wrapper was entirely unscanned, and the `let api =` counter checked a variable name, not structure

**Files modified:** `crates/pv-server/src/routes/mod.rs`
**Commit:** `e18d9a7`
**Commit status:** fixed

Added a new test, `router_wrapper_and_whole_file_route_scan_has_no_blind_spot`, alongside (not replacing) the existing `router_literal_routes_match_documented_allowlist`:
1. Asserts `pub fn router()`'s own body contains none of `.route(`/`.nest(`/`.nest_service(`/`.merge(`/`.route_service(`/`.fallback_service(` and does call `router_with_cors(` — `router()` is the crate's actual public entry point (`tests/common/mod.rs::test_app` calls it, not `router_with_cors` directly), and it was entirely outside the existing scan's extracted region.
2. Scans the whole *production* region of `src/routes/mod.rs` (everything before the `#[cfg(test)]` module — test-only fixtures like `probe_router`'s own legitimate `.route("/probe", ...)`, and this very test's own source, which necessarily contains the string `".route("` as scanned data, are correctly out of scope) for `.route(` occurrences and requires every one to fall inside `router_with_cors`, `family_routes`, or `membership_routes` — closing the helper-function-under-a-different-binding-name escape the `let api =` name check could not see into, without needing to make that counter itself more clever.

Proven to fail when a `.route("/api/secret", ...)` call was injected into `router()`'s body (restored immediately after verification); the existing `let api =` counter and literal-route allowlist test are both left in place unchanged, since the new file-wide scan is the actual structural backstop now — per the finding's own "keep or drop as taste."

### WR-04 (W4): the zero-knowledge audit's needle list was still a strict subset of `pv-core`'s real plaintext-handling surface

**Files modified:** `crates/pv-server/src/routes/mod.rs`
**Commit:** `129ca3d`
**Commit status:** fixed

Added the five missing bare needles the finding names, confirmed against `grep 'pub fn' crates/pv-core/src/`: `generate_code` (TOTP seed), `derive_master_key` / `wrapping_key_from_password` (plaintext master password), `wrapping_key_from_prf` / `wrapping_key_from_ext_prf` (raw WebAuthn PRF output), `hkdf_expand_key` (server-forbidden IKM). Documented why `random_bytes`/`auth_hash_from_password` remain deliberately absent (both are legitimately server-side).

Verified the `sealed_key` false-positive rejection did NOT regress (`pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt` still passes unmodified — `contains_identifier`'s word-boundary logic was not touched, only the needle list). Verified the new needles actually fire by injecting a bare `"hkdf_expand_key"` reference into `families.rs` (a file other than the self-excluded `mod.rs`) and confirming the test failed, then restoring.

## Skipped Issues

### WR-05: iteration-1 WR-04 remains unresolved (no shared-item read endpoint) — no action needed this pass

**File:** `crates/pv-server/src/routes/vault.rs:144-150` (with `routes/sync.rs::pull`)
**Reason:** The fix directive is explicit: *"The reviewer checked all six success criteria and confirmed none requires reading a shared item's ciphertext back, so the Phase 23 deferral stands... Do not build a read endpoint this phase does not own."* No code change made. This finding is a recorded, accepted gap for Phase 23 to own, not a defect to fix in this pass — iteration 1's `TODO(phase-23, WR-09)` markers (commit `992d62f`) already capture the related fan-out gap.

### WR-06: an `edit` item-share recipient inherits full lifecycle control over someone else's personal item, with no test pinning the intended blast radius

**File:** `crates/pv-server/src/routes/vault.rs:563-566, 616-619, 452-456, 342-345`
**Reason:** This finding was not named in this iteration's fix directive, which explicitly enumerated CR-01 plus exactly four warnings (W1–W4, matching WR-01 through WR-04 above) and explicitly deferred WR-05 (iteration-1's WR-04/WR-09). WR-06 sits outside that enumerated scope. Substantively, it is also not a pure code defect to patch — the finding itself frames it as a **capability-scope question requiring a product decision** ("It may well be the intended reading of 'edit'; the problem is that nothing says so and nothing tests it... decide and pin it," offering two materially different resolutions: restrict re-share/revoke-share to the item's own `user_id`, OR explicitly document "edit == full lifecycle, including delegation" and add a pinning test). Committing to either resolution without that decision would risk locking in behavior the product owner has not chosen. Flagging for an explicit decision before the next pass.

---

_Fixed: 2026-07-30T11:55:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
