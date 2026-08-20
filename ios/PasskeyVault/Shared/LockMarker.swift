//
//  LockMarker.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03. DR-41-C's lock
//  marker (`ios/IOS-SPIKE-LOG.md` §1i), committed by Plan 41-02: App Group `UserDefaults`
//  storage, a `(bootSessionId, monotonicAtUnlock)` clock pair -- never `Date()` alone
//  (user-rewindable, a direct session-extension attack surface against ACC-06's own expiry) and
//  never a sleep-EXCLUDING monotonic clock alone (WR-07, 41-REVIEW.md iteration 2: CR-04 moved
//  this field from `ProcessInfo.processInfo.systemUptime` to `LockMarker.monotonicNow()` --
//  see that function's own header) and never bare uptime alone regardless of which clock (resets
//  near zero on every boot, so a stale value from a PREVIOUS boot cannot be distinguished from a
//  small elapsed value in the CURRENT one without a per-boot identifier).
//
//  41-03 implemented the READ and the LAZY CHECK only, per its own scoping: "Full expiry
//  semantics (the explicit delete, the refresh from either process, the clock legs) are 41-07's
//  job... 41-07 widens the same type rather than replacing it." THIS is that widening (Phase 41,
//  Plan 41-07, Task 1): two fields added --
//
//  * `hostUnlockUptime` -- DR-41-C's 12-hour ABSOLUTE session ceiling anchor. Set ONLY by a REAL
//    host-app unlock (`SessionLifecycle.recordHostUnlock()`); the extension's own activity
//    refresh (ACC-07, `SessionLifecycle.refreshActivity(writer:)`) reads the CURRENT marker and
//    carries this field forward UNCHANGED -- "the ceiling is tracked as a separate,
//    host-app-only-writable field the extension's own refresh never touches"
//    (`ios/IOS-SPIKE-LOG.md` DR-41-C).
//  * `writer` -- which process most recently wrote this marker (`"host"`/`"extension"`), the
//    tag Task 1's own action text asks for ("write a fresh marker value, tagged with which
//    process wrote it") -- lets E41-7's ACC-07 leg assert the HOST reads a value the EXTENSION
//    itself logged writing, receiver-side.
//
//  `write(_:)`/`read()`/`clear()` are the ONLY I/O this file performs; `SessionLifecycle.swift`
//  (this same plan) is the impure layer composing them with the Keychain delete neither process
//  may import from the other's target (`SessionKeyStore`/`SessionKeyReader`, host-only/
//  extension-only respectively) -- see that file's own header.
//
//  `isUnlockedLazily(now:idleWindow:absoluteCeiling:)` remains a PURE function of its explicit
//  inputs plus `self` -- no I/O, no `UserDefaults` read, no `sysctlbyname` call -- so it is
//  directly testable without a process. The `bootSessionId` EQUALITY check against the CURRENT
//  boot is a SEPARATE concern, composed by the caller (`currentBootSessionId()` below plus a
//  plain `==`) -- a reboot ending the session is a coarser, binary fact than the lazy idle check,
//  and keeping the two checks separate is what lets each be tested independently.
//

import Foundation

public struct LockMarker: Codable, Equatable {
    /// `kern.bootsessionuuid` at WRITE time -- a UUID that changes every boot. A mismatch against
    /// `currentBootSessionId()` at READ time means the device has rebooted since this marker was
    /// written; DR-41-C treats that as expired (a defensible default, not a defect).
    public let bootSessionId: String

    /// WR-07 (41-REVIEW.md iteration 2): renamed from `systemUptimeAtUnlock` -- CR-04 changed the
    /// clock this field carries FROM `ProcessInfo.processInfo.systemUptime` (excludes sleep) TO
    /// `LockMarker.monotonicNow()` (`clock_gettime_nsec_np(CLOCK_MONOTONIC)`, backed by
    /// `mach_continuous_time()`, INCLUDES sleep) -- see that function's own header. The field name
    /// itself is part of what makes an artifact "true", and the `.v2` `defaultsKey` bump below
    /// already invalidates every pre-CR-04 marker, so this rename costs nothing beyond this commit
    /// and never gets cheaper the longer the old name (and the old clock it implies) survives.
    /// The monotonic half of DR-41-C's clock pair. ACC-07's activity refresh (either process)
    /// updates THIS field; it never touches `hostUnlockUptime` below.
    public let monotonicAtUnlock: Double

