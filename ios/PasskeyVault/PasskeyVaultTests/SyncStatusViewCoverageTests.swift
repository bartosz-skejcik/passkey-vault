//
//  SyncStatusViewCoverageTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), WR-23: shared/family-wide rows never reach
//  `CachedSnapshot` (`VaultStore.persistSnapshotToCache` is called with the
//  personal `/api/sync` rows only, before the merge runs) -- so "last
//  synced n ago" silently implies coverage it does not have. Rather than
//  attempt an unsafe schema extension under this pass's own time
//  constraints (both direct-shared and family-wide items would ALSO need
//  the identity keypair cached offline, which has no cached path of its
//  own today -- persisting the ROWS alone would not have made them
//  recoverable offline), the gap is disclosed:
//  `VaultStore.hasAnySharedOrFamilyWideItem` is the extracted, `static`,
//  pure predicate `SyncStatusView`'s new `hasUncachedSharedItems` flag is
//  driven by.
//

import Foundation
import Testing
@testable import PasskeyVault

@MainActor
struct SyncStatusViewCoverageTests {

    @Test func noItemsMeansNoUncachedCoverageGap() throws {
        #expect(!VaultStore.hasAnySharedOrFamilyWideItem([]))
    }

    @Test func aPurelyPersonalItemDoesNotTriggerTheDisclosure() throws {
        let personal = VaultItemViewModel(
            id: "personal-1", revision: 1, content: .undecryptable(reason: "fixture"),
            sharedToMe: false, accessLevel: nil, isFamilyWide: false
        )
        #expect(!VaultStore.hasAnySharedOrFamilyWideItem([personal]))
    }

    @Test func aDirectlySharedItemTriggersTheDisclosure() throws {
        let shared = VaultItemViewModel(
            id: "shared-1", revision: 1, content: .undecryptable(reason: "fixture"),
            sharedToMe: true, accessLevel: "read", isFamilyWide: false
        )
        #expect(VaultStore.hasAnySharedOrFamilyWideItem([shared]))
    }

    @Test func aFamilyWideCollectionItemTriggersTheDisclosure() throws {
        let familyWide = VaultItemViewModel(
            id: "family-1", revision: 1, content: .undecryptable(reason: "fixture"),
            sharedToMe: false, accessLevel: "edit", isFamilyWide: true
        )
        #expect(VaultStore.hasAnySharedOrFamilyWideItem([familyWide]))
    }

    /// A mix where ONLY the personal item is present alongside items that
    /// resolve `false` on both flags must not falsely disclose.
    @Test func aMixWithNoSharedOrFamilyWideItemDoesNotTriggerTheDisclosure() throws {
        let personalA = VaultItemViewModel(
            id: "a", revision: 1, content: .undecryptable(reason: "fixture"),
            sharedToMe: false, accessLevel: nil, isFamilyWide: false
        )
        let personalB = VaultItemViewModel(
            id: "b", revision: 1, content: .undecryptable(reason: "fixture"),
            sharedToMe: nil, accessLevel: nil, isFamilyWide: false
        )
        #expect(!VaultStore.hasAnySharedOrFamilyWideItem([personalA, personalB]))
    }
}
