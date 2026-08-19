---
phase: 32-putting-things-into-shared-folders
reviewed: 2026-08-19T00:00:00Z
depth: deep
diff_base: 2f6e8e6
diff_verified: true
files_reviewed: 11
files_reviewed_list:
  - crates/pv-provider/src/ceremony.rs
  - crates/pv-provider/tests/response_shape.rs
  - crates/pv-server/src/routes/vault.rs
  - web/e2e/sharing.spec.ts
  - web/src/components/vault/DetailPanel.test.tsx
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/ItemForm.test.tsx
  - web/src/components/vault/ItemForm.tsx
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/vault/moveVaultItem.real-wasm.test.ts
  - web/src/lib/vault/store.ts
findings:
  critical: 2
  high: 2
  medium: 7
  low: 5
  total: 16
status: issues_found
verdict: BLOCK
---

# Phase 32: Code Review Report

**Reviewed:** 2026-08-19
**Depth:** deep (cross-file: client store -> UI -> wire -> server gates -> SQL)
**Diff base verified:** yes. `git log 2f6e8e6..HEAD` = 13 commits, all Phase 32; `git diff --stat 2f6e8e6..HEAD -- crates/ web/` = 11 files, 1773 insertions, matching the brief. `2f6e8e6` is the last docs commit before the first Phase-32 code commit. No scope error this time.
**Status:** issues_found — **BLOCK**

## Summary

The mechanism is largely right where it was designed: the AAD genuinely binds the destination
collection (`encrypt_item_for_collection(ck, plaintext, collection_id, item_id, revision)`,
`crates/pv-wasm/src/lib.rs:356-370`), the real-WASM test file is a genuine proof with real
negative checks, both recovery gates literally carry the `revision === currentRevision + 1`
conjunct the plan-check demanded, and the recovery re-fetch does rethrow the original error.
The two audit items the brief asked me to confirm as clean are clean: `vault.rs`'s 38 lines are
19 pure `&mut *tx` -> `&mut tx` deref-coercion pairs against helpers whose signatures are all
`tx: &mut sqlx::SqliteConnection` (zero semantic change), and `move_item`'s unconditional
`DELETE FROM item_shares` is byte-identical to `2f6e8e6`.

What blocks the phase is what nobody modelled:

1. **`moveVaultItem` has no ownership check and encrypts move-outs under the *caller's* User
   Key.** A shared-folder `edit` member can select "Bez folderu" on an item another member
   authored and permanently destroy it — the server accepts it (Gate 0 only fires when the item
   is *already* personal), the row keeps `user_id = author` and gets ciphertext only the mover's
   UK can open, and the author's client marks it undecryptable forever. This is the exact
   question the brief asked ("can `moveVaultItem` ever produce an undecryptable row?") and the
   answer is yes, through the shipped UI, with no error anywhere.
2. **The C-2 revision conjunct does not discriminate in the caller topology that shipped.** It
   only works if `currentRevision` advances between attempts. In edit mode it provably cannot:
   `DetailPanel` pins `editBaselineRevision` at edit-entry and keys `ItemForm` on it. So the
   retry re-sends the same baseline, `newRevision` equals the revision the *previous* attempt
   committed, and the recovery fires on a foreign write — reporting success over content the
   user's last edit never reached. That is verbatim the failure C-2 was raised to close.

Beyond those: the 404 refusal shape the executor discovered is genuinely unhandled in
production (a revoked — not merely demoted — destination surfaces "Please try again" on an
operation that can never succeed, WINDOWS #11's shape); a partial create-then-move failure
silently discards any edits the user makes before their second Save; the `item_bucket` guard
fails open rather than closed; and `store.ts::moveVaultItem`'s entire catch block — every branch
the plan-check treated as load-bearing — has zero unit coverage.

---

## Critical

### CR-01: `moveVaultItem` encrypts under the caller's own key with no ownership check — a shared-folder editor can permanently destroy another member's item

**Files:**
- `web/src/lib/vault/store.ts:1161-1198` (`moveVaultItem`: `getUnlockedUserKey()` at 1167, `encryptItem(uk, ...)` at 1186)
- `web/src/components/vault/ItemForm.tsx:604` ("Bez folderu" is offered unconditionally in the non-bucket branch)
- `web/src/lib/vault/itemCapabilities.ts:59-63` (`canEditItem` returns true for any `accessLevel === "edit"` collection item)
- `crates/pv-server/src/routes/vault.rs:916-990` (Gate 0 only fires when `current_collection.is_none()`; Gate 1 only for an `item_bucket` source)

**Issue:** The function's doc comment states its precondition as *"the caller holds genuine, live
plaintext"* and argues safety from `canEditItem`. That covers the plaintext, and misses the key.
The precondition that actually matters — *the key this content is re-encrypted under must be a key
the row's owner can still open* — is neither stated nor checked.

Concrete failure, entirely through shipped UI:

1. Owner A shares folder F with member B at `edit`. B's client loads A's items into
   `collectionSharedItems` (`GET /api/vault/collections/{id}/items` is author-agnostic —
   `crates/pv-server/src/routes/collections.rs:443` selects `WHERE collection_id = ?` with no
   `user_id` predicate), decrypted via the collection key, `sharedToMe` unset.
2. `canEditItem` -> true (`accessLevel === "edit"`), so `DetailPanel` renders Edit; `ItemForm`
   renders the destination select with `currentCollectionId = F`.
3. B picks "Bez folderu". `destinationCollectionId (null) !== F` -> `moveVaultItem(id, fields, rev, null)`
   -> `encryptItem(uk_B, ...)` — **B's** User Key.
4. Server: `Membership<Item, RequireEdit>` passes (B holds edit via F). Gate 0 is skipped
   (`current_collection` is `Some(F)`). Gate 1 is skipped (F is a folder, not an `item_bucket`).
   Gate 2 is skipped (`new_collection_id` is `None`). The `UPDATE` writes
   `collection_id = NULL, enc_key/enc_data = <sealed to uk_B>` and leaves `user_id = A`.
5. Result: `fetch_items_for` arm 1 (`WHERE user_id = ? AND collection_id IS NULL`,
   `vault.rs:404-410`) returns the row to **A**, whose client decrypts with `uk_A` and fails ->
   permanently `undecryptable`. B's own client loses the row entirely on next sync (arm 1 wants
   `user_id = B`, arm 2 wants a non-null `collection_id`). **Nobody can ever decrypt it again,
   and no client shows an error.**

