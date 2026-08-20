//
//  SessionKeyReader.swift
//  PasskeyVaultAutoFill
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03. Promotes
//  41-01's `SessionKeyProbe` query into PRODUCTION use -- but targeting Secret C
//  (`SessionKeyStore.swift`, host app target, DR-41-A's own non-biometric session artifact),
//  NEVER Secret A. Duplicated query shape rather than imported -- separate build targets, no
//  shared framework between them (`SessionKeyProbe.swift`'s own header, same discipline).
//
//  Under DR-41-A(b) (the branch this build ships, `ios/IOS-SPIKE-LOG.md` §1i): the silent read
//  uses `LAContext.interactionNotAllowed = true`. Secret C carries NO `SecAccessControl` at all,
//  so this read never triggers a biometric prompt on any device -- the `LAContext` is supplied
//  defensively anyway, matching `SessionKeyProbe`'s own shape and Apple's own documented
//  `kSecUseAuthenticationContext` contract, so a `WhenUnlockedThisDeviceOnly`-class read against
//  a currently LOCKED device still reports a catchable status rather than presenting UI.
//
//  CP-4 (`crates/pv-ffi/src/lib.rs`'s own header): `import_user_key_from_session` zeroizes only
//  its OWN (Rust-side) copy. `importUserKey()` below wipes the Swift buffer via
//  `resetBytes(in:)` in a `defer`, guaranteeing the wipe runs on every exit path -- the SAME
//  discipline `UkEnvelopeStore.store`/`BiometricUnlockService.consumeOkBytes` already use in
//  this codebase for exactly this residual risk.
//

import Foundation
import LocalAuthentication
import Security
import os

enum SessionKeyReader {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// MUST match `SessionKeyStore.service` (host app target) EXACTLY -- a mismatch here means
    /// this reader targets a different Keychain item than the one the host app writes.
    private static let service = "cloud.blonie.PasskeyVault.session-key"

    /// The discriminated read result this task's own action names: the key bytes, or a "would
    /// have required interaction" case, or a failure carrying the raw `OSStatus`.
    enum ReadOutcome {
        case ok(Data)
        case interactionRequired
        case failure(OSStatus)
    }

    enum ImportError: Swift.Error {
        case interactionRequired
        case keychain(OSStatus)
        case importFailed(Swift.Error)
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// (1) The silent read: `LAContext.interactionNotAllowed = true`. `errSecInteractionNotAllowed`
    /// (-25308) is the expected "would have prompted" signal; `errSecSuccess` means the read
    /// completed with NO UI at all -- which, for Secret C, is the ONLY outcome on any device,
    /// because this item carries no `SecAccessControl` to evaluate.
    static func readSilently() -> ReadOutcome {
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }

        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data {
            logger.log("PVFILL|stage=sessionkey-read status=ok len=\(data.count, privacy: .public)")
            return .ok(data)
        }
        if status == errSecInteractionNotAllowed {
            logger.log("PVFILL|stage=sessionkey-read status=interaction-required")
            return .interactionRequired
        }
        logger.log("PVFILL|stage=sessionkey-read status=\(status, privacy: .public)")
        return .failure(status)
    }

    /// Reads Secret C, then hands the bytes to `importUserKeyFromSession` (`pv-ffi`), wiping the
    /// Swift buffer over its FULL range in a `defer` immediately guarding the call -- CP-4's
    /// caller-side mitigation, guaranteed to run on every exit path (success, thrown error, or
    /// early return).
    static func importUserKey() -> Swift.Result<FfiUserKey, ImportError> {
        switch readSilently() {
        case .ok(var bytes):
            defer { bytes.resetBytes(in: 0..<bytes.count) }
            do {
                let userKey = try importUserKeyFromSession(bytes: bytes)
                return .success(userKey)
            } catch {
                return .failure(.importFailed(error))
            }
        case .interactionRequired:
            return .failure(.interactionRequired)
        case let .failure(status):
            return .failure(.keychain(status))
        }
    }

    /// Phase 41, Plan 41-07, Task 1 (ACC-06's explicit delete, DR-41-A's own artifact choice).
    /// Deliberately built from `baseQuery` above -- byte-identical to `readSilently()`'s own
    /// matching attributes and to `SessionKeyStore.delete()`'s query (host target) -- see
    /// `SessionLifecycle.swift`'s own header for why this is duplicated per-target rather than
    /// shared. Idempotent: deleting an already-absent item is not an error, matching
    /// `SessionKeyStore.delete()`'s own precondition.
    static func delete() {
        let status = SecItemDelete(baseQuery as CFDictionary)
        precondition(
            status == errSecSuccess || status == errSecItemNotFound,
            "SessionKeyReader.delete unexpected status \(status)"
        )
        logger.log("PVFILL|stage=sessionkey-delete status=\(status, privacy: .public)")
    }
}
