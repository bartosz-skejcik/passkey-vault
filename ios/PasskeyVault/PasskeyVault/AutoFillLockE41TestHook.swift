// AutoFillLockE41TestHook.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-07, Tasks 2/3 (E41-4's "prove the check can refuse" leg; E41-7's clock legs).
//
// A marker-FILE-gated, DEBUG-only test hook -- the SAME idiom `TracerFillSeeder
// .shouldMutateRevision()`/`.shouldOmitRevisionKey()`/`.shouldMismatchStoredUrl()` already
// established for this phase's own falsification legs (`TracerFillSeeder.swift`'s own header).
// `scripts/ios-autofill-e41.sh e41-4`/`e41-7` write a plain-text SIGNED OFFSET (seconds) into
// `e41-lock-marker-offset.marker` in the App Group container (a real directory on this Mac's
// disk, the driving script's own established access pattern) BEFORE re-running the SAME test
// method -- never a compile-time flag, so ONE test method drives every scenario through the
// IDENTICAL real unlock path (`ContentView.handleUnlocked` -> `SessionLifecycle
// .recordHostUnlock()`), rather than a hand-written "locked" simulation that would prove nothing
// about the real check:
//
//   * A NEGATIVE offset (E41-4's expiry leg, E41-7's forward-clock analogue): the marker is
//     rewritten to look like it was written that many seconds in the PAST -- already past ACC-06's
//     idle window.
//   * A POSITIVE offset (E41-7's backward-clock leg): the marker is rewritten to look like it was
//     written that many seconds in the FUTURE. DR-41-C's own clock choice (boot-session id +
//     monotonic `systemUptime`, NEVER wall-clock `Date()`) means there is no live mechanism on
//     this harness to literally rewind the Mac's system clock and have it affect
//     `ProcessInfo.processInfo.systemUptime` (monotonic by definition) -- this offset instead
//     models the EFFECT a rewound clock would have produced under a `Date()`-based design (a
//     marker whose recorded instant is now in the future relative to `now`), which
//     `LockMarker.isUnlockedLazily`'s own `now >= systemUptimeAtUnlock` guard already refuses
//     unconditionally. 41-07-SUMMARY.md states this reconciliation explicitly, per Pitfall 5's
//     own discipline: this is a statement about the code's intent under a rewound-clock INPUT,
//     not a claim that this harness moved the Mac's real system clock.
//
// DEVIATION (Rule 2, GSD executor rules): 41-07-PLAN.md's own `files_modified` list does not name
// this file. Without it, neither E41-4's refusal leg nor E41-7's clock legs have a way to reach
// those states through the REAL unlock path (a real unlock always writes a FRESH, valid marker).
// Documented as a deviation in 41-07-SUMMARY.md, not silently introduced.
//
// Compiled into DEBUG builds only; inert unless the marker file this session's own driving script
// wrote is actually present -- a normal, non-evidence launch never has it.

import Foundation

#if DEBUG
enum AutoFillLockE41TestHook {
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"
    private static let offsetMarkerFileName = "e41-lock-marker-offset.marker"

    /// Reads the signed offset (seconds) from the App Group marker file, if present, and
    /// rewrites the JUST-WRITTEN marker (`ContentView.handleUnlocked`'s own real
    /// `SessionLifecycle.recordHostUnlock()` call, immediately above this call site) to look like
    /// it was written that many seconds away from `now` -- negative = past (expired), positive =
    /// future (the backward-clock-jump model, see this file's own header). A no-op when the
    /// marker file is absent, unreadable, or does not parse as a number -- the normal, real-unlock
    /// path.
    static func applyMarkerOffsetIfRequested() {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: groupIdentifier
            ),
            let raw = try? String(
                contentsOf: containerURL.appendingPathComponent(offsetMarkerFileName), encoding: .utf8
            ),
            let offsetSeconds = TimeInterval(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
            let bootSessionId = LockMarker.currentBootSessionId()
        else { return }

        // CR-04 (41-REVIEW.md): `LockMarker.monotonicNow()`, matching the clock
        // `SessionLifecycle`/`LockMarker` now use for every real marker read/write -- offsetting
        // `ProcessInfo.processInfo.systemUptime` here while production reads `monotonicNow()`
        // would mix two different clock domains and make the offset's real-world magnitude
        // meaningless.
        let mutatedUptime = max(0, LockMarker.monotonicNow() + offsetSeconds)
        LockMarker.write(LockMarker(
            bootSessionId: bootSessionId,
            systemUptimeAtUnlock: mutatedUptime,
            hostUnlockUptime: mutatedUptime,
            writer: "host"
        ))
    }
}
#endif
