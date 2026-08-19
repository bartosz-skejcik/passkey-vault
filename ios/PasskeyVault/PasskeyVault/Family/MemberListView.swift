//
//  MemberListView.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-07, Task 1.
//  The family roster (`40-UI-SPEC.md` §5.5): every member's status and
//  identity fingerprint, with an out-of-band fingerprint-verification
//  action -- the surfaced mitigation for T-40-30 (a compromised server
//  substituting its own public key as a member's; `identity.rs::seal`'s
//  own WR-10 note is explicit that an anonymous sealed box authenticates
//  nobody, so comparing the fingerprint over a channel the server does not
//  control is the only thing that closes this at this layer).
//
//  Built complete, real, and independently instantiable -- the SAME "built,
//  functional, not yet threaded into the live nav stack" shape
//  `InviteCreateView.swift` (40-06) and `Sharing/ShareItemView.swift`
//  (40-08) already shipped in this codebase, rather than reaching into
//  `VaultRootView.swift:59`'s still-`disabled(true)` avatar-menu "Family"
//  entry to force a wiring no Phase 40 plan through this one has scheduled
//  (`ShareItemView.swift`'s own header records the identical judgment call).
//
//  Renders MEMBERS only -- no pending-invites section (`40-UI-SPEC.md`
//  §5.5's "Invited" `.glab` group): `FamilyAPI` has no invites-LIST endpoint
//  for this plan's own acceptance criteria to exercise (`InviteService`
//  only ever CREATES one), and inventing that read surface is out of this
//  task's scope. Recorded, not silently dropped.
//
//  Does NOT wire a removal action -- `RemoveMemberService.swift` (Task 2)
//  is a standalone, independently-testable service, exactly like
//  `ShareItemComposer`'s own "pure logic, testable without constructing the
//  view" precedent; this plan's own `files_modified` lists no removal-
//  confirmation view, and none of Tasks 1-3's acceptance criteria ask for
//  one.
//
//  Display name: `FamilyMemberRecord` carries no separate display-name
//  field on the wire (only `email`) -- unlike `ios/brand/screens-vault
//  .html`'s mockup names ("Anna"/"Marek"), this view's row title is the
//  member's email, with a "Ty" (`family.youBadge`) marker beside the
//  caller's own row rather than substituting "You" as the title itself.
//  Documented simplification, not an omission of the wire data.
//

import SwiftUI

/// The three DISTINCT rendering states a roster row's fingerprint line can
/// be in -- split out of `MemberListView`'s own body so it is independently
/// testable without constructing a view at all (mirrors `ShareItemComposer
/// .recipients`'s own "pure logic, testable directly" precedent in
/// `Sharing/ShareItemView.swift`). `.noPublishedKey` and `.notYetVerified`
/// must stay genuinely distinct cases, never collapsed into one "nothing to
/// show" state -- conflating them hides exactly the condition
/// (`RemoveMemberService`'s "recipient missing a published key" throw) that
/// makes a reseal to that recipient impossible.
enum MemberFingerprintDisplayState: Equatable {
    case noPublishedKey
    case notYetVerified(fingerprint: String)
    case verified(fingerprint: String)

    /// `member.publicKey == nil` (never published a keypair) is the ONLY
    /// path to `.noPublishedKey` -- a present `publicKey` with a nil
    /// `fingerprint` cannot occur on the real wire (`families.rs`'s own
    /// `FamilyMemberRecord` doc comment: "`Some(hex)` only when `public_key`
    /// is `Some`"), but this guard still requires both non-nil defensively
    /// rather than force-unwrapping `fingerprint`.
    static func resolve(_ member: FamilyAPI.FamilyMemberRecord) -> MemberFingerprintDisplayState {
        guard let publicKey = member.publicKey, !publicKey.isEmpty, let fingerprint = member.fingerprint else {
            return .noPublishedKey
        }
        return member.verifiedAt != nil ? .verified(fingerprint: fingerprint) : .notYetVerified(fingerprint: fingerprint)
    }
}

