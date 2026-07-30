---
phase: 23-sync-model-extension-shared-data-fan-out
reviewed: 2026-07-30T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - crates/pv-server/migrations/0015_sync_shared_fanout.sql
  - crates/pv-server/src/error.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/sync.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-server/tests/sync.rs
  - crates/pv-server/tests/sync_shared.rs
  - crates/pv-server/tests/vault.rs
  - packages/pv-ui/vault/types.ts
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/DetailPanel.test.tsx
  - web/src/lib/auth/api.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/store.test.ts
  - web/src/lib/vault/sync.ts
  - web/src/lib/vault/sync.test.ts
  - web/e2e/fixtures.ts
  - web/e2e/smoke.spec.ts
  - web/e2e/shared-sync.spec.ts
  - web/playwright.config.ts
  - web/vitest.config.ts
  - web/package.json
  - .github/workflows/ci.yml
findings:
  critical: 3
  warning: 11
  info: 3
  total: 17
status: issues_found
---

# Phase 23: Code Review Report

**Reviewed:** 2026-07-30
**Depth:** standard
**Files Reviewed:** 28 (plus `routes/membership.rs`, `src/lib.rs`, `src/config.rs`, migrations 0001–0014 read as context)
**Status:** issues_found

## Summary

The six locked invariants were checked directly against the SQL and the fan-out
call sites. Four of them hold:

- **Invariant 1 (`GET /api/sync` scope not widened) — HOLDS.** `sync::pull`
  (`sync.rs:84-104`) is unchanged. `fetch_items_for` (`vault.rs:297-336`) added
  only non-filtering SELECT columns; both arms' `WHERE`/`JOIN` clauses are
  intact, arm 1's `id` is correctly qualified as `vault_items.id`, and the
  `LEFT JOIN users` introduces no other column collision (`users` has none of
  `enc_key`/`enc_data`/`revision`/`updated_at`/`last_used_at`/`user_id`/
  `collection_id`; verified against migrations 0001/0002/0010/0014).
- **Invariant 4 (`SyncEvent` shape) — HOLDS.** Still exactly four fields
  (`sync.rs:381-387`); `EntityType::Collection` carries the id in the existing
  `id` field.
- **Invariant 5 (bump + mutation in one transaction) — HOLDS** for
  `create`/`update`/`delete`/`move_item`. Every `bump_collection_revision` /
  `bump_recipients_vault_revision` call is inside the same `tx` as its mutation,
  and every publish is strictly after `tx.commit()`.
- **Invariant 6 (`enc_data` never rewritten / bind order) — HOLDS.**
  `last_editor_user_id` is appended last in every SET clause and bound last
  before the WHERE binds (`vault.rs:197-208`, `449-461`, `773-786`). No
  reordering.

Two do **not** hold, and a third client-side change introduces an
unrecoverable stuck state:

- **Invariant 2/3 (fan-out audience) — BROKEN.** Membership *is* resolved fresh,
  but `resolve_recipients` computes a superset of the collection's membership,
  and the `EntityType::Collection` event is published to that superset. A
  revoked creator and a direct-item-share recipient both receive a collection id
  + revision for a collection they are denied by `Membership<Collection>`
  (CR-01).
- The `direct` bucket's `MAX(revision)` cheap-check cannot represent deletions
  or share changes, and `create_share`/`revoke_share` bump nothing (CR-02).
- `applySyncSnapshot`'s new decrypt-failure fallback advances the revision
  watermark while retaining a stale row at a stale revision, producing a
  permanently stuck item with only a `console.error` (CR-03).

`ApiError::Conflict`'s wire shape is genuinely unchanged (`error.rs:52`,
`70`) — the new `StaleRevisionShared` arm returns early and does not touch it.
The 404-vs-403 discipline in `membership.rs::gate` is intact and the new routes
route through it. `routes/mod.rs`'s structural guards (cardinality 10/4,
literal-route allowlist) were correctly updated.

---

## Critical Issues

### CR-01: `EntityType::Collection` events fan out to non-members — collection id + revision leaked

