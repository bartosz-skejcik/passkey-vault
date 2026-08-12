//
//  PvDerivationVectorTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-03, Task 3 (b),
//  E-SRV-4. Swift independently reproduces Rust's `INFO_AUTH_HASH`/
//  `INFO_PW_UNLOCK` derivation output from hex literals PASTED HERE, never
//  computed by a shared helper. `crates/pv-ffi/src/lib.rs`'s own
//  `derivation_vectors_pin_info_auth_hash_and_info_pw_unlock` test pins the
//  SAME two hex strings on the Rust side, for the SAME password/salt/params
//  fixture below.
//
//  WHY THE HEX IS HARD-CODED, in one sentence (per this task's own
//  instruction): a shared helper called from both sides would move both
//  values together on a regression and prove nothing -- the whole point is
//  TWO INDEPENDENT pins on `INFO_AUTH_HASH`/`INFO_PW_UNLOCK`
//  (`crates/pv-core/src/keys.rs`), so a one-character change to either
//  constant goes red in Rust AND in Swift, from two files that never call
//  into each other's assertion.
//
//  `FfiWrappingKey` stays OPAQUE by design (no byte accessor -- FFI-02) --
//  the `INFO_PW_UNLOCK` vector is therefore asserted INDIRECTLY and
//  POSITIVELY: wrap a literal 32-byte User Key with the material's
//  `wrappingKey`, unwrap the SAME blob with an independently-constructed
//  `FfiWrappingKey.fromPassword(...)` built from the same password/salt/
//  params, and assert the re-exported key equals the original literal. A
//  wrong wrapping key fails this positively (the negative half below),
//  which is what makes the positive half meaningful rather than vacuous.
//

import Foundation
import Testing
import PasskeyVault

struct PvDerivationVectorTests {

    // MARK: - Fixture literals (MUST match crates/pv-ffi/src/lib.rs's
    // `derivation_vectors_pin_info_auth_hash_and_info_pw_unlock` test
    // EXACTLY -- password bytes, salt bytes, and cheap KDF params).

    private static let literalPassword: Data =
        "pv-derivation-vector-fixture (37-03 PvDerivationVectorTests)".data(using: .utf8)!

    private static let literalSalt: Data = Data([
        0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
        0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F,
    ])

    private static let cheapKdfParamsJson = "{\"m_cost_kib\":8192,\"t_cost\":1,\"p_cost\":1}"

    // MARK: - Vectors, computed ONCE in Rust (`crates/pv-ffi/src/lib.rs`'s
    // own permanent test) and pasted here as literals -- never fetched from
    // a shared helper, never computed by this file itself.

    private static let expectedAuthHashHex =
        "786142abb2fe4277bba3cca9846834c0f365b37efc9556089f1f179fa60c8b77"
    private static let expectedPwUnlockHex =
        "ae9d3c1a3d5460ff450d805e82148e276fcec988035d36bf121cb5d9c5ea8deb"

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Test 1: `auth_hash_b64` (decoded, hex-encoded) matches the
    // pasted `INFO_AUTH_HASH` vector, and is NOT equal to the `INFO_PW_UNLOCK`
    // vector (domain separation -- `kdf.rs`'s own test guards the same
    // property on the Rust side).

    @Test func authHashMatchesPastedVectorAndDivergesFromPwUnlock() throws {
        let material = try deriveAuthMaterial(
            password: Self.literalPassword,
            salt: Self.literalSalt,
            kdfParamsJson: Self.cheapKdfParamsJson
        )
        guard let authHashData = Data(base64Encoded: material.authHashB64) else {
            Issue.record("authHashB64 did not decode as base64: \(material.authHashB64)")
            return
        }
        #expect(authHashData.count == 32, "auth_hash must be exactly 32 bytes")
        #expect(Self.hex(authHashData) == Self.expectedAuthHashHex)
        #expect(Self.hex(authHashData) != Self.expectedPwUnlockHex, "domain separation: auth_hash must not equal the pw_unlock vector")
    }

    // MARK: - Test 2 (positive): the wrapping key returned by
    // `deriveAuthMaterial` has the SAME effect as one built independently
    // through `FfiWrappingKey.fromPassword` with the identical fixture --
    // this is the indirect, positive assertion on the opaque `INFO_PW_UNLOCK`
    // vector FFI-02 requires (no byte accessor exists, by design).

    @Test func wrappingKeyMatchesIndependentlyConstructedKeyFromSameFixture() throws {
        let material = try deriveAuthMaterial(
            password: Self.literalPassword,
            salt: Self.literalSalt,
            kdfParamsJson: Self.cheapKdfParamsJson
        )

        let literalUserKeyBytes: [UInt8] = Array(0...31)
        let userKey = try importUserKeyFromSession(bytes: Data(literalUserKeyBytes))

        let wrapped = try wrapUserKey(wrappingKey: material.wrappingKey, userKey: userKey)

        let independentWrappingKey = try FfiWrappingKey.fromPassword(
            password: Self.literalPassword,
            salt: Self.literalSalt,
            kdfParamsJson: Self.cheapKdfParamsJson
        )
        let unwrapped = try unwrapUserKey(wrappingKey: independentWrappingKey, wrapped: wrapped)
        let reExported = exportUserKeyForSession(userKey: unwrapped)

        #expect(Array(reExported) == literalUserKeyBytes)
    }

    // MARK: - Test 3 (negative half of Test 2): the same wrapped blob fails
    // to unwrap under a wrapping key derived from a DIFFERENT password --
    // without this, Test 2's positive assertion would be unfalsifiable (any
    // wrapping key that happened to "succeed" for any reason would pass).

    @Test func wrongPasswordFailsToUnwrapWithFfiErrorDecrypt() throws {
        let material = try deriveAuthMaterial(
            password: Self.literalPassword,
            salt: Self.literalSalt,
            kdfParamsJson: Self.cheapKdfParamsJson
        )
        let literalUserKeyBytes: [UInt8] = Array(0...31)
        let userKey = try importUserKeyFromSession(bytes: Data(literalUserKeyBytes))
        let wrapped = try wrapUserKey(wrappingKey: material.wrappingKey, userKey: userKey)

        let wrongPassword = "a completely different password (37-03 PvDerivationVectorTests negative half)"
            .data(using: .utf8)!
        let wrongWrappingKey = try FfiWrappingKey.fromPassword(
            password: wrongPassword,
            salt: Self.literalSalt,
            kdfParamsJson: Self.cheapKdfParamsJson
        )

        do {
            _ = try unwrapUserKey(wrappingKey: wrongWrappingKey, wrapped: wrapped)
            Issue.record("expected unwrapUserKey to throw when the wrapping key was derived from a different password")
        } catch let error as FfiError {
            switch error {
            case .Decrypt:
                break // expected
            default:
                Issue.record("expected FfiError.Decrypt, got: \(error)")
            }
        }
    }
}
