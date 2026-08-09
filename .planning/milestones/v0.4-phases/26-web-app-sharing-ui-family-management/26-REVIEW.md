---
phase: 26-web-app-sharing-ui-family-management
reviewed: 2026-08-06T00:00:00Z
depth: standard
files_reviewed: 39
files_reviewed_list:
  - crates/pv-core/src/items.rs
  - crates/pv-server/src/routes/collections.rs
  - crates/pv-server/src/routes/folders.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/sync.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/tests/collections.rs
  - crates/pv-server/tests/sync_shared.rs
  - crates/pv-server/tests/vault.rs
  - crates/pv-wasm/src/lib.rs
  - packages/pv-ui/identity/fingerprint.ts
  - packages/pv-ui/identity/fingerprintWordlist.ts
  - packages/pv-ui/vault/types.ts
  - web/e2e/invite-flow.spec.ts
  - web/e2e/shared-sync.spec.ts
  - web/e2e/sharing.spec.ts
  - web/src/components/auth/RegisterForm.tsx
  - web/src/components/auth/UnlockOverlay.tsx
  - web/src/components/settings/FamilyTab.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/vault/AvatarStack.tsx
  - web/src/components/vault/CollectionPicker.tsx
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/ItemContextMenu.tsx
  - web/src/components/vault/ItemRow.tsx
  - web/src/components/vault/ShareDialog.tsx
  - web/src/components/vault/ShareDialog.real-wasm.test.ts
  - web/src/components/vault/SharingOverviewPanel.tsx
  - web/src/lib/auth/api.ts
  - web/src/lib/crypto/index.ts
  - web/src/lib/families/accessLevel.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/identity/publishOnUnlock.ts
  - web/src/lib/identity/publishOnUnlock.real-wasm.test.ts
  - web/src/lib/passkeys/login.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/collections.ts
  - web/src/lib/vault/shareRecipients.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/store.real-wasm.test.ts
findings:
  critical: 2
  warning: 16
  info: 7
  total: 25
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-08-06
**Depth:** standard
**Files Reviewed:** 39 (of 69 changed; planning artifacts, lockfiles and pure-test files reviewed only for integrity signals)
**Status:** issues_found

## Summary

Phase 26 wires the client half of sharing: client-minted collection/folder ids (A-1/WR-09),
`collection_id` on the item wire row, two new pv-core/pv-wasm sharing primitives, three merged item
sources in `store.ts`, and the whole authoring/disclosure UI surface.

**The dangerous direction is clean.** I traced every new/changed server read path and found no
over-sharing:

- `pull_shared_direct` (`sync.rs:378-392`) filters on `item_shares.recipient_user_id = session.user_id`
  and pins the recipient's `family_members` row to the *item owner's* family with `fm.status =
  'active'`. It returns exactly the caller's own `item_shares.sealed_key` — never another
  recipient's — and deliberately drops the owner's `enc_key`, which is structurally useless to the
  recipient. A suspended member is cut off; a member of a different family cannot match `fm_o`.
- `pull_shared_collection` is `Membership<Collection, RequireRead>`-gated, and `collection_id` is
  filled from `membership.resource_id`, never from a second query.
- `list_item_shares` (`vault.rs:1273-1286`) is `Membership<Item, RequireRead>`; a stranger gets 404
  from `Item::resolve_access` resolving to `None`, never a 403 that would confirm existence
  (`vault.rs` test `list_item_shares_for_non_member_is_404`). The response's field set is asserted
  closed and `sealed_key`-free by an explicit key-list assertion.
- `fetch_items_for` is genuinely SELECT-list-only widened. I verified empirically with the real
  `sqlite3` binary that SQLite resolves the bare `collection_id` in arm 1's `WHERE`/`is_shared`
  expressions to the *table column*, not to the new `NULL AS collection_id` result alias — so the
  additive change cannot silently disable arm 1's `collection_id IS NULL` predicate.

**Zero-knowledge boundary is clean.** `unwrap_item_key_for_sharing` / `decrypt_item_payload_with_shared_key`
compose `aead_open` + the existing `build_item_aad` prefixes with no new construction, return
`Zeroizing<...>`, and zeroize the intermediate buffer on the length-mismatch path. The WASM exports
never hand raw key bytes across the JS boundary (`sealItemKeyForRecipient` returns a sealed blob;
`decryptItemWithSharedKey` returns plaintext, and `std::mem::take`s the `Zeroizing` buffer so the
drop still zeroizes). No secret material reaches any error string.

