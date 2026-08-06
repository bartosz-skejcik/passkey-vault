---
phase: 25-member-removal-suspension-re-key
reviewed: 2026-08-05T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - crates/pv-core/src/identity.rs
  - crates/pv-core/src/items.rs
  - crates/pv-server/Cargo.toml
  - crates/pv-server/migrations/0018_member_suspension.sql
  - crates/pv-server/src/lib.rs
  - crates/pv-server/src/routes/account.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/families.rs
  - crates/pv-server/src/routes/membership.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-wasm/src/lib.rs
  - crates/pv-server/tests/account_deletion.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/family_removal.rs
  - crates/pv-server/tests/membership_route_sweep.rs
  - crates/pv-server/tests/sync_shared.rs
  - web/src/lib/crypto/index.ts
  - web/src/lib/families/api.ts
  - web/src/lib/families/rekey.ts
  - web/src/lib/families/rekey.real-wasm.test.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/components/settings/ConfirmDialog.tsx
  - web/src/components/settings/FamilyTab.tsx
  - web/src/components/settings/RemoveMemberDialog.tsx
  - web/src/components/settings/SecurityTab.tsx
  - web/src/components/settings/DeleteAccountDialog.tsx
  - web/src/components/settings/FamilyTab.test.tsx
  - web/src/components/settings/RemoveMemberDialog.test.tsx
  - web/src/components/settings/DeleteAccountDialog.test.tsx
  - web/src/components/settings/SecurityTab.test.tsx
  - web/e2e/remove-member.spec.ts
  - web/e2e/delete-account.spec.ts
  - Cargo.lock
findings:
  critical: 4
  warning: 14
  info: 4
  total: 22
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-08-05
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found (equivalent to the `findings_found` label used by the invoking workflow)

## Summary

The server-side re-key transaction (`apply_member_removal_rekey`) is genuinely well built: the KEY-06/KEY-07 scope-and-race guards run fresh inside the transaction, the writes are rewrap-only (`enc_data` is structurally unreachable from the wire shape), the rollback proof is real, and the zero-knowledge boundary holds — no new handler touches plaintext, key material, or PRF output, and no key material appears in any log or error string. `cargo test -p pv-server --test account_deletion --test family_removal --test collections` passes on this checkout.

Four things do not hold.

1. **Account deletion is broken for the ordinary collaboration case.** `vault_items.last_editor_user_id` is a `REFERENCES users(id)` FK with **no `ON DELETE` action** (migration `0015`), and *every* create/update writes it. Any user who has edited an item authored by someone else that survives their deletion cannot delete their account — the `DELETE FROM users` raises `SQLITE_CONSTRAINT_FOREIGNKEY` and the whole handler 500s. Proven empirically against the real migration set (see CR-01).
2. **Suspension does not stop data flow on `GET /api/sync/shared/direct`.** That endpoint is `SessionUser`-only and joins no `family_members` row at all, so a suspended member keeps receiving the full `enc_data` of every directly-shared item — which they can still decrypt with the stable Cipher Key they already hold. FAM-09's "the status predicate is the SOLE enforcement mechanism" claim is only true for the two `resolve_access` paths; three other queries were not updated.
3. **The Remove dialog under-discloses.** `resolveFolder`'s outer `catch` turns a whole-folder resolution failure into a folder that renders with *zero items and no note* — the owner is shown an empty folder for content the removed member genuinely could read, and `Continue` stays enabled. That is the opposite of the UI-SPEC's fail-closed contract, and worse than the count-only fallback the spec was revised to constrain.
4. **The count-only fallback is structural, not runtime.** Standalone `item_shares` entries always render it (with copy that literally says "in this folder" for an item that is not in one), one unresolvable item collapses an entire folder's resolved names, and `ITEM_REVISION = 1` is a guess the e2e made true by construction rather than a property of real data.

On the fault-injection hook (priority area 3): I verified it independently rather than trusting the plan. `cargo build -p pv-server --bin pv-server` produces a binary with **zero** `FAULT_INJECT` symbols, and the Docker build (`Dockerfile:85`, `cargo build -p pv-server --release` in a clean container) uses exactly that invocation — so the shipped image is clean. However `cargo build -p pv-server --all-targets` **does** link the hook into `target/debug/pv-server` (4 `nm` matches), so the doc comment's unqualified claim is false. Not remotely triggerable (nothing sets the thread-local), hence WARNING not BLOCKER — see WR-02 for the exact reproduction.

