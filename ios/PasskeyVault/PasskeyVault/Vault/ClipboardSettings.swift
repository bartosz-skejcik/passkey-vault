//
//  ClipboardSettings.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 2. A DIRECT PORT of
//  `packages/pv-ui/clipboard.ts`'s storage key, default, minimum, maximum
//  and clamp function.
//
//  The 30-60s range is a SECURITY CONTROL, not a preference: a settings
//  surface offering values outside it -- including a "never clear" option --
//  breaks the documented range. `offeredOptions` exists so a test can assert
//  the FULL set any settings UI enumerates is exactly in-range, not just that
//  the clamp function alone behaves.
//

import Foundation

enum ClipboardSettings {
    /// A distinct `UserDefaults` key from every other one this app writes
    /// (`SortPreference`, `ServerSettings`, `OnboardingGate`) -- namespaced
    /// the same way those are.
    static let key = "pv.vault.clipboardSeconds"

    static let defaultSeconds = 40
    static let minSeconds = 30
    static let maxSeconds = 60

    /// Clamps an arbitrary value into `[minSeconds, maxSeconds]`, falling
    /// back to `defaultSeconds` for anything not finite (NaN, +/-infinity) --
    /// ports `clampClipboardSeconds` exactly, including its "not finite ->
    /// DEFAULT, not MIN" branch (a below-range FINITE value, including a
    /// negative one, clamps to the MINIMUM instead).
    static func clamp(_ value: Double) -> Int {
        guard value.isFinite else { return defaultSeconds }
        let clamped = Swift.min(Double(maxSeconds), Swift.max(Double(minSeconds), value))
        return Int(clamped)
    }

    /// Reads the configured interval from `UserDefaults`, clamping a
    /// corrupt/out-of-range/unparseable stored value into range rather than
    /// trusting it (T-02-21's own discipline, ported).
    ///
    /// Unlike `clampClipboardSeconds`'s `Number(stored)` (which coerces a
    /// non-numeric STRING to `NaN` and therefore to the default via the
    /// "not finite" branch), `UserDefaults.double(forKey:)` type-coerces a
    /// non-numeric stored value to `0.0` -- a FINITE number that would
    /// otherwise silently clamp to the MINIMUM instead of the default. This
    /// function reads the stored object's actual type first specifically to
    /// preserve that "unparseable -> DEFAULT" behaviour rather than letting
    /// `UserDefaults`'s own coercion quietly turn it into "unparseable ->
    /// MINIMUM".
    static func read(defaults: UserDefaults = .standard) -> Int {
        guard let object = defaults.object(forKey: key) else { return defaultSeconds }
        if let number = object as? NSNumber {
            return clamp(number.doubleValue)
        }
        if let string = object as? String, let parsed = Double(string) {
            return clamp(parsed)
        }
        return defaultSeconds
    }

    static func write(_ seconds: Int, defaults: UserDefaults = .standard) {
        defaults.set(Double(clamp(Double(seconds))), forKey: key)
    }

    /// Every value a settings surface may legitimately offer -- the full
    /// clamped range in one-second steps. A slider/stepper UI must draw its
    /// values from exactly this set; nothing outside it, including a
    /// never-clear sentinel.
    static var offeredOptions: [Int] {
        Array(minSeconds...maxSeconds)
    }
}
