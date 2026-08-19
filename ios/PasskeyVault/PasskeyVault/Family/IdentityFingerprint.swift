//
//  IdentityFingerprint.swift
//  PasskeyVault
//
//  Phase 40 REVIEW-FIX (CR-01): port of packages/pv-ui/identity/
//  fingerprint.ts's `fingerprintToWords`/`formatFingerprintWords`, byte-for-
//  byte -- same bit-slicing scheme, same wordlist, same separator -- so an
//  iOS user and a web user comparing the SAME identity key see the SAME six
//  words. `MemberListView.shortFingerprint`'s 8-hex-char (32-bit) truncated
//  form is brute-forceable in minutes and is removed; this is the ONLY
//  fingerprint-display path left in the app (`MemberListView`,
//  `InviteRedeemView`).
//
//  Bit-slicing scheme (A-9, ported verbatim from fingerprint.ts): parse the
//  64-character hex string big-endian into 32 bytes, then slice the
//  leading 66 bits (6 words x 11 bits/word, since 2048 = 2^11) into six
//  11-bit unsigned integers, most-significant bit first, each indexing
//  `FingerprintWordlist.words`.
//
//  FAILS CLOSED: a malformed or wrong-length hex string throws rather than
//  silently truncating, padding, or producing a plausible-looking-but-wrong
//  six-word output -- a fingerprint that "looks right" but isn't derived
//  from the real input is worse than an obvious error (it would pass a
//  careless out-of-band voice check). This mirrors fingerprint.ts's own
//  documented rationale.
//

import Foundation

enum IdentityFingerprintError: Error, Equatable {
    case malformed(String)
}

enum IdentityFingerprint {
    private static let wordCount = 6
    private static let bitsPerWord = 11
    private static let hexLength = 64 // SHA-256 = 32 bytes = 64 hex characters

    /// D-4's exact literal example format: six words separated by " · "
    /// (middot with a space on either side) -- identical to
    /// `fingerprint.ts`'s `WORD_SEPARATOR`.
    static let wordSeparator = " · "

    /// Convert a server-supplied SHA-256 hex fingerprint into six words
    /// drawn from `FingerprintWordlist.words`, in order. Throws on any
    /// input that is not exactly 64 lowercase-or-uppercase hex characters --
    /// never truncates, pads, or wraps.
    static func words(_ hex: String) throws -> [String] {
        guard !hex.isEmpty else {
            throw IdentityFingerprintError.malformed(hex)
        }
        guard hex.count == hexLength, hex.allSatisfy(\.isHexDigit) else {
            throw IdentityFingerprintError.malformed(hex)
        }

        let bytes = try hexToBytes(hex)
        var result: [String] = []
        result.reserveCapacity(wordCount)
        for i in 0..<wordCount {
            let index = readBits(bytes, bitOffset: i * bitsPerWord, bitCount: bitsPerWord)
            guard index < FingerprintWordlist.words.count else {
                // Unreachable given 11 bits (< 2048) and a 2048-entry list,
                // but fail closed rather than crash if that invariant ever
                // breaks.
                throw IdentityFingerprintError.malformed(hex)
            }
            result.append(FingerprintWordlist.words[index])
        }
        return result
    }

    /// `words(hex)` joined with the " · " separator -- the single string
    /// form rendered beside the verify action.
    static func format(_ hex: String) throws -> String {
        try words(hex).joined(separator: wordSeparator)
    }

    // MARK: - Bit slicing

    private static func hexToBytes(_ hex: String) throws -> [UInt8] {
        var bytes: [UInt8] = []
        bytes.reserveCapacity(hex.count / 2)
        var iterator = hex.makeIterator()
        while let high = iterator.next() {
            guard let low = iterator.next(),
                  let byte = UInt8(String([high, low]), radix: 16) else {
                throw IdentityFingerprintError.malformed(hex)
            }
            bytes.append(byte)
        }
        return bytes
    }

    /// Read an 11-bit big-endian unsigned integer starting at `bitOffset`
    /// out of `bytes` (MSB of byte 0 is bit 0) -- identical semantics to
    /// `fingerprint.ts`'s `readBits`.
    private static func readBits(_ bytes: [UInt8], bitOffset: Int, bitCount: Int) -> Int {
        var value = 0
        for i in 0..<bitCount {
            let bitPos = bitOffset + i
            let byteIndex = bitPos / 8
            let bitInByte = 7 - (bitPos % 8)
            let bit = (Int(bytes[byteIndex]) >> bitInByte) & 1
            value = (value << 1) | bit
        }
        return value
    }
}
