//
//  AppIconOptionTests.swift
//  PasskeyVaultTests
//
//  Quick task 260818-fnt, Task 3. `AppIconOption.current(from:)` is the one
//  pure, deterministic, testable surface -- no `UIApplication` dependency --
//  so this file asserts it directly, including the fail-safe fallback to
//  `.whiteDefault` on an unrecognised OS-reported name, the branch most
//  likely to silently break without a positive+negative pair of assertions.
//
//  The case is `.whiteDefault`, not the bare `.white` the original tracer
//  used -- `scripts/audit-ios-colour-tokens.sh` check 1 flags any bare
//  `.white`/`.black` token in app source as an indistinguishable-from-
//  literal-colour false positive (a plain-text grep cannot see the enum's
//  type). `rawValue` is still `"white"`, so this is a Swift-symbol rename
//  only -- accessibility identifiers and evidence filenames are unaffected.
//

import Testing
@testable import PasskeyVault

struct AppIconOptionTests {
    @Test
    func currentFromNilIsWhite() {
        #expect(AppIconOption.current(from: nil) == .whiteDefault)
    }

    @Test
    func currentFromKnownAlternateNames() {
        #expect(AppIconOption.current(from: "AppIconOrange") == .orange)
        #expect(AppIconOption.current(from: "AppIconBeige") == .beige)
        #expect(AppIconOption.current(from: "AppIconDark") == .dark)
    }

    /// The fail-safe fallback case -- easiest to silently break, asserted
    /// explicitly. An unrecognised OS-reported name must never crash the
    /// picker; it must fall back to `.whiteDefault`.
    @Test
    func currentFromUnrecognisedNameFallsBackToWhite() {
        #expect(AppIconOption.current(from: "somethingUnknown") == .whiteDefault)
    }

    @Test
    func alternateNamesMatchPbxprojLiterals() {
        #expect(AppIconOption.whiteDefault.alternateName == nil)
        #expect(AppIconOption.beige.alternateName == "AppIconBeige")
        #expect(AppIconOption.dark.alternateName == "AppIconDark")
        #expect(AppIconOption.orange.alternateName == "AppIconOrange")
    }
}
