//
//  SessionTokenStore.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. The session
//  token: a SECOND, deliberately weaker Keychain secret, deliberately kept
//  separate from `UkEnvelopeStore` -- NOT a parameterisation of it. The two
//  secrets have different classes, different flags, and different failure
//  semantics; collapsing them into one generic wrapper is how that
//  asymmetry gets lost in a later refactor.
//
//  Moved from `PasskeyVault/PasskeyVault/Core/Keychain/` into `Shared/` by Plan 43-06, Task 1 --
//  code-free move (this file sets no explicit `kSecAttrAccessGroup`, confirmed by this task's own
//  precondition check), reusing the SAME `keychain-access-groups` entitlement value both targets
//  already declare (Phase 36). `VaultAPI.createItem`'s new extension-process caller (Plan 43-07)
//  reads the SAME Keychain item this file already wrote for the host, never a second one
//  (DR-43-A, `ios/IOS-SPIKE-LOG.md` §1). No code below changed.
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
import os
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

    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

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
    ///
    /// WR-01 (41-REVIEW.md iteration 2): NEVER `precondition()` on an external API's status --
    /// same discipline CR-03 already applied to `SessionKeyStore.delete()`/`SessionLifecycle`'s
    /// Keychain paths. Before this fix, `precondition(status == errSecSuccess)` aborted the app
    /// (active in `-O` release builds) on `errSecDuplicateItem`/`errSecInteractionNotAllowed`
    /// right after a successful login -- the exact user-facing hazard CR-03 named, just on a
    /// sibling file CR-03's own changed-file set never reached. Reports and continues instead;
    /// `load()` returning `nil` afterward is the honest, already-handled failure mode a caller
    /// sees when this write did not land.
    static func save(_ token: String) {
        let deleteQuery = baseQuery
        SecItemDelete(deleteQuery as CFDictionary)

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = Data(token.utf8)
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            assertionFailure("SessionTokenStore.save unexpected status \(status)")
            logger.error("PVLOCK|stage=token-save status=\(status, privacy: .public) unexpected")
        } else {
            logger.log("PVLOCK|stage=token-save status=\(status, privacy: .public)")
        }
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
    ///
    /// WR-01 (41-REVIEW.md iteration 2): this is the call CR-03's own issue text named directly
    /// ("a host-app crash the moment the user taps Lock now/sign out") -- `ContentView
    /// .performSignOut()` -> `AccountService.logout()` -> here. `precondition` on an unexpected
    /// `OSStatus` is exactly the crash CR-03 removed from every other Keychain delete path; this
    /// one survived only because it lives outside phase 41's originally-changed file set.
    static func clear() {
        let status = SecItemDelete(baseQuery as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            assertionFailure("SessionTokenStore.clear unexpected status \(status)")
            logger.error("PVLOCK|stage=token-clear status=\(status, privacy: .public) unexpected")
        } else {
            logger.log("PVLOCK|stage=token-clear status=\(status, privacy: .public)")
        }
    }
}
