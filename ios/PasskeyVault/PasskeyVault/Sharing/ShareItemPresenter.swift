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
    @State private var isLoading = true

    private var familyAPI: FamilyAPI {
        FamilyAPI(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    private func load() async {
        do {
            async let membersTask = familyAPI.fetchMembers()
            async let encKeyTask = store.fetchRawEncKeyJson(forOwnedItemId: itemId)
            let (fetchedMembers, encKeyJson) = try await (membersTask, encKeyTask)
            guard let encKeyJson else {
                // family.membersLoadFailed's own register, ported: the
                // item's own row was not found in the caller's OWN sync
                // snapshot -- should not happen for an item this sheet was
                // opened FOR, but never force-unwraps into a crash.
                loadError = "Nie udało się wczytać danych itemu do udostępnienia."
                isLoading = false
                return
            }
            members = fetchedMembers
            loadedItem = ShareableItem(itemId: itemId, encKeyJson: encKeyJson, displayName: displayName)
        } catch {
            loadError = "Nie udało się wczytać listy członków rodziny."
        }
        isLoading = false
    }
}
