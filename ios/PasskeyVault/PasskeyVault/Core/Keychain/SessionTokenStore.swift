//
//  SessionTokenStore.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. The session
//  token: a SECOND, deliberately weaker Keychain secret, deliberately kept
//  separate from `UkEnvelopeStore` -- NOT a parameterisation of it. The two
//  secrets have different classes, different flags, and different failure
//  semantics; collapsing them into one generic wrapper is how that
//  asymmetry gets lost in a later refactor.
//
//  ACC-03 (ios/IOS-SPIKE-LOG.md §1, Secret B) / DR-37-B is the single
//  source of truth: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, no
//  `SecAccessControl`, no biometric flag -- weaker ON PURPOSE. The AutoFill
//  extension (Phase 41) must reach the server on a cold launch without a
//  biometric prompt just to attach a bearer header to an HTTP request; the
//  secret that actually decrypts anything is the User Key envelope, which
//  keeps the strict class. This item's exposure is bounded by the server's
//  own TTL/revocation, not by a biometric gate that would defeat the
//  extension's own purpose.
//

import Foundation
import Security

/// Owns the session token Keychain item. Stores and returns the token as
/// the EXACT base64 string the server issued -- never round-tripped
/// through `Data(base64Encoded:)`/`.base64EncodedString()`. `session.rs`'s
/// `token_hash` is `SHA256(<the base64 string's bytes>)`, not of the
/// decoded 32 bytes; a re-encode that silently changes padding would
/// invalidate every subsequent request without ever raising a decode
/// error.
enum SessionTokenStore {
    static let service = "cloud.blonie.PasskeyVault.session-token"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Stores `token` verbatim as UTF-8 bytes. Delete-then-add, matching
    /// `UkEnvelopeStore`'s own recovery discipline, so a stale token from a
    /// prior session never collides with a fresh one.
    static func save(_ token: String) {
        let deleteQuery = baseQuery
        SecItemDelete(deleteQuery as CFDictionary)

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = Data(token.utf8)
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        precondition(status == errSecSuccess, "SessionTokenStore.save unexpected status \(status)")
    }

    /// No `LAContext`, no biometric prompt, no async hop -- this item never
    /// requires user interaction to read, by design.
    static func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /// For logout. Idempotent.
    static func clear() {
        let status = SecItemDelete(baseQuery as CFDictionary)
        precondition(
            status == errSecSuccess || status == errSecItemNotFound,
            "SessionTokenStore.clear unexpected status \(status)"
        )
    }
}
