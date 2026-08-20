// LockE41Seeder.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-07, Tasks 2 and 3 (E41-4, E41-7).
//
// Seeds EVERYTHING E41-4/E41-7 need EXCEPT Secret C and the lock marker -- unlike
// `TracerFillSeeder.swift` (Plan 41-03), which simulates "a real unlock just happened" by
// writing those two directly, THIS seeder deliberately leaves them unwritten: Task 2/3's own
// point is to prove the REAL host-app unlock path (`LockView` -> `BiometricUnlockService
// .unlockWithBiometrics` -> `ContentView.handleUnlocked` -> `SessionLifecycle.recordHostUnlock()`
// + `SessionKeyStore.store`, all Plan 41-07's own production wiring) is what actually produces
// them -- seeding them here a second time would make that proof circular.
//
// What THIS seeder DOES write, all through REAL production call paths, exactly
// `TracerFillSeeder.swift`'s own "real writer, synthetic content" discipline:
//   * Secret A (`UkEnvelopeStore.store`, ACC-03's own `.biometryCurrentSet` envelope) -- so the
//     REAL `BiometricUnlockService.unlockWithBiometrics()` this task drives has something to
//     read. A REAL, freshly-generated `FfiUserKey`, never a fixed test vector (unlike
//     `SessionKeyProbeSeeder`'s own E41-1 probe) -- E41-4's fill must actually decrypt something.
//   * ONE real encrypted login item in the Phase-39 cache (`encryptItemWire`,
//     `AppGroupCiphertextCacheStore`), keyed to the SAME `FfiUserKey`.
//   * ONE registered identity (`IdentityStoreSync.republish`).
//
// DEVIATION (Rule 2, GSD executor rules): 41-07-PLAN.md's own `files_modified` list does not name
// this file. Without a host-side writer for Secret A + cache + identity, the "real ACC-04 unlock"
// this task's own `<precondition>` names ("a successful biometric match can be simulated") has
// nothing FOR the biometric match to unlock -- `BiometricUnlockService.unlockWithBiometrics()`
// would observe `.envelopeUnusable`/`errSecItemNotFound` every time. This mirrors exactly the
// reasoning `TracerFillSeeder.swift`'s/`SessionKeyProbeSeeder.swift`'s own headers already
// recorded for Plans 41-01/41-03's seeders. Documented as a deviation in 41-07-SUMMARY.md, not
// silently introduced.
//
// Compiled in only under `PV_PROBE_E41_LOCK` -- inert for every other build, matching this
// project's established `PV_PROBE_*` gate convention. NEVER logs the password or key bytes
// themselves (T-41-12) -- only a SHA-256 digest, mirroring `SessionKeyProbeSeeder`'s discipline.

import AuthenticationServices
import CryptoKit
import Foundation
import os

// WR-10 (41-REVIEW.md): the call site was correctly gated; this file's own BODY was not. See
// `SessionKeyProbeSeeder.swift`'s own note for the identical reasoning.
#if DEBUG || PV_PROBE_E41_LOCK
enum LockE41Seeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Distinct from `TracerFillSeeder`'s own literals (Pitfall 6, `41-RESEARCH.md`: a unique
    /// discriminator that exists nowhere else on the simulator) -- this task's own evidence must
    /// never be confused with 41-03/41-06's.
    static let username = "e41lock07@pv.test"
    static let password = "E41-Lock-07-Fill!"
    static let itemId = "e41-lock-item-41-07"
    /// Reuses the SAME local login-form server + port `TracerFillSeeder`'s own tests already
    /// drive (`scripts/ios-autofill-e41.sh`'s own `ensure_tracer_server`/`TRACER_PORT`) -- a
    /// `.domain`-typed identity for `127.0.0.1` already has a proven-reliable QuickType
    /// suggestion/tap flow (41-03/41-05's own evidence); reusing it avoids re-discovering this
    /// project's own documented Safari-timing flakiness on a SECOND host.
    static let serviceIdentifier = "127.0.0.1"
    static let accountId = "e41-lock-account-41-07"
    static let serverBaseURL = "https://e41-lock-41-07.invalid"

    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"
    static let statusFileName = "e41-lock-seed-status.json"

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func writeStatusMarker(status: String, step: String) {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else { return }
        let payload = "{\"status\":\"\(status)\",\"step\":\"\(step)\"}"
        try? payload.write(
            to: containerURL.appendingPathComponent(statusFileName),
            atomically: true,
            encoding: .utf8
        )
    }

    /// Generates a REAL `FfiUserKey`; writes Secret A through the real `UkEnvelopeStore.store`
    /// (ACC-03's own writer -- the `.biometryCurrentSet` envelope `BiometricUnlockService
    /// .unlockWithBiometrics()` reads); encrypts + caches ONE real login item under the SAME key;
    /// registers ONE identity. Deliberately never touches Secret C or the lock marker (see this
    /// file's own header).
    static func seed() async {
        guard let userKey = try? FfiUserKey.generate() else {
            logger.error("PVFILL|E41LOCK|stage=seed status=fail step=generate")
            writeStatusMarker(status: "fail", step: "generate")
            return
        }

        do {
            var sessionBytes = exportUserKeyForSession(userKey: userKey)
            defer { sessionBytes.resetBytes(in: 0..<sessionBytes.count) }
            let digest = sha256Hex(sessionBytes)
            try UkEnvelopeStore.store(sessionBytes)
            logger.log("PVFILL|E41LOCK|stage=seed status=ok step=secretA digest=\(digest, privacy: .public)")
        } catch {
            logger.error("PVFILL|E41LOCK|stage=seed status=fail step=secretA error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "secretA")
            return
        }

        let plaintext = """
        {"type":"login","name":"E41 Lock 41-07","folderId":null,"tags":[],\
        "username":"\(username)","password":"\(password)",\
        "urls":["http://\(serviceIdentifier):8765"],"notes":""}
        """

        let wire: FfiEncryptedItemWire
        do {
            wire = try encryptItemWire(userKey: userKey, plaintext: plaintext, itemId: itemId, revision: 1)
        } catch {
            logger.error("PVFILL|E41LOCK|stage=seed status=fail step=encrypt error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "encrypt")
            return
        }

        let item = CachedSnapshot.Item(
            id: itemId, encKey: wire.encKeyJson, encData: wire.encDataJson, revision: 1,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            lastUsedAt: nil, isShared: false, collectionId: nil, lastEditorEmail: nil
        )
        let snapshot = CachedSnapshot(
            revision: 1, Int64(Date().timeIntervalSince1970 * 1000),
            accountId: accountId, serverBaseURL: serverBaseURL, items: [item], folders: []
        )

        do {
            try AppGroupCiphertextCacheStore().write(snapshot)
            logger.log("PVFILL|E41LOCK|stage=seed status=ok step=cache itemId=\(itemId, privacy: .public)")
        } catch {
            logger.error("PVFILL|E41LOCK|stage=seed status=fail step=cache error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "cache")
            return
        }

        let registerResult = await IdentityStoreSync.republish(sources: [
            VaultIdentitySource(itemId: itemId, username: username, urls: ["http://\(serviceIdentifier):8765"]),
        ])
        switch registerResult {
        case .success:
            logger.log("PVFILL|E41LOCK|stage=seed status=ok step=identity")
            writeStatusMarker(status: "ok", step: "complete")
        case let .failure(error):
            logger.error("PVFILL|E41LOCK|stage=seed status=fail step=identity error=\(error.description, privacy: .public)")
            writeStatusMarker(status: "fail", step: "identity")
        }
    }
}
#endif