## Critical Issues

### CR-01: Account deletion 500s on an unhandled `last_editor_user_id` foreign key — all three branches

**File:** `crates/pv-server/src/routes/account.rs:58-61`, `:135`, `:158`
**Issue:**
`0015_sync_shared_fanout.sql:22` adds `vault_items.last_editor_user_id TEXT REFERENCES users(id)` with **no `ON DELETE` action** (i.e. `NO ACTION`/immediate). Both `vault::create` (`vault.rs:268`) and `vault::update` (`vault.rs:521`) and `vault::move_item` (`vault.rs:983`) write `last_editor_user_id = caller_user_id` on every write, including edits by a *non-author* on a shared item.

`vault_items.user_id` cascades, so the deleting user's own items go away — but any item authored by **someone else** that they were the last editor of survives the cascade and still references them. FK enforcement is confirmed ON (`lib.rs:130-144`), so `DELETE FROM users WHERE id = ?` aborts the whole transaction.

Empirically reproduced against the real migration set:

```
$ sqlite3 fk.db < (all migrations)
PRAGMA foreign_keys=ON;
INSERT INTO users ... ('X'), ('Y');
INSERT INTO vault_items (id,user_id,enc_key,enc_data,last_editor_user_id)
  VALUES ('i1','X','k','d','Y');
DELETE FROM users WHERE id='Y';
-- Runtime error near line 7: FOREIGN KEY constraint failed (19)
```

Affected branches:
- **plain-member self-delete** (`:158`) — member edits an item the owner authored in a shared collection, then deletes their account → 500, account is permanently undeletable.
- **owner-dissolution** (`:135`) — step 1 removes collection-scoped items, but personal items belonging to other members that the owner edited through an `item_shares` edit grant survive → 500.
- **no-family** (`:58-61`) — a user who edited a shared item before leaving a family still trips it.

None of the three tests in `tests/account_deletion.rs` exercise this: every fixture creates the shared item as the *owner* (`account_deletion.rs:149-161`, `:322-334`), so `last_editor_user_id` always equals the item's own `user_id` and the FK never fires.

**Fix:** Null out the dangling references inside each deletion transaction, before `DELETE FROM users`, in all three branches (extract a shared helper so the ordering discipline lives in one place):

```rust
// Before `DELETE FROM users WHERE id = ?` in every branch:
sqlx::query("UPDATE vault_items SET last_editor_user_id = NULL WHERE last_editor_user_id = ?")
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
```

The read paths already tolerate `NULL` (`vault.rs:544` — "`last_editor_user_id` is still NULL — never a panic or 500"), and `error.rs:29` documents the same. The no-family branch must gain a real transaction to do this. Alternatively add a migration rebuilding `vault_items` with `last_editor_user_id ... ON DELETE SET NULL`, which is the more durable fix but a heavier change. Add a regression test where member B edits an item authored by owner A and then deletes B's account.

### CR-02: `GET /api/sync/shared/direct` has no suspension (or membership) gate — a suspended member keeps receiving shared ciphertext

**File:** `crates/pv-server/src/routes/sync.rs:280-310` (query at `:301-307`)
**Issue:**
Migration `0018`'s own header and `membership.rs:195-199`/`:282-287`/`:328-332` state that the `fm.status = 'active'` predicate on `Collection::resolve_access` / `Item::resolve_access` is "the SOLE enforcement mechanism a suspended member's access depends on". It is not the only read path.

`pull_shared_direct` is registered as a bare `SessionUser` route (`routes/mod.rs:84`) and its query joins `item_shares` directly with **no `family_members` join at all**:

```sql
SELECT vault_items.id, enc_key, enc_data, revision, updated_at, last_used_at, users.email
  FROM vault_items
  JOIN item_shares ON item_shares.item_id = vault_items.id
  LEFT JOIN users ON users.id = vault_items.last_editor_user_id
 WHERE item_shares.recipient_user_id = ? AND vault_items.collection_id IS NULL
```

