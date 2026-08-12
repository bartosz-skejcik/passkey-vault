//
//  FfiRoundTripTests.swift
//  PasskeyVaultTests
//
//  Phase 35 (granica-ffi-rust-swift-i-szkielet), plan 35-03. The first real
//  Swift call into `pv-ffi` in this project's history -- until this file,
//  "the crypto core runs on iOS" meant only "it compiles for iOS"
//  (ios/IOS-SPIKE-LOG.md §5's own words), which is real and is less.
//
//  `pv_ffi.swift` (uniffi-bindgen-swift's generated output, built fresh on
//  every test run by the "Build pv-ffi XCFramework" Run Script phase) is
//  compiled into the `PasskeyVault` APP target, not this test target (37-02
//  moved module ownership there -- a hosted test bundle and the app it is
//  hosted in cannot both compile the generated bindings into their own
//  module, or `AccountService`'s `FfiUserKey`-typed return values would not
//  type-check against this file's own `FfiUserKey`). `import PasskeyVault`
//  below reaches FfiUserKey/FfiWrappingKey/etc. through the app module.
//
//  SC2 discipline (CONTEXT.md "Specific Ideas"): every expected byte value
//  below is a literal chosen IN THIS FILE, never a value produced by calling
//  the code under test (`generate()`) and comparing it back to itself -- a
//  fixture whose expected value is computed by the same code under test
//  proves nothing. Test 1's KDF params literal is independently transcribed
//  from `crates/pv-core/src/kdf.rs`'s own `test_params()` (`m_cost_kib: 8 *
//  1024, t_cost: 1, p_cost: 1`) and `crates/pv-ffi/src/lib.rs`'s
//  `cheap_kdf_params_json()` (the same three numbers) -- never computed by
//  this Swift code.
//

import Foundation
import Testing
import PasskeyVault

struct FfiRoundTripTests {

    // MARK: - Shared literal fixtures (provenance: authored in this file,
    // never produced by calling FfiUserKey.generate()/any code under test)

    /// Hard-coded literal password `Data` -- Test 1 and Test 3 both derive a
    /// wrapping key from this SAME literal, via the SAME cheap KDF params
    /// below, so Test 3 exercises a real, deterministic `FfiWrappingKey`.
    private static let literalPassword: Data = "correct horse battery staple (ffi-fixture)"
        .data(using: .utf8)!

    /// Hard-coded literal 16-byte salt -- an arbitrary, author-chosen byte
    /// pattern, not derived from any Rust call.
    private static let literalSalt: Data = Data([
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
        0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F,
    ])

    /// Cheap Argon2id params (8 MiB / t=1 / p=1) -- transcribed literally
    /// from `crates/pv-core/src/kdf.rs`'s `test_params()` /
    /// `crates/pv-ffi/src/lib.rs`'s `cheap_kdf_params_json()`. This phase
    /// never measures/exercises production KDF cost (64 MiB / t=3 / p=4,
    /// FILL-06 is Phase 36's job). Field names (`m_cost_kib`/`t_cost`/
    /// `p_cost`) match `pv_core::kdf::KdfParams`'s serde output exactly (no
    /// rename attributes on that struct).
    private static let cheapKdfParamsJson = "{\"m_cost_kib\":8192,\"t_cost\":1,\"p_cost\":1}"

    private static func makeFixtureWrappingKey() throws -> FfiWrappingKey {
        try FfiWrappingKey.fromPassword(
            password: literalPassword,
            salt: literalSalt,
            kdfParamsJson: cheapKdfParamsJson
        )
    }

    // MARK: - Test 1 (SC2): generate -> wrap -> unwrap -> decrypt, on literal bytes