Second variant, same root cause: B moves A's item from F into collection G (B holds edit on G,
A holds nothing). The item survives — readable by G's members — but disappears from A's vault
with no notification. This is exactly SC3's "a move never produces a row nobody can decrypt"
and the milestone's exposure-clarity premise, both violated by the same missing check.

This path did not exist before this phase: the only prior `moveItemToCollection` callers are
`ShareDialog.tsx:1567` and `:1774`, both of which decrypt with the caller's own `uk` on items
the caller owns, and neither of which ever targets `null`.

**Fix:** Refuse the move client-side and add the matching server gate — the client-side check
alone is presentation, not authorization.

```ts
// store.ts::moveVaultItem, before any encryption
const existing = items.find((i) => i.id === id);
// A move-out re-seals under THIS caller's UserKey; only the row's owner can
// ever open that. A collection item the caller did not author must never be
// re-scoped to personal (and never into a collection its owner lacks).
if (newCollectionId === null && existing?.collectionId != null && !callerOwnsItem(existing)) {
  throw new NotItemOwnerError(id);
}
```

`VaultItem` currently carries no owner id, so this needs `user_id`/`is_own` surfaced on
`SharedCollectionItemRow` (or an `ownedByMe` flag computed server-side). The authoritative half
belongs in `vault.rs::move_item` as a Gate 1b, mirroring Gate 1's existing shape:

```rust
// A move OUT of any collection re-seals under the caller's own key material.
// Only the item's owner may do that — extend Gate 1's line from item_bucket
// sources to every source, for the destination `None` case.
if req.new_collection_id.is_none() && precheck_owner_user_id != source.caller_user_id {
    return Err(ApiError::Forbidden);
}
```

---

### CR-02: the C-2 revision conjunct cannot discriminate on retry — `currentRevision` is pinned across attempts, so recovery reports success over a previous attempt's content

**Files:**
- `web/src/lib/vault/store.ts:1237-1270` (`newRevision = currentRevision + 1` at 1181; the conjunct at 1254-1258)
- `web/src/components/vault/DetailPanel.tsx:608-612` (`key={`${item.id}-${editBaselineRevision}`}`, `currentRevision={editBaselineRevision ?? item.revision}`)
- `web/src/components/vault/ItemForm.tsx:462-478` (create-mode mirror; `fresh?.revision ?? created.revision`)

**Issue:** The conjunct is present in both places, as the brief asked me to verify. But its
soundness argument — recorded in the code comment and in `32-PLAN-CHECK.md` C-2 — assumes
*"Save #2 sends content B **at the refreshed revision**"*. In edit mode nothing refreshes it.
`editBaselineRevision` is captured once at edit entry (`DetailPanel.tsx:160-163` says so
explicitly) and `ItemForm` is keyed on it, so both attempts pass the identical
`currentRevision`, and therefore compute the identical `newRevision`.

Reachable sequence, edit mode, no exotic assumptions:

1. Item at revision 5, personal. User edits content to **B** and picks shared folder F. Save #1
   -> server commits revision 6 / content B / `collection_id = F`. Network drops before the
   response arrives; the in-`catch` `listItems()` also fails, so `throw err` (correctly) —
   generic banner.
2. Network returns. User edits the password to **C** and clicks Save again. `currentRevision` is
   still 5, so `newRevision` is still 6.
3. Server: `WHERE id = ? AND revision = 5` matches nothing (the row is at 6) -> 409.
4. Recovery: `freshRow.collection_id === F` ✅ and `freshRow.revision (6) === newRevision (6)` ✅
   -> **recovered**. `buildUpdated(6, ...)` is built from `fields` = **C**, written into the
   store, returned as success. `onCreated()` closes the editor.

The server holds **B**. The store shows **C**. The user was told it saved. The next snapshot
reverts them to B. This is the precise "reports success over a write that didn't land, and eats
the user's last edit" state C-2 was raised as a BLOCKER to prevent; the fix landed in the branch
but the caller never satisfies its premise.

The create-mode mirror is weaker for the same reason but partially self-healing: it refreshes
via `fresh?.revision ?? created.revision`, and `getItems()` is stale in exactly the scenario
(`listItems()` unavailable) that produced the failure, so it usually falls back to the original
revision and reproduces the same false recovery.

**Fix:** Do not infer "this attempt's own commit" from a revision the client predicted. Either
(a) make the identity explicit — have `move_item` echo a client-supplied idempotency token /
`last_editor` + the exact expected revision, and recover only on an exact token match; or
(b) at minimum, make recovery conditional on the content also matching, and make the caller
advance its baseline:

```ts
// DetailPanel: after any failed save, re-baseline from the store before the
// user's next attempt, so a retry cannot re-predict a revision another
// attempt already consumed.
onError={(err) => {
  setEditBaselineRevision(getItems().find((i) => i.id === item.id)?.revision ?? null);
  ...
}}
```
Re-baselining alone is not sufficient (the store may be stale); (a) is the durable fix. Until
one exists, recovery must decline whenever the client cannot prove the stored ciphertext is its
own — a false failure is recoverable, a false success is not.

---

## High

### HI-01: the 404 refusal shape is unhandled in production — a permanently-refused move surfaces retry-inviting copy

**Files:**
- `web/src/lib/vault/store.ts:76-88` (`isForbiddenError`, 403 only), `:1275-1288` (no `isNotFoundError` branch, `throw err`)
- `web/src/components/vault/DetailPanel.tsx:626-632` (only `CollectionKeyUnavailableError` routes to `moveRefused`)
- `web/src/lib/i18n/dictionary.ts:552-555` (`error.itemSaveFailed` = "Failed to save item. Please try again." / "Spróbuj ponownie.")
- `crates/pv-server/src/routes/membership.rs:397-403` (`gate`: `None => Err(ApiError::NotFound)`), `:480-488` (`require_collection_edit`)

**Issue:** The executor discovered this while writing SC3 and documented it in
`32-04-SUMMARY.md:19/29/89` and `STATE.md:413` — then routed around it by driving the test with a
PUT demotion instead of a DELETE. The test is now honest about what it proves, but the
production gap it revealed was never filed (no WINDOWS entry) and never fixed.

`Collection::resolve_access` -> `None` -> `gate::<M>()` -> **404**. That is what a *fully revoked*
grant produces — the ordinary outcome of "stop sharing this folder with X", and at least as
common as a demotion. In that case:

- `isForbiddenError` (403 only) doesn't match, `isConflictError` doesn't match, the recovery
  re-fetch finds nothing -> `throw err` (raw 404).