**Test integrity is good.** No `vi.mock("@/lib/crypto")` in any `*.real-wasm.test.ts`; the real-WASM
store tests decrypt genuine ciphertext rather than asserting "the mock was called". The e2e specs
contain no `skip`/`only`/`fixme` and use count-agnostic `toHaveCount(0)` absence assertions.

**What is not clean is the client.** Two Critical findings: `ShareDialog`'s multi-recipient loops
leave *unrecoverable* partial server state while telling the user the operation failed (there is no
revoke/delete client wrapper anywhere in `web/src`, and a retry 409s or duplicates), and the Sharing
overview — the phase's headline "what am I exposing right now?" screen — counts items shared *to*
the caller as items the caller is sharing, because 26-14 merged `directSharedItems` into `items`
with `isShared: true` and no ownership discriminant. WINDOWS #11 is confirmed still live in five
call sites, and `#10`'s `tags` fix does not cover them (locally-constructed fields never pass
through `normalizeItemFields`).

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `ShareDialog`'s partial failure is unrecoverable and is reported as total failure

**File:** `web/src/components/vault/ShareDialog.tsx:166-177`, `:337-359`, `:404-434`

**Issue:** Both variants POST one request per recipient inside a bare `for` loop with no
per-recipient outcome tracking. `handleSubmit`'s single `catch` (`:429-433`) then renders
`share.createFailed` ("Couldn't share. Try again.") for *any* throw — including one that occurs
after N-1 grants already committed server-side.

Retrying is not idempotent, and there is no repair path:

- Item variant: `create_share` returns `ApiError::Conflict` (409) on a duplicate
  `(item_id, recipient_user_id)` (`vault.rs:1385-1388`). A retry with the same selection 409s on the
  *already-granted* recipient and aborts before ever reaching the one that failed. The user can
  never complete the share through the UI.
- Folder variant: `newCollectionId = crypto.randomUUID()` is minted fresh per submit (`:321`), so
  each retry creates an *additional* orphaned collection, plus whatever member grants land before the
  next failure.
- `grep` confirms there is no client wrapper for `DELETE /api/vault/items/{id}/shares/{user_id}` or
  for any collection-delete/revoke endpoint anywhere in `web/src` — nothing in the shipped UI can
  undo either outcome.

This is the same class as WINDOWS #11 (failure reported over a committed server mutation) but with a
worse tail: the state is durable and the copy actively invites the retry that makes it worse.

**Fix:** Track per-recipient outcome and report honestly; treat 409 as already-granted, not as
failure. Mint the collection id once per dialog session, not per submit.

```ts
// shareItemWithRecipients
const failed: string[] = [];
for (const recipient of recipients) {
  let pk: WasmIdentityPublicKey | undefined;
  try {
    pk = WasmIdentityPublicKey.fromBytes(base64Decode(recipient.public_key as string));
    await createItemShare(itemId, recipient.user_id, sealItemKeyForRecipient(uk, encKeyJson, itemId, pk), accessLevel);
  } catch (err) {
    // 409 == this recipient already holds this exact grant: not a failure to report.
    if (!isConflictError(err)) failed.push(recipient.email);
  } finally {
    pk?.free?.();
  }
}
return failed; // handleSubmit renders a per-recipient partial-success message
```

For `submitFolderVariant`, hoist `newCollectionId` into a `useRef`/state so a retry reuses the
already-created collection (whose `create` already maps a colliding id to a clean 409), and apply the
same per-recipient accounting to `addCollectionMember`.

---

### CR-02: The Sharing overview reports items shared *to* the caller as items the caller is sharing

**File:** `web/src/components/vault/SharingOverviewPanel.tsx:172-179`, `:208-219`;
`web/src/lib/vault/store.ts:213-221`, `:566-585`

**Issue:** 26-14 merged `directSharedItems` (personal items owned by *someone else*, shared to this
caller) into the public `items` view. `decryptDirectSharedRow` sets `isShared: row.is_shared`
(server-side unconditionally `true`, `sync.rs:407`) and `collectionId: null`, and the `VaultItem`
shape carries no owner/ownership discriminant at all.

