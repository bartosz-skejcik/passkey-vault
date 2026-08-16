//
//  ItemCapabilities.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-03. A VERBATIM port of
//  `web/src/lib/vault/itemCapabilities.ts`, comments included -- those
//  comments are the record of why the rule is what it is, and a port that
//  dropped them would be a port of the code only.
//
//  What the CALLER can do with a given item, derived from `accessLevel` and
//  `sharedToMe`. One module so the detail screen and the context menu cannot
//  drift -- the two surfaces drifting is exactly how the web client's gap 3
//  happened (the Share button suppressed `sharedToMe`; the Edit button two
//  lines below it did not).
//
//  These are UI-HONESTY predicates, NEVER authorization. Server-side
//  `Membership<Item, RequireEdit>` is the only thing that actually stops a
//  write. What these buy is that the UI stops OFFERING operations it knows
//  will fail, and stops showing a value the owner was told would be masked.
//

import Foundation

enum ItemCapabilities {

    /// SHARE-03's `hidden_password`: "usable but the password field is
    /// masked".
    ///
    /// **Scope, stated so it is not mistaken for an oversight:** this covers
    /// the login `password` field ONLY, matching the requirement's own
    /// literal text and the level's own name. A card's `number`/`cvv`/`pin`
    /// and a TOTP `secret` stay revealable -- widening the mask to them would
    /// silently redefine a vocabulary Phase 25 locked and Phase 26 reuses
    /// verbatim, which is a decision for a requirement change, not for this
    /// helper (T-38-03-03).
    ///
    /// And it is an INTERFACE predicate by construction: the recipient holds
    /// the item's Cipher Key and can recover the password by other means.
    /// Nothing here is, or may be presented as, cryptographic protection.
    static func isPasswordHidden(_ item: VaultItemViewModel) -> Bool {
        item.accessLevel == "hidden_password"
    }

    /// Whether this caller can actually save an edit to this item.
    ///
    /// Mirrors the server's own rule rather than approximating it:
    ///  - `sharedToMe` -> NO at any level, INCLUDING `edit`. There is no
    ///    encrypt-as-shared-key-recipient primitive yet, so the update path
    ///    refuses rather than corrupt the item under the wrong key.
    ///  - `accessLevel == nil` -> YES. The caller owns the item outright;
    ///    `Item::resolve_access`'s personal branch grants `Edit`
    ///    unconditionally.
    ///  - otherwise -> EXACT match against `"edit"`, mirroring
    ///    `RequireEdit::satisfied_by`'s deliberate exact match.
    ///
    /// **Never a rank comparison.** `hidden_password` ranks BETWEEN read and
    /// edit for `combine_access`'s max-of-two-grants purpose, and treating
    /// that rank as "good enough for edit" is the Vaultwarden #6269 bug class
    /// the server side explicitly refuses to derive from an ordering. This is
    /// why the level is carried as a raw `String?` and not as an enum, and
    /// why the level is never given a `Comparable` conformance and why no
    /// rank-comparison operator appears anywhere in this file -- a property
    /// the plan's own grep checks, which is why this sentence names none of
    /// those operators literally (T-38-03-02). An unrecognized level FAILS CLOSED here and is
    /// never rewritten -- so it can still be rendered honestly as "unknown"
    /// rather than silently normalized into something it is not.
    ///
    /// Note this also covers a member holding `read`/`hidden_password` on an
    /// item they CREATED inside a shared folder: `resolve_access`
    /// deliberately does not fold an ownership grant into its collection
    /// branch, so the server would 403 that save too. Before this helper the
    /// UI offered Edit there and the save surfaced as "Failed to save item.
    /// Please try again." -- an error the user could do nothing about.
    static func canEditItem(_ item: VaultItemViewModel) -> Bool {
        if item.sharedToMe == true { return false }
        if item.accessLevel == nil { return true }
        return item.accessLevel == "edit"
    }
}
