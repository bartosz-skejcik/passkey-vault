//
//  I18nDictionaryTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. Four suites, each
//  able to fail: completeness (every `PVKey` resolves in both locales, with
//  a demonstrated-red rehearsal recorded in this plan's SUMMARY, not
//  reproduced here as a permanent test since a permanently-red test cannot
//  exist in this file), no raw numeric error codes, the envelope-invalidated
//  message names the password route in both locales, and locale resolution.
//

import Foundation
import Testing
@testable import PasskeyVault

struct I18nDictionaryTests {

    // MARK: - Completeness

    /// Walks every `PVKey` case and asserts both `pl` and `en` are
    /// non-empty. `PVKey.allCases.count` is also asserted `>= 26` here so a
    /// future accidental case removal that happened to leave the walk
    /// "complete over an empty-ish set" would still be caught.
    @Test func everyKeyResolvesInBothLocalesNonEmpty() {
        #expect(PVKey.allCases.count >= 26)
        for key in PVKey.allCases {
            let entry = PVDictionary.entry(for: key)
            #expect(!entry.pl.isEmpty, "PL value missing for \(key)")
            #expect(!entry.en.isEmpty, "EN value missing for \(key)")
        }
    }

    // MARK: - No raw numeric error codes anywhere in the dictionary

    /// Scans every value (both locales, every key) for a signed-integer
    /// pattern (`-?\d{2,}`) -- the ACC-04 "never a raw OSStatus/LAError"
    /// rule enforced mechanically. `auth.faceIdUsageDescription` and every
    /// other string are included; nothing is exempted.
    @Test func noDictionaryValueContainsANumericErrorCode() throws {
        let pattern = try Regex(#"-?[0-9]{2,}"#)
        for key in PVKey.allCases {
            let entry = PVDictionary.entry(for: key)
            #expect(entry.pl.firstMatch(of: pattern) == nil, "PL value for \(key) contains a numeric code: \(entry.pl)")
            #expect(entry.en.firstMatch(of: pattern) == nil, "EN value for \(key) contains a numeric code: \(entry.en)")
        }
    }

    // MARK: - The route is inside the message, per locale

    /// `unlock.envelopeInvalidated`'s PL value contains `"hasł"` and its EN
    /// value contains `"password"` -- asserted PER LOCALE, not as an
    /// either-or, per `37-UI-SPEC.md`'s `<must_specify>` constraint.
    @Test func envelopeInvalidatedNamesThePasswordRouteInBothLocales() {
        let entry = PVDictionary.entry(for: .unlockEnvelopeInvalidated)
        #expect(entry.pl.contains("hasł"))
        #expect(entry.en.contains("password"))
    }

    // MARK: - Locale resolution

    @Test func plPrefixedIdentifiersResolveToPolish() {
        for identifier in ["pl", "pl_PL", "pl-PL"] {
            #expect(PVLocale.resolve(from: identifier) == .pl, "\(identifier) should resolve to .pl")
        }
    }

    @Test func nonPlIdentifiersResolveToEnglish() {
        for identifier in ["en", "en_US", "de_DE"] {
            #expect(PVLocale.resolve(from: identifier) == .en, "\(identifier) should resolve to .en")
        }
    }

    // MARK: - t(_:locale:) itself, and interpolation

    @Test func tReturnsThePolishOrEnglishValueByLocale() {
        #expect(t(.authEmailLabel, locale: .pl) == "Email")
        #expect(t(.authLoginSubmit, locale: .pl) == "Zaloguj się")
        #expect(t(.authLoginSubmit, locale: .en) == "Log in")
    }

    @Test func interpolationSubstitutesNamedPlaceholders() {
        let result = t(.unlockSignedInAs, locale: .en, ["email": "bartek@paczesny.pl"])
        #expect(result == "Signed in as bartek@paczesny.pl")

        let biometric = t(.unlockBiometricCta, locale: .pl, ["method": "Face ID"])
        #expect(biometric == "Odblokuj przez Face ID")
    }
}