Suspension leaves `item_shares` rows intact by design (`families.rs:656-693` — "no `collection_keys`/`vault_items` statement anywhere in this handler"). So after suspension the member's next `GET /api/sync/shared/direct` still returns the **full `enc_data`** of every personal item shared to them, including edits made *after* suspension. Because the per-item Cipher Key sealed into `item_shares.sealed_key` is stable across revisions (`items.rs:188-190`: "Cipher Key jest stabilny przez rewizje"), a suspended member who cached that key — which every previously-active recipient necessarily has — can decrypt every one of those payloads. Suspension is fully defeated for the `item_shares` surface.

(Removal is not affected: `apply_member_removal_rekey` step 4 deletes the `item_shares` rows.)

**Fix:** Add the same recipient-side membership+status join every other resolver uses, pinned to the item **owner's** family exactly as `Item::resolve_access` does:

```sql
SELECT vault_items.id, enc_key, enc_data, revision, updated_at, last_used_at, users.email
  FROM vault_items
  JOIN item_shares ON item_shares.item_id = vault_items.id
  JOIN family_members fm_o ON fm_o.user_id = vault_items.user_id
  JOIN family_members fm   ON fm.family_id = fm_o.family_id
                          AND fm.user_id = item_shares.recipient_user_id
                          AND fm.status = 'active'
  LEFT JOIN users ON users.id = vault_items.last_editor_user_id
 WHERE item_shares.recipient_user_id = ? AND vault_items.collection_id IS NULL
```

Better still, route this endpoint's row set through `Item::resolve_access` so there is genuinely one enforcement point. Add an integration test: suspend a member who holds a direct item share, then assert `GET /api/sync/shared/direct` returns zero rows for that item.

### CR-03: `resolveFolder` silently renders a failed folder as an *empty* folder — under-disclosure, and `Continue` stays enabled

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:170-175` (and `:399`)
**Issue:**

```ts
} catch {
  // Whole-folder resolution failed ...
  return { id: collectionId, name: collectionId, accessLevel, items: [] };
}
```

Any failure of `getCollection`, `getCollectionItems`, or `unsealCollectionKey` — a network error, a 500, the collection deleted mid-flow, a vault that re-locked — produces a folder with `items: []`. The render path then hits `folder.items.length === 0 ? null : ...` (`:399`) and emits **nothing at all** under the folder heading: no item names, and crucially **no `member.removeAccessItemsUnresolvedNote`** either, because `unresolved` is gated on `folder.items.length > 0` (`:383-384`).

The owner is therefore shown a folder that reads as "the removed member had access to this folder, which contains nothing", for a folder that may contain every credential in the family. `member.removeStep1Continue` remains enabled, so the removal proceeds on a disclosure the user was silently mis-informed about. `25-UI-SPEC.md`'s E4 `error (access fetch)` row requires this to **fail closed**; the whole point of UX-04 is that the owner can decide whether to rotate credentials, and this hands them a false negative.

There is no test covering this path — `RemoveMemberDialog.test.tsx` never makes `getCollection`/`getCollectionItems` reject.

**Fix:** Distinguish "resolved to zero items" from "could not resolve". Add an explicit failure marker to `ResolvedFolder` and render the unresolved note (or block the dialog, matching the fail-closed row) instead of an empty body:

```ts
interface ResolvedFolder {
  id: string; name: string; accessLevel: string;
  items: ResolvedFolderItem[];
  resolutionFailed: boolean;   // NEW
}
// catch: return { id: collectionId, name: collectionId, accessLevel, items: [], resolutionFailed: true };
// render: folder.resolutionFailed ? <UnresolvedNote count="?" /> : folder.items.length === 0 ? <EmptyFolderNote/> : <ul>…</ul>
```

Then add a test asserting a rejecting `getCollectionItems` renders a non-empty, non-error-styled note rather than a bare heading.

### CR-04: Count-only disclosure is structural, not a runtime fallback — and uses the wrong copy for flat item shares

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:105`, `:225`, `:383-384`, `:430-431`
**Issue:** `25-UI-SPEC.md` §4 is explicit: `member.removeAccessItemsUnresolvedNote` is "scoped **exclusively** to genuine runtime resolution failure … it must never be reached because the resolution path was never implemented." Three separate mechanisms here reach it structurally:

