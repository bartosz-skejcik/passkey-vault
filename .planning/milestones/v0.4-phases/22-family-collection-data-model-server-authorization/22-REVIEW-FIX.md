---
phase: 22-family-collection-data-model-server-authorization
fixed_at: 2026-07-30T14:10:00Z
review_path: .planning/phases/22-family-collection-data-model-server-authorization/22-REVIEW.md
iteration: 3
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 22: Code Review Fix Report — Iteration 3 (blockers only)

**Fixed at:** 2026-07-30T14:10:00Z
**Source review:** .planning/phases/22-family-collection-data-model-server-authorization/22-REVIEW.md (iteration 3 — final pass)
**Iteration:** 3

**Summary:**
- Findings in scope: 2 (CR-01, CR-02 — the two BLOCKER findings only; scope was deliberately narrowed to these two per the fix directive, since the previous two passes each introduced a new problem while fixing the last one)
- Fixed: 2 (CR-01, CR-02)
- Skipped: 0

All warning and info findings (WR-01…WR-05, IN-01…IN-15) were left untouched, as directed. Their entries in 22-REVIEW.md are unmodified.

## Fixed Issues

### CR-01: the list/sync read path ignored the authorization resolver — a revoked collection member kept receiving post-revocation ciphertext

**Files modified:** `crates/pv-server/src/routes/vault.rs`, `crates/pv-server/tests/collections.rs`
**Commit:** `ee0b683`
**Applied fix:** `fetch_items_for` (the shared row-fetch body reused by `GET /api/vault/items` and `sync::pull`'s snapshot arm) was `WHERE user_id = ?` with no `collection_id`/`collection_keys` predicate — it disagreed with `Item::resolve_access`, which every mutating verb (`PUT`/`DELETE`/`move_item`) already consults. Rewrote the query as a `UNION ALL` of two non-widening arms: (1) personal items (`collection_id IS NULL`, byte-identical to the old behavior), and (2) collection-scoped items the caller both created (`i.user_id = ?`, unchanged bound) AND still resolves live access to, via the same `collection_keys` + `collections` + `family_members` join `Collection::resolve_access` uses. This closes the over-serve (a revoked creator no longer sees post-revocation ciphertext for items they created) without widening the read surface (it never starts listing items *other* people created that the caller can only reach via `collection_keys`/`item_shares` — that remains the deferred Phase 23 read path, untouched). `sync.rs` was not modified — the fix lives entirely in the shared helper `sync::pull` already calls, per the fix directive's explicit constraint not to touch `sync.rs`.

Extended the existing regression test `revoked_creator_loses_edit_on_their_own_created_item_next_request` (`tests/collections.rs`) with two new pairs of assertions: a **before-revoke** sanity check that `GET /api/vault/items` and `GET /api/sync?since=0` both still list the item Marek created (so the after-revoke assertion cannot pass vacuously), and an **after-revoke** assertion that both endpoints no longer return it, on Marek's same still-valid bearer token.

**Mandatory self-check (explicit, per fix directive):** the extended test was run against the pre-fix code (`git stash` the `vault.rs` change, keep the test) and it **failed**, as required:

```
thread 'revoked_creator_loses_edit_on_their_own_created_item_next_request' panicked at crates/pv-server/tests/collections.rs:1286:5:
CR-01: after revocation, GET /api/vault/items must no longer return the item Marek created — he held the CollectionKey and the server keeps handing him fresh ciphertext otherwise
test revoked_creator_loses_edit_on_their_own_created_item_next_request ... FAILED
```

After restoring the fix, the same test passes.

### CR-02: an `edit` item-share recipient could move someone else's personal item into a collection they control, permanently locking the owner out

**Files modified:** `crates/pv-server/src/routes/vault.rs`, `crates/pv-server/tests/collections.rs`
**Commit:** `19ac9d1`
**Applied fix:** Implemented the review's stated product decision verbatim (no further discussion needed, per the fix directive): `access_level: "edit"` on an item share means "may modify the item's contents", never "may re-scope, delegate, or destroy an item belonging to someone else." Added a decision-free ownership gate in `move_item`, placed immediately before the existing destination gate (same single-authorization-path discipline the file already uses for the source/destination checks): fetches the item's current `user_id`/`collection_id`, and if the item is currently personal (`collection_id IS NULL`) and the caller is not its owner, rejects with `403 Forbidden` — regardless of whether the caller otherwise resolves `Edit` via a direct `item_shares` grant. Collection-to-collection moves and personal-item moves by the owner are entirely unaffected; the SHARE-04/#6269 gates and existing regression tests for those paths are untouched.

Added a new regression test `edit_item_share_recipient_cannot_move_owners_personal_item_cr02_regression`: Anna owns a personal item and shares it with R at `edit`; R creates their own collection (which `collections::create` hard-codes them to `edit` on); R attempts to move Anna's item into it — rejected `403` (R provably has *some* access — the item share — so this is the insufficient-scope case, not the no-access `404` case). The test also asserts the item is untouched in the DB (still `collection_id IS NULL`, still revision 1) and, critically, that Anna can still `PUT` her own item afterward — proving nothing was stranded.

**Mandatory self-check (explicit, per fix directive):** the new test was run against the pre-fix code and **failed**, as required:

```
thread 'edit_item_share_recipient_cannot_move_owners_personal_item_cr02_regression' panicked at crates/pv-server/tests/collections.rs:1649:5:
assertion `left == right` failed: CR-02: an `edit` item-share recipient must never be able to re-scope the owner's personal item — `edit` grants content modification, never delegation/re-scoping/destruction
  left: 200
 right: 403
test edit_item_share_recipient_cannot_move_owners_personal_item_cr02_regression ... FAILED
```

After restoring the fix, the same test passes.

## Verification (real output, run against this fix's worktree HEAD, commit `19ac9d1`)

- **`cargo test --workspace`** — all green, 0 failed. Every pre-existing test suite (`pv-core` 24 tests, `pv-server` lib 52 tests, plus all integration binaries: vault, collections, sync, unlock, sessions, passkeys, family, identity_keypair, membership_route_sweep, router_static_fallback, auth, folders, health, etc.), `pv-wasm`, `pv-provider` — every pre-existing test passed **unmodified**, except the one test this pass was explicitly directed to extend (`revoked_creator_loses_edit_on_their_own_created_item_next_request`), which still passes with its original assertions intact plus the four new ones.
- **`cargo clippy --workspace --all-targets`** — zero warnings, zero errors, exit 0.
- **`bash scripts/check-supply-chain.sh`** — exit 0; `advisories ok, bans ok, licenses ok, sources ok`. Two pre-existing, unrelated warnings noted (duplicate `thiserror-impl` v1/v2 lock entries; one yanked `spin 0.9.8` transitive via `flume`→`sqlx-sqlite`) — identical to prior iterations' reports, neither introduced by this pass.

## Scope discipline

Per the fix directive, this pass touched **only** `crates/pv-server/src/routes/vault.rs` and `crates/pv-server/tests/collections.rs` — no other production file was modified. `sync.rs` and the CORS layer were explicitly not touched. `membership.rs`'s resolver (`Item::resolve_access`, `combine_access`, `gate::<M>()`) is unchanged from iteration 3's review snapshot; both fixes live entirely in the two places the review identified as **not** consulting the resolver (the list/sync read path, and `move_item`'s missing ownership check on personal items). All five WR-* findings and all fifteen IN-* findings from 22-REVIEW.md were left untouched, as directed — their entries are unmodified in the review document.

---

_Fixed: 2026-07-30T14:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