**File:** `crates/pv-server/src/routes/vault.rs:93-123` (`resolve_recipients`),
`536-559` (`update`), `635-658` (`delete`), `816-870` (`move_item`)

**Issue:** `resolve_recipients` returns
`{collection_keys recipients} ∪ {item_shares recipients} ∪ {vault_items.user_id}`,
and that whole set is then handed to `publish_to_recipients` for a
`SyncEvent { entity_type: Collection, id: <collection_id>, revision }`. The
`item_shares` and owner terms are **not** filtered by collection membership, so
the event reaches users whom `Membership<Collection, RequireRead>` would answer
`404` for. Three independently reachable paths:

1. **Revoked creator.** `vault_items.user_id` never changes on revocation.
   `membership.rs::Item::resolve_access` (lines 327-341) deliberately confers
   *nothing* on the creator of a collection-scoped item — that is the SC#4
   revocation guarantee. But `vault.rs:100` unconditionally inserts
   `owner_user_id` into the recipient set. A member revoked via
   `collections::revoke_access` therefore keeps receiving `Collection` events
   naming a collection they can no longer read, plus a `users.vault_revision`
   bump (`bump_recipients_vault_revision`, `vault.rs:151-166`) on every
   subsequent edit inside it. This directly contradicts invariant 2's
   "a just-removed member never does".

2. **Direct-share recipient on a collection-scoped item.** `vault.rs:113-120`
   unions `item_shares` recipients regardless of `collection_id`. Such a user
   passes `Membership<Item, RequireEdit>` (via `combine_access`) but is denied
   `GET /api/vault/collections/{id}/sync` with `404`. They still learn the
   collection's id and revision from the WS frame. The executor's own flag on
   this is correct: it *is* an access-control hole, not benign — it is the exact
   "collection exists but you're not a member" distinction invariant 3 forbids,
   delivered over a channel that bypasses the `404`-returning gate.

3. **`move_item`'s destination side.** `vault.rs:817-820` builds
   `dest_recipients` from `resolve_recipients(..., Some(dest_id), owner_user_id)`
   — which again unconditionally includes `owner_user_id`. Gate 2
   (`vault.rs:756-758`) only proves the **caller** has edit on the destination,
   never the owner. So `B` (edit on C1 and C2) moving `A`'s item from C1 into C2
   sends `A` a `Collection` event for C2 even though `A` has no grant on C2. The
   comment at `vault.rs:840-848` explicitly claims "a source-only holder must
   never learn the destination collection's new revision, and vice versa" — that
   guarantee is not implemented for the owner.

The `bump_recipients_vault_revision` side effect makes this observable even
without a WS tab: a non-member's `GET /api/sync` flips from `UpToDate` to a full
snapshot purely because of activity in a collection they cannot see — invariant
3's "zero events... including as a side effect of unrelated activity".

**Fix:** Separate the *revision-bump* audience from the *event* audience, and
scope the `Collection`-typed event to actual collection membership. Minimal
shape:

```rust
/// Members of `collection_id` ONLY — never the item owner, never item_shares
/// recipients. This is the audience a Collection-typed SyncEvent may reach.
pub(crate) async fn resolve_collection_members(
    tx: &mut sqlx::SqliteConnection,
    collection_id: &str,
) -> Result<Vec<String>, ApiError> {
    let rows = sqlx::query(
        "SELECT ck.recipient_user_id FROM collection_keys ck \
           JOIN collections c ON c.id = ck.collection_id \
           JOIN family_members fm ON fm.family_id = c.family_id \
                                 AND fm.user_id = ck.recipient_user_id \
          WHERE ck.collection_id = ?",
    )
    .bind(collection_id)
    .fetch_all(&mut *tx)
    .await?;
    rows.into_iter()
        .map(|r| r.try_get("recipient_user_id").map_err(|_| ApiError::Internal))
        .collect()
}
```

Then in `update`/`delete`/`move_item`:

