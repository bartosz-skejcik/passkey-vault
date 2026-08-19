//
//  MemberListRemovalCopyTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), WR-18: `MemberListView`'s removal-error
//  copy must distinguish WR-03's actionable `.rekeySetMismatch` (retrying
//  re-submits the SAME mismatched set and 409s again, forever) from every
//  other failure. `performRemoval` itself is `private` on a `View` struct
//  (file-scoped -- unreachable even via `@testable import`), so this file
//  proves the two extracted, `static`, pure functions it delegates to:
//  `isRekeySetMismatch` (the discriminant) and `removalErrorMessage` (the
//  copy selection).
//

import Foundation
import Testing
@testable import PasskeyVault

struct MemberListRemovalCopyTests {

    @Test func rekeySetMismatchErrorIsRecognized() throws {
        let error = RemoveMemberError.rekeySetMismatch(status: 409, body: "mismatch")
        #expect(MemberListView.isRekeySetMismatch(error))
    }

    @Test func everyOtherErrorIsNotRecognizedAsARekeySetMismatch() throws {
        #expect(!MemberListView.isRekeySetMismatch(PvApiError.network(URLError(.notConnectedToInternet))))
        #expect(!MemberListView.isRekeySetMismatch(RemoveMemberError.noSessionToken("/api/x")))
    }

    /// THE decisive test (WR-18's own fix note): the two messages must be
    /// DIFFERENT, and the mismatch copy must never suggest a bare retry --
    /// retrying re-submits the identical batch and 409s again.
    @Test func theTwoMessagesAreDifferentAndTheMismatchCopyNeverSuggestsABareRetry() throws {
        let mismatchCopy = MemberListView.removalErrorMessage(isRekeySetMismatch: true)
        let genericCopy = MemberListView.removalErrorMessage(isRekeySetMismatch: false)

        #expect(mismatchCopy != genericCopy)
        #expect(
            mismatchCopy.lowercased().contains("odśwież"),
            "the mismatch copy must tell the user to reload the roster, not just retry"
        )
        #expect(genericCopy.lowercased().contains("spróbuj ponownie"))
    }
}
