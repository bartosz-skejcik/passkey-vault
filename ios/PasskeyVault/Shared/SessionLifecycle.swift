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

    /// WR-03 (41-REVIEW.md): the three outcomes `checkAndExpireIfNeeded` must distinguish. Before
    /// this fix, a single `else` branch covered FOUR very different conditions -- genuine idle
    /// expiry, ceiling expiry, a boot mismatch, AND "the marker could not be read at all" (App
    /// Group container unresolvable in this particular extension invocation, a `JSONDecoder`
    /// failure, `sysctlbyname` failing) -- and deleted Secret C in every one of them. Failing
    /// CLOSED on an unreadable marker (never treating "cannot determine" as "unlocked") is
    /// correct; DELETING the key artifact on an inconclusive read is not -- a transient container
    /// resolution failure would permanently destroy a valid session, with no user-visible
    /// explanation and no repair short of a full host-app unlock.
    enum LockState: Equatable, CustomStringConvertible {
        case unlocked
        case expired
        case indeterminate

        var description: String {
            switch self {
            case .unlocked: return "unlocked"
            case .expired: return "expired"
            case .indeterminate: return "indeterminate"
            }
        }

        /// REQUIRED FIX #1 (`.planning/debug/faceid-unlock-loop.md`): the UI ROUTING contract.
        /// Before this fix, `checkAndExpireIfNeeded` collapsed this whole enum to a `Bool` at its
        /// own return statement (`state == .unlocked`), so EVERY caller -- including
        /// `ContentView.swift`'s `.onChange(of: scenePhase)` handler -- saw `.expired` and
        /// `.indeterminate` as the identical `false`, and routed BOTH to `performLock()`. That is
        /// exactly the mistake WR-03 (41-REVIEW.md) already named and fixed for the Keychain
        /// DELETE decision ("failing CLOSED on an unreadable marker ... is correct; DELETING the
        /// key artifact on an inconclusive read is not") -- this property applies the SAME
        /// reasoning to the SEPARATE question of what the visible UI does. Only a genuine,
        /// EVALUATED `.expired` verdict may drive a relock; `.indeterminate` ("cannot determine
        /// -- the marker could not be read at all") must never be treated as a reason to lock an
        /// already-unlocked app, on pain of exactly the infinite Face ID loop this record
        /// investigates (a wrong relock remounts `LockView`, which auto-prompts again, which
        /// unlocks again, which -- with the SAME unreadable marker -- wrongly relocks again).
        /// `.unlocked` obviously never locks either. A single, named, directly-testable boolean
        /// rather than each call site re-deriving `== .expired` and risking a silent drift back
        /// to "treat any non-`.unlocked` verdict as lock-worthy".
        var mustRelock: Bool {
            self == .expired
        }
    }

    /// The lazy expiry check (ACC-06). MUST run before every key read, in both processes, at
    /// every entry point. On a POSITIVE expiry determination (idle window exceeded, absolute
    /// ceiling exceeded, or a boot-session mismatch -- a marker that WAS read and evaluated),
    /// EXPLICITLY deletes the key artifact via `deleteKeyArtifact` and clears the marker --
    /// ACC-06's own requirement IS deletion, never a mere refusal to read. On an INDETERMINATE
    /// read (the marker could not be read at all), refuses the read but never destroys a session
    /// that could not be evaluated (WR-03).
    ///
    /// REQUIRED FIX #1 (`.planning/debug/faceid-unlock-loop.md`): returns the full `LockState`
    /// tri-state directly -- this function used to collapse it to `Bool` (`state == .unlocked`)
    /// at this exact return statement, which is what let `ContentView`'s ROUTING decision treat
    /// `.indeterminate` (an App-Group-unresolvable device, observed live) identically to a
    /// genuine `.expired`, producing an infinite Face-ID relock loop. Callers that only ever
    /// cared about "is the key readable right now" (the AutoFill extension's own read-gating
    /// call sites, `CredentialProviderViewController.swift`) compare the result against
    /// `.unlocked` explicitly -- their behaviour is UNCHANGED (an unreadable-vs-expired
    /// distinction was never meaningful for "may I read the key this instant", only for "should
    /// I destroy the user's visible session state", which is `ContentView`'s own question).
    /// WR-12 (41-REVIEW.md): `defaults` is injectable, the SAME discipline
    /// `configuredIdleWindowSeconds(defaults:)` already established -- production call sites never
    /// pass an override (resolving to the real App Group container exactly as before); tests inject
    /// an isolated `UserDefaults` suite so `SessionLifecycleTests` can exercise this REAL function
    /// (never a re-implementation) without disturbing a real device's container.
    @discardableResult
    static func checkAndExpireIfNeeded(
        entryPoint: String, deleteKeyArtifact: () -> Bool, defaults: UserDefaults? = nil
    ) -> LockState {
        // CR-04 (41-REVIEW.md): `LockMarker.monotonicNow()`, NOT `ProcessInfo.processInfo
        // .systemUptime` -- see that function's own header for why the old clock under-counted
        // real elapsed time (fail-open) across a device sleep.
        let now = LockMarker.monotonicNow()
        let state: LockState
        if let marker = LockMarker.read(defaults: defaults) {
            if
                let currentBootSessionId = LockMarker.currentBootSessionId(),
                marker.isValid(
                    currentBootSessionId: currentBootSessionId, now: now,
                    // WR-09 (41-REVIEW.md iteration 2): thread the SAME injected `defaults`
                    // override through to the idle-window read too -- before this fix, only the
                    // MARKER read/write/clear calls in this function honored `defaults`;
                    // `configuredIdleWindowSeconds()` (no argument) always resolved
                    // `AutoLockPolicy.sharedDefaults`, the REAL App Group container, so a test
                    // that forced expiry via a bogus `bootSessionId` never actually proved the
                    // idle-window arithmetic itself was reading from the injected suite.
                    idleWindow: configuredIdleWindowSeconds(defaults: defaults ?? AutoLockPolicy.sharedDefaults),
                    absoluteCeiling: absoluteCeilingSeconds
                )
            {
                state = .unlocked
            } else {
                // A marker WAS read (a real, positive expiry determination is possible) --
                // `currentBootSessionId()` returning `nil` here (sysctl unreachable) is treated as
                // "cannot confirm this boot", which `isValid` would have refused anyway; either
                // way this is a genuine, evaluated refusal, not a missing-input non-verdict.
                state = .expired
            }
        } else {
            // The marker itself could not be read at all -- App Group container unresolvable in
            // THIS invocation, a decode failure, or simply no marker ever written. This is
            // "cannot determine", never "expired" -- WR-03's own distinction.
            state = .indeterminate
        }

        switch state {
        case .expired:
            // WR-02 (41-REVIEW.md iteration 2): a genuine, evaluated expiry ALWAYS clears the
            // marker (there is nothing left to evaluate against), but the Keychain deletion itself
            // is only confirmed discharged when the closure reports success -- a failure records
            // an owed deletion so the NEXT entry point retries it, rather than ACC-06's own
            // invariant ("deletion, never a mere refusal") silently degrading to "one best-effort
            // attempt, then never again" once WR-03's `.indeterminate` reclassification stops the
            // very next check from treating the (now unreadable) marker as expired too.
            if deleteKeyArtifact() {
                LockMarker.markDeleteOwed(false, defaults: defaults)
            } else {
                LockMarker.markDeleteOwed(true, defaults: defaults)
            }
            LockMarker.clear(defaults: defaults)
        case .indeterminate:
            // WR-02: the marker could not be read at all -- refuse the session (this function's
            // own return below reports `.indeterminate` verbatim, never collapsed to a Bool
            // `false` that would look identical to `.expired` -- REQUIRED FIX #1), but do NOT
            // treat this as "nothing to do"
            // when there is independent evidence an artifact may still be owed a deletion: either
            // a PRIOR `.expired` delete that failed (`isDeleteOwed`), or a pre-`.v2` marker still
            // sitting in the container (`legacyMarkerKeyHasData` -- the mid-upgrade scenario
            // CR-04's own comment claimed was already handled and was not). Never clears the
            // CURRENT marker here -- there is nothing evaluated to clear -- and never treats a
            // successful retry as evidence of expiry.
            if LockMarker.isDeleteOwed(defaults: defaults) || LockMarker.legacyMarkerKeyHasData(defaults: defaults) {
                if deleteKeyArtifact() {
                    LockMarker.markDeleteOwed(false, defaults: defaults)
                    LockMarker.clearLegacyMarkerKey(defaults: defaults)
                } else {
                    LockMarker.markDeleteOwed(true, defaults: defaults)
                }
            }
        case .unlocked:
            break
        }
        logger.log("PVLOCK|entry=\(entryPoint, privacy: .public) stage=lazy-check status=\(state.description, privacy: .public)")
        // REQUIRED FIX #1: returns `state` itself, never `state == .unlocked` -- see this
        // function's own doc comment and `LockState.mustRelock`'s own header for why collapsing
        // this to a `Bool` here was the routing half of the infinite Face-ID-loop defect.
        return state
    }

    /// ACC-07's activity refresh -- called after a successful fill in the extension, and after a
    /// successful vault interaction (this plan's own choice of granularity: the foreground
    /// transition, `ContentView.swift`'s `scenePhase` handler -- the SAME "activity" signal
    /// `AutoLockPolicy`'s own original idle-timer design intent already assumed, 38-11-SUMMARY.md)
    /// in the host app. Reads the CURRENT marker and carries `bootSessionId`/`hostUnlockUptime`
    /// forward UNCHANGED -- the absolute ceiling this refresh must never move (DR-41-C) -- only
    /// `monotonicAtUnlock`/`writer` are updated. A no-op if no marker exists (nothing to
    /// refresh; the lazy check would already have refused and deleted).
    static func refreshActivity(writer: String, defaults: UserDefaults? = nil) {
        guard let current = LockMarker.read(defaults: defaults) else { return }
        LockMarker.write(LockMarker(
            bootSessionId: current.bootSessionId,
            // CR-04 (41-REVIEW.md): `LockMarker.monotonicNow()`, not `ProcessInfo.processInfo
            // .systemUptime` -- see that function's own header.
            monotonicAtUnlock: LockMarker.monotonicNow(),
            hostUnlockUptime: current.hostUnlockUptime,
            writer: writer
        ), defaults: defaults)
        logger.log("PVLOCK|stage=activity-refresh writer=\(writer, privacy: .public)")
    }

    /// A REAL host-app unlock (HOST-ONLY caller -- `ContentView.handleUnlocked(_:)`, the single
    /// choke point both `AuthView` and `LockView` funnel every successful unlock through).
    /// Resets EVERY field, including `hostUnlockUptime` -- the ONLY thing that may move the
    /// absolute ceiling forward.
    static func recordHostUnlock(defaults: UserDefaults? = nil) {
        let bootSessionId = LockMarker.currentBootSessionId() ?? "unknown-boot-session"
        // CR-04 (41-REVIEW.md): `LockMarker.monotonicNow()`, NOT `ProcessInfo.processInfo
        // .systemUptime` -- see that function's own header for why the old clock under-counted
        // real elapsed time (fail-open) across a device sleep.
        let now = LockMarker.monotonicNow()
        LockMarker.write(LockMarker(
            bootSessionId: bootSessionId, monotonicAtUnlock: now, hostUnlockUptime: now, writer: "host"
        ), defaults: defaults)
        logger.log("PVLOCK|stage=host-unlock bootSessionId=\(bootSessionId, privacy: .public)")
    }

    /// The explicit lock -- HOST-ONLY ("Lock now" / sign-out, `ContentView.performLock()`/
    /// `performSignOut()`). Deletes both the key artifact and the marker, unconditionally --
    /// without this, tapping "Lock now" would tear down the host app's OWN in-memory session
    /// while leaving Secret C (and therefore AutoFill) fully able to keep filling.
    static func lock(deleteKeyArtifact: () -> Bool, defaults: UserDefaults? = nil) {
        // WR-02 (41-REVIEW.md iteration 2): the explicit lock is user-initiated and always ends
        // the in-memory session (the marker is cleared regardless of the delete outcome, matching
        // the pre-fix behaviour) -- but a Keychain deletion that failed here is recorded exactly
        // like a failed `.expired` deletion, so the NEXT `checkAndExpireIfNeeded` call retries it
        // instead of "Lock now" ever silently leaving Secret C behind.
        if deleteKeyArtifact() {
            LockMarker.markDeleteOwed(false, defaults: defaults)
        } else {
            LockMarker.markDeleteOwed(true, defaults: defaults)
        }
        LockMarker.clear(defaults: defaults)
        logger.log("PVLOCK|stage=explicit-lock")
    }
}
