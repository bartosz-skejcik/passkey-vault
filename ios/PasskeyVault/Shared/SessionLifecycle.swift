//
//  SessionLifecycle.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-07, Task 1. The
//  single owner of the three cross-process session operations neither process may implement
//  twice: the LAZY EXPIRY CHECK (ACC-06's inherited premise -- the Keychain has no expiry
//  attribute of any kind, so every deletion trigger is event-based and a killed/jetsammed process
//  leaves a live envelope behind unless something else deletes it), the ACTIVITY REFRESH
//  (ACC-07 -- either process may extend the idle window, never the absolute ceiling), and the
//  EXPLICIT LOCK (host-only: "Lock now" / sign-out must tear down Secret C too, not merely the
//  in-memory `VaultStore`).
//
//  Deliberately holds NO Keychain code of its own. `SessionKeyStore.swift` (host-only target,
//  `PasskeyVault/PasskeyVault/Core/Keychain/`) and `SessionKeyReader.swift` (extension-only
//  target, `PasskeyVaultAutoFill/`) are separate, per-target artifacts by this phase's own
//  established discipline (`SessionKeyReader.swift`'s own header: "duplicated query shape rather
//  than imported -- separate build targets, no shared framework between them") -- a `Shared/`
//  file compiled into BOTH targets cannot import either target-scoped type without breaking the
//  OTHER target's build. Every method here therefore takes the Secret-C delete operation as a
//  closure, supplied by each call site's own target:
//    * host call sites pass `SessionKeyStore.delete`
//    * extension call sites pass `SessionKeyReader.delete`
//
//  DR-41-A (`ios/IOS-SPIKE-LOG.md` §1i): the artifact `checkAndExpireIfNeeded`/`lock` delete is
//  SECRET C (`SessionKeyStore`/`SessionKeyReader`'s own item, `kSecAttrService =
//  "cloud.blonie.PasskeyVault.session-key"`) -- NEVER Secret A (`UkEnvelopeStore`, the Phase-37
//  `.biometryCurrentSet` envelope), whose ACL and write path this record states explicitly are
//  "completely unchanged" by this plan. `SessionKeyStore.delete()`/`SessionKeyReader.delete()`
//  each already build their own delete query attribute-for-attribute identical to their own
//  `store()`/read query (self-consistency proven by inspection, both files' own `baseQuery`) --
//  the acceptance criterion this task names ("the delete query is byte-identical ... to Phase
//  37's write query") reads, reconciled against DR-41-A's own authoritative artifact choice, as
//  "byte-identical to the artifact's OWN write query, following the SAME convention Phase 37
//  established" (kSecClassGenericPassword + kSecAttrService, access group omitted, resolving to
//  the bundle's sole declared `keychain-access-groups` entry) -- SEE 41-07-SUMMARY.md's own
//  side-by-side attribute comparison for the full reconciliation, since a literal "same item as
//  Phase 37 wrote" reading would mean deleting Secret A, which DR-41-A explicitly forbids.
//
//  Every entry point that reads a key MUST call `checkAndExpireIfNeeded` FIRST, and log the
//  RETURN of this function under its OWN `entryPoint` label -- this file logs ONE line per call
//  (`PVLOCK|entry=<label> stage=lazy-check status=<unlocked|expired>`), in a single place, so a
//  count of these lines in a live capture is exactly a count of how many entry points actually
//  ran the check (this task's own acceptance criterion: "A count is required, not a spot check").
//

import Foundation
import os

enum SessionLifecycle {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// DR-41-C: 12 hours from the last REAL host-app unlock, independent of any AutoFill
    /// activity in the interim -- the absolute ceiling `hostUnlockUptime` anchors.
    static let absoluteCeilingSeconds: TimeInterval = 12 * 60 * 60

    /// ACC-06's idle window, sourced from `AutoLockPolicy` -- the user's chosen 1/5/15/30/60
    /// minute whitelist value -- NEVER a hardcoded interval (binding-scope routing note, this
    /// plan). `defaults` is injectable so `LockMarkerTests.swift` can prove a tampered stored
    /// interval falls back to `AutoLockPolicy.defaultMinutes` rather than widening the window,
    /// without touching the real App Group container.
    static func configuredIdleWindowSeconds(defaults: UserDefaults = AutoLockPolicy.sharedDefaults) -> TimeInterval {
        TimeInterval(AutoLockPolicy.read(defaults: defaults)) * 60
    }