- `DetailPanel`'s `instanceof CollectionKeyUnavailableError` doesn't match -> `setSaveError("generic")`
  -> `error.itemSaveFailed` -> **"Failed to save item. Please try again."**

The user is invited to retry an operation that cannot succeed until someone else restores their
access. That is WINDOWS #11's shape, in the one branch SC3 exists to make honest — and it means
SC3 ("the user sees an honest error") holds only for the demotion shape actually exercised.

**Fix:**

```ts
// store.ts::moveVaultItem, alongside the 403 branch
if (isForbiddenError(err) || isNotFoundError(err)) {
  // 404 = the grant row is gone entirely (gate()'s None -> NotFound);
  // 403 = the row survives at too low a level. Both are access loss, and
  // neither is retryable by the user.
  throw new CollectionKeyUnavailableError(newCollectionId ?? "personal");
}
```
`isNotFoundError` already exists at `store.ts:68`. Add the delete-driven variant to
`sharing.spec.ts` as its own case, so both refusal shapes are proven, not just the convenient one.

---

### HI-02: after a partial create-then-move failure, changing the destination silently discards the user's subsequent edits and reports success

**File:** `web/src/components/vault/ItemForm.tsx:441-503`

**Issue:** Once `createdItemState` is set, the create call is skipped forever (correct), but the
only remaining write is the *move*. If the user reacts to `error.itemCreatedButMoveFailed` by
choosing a different destination that is not a collection — "Bez folderu", or any personal
folder — `destinationCollectionId` becomes `null`, the `if (destinationCollectionId !== null)`
block is skipped entirely, and the code falls straight through to
`setCreatedItemState(null); onCreated();` (lines 502-503). **No write of any kind is issued.**

Concrete: user creates "Wifi"/password A destined for shared folder F. Create succeeds; the move
fails; the banner says "The item was saved, but moving it to the selected folder failed. Try
again." The user decides to keep it private, fixes a typo in the password to B, picks the
personal folder "Home", and hits Save. The form closes reporting success. The server holds
"Wifi"/password **A** with `folderId: null`. Both the corrected password and the chosen folder
are gone, silently.

**Fix:** In create mode with `createdItemState !== null`, a non-collection destination is still a
pending write — route it through `updateVaultItem`:

```ts
if (destinationCollectionId !== null) {
  await moveVaultItem(created.id, cleaned, created.revision, destinationCollectionId);
} else if (createdItemState !== null) {
  // The item already exists from a prior attempt; whatever the user changed
  // since (content, personal folder) is unsaved until this call.
  await updateVaultItem(created.id, cleaned, created.revision);
}
```

---

## Medium

### ME-01: the `item_bucket` guard fails OPEN — the shipped `value={fields.folderId ?? ""}` path is reachable

**File:** `web/src/components/vault/ItemForm.tsx:538-563`

**Issue:** Answering the brief's question 3 directly: **no, the shipped path is not genuinely
unreachable.** The guard is
`collections.find((c) => c.id === currentCollectionId)?.familyWideKind === "item_bucket"`. Every
unknown resolves to `false`: `useCollections()` returning `[]` before `refreshCollections()`
lands (the store is a `useSyncExternalStore` over a module-level cache populated asynchronously
after unlock), or the bucket simply being absent from the caller's list. In that window an item
that genuinely lives in a family-wide bucket renders the *enabled* select with "Bez folderu"
selected — which is precisely the mis-file B-2 was written to prevent, and it re-renders into
the correct disabled control only once the fetch resolves.

Compare `collections.ts:158-160`'s `isFamilyWideCollection`, whose doc comment states it "fails
CLOSED in every unknown case ... a store that has not refreshed yet". This guard takes the
opposite default for a strictly more damaging outcome.

The *save* half of the requirement does hold: in the guarded branch `fields.folderId` is
untouched and the dispatch compares `destinationCollectionId === currentCollectionId`, so no
`folderId` change and no move is written — the unit test at `ItemForm.test.tsx:640-687` proves
that much.

**Fix:** Fail closed on unknown, and distinguish "not a bucket" from "don't know yet":

```ts
const currentCollection = currentCollectionId != null
  ? collections.find((c) => c.id === currentCollectionId)
  : undefined;
// Unknown scope must never render as an editable personal destination.
const scopeUnknown = currentCollectionId != null && currentCollection === undefined;
if (scopeUnknown || currentCollection?.familyWideKind === "item_bucket") { /* disabled control */ }
```

### ME-02: `buildUpdated` drops `lastEditorEmail`, re-regressing the documented WR-02 fix — and its own comment claims otherwise

**File:** `web/src/lib/vault/store.ts:1200-1220`

**Issue:** The comment at 1204-1209 says "Same carry-forward discipline `updateVaultItem`'s own
tail comment documents for `lastUsedAt`/`isShared`/`lastEditorEmail`". The returned object
(1210-1219) carries `lastUsedAt` and `isShared`, and **omits `lastEditorEmail` entirely**.
`updateVaultItem:1105-1113` carries it, with a 10-line comment (WR-02, code review iteration 1)
explaining that dropping it makes `DetailPanel`'s live-conflict attribution silently fall back
to the generic copy in exactly the window a shared item is most likely to conflict. A move into
a shared folder reproduces that regression.

**Fix:** `lastEditorEmail: existing?.lastEditorEmail,` in `buildUpdated`'s return, and correct
the comment either way.

### ME-03: the recovery re-fetch uses `listItems()`, which never returns items the caller did not author — recovery is structurally impossible for another member's item

**Files:** `web/src/lib/vault/store.ts:1245-1259`; `crates/pv-server/src/routes/vault.rs:403-421`

**Issue:** `fetch_items_for`'s arm 2 requires `i.user_id = ?` (plus `ck.recipient_user_id = ?`
and the active-member join), so `GET /api/vault/items` only ever returns rows the caller
**authored**. For any move of a collection item authored by someone else (the same population as
CR-01), `freshRow` is always `undefined`, so the lost-response recovery can never fire and every
such lost response is reported as a failure. Even setting CR-01 aside, `listItems()` is the
wrong probe for this question: the right one is a single-item read scoped to the destination.

**Fix:** Probe the destination instead of the personal list —
`GET /api/vault/collections/{newCollectionId}/items` for a non-null destination (already used by
the e2e at `sharing.spec.ts`), falling back to `listItems()` only for a move-out.

### ME-04: SC4's negative anchor measures DOM absence downstream of the list-removal wait — it cannot distinguish access loss from the client simply unmounting

**File:** `web/e2e/sharing.spec.ts` (SC4 test, steps 3-5)

