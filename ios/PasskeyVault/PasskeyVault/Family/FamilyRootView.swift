//
//  FamilyRootView.swift
//  PasskeyVault
//
//  Phase 40 REVIEW-FIX (CR-04): the navigation home
//  `VaultRootView.swift:59`'s avatar-menu "Family" entry now routes to --
//  hosts `MemberListView` (the roster, with removal wired -- see that
//  file's own CR-04 note) and an "Invite" toolbar action presenting
//  `InviteCreateView`. Every child screen here (`MemberListView`,
//  `InviteCreateView`, `RemoveMemberService`) is EXISTING, individually
//  tested Phase 40 code -- this file is production wiring only, not a
//  rewrite of any of it.
//

import SwiftUI

struct FamilyRootView: View {
    let baseURL: URL
    let tokenProvider: () -> String?
    let userKey: FfiUserKey
    let ownUserId: String

    @State private var showingInvite = false

    private var familyAPI: FamilyAPI {
        FamilyAPI(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    private var inviteService: InviteService {
        InviteService(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    private var removeMemberService: RemoveMemberService {
        RemoveMemberService(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    var body: some View {
        MemberListView(
            familyAPI: familyAPI, ownUserId: ownUserId,
            removeMemberService: removeMemberService, userKey: userKey
        )
        .navigationTitle(Text(verbatim: "Rodzina"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showingInvite = true
                } label: {
                    Label("Zaproś", systemImage: "person.badge.plus")
                }
                .accessibilityIdentifier("vault.family.inviteCta")
            }
        }
        .sheet(isPresented: $showingInvite) {
            NavigationStack {
                InviteCreateView(inviteService: inviteService, userKey: userKey)
            }
        }
    }
}
