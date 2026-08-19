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
//  CR-04(b) (40-REVIEW.md, iteration 2): before this fix, a solo
//  self-hoster (an account belonging to no family) tapped "Family" and
//  landed on `MemberListView`'s generic loadError -- "Nie udało się
//  wczytać listy członków." with a Retry button that would 404 forever,
//  with NO path to either create a family or join one via a link. Two gaps
//  closed:
//
//  1. `MemberListView.onNoFamilyDetected` (that file's own new callback)
//     flips `hasNoFamily` here instead of falling into the generic error
//     state -- `families.rs::members`'s 404 for a non-member is the
//     PRIMARY, expected state for this persona, not a load failure.
//  2. `noFamilyState` offers BOTH "Załóż rodzinę" (the missing
//     `FamilyAPI.createFamily` call, `POST /api/families`) and "Mam link
//     zaproszenia" (presents `InviteRedeemView` manually, pre-filled
//     empty -- that view already accepts a pasted link via its own
//     `initialURLText`/text field). The manual route is the sturdier fix
//     per the review's own note: it does not depend on any URL-scheme/
//     associated-domains infra landing first, and covers the SAME
//     `InviteRedeemView`/`InviteRedemptionService` surface
//     `ContentView.onOpenURL`'s deep link uses.
//
//  Both actions re-derive `hasNoFamily`/reload the roster via
//  `memberListReloadToken` (an `.id()` remount) rather than a manual
//  `members` array mutation -- the SAME "never optimistically flip local
//  state, re-fetch from the server" discipline `MemberListView.verify(_:)`
//  already established.
//

import SwiftUI

struct FamilyRootView: View {
    let baseURL: URL
    let tokenProvider: () -> String?
    let userKey: FfiUserKey
    let ownUserId: String
    /// WR-20 (40-REVIEW.md, iteration 2): called after this account
    /// creates or joins a family in THIS session -- see
    /// `FamilySharingContext`'s own doc comment for what this invalidates.
    let onFamilyMembershipChanged: () -> Void

