---
phase: 22-family-collection-data-model-server-authorization
fixed_at: 2026-07-30T10:20:00Z
review_path: .planning/phases/22-family-collection-data-model-server-authorization/22-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 9
skipped: 1
status: partial
---

# Phase 22: Code Review Fix Report

**Fixed at:** 2026-07-30T10:20:00Z
**Source review:** .planning/phases/22-family-collection-data-model-server-authorization/22-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (CR-01, WR-01 through WR-09)
- Fixed: 9
- Skipped: 1 (WR-04, with written rationale below)

**Verification (real output, run against the fix worktree HEAD):**
- `cargo test --workspace` — **all green**, 0 failed (26 test binaries/suites, including the 3 new regression tests this pass adds: `item_resolve_access_personal_branch_honors_item_shares_grant`, `item_resolve_access_collection_branch_creator_never_loses_own_item`, `revoke_access_rejects_emptying_the_last_key_holder`, plus the strengthened `item_share_create_and_revoke_round_trip` and `membership_route_sweep_rejects_non_member_on_every_route`).
- `cargo clippy --workspace --all-targets` — **zero warnings, zero errors**.
- `bash scripts/check-supply-chain.sh` — **exit 0**; `advisories ok, bans ok, licenses ok, sources ok`. Two pre-existing, unrelated warnings noted (duplicate `thiserror-impl` v1/v2 lock entries, one yanked `spin 0.9.8` transitive via `flume`→`sqlx-sqlite`) — neither introduced by this pass, both present before any fix here.

No pre-existing test was modified except `item_share_create_and_revoke_round_trip` (WR-01 explicitly required strengthening it) and the two unit-test fixture helpers in `membership.rs` (`seed_family_and_collection`/new `seed_family_member`) whose seeded data — not their assertions — needed a `family_members` row to satisfy WR-07's join; the assertions and expected outcomes in every test that uses them are unchanged.

## Fixed Issues

### CR-01: `item_shares` silently ignored for every personal item

**Files modified:** `crates/pv-server/src/routes/membership.rs`
**Commit:** `c2e54b7`
**Commit status:** fixed: requires human verification (logic-correctness fix — the review's own suggested code was adapted, not applied verbatim; the 404-vs-403/never-cached/no-Ord invariants were re-verified against the diff but a human should re-read the final `combine_access` chain once before this ships)

`Item::resolve_access` now queries `item_shares` **before** the personal/collection branch split, so a direct per-item share on a personal item is folded into `combine_access(owner_access, item_share_access)` instead of being silently dropped by an early `return`. This single edit also closes **WR-05** and **WR-07** (see below) because all three touch the exact same function and could not be split into independent, individually-compiling commits without an artificial intermediate state.

Added two new unit tests proving the fix: `item_resolve_access_personal_branch_honors_item_shares_grant` (a direct share on a personal item now grants real access, verified `None` before the share exists and `Some(Edit)` after) and confirmed the existing `item_resolve_access_personal_branch_preserves_ownership_rule` / `item_resolve_access_collection_branch_returns_max_of_both_grants` still pass unmodified in assertion shape.

### WR-05: cross-collection move could permanently strand the creator (fixed together with CR-01)

**Files modified:** `crates/pv-server/src/routes/membership.rs`
**Commit:** `c2e54b7` (same commit as CR-01 — inseparable, see above)
**Commit status:** fixed: requires human verification (logic fix)

Implemented option (a) from the review's own fix suggestion: the collection branch of `Item::resolve_access` now folds `owner_access` (the creator's own ownership grant) into the `combine_access` chain alongside `collection_access` and `item_share_access`, so the creator can never lose access to their own row purely because a co-editor moved it to a collection they hold no `collection_keys` row for. This makes `Item::resolve_access` agree with `fetch_items_for`'s `WHERE user_id = ?` scoping, as the review required.

Added `item_resolve_access_collection_branch_creator_never_loses_own_item`, which seeds a collection item whose creator holds no `collection_keys` row at all (simulating the post-move state) and asserts the creator still resolves to `Some(AccessLevel::Edit)`.

### WR-07: access resolution never re-checked family membership (fixed together with CR-01)

**Files modified:** `crates/pv-server/src/routes/membership.rs`
**Commit:** `c2e54b7` (same commit as CR-01 — inseparable, see above)
**Commit status:** fixed

