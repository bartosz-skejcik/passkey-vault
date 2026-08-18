//
//  OnboardingServerStep.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-13, Task 2.
//  §3.2: the server is a VALUE, not a question -- one inset-grouped row,
//  `Skip` in the nav bar, reachability checked before `Continue` succeeds.
//
//  `Skip` postpones nonessential setup, per Apple's own onboarding
//  guidance, quoted here so a later reviewer does not "tidy" it away:
//  *"Postpone nonessential setup flows. Provide reasonable default
//  settings."* Most users must be able to continue without touching this
//  screen at all.
//
//  Validation order matters, and it is enforced by `handleContinue()`
//  below: `ServerSettings.normalise(_:)` runs FIRST and renders a refusal
//  without ever touching the network; only a syntactically plausible
//  address costs a round trip through `ServerReachability.check(_:)`. This
//  applies whether the user edited the row or left it at its default --
//  `Continue` always re-validates; only `Skip` is unconditional and
//  network-free.
//

import SwiftUI

struct OnboardingServerStep: View {
    let onAdvance: () -> Void
    let onSkip: () -> Void

    @State private var isEditing = false
    @State private var fieldText = OnboardingServerStep.currentHostText()
    @State private var isChecking = false
    @State private var inlineError: String?
    @State private var successMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Spacer()
                    Button(action: onSkip) {
                        Text(t(.onboardingServerSkip))
                    }
                    .buttonStyle(PVGhostButtonStyle())
                    .accessibilityIdentifier("onboarding-server-skip")
                }

                Text(t(.onboardingServerTitle))
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundStyle(Color("PVTextPrimary"))

                Text(t(.onboardingServerSubtitle))
                    .font(.subheadline)
                    .foregroundStyle(Color("PVTextMuted"))
                    .fixedSize(horizontal: false, vertical: true)

                row

                if isEditing {
                    Text(t(.onboardingServerFooterEditing))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(t(.onboardingServerFooterValue, ["host": OnboardingServerStep.currentHostText()]))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let inlineError {
                    Text(inlineError)
                        .font(.footnote)
                        .foregroundStyle(Color("PVError"))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color("PVSurface"))
                        .accessibilityIdentifier("onboarding-server-error")
                }

                if let successMessage {
                    Text(successMessage)
                        .font(.footnote)
                        .foregroundStyle(Color("PVPasskey"))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color("PVSurface"))
                        .accessibilityIdentifier("onboarding-server-success")
                }

                if isChecking {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text(t(.onboardingServerChecking))
                            .font(.footnote)
                            .foregroundStyle(Color("PVTextMuted"))
                    }
                    .accessibilityIdentifier("onboarding-server-checking")
                }

                Spacer(minLength: 24)

                Button(action: handleContinue) {
                    Text(t(.onboardingServerContinue))
                }
                // WR-05 (38-REVIEW.md): was
                // `.buttonStyle(PVPrimaryButtonStyle())
                // .buttonStyle(PVGhostButtonStyle())` -- the inner (later)
                // modifier wins in SwiftUI, so the ghost style was silently
                // overriding the primary one applied above it. This is the
                // primary CTA; the ghost line was dead by construction, not
                // a deliberate choice.
                .buttonStyle(PVPrimaryButtonStyle())
                .disabled(isChecking)
                .accessibilityIdentifier("onboarding-server-continue")
            }
            .padding()
        }
        .background(Color("PVBackground"))
    }

    @ViewBuilder
    private var row: some View {
        if isEditing {
            HStack(spacing: 4) {
                Text(verbatim: "https://")
                    .foregroundStyle(Color("PVTextMuted"))
                TextField("", text: $fieldText)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    .accessibilityIdentifier("onboarding-server-field")
            }
            .padding(8)
            .background(Color("PVSurfaceAlt"))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        } else {
            Button(action: { isEditing = true; inlineError = nil; successMessage = nil }) {
                HStack {
                    Text(t(.onboardingServerRowLabel))
                        .foregroundStyle(Color("PVTextPrimary"))
                    Spacer()
                    Text(fieldText)
                        .foregroundStyle(Color("PVTextMuted"))
                    Image(systemName: "chevron.right")
                        .foregroundStyle(Color("PVTextMuted"))
                }
                .padding(12)
                .background(Color("PVSurfaceAlt"))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .accessibilityIdentifier("onboarding-server-row")
        }
    }

    /// The row's un-edited value: `ServerSettings.resolved`'s host, no
    /// scheme -- matches §3.2's "Server -> vault.blonie.cloud" value
    /// presentation. Falls back to the full absolute string only if a
    /// stored value somehow has no host (should not happen --
    /// `ServerSettings.resolved` always returns a valid parsed `URL`).
    private static func currentHostText() -> String {
        ServerSettings.resolved.host ?? ServerSettings.resolved.absoluteString
    }

    /// Validation order: normalise first (no network, renders a refusal
    /// instantly if the text is not even syntactically plausible), then
    /// probe reachability. `Continue` always re-validates -- there is no
    /// "trust the default, skip validation" branch; `Skip` is the only
    /// unconditional, network-free path (§3.2).
    private func handleContinue() {
        inlineError = nil
        successMessage = nil

        switch ServerSettings.normalise(fieldText) {
        case let .failure(error):
            inlineError = error.description
        case let .success(url):
            isChecking = true
            Task {
                let result = await ServerReachability.check(url)
                isChecking = false
                switch result {
                case .reachable:
                    do {
                        try ServerSettings.store(url)
                        successMessage = t(.onboardingServerSuccess)
                        fieldText = url.host ?? fieldText
                        isEditing = false
                        // A short, visible pause so the inline PVPasskey
                        // confirmation actually registers before the step
                        // advances -- this is also the window
                        // `OnboardingServerStepUITests` screenshots inside.
                        try? await Task.sleep(nanoseconds: 1_200_000_000)
                        onAdvance()
                    } catch {
                        inlineError = "\(error)"
                    }
                case let .unreachable(reason):
                    inlineError = t(.onboardingServerErrorUnreachable, ["host": url.host ?? "", "reason": reason])
                case .wrongServer:
                    inlineError = t(.onboardingServerErrorWrongServer, ["host": url.host ?? ""])
                }
            }
        }
    }
}

#Preview {
    OnboardingServerStep(onAdvance: {}, onSkip: {})
}
