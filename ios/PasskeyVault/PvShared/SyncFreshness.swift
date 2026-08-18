//
//  SyncFreshness.swift
//  PvShared
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-06 (SYNC-04).
//
//  Converts `CachedSnapshot.syncedAtMs` into the "last synced <time>" string
//  BOTH processes render -- this file carries no UIKit import and is
//  compiled into the AutoFill extension too (39-07 Task 2, D-17). Having
//  ONE formatter is what keeps the host app and the extension from
//  describing the same instant two different ways.
//
//  READS NO CLOCK OF ITS OWN. Every call site hands in the instant to
//  measure elapsed time against -- `describe(syncedAtMs:reference:)` never
//  calls `Date()` internally. This is not stylistic: a formatter that reads
//  the system clock cannot be pinned by a test with an injected instant
//  (D-08), and this exact function is what `SyncFreshnessTests` exercises
//  with fixed reference instants.
//
//  THE NEVER-SYNCED CASE IS A DISTINCT STRING, NEVER A FABRICATED RECENT
//  TIME AND NEVER AN EMPTY LABEL (T-39-23). `syncedAtMs == nil` means no
//  successful pull has EVER completed for this account -- conflating that
//  with "just synced" would be exactly the "confident lie" this plan's
//  objective calls out; an empty string would render nothing, which reads
//  as a layout bug rather than as "not yet synced".
//
//  WHAT COUNTS AS "SYNCED": the value passed in must come from
//  `CachedSnapshot.syncedAtMs` (D-11, its own header -- no second copy
//  anywhere), written only on a pull the server actually answered. This
//  file has no opinion on where that value came from; it only formats it.
//

import Foundation

enum SyncFreshness {
    /// Distinct from every timed case below -- see this file's header.
    static let neverSyncedText = "Not synced yet"

    /// - Parameters:
    ///   - syncedAtMs: `CachedSnapshot.syncedAtMs`, or `nil` before any
    ///     successful pull has ever completed for this account.
    ///   - reference: the instant to measure elapsed time against. ALWAYS
    ///     passed explicitly -- see this file's header on why.
    /// - Returns: a non-empty, user-facing string. Same calendar day as
    ///   `reference` -> a relative phrase naming the elapsed time ("Last
    ///   synced 5 minutes ago"). An earlier day -> an absolute,
    ///   date-resolvable string ("Last synced Aug 17, 2026 at 3:04 PM"),
    ///   deliberately NOT a relative phrase whose minute count would keep
    ///   growing the longer the reader looks at it.
    static func describe(syncedAtMs: Int64?, reference: Date) -> String {
        guard let syncedAtMs else { return neverSyncedText }
        let synced = Date(timeIntervalSince1970: Double(syncedAtMs) / 1000)

        if Calendar.current.isDate(synced, inSameDayAs: reference) {
            let formatter = RelativeDateTimeFormatter()
            formatter.unitsStyle = .full
            let phrase = formatter.localizedString(for: synced, relativeTo: reference)
            return "Last synced \(phrase)"
        }

        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "Last synced \(formatter.string(from: synced))"
    }
}