1. **Standalone `item_shares` always fall back** (`:225`): every direct share not reachable via a resolved folder gets `name: null` unconditionally, because the dialog has no personal-item decrypt path. It then renders (`:430-431`) `member.removeAccessItemsUnresolvedNote` with a hardcoded `count: "1"` — copy that reads *"1 items in this folder — couldn't load their names"* for an item that is **not in a folder**. This is factually wrong text in the phase's single most safety-critical dialog. Note the dialog caller is the family owner, and in the common case the shared item is one the *owner themselves* authored — so `getUnlockedUserKey()` + the personal-item `decryptItem` path could resolve the real name today; it simply is not attempted.
2. **One bad item collapses a whole folder** (`:383-384`): `unresolved = items.length > 0 && !items.every(i => i.name !== null)` throws away every *successfully* resolved name in that folder the moment a single sibling fails. The count then reported is `folder.items.length` — the total, not the number that failed — so the note over-states the failure and under-discloses the known names.
3. **`ITEM_REVISION = 1` is a guess** (`:105`): the AAD binds the payload to the item's revision, and the only real server path that puts an item into a collection is `vault::move_item`, which bumps `revision` to ≥ 2. `web/e2e/remove-member.spec.ts:26-41` documents this openly and works around it by encrypting the fixture Node-side at revision 1 to match the constant. So *every* edited (and, through the real API, every moved) collection item will fail to decrypt in production and drive its whole folder to count-only.

**Fix:**
- Give flat item shares their own key (e.g. `member.removeAccessItemUnresolvedNote`, singular, no "in this folder"), and attempt personal-item resolution via the caller's own `UserKey` before falling back — the owner authored most of what they shared.
- Make the fallback per-item, not per-folder: render resolved names, and append one note whose `{count}` is the number of *unresolved* items (`folder.items.filter(i => i.name === null).length`).
- Return the item's real `revision` from `GET /api/vault/collections/{id}/items` (`collections.rs:194-224` — the handler already selects from `vault_items`, adding `revision` is a one-word change) and pass it to `decryptItemForCollection` instead of the hardcoded `1`.

## Warnings

### WR-01: `rewrap_item_key_for_collection` leaks the unwrapped Cipher Key on the error path

**File:** `crates/pv-core/src/items.rs:255-265`
**Issue:** `key_bytes` is a plain `Vec<u8>` holding the unwrapped Cipher Key. It is zeroized on the success path (`:263`) and on the length-check path (`:259`), but line `:262` uses `?`:

```rust
let new_enc_key = aead_seal(new_ck.expose(), &key_bytes, &aad)?;  // early return skips the wipe
key_bytes.zeroize();
```

An `aead_seal` failure returns without wiping, leaving raw key material in the freed allocation. `CLAUDE.md`'s security convention is explicit ("Use `zeroize::Zeroizing<T>` wrapper for automatic cleanup"), and the sibling `decrypt_item_for_collection` avoids this by wiping before its second fallible call.

**Fix:**

```rust
let key_bytes = zeroize::Zeroizing::new(aead_open(old_ck.expose(), old_enc_key, &aad)?);
if key_bytes.len() != KEY_LEN {
    return Err(CryptoError::Decrypt);
}
aead_seal(new_ck.expose(), &key_bytes, &aad)
```

### WR-02: The fault-injection hook *does* compile into `pv-server` under `cargo build --all-targets`

**File:** `crates/pv-server/Cargo.toml:27-52`, `crates/pv-server/src/routes/families.rs:372-407`
**Issue:** Verified independently rather than trusting the plan. Under workspace `resolver = "2"`:

```
$ cargo build -p pv-server --bin pv-server && nm target/debug/pv-server | grep -c FAULT_INJECT
0
$ cargo build -p pv-server --all-targets  && nm target/debug/pv-server | grep -c FAULT_INJECT
4
```

`--all-targets` pulls in the dev-dependency graph, which contains the self-referential `pv-server = { path = ".", features = ["test-support"] }`, so the lib is unified *with* `test-support` and the `bin` target is relinked against it. The `[features]` doc comment's claim that the feature is "genuinely absent from a production `cargo build`/`cargo build --release`" is therefore only true for the *bare* invocation.

