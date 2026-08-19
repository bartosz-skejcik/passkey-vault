//
//  InviteCreateView.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06, Task 3.
//  Family-scope invite screen -- `40-UI-SPEC.md` §0.4/§5.6: build ONLY the
//  link-sheet invite variant (expiry `PVSegmentedControl`, "Generate link",
//  a `pvFieldChrome()` link field with a trailing "Copy"/`ShareLink`
//  action, an "Expires {date}" caption), per
//  `ios/brand/screens-vault.html`'s "Invite — link sheet". Does NOT render
//  a per-invite View/Edit access-level toggle ("Family — invite", the
//  drawing's OTHER invite screen) -- that implies a capability
//  `InviteService.generateInviteLink` does not implement (the Path A
//  fold-in forwards each ALREADY-HELD family-wide share at its OWN
//  existing level; it never lets the inviter choose a new one at invite
//  time).
//
//  Copy ported verbatim from `web/src/lib/i18n/dictionary.ts` (Polish,
//  this app's shipped language) where a key exists: `invite.expiryLabel`,
//  `invite.expiry1h/24h/7d`, `invite.generateCta`, `invite.expiresAt`,
//  `invite.copyLinkAria`, `invite.generateFailed`. The sheet title and the
//  bearer-link warning have no exact existing dictionary key (recorded in
//  `40-UI-SPEC.md` §5.6 for the title; the warning is new, Rule 2) --
//  composed minimally rather than left silent, per this plan's own
//  `must_haves.truths`: "state plainly, in the UI, that anyone holding the
//  link can join."
//
//  ShareLink is available from iOS 16.0, comfortably under this app's 18.0
//  floor. The trailing "Copy" control IS the `ShareLink` -- tapping it
//  opens the system share sheet (which itself offers Copy among its
//  built-in actions), rather than a bespoke `UIPasteboard` write; this
//  satisfies both this task's own `<action>` text ("presents the resulting
//  URL through SwiftUI's ShareLink") and `40-UI-SPEC.md` §5.6's drawn
//  "Copy" label/`invite.copyLinkAria` accessible name in the same control.
//
//  Does NOT render a collection-scope option as an enabled control --
//  family-scope only (this plan's own `must_haves.prohibitions`, and the
//  Phase 24 precedent `ios/IOS-SPIKE-LOG.md` §1 records).
//

import SwiftUI

/// `.seg{border-radius:9;padding:2} .seg i{padding:5;border-radius:7} .seg
/// i.on{font-weight:600}` -- ONE segmented control, reused by every Phase
/// 40 screen that needs a 2/3-way choice (`40-UI-SPEC.md` §2's own
/// instruction: "ONE component ... reused for" invite expiry / share scope
/// / share access level). Deliberately NOT `Picker(_:selection:)` styled
/// `.segmented` -- that renders the SYSTEM segmented control, a visually
/// different (platform-styled) shape from the artifact's own `.seg` chrome
/// this transcribes.
struct PVSegmentedControl<T: Hashable>: View {
    let options: [(value: T, label: String)]
    @Binding var selection: T

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                let isOn = option.value == selection
                Button {
                    selection = option.value
                } label: {
                    Text(option.label)
                        .font(.system(size: PVMetrics.segFontSize, weight: isOn ? .semibold : .regular))
                        .foregroundStyle(isOn ? Color("PVOnAccent") : Color("PVTextMuted"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, PVMetrics.segItemVPadding)
                        .background(
                            RoundedRectangle(cornerRadius: PVMetrics.segItemRadius, style: .continuous)
                                .fill(isOn ? Color("PVAccent") : Color.clear)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isOn ? [.isSelected] : [])
            }
        }
        .padding(PVMetrics.segTrackPadding)
        .background(
            RoundedRectangle(cornerRadius: PVMetrics.segTrackRadius, style: .continuous)
                .fill(Color("PVSurface"))
        )
    }
}

/// `invite.expiry1h/24h/7d` -- the ONLY three values `POST /api/invitations`
/// accepts (`crates/pv-server/src/routes/invitations.rs::create`'s closed
/// `match`). Never widen this set -- this task's own `<action>` text:
/// "Keep the expiry at the server's existing default; do not widen it."
enum InviteExpiryOption: String, CaseIterable, Identifiable {
    case oneHour = "1h"
    case oneDay = "24h"
    case sevenDays = "7d"

    var id: String { rawValue }

    /// `invite.expiry1h/24h/7d`, Polish, verbatim (`web/src/lib/i18n/dictionary.ts`).
    var label: String {
        switch self {
        case .oneHour: return "1 godzinie"
        case .oneDay: return "24 godzinach"
        case .sevenDays: return "7 dniach"
        }
    }
}

