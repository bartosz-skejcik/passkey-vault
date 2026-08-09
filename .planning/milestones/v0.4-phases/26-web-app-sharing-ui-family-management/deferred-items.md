# Deferred Items — Phase 26

Out-of-scope discoveries logged during plan execution (not fixed, per the
SCOPE BOUNDARY rule: only auto-fix issues directly caused by the current
task's own changes).

## From Plan 26-05 (decrypt dispatch + A-5 onSharedRevisions)

**`updateVaultItem` always encrypts with the personal `encryptItem`/User Key
path, even for a collection-scoped item.** `store.ts::updateVaultItem` calls
`encryptItem(uk, plaintext, id, newRevision)` unconditionally — there is no
scope dispatch on the ENCRYPT side mirroring the DECRYPT-side dispatch this
plan (26-05) added to `decryptItemRow`. If a UI surface ever calls
`updateVaultItem` on an item whose `collectionId` is non-null, the save
would re-encrypt it under the personal UserKey, and the item would become
permanently undecryptable via the collection-scope path on its very next
sync merge (a self-inflicted AEAD failure, not a server-side bug).

Not fixed here because:
- This plan's task 2 scope is `decryptItemRow`'s dispatch (read path),
  not `updateVaultItem`'s encrypt path (write path) — a genuinely
  different, larger change (would need `encryptItemForCollection` +
  `getCollectionKey` wiring on the write side, plus a decision about
  what happens when the collection key isn't cached at save time).
- No UI surface in this phase currently lets a user edit a collection-scoped
  item's fields through `updateVaultItem` — Task 2's own `<action>` text
  explicitly assigns `moveItemToCollection`'s re-encrypt-under-destination-
  scope logic to Plan 26-08, not here.

Whichever later plan builds "edit a shared item" UI (or Plan 26-08's
move-to-collection re-encrypt logic, if it also touches the general edit
path) owns this fix. Until then, the pre-existing personal-only
`updateVaultItem` behavior is unchanged by this plan — this plan only
touches the decrypt/read path.

## From Plan 26-14 (recipient-side read paths: WINDOWS #7/#8/#9)

**No encrypt-as-shared-key-recipient primitive exists for directly-shared
items.** This plan wires `GET /api/sync/shared/direct` (WINDOWS #9) into
`store.ts`, so a directly-shared item now genuinely appears in a recipient's
own item list for the first time. `updateVaultItem` now throws
`DirectShareNotEditableError` for any such item rather than silently
re-encrypting it under the recipient's own personal User Key (which would
permanently corrupt the item for its real owner — see that error class's own
doc comment for the full rationale).

Not fixed here because:
- Building the real fix (a recipient can genuinely edit a directly-shared
  item they hold `edit` access on) requires a NEW pv-core/pv-wasm crypto
  primitive — an "encrypt with an already-unsealed shared Cipher Key"
  counterpart to the existing read-only `decryptItemWithSharedKey` — plus a
  WASM rebuild and a new real-WASM proof. That is new cryptographic surface,
  well beyond this (client-store-only) plan's declared scope.
**CORRECTED 2026-08-07 (26-VERIFICATION.md gap 3 / warning W-4).** The
second bullet of this deferral originally read:

> No UI affordance in this phase specifically offers "edit" on a directly-
> shared item yet (`DirectSharedItemRow`/`item_shares` do carry a per-
> recipient `access_level`, but neither `pull_shared_direct`'s wire response
> nor `store.ts`'s `VaultItem` shape surfaces it to the client today — a
> second, smaller gap this plan also did not close, since no UI reads it).

**That was factually wrong, and the wrong reason is why the gap survived
both 26-14 and the code review.** The verifier's live probe P5 found
`detail-panel-edit` rendered for a `sharedToMe` item (count = 1), the form
opening, accepting input, and Save producing `error.itemSaveFailed` —
"Failed to save item. Please try again." — over an operation that can never
succeed. That is the WINDOWS #11 / commit `4450dc0` retry-invitation shape
on a new surface, its third occurrence in this repo.

The affordance was rendered because `DetailPanel.tsx`'s Edit guard listed
only `passkey` and `undecryptable`, while the Share button two lines above
it — in the same file, from the same code review — DID suppress
`sharedToMe`. Suppressing the affordance never needed the crypto primitive;
only the *editing* does. Reading the deferral's own text as "no affordance
exists" instead of checking the file is exactly the class of error a
deferral record is supposed to prevent.

**Closed 2026-08-07 (26-VERIFICATION-FIX.md, blocker 2):** the affordance is
suppressed in both `DetailPanel.tsx` and `ItemContextMenu.tsx`,
`share.sharedWithYouNotEditable` states plainly that the capability is not
available yet, and `DirectShareNotEditableError` is now mapped in
DetailPanel's `onError` to that same honest copy instead of the generic
retry banner — the error class had ZERO UI consumers before. All three
layers are mutation-verified in `DetailPanel.test.tsx` /
`ItemContextMenu.test.tsx`.

**Still genuinely deferred:** the encrypt-side primitive itself. Whichever
later plan builds "edit a directly-shared item" owns the new
encrypt-as-shared-key-recipient WASM primitive. `access_level` IS now on the
wire and in `VaultItem` as of 26-VERIFICATION-FIX.md blocker 1 (SHARE-03's
hidden-password masking needed it), so that half is no longer outstanding —
the future plan can additionally gate edit on `accessLevel === "edit"`.
`DirectShareNotEditableError` remains the data-layer backstop either way.

**Collection-shared items carry the identical write-path gap for a
NON-OWNING member**, already logged above from Plan 26-05 — this plan does
not widen or narrow that one. `updateVaultItem`'s existing `collectionId`
dispatch (26-05a) already re-encrypts a collection-scoped item correctly
via `encryptItemForCollection`/`getCollectionKey` REGARDLESS of whether the
caller is the item's own creator (the Collection Key is shared identically
by every member), so a non-owning member with `edit` access on a shared
collection item they can now SEE (this plan's WINDOWS #8 fix) can already
save it correctly today — no analogous guard was needed for that case.

## From 26-VERIFICATION-FIX.md (gap closure, 2026-08-07)

### 1. Hidden-password masking does not extend to vault export (WINDOWS #12)

Blocker 1 made SHARE-03's `hidden_password` a real interface mask in the
item detail view: the reveal toggle is suppressed and the plaintext never
renders. `ExportDialog.tsx` calls `getItems()` — the MERGED view, which
since 26-14 includes items shared TO the caller — and hands it to
`buildCsvExport`/`buildJsonExport`, both of which emit
`fields.password` verbatim (`toCsv.ts:59`). So a recipient can still obtain
the plaintext through Settings → Export, in two clicks.

**Not fixed here, deliberately, and this is the honest reasoning — not a
scope excuse:**

- It is genuinely inside what D-2's disclosure already discloses. The
  owner-facing copy says the recipient "still holds the decryption key and
  can technically recover it (e.g. via browser developer tools, or by
  reading the encrypted data directly)". An explicit whole-vault export is
  squarely a deliberate recovery act, not "accidentally seeing it on
  screen", which is the harm SHARE-03 and the disclosure both name.
- The obvious fix is worse than the gap if done carelessly. Silently
  blanking a password in a user's own vault BACKUP is data loss the user
  will not notice until they need the backup. Doing it honestly means an
  explicit in-file marker, which is new export-format surface and new i18n
  in a file this pass does not otherwise touch.
- Nothing in the shipped copy overclaims because of it. The recipient-facing
  `share.hiddenPasswordRecipientNote` was deliberately worded "**this view**
  masks it", not "hidden in the interface", precisely so this residual does
  not make the copy a lie. That wording choice is the mitigation.

**Whoever picks this up owns the decision** of blank-vs-marker in the export
format, for BOTH exporters, and owes the same treatment in the extension
(Phase 27) if it grows an export.

### 2. CR-01's recovery is session-scoped; a closed dialog orphans a collection (WINDOWS #13)

26-VERIFICATION.md's warning W-2, independently re-verified during this
pass and **confirmed correct**:

- `createdCollectionRef` is a component ref cleared on unmount
  (`ShareDialog.tsx:350-357`), so retrying through the SAME open dialog is
  genuinely idempotent — the fixer's scoped claim ("a user can complete a
  partially-failed share by pressing the same button again") holds and is
  tested.
- But there is **no UI entry point anywhere that adds a member to an
  EXISTING shared collection**. Re-verified by grep this pass: the only two
  `ShareDialogScope` folder variants constructed anywhere are
  `existingFolderId: <personal folder id>` (Sidebar:323) and
  `existingFolderId: null` (Sidebar:422, FamilyTab:695) — both of which MINT
  A NEW COLLECTION. The Sidebar's shared-folder rows (Sidebar:404-417) are
  plain non-interactive `<div>`s: no kebab, no share action, no delete.
- Consequence: closing the dialog after a partial failure strands the
  half-granted collection permanently. Reopening mints a second one, and any
  seed items already moved into the first are now collection-encrypted, so
  they fail `decryptItem` on the re-move and count as fresh `seedMoveFailed`s.
  The orphan then persists visibly in the "Shared folders" sidebar with no
  delete affordance.

**Not fixed here because the fix is a new UI surface, not a guard.** It
needs a kebab on the shared-folder row, a third `ShareDialogScope` variant
(`existingCollectionId`), and a genuinely different crypto path in
`ShareDialog`'s submit — unseal the caller's OWN `sealed_key` for that
collection and re-seal the recovered Collection Key to the new recipient,
rather than `WasmCollectionKey.generate()`'s mint-a-fresh-key path. That is
feature work with its own real-WASM proof obligation, not gap closure, and
inventing it under a verification-fix pass is how half-built surfaces get
shipped.

**The unscoped half of CR-01's claim ("no manual DB surgery") is
therefore recorded as NOT TRUE**, and this entry — not the fix report — is
the durable record of that.
