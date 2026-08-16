//
//  OnboardingGateTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-13, Task 1.
//
//  Tests the gate as a PURE decision (`OnboardingGate.shouldPresentOnboarding`)
//  -- not by driving `OnboardingView`/`ContentView` through SwiftUI. A gate
//  that can only be observed through a rendered view is a gate no unit test
//  can falsify (plan's own wording). Written FIRST, before
//  `Onboarding/OnboardingView.swift` existed (RED-before-green, transcript in
//  `38-13-SUMMARY.md`).
//

@testable import PasskeyVault
import Testing

struct OnboardingGateTests {
    @Test func flagUnsetShowsOnboarding() {
        #expect(OnboardingGate.shouldPresentOnboarding(completed: false) == true)
    }

    @Test func flagSetSkipsOnboarding() {
        #expect(OnboardingGate.shouldPresentOnboarding(completed: true) == false)
    }

    /// Guards the key string itself -- `ContentView`'s `@AppStorage` and
    /// `OnboardingView`'s own `@AppStorage` both bind to this constant. If
    /// it ever changes, both call sites change together or the app has two
    /// onboarding flags that can silently disagree.
    @Test func completedKeyIsTheDocumentedUserDefaultsKey() {
        #expect(OnboardingGate.completedKey == "pv.onboarding.completed")
    }
}