```rust
// Collection event -> members only.
let collection_members = resolve_collection_members(&mut *tx, cid).await?;
state.sync_hub.publish_to_recipients(&collection_members, SyncEvent {
    entity_type: EntityType::Collection, id: cid.clone(), revision: new_collection_rev,
    change_type: ChangeType::Update,
});
// Anyone reached only via item_shares/ownership gets an Item-typed event
// instead — it names an id they provably already have access to.
let item_only: Vec<String> = recipients.iter()
    .filter(|r| !collection_members.contains(r)).cloned().collect();
state.sync_hub.publish_to_recipients(&item_only, SyncEvent {
    entity_type: EntityType::Item, id: id.clone(), revision: new_item_revision,
    change_type: ChangeType::Update,
});
```

Additionally, drop `owner_user_id` from the unconditional insert at
`vault.rs:100` for the collection-scoped case, or gate it on the owner actually
resolving access (`Item::resolve_access`'s own predicate). No test in
`tests/sync_shared.rs` covers any of the three paths above —
`non_member_websocket_receives_zero_frames_on_shared_mutation` (line 269) seeds
a non-member with *no* `item_shares` row and *no* ownership, so it cannot catch
this. Add a case where the non-member is the item's original `user_id`.

---

### CR-02: the `direct` bucket's `MAX(revision)` cheap-check cannot detect deletions or share changes — recipients keep stale/revoked shared items indefinitely

**File:** `crates/pv-server/src/routes/sync.rs:176-185` and `289-296`;
`crates/pv-server/src/routes/vault.rs:935-949` (`create_share`), `960-976`
(`revoke_share`)

**Issue:** The synthetic bucket is
`COALESCE(MAX(vault_items.revision), 0)` over the caller's directly-shared,
`collection_id IS NULL` items. That value is not a monotonic change counter for
the *set* — it is a max over the set's members, so several real changes are
invisible:

- **Deletion.** Recipient holds item X at revision 5 and item Y at revision 5.
  `MAX = 5`. X is deleted (`vault_items` row gone, `item_shares` cascades). `MAX`
  is still 5. `pull_shared_direct` (`sync.rs:298-302`) returns
  `UpToDate { revision: 5 }` for `since=5`. The recipient's client never learns X
  is gone and keeps rendering its decrypted plaintext.
- **New share.** Recipient already holds item X at revision 7. Owner shares item
  Y (revision 3). `MAX` is still 7 → `UpToDate`. The new share never surfaces.
  `create_share` (`vault.rs:935-949`) bumps nothing at all: no
  `users.vault_revision`, no `collections.revision`, no `SyncEvent`.
- **Revoked share.** `revoke_share` (`vault.rs:960-976`) is a bare `DELETE` with
  no bump and no event. If the revoked item was not the max, the recipient's
  cheap-check stays `UpToDate` and the revoked item stays visible and decrypted
  in their store. This is a stale-secret exposure, not merely a UI lag.

`GET /api/sync` does not compensate: `fetch_items_for` never returns items the
caller only reaches via `item_shares`, so the `vault_revision` bump that
`update`/`delete` *do* perform produces a snapshot that silently omits the
shared item.

**Fix:** Stop deriving the bucket from `MAX`. Two workable shapes:

```rust
// (a) Make the bucket a real counter: give item_shares its own monotonic
// column bumped in the same tx as any mutation/creation/revocation, e.g.
//   ALTER TABLE users ADD COLUMN shared_direct_revision INTEGER NOT NULL DEFAULT 0;
// and bump the RECIPIENT's counter from create_share/revoke_share/update/delete.

// (b) Or make the bucket set-sensitive rather than max-sensitive:
"SELECT COUNT(*) * 1000000 + COALESCE(SUM(vault_items.revision), 0) ..."  // fragile
```

(a) is the correct one — it is the same discipline `collections.revision`
already uses, and it makes deletion and revocation representable. In either
case, `create_share` and `revoke_share` must join the WR-01 transaction
discipline and publish an `EntityType::Item` event to the affected recipient
(revocation should notify the *remaining* holders, and must not notify the
just-revoked user — the same shape `collections::revoke_access` already uses at
`collections.rs:366-385`).

---

### CR-03: `applySyncSnapshot`'s decrypt-failure fallback permanently strands the item — stale plaintext, stale revision, and a watermark that says "up to date"

**File:** `web/src/lib/vault/store.ts:194-241` (fallback at `215-224`, folder
twin at `228-240`)

**Issue:** Three interacting problems make this an unrecoverable state, not a
graceful degradation:

1. `lastKnownRevision = snapshot.revision` is assigned at line 195, **before**
   any decrypt is attempted. So even when every row fails to decrypt, the client
   records itself as fully caught up. The next poll sends the new `since` and
   gets `UpToDate` — the failure is never retried.
2. The retained fallback object is the *previous* `VaultItem`, carrying the
   **old** `revision`. So the store believes the item is at revision N while the
   server is at N+1. Any subsequent `updateVaultItem` sends
   `expected_revision: N` → server 409 → the 409 handler calls
   `loadAndDecryptAll()` (`store.ts:317`) → same decrypt failure → same stale
   copy at revision N → `RevisionConflictError` again. The user is in a
   permanent save loop with no path out through the UI.
3. The only signal is `console.error` (`store.ts:220`, `234`). Nothing reaches
   the UI. In a zero-knowledge product, "a row from the server no longer
   authenticates under my key" is precisely the tamper signal the design exists
   to surface, and it is now swallowed. The AEAD's authentication tag is bound
   to `(item_id, revision)` — a server substituting or replaying ciphertext
   produces exactly this failure mode, and the user sees the *old* plaintext
   presented as current.

This is not hypothetical in this repo: `web/e2e/shared-sync.spec.ts:293-299` has
session B write `DUMMY_ENC_KEY`/`DUMMY_ENC_DATA` (non-ciphertext placeholders)
over a real item, and the "conflict attribution" test only passes because this
fallback silently discards the resulting decrypt failure on A's side. The
harness is proving the masking works.

There is also **zero test coverage** for either fallback branch — `grep` over
`web/src/lib/vault/store.test.ts` finds no test that makes `decryptItem` throw
during a merge.

**Fix:** Keep the crash-avoidance, but stop pretending success.

```ts
function applySyncSnapshot(snapshot: SyncSnapshot): void {
  const uk = getUnlockedUserKey();
  if (uk === null) return;

  let anyRowFailed = false;
  if (snapshot.items !== undefined) {
    const previousById = new Map(items.map((i) => [i.id, i]));
    items = snapshot.items.flatMap((row) => {
      try {
        return [decryptItemRow(row, uk)];
      } catch (err) {
        anyRowFailed = true;
        const previous = previousById.get(row.id);
        // Mark the retained copy so the UI can surface it and so no save
        // path treats its stale `revision` as authoritative.
        return previous !== undefined ? [{ ...previous, undecryptable: true }] : [];
      }
    });
    recomputeAllTags();
    notifyListeners();
  }
  // ... folders, same treatment ...

  // Only advance the watermark when the whole snapshot actually applied —
  // otherwise the next poll must re-fetch and retry.
  if (!anyRowFailed) {
    lastKnownRevision = snapshot.revision;
  }
  if (anyRowFailed) {
    setSyncStatus("error"); // or a dedicated integrity-warning channel
  }
}
```

`updateVaultItem` must refuse to save an item flagged `undecryptable` (its
`revision` is known-stale), and `DetailPanel` needs a banner for it. Add unit
tests for: (a) a single failing row keeps the merge alive; (b) the watermark is
NOT advanced; (c) the retained row is flagged; (d) the folder branch behaves
identically.

---

## Warnings

### WR-01: `onSharedRevisions` is never wired — `GET /api/sync/shared` is fetched on every pull cycle and thrown away, and 404s for every single-user vault

**File:** `web/src/lib/vault/sync.ts:59-71`, `web/src/lib/vault/store.ts:415-418`

**Issue:** `pullOnce` unconditionally calls `getSharedRevisions()`, but
`store.ts`'s `syncCallbacks` object declares only `getSinceRevision` and
`onSnapshot` — `onSharedRevisions` is absent, so `callbacks.onSharedRevisions?.()`
is a no-op. A repo-wide grep confirms nothing in `web/src` ever calls
`GET /api/vault/collections/{id}/sync` or `GET /api/sync/shared/direct` either.
The entire client half of the shared pull is dead: the data is fetched and
discarded.

Worse for the primary use case: `pull_shared_revisions` is
`FamilyMembership<RequireRead>`-gated, so a user with no `family_members` row —
i.e. every single-user self-hosted vault, the project's headline persona — gets a
**404 on every pull cycle**: on WS open, on *every* WS message, and every 30s
forever. It is silently swallowed by the `catch` at `sync.ts:69`, so it shows up
only as server access-log noise and doubled request volume.

**Fix:** Either wire `onSharedRevisions` into `store.ts` and implement the
per-collection/direct fetches it is supposed to drive, or gate the call:

```ts
// sync.ts — skip entirely until a consumer exists / the caller is in a family.
if (callbacks.onSharedRevisions !== undefined && !sharedPullDisabled) {
  try {
    const revisions = await getSharedRevisions();
    if (activeCallbacks === callbacks) callbacks.onSharedRevisions(revisions);
  } catch (err) {
    // A 404 means "not in a family" — a permanent condition, not transient.
    if (isNotFoundError(err)) sharedPullDisabled = true;
  }
}
```

### WR-02: `updateVaultItem` drops `isShared` and `lastEditorEmail` from the in-memory item after a successful save

**File:** `web/src/lib/vault/store.ts:335-345`

**Issue:** The replacement `VaultItem` carries `id`, `revision`, `fields`,
`updatedAt`, `lastUsedAt` — but not `isShared`/`lastEditorEmail`, the two fields
this phase added. After saving a shared item, `item.isShared` becomes
`undefined` until the next snapshot lands. `DetailPanel`'s live-conflict
attribution (`DetailPanel.tsx:314`) tests `item.isShared && item.lastEditorEmail`
and will silently fall back to the generic copy in exactly the window a shared
item is most likely to conflict. This is the same class of bug the adjacent
comment (`store.ts:330-334`) documents for `lastUsedAt`.

**Fix:**

```ts
const existing = existingIndex === -1 ? undefined : items[existingIndex];
const updated: VaultItem = {
  id, revision: newRevision, fields, updatedAt: response.updated_at,
  lastUsedAt: existing?.lastUsedAt,
  isShared: existing?.isShared,
  // The caller just became the last editor; the server recorded their id.
  lastEditorEmail: existing?.lastEditorEmail,
};
```

### WR-03: `move_item`'s Gate 0 reads outside the transaction and returns 500 instead of 404 on a missing row

**File:** `crates/pv-server/src/routes/vault.rs:742-751`

**Issue:** `owner_row` is fetched with `.fetch_one(&state.db)` — outside the `tx`
begun at line 765 — and `fetch_one` on zero rows yields `sqlx::Error::RowNotFound`,
which `From<sqlx::Error> for ApiError` (`error.rs:74-79`) maps to
`ApiError::Internal` (500). The `Membership<Item>` extractor makes the row's
existence overwhelmingly likely, but a concurrent `DELETE` between extraction and
this read turns a legitimate 404 into a 500 and logs it as a `db error`. The
out-of-tx read also means `current_collection` (used at `vault.rs:816`, `829`,
`849` to decide which collection to bump and whom to notify) is read at a
different point in time from the mutation.

**Fix:** Move the read inside `tx` and use `fetch_optional`:

```rust
let mut tx = state.db.begin().await?;
let Some(owner_row) = sqlx::query("SELECT user_id, collection_id FROM vault_items WHERE id = ?")
    .bind(&source.resource_id)
    .fetch_optional(&mut *tx)
    .await?
else { return Err(ApiError::NotFound) };
```

(The destination gate at line 757 must then be re-ordered or take the same
connection.)

### WR-04: `delete()`'s transaction upgrades read→write — `SQLITE_BUSY_SNAPSHOT` is not covered by `busy_timeout`

**File:** `crates/pv-server/src/routes/vault.rs:578-600`

**Issue:** `state.db.begin()` issues a *deferred* `BEGIN`. In `delete()` the
first statements are reads (`SELECT user_id, collection_id`, then
`resolve_recipients`'s two `SELECT`s), and only at line 600 does the first write
run. Under WAL, a deferred transaction that reads first and writes later can be
rejected with `SQLITE_BUSY_SNAPSHOT` when another writer committed in between —
and SQLite does **not** invoke the busy handler for that case, so the 5 s
`busy_timeout` configured in `lib.rs:62` provides no protection. The request
fails with a 500 rather than serializing. `create`/`update`/`move_item` are
unaffected (their first statement is a write). Phase 23 widened the write set
per transaction, which raises the collision probability this path is exposed to.

**Fix:** Force an immediate write lock at the top of `delete()`:

```rust
let mut tx = state.db.begin().await?;
sqlx::query("SELECT 1 FROM vault_items WHERE id = ? FOR UPDATE") // no-op in SQLite
```

is not available; use an explicit immediate transaction instead —

```rust
let mut conn = state.db.acquire().await?;
sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
// ... reads + writes on &mut *conn ...
sqlx::query("COMMIT").execute(&mut *conn).await?;
```

or reorder so a write is the first statement. At minimum, add a retry on
`SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` for this handler.

### WR-05: `sync.itemChangedElsewhereAttributed` asserts a live-presence fact the server never records, and can show the viewer their own email

**File:** `web/src/lib/i18n/dictionary.ts:703-706`, consumed at
`web/src/components/vault/DetailPanel.tsx:314-318`

**Issue:** The copy is "{email} is currently editing this item." /
"{email} właśnie edytuje ten element." The value bound to `{email}` is
`item.lastEditorEmail`, sourced from `vault_items.last_editor_user_id` — which
records who last **saved** an edit, not who is currently editing. There is no
presence tracking anywhere in this codebase. Two concrete wrong outputs: (a) the
named person finished and closed the tab an hour ago; (b) the user edited from
their own phone, so the banner tells them *they* are currently editing.

**Fix:** Reword to the fact actually held, e.g. `pl: "{email} zmienił(a) ten
element."` / `en: "{email} changed this item."` — matching
`error.revisionConflictAttributed`'s already-correct phrasing at
`dictionary.ts:478-481` — and suppress the attributed variant when
`lastEditorEmail` equals the current session's own email.

### WR-06: `collections::add_member` / `revoke_access` publish a Collection event but bump nothing, and run their write + fan-out resolution outside a transaction

**File:** `crates/pv-server/src/routes/collections.rs:246-286`, `330-385`

**Issue:** Two problems:

1. Neither bumps `collections.revision` nor any recipient's
   `users.vault_revision`. The doc comment at `collections.rs:261-270` argues
   this is intentional ("only item mutations bump it"), but the consequence is
   that a client which receives the `Collection` event and does the documented
   "drop the cached key and re-fetch" against
   `GET /api/vault/collections/{id}/sync?since=N` gets `UpToDate` back, because
   the revision genuinely did not move. The event carries no way to distinguish
   "membership changed" from "nothing changed". Combined with WR-01 (nothing
   consumes `GET /api/sync/shared`), adding or removing a member currently has
   no observable client effect at all.
2. The `INSERT`/`DELETE`, the `resolve_collection_recipients` call, and the
   `SELECT revision` all run against `&state.db` as three independent
   statements — no transaction. This is the same WR-01 atomicity discipline
   every handler in `vault.rs` follows and `collections::create`
   (`collections.rs:92-116`) itself follows. A concurrent revoke between the
   `INSERT` and the recipient resolution produces a fan-out set that matches
   neither before- nor after-state.

**Fix:** Wrap each handler's write + recipient resolution + revision read in one
`state.db.begin()` transaction (publishing after commit, as `vault.rs` does), and
bump `collections.revision` on a membership change so the per-collection
cheap-check can actually represent it.

### WR-07: no test coverage for the new `applySyncSnapshot` decrypt-failure fallback

**File:** `web/src/lib/vault/store.test.ts` (whole file), against
`web/src/lib/vault/store.ts:215-224`, `228-240`

**Issue:** `store.test.ts` has a full `describe("applySyncSnapshot (background
sync merge)")` block (lines 295-419) covering wholesale replacement, up-to-date
no-op, unrelated-item isolation and post-lock safety — but not one test makes
`decryptItem` throw. The single most security-relevant new branch in the file
(see CR-03) ships untested, and the same gap exists for the folder branch.

**Fix:** Add tests as sketched in CR-03's fix block.

### WR-08: the blocking `web-e2e` CI job runs on Playwright's 30 s default test timeout while the fixture performs four Argon2id derivations

**File:** `web/playwright.config.ts:58-93` (no `timeout` set),
`web/e2e/fixtures.ts:112-122`, `web/e2e/shared-sync.spec.ts:95-118`,
`.github/workflows/ci.yml` (`web-e2e` job)

**Issue:** `defineConfig` sets `webServer.timeout: 600_000` but never sets the
per-test `timeout`, so Playwright's 30 s default applies — and Playwright counts
fixture setup against it. The `twoSessions` fixture registers **two** accounts
in parallel, each performing a client-side Argon2id at the default
`m_cost_kib: 65536, t_cost: 3, p_cost: 4` in WASM, plus a server-side
`auth_hash` re-hash. `shared-sync.spec.ts` then additionally registers *and*
logs in the fixed seed account (two more server-side Argon2 rounds) before the
test body starts. On a shared 2-vCPU GitHub runner two concurrent 64 MiB
memory-hard derivations plus WASM instantiation can plausibly exceed 30 s. This
is a **blocking, non-`continue-on-error`** job by explicit design
(`ci.yml` comment), so a timeout wedges the repo, and `retries: 2` triples the
wall-clock cost of each such flake.

**Fix:** Set an explicit, generous per-test timeout and shrink the fixture's KDF
cost:

```ts
// web/playwright.config.ts
export default defineConfig({
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // ...
});
```

and consider a `PV_E2E` build flag that lowers the register form's `m_cost_kib`
for the harness only (it never guards real data — the seed account's own comment
at `shared-sync.spec.ts:80-82` already concedes this).

### WR-09: `playwright.config.ts` creates a temp directory as a module-scope side effect — one per config evaluation, never cleaned up

**File:** `web/playwright.config.ts:33-34`

**Issue:** `fs.mkdtempSync(...)` runs at import time. Playwright imports the
config in the runner process **and** in every worker process, so each run leaks
at least two `pv-e2e-db-*` directories under `os.tmpdir()`, none of which is ever
removed. Only the runner's `dbPath` is actually used (it is baked into the
`webServer` command string); the workers' copies are silently dead. That is a
latent trap: any future code that reads `dbPath` from inside a test would get a
different, non-existent database and fail confusingly.

**Fix:** Derive the path deterministically from an env var so all evaluations
agree, and clean up in a global teardown:

```ts
const dbDir = process.env.PV_E2E_DB_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "pv-e2e-db-"));
process.env.PV_E2E_DB_DIR = dbDir;
// ...
globalTeardown: "./e2e/global-teardown.ts", // fs.rmSync(process.env.PV_E2E_DB_DIR, {recursive:true})
```

### WR-10: a collection-scoped item carrying an `item_shares` grant is writable but unreadable through every read path

**File:** `crates/pv-server/src/routes/vault.rs:297-336` (`fetch_items_for` arm
2), `crates/pv-server/src/routes/sync.rs:216-268`, `279-336`

**Issue:** For user `R` holding only an `item_shares` grant on an item whose
`collection_id IS NOT NULL`:

- `fetch_items_for` arm 2 requires both `ck.recipient_user_id = R` **and**
  `i.user_id = R` — `R` matches neither, so `GET /api/vault/items` and
  `GET /api/sync` omit the item.
- `pull_shared_collection` is `Membership<Collection, RequireRead>`-gated — `R`
  gets `404`.
- `pull_shared_direct` filters `vault_items.collection_id IS NULL` — the item is
  excluded.

Yet `Item::resolve_access` (`membership.rs:268-285`, `341`) grants `R` real
access, so `PUT /api/vault/items/{id}` and `DELETE` both succeed. `R` can
destroy or overwrite an item they can never read. Combined with CR-01 they also
receive `Collection` events they cannot act on.

**Fix:** Either forbid `item_shares` grants on collection-scoped items in
`create_share` (`vault.rs:907-950`) — returning `BadRequest("use collection
membership for a collection-scoped item")` — or widen `pull_shared_direct` to
include `item_shares` rows on collection-scoped items when the caller is not a
collection member. The former matches CONTEXT.md's framing more closely and also
removes CR-01's second path.

### WR-11: `apiJson` is duplicated in `auth/api.ts` and `vault/api.ts`, and only one carries `details`

**File:** `web/src/lib/auth/api.ts:64-87` vs `web/src/lib/vault/api.ts:33-61`

**Issue:** The two implementations are byte-identical except that
`vault/api.ts`'s version now attaches the full parsed body as
`ApiClientError.details` (the Plan 23-05 addition) while `auth/api.ts`'s does
not. `auth/api.ts` explicitly exists as the shared base
("Also exports the base apiFetch/base64 helpers so ... lib/vault/api.ts can
reuse the same ... logic rather than duplicating it") — that intent has now
drifted. Any error-body field an auth route grows will be silently dropped.

**Fix:** Delete `vault/api.ts`'s copy, move the `details`-carrying version into
`auth/api.ts`, export it, and import it from `vault/api.ts`.

---

## Info

### IN-01: `move_item` runs the identical `item_shares` query twice

**File:** `crates/pv-server/src/routes/vault.rs:816-820`

`resolve_recipients` is called once per collection side, both times with the same
`item_id`, so the `SELECT recipient_user_id FROM item_shares WHERE item_id = ?`
query (`vault.rs:113-116`) executes twice with identical parameters inside the
same transaction. Harmless today, but it makes the two recipient sets
structurally overlap in a way that obscures the source/destination separation the
comment at `vault.rs:840-848` claims. Splitting `resolve_recipients` into
`collection_recipients(collection_id)` + `item_share_recipients(item_id)` would
make both the dedup and CR-01's fix clearer.

### IN-02: the new `console.error` calls are the only signal for a decrypt failure, and carry vestigial lint conventions

**File:** `web/src/lib/vault/store.ts:220`, `234`

Unlike `touchVaultItem`'s `console.debug` (line 387-388, prefixed with
`// eslint-disable-next-line no-console`), the two new `console.error` calls
carry no such directive. There is in fact no ESLint config under `web/` and no
lint step in the `web` CI job, so neither convention is enforced — worth noting
that the codebase's `no-console` discipline is now purely aspirational. Also see
CR-03: a console log is not an adequate channel for an integrity failure.

### IN-03: `pull_shared_revisions`'s `family_members` join can duplicate rows in a future multi-family world

**File:** `crates/pv-server/src/routes/sync.rs:152-160`; same shape in
`vault.rs:310-312`

`JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id`
produces one row per matching `family_members` row. Today `idx_families_singleton`
(`0014_family_sharing.sql`) guarantees exactly one family, so a user has at most
one `family_members` row and duplication is unreachable. When Phase 25+ removes
the singleton constraint, both queries will start emitting duplicate
`CollectionRevision`/`VaultItem` entries. A `SELECT DISTINCT` or an
`EXISTS (...)` subquery instead of a join would be duplication-proof now.

---

_Reviewed: 2026-07-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