Took the review's first fix option (join `family_members` into resolution now, rather than only documenting the Phase 25 contract): both `Collection::resolve_access` and the collection branch of `Item::resolve_access` now `JOIN collections c ... JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id`, so a `collection_keys` row for a caller no longer in the collection's owning family can never resolve to access. Not exploitable today (no family-removal endpoint exists yet — Phase 25 owns it), but Phase 25 now inherits a resolver that already enforces the invariant instead of one that silently wouldn't.

This required updating the `src/`-internal unit-test fixture helper `seed_family_and_collection` to also seed the owner's `family_members` row (previously it seeded `families`/`collections` only, which the real handlers always accompany with a `family_members` row via `families::create`, but the raw-SQL unit-test fixture did not) and added a new `seed_family_member` helper for tests needing a second member. This is a fixture change, not a test-assertion change — every existing test's expected outcome is unchanged.

### WR-01: `item_share_create_and_revoke_round_trip`'s live-endpoint proof was vacuous

**Files modified:** `crates/pv-server/tests/vault.rs`
**Commit:** `454017c`
**Commit status:** fixed

Added the missing before-assertion: immediately after `create_share` succeeds and before the `DELETE` revoke call, the test now asserts `POST /api/vault/items/{id}/touch` returns `200` for the recipient. Confirmed (by construction — this assertion would fail against the pre-CR-01 code, since the grant was previously inert) that the post-revoke `404` now actually proves revocation, not just "the grant never worked in the first place."

### WR-02: literal-route scan evadable by `.route_service(`/`.nest_service(`/a router-taking helper

**Files modified:** `crates/pv-server/src/routes/mod.rs`
**Commit:** `a7b8541`
**Commit status:** fixed

Extended the forbidden-substring guard from a 2-entry `assert!` pair to a loop over `[".nest(", ".nest_service(", ".merge(", ".route_service("]`. Deliberately did **not** add `.fallback_service(` to this list, unlike the review's literal suggested snippet — verified against the actual source that `.fallback_service(serve)` genuinely lives *inside* `router_with_cors`'s extracted body (the static-file branch is the function's own return expression), so forbidding it would break the already-passing, already-reviewed SPA-fallback mechanism for no security benefit (it registers no named path string this scan could otherwise catch — it's a router-wide 404 catch-all, not a way to hide a `.route(...)`-gated endpoint). Documented this deviation from the review's literal code in the test's own comment.

Also added the helper-function-escape guard the review requested: the extracted body must contain exactly 2 occurrences of `let api =` (the initial `Router::new()` chain and the trailing `family_routes()/membership_routes()` fold) — a third occurrence (e.g. `let api = extra_routes(api);`) now fails the test immediately.

### WR-03: zero-knowledge audit had two evadable needle sets

**Files modified:** `crates/pv-server/src/routes/mod.rs`
**Commit:** `a7b8541` (same commit as WR-02 — same test module, same file)
**Commit status:** fixed

Extended `bare_needles` to include `wrap_identity_secret_key`, `unwrap_user_key`, `wrap_user_key`, `encrypt_item`, `decrypt_item`, `encrypt_item_for_collection`, `decrypt_item_for_collection` — closing both gaps the review identified: `encrypt_item`/`decrypt_item` were previously matched only fully-qualified (so a grouped `use` import evaded them), and `pv_core::keys::unwrap_user_key`/`wrap_user_key` were absent from both needle lists entirely despite `unwrap_user_key` being the single most direct zero-knowledge violation available. Verified the function names exist verbatim in `pv-core` (`keys.rs:114/118`, `identity.rs:224/234`) before adding them, and confirmed the existing `pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt` test still passes — production `src/` code calls none of these, as expected.

### WR-06: `revoke_access` could delete the last `collection_keys` row, orphaning the collection

**Files modified:** `crates/pv-server/src/routes/collections.rs`, `crates/pv-server/tests/collections.rs`
**Commit:** `b1de31c`
**Commit status:** fixed

Added the review's exact guard: before deleting, `revoke_access` now counts remaining `collection_keys` rows excluding the target and returns `409 Conflict` if that count is `0`. Added the requested regression test `revoke_access_rejects_emptying_the_last_key_holder` (sole key-holder self-revokes → `409`; row count and subsequent `GET` confirm the collection was never actually orphaned). Confirmed `revoked_share_loses_access_on_next_request_same_session` (which revokes a non-last holder) still passes unmodified.

### WR-08: route sweep's only adversarial caller was a non-family user

