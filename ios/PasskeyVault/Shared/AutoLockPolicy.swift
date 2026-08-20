//
//  AutoLockPolicy.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 38 (pełny interfejs vaulta), plan 38-11. A DIRECT PORT of
//  `web/src/lib/idle/autolock.ts`'s storage contract: the same fixed option
//  list, the same default, and the same "read through the whitelist, never
//  trust the stored value" discipline -- so a tampered/corrupted/future
//  out-of-whitelist stored value can never produce an unbounded auto-lock
//  timeout (T-38-11-02).
//
//  This is the SECOND of the two things this phase is allowed to persist --
//  the other is `ClipboardSettings.swift`'s clipboard interval (38-07). No
//  field value, ever. See `grep -rn 'UserDefaults\|AppStorage'`'s own
//  enumeration in `38-11-SUMMARY.md`.
//
//  WR-02 (38-REVIEW.md) closed by Phase 41, Plan 41-07 (orchestrator routing
//  note, `ios/IOS-SPIKE-LOG.md` §8/§8a: "AutoLockPolicy is orphaned ... the
//  truer home is Phase 41's ACC-06/ACC-07 ... MUST be claimed by one of them
//  or it will be lost"). Its ONE real consumer as of this plan is
//  `SessionLifecycle.configuredIdleWindowSeconds()` (`Shared/
//  SessionLifecycle.swift`), which drives ACC-06's own lazy-expiry idle
//  window in BOTH processes -- never a hardcoded interval.
//
//  MOVED from `PasskeyVault/PasskeyVault/Vault/` (host-target-only) into
//  `Shared/` here, and its storage moved from `UserDefaults.standard`
//  (per-process/per-container, even under an App Group entitlement -- NOT
//  actually shared between the host app and the extension) to the SAME App
//  Group suite `LockMarker` already uses. Without this move, the extension
//  target could not even SEE this type, let alone read a value the host app
//  wrote: `UserDefaults.standard` resolves to a DIFFERENT sandboxed
//  container per process. This is the reconciliation the binding-scope
//  routing note asked for -- "AutoLockPolicy wins unless the plan documents
//  a stronger reason" -- there is no stronger reason on the OTHER side here:
//  41-03's own tracer used a hardcoded 15-minute placeholder
//  (`CredentialProviderViewController.tracerIdleWindowSeconds`) explicitly
//  because "Plan 41-07 owns the real, configured value" -- this file is
//  that real, configured value, wired in.
//
//  `LockTeardownTests.swift` (Phase 38) always passes an explicit `defaults:`
//  override in every test -- moving the DEFAULT parameter's underlying
//  store does not change any of those tests' behaviour.
//

import Foundation

enum AutoLockPolicy {
    /// A distinct `UserDefaults` key from `ClipboardSettings`/`SortPreference`/
    /// `ServerSettings`/`OnboardingGate` -- namespaced the same way those are.
    static let key = "pv.vault.autoLockMinutes"

    /// The FIXED whitelist -- identical to `AUTOLOCK_OPTIONS` in
    /// `web/src/lib/idle/autolock.ts`. Any settings surface built on this
    /// enum must offer exactly these values, nothing else.
    static let options: [Int] = [1, 5, 15, 30, 60]

    /// Matches `DEFAULT_AUTOLOCK_MINUTES` exactly (`web/src/lib/idle/
    /// autolock.ts`'s own string constant, parsed to `15`).
    static let defaultMinutes = 15

    /// The App Group suite BOTH processes resolve identically -- `LockMarker.swift`'s own
    /// literal, duplicated here rather than imported (this type has no dependency on
    /// `LockMarker`'s own Codable shape, and importing just for a string constant would be a
    /// stranger coupling than repeating one literal both files already document plainly).
    /// Falls back to `.standard` only if the App Group container cannot be resolved at all (a
    /// misconfigured entitlement) -- never crashes, degrades to the OLD per-process behaviour
    /// rather than losing the read/write entirely.
    static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: "group.cloud.blonie.PasskeyVault") ?? .standard
    }

    /// Reads the configured interval from `UserDefaults`, validated against
    /// `options`. Any missing, negative, non-numeric, or out-of-whitelist
    /// value falls back to `defaultMinutes` -- this mirrors the web client's
    /// own `readAutolockMinutes()`, including its three named failure
    /// shapes: a value not on the list, a negative value, and a value that
    /// does not parse as a number at all.
    ///
    /// Reads the stored object's ACTUAL type first (same discipline as
    /// `ClipboardSettings.read`) rather than going through
    /// `UserDefaults.integer(forKey:)`, whose own type-coercion turns a
    /// non-numeric stored value into a FINITE `0` -- which is itself
    /// off-whitelist and would still fall through to the default here, but
    /// silently, in a way a future reader could mistake for "0 is a real
    /// stored value" rather than "nothing parseable was stored at all".
    static func read(defaults: UserDefaults = sharedDefaults) -> Int {
        guard let object = defaults.object(forKey: key) else { return defaultMinutes }
        let candidate: Int?
        switch object {
        case let number as NSNumber:
            candidate = number.intValue
        case let string as String:
            candidate = Int(string)
        default:
            candidate = nil
        }
        guard let candidate, options.contains(candidate) else { return defaultMinutes }
        return candidate
    }

    /// Only ever called with a value already drawn from `options` by a
    /// settings surface -- but validated again here regardless, so a
    /// programmer error at a call site can never persist an out-of-whitelist
    /// value in the first place (defense-in-depth alongside `read`'s own
    /// validation on the way back out).
    static func write(_ minutes: Int, defaults: UserDefaults = sharedDefaults) {
        guard options.contains(minutes) else { return }
        defaults.set(minutes, forKey: key)
    }
}