**Issue:** The `toHaveCount(1)` pre-check does genuinely drive the absence assertion — it is the
same page-scoped locator, and it would fail on a build where the password never rendered. That
part is sound and answers the brief's question 7 for that specific hazard.

What it still cannot do is discriminate *why*. The negative read runs only after
`expect(item-row-${itemId}).toHaveCount(0, { timeout: 60000 })`, i.e. after the member's client
has already dropped the item from `collectionSharedItems` via `mergeCollectionSnapshot`'s
wholesale replace. Once that happens the panel's plaintext leaves the DOM as a rendering
consequence, whether or not the member retains any cryptographic or API-level access. The test's
own comment concedes it is "agnostic to WHY". SC4 claims "the same read fails" — the strong form
of that is a *recipient-side re-read attempt*, and none is made.

This is the same "evidence that measures the wrong thing" shape the executor already hit once on
their first SC4 falsification (recovered by a 30s poll fallback).

**Fix:** Add one assertion that can only pass if access is genuinely gone — e.g. with the
member's own token,
`GET /api/vault/collections/{destinationId}/items` must not contain `itemId`, and/or
`reloadAndUnlock(member.page)` followed by the same password locator at `toHaveCount(0)`. A
post-reload absence cannot be explained by a stale unmount.

### ME-05: `store.ts::moveVaultItem`'s entire catch block is untested; `DetailPanel`'s `moveRefused` branch has no unit test

**Files:** `web/src/lib/vault/moveVaultItem.real-wasm.test.ts` (no `listItems`/recovery/403 case);
`web/src/components/vault/DetailPanel.test.tsx` (diff adds mocks only, zero new tests)

**Issue:** Everything the plan-check called load-bearing lives in `store.ts:1237-1290` — the
recovery gate, the C-2 conjunct, the "rethrow the ORIGINAL error when `listItems` fails" rule,
the 409 branch, and the 403 -> `CollectionKeyUnavailableError` mapping. **None of it is
exercised by any test.** The C-2 conjunct is tested only in its `ItemForm` mirror
(`ItemForm.test.tsx:718-741`), where `moveVaultItem` is a mock — so the store-side copy of the
same rule could be deleted and every suite would stay green. Likewise, `DetailPanel.test.tsx`'s
20-line diff adds `MockCollectionKeyUnavailableError` but never asserts that it renders
`error.itemMoveAccessLost`; only the live SC3 covers it.

By this phase's own standard ("an untriggered failure branch is not proven"), these branches are
unproven.

**Fix:** Add store-level tests (the real-WASM file already mocks `./api`, so `listItems` is
mockable there): recovery-on-match, decline-on-foreign-revision, rethrow-original-on-refetch-failure,
403 -> `CollectionKeyUnavailableError`, and 404 -> whatever HI-01 settles on. Add one
`DetailPanel` test asserting the `moveRefused` banner text.

### ME-06: `isForbiddenError`'s "403 only happens on a non-null destination" claim is false — Gates 0/1 403 a move-out, and it is mislabelled as a folder-write-access error

**Files:** `web/src/lib/vault/store.ts:78-88`, `:1279-1287`;
`crates/pv-server/src/routes/vault.rs:957-960` (Gate 0), `:985-989` (Gate 1)

**Issue:** Both the helper's comment and the catch-block comment assert a 403 is "Reachable only
when `newCollectionId !== null` (Gate 2 only runs on a non-null destination)". `move_item`
returns `ApiError::Forbidden` from two other places that do not consult the destination at all:
Gate 0 (a personal item re-scoped by a non-owner) and Gate 1 (an item moved out of an
`item_bucket` by a non-owner). Both can fire with `new_collection_id: None`. The
`newCollectionId ?? "personal"` fallback at 1285 confirms the author half-knew the branch was
reachable but kept the comment.

Consequence: a move-out refused by Gate 1 renders *"You no longer have write access to this
folder. The change was not saved."* — a statement about a destination folder the user did not
choose. Wrong diagnosis, and it hides the real one (someone else owns this item).

