//
//  VaultFilter.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 1. A port of
//  `packages/pv-ui/vault/search.ts`'s `VaultFilter`/`filterItems` (the type
//  itself is declared in `packages/pv-ui/vault/types.ts`) -- the sidebar's
//  active folder/tag/type filter, entirely client-side, ANDed with the
//  search query over the same in-memory array. No new server request is
//  ever made for a filter.
//
//  The shared type has exactly FOUR cases and NO collection variant --
//  `{all} | {folder,id} | {tag} | {itemType}`. The web client documents that
//  as a deliberate honest gap (there is no "shared collection" filter kind
//  in `VaultFilter`, even though collections/folders are a real server
//  concept); iOS inherits the same hole and it is not an iOS bug to invent a
//  fifth case to fix here.
//

import Foundation

enum VaultFilter: Equatable, Hashable {
    case all
    case folder(id: String)
    case tag(String)
    /// The wire discriminant string, matching `ItemFields.typeName`
    /// (`"login"`, `"card"`, `"identity"`, `"note"`, `"totp"`, `"passkey"`).
    case itemType(String)
}

enum VaultFilterFunctions {

    private static func matches(_ fields: ItemFields, filter: VaultFilter) -> Bool {
        switch filter {
        case .all:
            return true
        case let .folder(id):
            return fields.folderId == id
        case let .itemType(type):
            return fields.typeName == type
        case let .tag(tag):
            return fields.tags.contains(tag)
        }
    }

    /// Client-side AND over the in-memory array. `.all` short-circuits to
    /// the identity, matching `search.ts`'s own early return.
    ///
    /// `undecryptable` rows pass EVERY filter unconditionally -- see
    /// `VaultSearch.searchItems`'s own note on the same rule. A row flagged
    /// as a possible tampering signal must not silently disappear because
    /// the user happened to be looking at the Logins tab or a folder token
    /// when the corrupted row belonged to neither.
    static func filterItems(_ items: [VaultItemViewModel], filter: VaultFilter) -> [VaultItemViewModel] {
        if filter == .all {
            return items
        }
        return items.filter { item in
            if item.isUndecryptable {
                return true
            }
            guard let fields = item.fields else {
                return false
            }
            return matches(fields, filter: filter)
        }
    }
}
