//
//  InviteRedeemView.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-09, Task 1.
//  `40-UI-SPEC.md` §0.5: this screen has NO drawn reference in
//  `screens-vault.html` -- the drawing covers invite AUTHORING (the
//  link-sheet, `InviteCreateView.swift`) but not invite REDEMPTION on iOS.
//  Per that section's own resolution ("Claude's discretion"): port the web
//  redemption screen's copy verbatim where an exact dictionary key exists
//  (`invite.joinHeading`, `invite.invitedBy`, `invite.fingerprintLabel`,
//  `invite.fingerprintHonesty`, `invite.fingerprintUnavailable`,
//  `invite.alreadyMemberNotice`, `invite.joinFailedRetryable`,
//  `invite.joining`, `invite.continueToVaultCta`), into the app's existing
//  screen-scaffold chrome (`PVScreenScaffold`/`PVScreenTitle`/
//  `PVPrimaryButtonStyle`/`StatusCallout`/`pvFieldChrome()`) rather than
//  composing new copy or layout -- same discipline `InviteCreateView.swift`'s
//  own header already documents for its own screen.
//
//  Structurally simpler than `web/src/components/invite/InviteLandingView.tsx`:
//  that component is a public, unauthenticated LANDING page with its own
//  register/login sub-flow (`AccountBranch`), because a web visitor may
//  arrive with no session at all. iOS redemption happens INSIDE the
//  already-authenticated app -- there is no guest state to build, so this
//  screen has no register/login branch, no `invite.registerAndJoinCta`, no
//  `invite.currentAccountNotice`/`invite.joinAsDifferentAccount` (both
//  describe a web-only "you're logged in as X, join as someone else?"
//  affordance this app's own single-account-per-device model has no
//  equivalent for).
//
//  Single-stage flow (paste link, tap Join): `InviteRedemptionService
//  .redeem(url:userKey:)` is ONE call that fetches metadata AND accepts in
//  the same round trip (this plan's own `<action>` text: "Create
//  `Family/InviteRedemptionService.swift` with `redeem(url:userKey:) async
//  throws`" -- no separate preview-only entry point is in this plan's own
//  `files_modified` scope). The web screen's two-stage
//  loading/valid-preview/joining machine is therefore NOT reproduced here --
//  `inviterEmail`/`familyName`/`inviterFingerprint` are rendered AFTER a
//  successful join (from `RedemptionResult`, carried through from the SAME
//  metadata fetch `redeem` already performed), not before. Recorded as a
//  deliberate simplification in this plan's own SUMMARY, not an oversight.
//
//  Per-collection failure report (this plan's own `must_haves.truths`): when
//  one or more `family_wide_keys` entries fail to unwrap, this screen renders
//  which collection id(s) did not travel -- never silently swallowed into a
//  generic "something went wrong".
//

import SwiftUI

struct InviteRedeemView: View {
    let baseURL: URL
    let tokenProvider: () -> String?
    let userKey: FfiUserKey

    @State private var urlText: String = ""
    @State private var isJoining = false
    @State private var result: InviteRedemptionService.RedemptionResult?
    @State private var errorMessage: String?

