//
//  SyncFreshnessTests.swift
//  PasskeyVaultTests
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-06, Task 1.
//
//  `SyncFreshness.describe(syncedAtMs:reference:)` reads no clock of its
//  own -- every case below pins BOTH the synced instant and the reference
//  instant, so the output is fully determined and reproducible regardless
//  of when this suite actually runs.
//
//  RED-before-green (D-08) for the never-synced case is demonstrated by
//  hand, NOT encoded here as a second test: with `SyncFreshness.describe`
//  temporarily made to return the SAME string for `nil` as for a recent
//  sync, `neverSyncedIsADistinctString` below fails; reverted, it passes
//  again. Both transcripts are recorded in this plan's own SUMMARY.
//

import Foundation
import Testing
@testable import PasskeyVault

struct SyncFreshnessTests {
    /// An arbitrary, fixed instant -- 2023-11-14T22:13:20Z. Never `Date()`;
    /// every test below measures relative to this exact value so the suite
    /// cannot flake on when it happens to run.
    private static let reference = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func aFewMinutesAgoProducesARelativeStringNamingTheElapsedTime() {
        let fiveMinutesAgoMs = Int64((Self.reference.timeIntervalSince1970 - 5 * 60) * 1000)
        let text = SyncFreshness.describe(syncedAtMs: fiveMinutesAgoMs, reference: Self.reference)
        #expect(text.contains("minute"), "expected a relative phrase naming minutes, got \(text.debugDescription)")
        #expect(text.hasPrefix("Last synced"))
    }

    @Test func aPreviousDayProducesADateResolvableStringNotAGrowingMinuteCount() {
        // Three days back is unambiguously a different calendar day from
        // `reference` regardless of time zone/DST edge cases near midnight.
        let threeDaysAgoMs = Int64((Self.reference.timeIntervalSince1970 - 3 * 24 * 3600) * 1000)
        let text = SyncFreshness.describe(syncedAtMs: threeDaysAgoMs, reference: Self.reference)
        #expect(!text.contains("minute"), "a previous-day string must not read as an ever-growing minute count, got \(text.debugDescription)")
        #expect(!text.contains("hour"), "a previous-day string must not read as an hour count either, got \(text.debugDescription)")
        #expect(text.hasPrefix("Last synced"))
    }

    // WR-10 (39-REVIEW.md): the test above is satisfied by simply deleting
    // the same-day branch entirely and always taking the relative path --
    // "3 days ago" contains neither "minute" nor "hour" either way, so it
    // pins nothing about the SPLIT the two branches actually implement.
    // This test asserts the property that genuinely distinguishes them: a
    // same-day string is relative to `reference` (moves as `reference`
    // does), a previous-day string is NOT (it is pinned to the calendar
    // date), and the two render DIFFERENTLY for the same underlying instant
    // and reference. Delete the `isDate(_:inSameDayAs:)` branch and this
    // test fails, because `earlierDay` starts moving with `reference` too.
    @Test func aSameDayStringMovesWithReferenceWhileAPreviousDayStringDoesNot() {
        let fiveMinutesAgoMs = Int64((Self.reference.timeIntervalSince1970 - 5 * 60) * 1000)
        let threeDaysAgoMs = Int64((Self.reference.timeIntervalSince1970 - 3 * 24 * 3600) * 1000)
        let laterReference = Self.reference.addingTimeInterval(3600)

        let sameDayNow = SyncFreshness.describe(syncedAtMs: fiveMinutesAgoMs, reference: Self.reference)
        let sameDayLater = SyncFreshness.describe(syncedAtMs: fiveMinutesAgoMs, reference: laterReference)
        #expect(sameDayNow != sameDayLater, "a same-day (relative) string must move as the reference clock advances")

        let earlierDayNow = SyncFreshness.describe(syncedAtMs: threeDaysAgoMs, reference: Self.reference)
        let earlierDayLater = SyncFreshness.describe(syncedAtMs: threeDaysAgoMs, reference: laterReference)
        #expect(earlierDayNow == earlierDayLater, "a previous-day (absolute) string must NOT move as the reference clock advances")
    }

    // MARK: - WR-13 (39-REVIEW.md): clamp/validate syncedAtMs

    @Test func aFutureSyncedAtMsNeverRendersAsAFutureSync() {
        let fiveMinutesFromNowMs = Int64((Self.reference.timeIntervalSince1970 + 5 * 60) * 1000)
        let text = SyncFreshness.describe(syncedAtMs: fiveMinutesFromNowMs, reference: Self.reference)
        #expect(text == "Last synced just now", "a syncedAtMs AHEAD of the reference clock (an NTP correction, a clock edit, a backup restore) must never phrase a sync that has not happened yet, got \(text.debugDescription)")
    }

    @Test func aNonPositiveSyncedAtMsIsTreatedAsNeverSynced() {
        #expect(SyncFreshness.describe(syncedAtMs: 0, reference: Self.reference) == SyncFreshness.neverSyncedText)
        #expect(SyncFreshness.describe(syncedAtMs: -1, reference: Self.reference) == SyncFreshness.neverSyncedText)
        #expect(SyncFreshness.describe(syncedAtMs: Int64.min, reference: Self.reference) == SyncFreshness.neverSyncedText, "a corrupt/hostile blob's out-of-range value must be rejected, not rendered as an absurd date")
    }

    @Test func neverSyncedIsADistinctString() {
        let text = SyncFreshness.describe(syncedAtMs: nil, reference: Self.reference)
        #expect(text == SyncFreshness.neverSyncedText)
        #expect(!text.isEmpty)
        // Distinct from a recent-sync string, not merely non-empty -- a
        // fabricated recent time would ALSO be non-empty.
        let recentMs = Int64((Self.reference.timeIntervalSince1970 - 60) * 1000)
        let recentText = SyncFreshness.describe(syncedAtMs: recentMs, reference: Self.reference)
        #expect(text != recentText)
    }

    @Test func theFormatterReadsNoGlobalClockAndIsDeterministicUnderTest() {
        let syncedMs = Int64((Self.reference.timeIntervalSince1970 - 120) * 1000)
        let first = SyncFreshness.describe(syncedAtMs: syncedMs, reference: Self.reference)
        let second = SyncFreshness.describe(syncedAtMs: syncedMs, reference: Self.reference)
        #expect(first == second, "same two arguments must produce the same string every time")
    }
}
