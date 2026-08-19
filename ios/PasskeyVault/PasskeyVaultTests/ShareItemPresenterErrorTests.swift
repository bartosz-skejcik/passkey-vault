//
//  ShareItemPresenterErrorTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), WR-25: `ShareItemPresenter.load()` used to
//  cover BOTH independent reads (`familyAPI.fetchMembers()`,
//  `store.fetchRawEncKeyJson(...)`) with one `catch`, always rendering
//  "Nie udało się wczytać listy członków rodziny." regardless of which
//  call failed or why -- including a 404 from `fetchMembers()`, which
//  means "not a member of any family" (the PRIMARY state for a solo
//  self-hoster), never a load failure. `isNoFamilyError` is the extracted,
//  `static`, pure predicate the fixed `load()` now delegates to.
//

import Foundation
import Testing
@testable import PasskeyVault

struct ShareItemPresenterErrorTests {

    @Test func a404FromFetchMembersIsRecognizedAsNoFamily() throws {
        let error = PvApiError.httpError(status: 404, message: "not found")
        #expect(ShareItemPresenter.isNoFamilyError(error))
    }

    @Test func everyOtherErrorIsNotRecognizedAsNoFamily() throws {
        #expect(!ShareItemPresenter.isNoFamilyError(PvApiError.httpError(status: 500, message: "server error")))
        #expect(!ShareItemPresenter.isNoFamilyError(VaultStoreError.locked))
        #expect(!ShareItemPresenter.isNoFamilyError(PvApiError.network(URLError(.notConnectedToInternet))))
    }
}
