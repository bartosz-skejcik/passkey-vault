//
//  OnboardingWelcomeStep.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-13, Task 1.
//  §3.1: the only screen whose job is identity. Kept quiet -- app icon,
//  title, one body line, one primary control, one ghost control. Every
//  user-visible string routes through `t(_:)`; the app name itself is
//  `Text(verbatim:)`, matching `AuthView.swift`'s own established
//  "app name, plain, not localized" convention.
//

import SwiftUI

struct OnboardingWelcomeStep: View {
    let onGetStarted: () -> Void
    let onAlreadyHaveVault: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 16) {
                appIcon

                Text(verbatim: "Passkey Vault")
                    .font(.title)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color("PVTextPrimary"))

                Text(t(.onboardingWelcomeBody))
                    .font(.body)
                    .foregroundStyle(Color("PVTextMuted"))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 24)
            }

            Spacer()

            VStack(spacing: 12) {
                Button(action: onGetStarted) {
                    Text(t(.onboardingWelcomeGetStarted))
                }
                .buttonStyle(PVPrimaryButtonStyle())
                .buttonStyle(PVGhostButtonStyle())
                .accessibilityIdentifier("onboarding-welcome-get-started")

                Button(action: onAlreadyHaveVault) {
                    Text(t(.onboardingWelcomeAlreadyHaveVault))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(PVGhostButtonStyle())
                .accessibilityIdentifier("onboarding-welcome-already-have-vault")
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(Color("PVBackground"))
    }

    /// App icon at a rounded ~23pt corner (§3.1). `Image("AppIcon")`
    /// (referencing `AppIcon.appiconset` directly) was tried first and
    /// verified NOT to render here: the asset catalog's dark/tinted
    /// appearance entries in `AppIcon.appiconset/Contents.json` carry no
    /// `filename`, and a screenshot taken against it came back visibly
    /// blank in both light and dark
    /// (`ios/evidence/38/38-13-onboarding-welcome-{light,dark}.png` before
    /// this fix). `OnboardingAppIcon.imageset` is the SAME 1024pt PNG
    /// (`AppIcon.appiconset/AppIcon-1024.png`) duplicated into a plain
    /// imageset, which `Image(_:)` is documented to load reliably.
    @ViewBuilder
    private var appIcon: some View {
        Image("OnboardingAppIcon")
            .resizable()
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
            .accessibilityHidden(true)
    }
}

#Preview {
    OnboardingWelcomeStep(onGetStarted: {}, onAlreadyHaveVault: {})
}
