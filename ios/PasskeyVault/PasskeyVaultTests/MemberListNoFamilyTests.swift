//
//  MemberListNoFamilyTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), CR-04(b): a 404 from `GET /api/families/
//  members` means "not a member of any family" (`families.rs::members`'s
//  own doc comment -- existence never leaks), the PRIMARY state for a solo
//  self-hoster, never a load failure. `MemberListView.isNoFamilyError` is
//  the extracted, `static`, pure predicate `load()` now delegates to.
//

import Foundation
import Testing
@testable import PasskeyVault

struct MemberListNoFamilyTests {

    @Test func a404IsRecognizedAsNoFamily() throws {
        let error = PvApiError.httpError(status: 404, message: "not found")
        #expect(MemberListView.isNoFamilyError(error))
    }

    @Test func everyOtherErrorIsNotRecognizedAsNoFamily() throws {
        #expect(!MemberListView.isNoFamilyError(PvApiError.httpError(status: 500, message: "server error")))
        #expect(!MemberListView.isNoFamilyError(PvApiError.httpError(status: 403, message: "forbidden")))
        #expect(!MemberListView.isNoFamilyError(PvApiError.network(URLError(.notConnectedToInternet))))
        #expect(!MemberListView.isNoFamilyError(PvApiError.invalidCredentials))
    }
}
