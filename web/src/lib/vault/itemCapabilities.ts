// What the CALLER can do with a given item, derived from
// `VaultItem.accessLevel`/`sharedToMe` (26-VERIFICATION.md gap 1's wire
// work). One module so DetailPanel and ItemContextMenu cannot drift — the
// two surfaces drifting is exactly how gap 3 happened (the Share button
// suppressed `sharedToMe`; the Edit button two lines below it did not).
//
// These are UI-HONESTY predicates, never authorization. Server-side
// `Membership<Item, RequireEdit>` is the only thing that actually stops a
// write, and `store.ts`'s `DirectShareNotEditableError` /
// `CollectionKeyUnavailableError` are the data-layer backstops. What these
// buy is that the UI stops OFFERING operations it knows will fail — the
// WINDOWS #11 / commit `4450dc0` failure class — and stops showing a value
// the owner was told would be masked.
import type { VaultItem } from "@/lib/vault/types";

/** SHARE-03's `hidden_password`: "usable but the password field is masked".
 *
 * Scope, stated so it is not mistaken for an oversight: this covers the
 * login `password` field only, matching the requirement's own literal text
 * and the level's own name (`access.hiddenPassword` / "Ukryte hasło"). A
 * card's `number`/`cvv`/`pin` and a TOTP `secret` stay revealable — widening
 * the mask to them would silently redefine a vocabulary Phase 25 locked and
 * Phase 26 reuses verbatim, which is a decision for a requirement change,
 * not for this helper.
 *
 * And it is an INTERFACE predicate by construction (26-CONTEXT.md A-6): the
 * recipient holds the item's Cipher Key. `share.hiddenPasswordDisclosureBody`
 * says so at share time and `share.hiddenPasswordRecipientNote` says so
 * again at read time. Nothing here is, or may be presented as, cryptographic
 * protection. */
export function isPasswordHidden(item: VaultItem): boolean {
  return item.accessLevel === "hidden_password";
}

/** Whether this caller can actually save an edit to this item.
 *
 * Mirrors the server's own rule rather than approximating it:
 *  - `sharedToMe` -> NO at any level, including `edit`. There is no
 *    encrypt-as-shared-key-recipient primitive yet, so `updateVaultItem`
 *    throws `DirectShareNotEditableError` rather than corrupt the item under
 *    the wrong key. (deferred-items.md owns the crypto half.)
 *  - `accessLevel === undefined` -> YES. The caller owns the item outright;
 *    `Item::resolve_access`'s personal branch grants `AccessLevel::Edit`
 *    unconditionally.
 *  - otherwise -> EXACT match against `"edit"`, mirroring
 *    `RequireEdit::satisfied_by`'s deliberate exact match. Never a rank
 *    comparison: `hidden_password` ranks BETWEEN read and edit for
 *    `combine_access`'s max-of-two-grants purpose, and treating that rank as
 *    "good enough for edit" is the Vaultwarden #6269 bug class the server
 *    side explicitly refuses to derive from an ordering. An unrecognized
 *    level fails closed here for the same reason `accessLevelKey` renders it
 *    as `access.unknown`.
 *
 * Note this also covers a member holding `read`/`hidden_password` on an item
 * they CREATED inside a shared folder: `resolve_access` deliberately does
 * not fold an ownership grant into its collection branch, so the server
 * would 403 that save too. Before this helper the UI offered Edit there and
 * the save surfaced as "Failed to save item. Please try again." */
export function canEditItem(item: VaultItem): boolean {
  if (item.sharedToMe === true) return false;
  if (item.accessLevel === undefined) {
    // LO-03 (code review, Phase 32): `undefined` means "owns outright"
    // ONLY for a genuinely PERSONAL item -- `Item::resolve_access`'s
    // personal branch is what grants that unconditional Edit. For a
    // collection-scoped item, `accessLevel` is ALWAYS supposed to carry
    // the caller's real `collection_keys.access_level`
    // (`decryptItemRow`'s own doc comment); `undefined` there means the
    // collections store has not cached this collection's level YET, not
    // "no level needed here" -- treating it as ownership let a
    // collection-scoped item render as freely editable in the narrow
    // window before its own gate is known. Fails closed, matching this
    // function's own stated discipline for an unrecognized level.
    return item.collectionId == null;
  }
  return item.accessLevel === "edit";
}
