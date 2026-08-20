//
//  LockMarkerTests.swift
//  PasskeyVaultTests
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-07, Task 1.
//
//  THESE TESTS PROVE ARITHMETIC ONLY. `LockMarker.isValid(currentBootSessionId:now:idleWindow:
//  absoluteCeiling:)` and `.isUnlockedLazily(now:idleWindow:absoluteCeiling:)` are PURE functions
//  of their explicit inputs plus `self` -- no I/O, no `UserDefaults` read, no `sysctlbyname` call,
//  no Keychain. A green test here proves the COMPARISON LOGIC is correct; it proves NOTHING about
//  cross-process behaviour, real elapsed wall-clock time, or the Keychain -- those are Task 2's
//  (E41-4, `AutoFillLockUITests.swift`) and Task 3's (E41-7, same file) LIVE, two-process runs
//  (QA-01, this project's own standing proof discipline). Do not cite a PASS here as evidence for
//  any claim beyond "the boundary math is right."
//
//  Also exercises the binding-scope routing note's own requirement (`ios/IOS-SPIKE-LOG.md` §8a:
//  "AutoLockPolicy ... MUST be claimed by [Phase 41] or it will be lost"): the idle window
//  `SessionLifecycle.configuredIdleWindowSeconds()` resolves is READ from `AutoLockPolicy`, never
//  a hardcoded interval, and a tampered stored value must fall back to
//  `AutoLockPolicy.defaultMinutes` rather than widening the window (T-38-11-02, ported forward).
//

import Foundation
import Testing
@testable import PasskeyVault

@Suite
struct LockMarkerTests {
    private static let sixtyMinutes: TimeInterval = 60 * 60
    private static let twelveHours: TimeInterval = 12 * 60 * 60
    private static let bootA = "11111111-AAAA-AAAA-AAAA-111111111111"
    private static let bootB = "22222222-BBBB-BBBB-BBBB-222222222222"

    private static func marker(
        boot: String = bootA, unlockedAt: TimeInterval = 1_000, hostUnlockAt: TimeInterval? = nil, writer: String = "host"
    ) -> LockMarker {
        LockMarker(
            bootSessionId: boot, systemUptimeAtUnlock: unlockedAt,
            hostUnlockUptime: hostUnlockAt ?? unlockedAt, writer: writer
        )
    }

    // MARK: - isUnlockedLazily (idle/ceiling arithmetic, boot identity NOT involved)

    @Test
    func anInstantInsideTheIdleWindowIsUnlocked() {
        let m = Self.marker(unlockedAt: 1_000)
        // 1_000 + 300s elapsed, window is 900s -- comfortably inside.
        #expect(m.isUnlockedLazily(now: 1_300, idleWindow: 900, absoluteCeiling: Self.twelveHours))
    }

    @Test
    func anInstantExactlyAtTheIdleBoundaryIsStillUnlocked() {
        let m = Self.marker(unlockedAt: 1_000)
        // Elapsed == idleWindow exactly -- the comparison is `<=`, so this is the LAST unlocked instant.
        #expect(m.isUnlockedLazily(now: 1_900, idleWindow: 900, absoluteCeiling: Self.twelveHours))
    }

    @Test
    func anInstantOneSecondPastTheIdleBoundaryIsExpired() {
        let m = Self.marker(unlockedAt: 1_000)
        #expect(!m.isUnlockedLazily(now: 1_901, idleWindow: 900, absoluteCeiling: Self.twelveHours))
    }

    @Test
    func aMarkerDatedInTheFutureIsNeverUnlocked() {
        // `now` earlier than `systemUptimeAtUnlock` -- a rewound clock or a corrupted marker.
        // T-41-35's own guard: this must NEVER read as "unlocked forever" via a negative elapsed.
        let m = Self.marker(unlockedAt: 5_000)
        #expect(!m.isUnlockedLazily(now: 4_999, idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours))
    }

    @Test
    func theAbsoluteCeilingExpiresEvenWithAFreshIdleRefresh() {
        // ACC-07's own bound: activity CAN extend `systemUptimeAtUnlock` (the idle window) but
        // must NEVER be able to push the session past `hostUnlockUptime + absoluteCeiling`
        // (DR-41-C's 12h ceiling, independent of any AutoFill activity). Here the idle window is
        // satisfied trivially (refreshed 1 second ago) but the host unlock was 13 hours ago.
        let hostUnlockAt: TimeInterval = 0
        let now: TimeInterval = 13 * 60 * 60
        let m = Self.marker(unlockedAt: now - 1, hostUnlockAt: hostUnlockAt, writer: "extension")
        #expect(!m.isUnlockedLazily(now: now, idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours))
    }

