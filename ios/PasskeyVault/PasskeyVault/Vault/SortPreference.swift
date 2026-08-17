//
//  SortPreference.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 1. The chosen sort
//  option's persistence -- deliberately platform-specific, per `sort.ts`'s
//  own header ("Persistence... is genuinely platform-specific... and stays
//  local to each consumer's own split-shim"). `UserDefaults` is the
//  sanctioned iOS mechanism; the comparator it persists a *choice* about
//  lives entirely in `VaultSort.swift`, which this file never touches.
//

import Foundation

enum SortPreference {
    /// A distinct key from every other `UserDefaults` key this app writes
    /// (`ServerSettings`, `OnboardingGate`, autolock/clipboard policy) --
    /// namespaced the same way those are.
    static let key = "pv.vault.sortOption"

    static func read(defaults: UserDefaults = .standard) -> SortOption {
        guard
            let raw = defaults.string(forKey: key),
            let option = SortOption(rawValue: raw)
        else {
            return VaultSort.defaultOption
        }
        return option
    }

    static func write(_ option: SortOption, defaults: UserDefaults = .standard) {
        defaults.set(option.rawValue, forKey: key)
    }
}
