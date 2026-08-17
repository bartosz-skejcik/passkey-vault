//
//  ItemDetailTouchLiveTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 1. The plan's own
//  acceptance criterion, run against a LIVE, unmodified `pv-server`: "reveal
//  a field, then confirm that item's last-used timestamp advanced and its
//  revision did not, read back from the sync endpoint."
//
//  Drives `VaultAPI.touchItem` -- the EXACT call `ItemDetailView`'s reveal
//  and copy handlers make via `VaultStore.touch(itemId:)` -- then re-reads
//  the item back from `GET /api/sync`, never trusting the touch response
//  alone (mirrors `VaultAPI.createItem`'s own "a 201 is not evidence"
//  discipline: the touch endpoint's 200 is not evidence either).
//
//  Added as a Rule 2 deviation (not in this plan's `files_modified`, which
//  predates the need for a dedicated live evidence file for this specific
//  acceptance criterion) -- mirrors `AccountFlowLiveTests.swift`'s own
//  register-then-drive-production-code shape.
//

import Foundation
import Testing
@testable import PasskeyVault

struct ItemDetailTouchLiveTests {

    private static var baseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    private static func freshEmail() -> String {
        "ios-detail-touch-\(UUID().uuidString.lowercased())@example.com"
    }

    private static let fixturePassword = "correct horse battery staple (38-07 ItemDetailTouchLiveTests)"

    /// `@MainActor`: `VaultStore` is main-actor isolated (T-38-02-03's own
    /// discipline for the unlocked key handle), so this test -- which
    /// constructs and drives one directly, the same way `ItemListView` does
    /// -- must be too.
    @Test @MainActor func touchingAnItemAdvancesLastUsedAtWithoutBumpingRevision() async throws {
        let email = Self.freshEmail()
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.register(email: email, password: Self.fixturePassword)

        let api = VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token })
        let store = VaultStore(userKey: session.userKey, api: api)

        let created = try await store.create(
            noteNamed: "38-07 touch live check", body: "created for ItemDetailTouchLiveTests"
        )
        #expect(created.revision == 1)

        // BEFORE the touch: the server's OWN idea of the row, never assumed
        // from the create response.
        let beforeSync = try await api.sync(since: 0)
        guard case let .snapshot(_, beforeItems, _) = beforeSync,
              let beforeRow = beforeItems.first(where: { $0.id == created.id })
        else {
            Issue.record("created item did not appear in the sync snapshot before touching it")
            return
        }
        #expect(beforeRow.last_used_at == nil, "a freshly created item must carry no last_used_at yet")
        #expect(beforeRow.revision == 1)

        // The EXACT call `ItemDetailView`'s reveal and copy handlers make.
        let touchResponse = try await api.touchItem(id: created.id)
        #expect(!touchResponse.last_used_at.isEmpty)

        // AFTER the touch: read back from `GET /api/sync`, not from the
        // touch response alone.
        let afterSync = try await api.sync(since: 0)
        guard case let .snapshot(_, afterItems, _) = afterSync,
              let afterRow = afterItems.first(where: { $0.id == created.id })
        else {
            Issue.record("created item did not appear in the sync snapshot after touching it")
            return
        }
        #expect(afterRow.last_used_at != nil, "last_used_at must have advanced from nil")
        #expect(afterRow.last_used_at == touchResponse.last_used_at)
        #expect(afterRow.revision == beforeRow.revision, "a touch must NEVER bump revision")
    }
}