struct InviteCreateView: View {
    let inviteService: InviteService
    let userKey: FfiUserKey

    @State private var expiry: InviteExpiryOption = .oneDay // "24 hours" selected by default, per §5.6's drawing.
    @State private var generatedURL: URL?
    @State private var expiresAtCaption: String?
    @State private var isGenerating = false
    @State private var errorMessage: String?

    var body: some View {
        PVScreenScaffold(
            content: {
                // No exact existing dictionary key for the sheet title
                // (`40-UI-SPEC.md` §5.6's own note) -- composed minimally.
                PVScreenTitle(title: "Zaproś do rodziny")

                StatusCallout(
                    text: "Każdy, kto otrzyma ten link, może dołączyć do Twojej rodziny — sekret podróżuje wewnątrz linku. Udostępniaj go tylko zaufanym osobom.",
                    tone: .warning
                )
                .accessibilityIdentifier("vault.invite.warningNote")
                .padding(.top, PVMetrics.fieldStackGap)

                VStack(alignment: .leading, spacing: PVMetrics.fieldStackGap) {
                    Text("Link wygasa po") // invite.expiryLabel
                        .font(.system(size: PVMetrics.footnoteSize))
                        .foregroundStyle(Color("PVTextMuted"))

                    PVSegmentedControl(
                        options: InviteExpiryOption.allCases.map { ($0, $0.label) },
                        selection: $expiry
                    )
                    .accessibilityIdentifier("vault.invite.expirySegment")
                }
                .padding(.top, PVMetrics.fieldStackGap)

                if let generatedURL, let expiresAtCaption {
                    VStack(alignment: .leading, spacing: PVMetrics.footnoteTopSpace) {
                        HStack {
                            Text(generatedURL.absoluteString)
                                .font(.system(size: PVMetrics.subtitleSize, design: .monospaced))
                                .foregroundStyle(Color("PVTextPrimary"))
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                                .accessibilityIdentifier("vault.invite.linkField")

                            Spacer(minLength: PVMetrics.slotGap)

                            ShareLink(item: generatedURL) {
                                Text("Skopiuj") // "Copy" label, per §5.6's drawing
                                    .font(.system(size: PVMetrics.footnoteSize, weight: .semibold))
                                    .foregroundStyle(Color("PVAccent"))
                            }
                            .accessibilityIdentifier("vault.invite.copyLink")
                            .accessibilityLabel("Skopiuj link zaproszenia") // invite.copyLinkAria
                        }
                        .pvFieldChrome()

                        Text("Wygasa \(expiresAtCaption)") // invite.expiresAt
                            .font(.system(size: PVMetrics.footnoteSize))
                            .foregroundStyle(Color("PVTextMuted"))
                            .accessibilityIdentifier("vault.invite.expiresCaption")
                    }
                    .padding(.top, PVMetrics.fieldStackGap)
                }

                if let errorMessage {
                    StatusCallout(text: errorMessage, tone: .error)
                        .accessibilityIdentifier("vault.invite.errorText")
                        .padding(.top, PVMetrics.fieldStackGap)
                }
            },
            actions: {
                Button {
                    Task { await generate() }
                } label: {
                    if isGenerating {
                        ProgressView().tint(Color("PVOnAccent"))
                    } else {
                        Text("Wygeneruj link") // invite.generateCta
                    }
                }
                .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isGenerating))
                .disabled(isGenerating)
                .accessibilityIdentifier("vault.invite.generateCta")
            }
        )
    }

    private func generate() async {
        isGenerating = true
        errorMessage = nil
        defer { isGenerating = false }
        do {
            let url = try await inviteService.generateInviteLink(userKey: userKey, expiresIn: expiry.rawValue)
            generatedURL = url
            expiresAtCaption = Self.formattedExpiry(for: expiry)
        } catch {
            // invite.generateFailed, verbatim.
            errorMessage = "Nie udało się wygenerować linku. Spróbuj ponownie."
        }
    }

    /// A relative, human phrase ("za 24 godziny") rather than parsing the
    /// server's own `expires_at` timestamp back out of the create
    /// response -- `InviteService.generateInviteLink` does not currently
    /// surface `expires_at` to its caller (kept internal to `FamilyAPI`'s
    /// result type), and re-deriving the SAME relative duration the user
    /// just picked is simpler and cannot drift from what the segment shows.
    private static func formattedExpiry(for option: InviteExpiryOption) -> String {
        switch option {
        case .oneHour: return "za 1 godzinę"
        case .oneDay: return "za 24 godziny"
        case .sevenDays: return "za 7 dni"
        }
    }
}
