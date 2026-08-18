//
//  DetailFieldTables.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 1. A DIRECT PORT of
//  `web/src/components/vault/DetailPanel.tsx`'s `FIELD_ORDER` /
//  `OPTIONAL_IF_EMPTY_FIELDS` / `MONO_FIELDS` / `REVEALABLE_FIELDS` / `MASK`
//  -- the detail screen's field order is a deliberate, live-reviewed table,
//  not one this file re-derives.
//
//  `identity` and `passkey` are deliberately EMPTY orders: both get their
//  own composed layouts in `ItemDetailView.swift` rather than the generic
//  field loop this table drives, matching the TypeScript source's own
//  comment ("FIELD_ORDER.passkey is deliberately empty ... these three rows
//  replace the generic loop for this type").
//
//  `login`'s `urls` field is NOT a table entry: `urls` is `[String]`, not a
//  plain `String`, and every other entry here assumes a scalar value.
//  `ItemDetailView.swift` splices the URL rows in right after `password` as
//  a special case, mirroring `DetailPanel.tsx`'s own `Fragment` shape.
//
//  `DetailRevealState` also lives here: the "reveal set clears whenever the
//  displayed item changes" rule (`DetailPanel.tsx:161-167`'s `useEffect`) is
//  factored into this small, independently testable type so
//  `DetailFieldTablesTests.swift` can pin it without mounting a SwiftUI
//  view.
//

import Foundation

enum DetailFieldTables {

    /// `DetailPanel.tsx`'s `FIELD_ORDER`, ported verbatim.
    static let fieldOrder: [String: [String]] = [
        "login": ["username", "password", "notes"],
        "card": ["number", "expiry", "cvv", "pin", "zip", "cardholderName", "notes"],
        "identity": [],
        "note": ["body"],
        "totp": ["secret"],
        "passkey": [],
    ]

    /// Rows entirely OMITTED (never a "--" placeholder) when their value is
    /// empty -- the two additive-optional card fields.
    static let optionalIfEmptyFields: Set<String> = ["pin", "zip"]

    /// Rendered in a fixed-width face.
    static let monoFields: Set<String> = ["password", "number", "cvv", "pin", "secret"]

    /// Fields with a per-field reveal toggle alongside the copy button.
    static let revealableFields: Set<String> = ["password", "number", "secret", "cvv", "pin"]

    /// A FIXED-LENGTH mask, independent of the real value's length, so the
    /// placeholder never leaks how many characters the value actually has.
    static let mask = String(repeating: "\u{2022}", count: 10)

    /// The mask/reveal decision, extracted from `ItemDetailView` so it is
    /// unit-testable without mounting a SwiftUI view. Mirrors
    /// `DetailPanel.tsx`'s `displayValueFor`'s ordering exactly: empty
    /// first, the password-hidden gate SECOND (checked before reveal state,
    /// so an already-revealed field can never leak through a masked-by-
    /// grant field), then the mono-but-not-revealable branch (vestigial
    /// today -- the two sets are currently identical -- kept because this is
    /// a direct port, not a re-derivation), then the ordinary reveal check.
    static func isMasked(key: String, value: String, revealed: Bool, passwordHidden: Bool) -> Bool {
        guard !value.isEmpty else { return false }
        if passwordHidden { return true }
        if monoFields.contains(key), !revealableFields.contains(key) { return true }
        if revealableFields.contains(key), !revealed { return true }
        return false
    }

    /// The end-to-end display string: `isMasked` decides WHETHER, this
    /// decides WHAT -- always the SAME fixed-length `mask` constant when
    /// masked, regardless of the real value's length. `ItemDetailView`'s
    /// own `displayValue(for:value:fields:)` calls this directly rather than
    /// re-deriving it, so the two can never drift.
    static func displayValue(key: String, value: String, revealed: Bool, passwordHidden: Bool) -> String {
        guard !value.isEmpty else { return "\u{2014}" }
        return isMasked(key: key, value: value, revealed: revealed, passwordHidden: passwordHidden)
            ? mask
            : value
    }

    /// The password-hidden gate's SCOPE: `hidden_password` masks the login
    /// `password` field ONLY. A card's `number`/`cvv`/`pin` and a TOTP's
    /// `secret` stay revealable at the EXACT SAME account-level grant --
    /// `ItemCapabilities.isPasswordHidden` reports the account-level grant;
    /// this function is what narrows it to one field key (Pitfall 6,
    /// T-38-03-03). Never generalised to any other key, deliberately.
    static func passwordFieldIsHidden(accountHoldsHiddenPassword: Bool, key: String) -> Bool {
        accountHoldsHiddenPassword && key == "password"
    }
}

/// The detail screen's reveal state: which field keys are currently shown in
/// the clear, for exactly ONE item at a time. `setItem` is the single place
/// the "cleared whenever the displayed item changes" rule lives
/// (`DetailPanel.tsx:161-167`) -- a field revealed on one item must never
/// carry over to the next; it must be explicitly re-revealed.
struct DetailRevealState: Equatable {
    private(set) var itemId: String
    private(set) var revealedKeys: Set<String> = []

    init(itemId: String) {
        self.itemId = itemId
    }

    /// Idempotent on the SAME id -- calling this from both a fresh `init`
    /// and a live `.onChange(of: item.id)` must never itself clear a
    /// reveal the user just set for the item the view is already showing.
    mutating func setItem(_ id: String) {
        guard id != itemId else { return }
        itemId = id
        revealedKeys = []
    }

    func isRevealed(_ key: String) -> Bool {
        revealedKeys.contains(key)
    }

    /// WR-01 (iteration 2): structural scoping, not lifecycle-ordered --
    /// `.onAppear` fires AFTER SwiftUI's first `body` evaluation for a
    /// freshly-pushed `ItemDetailView`, so relying on `setItem` alone left
    /// the first composed frame of item B answering with item A's
    /// `revealedKeys`. This overload can never answer for an item it does
    /// not currently own, independent of when `setItem` runs relative to
    /// `body`. Production call sites (`ItemDetailView`) must use this one;
    /// the itemId-less overload above stays for tests that assert the raw
    /// `revealedKeys` set directly.
    func isRevealed(_ key: String, forItem id: String) -> Bool {
        itemId == id && revealedKeys.contains(key)
    }

    /// Toggles one field's reveal state. Returns whether the field is NOW
    /// revealed (`true`) or was just re-hidden (`false`) -- the caller uses
    /// this to fire the last-used touch ONLY on a reveal, never on a
    /// re-hide, matching `DetailPanel.tsx`'s `toggleReveal` (its
    /// `touchVaultItem` call sits inside the branch that ADDS to the set,
    /// never the branch that deletes from it).
    @discardableResult
    mutating func toggle(_ key: String) -> Bool {
        if revealedKeys.contains(key) {
            revealedKeys.remove(key)
            return false
        }
        revealedKeys.insert(key)
        return true
    }
}