`SharingOverviewPanel` selects its direct-share set with exactly that predicate:

```ts
const directItems = items.filter(
  (item) => item.isShared === true && (item.collectionId === null || item.collectionId === undefined),
);
```

So every item someone else shared with the caller is listed under "What you're sharing", and each one
triggers `listItemShares(item.id)` whose *other* recipients are then attributed to the caller in the
"By person" tab — the panel tells the user "you are sharing X with Y" when in fact a third party is.
Neither entry has any revoke path, because the caller is not the owner.

This is a correctness defect in the one screen D-1 exists to provide, in a product whose stated
posture is disclosure honesty. It is the inverse of a leak (it over-reports), but a security overview
the user learns to distrust is worse than none.

The same conflation reaches `ItemRow`/`DetailPanel` (`item.isShared === true → <AvatarStack item={item} />`),
where a received item renders a recipient stack identical to an outgoing share, and reaches
`ItemContextMenu`/`DetailPanel`'s Share affordance — clicking it on a received item runs
`submitItemVariant`, whose `listItems()` lookup cannot find the row and throws into the generic
`share.createFailed`.

**Fix:** Give the store an explicit ownership discriminant rather than inferring it from
`isShared`/`collectionId`:

```ts
// types.ts
sharedToMe?: boolean; // true only for rows sourced from pull_shared_direct

// store.ts::decryptDirectSharedRow
return { ..., collectionId: null, sharedToMe: true };
```

Then filter in the overview (`item.sharedToMe !== true && item.isShared === true && !item.collectionId`),
and suppress the Share entry point + swap the avatar-stack treatment for a "shared with you by …"
marker in `ItemRow`/`DetailPanel`/`ItemContextMenu`. `DirectShareNotEditableError` already proves the
store *can* distinguish these rows — the UI just isn't told.

## Warnings

### WR-01: Unhandled promise rejection on every unlock of a solo (no-family) vault

**File:** `web/src/lib/vault/collections.ts:192-200`

**Issue:** `subscribeLockState(() => { if (isUnlocked()) { void refreshCollections(); } ... })`.
`refreshCollections` awaits `listCollections()`, which hits `collections::list` — gated by
`FamilyMembership<RequireRead>`, i.e. **404 for any user with no `family_members` row**. That is the
product's primary persona (solo self-hoster). Every unlock therefore produces an unhandled rejection.
`refreshCollectionsNow`'s own doc comment even states the function does not swallow errors, and
`store.ts::refreshSharedItemsNow` (`store.ts:1000-1011`) wraps the identical "expected 404 for a
single-user vault" case in `try/catch` for exactly this reason — this call site was missed.

**Fix:**

```ts
if (isUnlocked()) {
  void refreshCollections().catch(() => {
    // Expected for a single-user vault (no family_members row) and for any
    // transient failure — the next unlock / onSharedRevisions tick retries.
  });
}
```

### WR-02: Collection Key handles for revoked collections are never freed or evicted

**File:** `web/src/lib/vault/collections.ts:89-156`, `:74-79`

**Issue:** `refreshCollections` rebuilds `collections` wholesale but only ever writes *into*
`collectionKeys`; it never removes an entry for a collection the server no longer returns. When
access is revoked (`handleSharedRevisions` explicitly purges `collectionSharedItems` for exactly this
case, `store.ts:943-949`), the unwrapped `WasmCollectionKey` for that collection stays in the map and
`getCollectionKey(id)` keeps returning it until lock. That is both an unfreed WASM handle holding
live key material (the WR-07 hazard class this module's own header claims to guard) and a stale
capability: any code path that still holds a row for that collection can decrypt it.

**Fix:** Diff the key cache against the new row set inside `refreshCollections`:

```ts
const liveIds = new Set(rows.map((r) => r.id));
for (const [id, ck] of Array.from(collectionKeys.entries())) {
  if (!liveIds.has(id)) { ck.free?.(); collectionKeys.delete(id); }
}
```

### WR-03: The avatar stack counts the caller as one of the recipients

**File:** `web/src/lib/vault/shareRecipients.ts:32-34`, `:39-67`

**Issue:** `toRecipients` maps `getCollectionAccessList` / `listItemShares` entries straight through
with no self filter. Both endpoints include the caller's own row (the creator's `collection_keys`
row is hard-coded `edit` server-side; a recipient listing an item shared to them sees themselves).
So an item in a shared folder renders the caller's own initial in the stack and
`sharing.sharedWithLabel` reports `n+1`. `SharingOverviewPanel` filters `entry.user_id !== selfId`
(`:183`, `:198`) — proving the phase knows the filter is required — but the shared hook that
`ItemRow`/`DetailPanel` both use does not.