struct MemberListView: View {
    let familyAPI: FamilyAPI
    let ownUserId: String
    /// CR-04 (40-REVIEW.md): wired in by this fix -- see `removalConfirmationDialog`
    /// below for the confirmation this file's own header previously
    /// recorded as deliberately out of Task 1's scope.
    let removeMemberService: RemoveMemberService
    let userKey: FfiUserKey

    @State private var members: [FamilyAPI.FamilyMemberRecord] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var verifyingMemberId: String?
    @State private var verifyErrorMemberId: String?
    /// CR-04: the member a tap on a non-self row is confirming removal
    /// for -- drives `removalConfirmationDialog` below.
    @State private var removalCandidate: FamilyAPI.FamilyMemberRecord?
    @State private var isRemoving = false
    @State private var removeErrorMemberId: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color("PVBackground"))
            } else if let loadError {
                errorState(loadError)
            } else {
                List {
                    Section {
                        ForEach(members, id: \.userId) { member in
                            row(member)
                        }
                    } header: {
                        Text(verbatim: "Członkowie") // family.membersHeading
                    }

                    Section {
                        // `40-UI-SPEC.md` §5.5's footer -- the boundary
                        // statement the drawing's own caption names ("family"
                        // does not mean the whole vault is visible). NEW,
                        // composed minimally: no single existing dictionary
                        // key states this generically (`member
                        // .removeHonestyWarning` is per-member, `{email}`-
                        // interpolated, and this screen has no removal UI to
                        // attach it to -- see this file's own header).
                        StatusCallout(
                            text: "Rodzina nie oznacza dostępu do całego vaulta — każdy członek widzi tylko to, co zostało mu bezpośrednio udostępnione.",
                            tone: .muted
                        )
                        .accessibilityIdentifier("vault.family.footer")
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
                .scrollContentBackground(.hidden)
                .background(Color("PVBackground"))
            }
        }
        .task { await load() }
        .confirmationDialog(
            removalCandidate.map { "Usunąć \($0.email) z rodziny?" } ?? "",
            isPresented: Binding(
                get: { removalCandidate != nil },
                set: { if !$0 { removalCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            // CR-04: the native `.confirmationDialog` carrying the honest
            // re-key copy the review's fix asks for -- direct shares are
            // NOT re-wrapped on removal (CR-02's same mechanism
            // distinction), only collection-scoped items get a fresh key.
            Button("Usuń", role: .destructive) {
                if let removalCandidate {
                    Task { await performRemoval(removalCandidate) }
                }
            }
            Button("Anuluj", role: .cancel) { removalCandidate = nil }
        } message: {
            if let removalCandidate {
                Text(
                    "Utraci dostęp do wspólnych kolekcji (klucz zostanie wymieniony dla pozostałych osób) "
                        + "oraz do itemów bezpośrednio jej udostępnionych (wpis zostanie usunięty, ale klucz "
                        + "NIE zostanie zmieniony — jeśli hasło ma przestać być dla niej ważne, zmień je). "
                        + "\(removalCandidate.email) zniknie z listy członków."
                )
            }
        }
        .alert(
            "Nie udało się usunąć członka rodziny. Spróbuj ponownie.",
            isPresented: Binding(
                get: { removeErrorMemberId != nil },
                set: { if !$0 { removeErrorMemberId = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        }
    }

    // MARK: - Row

    /// CR-04: only the caller's OWN row (as the owner) may initiate a
    /// removal -- `RemoveMemberService.removeMember`'s own header: "Owner
    /// removes a DIFFERENT member". A plain member tapping another row
    /// would only reach a server-side 403; gating here keeps the UI from
    /// offering an operation known to fail (same discipline
    /// `ItemCapabilities.swift`'s header states for item actions).
    private var callerIsOwner: Bool {
        members.first(where: { $0.userId == ownUserId })?.role == "owner"
    }

    @ViewBuilder
    private func row(_ member: FamilyAPI.FamilyMemberRecord) -> some View {
        let isSelf = member.userId == ownUserId
        HStack(spacing: 12) {
            Circle()
                .fill(Color("PVSurfaceAlt"))
                .frame(width: 32, height: 32)
                .overlay {
                    Image(systemName: "person.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color("PVTextMuted"))
                }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(verbatim: member.email)
                        .foregroundStyle(Color("PVTextPrimary"))
                    if isSelf {
                        Text(verbatim: "Ty") // family.youBadge
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color("PVTextMuted"))
                    }
                }
                fingerprintLine(member)
                if member.status == "suspended" {
                    Text(verbatim: "Zawieszony/a") // family.statusSuspended
                        .font(.caption)
                        .foregroundStyle(Color("PVWarning"))
                }
            }
            Spacer()
            rolePill(member)
            if !isSelf {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
            }
        }
        .frame(minHeight: PVMetrics.rowMinHeight)
        .contentShape(Rectangle())
        .accessibilityIdentifier("vault.family.row.\(member.userId)")
        // CR-04: tap-to-remove, owner-only, never the caller's own row --
        // `RemoveMemberService.leaveFamily` (self-removal via account
        // deletion) is a deliberately DIFFERENT flow this row does not
        // trigger.
        .onTapGesture {
            guard !isSelf, callerIsOwner, !isRemoving else { return }
            removalCandidate = member
        }
        .accessibilityAddTraits(!isSelf && callerIsOwner ? [.isButton] : [])
    }

    /// Submits the removal batch (`RemoveMemberService.removeMember`, this
    /// file's own header). Re-fetches the roster on success -- the SAME
    /// "never optimistically flip local state" discipline `verify(_:)`
    /// already established, for the identical reason: the server's
    /// response is what actually proves the member is gone.
    private func performRemoval(_ member: FamilyAPI.FamilyMemberRecord) async {
        isRemoving = true
        removalCandidate = nil
        removeErrorMemberId = nil
        defer { isRemoving = false }
        do {
            try await removeMemberService.removeMember(userId: member.userId, userKey: userKey)
            await load()
        } catch {
            removeErrorMemberId = member.userId
        }
    }

    /// THE distinction the plan's own acceptance criteria requires kept
    /// separate: "no published key" (nothing to verify, nothing to compare
    /// -- `identity.fingerprintUnavailable`, ported) vs. "has a fingerprint,
    /// not yet verified" (something to compare, verification offered) vs.
    /// "verified" (already compared). Conflating the first two would hide
    /// the condition that makes a reseal to that recipient impossible.
    @ViewBuilder
    private func fingerprintLine(_ member: FamilyAPI.FamilyMemberRecord) -> some View {
        switch MemberFingerprintDisplayState.resolve(member) {
        case .noPublishedKey:
            // identity.fingerprintUnavailable, ported verbatim -- the
            // "hasn't published a key yet" state, distinct from "published
            // but unverified" below.
            Text(verbatim: "Odcisk pojawi się po pierwszym odblokowaniu vaulta przez tę osobę po aktualizacji.")
                .font(.system(size: 11))
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("vault.family.fingerprint.\(member.userId)")

        case let .notYetVerified(fingerprint):
            fingerprintRow(member, fingerprint: fingerprint, isVerified: false)
        case let .verified(fingerprint):
            fingerprintRow(member, fingerprint: fingerprint, isVerified: true)
        }
    }

    @ViewBuilder
    private func fingerprintRow(
        _ member: FamilyAPI.FamilyMemberRecord, fingerprint: String, isVerified: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                // invite.fingerprintLabel, composed -- full six-word form
                // (CR-01), never the 8-hex-char truncation: a short form
                // gives an attacker ~2^32 keygen+hash trials to forge a
                // colliding-looking key, which defeats the ONLY mitigation
                // this screen has for a substituted identity key.
                Text(verbatim: "Odcisk tożsamości: \(Self.displayFingerprint(fingerprint))")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color("PVTextMuted"))
                    .accessibilityIdentifier("vault.family.fingerprint.\(member.userId)")

                if member.userId != ownUserId {
                    Button {
                        Task { await verify(member) }
                    } label: {
                        // NEW, iOS-only -- no exact dictionary key for
                        // "already verified" vs. "not yet verified" pill
                        // text (the purpose copy itself, `invite
                        // .fingerprintHonesty`, is reused as an accessible
                        // hint below rather than paraphrased).
                        Text(verbatim: isVerified ? "Zweryfikowano" : "Zweryfikuj")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(isVerified ? Color("PVTextMuted") : Color("PVAccent"))
                    }
                    .buttonStyle(.plain)
                    .disabled(verifyingMemberId == member.userId)
                    .accessibilityIdentifier("vault.family.verifyFingerprint.\(member.userId)")
                    // invite.fingerprintHonesty, reused verbatim per
                    // `40-UI-SPEC.md` §6's own instruction for this action.
                    .accessibilityHint(
                        "Ten odcisk pozwala zweryfikować tożsamość \(member.email), ale musisz to zrobić sam/sama — np. porównując go z tą osobą telefonicznie albo SMS-em. Samo wyświetlenie go tutaj niczego nie weryfikuje."
                    )
                }
            }
            if verifyErrorMemberId == member.userId {
                // NEW -- mirrors `member.suspendFailed`/`.reinstateFailed`'s
                // own "Nie udało się ___. Spróbuj ponownie." register; no
                // existing key names fingerprint-verification failure.
                Text(verbatim: "Nie udało się zapisać weryfikacji. Spróbuj ponownie.")
                    .font(.caption2)
                    .foregroundStyle(Color("PVError"))
            }
        }
    }

    @ViewBuilder
    private func rolePill(_ member: FamilyAPI.FamilyMemberRecord) -> some View {
        // family.roleOwner / family.roleMember, ported verbatim. Role is
        // informational, never a warning tone (`40-UI-SPEC.md` §5.5's own
        // row-shape note) -- always `PVTextMuted`.
        Text(verbatim: member.role == "owner" ? "Właściciel/Właścicielka" : "Członek/Członkini")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color("PVTextMuted").opacity(0.15))
            .foregroundStyle(Color("PVTextMuted"))
            .clipShape(Capsule())
    }

    // MARK: - Error state

    @ViewBuilder
    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Text(verbatim: message)
                .foregroundStyle(Color("PVTextMuted"))
            Button {
                Task { await load() }
            } label: {
                Text(verbatim: "Spróbuj ponownie") // family.loadRetryCta
            }
            .buttonStyle(PVGhostButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("PVBackground"))
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        loadError = nil
        do {
            members = try await familyAPI.fetchMembers()
        } catch {
            // family.membersLoadFailed, ported verbatim.
            loadError = "Nie udało się wczytać listy członków."
        }
        isLoading = false
    }

    /// Records THIS viewer's verification of `member`'s fingerprint
    /// (`POST /api/identity/verify/{user_id}`, per-viewer -- never a global
    /// "verified" flag). Re-fetches the roster afterward rather than
    /// optimistically flipping local state, so `verifiedAt` always reflects
    /// what the server actually recorded -- `must_haves.truths`' own claim
    /// ("verifying one member's fingerprint changes only that member's
    /// verified state") is what a re-fetch proves; an optimistic local flip
    /// would prove nothing about the OTHER members staying untouched.
    private func verify(_ member: FamilyAPI.FamilyMemberRecord) async {
        verifyingMemberId = member.userId
        verifyErrorMemberId = nil
        defer { verifyingMemberId = nil }
        do {
            try await familyAPI.verifyFingerprint(userId: member.userId)
            await load()
        } catch {
            verifyErrorMemberId = member.userId
        }
    }

    // MARK: - Fingerprint display

    /// CR-01: the full six-word transform (`IdentityFingerprint.format`,
    /// ported byte-for-byte from `packages/pv-ui/identity/fingerprint.ts`)
    /// over the leading 66 bits of the SHA-256 `fingerprint` -- replaces
    /// the removed `shortFingerprint`'s 8-hex-char (32-bit) truncation,
    /// which was brute-forceable in minutes and rendered a THIRD,
    /// inconsistent format from `InviteRedeemView`'s raw 64-char hex.
    ///
    /// Fails closed: a malformed fingerprint (wrong length, non-hex) never
    /// renders a plausible-looking-but-wrong comparison value -- it falls
    /// back to the full raw hex, which is at least honestly wrong-looking
    /// rather than silently truncated.
    static func displayFingerprint(_ hex: String) -> String {
        (try? IdentityFingerprint.format(hex)) ?? hex
    }
}
