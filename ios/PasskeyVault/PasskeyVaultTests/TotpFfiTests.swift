//
//  TotpFfiTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-10, Task 1. The Swift-side
//  companion to `crates/pv-ffi/src/totp.rs`'s own Rust test module -- calls
//  through the REAL generated `pv_ffi.swift` bindings against the REAL
//  `pv-core::totp::generate_code` (via `pv-ffi`'s XCFramework, built by the
//  "Build pv-ffi XCFramework" Run Script phase). Nothing here is mocked --
//  Pitfall 4 (`38-RESEARCH.md`) names the exact false-green shape this file
//  must not reproduce: a green TOTP test whose secret decodes below
//  `totp-rs`'s 16-byte floor, passing only because the function under test
//  was mocked. `extension/entrypoints/background/autofill-match.test.ts:295`
//  is that shape's existing instance elsewhere in this repository; this file
//  is not it.
//
//  Every expected code below is a LITERAL, independently transcribed from
//  RFC 6238 Appendix B / `crates/pv-core/src/totp.rs`'s own test module --
//  never computed by calling `totpNow` and comparing it back to itself.
//

import Foundation
import Testing
import PasskeyVault

struct TotpFfiTests {

    // MARK: - Literal fixtures (RFC 6238 Appendix B)

    private static let sha1Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    /// The exact secret `extension/entrypoints/background/
    /// autofill-match.test.ts:295` uses under a mocked `totpNow` -- 16
    /// base32 characters, a 10-byte decode, below `totp-rs`'s 16-byte
    /// floor. MUST NOT be used anywhere in this file as evidence of a
    /// passing code (must_haves.prohibitions) -- used ONLY below to prove
    /// the real path rejects it.
    private static let tooShortSecret = "JBSWY3DPEHPK3PXP"

    // MARK: - RFC 6238 literal vectors, through the real FFI boundary

    @Test func totpNowMatchesTheFirstRfc6238Sha1Vector() throws {
        let result = try totpNow(
            secretB32: Self.sha1Secret, algorithm: "SHA1", digits: 8, period: 30, unixTimeSeconds: 59
        )
        #expect(result.code == "94287082")
        // t=59, period=30: 59 % 30 == 29, so 30 - 29 == 1 remaining second --
        // NOT zero. The countdown view (Task 2) must reproduce this exact
        // arithmetic every tick rather than decrementing locally.
        #expect(result.secondsRemaining == 1)
    }

    @Test func totpNowMatchesAllSixRfc6238Sha1Vectors() throws {
        let cases: [(UInt64, String)] = [
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ]
        for (t, expected) in cases {
            let result = try totpNow(
                secretB32: Self.sha1Secret, algorithm: "SHA1", digits: 8, period: 30, unixTimeSeconds: t
            )
            #expect(result.code == expected, "SHA1 mismatch at t=\(t)")
        }
    }

    /// An unrecognized algorithm name must produce the SAME code as the
    /// default (SHA1) algorithm -- `pv_core::totp::parse_algorithm`'s
    /// deliberate fail-safe. A throw here would mean `pv-ffi` added
    /// validation the crypto layer deliberately does not have.
    @Test func unrecognizedAlgorithmFallsBackToTheDefault() throws {
        let defaultResult = try totpNow(
            secretB32: Self.sha1Secret, algorithm: "SHA1", digits: 6, period: 30, unixTimeSeconds: 100
        )
        let unknownResult = try totpNow(
            secretB32: Self.sha1Secret, algorithm: "SHA999-not-real", digits: 6, period: 30,
            unixTimeSeconds: 100
        )
        #expect(unknownResult.code == defaultResult.code)
        #expect(unknownResult.secondsRemaining == defaultResult.secondsRemaining)
    }

    /// A secret whose decoded length is below `totp-rs`'s 16-byte floor
    /// throws, never returns a code -- Pitfall 4's exact trap, proven here
    /// through the real framework rather than assumed.
    @Test func secretBelowMinimumLengthThrows() {
        #expect(throws: (any Error).self) {
            _ = try totpNow(
                secretB32: Self.tooShortSecret, algorithm: "SHA1", digits: 6, period: 30,
                unixTimeSeconds: 100
            )
        }
    }

    /// `assert_digits` (`totp-rs-5.7.2/src/rfc.rs:41`) restricts `digits` to
    /// `6...8` inclusive -- an imported item with `digits=4` throws rather
    /// than returning a code.
    @Test func digitCountOutsideAcceptedRangeThrows() {
        #expect(throws: (any Error).self) {
            _ = try totpNow(
                secretB32: Self.sha1Secret, algorithm: "SHA1", digits: 4, period: 30,
                unixTimeSeconds: 100
            )
        }
    }
}
