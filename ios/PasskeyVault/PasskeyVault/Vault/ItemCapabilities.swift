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
//  EXTENDED by Phase 40, plan 40-08, Task 1 -- `40-UI-SPEC.md` §0.2
//  (binding, orchestrator resolution): plan 40-08's own text asked for a
//  SECOND `enum ItemCapabilities` in `Sharing/ItemCapabilities.swift`, which
//  is a compile-time redeclaration error against THIS file, already shipped
//  by plan 38-03. The resolution is to extend this file in place instead --
//  folding 40-08's `AccessLevel`-typed capability rule into the SAME
//  `canEditItem(_:)`/`isPasswordHidden(_:)` choke point, not a parallel one.
//  `Sharing/AccessLevel.swift` (net-new, no collision) supplies the closed,
//  fail-closed 4-case type both predicates below now route through
//  internally; the OBSERVABLE behaviour of both functions is UNCHANGED --
//  `ItemCapabilitiesTests.swift` (Phase 38) passes against this file
//  unmodified, including its case-sensitive/whitespace-sensitive exact-match
//  assertions, because `AccessLevel(wireValue:)`'s `switch` is exactly as
//  strict as the raw `== "edit"` comparison it replaces.
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
    ///
    /// Routed through `AccessLevel(wireValue:)` (plan 40-08, Task 1) rather
    /// than the raw `== "hidden_password"` string comparison this replaced
    /// -- behaviourally identical (the enum's parser matches the exact same
    /// literal), but now shares the ONE fail-closed parser `canEditItem`
    /// below also uses, instead of two independent string literals that
    /// could silently drift apart.
    static func isPasswordHidden(_ item: VaultItemViewModel) -> Bool {
        guard let raw = item.accessLevel else { return false }
        return AccessLevel(wireValue: raw) == .hiddenPassword
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
    ///
    /// Routed through `AccessLevel.grantsEdit` (plan 40-08, Task 1) for the
    /// "otherwise" branch -- `AccessLevel(wireValue:).grantsEdit` is an
    /// EXACT match against `.fullEdit`, identical in effect to the raw `==
    /// "edit"` comparison this replaced (`ItemCapabilitiesTests.swift`'s
    /// `onlyAnExactEditMatchGrantsEdit`/`anUnrecognizedAccessLevelFailsClosedAndSurvivesUnnormalized`
    /// pin this unchanged). The `sharedToMe`/`nil` branches are untouched --
    /// `AccessLevel` has no opinion on either; both are resolved before this
    /// enum is ever consulted.
    static func canEditItem(_ item: VaultItemViewModel) -> Bool {
        if item.sharedToMe == true { return false }
        guard let raw = item.accessLevel else { return true }
        return AccessLevel(wireValue: raw).grantsEdit
    }

    /// Quick fix 40-UX-03: the SPECIFIC gate `ItemDetailView`'s own toolbar
    /// Edit button reads (`ItemDetailView.canShowEditButton`), pulled out to
    /// a static, `@testable`-reachable predicate rather than left as a
    /// private computed property on the view -- mirroring
    /// `DetailFieldTables.passwordFieldIsHidden`'s own discipline (`ios/
    /// IOS-SPIKE-LOG.md`'s L-29: assert the PRODUCTION GATE CONDITION
    /// directly in `PasskeyVaultTests`, not a `UIHostingController`'s
    /// rendered accessibility tree, which was found non-deterministic on
    /// this toolchain).
    ///
    /// `canEditItem(_:)` alone is not enough here: it answers "would a SAVE
    /// succeed", not "does this screen have anything editable to show". Two
    /// extra guards `canEditItem` does not need:
    ///  - `item.fields != nil` -- excludes BOTH `undecryptable` (a known-
    ///    stale revision, T-38-03-05) and `pendingFamilyKey` (no decrypted
    ///    fields to prefill a form with, `ItemFields.swift`'s own
    ///    `Content.pendingFamilyKey` header). `canEditItem` has no opinion on
    ///    either -- it reads `sharedToMe`/`accessLevel` only.
    ///  - `typeName != "passkey"` -- a passkey is provider-created
    ///    cryptographic material, not user-typed content (this file's own
    ///    header note on `ItemFormKind`'s five-case union having no
    ///    `.passkey` case), so `ItemFormView(mode: .edit(_))` has nothing to
    ///    open for one even when `canEditItem` alone would say yes (a
    ///    passkey's `accessLevel`/`sharedToMe` are irrelevant to this
    ///    exclusion).
    static func canShowEditAffordance(_ item: VaultItemViewModel) -> Bool {
        item.fields != nil
            && item.fields?.typeName != "passkey"
            && canEditItem(item)
    }
}