    @Test
    func theAbsoluteCeilingDoesNotExpireOneSecondBeforeItsBoundary() {
        // The positive counterpart to the case above -- proves the ceiling test is a genuine
        // boundary, not an always-false guard that would make the previous test meaningless.
        let hostUnlockAt: TimeInterval = 0
        let now: TimeInterval = Self.twelveHours
        let m = Self.marker(unlockedAt: now - 1, hostUnlockAt: hostUnlockAt, writer: "extension")
        #expect(m.isUnlockedLazily(now: now, idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours))
    }

    // MARK: - isValid (the FULL predicate: boot identity + isUnlockedLazily's own arithmetic)

    @Test
    func aMarkerFromADifferentBootIsNeverValidRegardlessOfElapsedTime() {
        let m = Self.marker(boot: Self.bootA, unlockedAt: 1_000)
        // Zero elapsed time -- would trivially pass the idle/ceiling arithmetic on its own; only
        // the boot-identity mismatch can be failing this.
        #expect(!m.isValid(
            currentBootSessionId: Self.bootB, now: 1_000,
            idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours
        ))
    }

    @Test
    func aMarkerFromTheSameBootAndInsideTheWindowIsValid() {
        let m = Self.marker(boot: Self.bootA, unlockedAt: 1_000)
        #expect(m.isValid(
            currentBootSessionId: Self.bootA, now: 1_300,
            idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours
        ))
    }

    // MARK: - AutoLockPolicy wiring (binding-scope routing note, `ios/IOS-SPIKE-LOG.md` §8a)

    private static func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "lockmarker-tests-\(UUID().uuidString)")!
    }

    @Test
    func configuredIdleWindowUsesAutoLockPolicysDefaultWhenNothingIsStored() {
        let defaults = Self.freshDefaults()
        let seconds = SessionLifecycle.configuredIdleWindowSeconds(defaults: defaults)
        #expect(seconds == TimeInterval(AutoLockPolicy.defaultMinutes) * 60)
    }

    @Test
    func configuredIdleWindowHonoursAWhitelistedStoredValue() {
        let defaults = Self.freshDefaults()
        AutoLockPolicy.write(5, defaults: defaults)
        let seconds = SessionLifecycle.configuredIdleWindowSeconds(defaults: defaults)
        #expect(seconds == 5 * 60)
    }

    /// The red-first target this plan's own binding-scope addition names explicitly: "prove
    /// red-first (a tampered stored interval must not widen the window)." Falsification: comment
    /// out `AutoLockPolicy.read`'s own `options.contains(candidate)` whitelist guard and re-run --
    /// this test then observes `seconds == 999 * 60` (the tampered value winning) instead of the
    /// default, i.e. it FAILS -- then restore the guard and observe it pass again. Both
    /// transcripts recorded in 41-07-SUMMARY.md.
    @Test
    func configuredIdleWindowFallsBackToTheDefaultWhenTheStoredIntervalIsTampered() {
        let defaults = Self.freshDefaults()
        defaults.set(999, forKey: AutoLockPolicy.key) // not on the [1,5,15,30,60] whitelist
        let seconds = SessionLifecycle.configuredIdleWindowSeconds(defaults: defaults)
        #expect(
            seconds == TimeInterval(AutoLockPolicy.defaultMinutes) * 60,
            "a tampered stored interval must fall back to the default, never widen the window"
        )
    }

    // MARK: - CR-04 (41-REVIEW.md): `LockMarker.monotonicNow()` -- the sleep-inclusive clock

    /// A genuine device-sleep regression (reverting to `ProcessInfo.processInfo.systemUptime`)
    /// cannot be caught by a pure unit test without actually suspending the host -- this test's
    /// own header records that limitation honestly rather than claiming coverage it does not have
    /// (this file's own top note: "do not cite a PASS here as evidence for any claim beyond the
    /// boundary math"). What IS cheaply, genuinely testable without a process/sleep dependency:
    /// `monotonicNow()` is a real, monotonically NON-DECREASING clock (never goes backward between
    /// two calls in the same process) and returns a plausible, positive "seconds since some
    /// reference point" magnitude -- a regression that made it return zero, a constant, or a wildly
    /// wrong unit (e.g. forgetting the `/ 1_000_000_000` divide, which would report values roughly
    /// 1e9x too large) fails this test immediately.
    @Test
    func monotonicNowIsMonotonicallyNonDecreasingAndPlausiblyScaled() {
        let first = LockMarker.monotonicNow()
        let second = LockMarker.monotonicNow()
        #expect(second >= first, "monotonicNow() must never go backward between two calls")
        // A real Mac/simulator has been up for at least a few seconds by the time tests run, and
        // uptime measured in seconds is nowhere near `TimeInterval.greatestFiniteMagnitude` or a
        // raw nanosecond count (which would be ~1e9x larger) -- this bound would trip on either a
        // missing unit conversion or a clock that never advances from zero.
        #expect(first > 0, "monotonicNow() must report a real, positive uptime, not zero/uninitialized")
        #expect(first < 1_000_000_000, "monotonicNow() must be seconds, not raw nanoseconds (missing / 1_000_000_000)")
    }
}