    /// The full crypto round trip end to end: a hard-coded 32-byte literal
    /// User Key (NOT `FfiUserKey.generate()`'s output) is imported, wrapped
    /// under a password-derived key, unwrapped, and re-exported -- asserted
    /// byte-for-byte equal to the ORIGINAL literal, never `.count`-only,
    /// never "no error was thrown". Then a literal plaintext string is
    /// encrypted and decrypted back, asserted equal to the original literal.
    ///
    /// WR-12 (review Fazy 35): the literal-out-equals-literal-in assertion
    /// proves the round trip is LOSSLESS -- it does not prove anything was
    /// ever wrapped. A `wrapUserKey`/`unwrapUserKey` pair that returned the
    /// User Key bytes straight back as "ciphertext" would satisfy it
    /// perfectly, and that is precisely the leak shape FFI-02 exists to
    /// prevent, here observable from the Swift side. So the intermediate is
    /// now inspected as well, positively (what the wrapped blob IS), not as
    /// an absence.
    @Test func fullRoundTripOnLiteralBytes() throws {
        // Author-chosen literal: NOT `generate()`'s output.
        let originalUserKeyBytes: [UInt8] = Array(0...31)
        #expect(originalUserKeyBytes.count == 32)

        let userKey = try importUserKeyFromSession(bytes: Data(originalUserKeyBytes))
        let wrappingKey = try Self.makeFixtureWrappingKey()

        let wrapped = try wrapUserKey(wrappingKey: wrappingKey, userKey: userKey)

        // --- WR-12: the wrapped form must not be the input ---------------
        //
        // Structure first. Both lengths are literals transcribed from
        // `crates/pv-core/src/keys.rs` (`NONCE_LEN = 24`, `KEY_LEN = 32`) plus
        // XChaCha20-Poly1305's fixed 16-byte Poly1305 tag -- never computed
        // here from `wrapped` itself, which would be the same
        // compare-the-code-against-itself defect the file header rejects.
        #expect(wrapped.nonce.count == 24)
        #expect(wrapped.ciphertext.count == 48)  // 32 key bytes + 16-byte AEAD tag

        // An identity/pass-through wrap fails every one of these.
        #expect(Array(wrapped.ciphertext) != originalUserKeyBytes)
        #expect(wrapped.ciphertext.range(of: Data(originalUserKeyBytes)) == nil)
        #expect(Array(wrapped.nonce) != Array(originalUserKeyBytes.prefix(24)))

        // The nonce must be freshly random per call, not a constant and not
        // derived from the input: wrapping the SAME key under the SAME
        // wrapping key twice must produce a different nonce and therefore a
        // different ciphertext. Nonce reuse under XChaCha20-Poly1305 is
        // catastrophic, so this is load-bearing in its own right -- and a
        // deterministic or identity wrap goes red here too.
        let wrappedAgain = try wrapUserKey(wrappingKey: wrappingKey, userKey: userKey)
        #expect(wrappedAgain.nonce != wrapped.nonce)
        #expect(wrappedAgain.ciphertext != wrapped.ciphertext)

        let unwrapped = try unwrapUserKey(wrappingKey: wrappingKey, wrapped: wrapped)

        let reExported = exportUserKeyForSession(userKey: unwrapped)
        #expect(Array(reExported) == originalUserKeyBytes)

        let literalPlaintext = "{\"type\":\"note\",\"body\":\"fixture\"}"
        let item = try encryptItem(
            userKey: unwrapped,
            plaintext: literalPlaintext,
            itemId: "self-test-item",
            revision: 1
        )
        let decrypted = try decryptItem(
            userKey: unwrapped,
            item: item,
            itemId: "self-test-item",
            revision: 1
        )
        #expect(decrypted == literalPlaintext)
    }

    // MARK: - Test 2 (FFI-05): embedded 0x00 does not truncate export/import

