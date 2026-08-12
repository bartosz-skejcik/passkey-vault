//
//  Engine.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. A faithful Swift
//  port of `packages/pv-ui/i18n/engine.ts`'s `t(dict, locale, key)` /
//  `interpolate` / `resolveLocale` shape, specialised to this app's own
//  dictionary (`Core/I18n/Dictionary.swift`).
//
//  Bilingual PL/EN is a LOCKED user decision (37-CONTEXT.md) -- there is NO
//  fallback-to-English path anywhere in this file. `LocalizedString`
//  carries `pl`/`en` as non-optional `String`s so a half-filled dictionary
//  entry is a COMPILE error, not a runtime gap that ships silently.
//

import Foundation

/// The two locales this app ever renders in. `.current` resolves from
/// `Locale.current` exactly once per access -- a pure mapping, tested
/// directly against literal identifier strings in
/// `I18nDictionaryTests.swift`, never read off the live device at test
/// time.
enum PVLocale: Equatable {
    case pl
    case en

    /// A `pl`-prefixed language code (`"pl"`, `"pl_PL"`, `"pl-PL"`, ...)
    /// selects `.pl`; everything else, including no match at all, selects
    /// `.en`. Mirrors `pv-ui/i18n/engine.ts`'s `resolveLocale()`
    /// fallback-to-`en` behaviour exactly -- there is no third case.
    static func resolve(from identifier: String) -> PVLocale {
        identifier.lowercased().hasPrefix("pl") ? .pl : .en
    }

    static var current: PVLocale {
        resolve(from: Locale.current.language.languageCode?.identifier ?? Locale.current.identifier)
    }
}

/// Both locales required at the type level: a `PVKey` whose dictionary
/// entry is missing one of `pl`/`en` cannot be constructed at all, so a
/// half-translated string is caught at COMPILE time, never discovered by a
/// user seeing English where Polish was expected (or vice versa).
struct LocalizedString {
    let pl: String
    let en: String
}

/// Mirrors `pv-ui/i18n/engine.ts`'s `interpolate`: if none of `vars`' keys
/// appear as `{key}` tokens in `template`, the values are appended
/// (space-joined) rather than silently dropped; otherwise every `{key}`
/// token is replaced by its value.
func interpolate(_ template: String, _ vars: [String: String]) -> String {
    guard !vars.isEmpty else { return template }

    let hasAnyToken = vars.keys.contains { template.contains("{\($0)}") }
    if !hasAnyToken {
        let extra = vars.values.joined(separator: " ")
        return extra.isEmpty ? template : "\(template) \(extra)"
    }

    var result = template
    for (key, value) in vars {
        result = result.replacingOccurrences(of: "{\(key)}", with: value)
    }
    return result
}

/// The one lookup function every view in this phase renders text through.
/// No literal user-facing string reaches a view body without passing
/// through here (`AuthView.swift`/`LockView.swift`'s own verify grep guard
/// against a bare `Text("...")`).
func t(_ key: PVKey, locale: PVLocale = .current, _ vars: [String: String] = [:]) -> String {
    let entry = PVDictionary.entry(for: key)
    let template: String
    switch locale {
    case .pl:
        template = entry.pl
    case .en:
        template = entry.en
    }
    return interpolate(template, vars)
}
