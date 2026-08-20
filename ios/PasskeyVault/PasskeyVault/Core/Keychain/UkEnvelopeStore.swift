//
//  UkEnvelopeStore.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. The User Key
//  envelope: a `kSecClassGenericPassword` item whose protection class and
//  `.biometryCurrentSet` constraint are supplied ONLY through
//  `SecAccessControlCreateWithFlags`, gating the real bytes
//  `export_user_key_for_session` produced -- never a flag in the UI layer.
//
//  ACC-03 (ios/IOS-SPIKE-LOG.md §1, Secret A) is the single source of truth
//  for the protection class and service string used here: the
//  passcode-set/this-device-only accessibility constant (see
//  `protectionClass` below for the exact identifier) + `[.biometryCurrentSet]`,
//  `kSecAttrService = "cloud.blonie.PasskeyVault.uk-envelope"`.
//

import Foundation
import LocalAuthentication
import os
import Security

/// Thrown when `SecAccessControlCreateWithFlags` itself fails to construct
/// the ACL (returns nil) -- distinct from any `OSStatus` from a subsequent
/// Keychain call, because no Keychain call happens at all in this case.
struct AccessControlConstructionError: Error {
    let underlying: CFError?
}

/// Owns the User Key envelope Keychain item. Every `LAContext` created here
/// is local to its function, `invalidate()`d in a `defer`, and never held as
/// a stored property -- SecItem.h's own documented reason: "If the specified
/// context has been previously authenticated, the operation will succeed
/// without asking user for authentication," which would turn the OS's gate
/// back into the process-local boolean ACC-04 forbids.
enum UkEnvelopeStore {
    static let service = "cloud.blonie.PasskeyVault.uk-envelope"

    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// ACC-03's protection class -- supplied ONLY to
    /// `SecAccessControlCreateWithFlags` below, NEVER additionally as an
    /// accessibility key in a `SecItemAdd`/`SecItemCopyMatching`
    /// dictionary. The header and third-party reports disagree about
    /// whether that combination returns `errSecParam` (-50); the rule holds
    /// either way, and 37-05's E4 settles the disagreement empirically.
    private static let protectionClass = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly

    private static func makeAccessControl() throws -> SecAccessControl {
        var error: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            protectionClass,
            [.biometryCurrentSet],
            &error
        ) else {
            throw AccessControlConstructionError(underlying: error?.takeRetainedValue())
        }
        return ac
    }

    /// Base query identifying the envelope item, shared by every operation.
    /// `kSecUseDataProtectionKeychain` is a no-op on iOS (there is only the
    /// data-protection keychain) -- included so this wrapper behaves the
    /// same if it is ever exercised on macOS.
    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// `SecItemDelete` for the same service FIRST (ignoring
    /// `errSecItemNotFound`), THEN `SecItemAdd` with the ACL attached. This
    /// ordering is load-bearing, not decorative: a naive `SecItemAdd` over
    /// an existing (possibly invalidated) item fails with
    /// `errSecDuplicateItem` (-25299) -- proven by
    /// `KeychainEnvelopeTests.storingTwiceWithoutDeleteFirstFails`.
    ///
    /// After the call returns, the CALLER's buffer is zeroed via
    /// `resetBytes(in:)` -- UniFFI cannot wipe it for us, which is the
    /// recorded CP-4 residual (`crates/pv-ffi/src/lib.rs` header).
    static func store(_ bytes: Data) throws {
        var mutableBytes = bytes
        defer { mutableBytes.resetBytes(in: 0..<mutableBytes.count) }

        let deleteQuery = baseQuery
        let deleteStatus = SecItemDelete(deleteQuery as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw KeychainOperationError(status: deleteStatus, operation: "store.delete-first")
        }

        let accessControl = try makeAccessControl()
        var addQuery = baseQuery
        addQuery[kSecValueData as String] = mutableBytes
        addQuery[kSecAttrAccessControl as String] = accessControl

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainOperationError(status: addStatus, operation: "store.add")
        }
    }

    /// A FRESH `LAContext` per call, `localizedReason` set (never the
    /// deprecated `kSecUseOperationPrompt`), `defer { ctx.invalidate() }`,
    /// passed as `kSecUseAuthenticationContext`. Runs off the main thread
    /// via `async` -- the underlying `SecItemCopyMatching` call blocks and
    /// presents UI.
    static func read(reason: String) async throws -> KeychainOutcome {
        await Task.detached(priority: .userInitiated) {
            let context = LAContext()
            context.localizedReason = reason
            defer { context.invalidate() }

            var query = baseQuery
            query[kSecReturnData as String] = true
            query[kSecUseAuthenticationContext as String] = context

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)

            if status == errSecSuccess, let data = result as? Data {
                return KeychainOutcome.ok(data)
            }
            return classify(status)
        }.value
    }

    /// The silent variant: a fresh `LAContext` with
    /// `interactionNotAllowed = true`, expecting `errSecInteractionNotAllowed`
    /// on a locked device, used to answer "is the envelope still there and
    /// valid?" without ever throwing a Face ID sheet. `-25308` here means
    /// "locked", never "key absent" -- this is the primitive ACC-06 and a
    /// cold-launched AutoFill extension (Phase 41) will need.
    static func probe() async -> KeychainOutcome {
        await Task.detached(priority: .userInitiated) {
            let context = LAContext()
            context.interactionNotAllowed = true
            defer { context.invalidate() }

            var query = baseQuery
            query[kSecReturnData as String] = true
            query[kSecUseAuthenticationContext as String] = context

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)

            if status == errSecSuccess, let data = result as? Data {
                return KeychainOutcome.ok(data)
            }
            return classify(status)
        }.value
    }

    /// Idempotent: deleting a non-existent item is not an error to the
    /// caller. (A subsequent `read` on a non-existent item classifies as
    /// `.envelopeUnusable`, never `.lockedNoUI` -- proven in
    /// `KeychainEnvelopeTests`.)
    /// WR-01 (41-REVIEW.md iteration 2): same discipline CR-03 applied to `SessionKeyStore
    /// .delete()` -- NEVER `precondition()` on an external API's status on a delete path a
    /// sign-out/lock flow can reach. Reports and continues instead of aborting the app.
    static func delete() {
        let status = SecItemDelete(baseQuery as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            assertionFailure("UkEnvelopeStore.delete unexpected status \(status)")
            logger.error("PVLOCK|stage=uk-envelope-delete status=\(status, privacy: .public) unexpected")
        } else {
            logger.log("PVLOCK|stage=uk-envelope-delete status=\(status, privacy: .public)")
        }
    }
}

/// A Keychain call returned a status this wrapper does not treat as
/// recoverable at the call site (e.g. the delete-first step of `store`
/// failing for a reason other than "already absent").
struct KeychainOperationError: Error {
    let status: OSStatus
    let operation: String
}