**Fix:** Resolve the caller's id once (`me()`, cached at module level like the two existing caches)
and drop `entry.user_id === selfId` inside `toRecipients`.

### WR-04: The hidden-password inline note can render with no subject; UI-SPEC's required fallback is unimplemented

**File:** `web/src/components/vault/ShareDialog.tsx:578-587`; `web/src/lib/i18n/dictionary.ts` (missing key)

**Issue:** 26-UI-SPEC.md:169 specifies `share.hiddenPasswordInlineNote` interpolates
"`{recipient}` (the selected member's email, or a generic PL `odbiorca`/EN `the recipient` when no
single recipient is yet selected)". The implementation interpolates
`recipients.filter(selected).map(email).join(", ")` with no fallback, and the note is rendered as
soon as `accessLevel === "hidden_password"` — before any recipient is selected. With zero selections
the phase's most load-bearing honesty string renders as:

> "Hidden in the interface only —  still has key access."

and with several selections it renders "a@x, b@y **still has key access**". No generic-fallback key
exists in the dictionary at all, so the contract row was skipped rather than deviated-from-with-cause.
The note's *content* is honest (this is not a softening), but a security disclosure that renders
subject-less is not doing its job — and per D-2 this note is all most users ever see after the
first use.

**Fix:** Add `share.hiddenPasswordRecipientFallback` (`pl: "odbiorca"`, `en: "the recipient"`) and use
it when the selection is empty; use it (or a count form) when the selection is not exactly one.

### WR-05: A seed-move partial failure is reported with the "couldn't share" copy over a share that succeeded

**File:** `web/src/components/vault/ShareDialog.tsx:594-598`

