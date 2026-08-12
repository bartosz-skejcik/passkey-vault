//
//  InfoPlistLocalizationTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), post-review fix WR-01/FIX-4.
//
//  WR-01: `NSFaceIDUsageDescription` was hardcoded English-only in
//  project.pbxproj's `INFOPLIST_KEY_NSFaceIDUsageDescription` build setting
//  (a build setting cannot itself be localized), while
//  `Core/I18n/Dictionary.swift`'s `PVKey.authFaceIdUsageDescription` carried
//  real PL/EN values that were referenced nowhere -- dead code asserting
//  bilingual coverage the built app never actually shipped.
//
//  FIX: `InfoPlist.xcstrings` (a magic-named String Catalog Xcode merges
//  into the generated Info.plist per locale) now carries the SAME
//  `NSFaceIDUsageDescription` key with `pl`/`en` string units. This test
//  file has two parts:
//
//  1. `infoPlistXcstringsMatchesTheDictionaryEntryExactly` -- reads
//     `InfoPlist.xcstrings` straight off disk (via `#filePath`, the same
//     technique `ContrastTests.swift` already uses for `Assets.xcassets`)
//     and asserts its `pl`/`en` values are BYTE-IDENTICAL to
//     `PVDictionary.entry(for: .authFaceIdUsageDescription)` -- so the two
//     can never silently drift apart again.
//
//  2. The BUILT PRODUCT verification (`plutil -p` on the built `.app`'s
//     per-locale `InfoPlist.strings`, confirming the OS-facing string is
//     actually bilingual) is NOT reproduced as a permanent automated test
//     here -- it requires inspecting build OUTPUT, not source, and was
//     performed once as a manual verification step (recorded in
//     37-04-SUMMARY.md's "Post-review fixes" section) per this fix's own
//     instruction to verify through the built product, never by re-reading
//     the pbxproj/xcstrings source just edited.
//

import Foundation
import Testing
@testable import PasskeyVault

struct InfoPlistLocalizationTests {

    /// `#filePath` resolves to THIS file's absolute path at compile time --
    /// walking up from `PasskeyVaultTests/` to `PasskeyVault/InfoPlist.xcstrings`
    /// reads the value that actually ships, not a copy pasted into this test.
    private static var infoPlistXcstringsURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // ios/PasskeyVault/ (the .xcodeproj sibling dir)
            .appendingPathComponent("PasskeyVault")
            .appendingPathComponent("InfoPlist.xcstrings")
    }

    private struct StringUnit: Decodable {
        let value: String
    }

    private struct Localization: Decodable {
        let stringUnit: StringUnit
    }

    private struct StringEntry: Decodable {
        let localizations: [String: Localization]
    }

    private struct Catalog: Decodable {
        let strings: [String: StringEntry]
    }

    private static func loadCatalog() throws -> Catalog {
        let data = try Data(contentsOf: infoPlistXcstringsURL)
        return try JSONDecoder().decode(Catalog.self, from: data)
    }

    /// Positive, receiver-side assertion on the literal text shipped in
    /// BOTH files: `InfoPlist.xcstrings`' `NSFaceIDUsageDescription` entry's
    /// `pl`/`en` values must equal `PVDictionary`'s
    /// `authFaceIdUsageDescription` entry's `pl`/`en` values EXACTLY, not
    /// merely "both non-empty" or "both present".
    @Test func infoPlistXcstringsMatchesTheDictionaryEntryExactly() throws {
        let catalog = try Self.loadCatalog()
        guard let entry = catalog.strings["NSFaceIDUsageDescription"] else {
            Issue.record("InfoPlist.xcstrings has no NSFaceIDUsageDescription entry")
            return
        }
        guard let plUnit = entry.localizations["pl"], let enUnit = entry.localizations["en"] else {
            Issue.record("NSFaceIDUsageDescription is missing a pl or en localization")
            return
        }

        let dictionaryEntry = PVDictionary.entry(for: .authFaceIdUsageDescription)

        #expect(plUnit.stringUnit.value == dictionaryEntry.pl)
        #expect(enUnit.stringUnit.value == dictionaryEntry.en)
    }

    /// The shipped catalog covers exactly the two declared app locales
    /// (`project.pbxproj`'s `knownRegions`: `en`, `pl`, `Base`) -- neither
    /// missing nor carrying a stray third locale nobody asked for.
    @Test func infoPlistXcstringsCoversExactlyPlAndEn() throws {
        let catalog = try Self.loadCatalog()
        guard let entry = catalog.strings["NSFaceIDUsageDescription"] else {
            Issue.record("InfoPlist.xcstrings has no NSFaceIDUsageDescription entry")
            return
        }
        #expect(Set(entry.localizations.keys) == Set(["pl", "en"]))
    }
}
