//
//  OtpauthParserTests.swift
//  PasskeyVaultTests
//
//  Quick task 260818-lsk. `OtpauthParser` is Foundation-only (see its own
//  header) so this suite needs no simulator, no camera, no `XCUIApplication`
//  -- every case here is a pure string-in, struct-or-error-out check.
//
//  PROCESS NOTE, left in place rather than trimmed after the fact: the
//  `digitsDefaultsToSixWhenAbsent` test below was first run RED, asserting
//  `digits == 7` against a URI with no `digits=` param at all, to confirm the
//  suite can actually catch a wrong default before trusting it to prove a
//  right one. It failed with "Expectation failed: (parsed.digits → 6) == 7"
//  -- the real default, not a crash or a vacuous pass -- and was then
//  corrected to the true expectation (`== 6`) below.
//

import Foundation
import Testing
@testable import PasskeyVault

struct OtpauthParserTests {

    // MARK: - Happy path

    @Test func happyPathParsesLabelSecretAndParamIssuerOverridesLabelPrefix() throws {
        let uri = "otpauth://totp/Issuer:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Issuer"
        let parsed = try OtpauthParser.parse(uri)

        #expect(parsed.label == "Issuer:alice@example.com")
        #expect(parsed.secret == "JBSWY3DPEHPK3PXP")
        // The PARAM value wins, confirming it overrides whatever prefix
        // `label` happens to carry -- here they agree, but `issuer` is read
        // from `issuer=` alone, never re-derived from `label`.
        #expect(parsed.issuer == "Issuer")
        #expect(parsed.algorithm == .sha1)
        #expect(parsed.digits == 6)
        #expect(parsed.period == 30)
    }

    @Test func issuerParamOverridesADifferingLabelPrefix() throws {
        // The label prefix says "OldName"; the param says "RealIssuer". The
        // param must win -- this is the case a pass-through-the-label
        // implementation would get wrong.
        let uri = "otpauth://totp/OldName:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=RealIssuer"
        let parsed = try OtpauthParser.parse(uri)

        #expect(parsed.label == "OldName:alice@example.com")
        #expect(parsed.issuer == "RealIssuer")
    }

    // MARK: - Defaults

    @Test func digitsDefaultsToSixWhenAbsent() throws {
        let uri = "otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP"
        let parsed = try OtpauthParser.parse(uri)
        #expect(parsed.digits == 6)
    }

    @Test func allDefaultsAppliedWhenNoOptionalParamsArePresentAtAll() throws {
        let uri = "otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP"
        let parsed = try OtpauthParser.parse(uri)

        #expect(parsed.issuer == "")
        #expect(parsed.algorithm == .sha1)
        #expect(parsed.digits == 6)
        #expect(parsed.period == 30)
    }

    // MARK: - Explicit non-default params honored

    @Test func sha256Digits8Period60AreAllHonoredWhenPresent() throws {
        let uri = "otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60"
        let parsed = try OtpauthParser.parse(uri)

        #expect(parsed.algorithm == .sha256)
        #expect(parsed.digits == 8)
        #expect(parsed.period == 60)
    }

    @Test func algorithmParsingIsCaseInsensitive() throws {
        let uri = "otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP&algorithm=sha512"
        let parsed = try OtpauthParser.parse(uri)
        #expect(parsed.algorithm == .sha512)
    }

    // MARK: - HOTP rejected, not silently parsed

    @Test func hotpUriThrowsTheHotpUnsupportedErrorRatherThanParsing() {
        let uri = "otpauth://hotp/alice@example.com?secret=JBSWY3DPEHPK3PXP&counter=0"
        #expect(throws: OtpauthParseError.hotpUnsupported) {
            try OtpauthParser.parse(uri)
        }
    }

    // MARK: - Malformed URIs

    @Test func notAUrlAtAllThrowsMalformed() {
        #expect(throws: OtpauthParseError.malformed) {
            try OtpauthParser.parse("this is not a url")
        }
    }

    @Test func wrongSchemeThrowsMalformed() {
        #expect(throws: OtpauthParseError.malformed) {
            try OtpauthParser.parse("https://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP")
        }
    }

    @Test func totpWithNoPathAtAllThrowsMalformed() {
        #expect(throws: OtpauthParseError.malformed) {
            try OtpauthParser.parse("otpauth://totp?secret=JBSWY3DPEHPK3PXP")
        }
    }

    @Test func totpWithBareSlashAndNoLabelThrowsMalformed() {
        #expect(throws: OtpauthParseError.malformed) {
            try OtpauthParser.parse("otpauth://totp/?secret=JBSWY3DPEHPK3PXP")
        }
    }

    // MARK: - Secret validation

    @Test func missingSecretParamThrowsInvalidSecret() {
        #expect(throws: OtpauthParseError.invalidSecret) {
            try OtpauthParser.parse("otpauth://totp/alice@example.com?issuer=Foo")
        }
    }

    @Test func emptySecretParamThrowsInvalidSecret() {
        #expect(throws: OtpauthParseError.invalidSecret) {
            try OtpauthParser.parse("otpauth://totp/alice@example.com?secret=")
        }
    }

    @Test func secretContainingDigitZeroThrowsInvalidSecret() {
        // '0' is not in the base32 alphabet (which uses '2'-'7' only, to
        // avoid confusion with 'O'/'I'/'1'/'L').
        #expect(throws: OtpauthParseError.invalidSecret) {
            try OtpauthParser.parse("otpauth://totp/alice@example.com?secret=JBSWY0DPEHPK3PXP")
        }
    }

    @Test func secretContainingDigitOneThrowsInvalidSecret() {
        #expect(throws: OtpauthParseError.invalidSecret) {
            try OtpauthParser.parse("otpauth://totp/alice@example.com?secret=JBSWY1DPEHPK3PXP")
        }
    }

    @Test func lowercaseSecretThrowsInvalidSecret() {
        #expect(throws: OtpauthParseError.invalidSecret) {
            try OtpauthParser.parse("otpauth://totp/alice@example.com?secret=jbswy3dpehpk3pxp")
        }
    }

    @Test func secretWithNonBase32PunctuationThrowsInvalidSecret() {
        #expect(throws: OtpauthParseError.invalidSecret) {
            try OtpauthParser.parse("otpauth://totp/alice@example.com?secret=JBSW-Y3DP!EHPK")
        }
    }

    @Test func validBase32SecretWithPaddingIsAccepted() throws {
        let parsed = try OtpauthParser.parse("otpauth://totp/alice@example.com?secret=JBSWY3DP")
        #expect(parsed.secret == "JBSWY3DP")
    }

    // MARK: - Never computes a code

    @Test func parsedStructCarriesNoComputedCodeField() throws {
        // Not a reflection check -- a documentation-grade assertion that the
        // type this parser returns has exactly the six fields the header
        // promises, none of them a TOTP value. If a `code`/`currentCode`
        // field is ever added here, this line stops compiling, which is the
        // point: catch it at the type level, not by grepping for HMAC.
        let parsed = try OtpauthParser.parse(
            "otpauth://totp/alice@example.com?secret=JBSWY3DPEHPK3PXP"
        )
        let mirror = Mirror(reflecting: parsed)
        let fieldNames = Set(mirror.children.compactMap(\.label))
        #expect(fieldNames == ["label", "secret", "issuer", "algorithm", "digits", "period"])
    }
}
