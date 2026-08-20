//
//  LockMarker.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03. DR-41-C's lock
//  marker (`ios/IOS-SPIKE-LOG.md` §1i), committed by Plan 41-02: App Group `UserDefaults`
//  storage, a `(bootSessionId, systemUptimeAtUnlock)` clock pair -- never `Date()` alone
//  (user-rewindable, a direct session-extension attack surface against ACC-06's own expiry) and
//  never bare `systemUptime` alone (resets near zero on every boot, so a stale value from a
//  PREVIOUS boot cannot be distinguished from a small elapsed value in the CURRENT one without a
//  per-boot identifier).
//
//  THIS TASK implements the READ and the LAZY CHECK only, per 41-03-PLAN.md's own scoping:
//  "Full expiry semantics (the explicit delete, the refresh from either process, the clock legs)
//  are 41-07's job; this task implements the read and the check only, and 41-07 widens the same
//  type rather than replacing it." `write(_:)` exists so this task's own seeder
//  (`TracerFillSeeder.swift`) can simulate "the host app just completed a real unlock" -- the
//  REAL refresh-on-activity write (ACC-07) and the explicit `SecItemDelete`-shaped expiry
//  (ACC-06, this type carries no secret so there is nothing to delete here, but the STANDING
//  session-ended semantics it is asked to represent are) are Plan 41-07's job.
//
//  `isUnlockedLazily(now:idleWindow:)` is a PURE function of its two explicit inputs plus `self`
//  -- no I/O, no `UserDefaults` read, no `sysctlbyname` call -- so it is directly testable
//  without a process (this task's own action wording). The `bootSessionId` EQUALITY check against
//  the CURRENT boot is a SEPARATE concern, composed by the caller (`currentBootSessionId()` below
//  plus a plain `==`) -- a reboot ending the session is a coarser, binary fact than the lazy idle
//  check, and keeping the two checks separate is what lets each be tested independently.
//

import Foundation

public struct LockMarker: Codable, Equatable {
    /// `kern.bootsessionuuid` at WRITE time -- a UUID that changes every boot. A mismatch against
    /// `currentBootSessionId()` at READ time means the device has rebooted since this marker was
    /// written; DR-41-C treats that as expired (a defensible default, not a defect).
    public let bootSessionId: String

    /// `ProcessInfo.processInfo.systemUptime` at WRITE time -- the monotonic half of DR-41-C's
    /// clock pair.
    public let systemUptimeAtUnlock: Double

    public init(bootSessionId: String, systemUptimeAtUnlock: Double) {
        self.bootSessionId = bootSessionId
        self.systemUptimeAtUnlock = systemUptimeAtUnlock
    }

    // MARK: - Storage (DR-41-C: the App Group container, `UserDefaults(suiteName:)`)

    private static let suiteName = "group.cloud.blonie.PasskeyVault"
    private static let defaultsKey = "cloud.blonie.PasskeyVault.lockMarker"

    /// Reads the marker, or `nil` if none has ever been written, the App Group container could
    /// not be resolved, or the stored value is undecodable.
    public static func read() -> LockMarker? {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return nil }
        guard let data = defaults.data(forKey: defaultsKey) else { return nil }
        return try? JSONDecoder().decode(LockMarker.self, from: data)
    }

    /// Writes the marker whole. ACC-07 (DR-41-C) permits BOTH processes to call this -- the
    /// extension's own refresh-on-activity write is Plan 41-07's job; this task's seeder calls it
    /// from the HOST side only, to simulate a real unlock having just happened.
    public static func write(_ marker: LockMarker) {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return }
        guard let data = try? JSONEncoder().encode(marker) else { return }
        defaults.set(data, forKey: defaultsKey)
    }

    // MARK: - Clock: the CURRENT boot's session identifier

    /// Darwin's `kern.bootsessionuuid` sysctl -- a UUID string that changes every boot.
    /// `[ASSUMED]`/UNVERIFIED accessibility and stability from an app-extension sandbox on this
    /// iOS/toolchain combination (DR-41-C's own honesty note, `ios/IOS-SPIKE-LOG.md` §1i) --
    /// Plan 41-07's clock legs (a real `simctl shutdown`+`boot` cycle) are the falsifier. Returns
    /// `nil` if the sysctl is unreachable, which this type's callers treat as "cannot establish
    /// the current boot identity" -- never as "matches every marker".
    public static func currentBootSessionId() -> String? {
        let name = "kern.bootsessionuuid"
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(cString: buffer)
    }

    // MARK: - The lazy check (ACC-06's inherited premise; this task's own scope)

    /// `true` if and only if the elapsed monotonic uptime since `systemUptimeAtUnlock` is within
    /// `idleWindow`. A PURE function of `self`, `now`, and `idleWindow` -- no I/O. The caller is
    /// responsible for ALSO checking `bootSessionId` equality against `currentBootSessionId()`
    /// before trusting a `true` result here (see this file's header) -- that check is
    /// deliberately NOT folded into this function, so each can be tested independently.
    public func isUnlockedLazily(now: TimeInterval, idleWindow: TimeInterval) -> Bool {
        guard now >= systemUptimeAtUnlock else { return false }
        let elapsed = now - systemUptimeAtUnlock
        return elapsed <= idleWindow
    }
}
