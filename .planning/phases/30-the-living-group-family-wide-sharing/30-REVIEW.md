---
phase: 30-the-living-group-family-wide-sharing
reviewed: 2026-08-11T07:55:47Z
depth: deep
diff_base: 1c3e934
files_reviewed: 30
files_reviewed_list:
  - crates/pv-server/migrations/0019_family_wide_sharing.sql
  - crates/pv-server/src/routes/account.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/families.rs
  - crates/pv-server/src/routes/invitations.rs
  - crates/pv-server/src/routes/membership.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/tests/family_wide_sharing.rs
  - packages/pv-ui/vault/types.ts
  - web/e2e/family-wide-sharing.spec.ts
  - web/e2e/fixtures.ts
  - web/src/app/page.tsx
  - web/src/components/settings/DeleteAccountDialog.tsx
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/ExportDialog.tsx
  - web/src/components/vault/FamilyRekeyNotice.tsx
  - web/src/components/vault/ItemRow.tsx
  - web/src/components/vault/ShareDialog.tsx
  - web/src/components/vault/SharingOverviewPanel.tsx
  - web/src/lib/families/api.ts
  - web/src/lib/families/familyWidePending.ts
  - web/src/lib/families/rekey.ts
  - web/src/lib/families/reseal.ts
  - web/src/lib/families/resealTrigger.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/invite/api.ts
  - web/src/lib/invite/crypto.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/collections.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/sync.ts
findings:
  critical: 4
  warning: 7
  info: 5
  total: 16
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-08-11T07:55:47Z
**Depth:** deep (cross-file, server↔client contract tracing)
**Diff range:** `1c3e934..HEAD`
**Files Reviewed:** 30 source files (test files read for evidence, not reviewed for style)
**Status:** issues_found

## Summary

The zero-knowledge property of the grant path holds. I could not find any path on which
the server persists or receives a Collection Key, an identity secret key, or plaintext:
`invitation_family_wide_keys.wrapped_collection_key` is the same opaque channel-wrapped
blob the existing singular column already stored, `accept()` never unwraps it, the
discovery endpoint's two response structs (`PendingGrant`, `ResealableGrant`) have no
field capable of carrying ciphertext, and `reassign_departing_member_collection_items`
touches only a foreign-key column. `crates/pv-server/tests/family_wide_sharing.rs` is a
genuinely adversarial sweep (every table, every column, every request and response body,
six encodings per needle, with self-checks that fail if the sweep inspected zero cells)
and 30-14-SUMMARY records four real falsification runs against four distinct assertion
layers. That claim survives scrutiny.

`resolve_access` was **not** widened. `git diff 1c3e934..HEAD -- membership.rs` is
additive only: two new functions appended after `require_collection_edit`. Both
`Collection::resolve_access` and `Item::resolve_access` are byte-identical to phase 29.
The blocking decision checkpoint held.

`may_grant_access_level` cannot escalate. Every `true` arm either grants exactly what the
caller holds or narrows `Edit → Read`; `HiddenPassword` is handled by explicit pairing and
never compares as "between" anything. That specific concern is clean.

What is *not* clean is what the client feeds into those bounds. **The access level chosen
for a family-wide share is never persisted anywhere**, and both delivery paths — invite-time
wrap and lazy reseal — substitute *the propagator's own* level. Because
`collections::create` hard-codes the creator's own row to `'edit'`, a family-wide share
deliberately created at `read` is silently delivered as `edit` to every late joiner whose
grant the creator (or the owner) propagates. The server cannot catch this: from its side the
propagation is within bounds. Two unit tests actively enshrine the behavior
(`crypto.test.ts:290-293`, `resealTrigger.test.ts:40`), so it is test-proven wrong rather
than merely untested. That is CR-01 and it is the most serious finding here.

Three more blockers follow: the invite propagation exemption was never scoped to
family-wide collections, so it bypasses `require_collection_edit` for *any* collection
(CR-02); WINDOWS #17 is **reachable today, not latent**, and in one reachable configuration
makes the shipped FSH-05 timing copy false (CR-03); and a newcomer in the very gap window
this phase exists to serve cannot share a bare item family-wide at all, failing with a
"try again" message that cannot succeed (CR-04).

