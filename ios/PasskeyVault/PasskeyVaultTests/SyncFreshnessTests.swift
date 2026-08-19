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

    // WR-02 (39-REVIEW.md, iteration 2): the previous version of this test
    // (WR-10, iteration 1's fix) is STILL vacuous with the
    // `isDate(_:inSameDayAs:)` branch deleted. With that branch removed,
    // `describe` always takes the `RelativeDateTimeFormatter` path, and
    // `RelativeDateTimeFormatter.localizedString(for:relativeTo:)` selects
    // the LARGEST WHOLE UNIT -- a three-day-old instant renders "3 days ago"
    // whether `reference` is `Self.reference` or `Self.reference + 1 hour`,
    // because a one-hour shift never crosses a day boundary once the
    // magnitude is already in days. Both of the deleted test's assertions
    // (same-day differs, previous-day does not) therefore still pass with
    // the branch gone -- it pinned nothing about the split.
    //
    // This version asserts the property that actually distinguishes the two
    // branches: a previous-day instant renders through the EXACT SAME
    // `DateFormatter(dateStyle: .medium, timeStyle: .short)` the production
    // code's absolute branch uses -- not merely "some string that happens
    // not to move". Delete the `isDate(_:inSameDayAs:)` branch (so every
    // instant, including this one, takes the relative path instead) and
    // this assertion fails immediately: the relative phrase ("3 days ago")
    // is never equal to the absolute-formatter string ("Nov 11, 2023 at
    // 10:13 PM"), regardless of locale rounding or the 1-hour reference
    // shift this test also exercises.
    @Test func aPreviousDayStringIsRenderedByTheAbsoluteFormatterNotARelativePhrase() {
        let threeDaysAgo = Date(timeIntervalSince1970: Self.reference.timeIntervalSince1970 - 3 * 24 * 3600)
        let threeDaysAgoMs = Int64(threeDaysAgo.timeIntervalSince1970 * 1000)
        let laterReference = Self.reference.addingTimeInterval(3600)

        let absoluteFormatter = DateFormatter()
        absoluteFormatter.dateStyle = .medium
        absoluteFormatter.timeStyle = .short
        let expected = "Last synced \(absoluteFormatter.string(from: threeDaysAgo))"

        let earlierDayNow = SyncFreshness.describe(syncedAtMs: threeDaysAgoMs, reference: Self.reference)
        #expect(
            earlierDayNow == expected,
            "a previous-day instant must be rendered by the ABSOLUTE formatter, not a relative phrase -- got \(earlierDayNow.debugDescription), expected \(expected.debugDescription)"
        )

        // The reference clock advancing by an hour must not change the
        // rendering at all -- the absolute string is pinned to the calendar
        // date, never to `reference`.
        let earlierDayLater = SyncFreshness.describe(syncedAtMs: threeDaysAgoMs, reference: laterReference)
        #expect(earlierDayLater == expected, "a previous-day (absolute) string must NOT move as the reference clock advances")
    }

    // The same-day/previous-day SPLIT itself, kept alongside the assertion
    // above: a same-day string is relative to `reference` (moves as
    // `reference` does) while a previous-day string does not.
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
