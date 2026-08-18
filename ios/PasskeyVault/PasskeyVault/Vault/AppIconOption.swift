//
//  AppIconOption.swift
//  PasskeyVault
//
//  Quick task 260818-fnt, Task 3. The pure, deterministic mapping between an
//  OS-reported `UIApplication.shared.alternateIconName` and the 4 icon
//  choices this app ships. No `UIApplication` dependency here -- that is
//  what makes `current(from:)` directly unit-testable.
//
//  `alternateName`'s 3 literal strings MUST be byte-identical to
//  `project.pbxproj`'s `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` list
//  (quick task 260818-fnt, Task 2) -- a mismatch here means
//  `setAlternateIconName` fails at runtime with no compile-time check
//  catching it.
//

import Foundation

enum AppIconOption: String, CaseIterable, Identifiable {
    // Named `whiteDefault` rather than the bare `white` -- the latter is
    // indistinguishable, to a plain-text grep, from `Color.white`/
    // `UIColor.white` (SwiftUI's implicit-member `.white` looks identical
    // regardless of type). `scripts/audit-ios-colour-tokens.sh` check 1
    // flags any bare `.white`/`.black` token in app source on exactly that
    // ambiguity, and rightly so -- it cannot see the enum's type. `rawValue`
    // stays `"white"` so accessibility identifiers, evidence filenames, and
    // the OS-facing default semantics are all unaffected by the rename.
    case whiteDefault = "white"
    case beige
    case dark
    case orange

    var id: String { rawValue }

    /// `nil` for `.whiteDefault` -- the shipped default, selected via
    /// `setAlternateIconName(nil)`. The other three MUST match the pbxproj
    /// list exactly.
    var alternateName: String? {
        switch self {
        case .whiteDefault: return nil
        case .beige: return "AppIconBeige"
        case .dark: return "AppIconDark"
        case .orange: return "AppIconOrange"
        }
    }

    /// Rule 1 fix (found live, this task): `UIImage(named:)`/`Image(_:)`
    /// does NOT reliably resolve an `.appiconset`'s own image -- the exact
    /// same lesson `OnboardingWelcomeStep.swift`'s own doc comment records
    /// for `AppIcon.appiconset` (plan 38-13). Each of these 4 names is a
    /// plain `.imageset` duplicating the corresponding appiconset's PNG,
    /// which `Image(_:)` IS documented to load reliably.
    var previewAssetName: String {
        switch self {
        case .whiteDefault: return "AppIconPreviewWhite"
        case .beige: return "AppIconPreviewBeige"
        case .dark: return "AppIconPreviewDark"
        case .orange: return "AppIconPreviewOrange"
        }
    }

    var displayName: String {
        switch self {
        case .whiteDefault: return "White (Default)"
        case .beige: return "Beige"
        case .dark: return "Dark"
        case .orange: return "Orange"
        }
    }

    /// A picker must always have SOME selection, never crash on an
    /// OS-reported name it doesn't know -- `nil` OR any unrecognised value
    /// falls back to `.whiteDefault`, the fail-safe case.
    static func current(from alternateIconName: String?) -> AppIconOption {
        guard let alternateIconName else { return .whiteDefault }
        return AppIconOption.allCases.first { $0.alternateName == alternateIconName } ?? .whiteDefault
    }
}