    /// A SECOND hard-coded 32-byte literal, deliberately carrying `0x00` at
    /// index 15 (mid-buffer, not only at index 0) and `0xFF` at index 31 (the
    /// boundary offset). Import then immediately re-export; assert exact
    /// byte-for-byte equality against the same literal. A C-string-style
    /// truncation-at-`0x00` bug (the D-21 defect class, on this new FFI
    /// boundary) would silently produce a 15-byte result here instead of 32
    /// -- a positive, exact-length-and-content assertion catches it, a
    /// `.count`-only or "no throw" assertion would not.
    @Test func embeddedNulByteSurvivesExportImportRoundTrip() throws {
        let literalBytesWithEmbeddedNul: [UInt8] = [
            0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
            0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0x00, // index 15 = 0x00
            0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7,
            0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xFF, // index 31 = 0xFF
        ]
        #expect(literalBytesWithEmbeddedNul.count == 32)
        #expect(literalBytesWithEmbeddedNul[15] == 0x00)
        #expect(literalBytesWithEmbeddedNul[31] == 0xFF)

        let userKey = try importUserKeyFromSession(bytes: Data(literalBytesWithEmbeddedNul))
        let reExported = exportUserKeyForSession(userKey: userKey)

        #expect(Array(reExported) == literalBytesWithEmbeddedNul)
        #expect(reExported.count == 32)
    }

    // MARK: - Test 3 (FFI-05): embedded 0x00 in a WrappedKey nonce is not truncated

    /// A hard-coded 24-byte nonce literal carrying `0x00` at index 12
    /// (mid-buffer) and `0xFF` at index 23 (the boundary offset), fed to
    /// `unwrapUserKey` inside a forged `FfiWrappedKey` under a real,
    /// deterministic wrapping key (Test 1's cheap-params recipe). The
    /// assertion positively discriminates two distinct `FfiError` cases:
    ///   - `.Decrypt` (expected): the full, exact 24-byte nonce arrived
    ///     intact at `pv_core::keys::aead_open`, passed its length check
    ///     (`blob.nonce.len() != NONCE_LEN`), and only THEN failed real AEAD
    ///     authentication against ciphertext that was never actually sealed
    ///     under this key/nonce.
    ///   - `.InvalidInput` (regression): the nonce was rejected by the
    ///     length check BEFORE authentication was attempted -- which would
    ///     mean the boundary delivered something other than exactly 24
    ///     bytes (e.g. truncated at the embedded `0x00`, the D-21 defect
    ///     class).
    /// Only `.Decrypt` proves the boundary is byte-shape-safe; `.InvalidInput`
    /// would be exactly the silent-truncation regression FFI-05 exists to
    /// catch, and "some FfiError was thrown" alone would not distinguish
    /// the two.
    @Test func embeddedNulByteInNonceIsNotTruncated() throws {
        let nonceWithEmbeddedNul: [UInt8] = [
            0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
            0xC8, 0xC9, 0xCA, 0xCB, 0x00, 0xCD, 0xCE, 0xCF, // index 12 = 0x00
            0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xFF, // index 23 = 0xFF
        ]
        #expect(nonceWithEmbeddedNul.count == 24)
        #expect(nonceWithEmbeddedNul[12] == 0x00)
        #expect(nonceWithEmbeddedNul[23] == 0xFF)

        // Non-empty literal ciphertext -- never sealed under this key/nonce,
        // so decryption is guaranteed to fail AEAD authentication once the
        // nonce's length check passes.
        let literalCiphertext: [UInt8] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10,
        ]

        let wrappingKey = try Self.makeFixtureWrappingKey()
        let forgedWrapped = FfiWrappedKey(
            nonce: Data(nonceWithEmbeddedNul),
            ciphertext: Data(literalCiphertext)
        )

        do {
            _ = try unwrapUserKey(wrappingKey: wrappingKey, wrapped: forgedWrapped)
            Issue.record("expected unwrapUserKey to throw for a forged wrapped key, it returned a value")
        } catch let error as FfiError {
            switch error {
            case .Decrypt:
                break // expected: the full 24-byte nonce arrived intact and only failed AEAD auth
            case .InvalidInput:
                Issue.record("""
                    unwrapUserKey rejected the nonce as .InvalidInput (a length-validation failure) \
                    instead of .Decrypt (an AEAD-authentication failure) -- this means the FFI \
                    boundary did NOT deliver the full, exact 24-byte nonce intact (FFI-05/D-21 regression)
                    """)
            default:
                Issue.record("unexpected FfiError case, expected .Decrypt: \(error)")
            }
        } catch {
            Issue.record("unexpected non-FfiError error thrown: \(error)")
        }
    }
}
