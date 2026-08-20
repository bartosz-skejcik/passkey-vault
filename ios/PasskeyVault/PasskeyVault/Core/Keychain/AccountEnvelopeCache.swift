//
//  AccountEnvelopeCache.swift
//  PasskeyVault
//
//  Phase 42-era correction (root-caused live,
//  `.planning/debug/ios-cold-launch-blank-offline.md`; decision record in
//  `ios/IOS-SPIKE-LOG.md` §1k). Cold launch previously gated the app's
//  FIRST render on a live `GET /api/auth/me` call
//  (`AccountService.restoreSession()`, via `ContentView.reroute()`) -- a
//  blank screen while the server was reachable-but-slow, and a SIGNED-IN
//  user silently bounced to the sign-in screen the moment the network
//  failed entirely, contradicting Phase 39 (offline ciphertext cache) and
//  Phase 41 (cold offline AutoFill), both of which exist precisely so the
//  vault works without the server.
//
//  DR: caches the account's `pw_wrapped_uk` + `email` locally, in the
//  Keychain, so `ContentView` can route straight to `LockView` from local
//  state alone, and so `LockView`'s password path can unlock with zero
//  network. Rationale: this is already a password-wrapped blob whose
//  brute-force resistance is Argon2id's job -- the SAME posture Bitwarden
//  ships for its own offline vault -- and the vault ciphertext itself has
//  been on-device since Phase 39; without this cache the app is unusable
//  offline, contradicting two already-shipped phases. Residual risk, stated
//  plainly: an attacker with the unlocked device's file system gains an
//  offline brute-force target for the master password, bounded by
//  Argon2id's cost parameters (64 MiB / t=3 / p=4) -- the SAME parameters
//  that already protect `pw_wrapped_uk` in transit and at rest server-side;
//  this cache does not weaken that bound, it only relocates one already-
//  wrapped copy of the blob onto the device.
//
//  SAME accessibility class and access-group defaulting as
//  `SessionTokenStore` (this file's own sibling, ACC-03/DR-37-B's
//  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, no explicit
//  `kSecAttrAccessGroup` -- resolves to the bundle's sole
//  `keychain-access-groups` entry, shared by the host app and the AutoFill
//  extension) -- this is a companion cache to the session token, not a
//  third, differently-scoped secret class. Cleared everywhere
//  `SessionTokenStore.clear()` is: sign-out (`AccountService.logout()`) and
//  a server-address change (`ServerSettings.store(_:)`).
//

import Foundation
import os

/// The cached, offline-readable account envelope: exactly what `LockView`
/// needs to render AND to attempt a password unlock without a network call
/// -- `email` (display + `AccountService.signIn`'s own account identifier),
/// `pwWrappedUkJson` (the SAME opaque `serde_json` string `GET
/// /api/auth/me`/`POST /api/auth/login` already return, never re-encoded --
/// DR-37-A's discipline, extended to this cache), and `saltB64`/
/// `kdfParamsJson` -- WITHOUT these two, `deriveAuthMaterial(password:salt:
/// kdfParamsJson:)` cannot be run locally at all, and a password unlock
/// would still need a live `POST /api/auth/prelogin` round trip, defeating
/// the whole point of this cache. `GET /api/auth/me` never returns
/// `salt`/`kdf` (`pv-server`'s own route contract, never modified by this
/// fix) -- so these two fields are populated ONLY by `AccountService
/// .register`/`.signIn` (the two call sites that actually have them) and are
/// PRESERVED, never blanked, by `AccountService.restoreSession()`'s own
/// background-refresh write (see that function's own doc comment on the
/// merge). Empty strings mean "not yet known" (a legacy/pre-cache session
/// recovered only via the network fallback) -- `LockView` reads that as "no
/// local unlock is possible yet for this session" and falls back to the
/// pre-fix, network-based sign-in flow for that one case.
struct CachedAccountEnvelope: Codable, Equatable {
    let email: String
    let pwWrappedUkJson: String
    let saltB64: String
    let kdfParamsJson: String
}

/// Owns the account-envelope Keychain item.
enum AccountEnvelopeCache {
    static let service = "cloud.blonie.PasskeyVault.account-envelope-cache"

    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Delete-then-add, matching `SessionTokenStore.save(_:)`'s own recovery
    /// discipline -- a stale envelope from a prior account must never
    /// collide with a fresh one. Never `precondition()`s on the resulting
    /// `OSStatus` (WR-01, 41-REVIEW.md iteration 2's discipline, applied
    /// here from the start rather than discovered later as a residual): a
    /// failed write here must never crash the app over a cache that is a
    /// convenience, not the source of truth -- the caller's own real
    /// login/restore already succeeded by the time this runs.
    static func save(_ envelope: CachedAccountEnvelope) {
        guard let data = try? JSONEncoder().encode(envelope) else {
            logger.error("PVLOCK|stage=envelope-cache-save status=encode-failed")
            return
        }
        let deleteQuery = baseQuery
        SecItemDelete(deleteQuery as CFDictionary)

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status != errSecSuccess {
            logger.error("PVLOCK|stage=envelope-cache-save status=\(status, privacy: .public) unexpected")
        } else {
            logger.log("PVLOCK|stage=envelope-cache-save status=\(status, privacy: .public)")
        }
    }

    /// No `LAContext`, no biometric prompt -- same "never requires user
    /// interaction to read" discipline as `SessionTokenStore.load()`, for
    /// the same reason: this item gates nothing on its own, it only
    /// supplies what the password/biometric unlock path itself needs.
    static func load() -> CachedAccountEnvelope? {
        var query = baseQuery
        query[kSecReturnData as String] = true

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(CachedAccountEnvelope.self, from: data)
    }

    /// For sign-out and a server-address change. Idempotent.
    static func clear() {
        let status = SecItemDelete(baseQuery as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            logger.error("PVLOCK|stage=envelope-cache-clear status=\(status, privacy: .public) unexpected")
        } else {
            logger.log("PVLOCK|stage=envelope-cache-clear status=\(status, privacy: .public)")
        }
    }
}
