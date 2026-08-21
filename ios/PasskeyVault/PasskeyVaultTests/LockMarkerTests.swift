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
        boot: String? = bootA, unlockedAt: TimeInterval = 1_000, hostUnlockAt: TimeInterval? = nil, writer: String = "host"
    ) -> LockMarker {
        LockMarker(
            bootSessionId: boot, monotonicAtUnlock: unlockedAt,
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
        // `now` earlier than `monotonicAtUnlock` -- a rewound clock or a corrupted marker.
        // T-41-35's own guard: this must NEVER read as "unlocked forever" via a negative elapsed.
        let m = Self.marker(unlockedAt: 5_000)
        #expect(!m.isUnlockedLazily(now: 4_999, idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours))
    }

    @Test
    func theAbsoluteCeilingExpiresEvenWithAFreshIdleRefresh() {
        // ACC-07's own bound: activity CAN extend `monotonicAtUnlock` (the idle window) but
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

    // MARK: - REQUIRED FIX (`.planning/debug/faceid-relock-loop-bootsession.md`): a MISSING
    // boot-session id on EITHER side must never, on its own, produce the same refusal as a
    // genuine, both-sides-present mismatch -- `kern.bootsessionuuid` is unreadable from a
    // sandboxed real-iOS process (confirmed live, Bartek's iPhone 16, iOS 27), so this is now the
    // ROUTINE case on real hardware, not an edge case.

    @Test
    func aMissingCurrentBootSessionIdNeverRefusesOnItsOwnWhenTheStoredMarkerIsOtherwiseValid() {
        let m = Self.marker(boot: Self.bootA, unlockedAt: 1_000)
        #expect(m.isValid(
            currentBootSessionId: nil, now: 1_300,
            idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours
        ), "the READ-side boot leg being unavailable (the real device symptom) must fall through to idle/ceiling arithmetic, never refuse on its own")
    }

    @Test
    func aMissingStoredBootSessionIdNeverRefusesOnItsOwnWhenTheCurrentBootIsKnown() {
        let m = Self.marker(boot: nil, unlockedAt: 1_000)
        #expect(m.isValid(
            currentBootSessionId: Self.bootA, now: 1_300,
            idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours
        ), "the WRITE-side boot leg being unavailable (an honest marker written after this fix, on a device where the sysctl fails) must fall through to idle/ceiling arithmetic, never refuse on its own")
    }

    @Test
    func bothBootSessionIdsMissingStillHonestlyEvaluatesIdleWindowArithmetic() {
        let m = Self.marker(boot: nil, unlockedAt: 1_000)
        #expect(m.isValid(currentBootSessionId: nil, now: 1_300, idleWindow: Self.sixtyMinutes, absoluteCeiling: Self.twelveHours))
        #expect(
            !m.isValid(currentBootSessionId: nil, now: 1_300, idleWindow: 100, absoluteCeiling: Self.twelveHours),
            "an unavailable boot leg on both sides must never mask a genuine idle-window breach -- REQUIRED FIX #2, 'evaluate what you can; refuse only on positive evidence' cuts both ways"
        )
    }

    @Test
    func aGenuineBootMismatchWithBothSidesPresentStillRefusesRegardlessOfElapsedTime() {
        // Regression guard: the fix narrows the boot-id check, it must not accidentally weaken
        // it -- a REAL reboot, detected via a genuine both-sides-present disagreement, must still
        // refuse exactly as before this fix (unchanged from
        // `aMarkerFromADifferentBootIsNeverValidRegardlessOfElapsedTime` above, restated here
        // under this fix's own section so a future regression in either area is caught by name).
        let m = Self.marker(boot: Self.bootA, unlockedAt: 1_000)
        #expect(!m.isValid(
            currentBootSessionId: Self.bootB, now: 1_000,
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

    // MARK: - WR-09 (41-REVIEW.md iteration 2): `checkAndExpireIfNeeded` itself -- not merely
    // `configuredIdleWindowSeconds` in isolation -- must read the idle window from the INJECTED
    // suite, never the real device's App Group container.

    /// Before this fix, `checkAndExpireIfNeeded` threaded `defaults` into `LockMarker.read/clear`
    /// but called `configuredIdleWindowSeconds()` with NO argument, silently resolving
    /// `AutoLockPolicy.sharedDefaults` (the real container) regardless of what was injected. Every
    /// OTHER test in this file only ever forced expiry via a mismatched `bootSessionId` (which
    /// short-circuits `isValid` before the idle-window comparison is ever reached), so none of them
    /// could have caught this. This test instead sets up a marker that is genuinely EXPIRED only
    /// because of a real idle-window comparison (matching `bootSessionId`, elapsed time beyond a
    /// 1-minute injected window) -- if the idle window were silently read from the real container
    /// instead (whatever the developer's own simulator happens to have stored, plausibly the
    /// `AutoLockPolicy.defaultMinutes` default of several minutes), this specific elapsed time could
    /// spuriously read as still-unlocked, making the assertion below flaky-in-the-wrong-direction
    /// evidence of exactly the bug WR-09 names.
    @Test
    func idleWindowIsReadFromTheInjectedSuiteNotTheSharedContainer() {
        let defaults = Self.freshDefaults()
        AutoLockPolicy.write(1, defaults: defaults) // 1-minute idle window, injected suite ONLY
        let bootId = LockMarker.currentBootSessionId() ?? "test-boot-session-fallback"
        LockMarker.write(
            LockMarker(
                bootSessionId: bootId,
                monotonicAtUnlock: LockMarker.monotonicNow() - 120, // 120s ago -- past the 1-minute window
                hostUnlockUptime: LockMarker.monotonicNow(),
                writer: "host"
            ),
            defaults: defaults
        )
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "wr09-test", deleteKeyArtifact: { true }, defaults: defaults
        )
        #expect(
            state == .expired,
            "120s elapsed against a 1-minute injected idle window must read as expired -- if this silently fell back to the REAL container's own configured window (WR-09's own bug), this could spuriously read as still-unlocked"
        )
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

    // MARK: - WR-12 (41-REVIEW.md): the two most security-load-bearing `SessionLifecycle`
    // invariants, previously asserted only in prose and in one live E41-7 leg -- now exercised
    // against the REAL production functions (never a re-implementation), via the SAME injectable
    // `UserDefaults` suite `configuredIdleWindowSeconds(defaults:)` already established, extended
    // to `LockMarker`'s own read/write/clear surface (WR-12's own fix) so these tests never touch
    // a real device's App Group container.

    @Test
    func refreshActivityCarriesTheCeilingForwardUnchanged() {
        let defaults = Self.freshDefaults()
        SessionLifecycle.recordHostUnlock(defaults: defaults)
        let before = LockMarker.read(defaults: defaults)!.hostUnlockUptime
        SessionLifecycle.refreshActivity(writer: "extension", defaults: defaults)
        #expect(LockMarker.read(defaults: defaults)!.hostUnlockUptime == before)
        #expect(LockMarker.read(defaults: defaults)!.writer == "extension")
    }

    @Test
    func expiryInvokesTheDeleteClosureExactlyOnce() {
        let defaults = Self.freshDefaults()
        var deletes = 0
        // No marker was ever written to THIS fresh suite -- WR-03 (41-REVIEW.md) reclassified "no
        // marker at all" as `.indeterminate`, not `.expired`, so this test writes a real marker
        // first, deliberately tagged with a boot-session id that can never equal THIS process's
        // real `LockMarker.currentBootSessionId()` -- a guaranteed, deterministic expiry
        // (`isValid`'s boot-identity check fails first) regardless of how long this test machine
        // has actually been up, unlike gating on idle-window elapsed time.
        LockMarker.write(
            LockMarker(
                bootSessionId: "not-the-real-boot-session-id", monotonicAtUnlock: 0,
                hostUnlockUptime: 0, writer: "host"
            ),
            defaults: defaults
        )
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "test", deleteKeyArtifact: { deletes += 1; return true }, defaults: defaults
        )
        #expect(state == .expired)
        #expect(deletes == 1)
    }

    // MARK: - WR-02 (41-REVIEW.md iteration 2): a failed delete must be retried, never forgotten.

    @Test
    func aFailedExpiryDeleteRecordsAnOwedDeletionRatherThanForgettingIt() {
        let defaults = Self.freshDefaults()
        LockMarker.write(
            LockMarker(
                bootSessionId: "not-the-real-boot-session-id", monotonicAtUnlock: 0,
                hostUnlockUptime: 0, writer: "host"
            ),
            defaults: defaults
        )
        #expect(!LockMarker.isDeleteOwed(defaults: defaults))

        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "test", deleteKeyArtifact: { false }, defaults: defaults
        )
        #expect(state == .expired)
        #expect(
            LockMarker.isDeleteOwed(defaults: defaults),
            "a delete closure that FAILS must leave an owed-deletion obligation, not silently drop it -- WR-02"
        )
    }

    @Test
    func anIndeterminateReadRetriesAPreviouslyOwedDeletion() {
        let defaults = Self.freshDefaults()
        // Simulate the outcome of the test above: a prior expiry's delete failed and the marker
        // was cleared, leaving the NEXT read `.indeterminate` (no marker) with an owed deletion.
        LockMarker.markDeleteOwed(true, defaults: defaults)
        var deleteAttempts = 0

        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "test", deleteKeyArtifact: { deleteAttempts += 1; return true }, defaults: defaults
        )
        #expect(state == .indeterminate, "an indeterminate read must still refuse the session, and must be reported AS indeterminate, never collapsed to the same signal as a genuine expiry -- REQUIRED FIX #1")
        #expect(deleteAttempts == 1, "an owed deletion must be RETRIED on the next check, even though the read itself is indeterminate -- WR-02")
        #expect(!LockMarker.isDeleteOwed(defaults: defaults), "a successful retry must clear the owed flag")
    }

    @Test
    func anIndeterminateReadWithNoOwedDeletionAndNoLegacyMarkerNeverInvokesTheDeleteClosure() {
        let defaults = Self.freshDefaults()
        var deleteAttempts = 0
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "test", deleteKeyArtifact: { deleteAttempts += 1; return true }, defaults: defaults
        )
        #expect(state == .indeterminate)
        #expect(deleteAttempts == 0, "an indeterminate read with nothing owed must never invoke the delete closure -- WR-03's own invariant, unchanged by WR-02")
    }

    @Test
    func aLegacyPreV2MarkerStillPresentTriggersARetriedDeleteOnAnIndeterminateRead() {
        let defaults = Self.freshDefaults()
        // CR-04's `.v2` key bump means a pre-upgrade marker is invisible to `LockMarker.read()`
        // (a decode/key miss, not a value this type will ever decode) -- write directly under the
        // OLD key name to simulate a device that upgraded mid-session, matching WR-02's own
        // reproduction of CR-04's comment's false claim.
        defaults.set(Data("legacy-marker-bytes".utf8), forKey: "cloud.blonie.PasskeyVault.lockMarker")
        #expect(LockMarker.legacyMarkerKeyHasData(defaults: defaults))
        var deleteAttempts = 0

        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "test", deleteKeyArtifact: { deleteAttempts += 1; return true }, defaults: defaults
        )
        #expect(state == .indeterminate)
        #expect(
            deleteAttempts == 1,
            "a pre-v2 marker still present must trigger a retried delete on the very next (indeterminate) check -- WR-02, closing the gap CR-04's own `.v2` comment claimed was already closed"
        )
        #expect(!LockMarker.legacyMarkerKeyHasData(defaults: defaults), "the legacy key must be cleared once its one job (triggering the retry) is done")
    }

    @Test
    func indeterminateReadNeverInvokesTheDeleteClosure() {
        // The WR-03 counterpart to the test above: a fresh suite with NO marker ever written is
        // `.indeterminate`, and `checkAndExpireIfNeeded` must refuse the read WITHOUT destroying a
        // session it could not evaluate.
        let defaults = Self.freshDefaults()
        var deletes = 0
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "test", deleteKeyArtifact: { deletes += 1; return true }, defaults: defaults
        )
        #expect(state == .indeterminate)
        #expect(deletes == 0, "an indeterminate (unreadable) marker must never trigger a delete -- WR-03")
    }

    @Test
    func lockDeletesTheKeyArtifactBeforeClearingTheMarker() {
        let defaults = Self.freshDefaults()
        LockMarker.write(Self.marker(), defaults: defaults)
        var markerStillPresentAtDeleteTime = false
        SessionLifecycle.lock(deleteKeyArtifact: {
            markerStillPresentAtDeleteTime = (LockMarker.read(defaults: defaults) != nil)
            return true
        }, defaults: defaults)
        #expect(markerStillPresentAtDeleteTime, "the key artifact must be deleted BEFORE the marker is cleared")
        #expect(LockMarker.read(defaults: defaults) == nil)
    }

    // MARK: - REQUIRED FIX #1 (`.planning/debug/faceid-unlock-loop.md`): `LockState.mustRelock`
    // is the whole UI-routing contract this fix rests on -- a regression here (mustRelock
    // becoming true for `.indeterminate`, the pre-fix bug's own shape) is exactly what would
    // reopen the infinite Face-ID loop, so it gets its own direct, named tests rather than
    // being covered only indirectly through `checkAndExpireIfNeeded`'s own state assertions
    // above.

    @Test
    func onlyExpiredMustRelockIndeterminateAndUnlockedMustNot() {
        #expect(SessionLifecycle.LockState.expired.mustRelock, "a genuine, evaluated expiry must still relock -- this fix must never weaken ACC-06 itself")
        #expect(!SessionLifecycle.LockState.indeterminate.mustRelock, "an indeterminate (unreadable) marker must NEVER relock an already-unlocked session -- REQUIRED FIX #1, the routing half of the infinite Face-ID-loop root cause")
        #expect(!SessionLifecycle.LockState.unlocked.mustRelock, "an unlocked session must never relock")
    }

    // MARK: - REQUIRED FIX #3 (`.planning/debug/faceid-unlock-loop.md`): when the shared App
    // Group container cannot be resolved at all, the HOST must still track a correct
    // single-process session via a `.standard` `UserDefaults` fallback -- mirroring
    // `AutoLockPolicy.sharedDefaults`'s own already-established precedent, which `LockMarker`
    // previously had no equivalent of. `LockMarker.forceSharedContainerUnresolvableForTesting`
    // is the DEBUG-only hook that makes this deterministically reproducible without an actually
    // unentitled build (see that property's own header).

    @Test
    func whenTheSharedContainerIsUnresolvableTheHostFallsBackToStandardDefaultsAndStillTracksASession() {
        // No `defaults:` override anywhere in this test -- the whole point is exercising the
        // REAL fallback `resolveDefaults` takes when given no override and an unresolvable
        // shared suite, which every other test in this file deliberately avoids (WR-12's own
        // isolation discipline). Cleans up its own residue in `.standard` afterwards.
        let legacyV2Key = "cloud.blonie.PasskeyVault.lockMarker.v2"
        LockMarker.forceSharedContainerUnresolvableForTesting = true
        defer {
            LockMarker.forceSharedContainerUnresolvableForTesting = false
            UserDefaults.standard.removeObject(forKey: legacyV2Key)
        }

        SessionLifecycle.recordHostUnlock()
        let state = SessionLifecycle.checkAndExpireIfNeeded(entryPoint: "fallback-test", deleteKeyArtifact: { true })
        #expect(
            state == .unlocked,
            "a single-process session must still be trackable via the .standard fallback when the App Group container cannot be resolved -- before this fix, an unresolvable container made every read return nil forever (.indeterminate), which REQUIRED FIX #1 alone would have left permanently unable to confirm a session even for a healthy single-process host"
        )
    }

    // MARK: - REQUIRED FIX (`.planning/debug/faceid-relock-loop-bootsession.md`): the SECOND
    // Face-ID-loop root cause, found live on Bartek's real device via `d8d9c9b`'s own fix already
    // shipped -- `LockMarker.currentBootSessionId()` returns `nil` on EVERY call there
    // (`kern.bootsessionuuid` unreadable from a sandboxed real-iOS process), which the PRE-FIX
    // `checkAndExpireIfNeeded` treated as a genuine, evaluated `.expired` verdict rather than an
    // unavailable input -- this test drives the REAL production path
    // (`recordHostUnlock` -> `checkAndExpireIfNeeded`) with `forceBootSessionIdUnavailableForTesting`
    // standing in for that real, unrepeatable-on-the-simulator device condition.

    @Test
    func aFreshMarkerWithTheBootLegUnavailableStaysUnlocked() {
        let defaults = Self.freshDefaults()
        LockMarker.forceBootSessionIdUnavailableForTesting = true
        defer { LockMarker.forceBootSessionIdUnavailableForTesting = false }

        SessionLifecycle.recordHostUnlock(defaults: defaults)
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "bootleg-fresh-test", deleteKeyArtifact: { true }, defaults: defaults
        )
        #expect(
            state == .unlocked,
            "a freshly-unlocked marker must stay unlocked when the boot-session leg cannot be evaluated at all -- pre-fix this read .expired on EVERY foreground check, the exact infinite Face-ID loop mechanism Bartek's real device log captured"
        )
    }

    @Test
    func recordHostUnlockNoLongerWritesAFakePlaceholderWhenTheBootLegIsUnavailable() {
        // The WRITE-side half of the same fix: before this fix, `recordHostUnlock` wrote the
        // literal string `"unknown-boot-session"` whenever `currentBootSessionId()` failed --
        // confirmed live in Bartek's own device log (`PVLOCK|stage=host-unlock
        // bootSessionId=unknown-boot-session`). `bootSessionId` must now be honestly `nil`.
        let defaults = Self.freshDefaults()
        LockMarker.forceBootSessionIdUnavailableForTesting = true
        defer { LockMarker.forceBootSessionIdUnavailableForTesting = false }

        SessionLifecycle.recordHostUnlock(defaults: defaults)
        #expect(
            LockMarker.read(defaults: defaults)?.bootSessionId == nil,
            "a marker written while the boot leg is unavailable must record that honestly as nil, never a placeholder string that looks like real boot-continuity data"
        )
    }

    @Test
    func anElapsedIdleWindowWithTheBootLegUnavailableStillExpires() {
        let defaults = Self.freshDefaults()
        AutoLockPolicy.write(1, defaults: defaults) // 1-minute idle window
        LockMarker.forceBootSessionIdUnavailableForTesting = true
        defer { LockMarker.forceBootSessionIdUnavailableForTesting = false }

        LockMarker.write(
            LockMarker(
                bootSessionId: nil,
                monotonicAtUnlock: LockMarker.monotonicNow() - 120, // 120s ago -- past the 1-minute window
                hostUnlockUptime: LockMarker.monotonicNow(),
                writer: "host"
            ),
            defaults: defaults
        )
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "bootleg-idle-test", deleteKeyArtifact: { true }, defaults: defaults
        )
        #expect(
            state == .expired,
            "a genuinely elapsed idle window must still expire the session even when the boot leg is unavailable -- REQUIRED FIX #2's own instruction: this fix narrows the boot-id check, it must never blanket-refuse-to-expire and silently disable ACC-06"
        )
    }

    @Test
    func anExceededAbsoluteCeilingWithTheBootLegUnavailableStillExpires() {
        let defaults = Self.freshDefaults()
        LockMarker.forceBootSessionIdUnavailableForTesting = true
        defer { LockMarker.forceBootSessionIdUnavailableForTesting = false }

        LockMarker.write(
            LockMarker(
                bootSessionId: nil,
                monotonicAtUnlock: LockMarker.monotonicNow() - 1, // idle window trivially satisfied
                hostUnlockUptime: LockMarker.monotonicNow() - (13 * 60 * 60), // 13h ago -- past the 12h ceiling
                writer: "host"
            ),
            defaults: defaults
        )
        let state = SessionLifecycle.checkAndExpireIfNeeded(
            entryPoint: "bootleg-ceiling-test", deleteKeyArtifact: { true }, defaults: defaults
        )
        #expect(
            state == .expired,
            "the 12h absolute ceiling must still expire the session even when the boot leg is unavailable and the idle window alone would look fine"
        )
    }

    @Test
    func theUnresolvableContainerFallbackNeverTouchesAnExplicitOverride() {
        // Regression guard for a plausible refactor mistake: the fallback must only ever engage
        // when NO override is supplied (production call sites never pass one) -- an explicit
        // test-isolation suite must keep working identically regardless of
        // `forceSharedContainerUnresolvableForTesting`'s value.
        let defaults = Self.freshDefaults()
        LockMarker.forceSharedContainerUnresolvableForTesting = true
        defer { LockMarker.forceSharedContainerUnresolvableForTesting = false }

        LockMarker.write(Self.marker(), defaults: defaults)
        #expect(LockMarker.read(defaults: defaults) == Self.marker(), "an explicit override must never be diverted through the shared-container fallback")
    }
}
