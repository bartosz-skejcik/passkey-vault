//
//  ClipboardServiceTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 2.
//
//  Every fake below exists SOLELY so the change-counter guard and the
//  single-active-timer discipline are unit-testable without the real
//  device pasteboard (Pitfall 8: simulator pasteboard/host sync is exactly
//  what a unit test must not depend on) and without waiting on real
//  `Timer` fire delays. Task 3 (E-C1) is what tests the REAL pasteboard's
//  actual behaviour, deliberately -- these tests are necessary and not
//  sufficient for that claim.
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Fakes

private final class FakePasteboard: PasteboardWriting {
    private(set) var changeCount = 0
    private(set) var setValueCalls: [(value: String, expirationDate: Date, localOnly: Bool)] = []
    private(set) var clearCallCount = 0

    func setValue(_ value: String, expirationDate: Date, localOnly: Bool) {
        setValueCalls.append((value, expirationDate, localOnly))
        changeCount += 1
    }

    func clear() {
        clearCallCount += 1
        changeCount += 1
    }

    /// Simulates a DIFFERENT app (or a later, unrelated copy in THIS app
    /// outside `ClipboardService`) touching the pasteboard.
    func simulateExternalWrite() {
        changeCount += 1
    }
}

private final class ManualToken: ClipboardClearToken {
    private(set) var isCancelled = false
    let fire: () -> Void
    init(fire: @escaping () -> Void) { self.fire = fire }
    func invalidate() { isCancelled = true }
}

/// Fires synchronously on command -- a test never waits on real wall-clock
/// time to exercise "the timer fired".
private final class ManualClipboardScheduler: ClipboardScheduling {
    private(set) var tokens: [ManualToken] = []
    private(set) var scheduledDelays: [TimeInterval] = []

    func scheduleClear(after seconds: TimeInterval, fire: @escaping () -> Void) -> ClipboardClearToken {
        scheduledDelays.append(seconds)
        let token = ManualToken(fire: fire)
        tokens.append(token)
        return token
    }

    /// Fires the MOST RECENT scheduled clear, mirroring what "time has
    /// passed" means in production: only the latest is ever still live once
    /// a later copy has cancelled the earlier ones.
    func fireLatest() {
        tokens.last?.fire()
    }
}

struct ClipboardServiceTests {

    private static let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

    private func makeService(
        pasteboard: FakePasteboard = FakePasteboard(),
        scheduler: ManualClipboardScheduler = ManualClipboardScheduler()
    ) -> (ClipboardService, FakePasteboard, ManualClipboardScheduler) {
        let service = ClipboardService(
            pasteboard: pasteboard, scheduler: scheduler, clock: { Self.fixedNow }
        )
        return (service, pasteboard, scheduler)
    }

    // MARK: - ClipboardSettings.clamp: the four required cases

    @Test func clampBelowTheMinimumYieldsTheMinimum() {
        #expect(ClipboardSettings.clamp(10) == ClipboardSettings.minSeconds)
    }

    @Test func clampAboveTheMaximumYieldsTheMaximum() {
        #expect(ClipboardSettings.clamp(999) == ClipboardSettings.maxSeconds)
    }

    @Test func clampANegativeValueYieldsTheMinimum() {
        #expect(ClipboardSettings.clamp(-5) == ClipboardSettings.minSeconds)
    }

    @Test func clampAnUnparseableNotFiniteValueYieldsTheDefaultNotTheMinimum() {
        #expect(ClipboardSettings.clamp(.nan) == ClipboardSettings.defaultSeconds)
        #expect(ClipboardSettings.clamp(.infinity) == ClipboardSettings.defaultSeconds)
        #expect(ClipboardSettings.clamp(-.infinity) == ClipboardSettings.defaultSeconds)
    }

    @Test func clampAnInRangeValueIsUnchanged() {
        #expect(ClipboardSettings.clamp(45) == 45)
    }

    // MARK: - ClipboardSettings.offeredOptions: no never-clear sentinel