    /// DR-41-C's 12-hour ABSOLUTE ceiling anchor -- the monotonic clock (`LockMarker
    /// .monotonicNow()`, sleep-inclusive) at the last REAL host-app unlock. Set ONLY by
    /// `SessionLifecycle.recordHostUnlock()` (host-only caller); AutoFill activity
    /// (`SessionLifecycle.refreshActivity(writer:)`) can extend `monotonicAtUnlock`
    /// (the idle window) but must carry THIS field forward unchanged, exactly as DR-41-C
    /// requires: "AutoFill traffic ... can extend the idle window but can never push the session
    /// past this 12-hour ceiling."
    public let hostUnlockUptime: Double

    /// Which process most recently wrote this marker -- `"host"` or `"extension"`. Task 1's own
    /// action text: "tagged with which process wrote it." Never security-load-bearing on its
    /// own (a value ONLY a reader can compare against what a writer logged, E41-7's ACC-07 leg).
    public let writer: String

    public init(bootSessionId: String, monotonicAtUnlock: Double, hostUnlockUptime: Double, writer: String) {
        self.bootSessionId = bootSessionId
        self.monotonicAtUnlock = monotonicAtUnlock
        self.hostUnlockUptime = hostUnlockUptime
        self.writer = writer
    }

    // MARK: - Storage (DR-41-C: the App Group container, `UserDefaults(suiteName:)`)

    private static let suiteName = "group.cloud.blonie.PasskeyVault"
    // CR-04 (41-REVIEW.md): bumped `.v2` -- the field values now mean something DIFFERENT
    // (`monotonicNow()`'s sleep-inclusive clock, not `ProcessInfo.systemUptime`'s sleep-excluding
    // one). A marker written by a build predating this fix must be treated as invalid rather than
    // silently compared against a different clock -- reading the OLD key back would either always
    // look expired (safe) or, worse, mix an old-clock anchor with a new-clock `now` and produce an
    // arithmetically meaningless `elapsed`. The key bump makes a mid-upgrade marker UNREADABLE
    // under the new key (`LockMarker.read()` returns `nil`), which reads never treat as a session
    // (correct -- WR-02, 41-REVIEW.md iteration 2: this line ORIGINALLY claimed that also means
    // "treated as expired", i.e. Secret C gets deleted. That was FALSE after WR-03 reclassified a
    // `nil` read as `.indeterminate`, which does not delete -- a mid-upgrade user's pre-`.v2`
    // Secret C was silently orphaned in the Keychain until their next explicit lock. WR-02 closes
    // that gap via `legacyMarkerKeyHasData`/`isDeleteOwed` below: reads are correctly refused
    // either way, but the artifact itself is no longer merely left behind.
    private static let defaultsKey = "cloud.blonie.PasskeyVault.lockMarker.v2"

    /// WR-02 (41-REVIEW.md iteration 2): the PRE-`.v2` key -- still checked (never re-read as a
    /// marker; its shape may not even decode under the current type) purely to detect "a
    /// pre-CR-04 marker is still sitting in the App Group container", the mid-upgrade scenario
    /// CR-04's own `.v2` comment claimed was handled and WR-02 found was not: a live session that
    /// upgrades carries an orphaned Secret C in the Keychain until the user's next explicit lock,
    /// because `LockMarker.read()` returning `nil` under the new key is `.indeterminate`
    /// (WR-03), not `.expired`, and `.indeterminate` never used to delete anything.
    private static let legacyDefaultsKey = "cloud.blonie.PasskeyVault.lockMarker"

    /// WR-02 (41-REVIEW.md iteration 2): an owed-but-not-yet-confirmed Keychain deletion --
    /// recorded when `SessionLifecycle.checkAndExpireIfNeeded`'s `deleteKeyArtifact` closure
    /// reports failure on a genuine `.expired` determination. Survives `LockMarker.clear()` (the
    /// marker and the delete obligation are deliberately independent: clearing the EVALUATED
    /// state must never silently discard an obligation that state produced) so the NEXT entry
    /// point retries the deletion instead of ACC-06's own invariant ("deletion, never a mere
    /// refusal") degrading to "one best-effort attempt, then never again".
    private static let deleteOwedKey = "cloud.blonie.PasskeyVault.lockMarker.deleteOwed"

