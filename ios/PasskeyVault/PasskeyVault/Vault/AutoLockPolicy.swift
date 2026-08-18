//
//  AutoLockPolicy.swift
//  PasskeyVault
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
//  WR-02 (38-REVIEW.md): this file has NO CONSUMER YET -- `read()`/`write()`
//  validate the whitelist and are unit-tested (`LockTeardownTests.swift`),
//  but nothing in the app calls `read()` to drive an actual idle timer, no
//  scene-phase hook, no `VaultRootController` wiring. There is no auto-lock
//  today; only the storage contract for one. Wiring the timer is explicitly
//  Phase 39's job (38-11-SUMMARY.md, "Next Phase Readiness") -- deferred,
//  not forgotten.
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
    static func read(defaults: UserDefaults = .standard) -> Int {
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
    static func write(_ minutes: Int, defaults: UserDefaults = .standard) {
        guard options.contains(minutes) else { return }
        defaults.set(minutes, forKey: key)
    }
}
