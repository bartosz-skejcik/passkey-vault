//
//  DetailFieldTablesTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 1.
//
//  Every table value below is checked against `DetailPanel.tsx`'s ACTUAL
//  constants (`FIELD_ORDER`, `OPTIONAL_IF_EMPTY_FIELDS`, `MONO_FIELDS`,
//  `REVEALABLE_FIELDS`, `MASK`), not against an intuition about what a
//  detail screen "ought to" show.
//

import Foundation
import Testing
@testable import PasskeyVault

struct DetailFieldTablesTests {

    // MARK: - FIELD_ORDER, ported verbatim

    @Test func loginFieldOrderIsUsernamePasswordNotes() {
        #expect(DetailFieldTables.fieldOrder["login"] == ["username", "password", "notes"])
    }

    @Test func cardFieldOrderMatchesTheBartekLiveReviewOrderingIncludingPinAndZip() {
        #expect(
            DetailFieldTables.fieldOrder["card"]
                == ["number", "expiry", "cvv", "pin", "zip", "cardholderName", "notes"]
        )
    }

    @Test func noteFieldOrderIsBodyOnly() {
        #expect(DetailFieldTables.fieldOrder["note"] == ["body"])
    }

    /// TOTP's view-mode field order is `["secret"]` ONLY -- `algorithm`,
    /// `digits` and `period` are real model fields but never render in view
    /// mode (they are not table entries at all, so `ItemDetailView`'s
    /// generic loop cannot reach them for this type).
    @Test func totpFieldOrderIsSecretOnlyNeverAlgorithmDigitsOrPeriod() {
        #expect(DetailFieldTables.fieldOrder["totp"] == ["secret"])
    }

    /// `identity` and `passkey` are deliberately EMPTY -- both get composed
    /// bespoke layouts in `ItemDetailView.swift`, not the generic loop.
    @Test func identityAndPasskeyFieldOrdersAreEmpty() {
        #expect(DetailFieldTables.fieldOrder["identity"] == [])
        #expect(DetailFieldTables.fieldOrder["passkey"] == [])
    }

    /// `login`'s `urls` are NOT a `FIELD_ORDER` entry -- `ItemDetailView`
    /// splices them in as a special case right after `password`, because
    /// `urls` is `[String]`, not the scalar `String` every table entry here
    /// assumes.
    @Test func loginFieldOrderNeverListsUrlsAsATableEntry() {
        #expect(DetailFieldTables.fieldOrder["login"]?.contains("urls") == false)
    }

    // MARK: - OPTIONAL_IF_EMPTY_FIELDS

    @Test func optionalIfEmptyFieldsIsExactlyPinAndZip() {
        #expect(DetailFieldTables.optionalIfEmptyFields == ["pin", "zip"])
    }

    // MARK: - MONO_FIELDS / REVEALABLE_FIELDS

    @Test func monoFieldsMatchesTheWebSource() {
        #expect(DetailFieldTables.monoFields == ["password", "number", "cvv", "pin", "secret"])
    }

    @Test func revealableFieldsMatchesTheWebSource() {
        #expect(DetailFieldTables.revealableFields == ["password", "number", "secret", "cvv", "pin"])
    }

    // MARK: - MASK: a FIXED length, independent of the real value's length

    /// The mask string itself is a fixed run of ten identical characters --
    /// asserted directly, not merely "non-empty".
    @Test func maskIsAFixedTenCharacterRun() {
        #expect(DetailFieldTables.mask.count == 10)
        #expect(Set(DetailFieldTables.mask) == ["\u{2022}"])
    }

    /// The must-have truth, pinned END-TO-END through `displayValue` (not
    /// merely `isMasked`'s boolean): two values of VERY different lengths
    /// (3 characters vs. 200 characters) must produce the EXACT SAME masked
    /// output string -- the placeholder must never leak the real value's
    /// character count. RED-before-green: this is the test that failed when
    /// `displayValue`'s masked branch was temporarily changed to
    /// `String(repeating: "•", count: value.count)` -- see 38-07-SUMMARY.md
    /// for the transcript.
    @Test func maskLengthIsIndependentOfTheRealValuesLength() {
        let shortValue = "abc"
        let longValue = String(repeating: "x", count: 200)
        #expect(shortValue.count != longValue.count)

        let shortDisplay = DetailFieldTables.displayValue(
            key: "password", value: shortValue, revealed: false, passwordHidden: false
        )
        let longDisplay = DetailFieldTables.displayValue(
            key: "password", value: longValue, revealed: false, passwordHidden: false
        )
        #expect(shortDisplay == longDisplay)
        #expect(shortDisplay == DetailFieldTables.mask)
        #expect(shortDisplay.count == 10)
    }

    // MARK: - isMasked: the reveal/hide decision

    @Test func emptyValueIsNeverMaskedRegardlessOfEverythingElse() {
        #expect(DetailFieldTables.isMasked(key: "password", value: "", revealed: false, passwordHidden: true) == false)
    }

    @Test func aRevealableFieldIsMaskedUntilRevealedThenVisible() {
        #expect(DetailFieldTables.isMasked(key: "password", value: "hunter2", revealed: false, passwordHidden: false) == true)
        #expect(DetailFieldTables.isMasked(key: "password", value: "hunter2", revealed: true, passwordHidden: false) == false)
    }

    /// A non-revealable, non-mono field (e.g. `username`) is never masked
    /// regardless of reveal state.
    @Test func aNonRevealableFieldIsNeverMasked() {
        #expect(DetailFieldTables.isMasked(key: "username", value: "bartek", revealed: false, passwordHidden: false) == false)
    }

    /// The password-hidden gate takes priority over reveal state: even a
    /// field the caller claims is "revealed" stays masked when
    /// `passwordHidden` is true -- checked BEFORE the reveal branch, exactly
    /// like `DetailPanel.tsx`'s own ordering.
    @Test func passwordHiddenGateOverridesEvenAClaimedRevealState() {
        #expect(DetailFieldTables.isMasked(key: "password", value: "hunter2", revealed: true, passwordHidden: true) == true)
    }

    // MARK: - The hidden-password gate's SCOPE (Pitfall 6, T-38-03-03)

    /// The narrowing that keeps a card's number/cvv/pin and a TOTP's secret
    /// revealable at the SAME `hidden_password` account grant: only the key
    /// literally named `"password"` is gated, never any other key.
    @Test func passwordFieldIsHiddenGateAppliesOnlyToThePasswordKey() {
        #expect(DetailFieldTables.passwordFieldIsHidden(accountHoldsHiddenPassword: true, key: "password") == true)
        #expect(DetailFieldTables.passwordFieldIsHidden(accountHoldsHiddenPassword: true, key: "number") == false)
        #expect(DetailFieldTables.passwordFieldIsHidden(accountHoldsHiddenPassword: true, key: "secret") == false)
        #expect(DetailFieldTables.passwordFieldIsHidden(accountHoldsHiddenPassword: true, key: "cvv") == false)
        #expect(DetailFieldTables.passwordFieldIsHidden(accountHoldsHiddenPassword: true, key: "pin") == false)
    }

    @Test func passwordFieldIsHiddenGateIsFalseWhenTheAccountDoesNotHoldTheGrant() {
        #expect(DetailFieldTables.passwordFieldIsHidden(accountHoldsHiddenPassword: false, key: "password") == false)
    }

    /// End-to-end through `isMasked`: a login's password at the
    /// hidden-password level renders masked with the reveal gate closed,
    /// while a card's number and a TOTP's secret on the SAME account
    /// (`accountHoldsHiddenPassword: true` fed through, but the KEY differs)
    /// stay revealable exactly like an ordinary account.
    @Test func hiddenPasswordAccountStillLeavesCardNumberAndTotpSecretRevealable() {
        let accountHoldsHiddenPassword = true

        let passwordHiddenForPassword = DetailFieldTables.passwordFieldIsHidden(
            accountHoldsHiddenPassword: accountHoldsHiddenPassword, key: "password"
        )
        #expect(
            DetailFieldTables.isMasked(
                key: "password", value: "hunter2", revealed: false, passwordHidden: passwordHiddenForPassword
            ) == true
        )

        let passwordHiddenForNumber = DetailFieldTables.passwordFieldIsHidden(
            accountHoldsHiddenPassword: accountHoldsHiddenPassword, key: "number"
        )
        #expect(passwordHiddenForNumber == false)
        // Revealable and NOT masked once the caller reveals it -- the gate
        // never widened to this key.
        #expect(
            DetailFieldTables.isMasked(
                key: "number", value: "4111111111111111", revealed: true, passwordHidden: passwordHiddenForNumber
            ) == false
        )

        let passwordHiddenForSecret = DetailFieldTables.passwordFieldIsHidden(
            accountHoldsHiddenPassword: accountHoldsHiddenPassword, key: "secret"
        )
        #expect(passwordHiddenForSecret == false)
        #expect(
            DetailFieldTables.isMasked(
                key: "secret", value: "JBSWY3DPEHPK3PXP", revealed: true, passwordHidden: passwordHiddenForSecret
            ) == false
        )
    }

    // MARK: - DetailRevealState: cleared whenever the displayed item changes

    @Test func aFreshRevealStateStartsWithNothingRevealed() {
        let state = DetailRevealState(itemId: "item-1")
        #expect(state.isRevealed("password") == false)
    }

    @Test func togglingAFieldRevealsItThenTogglingAgainHidesIt() {
        var state = DetailRevealState(itemId: "item-1")
        let firstToggle = state.toggle("password")
        #expect(firstToggle == true)
        #expect(state.isRevealed("password") == true)

        let secondToggle = state.toggle("password")
        #expect(secondToggle == false)
        #expect(state.isRevealed("password") == false)
    }

    /// The must-have truth, pinned directly: revealing a field on one item
    /// and then switching to a DIFFERENT item leaves NOTHING revealed on
    /// the second -- a revealed field must be explicitly re-revealed.
    @Test func settingADifferentItemClearsEveryRevealedKey() {
        var state = DetailRevealState(itemId: "item-1")
        state.toggle("password")
        state.toggle("number")
        #expect(state.isRevealed("password") == true)
        #expect(state.isRevealed("number") == true)

        state.setItem("item-2")

        #expect(state.isRevealed("password") == false)
        #expect(state.isRevealed("number") == false)
        #expect(state.revealedKeys.isEmpty)
    }

    /// Idempotence on the SAME id: re-applying the current item's id (as a
    /// live `.onChange` might, redundantly, alongside the fresh `init` case)
    /// must NOT clear a reveal the user just set for the item already on
    /// screen.
    @Test func settingTheSameItemIdAgainDoesNotClearAnythingRevealed() {
        var state = DetailRevealState(itemId: "item-1")
        state.toggle("password")

        state.setItem("item-1")

        #expect(state.isRevealed("password") == true)
    }

    /// Switching back to a PREVIOUSLY-viewed item still starts fresh --
    /// there is no "restore the reveal set for an item I saw before" memory
    /// anywhere in this type.
    @Test func returningToAPreviouslyViewedItemDoesNotRestoreItsOldRevealState() {
        var state = DetailRevealState(itemId: "item-1")
        state.toggle("password")
        state.setItem("item-2")
        state.setItem("item-1")
        #expect(state.isRevealed("password") == false)
    }
}
