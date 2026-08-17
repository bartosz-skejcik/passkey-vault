//
//  TotpValidation.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 1. Form-level TOTP
//  validation, mirroring the EXACT limits `crates/pv-core/src/totp.rs`'s
//  `generate_code` inherits from the vendored `totp-rs` 5.7.2 crate
//  (`~/.cargo/registry/.../totp-rs-5.7.2/src/rfc.rs:38-56`), never a
//  Swift-invented range:
//
//    - digits: 6...8 inclusive (`assert_digits`) -- a hard `TOTP::new`
//      error below/above this, mapped by `generate_code` to
//      `CryptoError::InvalidInput("invalid TOTP parameters")`.
//    - decoded secret length >= 16 bytes / 128 bits (`assert_secret_length`)
//      -- the SAME hard error.
//
//  Cleaning mirrors `generate_code`'s own preprocessing: whitespace and `=`
//  padding are stripped BEFORE decoding, because `totp_rs::Secret::Encoded
//  ::to_bytes()` rejects `=` outright and a copy-pasted/imported secret
//  commonly carries padding or stray whitespace. Do NOT add validation the
//  implementation does not have -- an unrecognized algorithm name falls
//  back to SHA1 deliberately (`parse_algorithm`), so this file never
//  rejects one.
//
//  The base32 DECODE below is a from-scratch RFC 4648 implementation
//  (uppercase `A-Z2-7` only, unpadded) because no base32 decoder exists
//  anywhere in this iOS codebase yet -- it deliberately mirrors the
//  `base32` crate's `Alphabet::Rfc4648 { padding: false }` table
//  (`~/.cargo/registry/.../base32-0.5.1/src/lib.rs`), which accepts
//  UPPERCASE ONLY (no lowercase tolerance) for that alphabet variant. A
//  character outside that set is a decode failure, exactly as it is on the
//  Rust side.
//

import Foundation

enum TotpValidationError: Error, CustomStringConvertible, Equatable {
    case invalidDigits(Int)
    case invalidBase32
    case secretTooShort(decodedBytes: Int)

    var description: String {
        switch self {
        case let .invalidDigits(digits):
            return "TOTP codes must be 6, 7 or 8 digits (got \(digits))"
        case .invalidBase32:
            return "This does not look like a valid base32 secret"
        case let .secretTooShort(decodedBytes):
            return "This secret is too short (\(decodedBytes) bytes decoded; the minimum is 16)"
        }
    }
}

enum TotpValidation {

    /// RFC 6238 / `totp-rs`'s own `assert_digits` range.
    static let validDigitsRange: ClosedRange<Int> = 6...8

    /// 128 bits, `totp-rs`'s own `assert_secret_length` floor.
    static let minSecretBytes = 16

    static func isValidDigits(_ digits: Int) -> Bool {
        validDigitsRange.contains(digits)
    }

    static func isValidSecretByteCount(_ count: Int) -> Bool {
        count >= minSecretBytes
    }

    /// Mirrors `generate_code`'s own preprocessing exactly: strip whitespace
    /// and `=` before decoding. Applying this tolerance is what lets a
    /// secret written with padding or stray spaces be ACCEPTED -- removing
    /// this function would make the phone reject secrets the other clients
    /// accept.
    static func cleanedSecret(_ raw: String) -> String {
        raw.filter { !$0.isWhitespace && $0 != "=" }
    }

    /// RFC 4648 base32 decode, UPPERCASE `A-Z2-7` only, no padding.
    /// `nil` on any out-of-alphabet character (including lowercase --
    /// `Alphabet::Rfc4648 { padding: false }` has no lowercase tolerance).
    static func decodeBase32(_ s: String) -> [UInt8]? {
        guard s.isEmpty == false else { return [] }
        guard s.allSatisfy(\.isASCII) else { return nil }

        var bitBuffer: UInt64 = 0
        var bitCount = 0
        var output: [UInt8] = []
        output.reserveCapacity((s.count * 5) / 8)

        for ch in s {
            guard let value = Self.alphabetIndex[ch] else { return nil }
            bitBuffer = (bitBuffer << 5) | UInt64(value)
            bitCount += 5
            if bitCount >= 8 {
                bitCount -= 8
                output.append(UInt8((bitBuffer >> UInt64(bitCount)) & 0xFF))
            }
        }
        return output
    }

    private static let alphabetIndex: [Character: UInt8] = {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var map: [Character: UInt8] = [:]
        for (index, character) in alphabet.enumerated() {
            map[character] = UInt8(index)
        }
        return map
    }()

    /// The form-level combined check. `nil` means valid. Checked in the
    /// order the underlying implementation would hit them first
    /// (`TOTP::new`'s own digit check runs before the secret is even
    /// consulted for its arithmetic), so the FIRST violated rule is the one
    /// surfaced.
    static func validate(secretB32: String, digits: Int) -> TotpValidationError? {
        if !isValidDigits(digits) {
            return .invalidDigits(digits)
        }
        guard let decoded = decodeBase32(cleanedSecret(secretB32)) else {
            return .invalidBase32
        }
        if !isValidSecretByteCount(decoded.count) {
            return .secretTooShort(decodedBytes: decoded.count)
        }
        return nil
    }
}
