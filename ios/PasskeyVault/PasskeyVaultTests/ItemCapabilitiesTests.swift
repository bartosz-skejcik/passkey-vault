//
//  ItemCapabilitiesTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-03, Task 2.
//
//  These predicates mirror the SERVER's rule. Every case below is written
//  against `Item::resolve_access` / `RequireEdit::satisfied_by`'s actual
//  behaviour, not against an intuition about what "hidden password" ought to
//  mean.
//

import Foundation
import Testing
@testable import PasskeyVault

struct ItemCapabilitiesTests {

    private func item(
        sharedToMe: Bool? = nil,
        accessLevel: String? = nil
    ) -> VaultItemViewModel {
        VaultItemViewModel(
            id: "i-1",
            revision: 1,
            content: .fields(
                .login(
                    LoginFields(
                        name: "x", folderId: nil, tags: [], username: "u", password: "p",
                        urls: [], notes: ""
                    )
                )
            ),
            sharedToMe: sharedToMe,
            accessLevel: accessLevel
        )
    }

    /// `sharedToMe` -> NO at EVERY level, including `edit` itself. There is
    /// no encrypt-as-shared-key-recipient primitive yet, so the update path
    /// would refuse rather than corrupt the item under the wrong key.
    /// Testing only `read` here would leave the interesting case untested.
    @Test func aDirectlySharedItemIsNotEditableAtAnyLevelIncludingEdit() {
        for level in ["read", "hidden_password", "edit"] {
            #expect(
                ItemCapabilities.canEditItem(item(sharedToMe: true, accessLevel: level)) == false,
                "sharedToMe must be refused at level '\(level)'"
            )
        }
    }

    /// `accessLevel == nil` means "the caller owns this item outright" --
    /// NOT "unknown, assume the worst". `resolve_access`'s personal branch
    /// grants Edit unconditionally.
    @Test func anItemWithNoAccessLevelIsOwnedAndEditable() {
        #expect(ItemCapabilities.canEditItem(item()) == true)
    }

    @Test func onlyAnExactEditMatchGrantsEdit() {
        #expect(ItemCapabilities.canEditItem(item(accessLevel: "edit")) == true)
        #expect(ItemCapabilities.canEditItem(item(accessLevel: "read")) == false)
        #expect(ItemCapabilities.canEditItem(item(accessLevel: "hidden_password")) == false)
        // Case and whitespace are NOT normalized -- exact equality only.
        #expect(ItemCapabilities.canEditItem(item(accessLevel: "Edit")) == false)
        #expect(ItemCapabilities.canEditItem(item(accessLevel: "edit ")) == false)
    }

    /// An unrecognized wire value FAILS CLOSED, and -- equally important --
    /// is not rewritten. `hidden_password` ranks BETWEEN read and edit for
    /// the server's max-of-two-grants combine; deriving edit rights from that
    /// ordering is the Vaultwarden #6269 bug class the server explicitly
    /// refuses. There is deliberately no ordering here to derive from.
    @Test func anUnrecognizedAccessLevelFailsClosedAndSurvivesUnnormalized() {
        let weird = item(accessLevel: "superadmin_from_the_future")
        #expect(ItemCapabilities.canEditItem(weird) == false)
        #expect(weird.accessLevel == "superadmin_from_the_future")
        #expect(ItemCapabilities.isPasswordHidden(weird) == false)
    }

    /// The case that produced a real, unactionable user-facing error before
    /// the web client's own helper existed: a member holding `read` on an
    /// item THEY CREATED inside a shared folder. `resolve_access`
    /// deliberately does not fold an ownership grant into its collection
    /// branch, so the server 403s that save -- and the UI used to offer Edit
    /// and then report "Failed to save item. Please try again."
    @Test func aReadMemberCannotEditAnItemTheyCreatedInsideASharedFolder() {
        let createdByMeInASharedFolder = VaultItemViewModel(
            id: "i-2",
            revision: 1,
            content: .fields(.note(NoteFields(name: "n", folderId: nil, tags: [], body: ""))),
            isShared: true,
            collectionId: "col-1",
            sharedToMe: nil,          // NOT shared TO me -- I created it
            accessLevel: "read"       // ...but my level in that collection is read
        )
        #expect(ItemCapabilities.canEditItem(createdByMeInASharedFolder) == false)
    }

    /// The mask is true ONLY for the hidden-password level, and it governs a
    /// login's password. A card's number/cvv/pin and a TOTP secret stay
    /// revealable -- widening the mask would silently redefine a vocabulary
    /// Phase 25 locked (T-38-03-03).
    @Test func thePasswordMaskAppliesOnlyToTheHiddenPasswordLevel() {
        #expect(ItemCapabilities.isPasswordHidden(item(accessLevel: "hidden_password")) == true)
        #expect(ItemCapabilities.isPasswordHidden(item(accessLevel: "read")) == false)
        #expect(ItemCapabilities.isPasswordHidden(item(accessLevel: "edit")) == false)
        #expect(ItemCapabilities.isPasswordHidden(item()) == false)
    }

    /// The scope claim, asserted rather than left to the comment: a card and
    /// a TOTP item at the SAME hidden-password level are still governed by
    /// one predicate whose contract is "the login password field". The
    /// predicate has no per-type behaviour to widen, which is the point --
    /// this test pins that it did not acquire any.
    @Test func theMaskPredicateHasNoPerTypeBehaviourToWiden() {
        let card = VaultItemViewModel(
            id: "c", revision: 1,
            content: .fields(
                .card(
                    CardFields(
                        name: "V", folderId: nil, tags: [], cardholderName: "X", number: "4111",
                        expiry: "01/30", cvv: "123", pin: "0000", zip: nil, notes: ""
                    )
                )
            ),
            accessLevel: "hidden_password"
        )
        let totp = VaultItemViewModel(
            id: "t", revision: 1,
            content: .fields(
                .totp(
                    TotpFields(
                        name: "T", folderId: nil, tags: [], secret: "JBSW", issuer: "",
                        algorithm: "SHA1", digits: 6, period: 30, notes: ""
                    )
                )
            ),
            accessLevel: "hidden_password"
        )
        // Same value for every type: the predicate reads the LEVEL, nothing
        // else. Whether a given field is masked is the detail screen's
        // decision, and 38-07 confines it to the login password.
        #expect(ItemCapabilities.isPasswordHidden(card) == true)
        #expect(ItemCapabilities.isPasswordHidden(totp) == true)
    }
}
