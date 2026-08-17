//
//  VaultSearch.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 1. A direct port of
//  `packages/pv-ui/vault/search.ts` -- the match function and the domain
//  extraction helper, including its permissive fallback on an unparseable
//  URL.
//
//  NARROWNESS IS THE POINT (D5, research doc). This matches an item's `name`
//  for every type, and additionally a login's `username` and the HOSTNAME of
//  any of its `urls` -- and NOTHING else: not tags, not notes, not a TOTP
//  issuer, not an email, not a cardholder name. Widening this predicate is a
//  whole-product decision (the predicate lives in `pv-ui` precisely so every
//  surface shares it); it is not an iOS implementation detail to fix here.
//
//  MATCHING IS A PLAIN LOWERCASED SUBSTRING TEST, deliberately never one of
//  the platform's locale-aware / diacritic-folding string comparison
//  variants (Swift's locale-aware options would match "zazolc" against
//  "zażółć"), which the web client's `toLowerCase().includes()` does not.
//  Reaching for the platform-idiomatic string search here would be a silent
//  behavioural divergence from every other client even when the field set
//  matches exactly (D5's second half). Do not "fix" this to look more
//  native -- and do not name the forbidden APIs literally in this file even
//  in a comment, or the grep this file's own test suite runs to prove their
//  absence stops meaning anything.
//

import Foundation

enum VaultSearch {

    /// Verbatim port of `search.ts`'s `domainFromUrl`. JS's `new URL(url)`
    /// throws on a string with no scheme (a bare domain the user typed) and
    /// the TypeScript catches that and falls back to the raw string, so a
    /// partial match still works. `URL(string:)` does not throw in Swift,
    /// but a bare domain like "example.com" parses with a `nil` host (no
    /// scheme means Foundation reads it as a relative path, not an
    /// authority) -- checking for a non-empty `host` reproduces the identical
    /// fallback behaviour by a different mechanism.
    static func domainFromUrl(_ urlString: String) -> String {
        if let url = URL(string: urlString), let host = url.host, !host.isEmpty {
            return host
        }
        return urlString
    }

    /// Matches only what `search.ts`'s `matchesQuery` matches: `name` for
    /// every type, plus `username` and URL hostnames for `login` only.
    /// `needle` is already trimmed and lowercased by the caller.
    private static func matchesQuery(_ fields: ItemFields, needle: String) -> Bool {
        if fields.name.lowercased().contains(needle) {
            return true
        }
        if case let .login(login) = fields {
            if login.username.lowercased().contains(needle) {
                return true
            }
            for url in login.urls where !url.isEmpty {
                if domainFromUrl(url).lowercased().contains(needle) {
                    return true
                }
            }
        }
        return false
    }

    /// Instant client-side search over already-decrypted items -- no network
    /// call, called on every keystroke against the store's in-memory array,
    /// matching `search.ts`'s own contract.
    ///
    /// `undecryptable` rows are NEVER filtered out by a search query, even
    /// though iOS's model (unlike web's) retains no last-known-good `fields`
    /// for them to match against. Web's `VaultItem.undecryptable` keeps a
    /// stale `fields` and so naturally participates in `matchesQuery`; the
    /// iOS `VaultItemViewModel.content` enum instead has NO fields at all
    /// for that case, so making it "just fall through to no-match" would
    /// silently hide it the moment the user starts typing -- exactly what
    /// design-conformance's "One more" rule (§2) forbids: "`undecryptable`
    /// must be shown, never filtered." A tampering signal that vanishes when
    /// the user searches is worse than one that stays put and looks slightly
    /// odd in a filtered list.
    static func searchItems(_ items: [VaultItemViewModel], query: String) -> [VaultItemViewModel] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty {
            return items
        }
        return items.filter { item in
            if item.isUndecryptable {
                return true
            }
            guard let fields = item.fields else {
                // `pendingFamilyKey` rows carry no content to match at all
                // and are not the integrity signal the rule above protects
                // -- ordinary filtering applies.
                return false
            }
            return matchesQuery(fields, needle: needle)
        }
    }
}