On the specific questions asked:

- **`delete_account_as_member` (ff18e7e)** — scoping is correct. The `UPDATE` carries
  `AND collection_id = ?` so personal items (`collection_id IS NULL`) still cascade-delete
  exactly as before; `touched_collections` is the set `apply_member_removal_rekey` just
  proved equals the member's actual reachable set; `delete_account_as_owner` is untouched.
  One residual case is wrong (WR-02): collections left with zero remaining recipients.
- **WINDOWS #17** — your characterisation is right about the mechanism and wrong about the
  status. See CR-03.
- **Timing copy** — honest. `store.ts`'s `onFamilyWidePending` has no `!== me` guard and
  fires off every pull cycle including the sharer's own, so "you or another family member"
  is accurate. The copy is only made false by CR-03's stranding case, not by the trigger's
  actor set.
- **Capabilities with no caller** — `FamilyRekeyNotice` is genuinely mounted (`page.tsx:427`).
  Every new export except one has a real non-test consumer; the exception is IN-02.

## Critical Issues

### CR-01: A late joiner's family-wide grant carries the propagator's own access level, not the level the share was created at — silent privilege escalation

**Files:**
`web/src/lib/invite/crypto.ts:104-115`,
`web/src/lib/families/resealTrigger.ts:39,132-137`,
`crates/pv-server/src/routes/collections.rs:194-204`

**Issue:**
FSH-01's locked decision is "access level is chosen for the family-wide share like any other
recipient — read / full edit / hidden password." Nothing persists that choice. `ShareDialog`
applies it once, at creation time, to the *other current members* via
`grantCollectionToRecipients(..., level)` — and `collections::create` unconditionally writes
the creator's own row as `'edit'`:

```
// collections.rs:194-204
// access_level is a hard-coded literal 'edit' here, NEVER taken from the request
INSERT INTO collection_keys (...) VALUES (?, ?, ?, 'edit')
```

Both late-joiner delivery paths then read a level from whichever member happens to be
propagating:

```ts
// invite/crypto.ts:113 — invite-time wrap
access_level: entry.access_level,     // the INVITER's own collection_keys level

// resealTrigger.ts:135 — lazy reseal
collection.access_level ?? FALLBACK_ACCESS_LEVEL,   // the RESEALER's own level
```

Concrete escalation, entirely through shipped UI:

1. Owner creates a family-wide folder and picks **read** for the family. Owner's own row
   is `'edit'`; every other member's row is `'read'`.
2. Owner generates any invite (family-wide keys are folded in unconditionally, on every
   invite). `family_wide_keys[i].access_level` = `"edit"`.
3. `invitations::accept` reads the level **from the stored row** (correctly refusing to
   trust the request body) — and that stored row says `edit`.
4. The newcomer receives `edit` on a collection the sharer explicitly restricted to `read`.

The lazy-reseal path has the same defect plus non-determinism: the level a newcomer ends up
with depends on *which* keyholder's browser fired the trigger first. `may_grant_access_level`
cannot help — the propagation genuinely is within the propagator's own ceiling; it is the
*share's* ceiling that is unrepresented.

`web/src/lib/invite/crypto.test.ts:290-293` asserts this behavior as intended
("access_level is the collection's OWN caller-held level"), so a regression test currently
protects the bug.

**Fix:** persist the family-wide grant level on the collection and read it from there on
both paths. Minimal additive shape, matching this phase's own `family_wide_kind` precedent:

```sql
-- new migration
ALTER TABLE collections ADD COLUMN family_wide_access_level TEXT
  CHECK (family_wide_access_level IN ('read','edit','hidden_password'));
```