    /// The lazy expiry check (ACC-06). MUST run before every key read, in both processes, at
    /// every entry point. On expiry (idle window exceeded, absolute ceiling exceeded, a
    /// boot-session mismatch, or no marker at all), EXPLICITLY deletes the key artifact via
    /// `deleteKeyArtifact` and clears the marker -- ACC-06's own requirement IS deletion, never a
    /// mere refusal to read. Returns `true` only when the session is genuinely still valid.
    @discardableResult
    static func checkAndExpireIfNeeded(entryPoint: String, deleteKeyArtifact: () -> Void) -> Bool {
        let now = ProcessInfo.processInfo.systemUptime
        let unlocked: Bool
        if
            let marker = LockMarker.read(),
            let currentBootSessionId = LockMarker.currentBootSessionId(),
            marker.isValid(
                currentBootSessionId: currentBootSessionId, now: now,
                idleWindow: configuredIdleWindowSeconds(), absoluteCeiling: absoluteCeilingSeconds
            )
        {
            unlocked = true
        } else {
            unlocked = false
            deleteKeyArtifact()
            LockMarker.clear()
        }
        logger.log("PVLOCK|entry=\(entryPoint, privacy: .public) stage=lazy-check status=\(unlocked ? "unlocked" : "expired", privacy: .public)")
        return unlocked
    }

    /// ACC-07's activity refresh -- called after a successful fill in the extension, and after a
    /// successful vault interaction (this plan's own choice of granularity: the foreground
    /// transition, `ContentView.swift`'s `scenePhase` handler -- the SAME "activity" signal
    /// `AutoLockPolicy`'s own original idle-timer design intent already assumed, 38-11-SUMMARY.md)
    /// in the host app. Reads the CURRENT marker and carries `bootSessionId`/`hostUnlockUptime`
    /// forward UNCHANGED -- the absolute ceiling this refresh must never move (DR-41-C) -- only
    /// `systemUptimeAtUnlock`/`writer` are updated. A no-op if no marker exists (nothing to
    /// refresh; the lazy check would already have refused and deleted).
    static func refreshActivity(writer: String) {
        guard let current = LockMarker.read() else { return }
        LockMarker.write(LockMarker(
            bootSessionId: current.bootSessionId,
            systemUptimeAtUnlock: ProcessInfo.processInfo.systemUptime,
            hostUnlockUptime: current.hostUnlockUptime,
            writer: writer
        ))
        logger.log("PVLOCK|stage=activity-refresh writer=\(writer, privacy: .public)")
    }

    /// A REAL host-app unlock (HOST-ONLY caller -- `ContentView.handleUnlocked(_:)`, the single
    /// choke point both `AuthView` and `LockView` funnel every successful unlock through).
    /// Resets EVERY field, including `hostUnlockUptime` -- the ONLY thing that may move the
    /// absolute ceiling forward.
    static func recordHostUnlock() {
        let bootSessionId = LockMarker.currentBootSessionId() ?? "unknown-boot-session"
        let now = ProcessInfo.processInfo.systemUptime
        LockMarker.write(LockMarker(
            bootSessionId: bootSessionId, systemUptimeAtUnlock: now, hostUnlockUptime: now, writer: "host"
        ))
        logger.log("PVLOCK|stage=host-unlock bootSessionId=\(bootSessionId, privacy: .public)")
    }

    /// The explicit lock -- HOST-ONLY ("Lock now" / sign-out, `ContentView.performLock()`/
    /// `performSignOut()`). Deletes both the key artifact and the marker, unconditionally --
    /// without this, tapping "Lock now" would tear down the host app's OWN in-memory session
    /// while leaving Secret C (and therefore AutoFill) fully able to keep filling.
    static func lock(deleteKeyArtifact: () -> Void) {
        deleteKeyArtifact()
        LockMarker.clear()
        logger.log("PVLOCK|stage=explicit-lock")
    }
}