    private var redemptionService: InviteRedemptionService {
        InviteRedemptionService(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    var body: some View {
        PVScreenScaffold(
            content: {
                // No exact existing dictionary key for this screen's own
                // title (this file's own header, §0.5) -- composed
                // minimally, mirroring `InviteCreateView`'s identical
                // precedent for its own sheet title.
                PVScreenTitle(title: "Dołącz do rodziny")

                StatusCallout(
                    text: "Wklej link zaproszenia, który otrzymałeś/aś od członka rodziny.",
                    tone: .muted
                )
                .accessibilityIdentifier("vault.inviteRedeem.introNote")
                .padding(.top, PVMetrics.fieldStackGap)

                VStack(alignment: .leading, spacing: PVMetrics.fieldStackGap) {
                    TextField("Link zaproszenia", text: $urlText)
                        .font(.system(size: PVMetrics.subtitleSize, design: .monospaced))
                        .foregroundStyle(Color("PVTextPrimary"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .pvFieldChrome()
                        .accessibilityIdentifier("vault.inviteRedeem.linkField")
                }
                .padding(.top, PVMetrics.fieldStackGap)

                if let result {
                    VStack(alignment: .leading, spacing: PVMetrics.footnoteTopSpace) {
                        if result.alreadyMember {
                            // invite.alreadyMemberNotice, interpolated with
                            // this run's real family name.
                            StatusCallout(
                                text: "Jesteś już członkiem/członkinią \(result.familyName). Przenosimy Cię do vaulta.",
                                tone: .muted
                            )
                            .accessibilityIdentifier("vault.inviteRedeem.alreadyMemberNotice")
                        } else {
                            // invite.invitedBy, interpolated.
                            StatusCallout(
                                text: "Zaprasza: \(result.inviterEmail). Dołączono do rodziny \(result.familyName).",
                                tone: .muted
                            )
                            .accessibilityIdentifier("vault.inviteRedeem.successNotice")
                        }

                        if let fingerprint = result.inviterFingerprint {
                            // invite.fingerprintLabel + invite.fingerprintHonesty,
                            // verbatim -- never gates the join action, which
                            // has already completed by the time this renders.
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Odcisk tożsamości") // invite.fingerprintLabel
                                    .font(.system(size: PVMetrics.footnoteSize, weight: .semibold))
                                    .foregroundStyle(Color("PVTextPrimary"))
                                // CR-01: the SAME six-word transform
                                // `MemberListView` renders -- this screen
                                // previously showed the raw 64-char hex, a
                                // THIRD format the roster screen disagreed
                                // with. Fails closed to the raw hex only if
                                // the server ever sends a malformed value.
                                Text(MemberListView.displayFingerprint(fingerprint))
                                    .font(.system(size: PVMetrics.footnoteSize, design: .monospaced))
                                    .foregroundStyle(Color("PVTextMuted"))
                                    .accessibilityIdentifier("vault.inviteRedeem.fingerprintValue")
                                Text(
                                    "Ten odcisk pozwala zweryfikować tożsamość \(result.inviterEmail), ale musisz to zrobić sam/sama — np. porównując go z tą osobą telefonicznie albo SMS-em. Samo wyświetlenie go tutaj niczego nie weryfikuje."
                                ) // invite.fingerprintHonesty
                                .font(.system(size: PVMetrics.footnoteSize))
                                .foregroundStyle(Color("PVTextMuted"))
                            }
                        } else {
                            // invite.fingerprintUnavailable, interpolated.
                            Text("\(result.inviterEmail) nie ma jeszcze skonfigurowanego klucza tożsamości do zweryfikowania.")
                                .font(.system(size: PVMetrics.footnoteSize))
                                .foregroundStyle(Color("PVTextMuted"))
                        }

                        // Per-collection failure report (this plan's own
                        // must_haves.truths) -- never silently swallowed.
                        if !result.familyWideFailed.isEmpty {
                            StatusCallout(
                                text: "Nie udało się odebrać klucza dla: " +
                                    result.familyWideFailed.map(\.collectionId).joined(separator: ", ") + ".",
                                tone: .error
                            )
                            .accessibilityIdentifier("vault.inviteRedeem.familyWideFailureNote")
                        }
                    }
                    .padding(.top, PVMetrics.fieldStackGap)
                }

                if let errorMessage {
                    // invite.joinFailedRetryable, verbatim.
                    StatusCallout(text: errorMessage, tone: .error)
                        .accessibilityIdentifier("vault.inviteRedeem.errorText")
                        .padding(.top, PVMetrics.fieldStackGap)
                }
            },
            actions: {
                Button {
                    Task { await join() }
                } label: {
                    if isJoining {
                        ProgressView().tint(Color("PVOnAccent"))
                    } else {
                        // invite.continueToVaultCta once already joined;
                        // otherwise the plain join action.
                        Text(result != nil ? "Przejdź do swojego vaulta" : "Dołącz")
                    }
                }
                .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isJoining && !urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                .disabled(isJoining || urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || result != nil)
                .accessibilityIdentifier("vault.inviteRedeem.joinCta")
            }
        )
    }

    private func join() async {
        guard let url = URL(string: urlText.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            // invite.joinFailedRetryable, verbatim.
            errorMessage = "Nie udało się dołączyć. Spróbuj ponownie."
            return
        }
        isJoining = true
        errorMessage = nil
        defer { isJoining = false }
        do {
            result = try await redemptionService.redeem(url: url, userKey: userKey)
        } catch {
            // invite.joinFailedRetryable, verbatim -- the unified failure
            // message, same "never distinguish causes to the user" posture
            // `InviteCreateView.generate()`'s own `invite.generateFailed`
            // catch already established for the authoring side.
            errorMessage = "Nie udało się dołączyć. Spróbuj ponownie."
        }
    }
}
