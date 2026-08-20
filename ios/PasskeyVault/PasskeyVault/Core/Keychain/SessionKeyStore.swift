//
//  SessionKeyStore.swift
//  PasskeyVault
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03. Secret C
//  (DR-41-A, `ios/IOS-SPIKE-LOG.md` §1i): a SECOND, non-biometric Keychain artifact, deliberately
//  separate from `UkEnvelopeStore` (Secret A, `.biometryCurrentSet`) and `SessionTokenStore`
//  (Secret B, the bearer token) -- carrying the User Key's SESSION bytes
//  (`export_user_key_for_session`) so the AutoFill extension can read the unlocked vault key
//  WITHOUT any biometric challenge, for the bounded window ACC-06's lazy expiry (Plan 41-07)
//  governs.
//
//  DR-41-A is the single source of truth for this item's shape: `kSecClassGenericPassword`,
//  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, NO `SecAccessControl` at all (this is what
//  makes the silent read possible on a REAL device -- unlike Secret A, there is no ACL to
//  evaluate, so no LAContext/biometric prompt is ever triggered by reading this item), shared
//  access group `$(AppIdentifierPrefix)cloud.blonie.PasskeyVault` (not passed explicitly in the
//  query -- resolves to this bundle's sole declared `keychain-access-groups` entry, the SAME
//  discipline `UkEnvelopeStore`/`SessionTokenStore` already use).
//
//  DEVIATION (Rule 2, GSD executor rules): 41-03-PLAN.md's own `files_modified` list does not
//  name this file. Without a host-side writer, `SessionKeyReader`'s own precondition -- Secret C
//  exists and carries the real session bytes -- can never be satisfied, and every fill attempt
//  would observe `errSecItemNotFound`, an uninterpretable non-verdict. This mirrors exactly the
//  reasoning `SessionKeyProbeSeeder.swift`'s header already recorded for Plan 41-01's own seeder.
//  Documented as a deviation in 41-03-SUMMARY.md, not silently introduced.
//
//  PRODUCTION WIRING (calling `SessionKeyStore.store` from `BiometricUnlockService.enrol`/the
//  password-unlock path, on every successful real unlock) is OUT OF SCOPE for this tracer task.
//  This file provides the real, production-shaped store/delete surface; `TracerFillSeeder.swift`
//  calls `store(_:)` directly for the tracer's own evidence, exactly mirroring
//  `SessionKeyProbeSeeder`'s own precedent for Secret A. Wiring this into the real unlock flow is
//  left to a later plan -- recorded here so it is not mistaken for already done.
//

import Foundation
import Security

/// Owns Secret C. Every operation runs with NO `LAContext` at all -- writing never requires
/// authentication (the accessibility class alone gates read access, and there is no ACL to
/// evaluate), and `SessionKeyReader` (the extension target) is the read side, duplicated per
/// query rather than imported -- separate build targets, no shared framework
/// (`SessionKeyProbe.swift`'s own established discipline).
enum SessionKeyStore {
    static let service = "cloud.blonie.PasskeyVault.session-key"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Delete-then-add, matching `UkEnvelopeStore`/`SessionTokenStore`'s own recovery discipline:
    /// a naive `SecItemAdd` over an existing item fails with `errSecDuplicateItem`. The caller's
    /// buffer is zeroed via `resetBytes(in:)` immediately after the Keychain call returns --
    /// CP-4's caller-side mitigation (`crates/pv-ffi/src/lib.rs`'s own header): `pv-ffi` zeroizes
    /// only its OWN copy.
    static func store(_ bytes: Data) throws {
        var mutableBytes = bytes
        defer { mutableBytes.resetBytes(in: 0..<mutableBytes.count) }

        let deleteStatus = SecItemDelete(baseQuery as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw KeychainOperationError(status: deleteStatus, operation: "sessionkey.store.delete-first")
        }

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = mutableBytes
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainOperationError(status: addStatus, operation: "sessionkey.store.add")
        }
    }

    /// Idempotent. ACC-06's explicit-delete-on-expiry primitive -- Plan 41-07 wires the trigger
    /// (the lazy check observing expiry); this is the mechanism it will call.
    static func delete() {
        let status = SecItemDelete(baseQuery as CFDictionary)
        precondition(
            status == errSecSuccess || status == errSecItemNotFound,
            "SessionKeyStore.delete unexpected status \(status)"
        )
    }
}
