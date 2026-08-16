//
//  OnboardingView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-13, Task 1. The 3-step paged
//  onboarding shell
//  (`docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md`
//  §3): Welcome -> Server -> AutoFill, three dots, `PVAccent` on the active
//  one. Presented once, before auth, gated by `OnboardingGate` below.
//
//  All three tabs are now the real steps (`OnboardingWelcomeStep` Task 1,
//  `OnboardingServerStep` Task 2, `OnboardingAutoFillStep` Task 3) -- this
//  file needed touching again each time to wire in the newly created step,
//  not a scope violation (Rule 3: the whole app target must build for
//  `xcodebuild test` to run at all, so a placeholder was necessary until
//  each step's real file existed).
//

import SwiftUI

/// Which of the two Welcome controls the user tapped -- a fact about THIS
/// run of onboarding, not a persisted preference (Task 1 action text: carry
/// it as a value on the completion callback rather than a second
/// `@AppStorage` flag). `ContentView` reads this to decide which `AuthView`
/// mode the flow lands on.
enum OnboardingEntryIntent {
    case newVault
    case existingVault
}

/// The gate itself, as a PURE decision a unit test can falsify without
/// touching SwiftUI (Task 1 action text: "test the gate as a pure decision
/// ... not by driving SwiftUI"). `ContentView` calls `shouldPresentOnboarding`
/// directly; `OnboardingView`'s own `@AppStorage` binds to the same
/// `completedKey` so there is exactly one string literal for it, never two
/// copies that can drift.
enum OnboardingGate {
    static let completedKey = "pv.onboarding.completed"

    static func shouldPresentOnboarding(completed: Bool) -> Bool {
        !completed
    }
}

struct OnboardingView: View {
    static let stepCount = 3

    /// Fires once, when the AutoFill step's `Later`/`Done` control finishes
    /// the flow -- never before, since onboarding must never block (Task 3).
    let onComplete: (OnboardingEntryIntent) -> Void

    @AppStorage(OnboardingGate.completedKey) private var completed = false
    @State private var step = 0
    @State private var entryIntent: OnboardingEntryIntent = .newVault

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $step) {
                OnboardingWelcomeStep(
                    onGetStarted: { advance(to: 1, intent: .newVault) },
                    onAlreadyHaveVault: { advance(to: 1, intent: .existingVault) }
                )
                .tag(0)

                OnboardingServerStep(onAdvance: { advance(to: 2) }, onSkip: { advance(to: 2) })
                    .tag(1)

                OnboardingAutoFillStep(onFinish: finish)
                    .tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            dots
        }
        .background(Color("PVBackground"))
        .onAppear(perform: applyForcedStepIfNeeded)
    }

    /// TEST-ONLY: lands the UI-test driver on a known step without needing
    /// to tap through the ones before it -- mirrors `LockView`'s own
    /// `PV_UITEST_LOCK_STATE` convention. Compiled into DEBUG builds only.
    private func applyForcedStepIfNeeded() {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["PV_UITEST_ONBOARDING_STEP"],
           let forced = Int(raw), (0 ..< Self.stepCount).contains(forced)
        {
            step = forced
        }
        #endif
    }

    @ViewBuilder
    private var dots: some View {
        HStack(spacing: 8) {
            ForEach(0 ..< Self.stepCount, id: \.self) { index in
                Circle()
                    .fill(index == step ? Color("PVAccent") : Color("PVTextMuted").opacity(0.3))
                    .frame(width: 8, height: 8)
                    .accessibilityIdentifier(index == step ? "onboarding-dot-active" : "onboarding-dot")
            }
        }
        .padding(.bottom, 12)
        .accessibilityIdentifier("onboarding-dots")
    }

    private func advance(to nextStep: Int, intent: OnboardingEntryIntent? = nil) {
        if let intent {
            entryIntent = intent
        }
        step = nextStep
    }

    private func finish() {
        completed = true
        onComplete(entryIntent)
    }
}

#Preview {
    OnboardingView(onComplete: { _ in })
}