    @State private var showingInvite = false
    @State private var showingRedeemInvite = false
    /// CR-04(b): flipped by `MemberListView.onNoFamilyDetected` on a 404
    /// from `GET /api/families/members` -- "not a member of any family",
    /// the primary state for a solo self-hoster, never a load failure.
    @State private var hasNoFamily = false
    @State private var isCreatingFamily = false
    @State private var createFamilyError: String?
    /// 40-VERIFICATION.md human item (self-hosted-singleton-family dead
    /// end): flipped on a 409 from `POST /api/families` -- see
    /// `isFamilyAlreadyExistsConflict(_:)`'s own note for why this is a
    /// DIFFERENT state from the generic `createFamilyError` above, never
    /// folded into it.
    @State private var showingFamilyAlreadyExistsAlert = false
    /// Forces `MemberListView` to remount (and so re-run its own `.task`
    /// load) after a family is created or an invite is redeemed --
    /// `MemberListView` has no public `reload()` of its own, and adding one
    /// just to be called once from here would duplicate the `.task`
    /// lifecycle it already has.
    @State private var memberListReloadToken = UUID()

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
        Group {
            if hasNoFamily {
                noFamilyState
            } else {
                MemberListView(
                    familyAPI: familyAPI, ownUserId: ownUserId,
                    removeMemberService: removeMemberService, userKey: userKey,
                    onNoFamilyDetected: { hasNoFamily = true }
                )
                .id(memberListReloadToken)
            }
        }
        .navigationTitle(Text(verbatim: "Rodzina"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // CR-04(b): inviting someone requires an existing family this
            // caller belongs to -- offering the CTA while `hasNoFamily` is
            // true would open `InviteCreateView` onto a family that does
            // not exist for this account, the exact "an operation known to
            // fail" shape this project's own header discipline
            // (`ItemCapabilities.swift`) forbids elsewhere.
            if !hasNoFamily {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showingInvite = true
                    } label: {
                        Label("Zaproś", systemImage: "person.badge.plus")
                    }
                    .accessibilityIdentifier("vault.family.inviteCta")
                }
            }
        }
        .sheet(isPresented: $showingInvite) {
            NavigationStack {
                InviteCreateView(inviteService: inviteService, userKey: userKey)
            }
        }
        // CR-04(b): the manual redemption entry point -- reachable
        // regardless of `hasNoFamily` (a member of one family can still
        // redeem an invite into... no, `InviteRedeemView`'s own server-side
        // gate handles that; this sheet is offered from BOTH the no-family
        // empty state's own button AND could be wired elsewhere later, so
        // it lives at the root rather than nested inside `noFamilyState`).
        .sheet(isPresented: $showingRedeemInvite) {
            NavigationStack {
                InviteRedeemView(
                    baseURL: baseURL, tokenProvider: tokenProvider, userKey: userKey,
                    onFinished: {
                        showingRedeemInvite = false
                        hasNoFamily = false
                        memberListReloadToken = UUID()
                        // WR-20: this account just joined a family
                        // in-session -- invalidate both stale caches.
                        onFamilyMembershipChanged()
                    },
                    initialURLText: ""
                )
            }
        }
    }

    // MARK: - CR-04(b): no-family empty state

    @ViewBuilder
    private var noFamilyState: some View {
        VStack(spacing: PVMetrics.fieldStackGap) {
            Spacer()
            Image(systemName: "person.2")
                .font(.system(size: 40))
                .foregroundStyle(Color("PVTextMuted"))
            Text(verbatim: "Nie masz jeszcze rodziny")
                .font(.system(size: PVMetrics.titleSize, weight: .semibold))
                .foregroundStyle(Color("PVTextPrimary"))
            Text(
                verbatim: "Załóż rodzinę, aby zapraszać innych, albo wklej link zaproszenia, "
                    + "jeśli ktoś już Cię zaprosił."
            )
            .font(.system(size: PVMetrics.subtitleSize))
            .foregroundStyle(Color("PVTextMuted"))
            .multilineTextAlignment(.center)
            .padding(.horizontal, PVMetrics.fieldStackGap)

            if let createFamilyError {
                StatusCallout(text: createFamilyError, tone: .error)
                    .accessibilityIdentifier("vault.family.createFamilyError")
            }

            Button {
                Task { await createFamily() }
            } label: {
                if isCreatingFamily {
                    ProgressView().tint(Color("PVOnAccent"))
                } else {
                    Text(verbatim: "Załóż rodzinę")
                }
            }
            .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isCreatingFamily))
            .disabled(isCreatingFamily)
            .accessibilityIdentifier("vault.family.createFamilyCta")

            Button {
                showingRedeemInvite = true
            } label: {
                Text(verbatim: "Mam link zaproszenia")
            }
            .buttonStyle(PVGhostButtonStyle())
            .accessibilityIdentifier("vault.family.redeemInviteCta")

            Spacer()
        }
        .padding(.horizontal, PVMetrics.screenHPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("PVBackground"))
        // 40-VERIFICATION.md human item: honest copy for the singleton-
        // family dead end, as a native alert rather than folded into the
        // generic inline `createFamilyError` callout above -- same
        // "distinct copy for a distinct, actionable cause" discipline
        // WR-18's `.alert` on `MemberListView` already established for
        // `.rekeySetMismatch`. Points at the ACTUAL working path ("Mam link
        // zaproszenia") rather than "Spróbuj ponownie", which retries the
        // SAME 409 forever on a server that already has its one family.
        .alert(
            "Ten serwer obsługuje tylko jedną rodzinę, a już istnieje.",
            isPresented: $showingFamilyAlreadyExistsAlert
        ) {
            Button("Mam link zaproszenia") { showingRedeemInvite = true }
            Button("OK", role: .cancel) {}
        } message: {
            Text(
                verbatim: "Jeśli ktoś Cię zaprosił, wklej link zaproszenia zamiast zakładać nową rodzinę."
            )
        }
    }

    /// CR-04(b): the missing create-family client call --
    /// `FamilyAPI.createFamily(name:)`, `POST /api/families`
    /// (`families.rs::create`). A hard-coded default name: this screen has
    /// no name-entry field of its own (`40-UI-SPEC.md` names no such
    /// control), and a family's `name` is otherwise only ever surfaced back
    /// to the owner via `GET /api/families` -- unused elsewhere on iOS
    /// today, so a placeholder default costs nothing a future rename
    /// affordance could not fix.
    private func createFamily() async {
        isCreatingFamily = true
        createFamilyError = nil
        defer { isCreatingFamily = false }
        do {
            _ = try await familyAPI.createFamily(name: "Rodzina")
            hasNoFamily = false
            memberListReloadToken = UUID()
            // WR-20: this account just created a family in-session --
            // invalidate both stale caches.
            onFamilyMembershipChanged()
        } catch {
            if Self.isFamilyAlreadyExistsConflict(error) {
                showingFamilyAlreadyExistsAlert = true
            } else {
                createFamilyError = "Nie udało się założyć rodziny. Spróbuj ponownie."
            }
        }
    }

    /// 40-VERIFICATION.md human item: `families.rs::create`'s own doc
    /// comment (`crates/pv-server/src/routes/families.rs:36-40`) -- the
    /// server enforces a SINGLETON family (v0.4's locked CONTEXT.md
    /// decision), so a second `POST /api/families` always 409s with
    /// `"family already exists"`, reachable-not-hypothetical on any
    /// self-hosted server a member-less caller opens this screen on.
    /// Distinguished from every other `createFamily` failure (network,
    /// 401, 5xx) the same way `MemberListView.isRekeySetMismatch`/
    /// `ShareItemPresenter.isNoFamilyError` already distinguish THEIR one
    /// actionable cause from a generic one -- `internal`, not `private`,
    /// so a future test can falsify it directly without going through the
    /// live network path.
    static func isFamilyAlreadyExistsConflict(_ error: Error) -> Bool {
        if case let PvApiError.httpError(status, _) = error, status == 409 { return true }
        return false
    }
}
