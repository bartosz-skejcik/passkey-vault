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