The shipped artifact is safe: `Dockerfile:85` runs `cargo build -p pv-server --release` in a clean container, with no `--all-targets` and no prior test step. And even when linked in, the hook is a thread-local defaulting to `None` with no route that sets it — it is not remotely triggerable, which is why this is WARNING and not BLOCKER.

**Fix:** Either narrow the doc comment to state the real precondition ("absent unless dev-dependencies are in the graph — never in the Dockerfile's `cargo build --release`"), or make the guarantee invocation-independent by moving the hook behind `#[cfg(all(feature = "test-support", debug_assertions))]`, or add a release-profile compile-time guard:

```rust
#[cfg(all(feature = "test-support", not(debug_assertions)))]
compile_error!("test-support must never be enabled in a release build");
```

### WR-03: Removal authorization is validated on a pool connection *outside* the transaction, and the destructive delete is not family-scoped

**File:** `crates/pv-server/src/routes/families.rs:603-610`, `:558-561`, `:442-446`
**Issue:** Two related gaps against priority area 2's "authorization is re-validated in-transaction":

1. `remove_member`'s confused-deputy check runs `.fetch_optional(&state.db)` on a *separate pool connection* (`:606`) before `begin_with("BEGIN IMMEDIATE")` at `:617`. `apply_member_removal_rekey` does not re-check family membership; its own doc comment (`:553-557`) states it "trusts the handler passed a target already confirmed to be in the caller's own family" — which is only true as of the pre-transaction read.
2. Step 5 (`:558-561`) is `DELETE FROM family_members WHERE user_id = ?` with **no `family_id` predicate**, and step 1's scope query (`:442-446`) and `member_access` (`:296-302`) likewise resolve `collection_keys` by `recipient_user_id` alone. All three are correct only because v0.4 enforces a singleton family; none of them says so in a way the compiler or the DB will enforce when that assumption is relaxed.

**Fix:** Move the membership check inside the transaction (pass `&mut *tx`), and pass `family_id` into `apply_member_removal_rekey` so every write is scoped:

```rust
sqlx::query("DELETE FROM family_members WHERE family_id = ? AND user_id = ?")
    .bind(family_id).bind(target_user_id)
```

The plain-member self-delete branch (`account.rs:154`) must pass its own resolved `family_id` the same way.

### WR-04: Member removal severs `item_shares` but never bumps `shared_direct_revision` — the removed member's cache never prunes

**File:** `crates/pv-server/src/routes/families.rs:548-551`, `:566-569`
**Issue:** Step 4 bulk-deletes every `item_shares` row for the target; step 6 bumps only `users.vault_revision`. But `GET /api/sync/shared/direct` and the `direct` bucket of `GET /api/sync/shared` are keyed off `users.shared_direct_revision` (`sync.rs:181`, `:290`), *not* `vault_revision`. `vault::revoke_share` gets this right (`vault.rs:1373` — "Bumps the REVOKED recipient's own `shared_direct_revision` counter"); the new removal path does not.

Consequence: a removed member's client polls `?since=<unchanged>`, receives the cheap `UpToDate` shape, and keeps every directly-shared item in its local cache indefinitely. This is exactly the WR-07 class of debt this phase claims to close on the new path (`:563-565`).

**Fix:** Add alongside the `vault_revision` bump:

```rust
sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
    .bind(target_user_id).execute(&mut **tx).await?;
```

### WR-05: Two more `family_members` joins were not given the `status = 'active'` predicate

**File:** `crates/pv-server/src/routes/sync.rs:155-163`, `crates/pv-server/src/routes/vault.rs:156-164`
**Issue:** Phase 25 added `AND fm.status = 'active'` to the two `resolve_access` implementations, but three other queries carry the same `family_members` join and were left untouched:

- `sync::pull_shared_revisions` (`sync.rs:155-163`) — a suspended member still receives the id and current `revision` of every collection they hold a `collection_keys` row for, so they can observe that activity is occurring in folders they have been cut off from.
- `vault::resolve_collection_members` (`vault.rs:156-164`) — this is the fan-out audience for WebSocket sync events *and* the `bump_recipients_vault_revision` audience, so a suspended member with a live WS keeps receiving `SyncEvent` frames (entity id + revision) for those collections.

