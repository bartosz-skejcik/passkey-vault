//
//  VaultSort.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 1. A port of
//  `packages/pv-ui/vault/sort.ts`'s comparator ONLY -- the pure list-sort
//  logic, never mutating its input. Sort *persistence* is genuinely
//  platform-specific (the TS module's own header note: sync `localStorage`
//  on web vs async `browser.storage.local` on the extension, each with its
//  own storage key) and stays out of this file entirely -- see
//  `SortPreference.swift`. This file must never reference the platform
//  persistence mechanism by name, even in a comment, or a grep proving its
//  absence stops meaning anything; the comparator is the ported half, the
//  persistence is not.
//

import Foundation

enum SortOption: String, CaseIterable, Identifiable, Equatable {
    case lastUsed
    case name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .lastUsed: return "Last used"
        case .name: return "Name"
        }
    }
}

enum VaultSort {

    /// Matches `sort.ts`'s `DEFAULT_SORT`.
    static let defaultOption: SortOption = .lastUsed

    /// `localeCompare`'s closest Swift equivalent for a pure name-ordering
    /// comparison. This is NOT the search predicate -- `VaultSearch.swift`'s
    /// own header explains why locale-aware comparison is forbidden THERE
    /// (it folds diacritics, diverging from the web client's plain
    /// substring test). Sorting has no such constraint: `sort.ts` uses
    /// `String.prototype.localeCompare`, which IS locale-aware, so
    /// `localizedStandardCompare` here is the port, not a platform
    /// shortcut. iOS undecryptable/pending rows carry no `fields.name` to
    /// sort by, so this compares `displayName`, which resolves those two
    /// cases to their fixed placeholder strings.
    private static func byName(_ a: VaultItemViewModel, _ b: VaultItemViewModel) -> Bool {
        a.displayName.localizedStandardCompare(b.displayName) == .orderedAscending
    }

    /// Sorts an (already filtered/searched) array. Never mutates its input --
    /// `Array.sorted` already returns a new array, matching `sort.ts`'s own
    /// copy-on-write convention.
    ///
    /// `.lastUsed`: descending by `lastUsedAt` (most recent first); an item
    /// that has NEVER been used (`lastUsedAt == nil`) sinks to the bottom,
    /// ordered alphabetically by name among itself -- NordPass' own
    /// "never used" tail-of-list convention, matching `sort.ts` exactly.
    /// `.name`: ascending alphabetical, ignoring `lastUsedAt` entirely.
    static func sortItems(_ items: [VaultItemViewModel], by option: SortOption) -> [VaultItemViewModel] {
        switch option {
        case .name:
            return items.sorted(by: byName)
        case .lastUsed:
            return items.sorted { a, b in
                switch (a.lastUsedAt, b.lastUsedAt) {
                case let (aUsed?, bUsed?):
                    // ISO 8601 strings compare lexically in the same order
                    // they compare chronologically -- `localeCompare`'s
                    // descending direction in `sort.ts` is `b` before `a`.
                    return bUsed.localizedStandardCompare(aUsed) == .orderedAscending
                case (.some, .none):
                    return true
                case (.none, .some):
                    return false
                case (.none, .none):
                    return byName(a, b)
                }
            }
        }
    }
}
