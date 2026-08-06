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