```ts
// invite/crypto.ts — propagate the SHARE's level, bounded by the caller's own
const level = entry.family_wide_access_level ?? entry.access_level;
familyWideKeys.push({ collection_id: entry.id, access_level: level, ... });

// resealTrigger.ts — same source, never the resealer's own row
await reshareCollectionToNewMember(
  grant.collection_id,
  grant.recipient_user_id,
  collection.family_wide_access_level ?? FALLBACK_ACCESS_LEVEL,
  uk,
);
```

and have the server bound the propagated level by `may_grant_access_level(caller, stored)`
as it already does. Update `crypto.test.ts:290-293` and `resealTrigger.test.ts:40` — they
encode the defect.

---

### CR-02: The invite-propagation exemption is not restricted to family-wide collections — it bypasses `require_collection_edit` for any collection

**File:** `crates/pv-server/src/routes/invitations.rs:248-258`
(helper: `crates/pv-server/src/routes/membership.rs:545-557`)

**Issue:**
`d07c2a7` deliberately relaxed the family-wide loop from `require_collection_edit` to
`require_collection_access_for_propagation` (RequireRead + level bound). The relaxation is
justified *for family-wide collections* — but nothing in the loop, in the helper, or in the
`invitation_family_wide_keys` schema checks `collections.family_wide_kind IS NOT NULL`.

```rust
for entry in &req.family_wide_keys {
    let requested_level = membership::parse_access_level_from_request(&entry.access_level)?;
    validate_blob_len("wrapped_collection_key", &entry.wrapped_collection_key)?;
    membership::require_collection_access_for_propagation(
        &state.db, &family.caller_user_id, &entry.collection_id, requested_level,
    ).await?;              // <- no family_wide_kind predicate anywhere
}
```

Consequence: the family owner, holding only `read` on an *ordinary* shared collection some
other member created and shared with them, can put that collection id into
`family_wide_keys` and hand a brand-new invitee a real `collection_keys` grant on it. Both
of the two gates that exist to forbid exactly this are bypassed:
`collections::add_member` is `Membership<Collection, RequireEdit>`-gated, and the invite's
own single-collection branch twenty lines above calls `require_collection_edit`. Same
handler, same request, two different rules.