**Issue:** When `submitFolderVariant` returns `failures > 0`, the folder and every member grant have
genuinely committed (`:418-425`'s own comment says so) — yet the inline report renders
`t("share.createFailed")`: *"Couldn't share. Try again."* The user is told the operation failed and
invited to retry, which (per CR-01) creates a second collection. The failure count itself is never
shown, so the user cannot tell which items did not move.

**Fix:** Add a dedicated key, e.g.
`share.seedMoveFailed` = pl `Folder został udostępniony, ale {count} elem. nie udało się przenieść.` /
en `The folder was shared, but {count} items couldn't be moved.`, and interpolate `seedMoveFailureCount`.

### WR-06: `handleSharedRevisions` advances the outer watermark even when a sub-pull failed, so nothing retries

**File:** `web/src/lib/vault/store.ts:951-991`

**Issue:** Each inner pull swallows its error with the comment *"Transient — next tick retries (this
collection's own watermark is untouched on failure, so it stays 'needs a pull' until it succeeds)."*
That is not what the code does. `sharedRevisionsWatermark` is reassigned **unconditionally** at
`:987-990` from the incoming payload. On the next tick `sharedRevisionsChanged()` compares the same
payload against that watermark, returns `false`, and `handleSharedRevisions` returns at `:923` before
any per-collection watermark is ever consulted. The failed collection is therefore *not* retried
until some unrelated revision moves (or the user re-unlocks) — so a single dropped request on the
eager post-unlock `refreshSharedItemsNow()` leaves the recipient's shared items invisible for the
rest of the session. That is the exact user-visible symptom WINDOWS #8/#9 were opened for.

The same applies to the `refreshCollectionsNow()` failure at `:930-935`.

**Fix:** Track whether any step failed and withhold the outer watermark:

```ts
let anyStepFailed = false;
// ... set anyStepFailed = true in each catch ...
if (!anyStepFailed) {
  sharedRevisionsWatermark = { collections: new Map(...), direct: revisions.direct.revision };
}
```

(and adopt `applySyncSnapshot`'s bounded `MAX_FAILED_MERGE_RETRIES` escape hatch so a permanent
failure doesn't become a permanent poll loop.)

### WR-07: Shared-item decrypt failures record the watermark anyway, unlike the personal path

**File:** `web/src/lib/vault/store.ts:536-556`, `:608-627`

**Issue:** `applySyncSnapshot` deliberately withholds `lastKnownRevision` when any row fails to
decrypt (CR-03/WR-01 from earlier iterations, documented at length at `:460-484`). Neither
`mergeCollectionSnapshot` nor `mergeDirectSnapshot` carries that discipline: both `flatMap` over a
`try/catch` that drops a row with no previous copy, then unconditionally record
`collectionRevisionWatermark.set(...)` / `directRevisionWatermark = ...`. A shared item that fails to
decrypt transiently (e.g. the collection key was cached a moment later, or a keypair round trip lost a
race) simply disappears from the list and is never re-fetched until that collection's revision moves
again. The retry contract the personal path fought two review iterations to establish was not carried
across to the two new paths.

**Fix:** Mirror `applySyncSnapshot`: track `anyRowFailed` per merge and skip the watermark write when
set, with the same bounded-retry escape.

### WR-08: WINDOWS #11 is still live in five call sites, and #10's `tags` fix does not cover them

**File:** `web/src/lib/vault/store.ts:642-649`, `:745-797`, `:803-806`, `:670-674`, `:679-683`;
`web/src/lib/vault/store.ts:296-304`

**Issue:** The task brief asked for an assessment, so: the hazard is unmitigated and has grown.
Every one of `createVaultItem`, `updateVaultItem`, `deleteVaultItem`, `createVaultFolder`,
`deleteVaultFolder` performs its local bookkeeping *after* the awaited API call, so any throw from
that bookkeeping rejects the promise and the UI reports failure over a committed server write.
`recomputeItems()` → `recomputeAllTags()` still does an unguarded `for (const tag of item.fields.tags)`.

Critically, `withCommonFieldInvariants` (`packages/pv-ui/vault/types.ts:265-296`) closes the hole only
for **server-decrypted** plaintext — its own doc comment says so ("`store.ts`'s `applySyncSnapshot`
flatMap is the ONLY writer of server-decrypted plaintext into the item store"). But
`createVaultItem(fields)` and `updateVaultItem(id, fields, …)` push the **caller-supplied** `fields`
object into the store verbatim, never through `normalizeItemFields`. A `tags`-less `ItemFields` from
any current or future caller (extension, a form regression, a future item type) reproduces WINDOWS
#10's exact wedge — including the "delete also throws, so there is no way to remove the offending
item" tail.

`replaceItemInSources` (`:234-249`) also widens the blast radius: it now rebuilds three arrays and
recomputes tags across the merged view on every update/touch.

**Fix:** Two independent changes, both cheap:

1. Make the post-await bookkeeping non-throwing at the boundary:
   ```ts
   const created = await createItem(id, encKey, encData);
   const item = { id, revision: 1, fields, updatedAt: created.updated_at };
   try { personalItems = [...personalItems, item]; recomputeItems(); }
   catch (err) { console.error("pv: post-commit store bookkeeping failed", err); }
   return item; // the server write DID succeed — never report failure
   ```
2. Harden the iteration itself: `for (const tag of item.fields.tags ?? [])` in `recomputeAllTags`,
   and run `normalizeItemFields` over caller-supplied `fields` in `createVaultItem`/`updateVaultItem`
   so the store's invariant holds for *every* writer, not just the decrypt path.

### WR-09: A malformed server-supplied fingerprint crashes the entire Family settings tab

**File:** `web/src/components/settings/FamilyTab.tsx:734`;
`packages/pv-ui/identity/fingerprint.ts:67-90`

**Issue:** `formatFingerprintWords` fails closed by **throwing** on anything that isn't exactly 64 hex
characters — correct for the primitive. But `renderFingerprintPanel` calls it directly inside the
render path (`const words = formatFingerprintWords(fingerprint);`) with only a `fingerprint === null`
guard. In a zero-knowledge product the server is explicitly untrusted; a malicious or buggy server
that returns `""`, `"deadbeef"`, or a 63-char string for any member's `fingerprint` throws during
render and takes down the whole `FamilyTab` (and with it the removal/suspension/invite UI). `""` is
particularly reachable: `?? null` does not normalize an empty string.

**Fix:** Catch at the render boundary and degrade to the honest unavailable copy:

```ts
let words: string | null = null;
try { words = formatFingerprintWords(fingerprint); } catch { words = null; }
if (words === null) {
  return <p data-testid={testId("unavailable")} …>{t("identity.fingerprintUnavailable")}</p>;
}
```

(Consider a distinct "this fingerprint is malformed — do not trust it" string rather than reusing the
benign not-yet-published copy, since a malformed value is a *signal*, not an absence.)

### WR-10: `accessLevelKey`'s doc comment is self-contradictory and instructs the reader to reintroduce the bug it fixed

**File:** `web/src/lib/families/accessLevel.ts:20-28`

**Issue:** The comment opens by explaining that falling back to `access.readOnly` — "the LEAST
privileged, most reassuring label" — was the WR-13 bug, then closes with: *"An unrecognized value
MUST render as the LEAST privileged label, never the most — getting this backwards in a security UI
tells the user an item is less exposed than it actually is."* Those two halves contradict each other,
and the closing sentence contradicts the code (which returns `access.unknown`). A future maintainer
following the stated MUST would re-add the exact fallback the module exists to remove. In the file
this phase designates as the single shared access-level vocabulary, that is not a nit.

**Fix:** Replace the final sentence with: *"An unrecognized value must never render as a valid access
label at all — least of all the LEAST privileged one, which would tell the user an item is less
exposed than it actually is."*

### WR-11: `handleSharedRevisions` has no re-entrancy guard

**File:** `web/src/lib/vault/store.ts:922-991`, `:1029`

**Issue:** `onSharedRevisions` is fired by both the WS event path and the 30s poll and is explicitly
never awaited by `sync.ts::pullOnce` (documented at `:1021-1028`). The function is a long
`await`-chain that mutates module-level state (`collectionRevisionWatermark`, `collectionSharedItems`,
`directRevisionWatermark`, `directSharedItems`, `sharedRevisionsWatermark`). Two overlapping
invocations interleave: run A can purge a collection between run B's fetch and its
`mergeCollectionSnapshot`, and both write `sharedRevisionsWatermark` at the end (last writer wins,
possibly with the older payload). A burst of WS events also fans out into duplicated
`refreshCollectionsNow` + per-collection fetch storms.

**Fix:** Serialize with a module-level in-flight promise:

```ts
let sharedRefreshInFlight: Promise<void> | null = null;
function handleSharedRevisions(revisions: SharedRevisions): Promise<void> {
  sharedRefreshInFlight = (sharedRefreshInFlight ?? Promise.resolve())
    .then(() => doHandleSharedRevisions(revisions))
    .catch(() => {});
  return sharedRefreshInFlight;
}
```

### WR-12: The shared-recipient cache is never cleared on lock

**File:** `web/src/lib/vault/shareRecipients.ts:36-37`

**Issue:** `collectionCache` / `itemCache` are module-level `Map`s holding co-recipient **email
addresses**, keyed by collection/item id. Nothing clears them on lock. Every other in-memory store in
this codebase (`store.ts:1040-1052`, `collections.ts:195-199`, `lib/crypto`'s key singleton) clears on
lock precisely so nothing survives the event; this one silently keeps a roster of who shares what
until the tab is closed. It is metadata rather than plaintext, but it is exactly the metadata a
locked vault should not still be holding — and on re-unlock as a different account it is also stale
by construction.

**Fix:** Export a `clearShareRecipientCaches()` and call it from a `subscribeLockState` listener in
this module, mirroring `collections.ts`'s own lock listener.

### WR-13: `SharingOverviewPanel` re-runs its full N+1 aggregation (and flashes the spinner) on every unrelated store mutation

**File:** `web/src/components/vault/SharingOverviewPanel.tsx:138-242`

**Issue:** The effect's dependency array is `[collections, items]` — array *identities* from
`useSyncExternalStore`. `items` is reassigned by `recomputeItems()` on every create/update/delete/
touch and on every sync merge. Each re-run calls `setLoading(true)` first, so the panel replaces its
content with a spinner and re-issues `me()` + `listCollections()` + one `getCollectionAccessList` per
editable collection + one `listItemShares` per shared item — while the user is reading it. A
background `touchVaultItem` (fired on every copy/reveal) is enough to trigger it.

**Fix:** Depend on stable derived keys rather than array identity, and only show the spinner on the
first load:

```ts
const collectionsKey = collections.map((c) => c.id).join(",");
const directItemsKey = items.filter(isDirectShared).map((i) => i.id).join(",");
useEffect(() => { … }, [collectionsKey, directItemsKey]);
```

### WR-14: `ShareDialog` offers the caller themselves as a share recipient when `me()` fails

**File:** `web/src/components/vault/ShareDialog.tsx:216-221`

**Issue:** `me()` is deliberately soft-failed (`.catch(() => null)`), then
`members.filter((m) => m.user_id !== account?.user_id)` compares against `undefined`, so **no one is
filtered out** and the caller appears in their own recipient list. The same `account === null` state
also makes the one-time hidden-password acknowledgment un-persistable (`:251`, `:259-265`), so the
blocking modal reappears on every selection forever.

**Fix:** Treat a failed `me()` as a hard failure for this dialog (it is a prerequisite, not an
optional enrichment): show `share.createFailed` and disable submit, or retry once before falling
back. At minimum, filter on a resolved id only: `if (account === null) { setRecipients([]); … }`.

### WR-15: `ensureOwnIdentityKeypair` uses the User Key across two awaits without re-validating it

**File:** `web/src/lib/identity/ensure.ts:25-66`; callers
`web/src/lib/identity/publishOnUnlock.ts:42-52`, `web/src/lib/vault/collections.ts:103`,
`web/src/lib/vault/store.ts:600`

**Issue:** `uk` is dereferenced at `:28` (after `await getIdentityKeypair()`) and at `:56` (after
`await putIdentityKeypair(...)`). `lockVault()` frees the current `WasmUserKey`
(`lib/crypto/index.ts:184`). Phase 26 newly calls this on **every unlock path** via
`publishOnUnlock`, so an unlock immediately followed by a lock/autolock (or a slow network) now
routinely dereferences a freed handle. wasm-bindgen turns that into a thrown "null pointer passed to
Rust", which `publishOnUnlock`'s `.catch()` swallows entirely and `collections.ts` turns into WR-01's
unhandled rejection. `collections.ts:96` and `store.ts:605` re-check `getUnlockedUserKey() === null`
but not `!== uk`, so a lock-then-unlock cycle passes the guard while `uk` is stale.

**Fix:** Re-check identity, not just nullity, after each await in the callers, and pass the check
into `ensure.ts`:

```ts
if (getUnlockedUserKey() !== uk) return; // vault locked (or re-unlocked) mid-flight
```

### WR-16: `list_item_shares` / `access_list` join `family_members` without scoping `family_id`

**File:** `crates/pv-server/src/routes/vault.rs:1273-1286`;
`crates/pv-server/src/routes/collections.rs:614-624`

**Issue:** Both new `JOIN family_members fm ON fm.user_id = <recipient>` clauses are unscoped. This is
correct *only* because `idx_families_singleton` (`0014_family_sharing.sql:44`) enforces exactly one
family per instance; `family_members`' PK is `(family_id, user_id)`, so the moment multi-family lands
each recipient produces one duplicated row per membership, and `(fm.status = 'suspended')` becomes
non-deterministic across those rows. The sibling `pull_shared_direct` query does it correctly, pinning
through the owner's family (`fm.family_id = fm_o.family_id`, `sync.rs:383-386`) — the two new listing
queries did not adopt that shape.

**Fix:** Scope both joins through the resource's family, e.g. for `list_item_shares`:

```sql
JOIN family_members fm_o ON fm_o.user_id = (SELECT user_id FROM vault_items WHERE id = ?)
JOIN family_members fm   ON fm.family_id = fm_o.family_id AND fm.user_id = s.recipient_user_id
```

## Info

### IN-01: The UUID-shape validator is duplicated byte-for-byte across two modules

**File:** `crates/pv-server/src/routes/collections.rs:69-88`, `crates/pv-server/src/routes/folders.rs:51-67`
**Issue:** `validate_collection_id_shape` and `validate_folder_id_shape` are identical; the folder
copy's own comment acknowledges the duplication. Neither actually validates *v4* (version/variant
nibbles) despite both the doc comment and the error string saying "UUID-v4".
**Fix:** Either move one `validate_uuid_v4_shape` into a shared `routes/validate.rs` alongside
`validate_blob_len`, or correct both messages to say "36-character hyphenated hex id".

### IN-02: `POST /api/vault/folders` is a cross-user existence oracle for folder ids

**File:** `crates/pv-server/src/routes/folders.rs:76-88`
**Issue:** `folders.id` is a global primary key, and the new `ON CONFLICT(id) DO NOTHING` path returns
409 whether the colliding row belongs to the caller or to a *different* user. A caller can therefore
distinguish "this folder id exists somewhere on this instance" from "it does not". Practically
irrelevant against v4 UUIDs, but the collection sibling has the same shape with a family-wide
namespace.
**Fix:** Scope the conflict check to the owner — `WHERE NOT EXISTS (SELECT 1 FROM folders WHERE id = ? AND user_id = ?)`
— or return 409 only when the existing row's `user_id` matches the caller, and 500/regenerate
otherwise.

### IN-03: `sharing.sharedWithLabel`'s English string has no noun

**File:** `web/src/lib/i18n/dictionary.ts` (`"sharing.sharedWithLabel"`)
**Issue:** `en: "Shared with {count}"` renders as "Shared with 3" — three what? The Polish form
("Udostępniono {count} os.") carries the noun. The string is also the prefix of `AvatarStack`'s
single `aria-label` (`AvatarStack.tsx:41-44`), so a screen reader announces "Shared with 3:
a@x, b@y, c@z".
**Fix:** `en: "Shared with {count} people"` (or reuse the abbreviation convention the Polish form
already uses).

### IN-04: An uncached collection renders the shared-folder note with an empty folder name

**File:** `web/src/components/vault/DetailPanel.tsx:117-120`, `web/src/components/vault/ItemContextMenu.tsx:100-103`
**Issue:** `collections.find(...)?.name ?? ""` produces
`This item is part of the shared folder "" — manage access at the folder level.` whenever the
collections store has not refreshed yet (or the caller's `sealed_key` failed to unseal, in which case
`collections.ts` stores the raw id as the name anyway).
**Fix:** Fall back to the collection id (matching `collections.ts`'s own honest-fallback convention)
rather than an empty string.

### IN-05: `CollectionKeyUnavailableError` and `DirectShareNotEditableError` surface only as the generic save-error banner

**File:** `web/src/components/vault/DetailPanel.tsx:441-466`
**Issue:** Both errors carry a specific, actionable message ("wait a moment and try again", "editing a
directly-shared item is not supported yet"), but `DetailPanel` branches only on
`RevisionConflictError` and otherwise sets a boolean `saveError`, rendering one fixed string. They are
not swallowed — but the user cannot tell a transient key-cache miss from an unsupported operation.
**Fix:** Add two `instanceof` branches with dedicated dictionary keys, mirroring the existing conflict
branch.

### IN-06: Playwright still runs with `retries: 2` against a shared DB and a singleton account

**File:** `web/playwright.config.ts:104`
**Issue:** 26-CONTEXT.md's "E2E hazard" explicitly assigned this phase either fixture isolation or
count-agnostic assertions. The assertions *are* count-agnostic (verified: no `toHaveCount(n>0)` in any
spec), so the acute risk is handled — but the retry setting itself is untouched and the phase's own
baseline was measured at `--retries=0`, which means CI green at `retries: 2` is a weaker signal than
the baseline it is compared against.
**Fix:** Set `retries: process.env.CI ? 1 : 0` and record the per-test accumulation constraint in the
config comment, or reset the DB per worker.

### IN-07: The same identity key renders in two incompatible fingerprint formats

**File:** `web/src/components/settings/FamilyTab.tsx:734` (six words) vs.
`web/src/components/invite/InviteLandingView.tsx:274` (grouped hex)
**Issue:** D-4 chose the word list *specifically* because hex is error-prone read aloud (B/D/E
confusion) — yet the invite landing page, the surface where an invitee most plausibly performs the
out-of-band check, still renders the grouped hex. Two members comparing "the fingerprint" over the
phone can be looking at two different-looking encodings of the same key and conclude they mismatch.
**Fix:** Render `formatFingerprintWords(metadata.inviter_fingerprint)` in `InviteLandingView` too
(with WR-09's try/catch), keeping the hex as a secondary/`title` value if useful.

---

_Reviewed: 2026-08-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
