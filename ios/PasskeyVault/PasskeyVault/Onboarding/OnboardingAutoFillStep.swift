//
//  OnboardingAutoFillStep.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-13, Task 3.
//  §3.3: the numbered list, the honest footer, the returning state.
//
//  This step is NOT a permission request. There is no API to ask for
//  AutoFill on the user's behalf, and no `NS*UsageDescription` is involved
//  -- the copy below states that constraint honestly rather than implying
//  the app can turn it on. `Later` is a peer control, not a dismissable
//  afterthought: onboarding completes whichever control the user taps,
//  because this step must never block (plan's own prohibition list).
//

import AuthenticationServices
import SwiftUI
#if os(iOS)
import UIKit
#endif

struct OnboardingAutoFillStep: View {
    let onFinish: () -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var isEnabled = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(t(.onboardingAutoFillTitle))
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundStyle(Color("PVTextPrimary"))

                Text(t(.onboardingAutoFillSubtitle))
                    .font(.subheadline)
                    .foregroundStyle(Color("PVTextMuted"))
                    .fixedSize(horizontal: false, vertical: true)

                if isEnabled {
                    confirmation
                } else {
                    numberedList
                }

                Text(t(.onboardingAutoFillFooter))
                    .font(.footnote)
                    .foregroundStyle(Color("PVTextMuted"))
                    .fixedSize(horizontal: false, vertical: true)

                Spacer(minLength: 24)

                controls
            }
            .padding()
        }
        .background(Color("PVBackground"))
        .task {
            isEnabled = await AutoFillStatus.isEnabled()
        }
        .onChange(of: scenePhase) { _, newPhase in
            // §3.3's "returning state": re-check on return from Settings
            // without needing a relaunch.
            if newPhase == .active {
                Task {
                    isEnabled = await AutoFillStatus.isEnabled()
                }
            }
        }
    }

    @ViewBuilder
    private var confirmation: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(Color("PVPasskey"))
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            Text(t(.onboardingAutoFillEnabledConfirmation))
                .font(.subheadline)
                .foregroundStyle(Color("PVPasskey"))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(8)
        .background(Color("PVSurface"))
        .accessibilityIdentifier("onboarding-autofill-enabled-confirmation")
    }

    @ViewBuilder
    private var numberedList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t(.onboardingAutoFillListStep1))
                .foregroundStyle(Color("PVTextPrimary"))
            Text(t(.onboardingAutoFillListStep2))
                .foregroundStyle(Color("PVTextPrimary"))
            Text(t(.onboardingAutoFillListStep3))
                .foregroundStyle(Color("PVTextPrimary"))
        }
        .accessibilityIdentifier("onboarding-autofill-list")
    }

    @ViewBuilder
    private var controls: some View {
        if isEnabled {
            Button(action: onFinish) {
                Text(t(.onboardingAutoFillDone))
            }
            .buttonStyle(PVPrimaryButtonStyle())
            .buttonStyle(PVGhostButtonStyle())
            .accessibilityIdentifier("onboarding-autofill-primary")
        } else {
            VStack(spacing: 12) {
                Button(action: openSettings) {
                    Text(t(.onboardingAutoFillOpenSettings))
                }
                .buttonStyle(PVPrimaryButtonStyle())
                .buttonStyle(PVGhostButtonStyle())
                .accessibilityIdentifier("onboarding-autofill-primary")

                Button(action: onFinish) {
                    Text(t(.onboardingAutoFillLater))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(PVGhostButtonStyle())
                .accessibilityIdentifier("onboarding-autofill-later")
            }
        }
    }

    private func openSettings() {
        #if os(iOS)
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
        #endif
    }
}

#Preview {
    OnboardingAutoFillStep(onFinish: {})
}