No ciphertext leaks through either (both follow-up fetches are `Membership<Collection>`-gated), but both contradict the phase's stated FAM-09 property and are cheap to close.

**Fix:** Append `AND fm.status = 'active'` to both joins, and extract the recurring `JOIN family_members fm … AND fm.status = 'active'` fragment into one shared `const` so a fourth copy cannot drift.

### WR-06: `resolve_family_role` has no status gate — a suspended member still satisfies `FamilyMembership<RequireRead>`

**File:** `crates/pv-server/src/routes/membership.rs:508-526`
**Issue:** `resolve_family_role` selects `family_id, role FROM family_members WHERE user_id = ?` with no status predicate, so a suspended member passes the `FamilyMembership<RequireRead>` gate for every route in `family_routes()` that uses it — including **`POST /api/vault/collections`** (`routes/mod.rs:207`), which lets a suspended member create new collections inside the family they are suspended from (and then immediately be unable to read them, since `Collection::resolve_access` denies them).

Reading the roster is *required* for the suspended-member banner (E5), so a blanket status gate here would break the UI. But write endpoints should not be reachable.

**Fix:** Either add a `status` field to `FamilyMembership<M>` and have `RequireEdit`-and-write routes reject `suspended`, or introduce a `RequireActiveMember` `MinAccess` marker used by `POST /api/vault/collections` and `POST /api/invitations`, leaving `GET /api/families/members` on `RequireRead`.

### WR-07: Owner dissolution permanently deletes other members' authored items, while the copy says their vaults are untouched

**File:** `crates/pv-server/src/routes/account.rs:117-120`; `web/src/lib/i18n/dictionary.ts` (`account.deleteOwnerWarning`)
**Issue:**

```rust
sqlx::query("DELETE FROM vault_items WHERE collection_id IN (SELECT id FROM collections WHERE family_id = ?)")
```

This is scoped by `collection_id` only — it deletes items authored by **every** member, not just the departing owner. The shipped copy tells the owner: *"{count} member(s) will lose access to shared folders. Their own vaults stay untouched."* A member who authored credentials inside a shared folder does not merely lose access to them; the rows are destroyed with no recovery path.

Given the collection keys cascade away too, deletion is a defensible choice — but the copy misrepresents it, and this is the phase whose stated purpose is UI honesty about destructive actions.

**Fix:** Amend `account.deleteOwnerWarning` to state the real consequence (PL/EN), e.g. "… everything inside those shared folders will be permanently deleted, including items other members created there. Their personal vaults stay untouched." Add an integration test asserting a member-authored collection item is gone after owner dissolution so the behavior is pinned to the copy.

### WR-08: `member.removeAccessListHeading` is defined but never rendered

**File:** `web/src/lib/i18n/dictionary.ts:961`; `web/src/components/settings/RemoveMemberDialog.tsx:373-439`
**Issue:** `25-UI-SPEC.md` §2's rendering sketch puts `member.removeAccessListHeading` ("{email} had access to:") at the top of the disclosure list. `grep -rn removeAccessListHeading web/src` matches only `dictionary.ts` — the dialog jumps straight from `member.removeStep1Intro` to the list. The list therefore renders unlabelled, and the dictionary carries a dead key.