    /// WR-12 (41-REVIEW.md): resolves the CALLER-supplied `UserDefaults` override if present,
    /// otherwise the real App Group container -- the SAME injectable-suite discipline
    /// `SessionLifecycle.configuredIdleWindowSeconds(defaults:)` already established, extended
    /// here to the marker read/write/clear surface so `SessionLifecycle`'s own tests can exercise
    /// the real production code paths (`checkAndExpireIfNeeded`/`refreshActivity`/`lock`) without
    /// touching the real device's App Group container. Production call sites never pass an
    /// override, so this resolves to the real container exactly as before this fix.
    private static func resolveDefaults(_ override: UserDefaults?) -> UserDefaults? {
        override ?? UserDefaults(suiteName: suiteName)
    }

    /// Reads the marker, or `nil` if none has ever been written, the App Group container could
    /// not be resolved, or the stored value is undecodable.
    public static func read(defaults override: UserDefaults? = nil) -> LockMarker? {
        guard let defaults = resolveDefaults(override) else { return nil }
        guard let data = defaults.data(forKey: defaultsKey) else { return nil }
        return try? JSONDecoder().decode(LockMarker.self, from: data)
    }

    /// Writes the marker whole. ACC-07 (DR-41-C) permits BOTH processes to call this -- never
    /// called directly outside `SessionLifecycle.swift` in production code (that type owns which
    /// fields each caller may/may not carry forward; see its own header).
    public static func write(_ marker: LockMarker, defaults override: UserDefaults? = nil) {
        guard let defaults = resolveDefaults(override) else { return }
        guard let data = try? JSONEncoder().encode(marker) else { return }
        defaults.set(data, forKey: defaultsKey)
    }

    /// ACC-06's explicit-delete-on-expiry counterpart for the MARKER half (the Keychain artifact
    /// itself is deleted by `SessionLifecycle`'s caller-supplied `deleteKeyArtifact` closure,
    /// never by this file -- this type owns no Keychain code). Idempotent: clearing an
    /// already-absent marker is not an error.
    public static func clear(defaults override: UserDefaults? = nil) {
        guard let defaults = resolveDefaults(override) else { return }
        defaults.removeObject(forKey: defaultsKey)
    }

    // MARK: - WR-02 (41-REVIEW.md iteration 2): the owed-deletion obligation, independent of the
    // marker's own read/write/clear surface above.

    /// `true` when a prior `.expired` determination's `deleteKeyArtifact()` call reported failure,
    /// or when a pre-`.v2` marker was ever observed still sitting in the container (the mid-upgrade
    /// scenario CR-04's own comment claimed was already handled).
    public static func isDeleteOwed(defaults override: UserDefaults? = nil) -> Bool {
        resolveDefaults(override)?.bool(forKey: deleteOwedKey) ?? false
    }

    public static func markDeleteOwed(_ owed: Bool, defaults override: UserDefaults? = nil) {
        resolveDefaults(override)?.set(owed, forKey: deleteOwedKey)
    }

    /// `true` when the OLD, pre-`.v2` defaults key still carries a value -- evidence a device
    /// upgraded across CR-04's key bump while a session was live, and therefore may still be
    /// carrying an orphaned Secret C nothing has deleted yet. Never decodes the legacy value as a
    /// `LockMarker` (its clock field means something different, WR-07) -- presence alone is the
    /// only fact this needs.
    public static func legacyMarkerKeyHasData(defaults override: UserDefaults? = nil) -> Bool {
        resolveDefaults(override)?.data(forKey: legacyDefaultsKey) != nil
    }

    /// Clears the pre-`.v2` key once its presence has done its one job (triggering a retry via
    /// `legacyMarkerKeyHasData`) -- idempotent, and never touches the CURRENT `.v2` marker.
    public static func clearLegacyMarkerKey(defaults override: UserDefaults? = nil) {
        resolveDefaults(override)?.removeObject(forKey: legacyDefaultsKey)
    }

    // MARK: - Clock: the sleep-inclusive monotonic "now" (CR-04, 41-REVIEW.md)