**Fix:** Delete the false reachability claim, and split the mapping: a 403 with
`newCollectionId === null` is an ownership refusal, not a destination-key refusal. It deserves
its own error class and its own copy (and it becomes the client-side half of CR-01's fix).

### ME-07: a lost `createVaultItem` response still duplicates the item on retry

**Files:** `web/src/lib/vault/store.ts:914-934` (`crypto.randomUUID()` per call, line 929);
`web/src/components/vault/ItemForm.tsx:444-449`

**Issue:** `createdItemState` guarantees "never re-creates" only once the create response was
*observed*. If the POST commits and the response is lost, `createdItemState` stays `null`, the
generic `error.itemSaveFailed` ("Please try again") renders, and the next Save mints a **new
UUID** and creates a **second item**. Plan 32-01's must-have — "a retry moves (never re-creates)
the same item" — is true only for the move half. The phase widens the population of users who
are explicitly invited to retry a create-mode submission, which makes this pre-existing hazard
more reachable, not less.

**Fix:** Generate the item id in `ItemForm` (or hold it in `createdItemState` before the call)
and pass it into `createVaultItem`, so a retry re-POSTs the same id; `create`'s PK conflict then
becomes an idempotent no-op rather than a duplicate row.

---

## Low

### LO-01: empty `<optgroup>` for personal folders

**File:** `web/src/components/vault/ItemForm.tsx:605-611`

The shared group is correctly guarded by `sharedCollections.length > 0` (W-3), but
`<optgroup label={t("item.myFoldersGroup")}>` renders unconditionally, so a user with no personal
folders sees an empty "Moje foldery" group header. Apply the same guard to `folderOptions.length`.

### LO-02: `isShared` stays `true` after a move-out until the next snapshot

**File:** `web/src/lib/vault/store.ts:1218`

`isShared: newCollectionId !== null ? true : (existing?.isShared ?? false)` keeps `true` on a
move-out, so an item just taken out of a shared folder still reads as shared. It errs toward
over-reporting exposure (the safe direction for this milestone), but in a milestone whose whole
point is "tell me accurately what I'm exposing", a stale "shared" badge on a
just-unshared item is its own small lie. Prefer `false` on a move-out, corrected by the snapshot.

### LO-03: `accessLevel` can resolve to `undefined` after a move, which `canEditItem` reads as ownership

**Files:** `web/src/lib/vault/store.ts:1215-1217`; `web/src/lib/vault/collections.ts:143`;
`web/src/lib/vault/itemCapabilities.ts:60-62`

`getCollectionAccessLevel` returns `undefined` for an uncached collection or a `null`
`access_level`, and `canEditItem` treats `accessLevel === undefined` as "the caller owns this
item outright -> YES". A move into a collection whose level the cache lacks therefore renders as
fully editable. Practically narrow (you just used that collection's key), but it is a fail-open
in a capability check that documents itself as failing closed.

### LO-04: test assertions that cannot fail, and duplicated lookups

- `ItemForm.test.tsx:664` — `expect(select.options[0].textContent).not.toContain("item.noFolder")`
  is implied by the preceding `toBe("item.folderLockedByFamilyShare")`; it can never fail
  independently.
- `ItemForm.test.tsx:670` — `fireEvent.change(select, { target: { value: "some-personal-folder" } })`
  on a single-option select cannot set that value in jsdom regardless of `disabled`, so the
  "no side effect" claim it is meant to support is not actually driven by the guard. The
  `select.disabled` assertion above it is the one doing the work.
- `store.ts:1201-1202` — `const existingIndex = items.findIndex(...); const existing = existingIndex === -1 ? undefined : items[existingIndex];` is a verbatim copy of `updateVaultItem`'s
  shape but is just `items.find(...)`, and it re-looks-up what `existingBeforeSave` (line 1174)
  already holds.
- `ItemForm.tsx:462` — `created!` non-null assertion inside the catch closure; hoisting to a
  `const createdRef = created` above the try removes it.

### LO-05: the recovery re-fetch's failure is swallowed with no diagnostic

**File:** `web/src/lib/vault/store.ts:1246-1252`

`catch { throw err; }` rethrows the original error correctly (as the brief asked me to verify),
but discards the re-fetch error entirely — no `console.error`. Every other post-commit failure in
this file logs (`:1263`, `:1296`). Debugging a false-failure report in the field will be blind to
whether the recovery probe even ran.

---

## Confirmed clean (asked for explicitly)

- **`vault.rs`'s 38 lines are a pure lint sweep.** All 19 pairs are `&mut *tx` -> `&mut tx` at
  call sites whose callees are declared `tx: &mut sqlx::SqliteConnection`
  (`vault.rs:96/155/186/207/235`, `membership.rs:710`), so the change is a deref-coercion that
  the compiler performs identically. Every `.execute(&mut *tx)` on a generic `Executor` bound is
  correctly left alone. No transaction boundary, ordering, or statement changed. `ceremony.rs`
  and `response_shape.rs` are doc-comment rewraps only.
- **`move_item`'s `item_shares` DELETE is byte-identical to `2f6e8e6`.** Diffed the
  `1185-1215` region old vs new: only the two surrounding `bump_direct_share_revision` /
  `bump_collection_revision` deref forms changed; the `if req.new_collection_id.is_some()` guard,
  its comment block, and
  `sqlx::query("DELETE FROM item_shares WHERE item_id = ?").bind(&id).execute(&mut *tx)` are
  unchanged. The 2026-08-19 reversal is honoured.
- **The recovery gate carries both conjuncts, in both places** (`store.ts:1254-1258`,
  `ItemForm.tsx:463-466`), and no path recovers on destination alone. The re-fetch does rethrow
  the original error (`store.ts:1246-1252`). CR-02 is about the conjunct's *premise*, not its
  presence.
- **The AAD binds the destination collection.** `encryptItemForCollection(ck, plaintext, newCollectionId, id, newRevision)`
  maps to `encrypt_item_for_collection(ck, plaintext, collection_id, item_id, revision)`
  (`crates/pv-wasm/src/lib.rs:356-370`), parameter order correct, and
  `moveVaultItem.real-wasm.test.ts` proves the round trip with genuine negative checks under a
  second real collection key.
- **The create-then-move sequence is genuinely sequential and never double-creates an observed
  create**, and a `RevisionConflictError` is routed to conflict copy rather than the
  retry-inviting string (`ItemForm.tsx:481-493`) — WINDOWS #11 was respected on that specific
  branch. HI-01 and ME-07 are the two retry-lies that remain.

---

## Fix Disposition

**Fixed:** 2026-08-19
**Fixer:** Claude (gsd-code-fixer), isolated worktree `gsd-reviewfix/32-45328`
**Branch:** `main` (fast-forwarded after fixing; not pushed)
**Commits (in order):** `9c1fabe`, `435a547`, `1140473`, `79f78e8`, `04973e1`, `f0603fc`

All 16 findings were investigated. All 2 Critical, both High, all 7 Medium, and 3 of 5 Low were
fixed and verified (2 Lows deliberately skipped, see LO-04 below). One additional real bug —
not named in the review — was found and fixed via this phase's own live-E2E falsification run
(see HI-01/ME-07-commit below).

### CR-01 — `moveVaultItem` can produce permanently undecryptable rows

**Status:** fixed. **Commits:** `9c1fabe` (server), `435a547` (client guard in `moveVaultItem`),
`1140473` (client offer-guard in `ItemForm`).

Both halves, as required:

- **Server (the real bound):** `vault.rs::move_item` gets a new Gate 1b — `req.new_collection_id
  .is_none() && precheck_owner_user_id != source.caller_user_id → Forbidden`, checked at the
  same pre-tx point as Gate 0/1, plus a matching tx-scoped re-check for TOCTOU safety (mirrors
  Gate 0's own two-read discipline). This extends Gate 0's "owner-only re-scope" rule and Gate
  1's "owner-only item_bucket move-out" rule to the case neither covered: an ORDINARY shared
  folder, `new_collection_id: null`.
- **Wire:** a new `owned_by_caller: bool` field on `VaultItem` (server) / `owned_by_caller?:
  boolean` on `ItemRow` (client) / `ownedByMe?: boolean` on the client's `VaultItem` — populated
  `true` unconditionally in `fetch_items_for` (both arms already filter `user_id = caller`) and
  as `owner_user_id == caller_user_id` in `pull_shared_collection` (the only endpoint that
  returns another author's rows at all).
- **Client (honesty, not authorization):** `moveVaultItem` throws `NotItemOwnerError` before any
  encryption when `newCollectionId === null && existing.collectionId != null &&
  existing.ownedByMe !== true`. `ItemForm`'s destination select disables "Bez folderu" and every
  personal folder (with the reason inline) when `!ownedByMe && currentCollectionId != null`.

**Proof:** new Rust regression test
`edit_folder_member_cannot_move_owners_item_out_to_personal_scope_cr01_regression`
(`crates/pv-server/tests/collections.rs`) drives the exact attacker path (owner shares folder F
with member B at `edit`; B attempts `new_collection_id: null`) and asserts `403` +
byte-identical rollback + the real owner can still move their own item afterward. Two new
vitest tests (`moveVaultItem.real-wasm.test.ts`, real WASM) and two new ItemForm component
tests prove the client-side halves.

**Falsification (server, Gate 1b disabled via `if false &&`):**
```
thread '...cr01_regression' panicked at crates/pv-server/tests/collections.rs:3955:5:
assertion `left == right` failed: Gate 1b: an edit-level folder member must never be able to
move another author's item out to personal scope -- that re-seals it under the member's OWN
key, which the item's actual owner can never open
  left: 200
 right: 403
```
Restored → green (36/36 `collections.rs` tests pass).

**Falsification (client guard removed):**
```
CR-01: refuses (NotItemOwnerError) a move-out ... 
→ expected TypeError: Cannot read properties of unde… to be an instance of NotItemOwnerError
```
Restored → green (15/15 `moveVaultItem.real-wasm.test.ts` at the time).

**Falsification (ItemForm offer-guard removed, `personalScopeBlocked = false` / `scopeUnknown =
false`):**
```
CR-01: an item in a shared folder the caller does NOT own disables every personal-scope option...
→ expected false to be true
ME-01: an item whose current collection is NOT (yet) in useCollections()'s list renders a
disabled, honestly-labelled select...
→ expected false to be true
```
Restored → green (35/35 `ItemForm.test.tsx`).

**Judgement call, disclosed:** the review's "second variant" (B moves A's item from shared
folder F into a DIFFERENT shared folder G, both via `edit`, no ownership change) is described as
sharing CR-01's root cause but is NOT closed by Gate 1b (which only fires on a `null`
destination) or by the client offer-guard (which only blocks personal-scope options). This is a
deliberate scope decision, not an oversight: unlike the null-destination case, this variant never
produces an undecryptable row (G's members can still read it) — it is purely an *exposure/
notification* concern, and 32-CONTEXT.md's Area 2 already locks "moving an item into or out of a
shared folder is treated as an ordinary folder change... no confirmation dialog" as Bartek's
explicit decision. Extending Gate 1b to this case would re-open that locked decision, not fix a
correctness bug. Left alone.

### CR-02 — the revision conjunct is present but its premise is false

**Status:** fixed. **Commits:** `435a547` (store.ts content-match), `04973e1` (DetailPanel
retry-revision decoupling).

Two independent fixes, since the review named both a store-side premise gap and a
DetailPanel-side cause:

- **`store.ts::moveVaultItem`'s recovery** now requires a THIRD conjunct beyond destination-match
  and `revision === newRevision`: `tryDecryptFreshRowPlaintext(freshRow, uk) === plaintext` — the
  fresh row, decrypted under the exact key this attempt just used, must equal what THIS attempt
  tried to write, byte-for-byte. This is a genuine identity proof (not just "recent"), directly
  answering the review's closing line: "recovery must decline whenever the client cannot prove
  the stored ciphertext is its own."
- **`DetailPanel.tsx`** gets a new `retryFromRevision` state, separate from
  `editBaselineRevision`. The review's own suggested fix (re-baseline `editBaselineRevision` in
  `onError`) was implemented first and immediately caught a REAL regression by the pre-existing
  test "shows a revision-conflict banner and keeps the in-progress edit on RevisionConflictError"
  going red: `editBaselineRevision` also drives `ItemForm`'s `key`, so changing it in `onError`
  remounts the form and silently wipes the user's in-progress typed edit on every failed save —
  a worse bug than the one being fixed. Corrected by introducing a second state variable used
  only for the `currentRevision` prop (never the key), which advances the next attempt's revision
  prediction without ever remounting.

**Proof:** 4 new store-level tests (recovery declines on content mismatch; recovers on genuine
match) plus 1 new DetailPanel test proving both the revision-advance AND the no-remount/
content-preserved properties in one assertion sequence.

**Falsification (content-match conjunct removed):**
```
- Expected: Error { "message": "rejected promise" }
+ Received: { fields: { body: "THIS ATTEMPT's content (B) -- must never be silently eaten", ... },
              revision: 4, ... }
```
i.e. without the fix, recovery silently returns the CALLER's own submitted fields as if saved,
while the actual stored ciphertext (per the test's construction) holds a DIFFERENT prior
attempt's content — the exact "reports success over a write that didn't land" failure CR-02
describes. Restored → green.

**Falsification (DetailPanel re-baseline's first draft, reusing `editBaselineRevision`):** the
pre-existing test "shows a revision-conflict banner and keeps the in-progress edit on
RevisionConflictError" failed with `Unable to find an element by: [data-testid="item-body"]` (the
form had remounted into view mode / lost the input). This was the FIRST attempted fix, caught
immediately, and corrected before commit (see `retryFromRevision`'s doc comment). Final code
restored → green (60/60 `DetailPanel.test.tsx`).

### HI-01 — the 404 refusal is unhandled in production

**Status:** fixed. **Commits:** `435a547` (client classification), `f0603fc` (e2e test).

`store.ts::moveVaultItem` now classifies `isNotFoundError(err)` the same non-retry-inviting way
`isForbiddenError` already does for a non-null destination
(`throw new CollectionKeyUnavailableError(newCollectionId ?? "personal")`), instead of falling
through to the raw `throw err` and the generic "Please try again" banner.

**Live proof, and a real bug it caught:** the new e2e test (full `DELETE` of the destination
grant, not a `PUT` demotion) FAILED on its first live run with the generic banner instead of the
expected `error.itemMoveAccessLost`. Diagnosed via (1) a temporary Rust integration test
confirming the server correctly returns `404 {"error":"not found"}` for this exact sequence, and
(2) temporary browser console/network logging showing the client's OWN recovery re-fetch (an
unavoidable second `getCollectionSync` 404, since the owner's read access is ALSO fully gone in
this scenario) was throwing from *inside* the inner `catch` block — which unwinds the stack
immediately in JS, bypassing the `isForbiddenError`/`isNotFoundError` classification entirely.
This bug PRE-DATED this phase (present in the original code for the analogous 403 case) but was
invisible until now because SC3's demotion scenario leaves read access intact, so its recovery
probe never itself fails. Fixed in the same `435a547` commit (see that commit's "Also fixes a
REAL bug" paragraph) by leaving `freshRow` `undefined` on a probe failure and falling through to
classification naturally, instead of a second bypassing throw.

**Observed falsification output (live, before the fix):**
```
DEBUG move response 404 http://localhost:8620/api/vault/items/.../collection
DEBUG move response 404 http://localhost:8620/api/vault/collections/.../sync
DEBUG browser console pv: moveVaultItem's recovery re-fetch failed ApiClientError: not found
Error: expect(locator).toHaveText(expected) failed
Expected: "You no longer have write access to this folder. The change was not saved."
Received: "Failed to save item. Please try again."
```
**After the fix**, the full unfiltered `sharing.spec.ts` (17 tests, live, `CI=1`, fresh release
build, throwaway `PV_E2E_DB_DIR`) passes, including both the HI-01 test and SC3.

### HI-02 — silent edit loss after a partial create-then-move

**Status:** fixed. **Commit:** `1140473`.

`ItemForm.tsx`'s create-then-move dispatch now has an `else if (createdItemState !== null)`
branch: when the destination is non-collection AND an earlier attempt's create already landed,
routes through `updateVaultItem(created.id, cleaned, created.revision)` instead of falling
through to a bare `setCreatedItemState(null); onCreated();` no-op.

**Falsification (branch disabled via `if (false && createdItemState !== null)`):** the new test
timed out waiting for `mockUpdateVaultItem` to be called at all —
`waitFor(() => expect(mockUpdateVaultItem).toHaveBeenCalledTimes(1))` never resolved within the
default timeout, confirming the pre-fix code issues no write whatsoever on this path. Restored →
green.

### ME-01 — the `item_bucket` guard fails open

**Status:** fixed. **Commit:** `1140473`.

Added `scopeUnknown = currentCollectionId != null && currentCollection === undefined`, ORed into
the same locked-select branch the known-`item_bucket` case already used, with distinct copy
(`item.folderScopeUnknown` vs `item.folderLockedByFamilyShare`) so the two causes are never
conflated.

**Falsification:** see CR-01's combined falsification above (`scopeUnknown = false` made the ME-01
test fail with the identical `expected false to be true` shape).

### ME-02 — `buildUpdated` drops `lastEditorEmail`

**Status:** fixed. **Commit:** `435a547`. `buildUpdated`'s returned object now includes
`lastEditorEmail: existing?.lastEditorEmail`, matching the comment that always claimed it did.
Not independently falsified with a revert/red cycle (a one-line additive field with an obvious,
mechanical correctness argument); covered incidentally by the pre-existing store test suite
staying green with the field now populated where the comment always said it should be.

### ME-03 — the recovery re-fetch uses `listItems()`

**Status:** fixed. **Commit:** `435a547`. Non-null destinations now probe `getCollectionSync
(newCollectionId)` (every author's rows) instead of `listItems()` (caller-authored only, the
same population as CR-01's affected rows). `listItems()` remains correct for a move-out, since
Gate 1b now means only the item's owner can ever reach that branch.

**Proof:** two new tests assert `getCollectionSync`/`listItems` are called on the correct branch
and NEVER on the other (`mockGetCollectionSync`/`mockListItems` call-count assertions), plus the
CR-02 recovery tests above only succeed BECAUSE the probe can now see a foreign-authored row at
all — they would have been unwritable against the old `listItems()`-only probe (it would never
find the row, `freshRow` would always be `undefined`).

### ME-04 — SC4's negative anchor measures DOM absence

**Status:** fixed. **Commit:** `f0603fc`.

Added two assertions after the existing (correct, kept) list-removal + page-text-absence checks:
(a) `GET /api/vault/collections/{destinationId}/items` with the MEMBER's own token, asserting the
item id is absent — a server-side, not merely client-rendering, check; (b) a full
`reloadAndUnlock(member.page, ...)` followed by re-asserting the SAME positive-anchor locator
(`getByText(itemPassword, { exact: true })`) at `toHaveCount(0)` on a genuinely fresh render —
per the review's own suggested fix, "a post-reload absence cannot be explained by a stale
unmount."

**Live proof:** the full `sharing.spec.ts` run (see HI-01 above) includes SC4 with both new
assertions; passed live (4.5s→3.9s across the two runs). No revert/red cycle was performed for
this one (reverting the review's own diagnosed defect would require reproducing the OLD,
already-fixed-in-a-prior-phase code path, which does not exist in the current tree to revert to)
— the live pass is the falsification-relevant evidence: both new checks are assertions that
would fail against a build where the member retained genuine access, and they did not fail here.

**Correction (32-VERIFICATION.md F-1, gap closure):** the claim two sentences above is **false for
(b)**. The verifier independently falsified assertion (b) — reproducing SC4 up to and including
the positive anchor, skipping the move-out entirely, then running (b) verbatim — and it **passed**
even though the member's access was fully retained (a positive control in the same throwaway test
confirmed genuine access). (b) as shipped in this commit re-asserted step 3's password-TEXT
locator after reload; nothing renders that plaintext without an explicit row-click +
reveal-password click, which a bare reload never performs, so the assertion could not fail
regardless of access. Only (a) discriminated. Fixed in the gap-closure pass by replacing (b)'s
locator with a list-membership check (`item-row-{itemId}` at `toHaveCount(0)` after the reload),
which does depend on the member's fresh-fetch access and is falsification-proven — see
32-VERIFICATION.md's "Gap Closure" section for the observed red/green output.

### ME-05 — zero test coverage on `moveVaultItem`'s catch block

**Status:** fixed. **Commits:** `435a547` (store-level), `04973e1` (DetailPanel-level).

17 new tests in `moveVaultItem.real-wasm.test.ts` (recovery-on-match, decline-on-foreign-content,
decline-on-foreign-revision, rethrow-original-on-refetch-failure, 403→`NotItemOwnerError`/
`CollectionKeyUnavailableError` split, 404→`CollectionKeyUnavailableError`, 409→
`RevisionConflictError` unchanged, plus the two live-caught "probe itself also fails" shapes) and
4 in `store.test.ts` (`createVaultItem` retry recovery). One new `DetailPanel.test.tsx` test
asserts the `moveRefused` banner renders `error.itemMoveAccessLost` (previously zero coverage,
confirmed by grep before this phase — the diff that introduced the mock class added no assertion
on it) plus one for the new `notOwner` banner.

### ME-06 — `isForbiddenError`'s reachability claim is false

**Status:** fixed. **Commit:** `435a547`. The false comment ("Reachable only when
`newCollectionId !== null`") is deleted; the 403 handler now branches explicitly:
`newCollectionId === null → NotItemOwnerError`, else → `CollectionKeyUnavailableError`. This is
also CR-01's client-side classification half — the same commit closes both.

**Falsification:** reverting the split (403 always mapped to `CollectionKeyUnavailableError`,
matching the pre-fix code) made both the null-destination test AND the (separately added) 404
test fail with the exact wrong-class assertion errors:
```
ME-06/CR-01: a 403 with a NULL destination classifies as NotItemOwnerError...
→ expected CollectionKeyUnavailableError: cannot sav… to be an instance of NotItemOwnerError
HI-01: a 404 ... classifies as CollectionKeyUnavailableError...
→ expected Error: not found { status: 404 } to be an instance of CollectionKeyUnavailableError
```
Restored → green.

### ME-07 — a lost `createVaultItem` response still duplicates the item

**Status:** fixed. **Commit:** `435a547` (store.ts), `1140473` (ItemForm.tsx caller).

`createVaultItem` accepts an optional `presetId`; `ItemForm` mints the id ONCE per submission
attempt (`pendingCreateIdRef`, a `ref` so it survives a re-render-triggering retry without
resetting) and passes it on every call, including retries. A resulting 409 (`ON CONFLICT DO
NOTHING`) is recovered by decrypting the existing row under the same key/AAD this attempt just
used and confirming the plaintext genuinely matches — never treated as recovered on a mismatch
(the same discipline as CR-02's `tryDecryptFreshRowPlaintext`).

**Falsification (recovery removed, `throw err` unconditional on 409):**
```
ApiClientError: item id already exists
❯ src/lib/vault/store.test.ts:363:38
```
Restored → green (75/75 `store.test.ts`).

### LO-01 — empty `<optgroup>` for personal folders

**Status:** fixed. **Commit:** `1140473`. `folderOptions.length > 0` now guards the "Moje foldery"
optgroup, mirroring the shared optgroup's existing guard. The pre-existing W-3 test (zero shared
collections → no shared optgroup) was given a real personal folder so its own assertion stays
isolated to the shared-optgroup claim it was written to prove, and a new dedicated LO-01 test
covers the personal-optgroup-absent case directly.

### LO-02 — `isShared` stays stale-`true` after a move-out

**Status:** fixed. **Commit:** `435a547`. `buildUpdated`'s `isShared` is now unconditionally
`false` on a move-out (`newCollectionId === null`), never carried forward from `existing`. Errs
toward under-reporting exposure for at most one snapshot interval — the opposite, safer direction
from the stale-`true` badge the review flagged.

### LO-03 — `accessLevel: undefined` reads as ownership for a collection item

**Status:** fixed. **Commit:** `79f78e8`. `canEditItem` now treats `accessLevel === undefined` as
"owns outright" only when `collectionId == null`; for any collection-scoped item it fails closed.
Two pre-existing test fixtures (`ItemContextMenu.test.tsx`, and one added mid-phase to
`DetailPanel.test.tsx` for an unrelated ME-06 test) needed `accessLevel: "edit"` added explicitly
— they always meant to represent a real, resolved edit grant and were incidentally relying on the
undefined-means-owner fallback this fix closes.

### LO-04 — non-discriminating test assertions and duplicated lookups

**Status:** partially fixed, two sub-items skipped with reason.

- **Fixed** (`store.ts:1201-1202`, commit `435a547`): `buildUpdated`'s `existingIndex`/ternary
  duplicate lookup replaced with a direct `items.find(...)`, matching `updateVaultItem`'s own
  simpler shape.
- **Fixed** (`ItemForm.tsx:462`, commit `1140473`): hoisted `const createdId = created.id`
  before the retry's try/catch, removing the `created!` non-null assertion the closure needed.
- **Skipped** (`ItemForm.test.tsx:664`, `:670` at review time — the `.not.toContain("item.
  noFolder")` redundant-with-the-preceding-`toBe` assertion, and the `fireEvent.change` on a
  disabled single-option select that cannot actually drive the "no side effect" claim in jsdom):
  low value (both are pre-existing, already-passing assertions in a test unrelated to this
  phase's own changes; the `select.disabled` assertion immediately above each is the one that
  actually proves the point) and touching them risks running afoul of the "no test deleted or
  weakened" non-negotiable for a cosmetic cleanup with no coverage gain. Left alone.

### LO-05 — the recovery re-fetch's failure is swallowed with no diagnostic

**Status:** fixed. **Commit:** `435a547`. `console.error("pv: moveVaultItem's recovery re-fetch
failed", refetchErr)` added, matching every other post-commit failure in this file. Directly
useful during HI-01's own live debugging session (see HI-01 above) — this log line is what
confirmed the recovery probe was the thing throwing, not the move itself.

---

## CI-width verification (final, after all fixes)

| Check | Command | Result |
|---|---|---|
| Rust workspace tests | `cargo test --workspace --no-fail-fast` | **exit 0** — 31 test binaries, 0 failed (includes 36/36 `collections.rs`, the new CR-01 regression among them) |
| Clippy gate (SC5/DEBT-04) | `cargo clippy --workspace --all-targets -- -D warnings` | **exit 0** — no warnings |
| Web build | `cd web && npm run build` | **exit 0** |
| Web typecheck | `cd web && npm run compile` | **exit 0** |
| Web unit/component tests | `cd web && npm test` | **exit 0** — 93 files, 1047 tests, 0 failed |
| Playwright, unfiltered | `CI=1 npx playwright test e2e/sharing.spec.ts` | **exit 0** — 17/17, live, fresh release build, throwaway `PV_E2E_DB_DIR` |

Live runs used a genuinely fresh `cargo build --release -p pv-server` triggered by Playwright's
own `webServer` command (forced by `CI=1` disabling `reuseExistingServer`), port 8620 confirmed
free before each run, and the standing `PV_E2E_DB_DIR` mechanism (a fresh `mkdtempSync` directory
per run, torn down by `globalTeardown`) — no shared or persistent `data/pv.db` was ever touched,
which is the stricter property the "checksum before/after" instruction was reaching for.

## Things not closed

- **CR-01's "second variant"** (move between two shared folders, no ownership check) — deliberately
  left open; see CR-01's own disposition entry above for why re-opening it would contradict a
  locked 32-CONTEXT.md decision rather than fix a bug.
- **LO-04's two test-assertion-quality nits** — deliberately skipped; see LO-04's own entry.
- **`ItemForm`'s create-mode `moveErr instanceof CollectionKeyUnavailableError` routing** (added
  in the `1140473` commit, bundled with HI-02 since it touches the exact same lines): this closes
  the identical retry-lie shape HI-01 closes, but for the create-then-move path specifically —
  beyond the review's literal HI-01 text, disclosed here since it was not a named finding.

_Reviewed: 2026-08-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
