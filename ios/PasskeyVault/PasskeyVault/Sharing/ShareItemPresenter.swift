//
//  ShareItemPresenter.swift
//  PasskeyVault
//
//  Phase 40 REVIEW-FIX (CR-04 item 4): the presentation wrapper
//  `ShareItemView` needed to actually be reachable. `ShareItemView` itself
//  requires `members: [FamilyAPI.FamilyMemberRecord]` and
//  `item: ShareableItem` (carrying the item's raw `encKeyJson`) up front,
//  neither of which `ItemDetailView`'s call site has synchronously --
//  this view loads both, then hands off to the real, already-tested
//  `ShareItemView`. Production wiring only; `ShareItemView`'s own crypto
//  and UI are unchanged.
//

import SwiftUI

struct ShareItemPresenter: View {
    let itemId: String
    let displayName: String
    let store: VaultStore
    let baseURL: URL
    let tokenProvider: () -> String?
    let userKey: FfiUserKey
    let ownUserId: String

    @State private var loadedItem: ShareableItem?
    @State private var members: [FamilyAPI.FamilyMemberRecord] = []
    @State private var loadError: String?
    /// WR-25 (40-REVIEW.md, iteration 2): distinct from `loadError` -- a
    /// 404 from `fetchMembers()` means "not a member of any family"
    /// (`families.rs::members`'s own doc comment), never a load failure.
    /// Same distinction `MemberListView.onNoFamilyDetected` makes for the
    /// roster screen, applied here for the Share sheet.
    @State private var hasNoFamily = false
    @State private var isLoading = true

    private var familyAPI: FamilyAPI {
        FamilyAPI(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if hasNoFamily {
                noFamilyState
            } else if let loadError {
                VStack(spacing: 12) {
                    Text(verbatim: loadError)
                        .foregroundStyle(Color("PVTextMuted"))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadedItem {
                ShareItemView(
                    item: loadedItem, ownerUserKey: userKey, ownUserId: ownUserId,
                    members: members, familyAPI: familyAPI
                )
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var noFamilyState: some View {
        VStack(spacing: 12) {
            Text(verbatim: "Nie masz jeszcze rodziny.")
                .foregroundStyle(Color("PVTextPrimary"))
            Text(verbatim: "Załóż rodzinę lub dołącz do niej w zakładce „Rodzina”, aby udostępniać itemy.")
                .font(.system(size: PVMetrics.footnoteSize))
                .foregroundStyle(Color("PVTextMuted"))
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, PVMetrics.screenHPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("vault.share.noFamilyState")
    }

    /// WR-25 (40-REVIEW.md, iteration 2): the two independent reads
    /// (`familyAPI.fetchMembers()`, `store.fetchRawEncKeyJson(...)`) are now
    /// awaited and diagnosed SEPARATELY -- the pre-fix single `catch`
    /// covered both, and always rendered ONE message
    /// ("Nie udało się wczytać listy członków rodziny.") regardless of
    /// which call failed or why. A locked store (`VaultStoreError.locked`),
    /// a decode failure, or a network drop on the ITEM read all misreported
    /// as a roster problem; a 404 from `fetchMembers()` ("not a member of
    /// any family" -- the PRIMARY state for a solo self-hoster) misreported
    /// as a generic failure with no path forward.
    private func load() async {
        let membersResult: Result<[FamilyAPI.FamilyMemberRecord], Error>
        let encKeyResult: Result<String?, Error>
        async let fetchedMembers = Self.result { try await familyAPI.fetchMembers() }
        async let fetchedEncKey = Self.result { try await store.fetchRawEncKeyJson(forOwnedItemId: itemId) }
        (membersResult, encKeyResult) = await (fetchedMembers, fetchedEncKey)

        switch membersResult {
        case let .failure(error) where Self.isNoFamilyError(error):
            hasNoFamily = true
            isLoading = false
            return
        case .failure:
            loadError = "Nie udało się wczytać listy członków rodziny."
            isLoading = false
            return
        case let .success(fetchedMembers):
            members = fetchedMembers
        }

        switch encKeyResult {
        case .failure(VaultStoreError.locked):
            loadError = "Vault jest zablokowany."
        case .failure:
            loadError = "Nie udało się wczytać danych itemu do udostępnienia."
        case let .success(encKeyJson):
            guard let encKeyJson else {
                // family.membersLoadFailed's own register, ported: the
                // item's own row was not found in the caller's OWN sync
                // snapshot -- should not happen for an item this sheet was
                // opened FOR, but never force-unwraps into a crash.
                loadError = "Nie udało się wczytać danych itemu do udostępnienia."
                isLoading = false
                return
            }
            loadedItem = ShareableItem(itemId: itemId, encKeyJson: encKeyJson, displayName: displayName)
        }
        isLoading = false
    }

    private static func result<T>(_ body: () async throws -> T) async -> Result<T, Error> {
        do {
            return .success(try await body())
        } catch {
            return .failure(error)
        }
    }

    /// `internal`, not `private` -- `ShareItemPresenterErrorTests` exercises
    /// this directly (WR-25's own falsifiability note), same visibility
    /// discipline `MemberListView.isNoFamilyError`/`.isRekeySetMismatch`
    /// already established.
    static func isNoFamilyError(_ error: Error) -> Bool {
        if case let PvApiError.httpError(status, _) = error, status == 404 { return true }
        return false
    }
}