    @Test func offeredOptionsIsExactlyTheClampedRangeWithNothingOutsideIt() {
        let options = ClipboardSettings.offeredOptions
        #expect(options.first == ClipboardSettings.minSeconds)
        #expect(options.last == ClipboardSettings.maxSeconds)
        #expect(options.allSatisfy { $0 >= ClipboardSettings.minSeconds && $0 <= ClipboardSettings.maxSeconds })
        // No "never clear" sentinel (0, -1, or any out-of-range marker).
        #expect(options.contains(0) == false)
        #expect(options.contains(-1) == false)
        #expect(options.count == ClipboardSettings.maxSeconds - ClipboardSettings.minSeconds + 1)
    }

    // MARK: - ClipboardSettings.read: corrupt/out-of-range/unparseable storage

    @Test func readWithNoStoredValueYieldsTheDefault() {
        let defaults = UserDefaults(suiteName: #function)!
        defaults.removePersistentDomain(forName: #function)
        #expect(ClipboardSettings.read(defaults: defaults) == ClipboardSettings.defaultSeconds)
    }

    @Test func readWithAnOutOfRangeStoredNumberClampsIntoRange() {
        let defaults = UserDefaults(suiteName: #function)!
        defaults.removePersistentDomain(forName: #function)
        defaults.set(500.0, forKey: ClipboardSettings.key)
        #expect(ClipboardSettings.read(defaults: defaults) == ClipboardSettings.maxSeconds)
    }

    @Test func readWithACorruptNonNumericStoredStringYieldsTheDefault() {
        let defaults = UserDefaults(suiteName: #function)!
        defaults.removePersistentDomain(forName: #function)
        defaults.set("not-a-number", forKey: ClipboardSettings.key)
        #expect(ClipboardSettings.read(defaults: defaults) == ClipboardSettings.defaultSeconds)
    }

    @Test func writeThenReadRoundTripsAnInRangeValue() {
        let defaults = UserDefaults(suiteName: #function)!
        defaults.removePersistentDomain(forName: #function)
        ClipboardSettings.write(50, defaults: defaults)
        #expect(ClipboardSettings.read(defaults: defaults) == 50)
    }

    // MARK: - ClipboardService.copy: both mechanisms set in one call

    @Test func copyWritesTheExpiryAndLocalOnlyInOneCall() {
        let (service, pasteboard, _) = makeService()
        _ = service.copy("hunter2", fieldLabel: "Password", seconds: 40)

        #expect(pasteboard.setValueCalls.count == 1)
        let call = pasteboard.setValueCalls[0]
        #expect(call.value == "hunter2")
        #expect(call.localOnly == true)
        #expect(call.expirationDate == Self.fixedNow.addingTimeInterval(40))
    }

    @Test func copyClampsAnOutOfRangeSecondsArgumentBeforeSchedulingAndWriting() {
        let (service, pasteboard, scheduler) = makeService()
        _ = service.copy("hunter2", fieldLabel: "Password", seconds: 999)

        #expect(pasteboard.setValueCalls[0].expirationDate == Self.fixedNow.addingTimeInterval(TimeInterval(ClipboardSettings.maxSeconds)))
        #expect(scheduler.scheduledDelays == [TimeInterval(ClipboardSettings.maxSeconds)])
    }

    @Test func copyReturnsTheDeadlineItWroteToThePasteboard() {
        let (service, pasteboard, _) = makeService()
        let deadline = service.copy("hunter2", fieldLabel: "Password", seconds: 33)
        #expect(deadline == pasteboard.setValueCalls[0].expirationDate)
    }

    // MARK: - Single active timer: a second copy cancels the first

    @Test func aSecondCopyCancelsTheFirstFieldsPendingClearAndLeavesExactlyOnePending() {
        let (service, _, scheduler) = makeService()
        _ = service.copy("firstSecret", fieldLabel: "Password", seconds: 40)
        #expect(scheduler.tokens.count == 1)
        #expect(scheduler.tokens[0].isCancelled == false)

        _ = service.copy("secondSecret", fieldLabel: "TOTP code", seconds: 40)

        #expect(scheduler.tokens.count == 2, "the second copy must schedule its OWN clear")
        #expect(scheduler.tokens[0].isCancelled == true, "the FIRST field's pending clear must be cancelled")
        #expect(scheduler.tokens[1].isCancelled == false, "the second field's clear must still be pending")
    }

    /// RED-before-green target: removing `pendingToken?.invalidate()` before
    /// scheduling the second copy's clear leaves BOTH timers live -- this is
    /// the assertion that catches it. See 38-07-SUMMARY.md for the
    /// transcript.
    @Test func onlyOneTimerIsEverLiveAfterMultipleCopies() {
        let (service, _, scheduler) = makeService()
        _ = service.copy("a", fieldLabel: "A", seconds: 40)
        _ = service.copy("b", fieldLabel: "B", seconds: 40)
        _ = service.copy("c", fieldLabel: "C", seconds: 40)

        let liveCount = scheduler.tokens.filter { !$0.isCancelled }.count
        #expect(liveCount == 1)
    }

    // MARK: - The change-counter guard

    @Test func theGuardClearsWhenNothingCopiedSinceThisWrite() {
        let (service, pasteboard, scheduler) = makeService()
        _ = service.copy("hunter2", fieldLabel: "Password", seconds: 40)

        scheduler.fireLatest()

        #expect(pasteboard.clearCallCount == 1)
    }

    /// RED-before-green target: removing the `pasteboard.changeCount ==
    /// stamp` comparison (always clearing) fails this test -- the clear
    /// would wipe the externally-written value. See 38-07-SUMMARY.md for
    /// the transcript.
    @Test func theGuardSkipsTheClearWhenSomethingElseCopiedSinceThisWrite() {
        let (service, pasteboard, scheduler) = makeService()
        _ = service.copy("hunter2", fieldLabel: "Password", seconds: 40)

        // Someone else (or the user, via the system pasteboard directly)
        // copied something in the meantime.
        pasteboard.simulateExternalWrite()

        scheduler.fireLatest()

        #expect(pasteboard.clearCallCount == 0, "a later, unrelated copy must NEVER be destroyed by this clear")
    }

    // MARK: - Dismissing the confirmation is independent of the real clear

    @Test func dismissingTheConfirmationLeavesThePendingClearUntouched() {
        let (service, _, scheduler) = makeService()
        _ = service.copy("hunter2", fieldLabel: "Password", seconds: 40)
        #expect(scheduler.tokens.count == 1)
        #expect(scheduler.tokens[0].isCancelled == false)

        service.dismissConfirmation()

        #expect(scheduler.tokens.count == 1, "dismissal must not schedule or cancel anything")
        #expect(scheduler.tokens[0].isCancelled == false, "dismissal must NEVER cancel the real clear")
    }

    // MARK: - The countdown surface: derived from the deadline, never decremented

    @Test func remainingSecondsIsComputedFreshFromTheDeadlineEveryCall() {
        let deadline = Date(timeIntervalSince1970: 1000)
        #expect(ClipboardService.remainingSeconds(deadline: deadline, now: Date(timeIntervalSince1970: 970)) == 30)
        #expect(ClipboardService.remainingSeconds(deadline: deadline, now: Date(timeIntervalSince1970: 999)) == 1)
        #expect(ClipboardService.remainingSeconds(deadline: deadline, now: Date(timeIntervalSince1970: 1000)) == 0)
        // Never negative, even well past the deadline.
        #expect(ClipboardService.remainingSeconds(deadline: deadline, now: Date(timeIntervalSince1970: 1050)) == 0)
        // Two calls at the SAME "now" always agree -- nothing stateful.
        let now = Date(timeIntervalSince1970: 985)
        #expect(
            ClipboardService.remainingSeconds(deadline: deadline, now: now)
                == ClipboardService.remainingSeconds(deadline: deadline, now: now)
        )
    }

    // MARK: - User-facing wording: honest, never overclaiming

    @Test func confirmationWordingNeverUsesTheWordGuaranteed() {
        let text = ClipboardWording.confirmation(fieldLabel: "Password", remainingSeconds: 12)
        #expect(text.lowercased().contains("guarantee") == false)
    }

    @Test func confirmationWordingStatesWhatCannotBeRetracted() {
        let text = ClipboardWording.confirmation(fieldLabel: "Password", remainingSeconds: 12)
        #expect(text.contains("Password"))
        #expect(text.contains("12"))
        #expect(text.lowercased().contains("taken back") || text.lowercased().contains("retract"))
    }

    @Test func confirmationWordingAtZeroRemainingSecondsDoesNotClaimAFutureCountdown() {
        let text = ClipboardWording.confirmation(fieldLabel: "Password", remainingSeconds: 0)
        #expect(text == "Copied Password.")
    }
}
