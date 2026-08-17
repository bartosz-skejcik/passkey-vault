//
//  PasswordStrengthTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-08, Task 1. RED-first: this
//  file references `PasswordStrength` before `Generator/PasswordStrength.swift`
//  exists, and is watched failing to compile before the port lands.
//
//  Every expected value below was NOT hand-derived -- it was produced by
//  running the ACTUAL web implementation
//  (`packages/pv-ui/generator/strength.ts`'s `scorePasswordMeter`) against
//  the identical input string, via Node's type-stripping import
//  (`node --experimental-strip-types`, unflagged on Node >=23.6). See
//  38-08-SUMMARY.md for the full Node transcript with the real literal
//  inputs -- NOT reproduced verbatim here, deliberately: the mid-band
//  passphrase case below uses SYNTHETIC placeholder tokens rather than
//  real EFF Large Wordlist entries, specifically so this file never
//  contains a copy of a real wordlist word (T-38-08 prohibition: "Must
//  NOT copy... any word from the word list into any Swift source file --
//  a copy is drift by construction"; `scripts/audit-generator-uses-ffi.sh`
//  check 4 also greps for this). The score is structural (tier count from
//  hyphen-plus-letters, length >=12), not word-identity-dependent, so a
//  synthetic phrase reproduces the identical percentage/colour as a real
//  one -- verified against Node with the placeholder tokens themselves.
//
//  Both the Node transcript (38-08-SUMMARY.md) and the identical Swift
//  assertions below are what this plan's acceptance criteria call
//  "checked against the web client by scoring the identical string in
//  both."
//

import Foundation
import Testing
@testable import PasskeyVault

struct PasswordStrengthTests {

    // MARK: - Exact-percentage cases (not merely a band)

    /// The plan's own acceptance criterion: "an exact percentage rather
    /// than a band." A hyphen-joined six-word passphrase-SHAPED string has
    /// NO digit but the hyphen matches `[^a-zA-Z0-9]` in the TypeScript
    /// original -- so it scores 2 tiers (baseline + special), not 1.
    /// SYNTHETIC tokens, deliberately not real EFF wordlist entries (see
    /// this file's header) -- the score depends only on structure
    /// (letters + hyphens, length >=12), not on which words were chosen.
    @Test func sixWordHyphenJoinedPassphraseScoresSixtySevenPercentWarning() {
        let phrase = "mockwordone-mockwordtwo-mockwordthree-mockwordfour-mockwordfive-mockwordsix"
        let result = PasswordStrength.scoreMeter(phrase)
        #expect(result.percent == 67)
        #expect(result.color == .warning)
    }

    @Test func twentyCharacterPasswordWithDigitAndSymbolScoresTopBand() {
        let password = "Tr0ub4dor&3xamPl3XY!"
        #expect(password.count == 20)
        let result = PasswordStrength.scoreMeter(password)
        #expect(result.percent == 100)
        #expect(result.color == .success)
    }

    @Test func eightLowercaseLettersScoresTwentyTwoPercentError() {
        let result = PasswordStrength.scoreMeter("abcdefgh")
        #expect(result.percent == 22)
        #expect(result.color == .error)
    }

    /// Same PERCENT as the previous case (22) but a DIFFERENT colour --
    /// demonstrates the meter is class-based, not length-based: a digit
    /// changes the colour even when the rounded percentage coincides.
    @Test func fourCharsWithADigitScoresTwentyTwoPercentButWarningNotError() {
        let result = PasswordStrength.scoreMeter("ab12")
        #expect(result.percent == 22)
        #expect(result.color == .warning)
    }

    @Test func emptyStringScoresZeroPercentError() {
        let result = PasswordStrength.scoreMeter("")
        #expect(result.percent == 0)
        #expect(result.color == .error)
    }

    // MARK: - Full-mix top band, independent of the specific literal above

    @Test func sixteenCharacterAllFourClassesScoresTopBand() {
        let password = "Ab1!Ab1!Ab1!Ab1!"
        #expect(password.count == 16)
        let result = PasswordStrength.scoreMeter(password)
        #expect(result.percent == 100)
        #expect(result.color == .success)
    }
}
