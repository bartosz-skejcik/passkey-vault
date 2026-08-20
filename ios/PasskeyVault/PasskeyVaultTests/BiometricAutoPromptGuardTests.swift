//
//  BiometricAutoPromptGuardTests.swift
//  PasskeyVaultTests
//
//  REQUIRED FIX #2 (`.planning/debug/faceid-unlock-loop.md`): `BiometricAutoPromptGuard` is the
//  structural stop to the infinite Face-ID-relock loop, independent of REQUIRED FIX #1's own
//  routing correction. `@Suite(.serialized)` -- the SAME discipline `LockTeardownTests.swift`/
//  `VaultMutationTests.swift` already established -- because this type's own state is
//  process-lifetime `static` storage (that is the entire point, see its own header), and Swift
//  Testing may otherwise run this suite's tests concurrently, racing on that shared state.
//

import Foundation
import Testing
@testable import PasskeyVault

@Suite(.serialized)
struct BiometricAutoPromptGuardTests {
    @Test
    func theFirstAutoPromptAfterAResetIsAllowed() {
        BiometricAutoPromptGuard.resetForTesting()
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: 1_000), "a fresh session's very first auto-prompt must never be suppressed")
    }

    @Test
    func aSecondAutoPromptWithinTheCooldownWindowIsRefused() {
        BiometricAutoPromptGuard.resetForTesting()
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: 1_000))
        #expect(
            !BiometricAutoPromptGuard.shouldAutoPrompt(now: 1_000.5),
            "a second auto-prompt half a second later -- exactly the mechanical, sub-second re-fire shape a wrong-relock loop produces -- must be refused"
        )
    }

    @Test
    func anAutoPromptOneInstantBeforeTheCooldownBoundaryIsStillRefused() {
        BiometricAutoPromptGuard.resetForTesting()
        let start: TimeInterval = 1_000
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: start))
        // Elapsed one instant short of `minimumIntervalSeconds` -- `shouldAutoPrompt`'s own
        // refusal comparison is `now - last < minimumIntervalSeconds`, so this is the LAST
        // refused instant; exactly AT the boundary is already allowed (the next test), mirroring
        // `LockMarker.isUnlockedLazily`'s own inclusive-boundary convention (`<=` reads as
        // "still valid" at the exact boundary, not one step short of it).
        #expect(!BiometricAutoPromptGuard.shouldAutoPrompt(now: start + BiometricAutoPromptGuard.minimumIntervalSeconds - 0.001))
    }

    @Test
    func anAutoPromptExactlyAtTheCooldownBoundaryIsAllowed() {
        BiometricAutoPromptGuard.resetForTesting()
        let start: TimeInterval = 1_000
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: start))
        // Elapsed == minimumIntervalSeconds exactly is NOT `< minimumIntervalSeconds`, so this is
        // the FIRST allowed instant -- proves the boundary is a genuine one, not merely "long
        // enough later always passes" (this test would be meaningless without the refused case
        // immediately above it).
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: start + BiometricAutoPromptGuard.minimumIntervalSeconds))
    }

    @Test
    func anAutoPromptAfterTheCooldownWindowElapsesIsAllowedAgain() {
        BiometricAutoPromptGuard.resetForTesting()
        let start: TimeInterval = 1_000
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: start))
        #expect(
            BiometricAutoPromptGuard.shouldAutoPrompt(now: start + BiometricAutoPromptGuard.minimumIntervalSeconds + 0.001),
            "a GENUINE reappearance well after the cooldown window (a real user backgrounding and returning) must never be permanently suppressed"
        )
    }

    @Test
    func aClockThatDoesNotAdvanceRefusesEveryFollowingCall() {
        // Defends the loop-breaking property directly: if `now` were somehow frozen (the
        // pathological case this guard exists to survive), the SECOND call must still be
        // refused -- the guard must never accidentally allow every call through.
        BiometricAutoPromptGuard.resetForTesting()
        #expect(BiometricAutoPromptGuard.shouldAutoPrompt(now: 5_000))
        #expect(!BiometricAutoPromptGuard.shouldAutoPrompt(now: 5_000))
        #expect(!BiometricAutoPromptGuard.shouldAutoPrompt(now: 5_000))
    }
}