    /// CR-04 (41-REVIEW.md): DR-41-C's original clock pair paired `bootSessionId` with
    /// `ProcessInfo.processInfo.systemUptime` -- Apple documents that value as "the amount of time
    /// the system has been AWAKE since the last time it was restarted", backed by
    /// `mach_absolute_time()`, which does NOT accrue while the device sleeps. Both `idleElapsed`
    /// and `ceilingElapsed` (`isUnlockedLazily` below) therefore under-counted real elapsed time by
    /// however long the device slept -- the fail-OPEN direction, on the artifact that lets a
    /// second process read the User Key with no biometric challenge.
    ///
    /// `clock_gettime_nsec_np(CLOCK_MONOTONIC)` is backed by `mach_continuous_time()` on Darwin,
    /// documented (xnu `bsd/sys/time.h`) as incrementing monotonically "including when the system
    /// is asleep" -- unlike `CLOCK_MONOTONIC_RAW`/`CLOCK_UPTIME_RAW`, which are `mach_absolute_time`-
    /// backed and explicitly documented as excluding sleep (the same family `ProcessInfo
    /// .systemUptime` belongs to). Still monotonic and NOT user-rewindable (unlike `Date()`), so
    /// DR-41-C's own rewound-clock guard (T-41-35) is unaffected.
    ///
    /// This determination is DOCUMENTED, not empirically re-verified against a real device-sleep
    /// cycle in this fix session -- doing so would require suspending the host Mac mid-session,
    /// which is unsafe to automate unattended. It rests on Apple's own xnu header documentation for
    /// the `CLOCK_MONOTONIC` family, which is the same basis this file's own original DR-41-C
    /// record already used to distinguish `systemUptime` from `mach_continuous_time`. See
    /// `SessionLifecycle.swift`'s own call sites (the ONLY production readers of "now" for this
    /// marker) for where `ProcessInfo.processInfo.systemUptime` was replaced by this function.
    public static func monotonicNow() -> TimeInterval {
        TimeInterval(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1_000_000_000
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

    /// `true` if and only if BOTH bounds hold: the elapsed monotonic uptime since
    /// `monotonicAtUnlock` is within `idleWindow` (ACC-06's own lazy check), AND the elapsed
    /// uptime since `hostUnlockUptime` is within `absoluteCeiling` (DR-41-C's 12-hour ceiling,
    /// independent of any AutoFill activity). A PURE function of `self` and its three explicit
    /// inputs -- no I/O. The caller is responsible for ALSO checking `bootSessionId` equality
    /// against `currentBootSessionId()` before trusting a `true` result here (see this file's
    /// header) -- that check is deliberately NOT folded into this function, so each can be tested
    /// independently.
    ///
    /// A `now` earlier than either anchor (a rewound clock, or a marker from the future) is
    /// treated as expired, never as "unlocked forever" -- T-41-35's own guard: a clock a user can
    /// move backward must never be able to resurrect a session by making `elapsed` negative.
    public func isUnlockedLazily(now: TimeInterval, idleWindow: TimeInterval, absoluteCeiling: TimeInterval) -> Bool {
        guard now >= monotonicAtUnlock, now >= hostUnlockUptime else { return false }
        let idleElapsed = now - monotonicAtUnlock
        let ceilingElapsed = now - hostUnlockUptime
        return idleElapsed <= idleWindow && ceilingElapsed <= absoluteCeiling
    }

    /// The FULL lazy-check predicate (Plan 41-07, Task 1): folds the `bootSessionId` equality
    /// check together with `isUnlockedLazily`'s own idle/ceiling arithmetic into ONE pure
    /// function of `self` plus its FOUR explicit inputs -- still no I/O, no `sysctlbyname` call.
    /// `SessionLifecycle` (the impure caller) supplies `currentBootSessionId` from
    /// `LockMarker.currentBootSessionId()`'s own sysctl read; this function never calls it
    /// itself, which is exactly what lets `LockMarkerTests.swift` exercise "a marker carrying a
    /// different boot identity" as a plain value, with no process/sysctl dependency at all.
    /// `isUnlockedLazily` above remains available separately (41-03's own design) for testing the
    /// idle/ceiling arithmetic in isolation from the boot-identity check.
    public func isValid(
        currentBootSessionId: String, now: TimeInterval, idleWindow: TimeInterval, absoluteCeiling: TimeInterval
    ) -> Bool {
        guard bootSessionId == currentBootSessionId else { return false }
        return isUnlockedLazily(now: now, idleWindow: idleWindow, absoluteCeiling: absoluteCeiling)
    }
}