Reachability: requires a hand-built request body (the shipped client only folds in rows where
`family_wide_kind != null`), and the caller must already hold a decryptable key. It is
nonetheless a real authorization bypass on a low-trust, invite-adjacent surface, and the
mismatch between the doc comment ("every family-wide collection the caller currently holds
ANY key for") and the enforced predicate is exactly the drift this codebase's own
`active_collection_member_join!()` discipline exists to prevent.

**Fix:** make the helper's contract match its name, or add the predicate at the call site:

```rust
let is_family_wide: bool = sqlx::query_scalar(
    "SELECT 1 FROM collections WHERE id = ? AND family_wide_kind IS NOT NULL",
)
.bind(&entry.collection_id)
.fetch_optional(&state.db)
.await?
.is_some();
if !is_family_wide {
    // an ordinary collection may only be propagated under the deliberate-share rule
    membership::require_collection_edit(&state.db, &family.caller_user_id, &entry.collection_id).await?;
} else {
    membership::require_collection_access_for_propagation(...).await?;
}
```

Add a regression test: a caller with `read` on a non-family-wide collection submitting it in
`family_wide_keys` must be rejected.

---

### CR-03: WINDOWS #17 is reachable today, not latent — and in one reachable configuration it makes `share.familyWideTimingCaveat` false

**Files:**
`crates/pv-server/src/routes/families.rs:399-420` (the `resealable` query),
`web/src/lib/families/reseal.ts:103` → `collections::add_member` (`RequireEdit`)

**Issue:**
Your characterisation of the *mechanism* is exactly right: `resealable` has no access-level
filter while `collections::add_member` is `RequireEdit`-gated. The "latent, no currently-failing
test exercises it" status is not right — the shipped UI reaches it:

1. Any member creates a family-wide share and picks **read** (or **hidden password**) —
   an explicitly supported, first-class choice per FSH-01.
2. `collections::create` gives the *creator* `'edit'`; `grantCollectionToRecipients` gives
   every other member `'read'`.
3. A newcomer appears without a key. `family_wide_pending` now returns that
   `(collection, newcomer)` pair as `resealable` to **every** member, read-holders included.
4. Each read-holder's `runFamilyWideResealTrigger` calls `addCollectionMember` → **403**,
   caught, `console.warn`, re-attempted on every subsequent unlock forever.

Today that is merely noise, because the edit-holding creator's own trigger succeeds. But
the creator is not guaranteed to remain: if they leave (self-deletion) or are removed, the
surviving members hold only `read`, **no member can reseal at all**, and the newcomer is
stranded permanently — while `share.familyWideTimingCaveat` continues to promise "access
arrives the next time you or another family member opens the app". That is FSH-05's exact
prohibited overclaim, and unlike the residual limitation the decision record honestly
discloses ("every keyholder stops using the product"), this one triggers while every
keyholder is actively using the app.

Note this interacts with CR-01: fixing CR-01 by propagating the *share's* level makes CR-03
strictly worse, because then even the creator's reseal would request `read` while
`add_member` still demands `Edit`. **The two must be fixed together.**

**Fix:** bound the reseal path the same way the invite path now is, and stop advertising
grants the caller cannot legally make:

```rust
// families.rs — resealable: only offer pairs the caller can actually act on
AND EXISTS (SELECT 1 FROM collection_keys ck
             WHERE ck.collection_id = c.id
               AND ck.recipient_user_id = ?
               AND ck.access_level = 'edit')
```

plus, so a read-holder is not simply excluded from the mechanism, add a propagation-bounded
grant path for the reseal (the family-wide analogue of
`require_collection_access_for_propagation`) on `collections::add_member`, gated on
`collections.family_wide_kind IS NOT NULL`. Close WINDOWS #17 with the fix, not with a
re-record.

---

### CR-04: A newcomer in the gap window cannot share a bare item family-wide at all, and the failure message tells them to retry into a bound that can never succeed

**File:** `web/src/components/vault/ShareDialog.tsx:352-372` (`awaitFamilyItemBucketGrant`),
`378-408` (`findOrCreateFamilyItemBucket`)

**Issue:**
The plan-checker's concern about the 409 recovery path is real, and it is not limited to a
same-second race. `findOrCreateFamilyItemBucket` resolves the bucket via
`familyItemBucketRow(await listCollections())`, and `collections::list` is key-gated
(`JOIN collection_keys ck ON ... ck.recipient_user_id = ?`). A member who has joined but not
yet received the bucket's key — i.e. precisely the FSH-02 gap-window newcomer this whole
phase exists for — therefore sees **no bucket**, takes the create branch, hits
`idx_one_item_bucket_per_family`, gets a 409, and falls into
`awaitFamilyItemBucketGrant`, which polls `listCollections()` 4 times at 200 ms:

```ts
const ITEM_BUCKET_GRANT_POLL_ATTEMPTS = 4;
const ITEM_BUCKET_GRANT_POLL_DELAY_MS = 200;   // 600 ms total
```

No reseal is in flight, so nothing will arrive inside 600 ms. The function throws, and the
dialog renders `share.createFailed` — "…Spróbuj ponownie." Retrying reproduces the identical
failure until an *unrelated* keyholder's pull cycle happens to reseal. The comment on those
constants ("this is a same-second race between two live clients") describes the case the code
handles; the case it actually meets most often is the one it does not.

Aggravating: the client already *knows* this is the pending state —
`getFamilyWidePendingSnapshot().missing` contains that exact `item_bucket` id, and 30-15
renders a pending row for it in the item list — but `findOrCreateFamilyItemBucket` never
consults it.

**Fix:** distinguish "lost a live race" from "my key hasn't arrived yet", and be honest about
the second:

```ts
import { getFamilyWidePendingSnapshot } from "@/lib/families/familyWidePending";

async function findOrCreateFamilyItemBucket(identityKey: OwnIdentityKeypair) {
  const existing = familyItemBucketRow(await listCollections());
  if (existing !== undefined) { /* ...unchanged... */ }

  // A bucket this member is KNOWN to be waiting on is not a race to poll through.
  const pendingBucket = getFamilyWidePendingSnapshot().missing
    .find((g) => g.kind === "item_bucket");
  if (pendingBucket !== undefined) {
    throw new FamilyWideKeyPendingError(pendingBucket.collection_id);
  }
  // ...create + 409 -> awaitFamilyItemBucketGrant as today
}
```

and render `share.pendingFamilyKeyNote`/`share.pendingFamilyKeyNoteDetail` (which already
exist and already say the right thing) instead of `share.createFailed`.

## Warnings

### WR-01: `accept()` re-validates the inviter's current authority for the single-collection scope but not for family-wide entries

**File:** `crates/pv-server/src/routes/invitations.rs:499-523` vs `589-635`

**Issue:** Pitfall 9's re-validation ("the inviter's CURRENT authority against the LIVE
transaction snapshot, never assumed from creation time") is applied only to
`collection_id`. The family-wide loop reads `invitation_family_wide_keys` and inserts a
`collection_keys` row for every entry with no corresponding check that the inviter still
holds a grant on those collections. A pending invite issued before the inviter lost access
to a family-wide collection still grants the newcomer a server-side `collection_keys` row
for it. Zero-knowledge holds (a post-revocation re-key rotates the key, so the stale wrapped
blob decrypts to nothing useful) but the *authorization* row lands, and the newcomer then
resolves access to that collection's listing and ciphertext.

**Fix:** mirror the existing check inside the family-wide loop, before
`insert_collection_key`:

```rust
let inviter_still_has_access = sqlx::query(concat!(
    "SELECT 1 FROM collection_keys ck JOIN collections c ON c.id = ck.collection_id ",
    active_collection_member_join!(),
    "WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
))
.bind(&entry.collection_id).bind(&inviter_user_id)
.fetch_optional(&mut *tx).await?.is_some();
if !inviter_still_has_access { continue; }   // silently drop, same policy as an unknown id
```

---

### WR-02: The WINDOWS #16 fix reassigns items in collections that have no remaining recipients, replacing a clean cascade delete with permanent undecryptable orphans

**File:** `crates/pv-server/src/routes/account.rs:245-259`

**Issue:** `touched_collections` is every collection the departing member held a key for —
including collections where they were the **only** recipient (a shared folder they created
and never granted to anyone, or one everyone else was later removed from). For those,
`apply_member_removal_rekey`'s `new_sealed_keys` set is empty, no `collection_keys` row
survives, and the reassignment nonetheless repoints those items' `user_id` to the family
owner:

```rust
for collection_id in touched_collections {
    sqlx::query("UPDATE vault_items SET user_id = ? WHERE user_id = ? AND collection_id = ?")
```

The stated rationale — "STAYS in that collection, readable by every remaining member" — is
false for this subset: there are no remaining members. The rows survive forever, owned by a
user who cannot decrypt them, invisible to every read path (`fetch_items_for`'s arm 2 needs
a `collection_keys` row, arm 1 needs `collection_id IS NULL`), and no longer cleaned up by
anything. Before this commit they were correctly destroyed with the account.

**Fix:** only reassign where at least one grant survives:

```rust
for collection_id in touched_collections {
    let survivors: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM collection_keys WHERE collection_id = ? AND recipient_user_id != ?",
    ).bind(collection_id).bind(member_user_id).fetch_one(&mut **tx).await?;
    if survivors == 0 { continue; }   // let the cascade delete these, as before
    sqlx::query("UPDATE vault_items SET user_id = ? WHERE user_id = ? AND collection_id = ?")
        ...
}
```

---

### WR-03: Synthetic pending rows masquerade as notes and leak into the item-type filter

**File:** `web/src/lib/vault/store.ts:307-315`

**Issue:** the placeholder is built with a real, concrete type:

```ts
fields: { type: "note", name: "", body: "", folderId: null, tags: [] },
```

`filterItems` (`packages/pv-ui/vault/search.ts:55-58`) matches on `fields.type`, so a
`{kind:"itemType", itemType:"note"}` sidebar filter renders the placeholder inside the Notes
list — asserting a type for an item whose type is inside `enc_data` this member cannot read.
That is a smaller instance of the same misrepresentation the pending state was built to
avoid. `"note"` is also load-bearing for sorting: `sortItems`'s `byName` on `""` puts every
placeholder at the top of the "name" ordering.

Neither `ItemList`/`filterItems` nor `sortItems` were given a `pendingFamilyKey` guard; only
`ItemRow`, `DetailPanel` and `ExportDialog` were.

**Fix:** exclude placeholders from any type/tag/folder-scoped view, since none of those
predicates can be truthfully evaluated:

```ts
// ItemList.tsx
const base = filter.kind === "all" ? items : items.filter((i) => i.pendingFamilyKey !== true);
const results = sortItems(searchItems(filterItems(base, filter), searchQuery), sortBy);
```

---

### WR-04: The item-bucket uniqueness conflict is reported with a factually wrong error message

**File:** `crates/pv-server/src/routes/collections.rs:180-191`

**Issue:** widening `ON CONFLICT(id)` to a bare `ON CONFLICT DO NOTHING` makes the
`idx_one_item_bucket_per_family` violation land in the same `fetch_optional` `None` branch —
which returns a hard-coded, now-incorrect string:

```rust
let row = row.ok_or_else(|| ApiError::Conflict("a collection with this id already exists".into()))?;
```

For the race-loser path the id is fresh and unique; the actual cause is "this family already
has an item bucket". The client only inspects `status === 409` so behavior is unaffected, but
every log line, every API consumer, and every future debugger is told the wrong thing about a
path this phase deliberately created.

**Fix:** disambiguate before returning:

```rust
let row = match row {
    Some(row) => row,
    None if req.family_wide_kind.as_deref() == Some("item_bucket") => {
        return Err(ApiError::Conflict("this family already has a family-wide item bucket".into()))
    }
    None => return Err(ApiError::Conflict("a collection with this id already exists".into())),
};
```

---

### WR-05: `FamilyRekeyNotice` tells every remaining member that *their* share was re-encrypted, and its change-detection state survives an account switch

**Files:** `web/src/lib/vault/collections.ts:96-98,283-298,175-179`,
`web/src/lib/i18n/dictionary.ts:1428-1431`

**Issue:** two problems in one mechanism.

1. **Copy vs. audience.** `notifyRekeyListeners` fires for *any* collection whose
   `sealed_key` changed, for *every* remaining recipient. The string says
   "Jedna z **Twoich** udostępnionych pozycji… / One of **your** shared items was
   re-encrypted". A member who only ever *received* a shared folder is told they shared it.
   30-CONTEXT's requirement was "the sharer is told"; the implementation tells everyone,
   with sharer-specific wording.
2. **State not reset.** `lastSealedKeys` is a module-level `Map` cleared by nothing —
   `clearCollectionsOnRemoval()` (collections.ts:175-179) resets `collections` and frees key
   handles but leaves `lastSealedKeys` populated, and the lock-state subscriber does not
   touch it. Two members of the same family hold the **same collection id** with **different**
   `sealed_key` blobs, so a same-tab account switch without a full page reload emits a false
   "your share was re-encrypted" notice for every shared collection.

**Fix:** reword to be audience-neutral ("Udostępniony folder został ponownie zaszyfrowany…"),
and clear the map wherever collection state is torn down:

```ts
export function clearCollectionsOnRemoval(): void {
  freeAllCollectionKeys();
  collections = [];
  lastSealedKeys = new Map();   // <- add
  notifyListeners();
}
```

---

### WR-06: `getFamilyWidePending()` swallows every error class, so a persistently broken discovery endpoint is indistinguishable from "nothing pending"

**File:** `web/src/lib/families/api.ts:167-175`

**Issue:**

```ts
try { return await apiJson<FamilyWidePendingResponse>(...); }
catch { return { missing: [], resealable: [] }; }
```

A 500, a schema mismatch, an expired token, or a total network partition all produce the
same value as a genuinely empty result. Two shipped guarantees then fail silently and
identically: the pending-newcomer row (the FSH-05 honesty feature) never renders, and
`runFamilyWideResealTrigger` early-returns on `resealable.length === 0` and never fires — so
FSH-02's fallback half quietly stops existing, with no signal anywhere. The doc comment
justifies the shape for the expected 403/404 cases; it does not cover the rest.

**Fix:** keep the fail-safe return value but stop discarding the signal — narrow the catch
to the two expected statuses and `console.warn` the rest, mirroring `resealTrigger.ts`'s own
`console.warn`-and-continue discipline:

```ts
} catch (err) {
  const status = (err as { status?: number } | null)?.status;
  if (status !== 403 && status !== 404) {
    console.warn("pv: family-wide-pending discovery failed — pending rows and lazy reseal are paused", err);
  }
  return { missing: [], resealable: [] };
}
```

---

### WR-07: `.planning/WINDOWS.md`'s machine-readable JSON block has drifted from its own table

**File:** `.planning/WINDOWS.md:36-231`

**Issue:** the markdown table and the trailing ````json` array disagree. Entry **#17** is
present in the table and **entirely absent** from the JSON. Entries **#15** and **#16** are
`fixed` in the table (resolved `2026-08-11T09:40:00.000Z`) and `"status": "open"` with
`"resolved_at": null` in the JSON. `gsd-tools windows` and `/gsd-ship`'s
`open_count > 0` block read the machine-readable half; the frontmatter counters
(`open_count: 6`, `fixed_count: 11`) were computed from the table. A consumer trusting the
JSON sees a different ledger than a human reading the file.

**Fix:** regenerate the JSON block from the table (`gsd-tools windows` rewrite), or add #17
and correct #15/#16 by hand before this phase is shipped.

## Info

### IN-01: Duplicated comment block

**File:** `web/src/lib/vault/store.ts:1550-1558`
The six-line "30-13 (FSH-02): a new unlock is a new session for the reseal trigger too…"
comment is pasted twice, back to back, above a single `resetFamilyWideResealAttempts()` call.
Delete one copy.

### IN-02: `PENDING_FAMILY_KEY_ID_PREFIX` is exported with no consumer

**File:** `web/src/lib/vault/store.ts:262`
Its own doc comment says "any consumer that needs to tell the two apart has both this prefix
and the `pendingFamilyKey` discriminant to check" — no such consumer exists anywhere in
`web/src`, `web/e2e`, or `packages/`. This is the mild form of this project's signature
defect. Either drop the `export` (it is used only two lines below, inside the same module) or
use it in the guards that currently rely on `pendingFamilyKey` alone.

### IN-03: Unresolved `T-30-XX` placeholder task ids shipped in doc comments

**Files:** `web/src/lib/families/rekey.ts:36,102`,
`web/src/components/settings/DeleteAccountDialog.tsx:153`
Three references read literally `T-30-XX`. Replace with the real task id or drop the
reference; a placeholder id is worse than no id because it looks resolvable.

### IN-04: The discovery endpoint's empty-result case — explicitly named by T-30-04 — has no test

**File:** `crates/pv-server/tests/family_wide_sharing.rs:766-846`
`family_wide_pending_discovery_response_carries_only_ids_and_kinds` exercises a newcomer
(`missing.len() == 1`) and a keyholder (`resealable.len() == 1`). No case asserts that a
caller with nothing pending gets exactly `{"missing":[],"resealable":[]}` with no additional
keys. The generic string sweep would in fact *fail* on an empty body
(`assert!(!strings.is_empty(), ...)`), so the test as written cannot be reused for that case.
Low risk (the response types are statically shaped), but the plan claims the property "on any
path including the empty-result case" and that specific path is unproven.

### IN-05: `submitItemFamilyWide` does not guard an item that already lives in another collection

**File:** `web/src/components/vault/ShareDialog.tsx:658-694`
`moveItemToCollection(item.id, bucket.id, ...)` relocates the item unconditionally. If the
item was already inside a shared collection, every recipient of that collection silently
loses access as a side effect of "share with the whole family" — no confirmation, no
disclosure. This is the same effect an ordinary move already has, so it is consistent rather
than novel; flagged because the family-wide entry point is new and reads as purely additive
("add the family as a recipient") rather than as a move.

---

## Dispositions (fix pass, 2026-08-11T08:43:06Z)

Full report: `30-REVIEW-FIX.md`. Commits landed on `main` at `a767224..HEAD`
(`ee928a3`, `9cdd0b8`, `8b2d663`, `4b15310`, `882c86d`, `701cab1`, `a22d732`,
`22c1be0`).

| ID | Disposition | Reason |
|----|-------------|--------|
| CR-01 | fixed | New `collections.family_wide_access_level` column persists the share's own chosen level; both propagation paths (`invite/crypto.ts`, `resealTrigger.ts`) now read it instead of the propagator's own row. Live server test added and confirmed to fail pre-fix. |
| CR-02 | fixed | `invitations::create`'s relaxed propagation bound is now scoped to `family_wide_kind IS NOT NULL` (`membership::is_family_wide_collection`); an ordinary collection falls back to `require_collection_edit`. Regression test added and confirmed to fail pre-fix. |
| CR-03 | fixed | `collections::add_member` is `RequireRead` + `may_grant_access_level`-bounded for a family-wide collection (still `RequireEdit`-only for an ordinary one) — closes WINDOWS #17; a `read`-holding member can now reseal a `read`-declared share. |
| CR-04 | fixed | `findOrCreateFamilyItemBucket` consults `getFamilyWidePendingSnapshot().missing` before attempting a create it cannot win, and renders the existing `share.pendingFamilyKeyNote` copy instead of `share.createFailed`. |
| WR-01 | fixed | `accept()`'s family-wide loop now re-validates the inviter's current authority per entry, mirroring the existing single-collection-scope check; a stale entry is silently dropped. |
| WR-02 | fixed | `reassign_departing_member_collection_items` skips reassignment when zero recipients survive, letting the ordinary cascade delete apply as it did before the WINDOWS #16 fix. Regression test added and confirmed to fail pre-fix. |
| WR-03 | fixed | `ItemList.tsx` excludes `pendingFamilyKey` placeholders from every scoped (non-"all") filter view. |
| WR-04 | fixed | The `item_bucket` conflict path now reports "this family already has a family-wide item bucket" instead of the generic id-collision message. |
| WR-05 | fixed | `clearCollectionsOnRemoval` now resets `lastSealedKeys`; `share.familyRekeyNotice` reworded to be audience-neutral (no longer claims "your shared item" for a recipient who only received it). |
| WR-06 | fixed | `getFamilyWidePending` narrows its silent catch to the two expected statuses (403/404) and `console.warn`s every other failure class. |
| WR-07 | skipped | Explicitly excluded from this pass — `.planning/WINDOWS.md` is not touched; Bartek is handling #17's status/re-record himself. |
| IN-01 | fixed | Removed the duplicated six-line comment block above `resetFamilyWideResealAttempts()` in `store.ts`. |
| IN-02 | fixed | `PENDING_FAMILY_KEY_ID_PREFIX` is no longer exported (no consumer existed anywhere in `web/src`/`web/e2e`/`packages/`). |
| IN-03 | fixed | Replaced the two literal `T-30-XX` placeholders with a reference to the real fixing commit (`1117919`). |
| IN-04 | fixed | Added an exact-shape assertion (`{"missing":[],"resealable":[]}`, no other keys) to the existing empty-result discovery test. |
| IN-05 | no_change_needed | No concrete fix was proposed by the review — flagged as "consistent rather than novel" (same behavior an ordinary move already has), a disclosure/product question rather than a code defect. |

_Reviewed: 2026-08-11T07:55:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