**Fix:** Render it above the `remove-member-access-list` container in the non-empty branch (and add it to the component test's assertions), or remove the key.

### WR-09: Folder names in the disclosure list can never resolve — the list will always show raw collection UUIDs

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:128-143`; `crates/pv-server/src/routes/collections.rs:91`
**Issue:** `resolveFolder` decrypts `collection.enc_name` with AAD bound to `collectionId` (`decryptItemForCollection(ck, enc_name, collectionId, collectionId, 1)`), but `collections::create` generates the id **server-side** (`let id = uuid::Uuid::new_v4()` at `collections.rs:91`) *after* the client has already encrypted `enc_name`. No client can produce ciphertext bound to an id that does not exist yet. `web/e2e/remove-member.spec.ts:55-70` documents exactly this and accepts a placeholder-id encryption that "will fail to decrypt".

So in production `name` always falls back to `collectionId` (`:138` is unreachable) and `member.removeAccessFolderLabel` renders `Folder "0f3c9a71-…"`. `25-08-SUMMARY.md` correctly flags the enc_name convention as *inferred rather than verified*; it is in fact unfalsifiable today because nothing writes `enc_name` through a real client.

**Fix:** Not fixable inside this dialog. File it as a blocking prerequisite for Phase 26: `POST /api/vault/collections` must accept a client-chosen `id` (mirroring `vault::create`'s existing "client must know the id before encrypting" precedent for items). Until then, the UI-SPEC's "real folder name" requirement is not met and should be recorded as an open UAT gap rather than a passed criterion.

### WR-10: The e2e "real item name" proof is circular

**File:** `web/e2e/remove-member.spec.ts:17-41`
**Issue:** The spec's own header explains that the only real path to place an item into a collection (`vault::move_item`) always yields `revision ≥ 2`, that `RemoveMemberDialog` hardcodes `ITEM_REVISION = 1`, and that the spec therefore "deliberately pins revision=1 at encrypt time" Node-side. The fixture is constructed to satisfy the constant under test. The test can only pass; it cannot detect the mismatch it documents.

This is the same failure shape as the recorded Phase 24 precedent (a wholesale-mocked file letting a 100%-failure control ship green) — the mocking is gone, but the fixture is still tailored to the assumption.

**Fix:** Once `CollectionItemRow` carries `revision` (see CR-04), rewrite the fixture to go through the real `PUT /api/vault/items/{id}/collection` path with the revision the server actually assigns, and assert the real item name renders. Until then, this spec should not be cited as evidence for the UX-04 must-have.

### WR-11: `rekey.real-wasm.test.ts` never imports the module it is named after

**File:** `web/src/lib/families/rekey.real-wasm.test.ts:22-32`
**Issue:** The file is the designated real-WASM proof for Plan 25-07, and it correctly contains zero `vi.mock`. But it imports only `@/lib/crypto` primitives — it never imports `rekey.ts`, and `buildMemberRemovalBatch` is never called anywhere in the test suite (`web/src/lib/families/` contains only `api.ts`, `rekey.ts`, and this file). The orchestration module — which contains the T-25-16 fail-closed check, the target-exclusion filter, the roster lookup, and the WASM handle `finally` cleanup — has **zero** automated coverage.

**Fix:** Add a `rekey.test.ts` that mocks only the four network functions (`getMemberAccess`, `getFamilyMembers`, `getCollection`, `getCollectionItems`, `getCollectionAccessList`) and drives `buildMemberRemovalBatch` against the real WASM, asserting at minimum: (a) the target is excluded from `new_sealed_keys`; (b) a remaining recipient with `public_key: null` throws rather than shrinking the set; (c) each returned `enc_key` decrypts under the new key and not the old.

### WR-12: Over-broad `try` reports failure after the server mutation already succeeded

**File:** `web/src/components/settings/DeleteAccountDialog.tsx:132-171`; `web/src/components/settings/RemoveMemberDialog.tsx:282-296`
**Issue:** In `DeleteAccountDialog`, `clearSessionToken()`, `clearStoredEmail()`, and `lockVault()` all sit *inside* the same `try` as `await deleteAccount(batch)`. If any of them throws, the catch renders `account.deleteFailed` ("Couldn't delete the account. Try again.") even though the account is already permanently gone — inviting a retry that will 401. `RemoveMemberDialog` has the same shape: `onRemoved()` is inside the try, so a throwing parent callback surfaces `member.removeFailed` after a successful removal.

**Fix:** Narrow the `try` to the network call only:

```ts
try { await deleteAccount(batch); } catch { setDeleteError(t("account.deleteFailed")); setState("step2"); return; }
clearSessionToken(); clearStoredEmail(); lockVault();
try { window.location.reload(); } catch { /* jsdom */ }
```

### WR-13: An unrecognized `access_level` displays as the *least* privileged label

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:396`, `:434`
**Issue:** `t(ACCESS_LEVEL_KEY[folder.accessLevel] ?? "access.readOnly")` — any value outside `read|edit|hidden_password` silently renders "Read-only" / "Tylko odczyt". In a destructive-confirmation dialog whose whole purpose is telling the owner how much the removed member could see, an unknown value must not resolve to the most reassuring label. Compare the server's own discipline: `membership.rs:107-114` fails closed to `ApiError::Internal` on an unrecognized value, explicitly "never silently treated as a valid access grant".

**Fix:** Render a neutral fallback (the raw value, or a dedicated `access.unknown` key) rather than `access.readOnly`.

### WR-14: `ConfirmDialog` backdrop stays clickable during an in-flight confirm

**File:** `web/src/components/settings/ConfirmDialog.tsx:65`
**Issue:** `onClick={onClose}` on the overlay is unconditional, while both new dialogs guard it (`RemoveMemberDialog.tsx:305` and `DeleteAccountDialog.tsx:181` both use `X ? undefined : onClose`). The suspend request is now routed through `ConfirmDialog`, so a backdrop click mid-request dismisses the dialog and discards the `member.suspendFailed` surface the `error` prop was added for.

**Fix:** `onClick={confirming ? undefined : onClose}`, matching the two sibling dialogs.

### WR-15: `resolveAccess`'s splice-based merge can leave a folder heading with nothing under it, and mis-counts the fallback

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:196-226`, `:404-406`
**Issue:** Dual-path items are `splice`d out of `folder.items` and pushed into the flat list. A folder whose every item is also directly shared ends up with `items: []` and renders a bare heading — the UI-SPEC's populated row explicitly forbids "an empty heading with nothing under it". Separately, the `{count}` passed to `member.removeAccessItemsUnresolvedNote` (`:405`) is `folder.items.length`, the total, so a folder with 9 resolved names and 1 failure reports "10 items … couldn't load their names".

**Fix:** Track the pre-splice count for the folder's own summary line, and render an explicit "all items shown individually below" affordance (or suppress the heading) when a folder is emptied by the merge.

### WR-16: Path segments interpolated into API URLs without encoding

**File:** `web/src/lib/families/api.ts:66`, `:72`, `:80`, `:90`; `web/src/lib/vault/api.ts` (`getCollectionItems`, `getCollectionAccessList`)
**Issue:** `` `/api/families/members/${userId}/suspend` `` etc. interpolate ids straight into the path. The ids are server-generated UUIDs today, so this is not currently exploitable — but every other consumer of these helpers inherits the assumption, and a future caller passing an email or a user-supplied identifier would get path traversal / route confusion for free.

**Fix:** `encodeURIComponent(userId)` / `encodeURIComponent(collectionId)` at every interpolation site.

## Info

### IN-01: Redundant state predicate

**File:** `web/src/components/settings/RemoveMemberDialog.tsx:466`
**Issue:** `state === "step2" || removing` where `removing = state === "removing"` — the disjunction is fine but reads as if `removing` were an orthogonal flag (it is in `DeleteAccountDialog`, where `isStep2` is computed the same way but named). **Fix:** Introduce `const isStep2 = state === "step2" || state === "removing";` to match the sibling dialog exactly.

### IN-02: `remove_member` does not reject a target with `role = 'owner'`

**File:** `crates/pv-server/src/routes/families.rs:588-610`
**Issue:** The only guard is `target_user_id == membership.caller_user_id`. In the v0.4 singleton model the caller *is* the sole owner, so this is unreachable — but `suspend_member`/`reinstate_member` share the same shape, and the invariant is nowhere enforced. **Fix:** Add `AND role != 'owner'` to the confused-deputy pre-check, so the constraint is stated rather than implied.

### IN-03: Reinstate error banner is never cleared by a subsequent successful action

**File:** `web/src/components/settings/FamilyTab.tsx` (`handleReinstate` / `handleSuspendConfirm`)
**Issue:** `reinstateErrorUserId` is cleared only at the start of another reinstate. A successful suspend, remove, or roster refresh leaves the stale "Couldn't restore access" banner on screen. **Fix:** Clear it in `handleSuspendConfirm`, in `onRemoved`, and on any successful `loadFamilyState`.

### IN-04: `formatExpiryDate` reused to render a joined date

**File:** `web/src/components/settings/FamilyTab.tsx` (member row, `family.joinedLabel`)
**Issue:** A helper named for invite expiry now formats a membership start date; the name will mislead the next reader. Also, `m.joined_at ? … : ""` renders `Joined ` with a trailing blank when the field is empty. **Fix:** Rename to a neutral `formatDate`, and omit the whole line when `joined_at` is absent.

---

_Reviewed: 2026-08-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