**Files modified:** `crates/pv-server/tests/membership_route_sweep.rs`
**Commit:** `d8586ec`
**Commit status:** fixed — **and confirmed passing on the first run**, per the review's own prediction ("I traced the code and believe it is correct... expect the new assertions to PASS"). No bug found.

Added a second adversarial caller `B` via `common::register_second_family_member` — a genuine family member holding no `collection_keys`/`item_shares` row for FAMILY-A's collection/item — and swept every `membership_routes()` entry against them, asserting `404` throughout (member-vs-member isolation holds; family membership alone confers no per-resource access). Deliberately scoped the new sweep to `membership_entries` only, not `family_entries`: every `membership_routes()` route is exactly what WR-08 names (`GET/POST/DELETE` on `/api/vault/collections/{id}/*` and `/api/vault/items/{id}/*`), while `family_routes()` entries are `FamilyMembership<M>`-gated (family-wide, not per-resource) and include `POST /api/vault/collections`, which a genuine member like `B` is legitimately allowed to call successfully — sweeping that would need a second, separate expected-status table outside this coverage gap's scope, and `families.rs`/`collections.rs`'s own test suites already cover owner-vs-member semantics there. `INSUFFICIENT_LEVEL_EXCEPTIONS` remains empty (every `membership_routes()` entry rejected `B` with `404`, never `403`, confirming family membership never leaks partial resource access).

### WR-09: `move_item`/`update`/`delete` bump only the caller's own `vault_revision`

**Files modified:** `crates/pv-server/src/routes/vault.rs`
**Commit:** `992d62f`
**Commit status:** fixed (via the review's own documented alternate option — see rationale)

Took the review's second fix option rather than its first: implementing the full multi-recipient `vault_revision` fan-out (bumping every `collection_keys`/`item_shares` holder's counter and publishing a `SyncEvent` to each) is a genuine cross-cutting sync-fanout feature, not a contained authorization fix — it touches `sync.rs`'s `SyncHub`/WebSocket push semantics, which this pass's hard constraints explicitly forbid touching, and building it without the surrounding Phase 23 sync-fanout design (which owns "broadcasting a shared item's change to every co-recipient's own sync channel," per `update()`'s own pre-existing comment) risks introducing exactly the kind of unreviewed logic bug this fix pass should not ship silently. Instead added explicit `TODO(phase-23, WR-09):` markers with the full requirement spelled out at all three call sites (`update`, `delete`, `move_item`) so the gap cannot be lost to a stale comment, per the review's own accepted alternative ("file an explicit Phase 23 requirement and add a `// TODO(phase-23):` marker at each of the three call sites so it cannot be lost").

## Skipped Issues

### WR-04: no endpoint returns a shared item's ciphertext at all

**File:** `crates/pv-server/src/routes/vault.rs:144-150` and `crates/pv-server/src/routes/sync.rs:pull`
**Reason:** Assessed per the fix instructions' explicit guidance to determine whether this is genuinely Phase 22's own scope or Phase 23's ("shared-data sync"). It is the latter. `fetch_items_for`/`sync::pull`'s snapshot arm are the READ side of the exact sync-fan-out mechanism WR-09 (above) defers to Phase 23 by the reviewer's own accepted framing — building a collection/item-share-aware read path here would mean designing (a) how a UNION-shaped list query interacts with `sync::pull`'s revision/snapshot semantics, (b) what a shared item's row looks like across `GET /api/vault/items` vs. a prospective `GET /api/vault/items/{id}`, and (c) how `sync.rs`'s `SyncHub` should push these rows to non-owner recipients — none of which this phase's own scope ("family-collection-data-model-server-authorization") or its `CONTEXT.md`/`PLAN.md` artifacts specify, and the hard constraints for this fix pass explicitly forbid touching `sync.rs`. Building a partial, unreviewed answer to those design questions inside a fix pass — rather than a planned phase — would be the "fix I cannot stand behind" the fix instructions ask me to avoid. Recorded here, unresolved, as Phase 22 shipping this known gap; Phase 23 should treat this finding as one of its own inputs alongside WR-09.

**Original issue:** `fetch_items_for` is strictly `WHERE user_id = ?` — a collection member's or item-share recipient's only exercisable capability on a shared item is `POST .../touch` (which requires only `RequireRead` and does not return ciphertext). No `GET /api/vault/items/{id}` route exists. A collection member holding a valid, unwrapped Collection Key currently has no request that returns anything to apply it to.

---

_Fixed: 2026-07-30T10:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
