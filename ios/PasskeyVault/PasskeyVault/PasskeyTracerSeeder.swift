//
//  PasskeyTracerSeeder.swift
//  PasskeyVault
//
//  Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), plan 43-03. Host-side seed for the passkey
//  assertion tracer: writes Secret C (`SessionKeyStore`) + a real host-app unlock marker
//  (`SessionLifecycle.recordHostUnlock()`) -- the SAME real writers `TracerFillSeeder.seed()`
//  (Plan 41-03) already established -- plus ONE real, GENUINELY REGISTERED passkey item into the
//  Phase-39 cache (`AppGroupCiphertextCacheStore`).
//
//  Unlike `TracerFillSeeder`, the PASSKEY PLAINTEXT itself is NOT synthesized here: it is read
//  from a file `scripts/ios-autofill-e43.sh tracer` stages into the App Group container BEFORE
//  this app launches -- the real `pv_provider::create_provider_credential` output
//  (`crates/pv-provider/examples/ios_seed_passkey.rs`), a genuine passkey already registered with
//  `crates/rp-fixture`'s own independent `webauthn-rs` verifier. This seeder's job is ONLY to get
//  that already-real credential onto the simulator through the SAME real writers the production
//  sync path uses (`encryptItemWire`, `AppGroupCiphertextCacheStore().write`) -- it invents no
//  cryptographic material of its own.
//
//  DEVIATION (Rule 2, GSD executor rules): 43-03-PLAN.md's own `files_modified` list does not name
//  this file (or its `PasskeyVaultApp.swift` call site). Without a host-side seeder, the plan's
//  own `<precondition>` ("An account with at least one real, browser-extension-created passkey
//  exists ... reachable via sync on the target simulator's PasskeyVault account") cannot be
//  satisfied from a bare simulator -- the SAME class of gap `TracerFillSeeder.swift`'s own header
//  documents for Plan 41-03, resolved the SAME way (a real-writer, `PV_PROBE_*`-gated seeder,
//  documented here rather than silently introduced).
//
//  Compiled in only under `PV_PROBE_E43_TRACER` -- inert for every other build, matching
//  `TracerFillSeeder`'s own gate convention. NEVER logs the passkey's own private key bytes
//  (T-14-02's inherited discipline) -- only a SHA-256 digest of the exported session bytes,
//  mirroring `TracerFillSeeder.seed()`'s own precedent; the passkey plaintext staging file is
//  deleted immediately after being consumed and re-encrypted.
//

import CryptoKit
import Foundation
import os

#if DEBUG || PV_PROBE_E43_TRACER
enum PasskeyTracerSeeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    /// Written by `scripts/ios-autofill-e43.sh tracer` directly onto the App Group container's
    /// host-filesystem path (`xcrun simctl get_app_container ... groups`) BEFORE this app
    /// launches -- `ios_seed_passkey`'s own stdout (`new_passkey_json`), the real
    /// `SerializablePasskey` wire JSON, private key included.
    private static let seedInputFileName = "pv-43-seed-passkey.json"
    private static let statusFileName = "e43-tracer-seed-status.json"

    static let itemId = "e43-tracer-passkey-item"
    static let accountId = "e43-tracer-account"
    static let serverBaseURL = "https://e43-tracer.invalid"

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func writeStatusMarker(status: String, step: String) {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else { return }
        let payload = "{\"status\":\"\(status)\",\"step\":\"\(step)\"}"
        try? payload.write(
            to: containerURL.appendingPathComponent(statusFileName), atomically: true, encoding: .utf8
        )
    }

    /// Runs the whole seed sequence: read the harness-supplied real passkey plaintext; generate a
    /// throwaway `FfiUserKey` and write Secret C/the unlock marker (the SAME real writers
    /// `TracerFillSeeder.seed()` uses); encrypt the REAL passkey plaintext (never synthesized
    /// here) and write it into the Phase-39 cache. No identity-store registration -- this plan's
    /// own `fillPasskeyOrCancel` scans every cached row rather than looking up by
    /// `recordIdentifier` (identity-store registration for passkeys is 43-05's job, this plan's
    /// own `<success_criteria>`).
    static func seed() async {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else {
            logger.error("PVFILL|E43|stage=seed status=fail step=no-container")
            writeStatusMarker(status: "fail", step: "no-container")
            return
        }
        let seedInputURL = containerURL.appendingPathComponent(seedInputFileName)
        guard let plaintext = try? String(contentsOf: seedInputURL, encoding: .utf8), !plaintext.isEmpty else {
            logger.error("PVFILL|E43|stage=seed status=fail step=no-seed-input")
            writeStatusMarker(status: "fail", step: "no-seed-input")
            return
        }

        guard let userKey = try? FfiUserKey.generate() else {
            logger.error("PVFILL|E43|stage=seed status=fail step=generate")
            writeStatusMarker(status: "fail", step: "generate")
            return
        }

        // Same real writer `TracerFillSeeder.seed()` (Plan 41-03) uses to simulate a real host-app
        // unlock having just happened.
        SessionLifecycle.recordHostUnlock()
        logger.log("PVFILL|E43|stage=seed status=ok step=lockmarker")

        do {
            var sessionBytes = exportUserKeyForSession(userKey: userKey)
            defer { sessionBytes.resetBytes(in: 0..<sessionBytes.count) }
            let digest = sha256Hex(sessionBytes)
            try SessionKeyStore.store(sessionBytes)
            logger.log("PVFILL|E43|stage=seed status=ok step=sessionkey digest=\(digest, privacy: .public)")
        } catch {
            logger.error("PVFILL|E43|stage=seed status=fail step=sessionkey error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sessionkey")
            return
        }

        let wire: FfiEncryptedItemWire
        do {
            wire = try encryptItemWire(userKey: userKey, plaintext: plaintext, itemId: itemId, revision: 1)
        } catch {
            logger.error("PVFILL|E43|stage=seed status=fail step=encrypt error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "encrypt")
            return
        }

        let item = CachedSnapshot.Item(
            id: itemId,
            encKey: wire.encKeyJson,
            encData: wire.encDataJson,
            revision: 1,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            lastUsedAt: nil,
            isShared: false,
            collectionId: nil,
            lastEditorEmail: nil
        )
        let snapshot = CachedSnapshot(
            revision: 1,
            Int64(Date().timeIntervalSince1970 * 1000),
            accountId: accountId,
            serverBaseURL: serverBaseURL,
            items: [item],
            folders: []
        )

        do {
            try AppGroupCiphertextCacheStore().write(snapshot)
            logger.log("PVFILL|E43|stage=seed status=ok step=cache itemId=\(itemId, privacy: .public)")
            writeStatusMarker(status: "ok", step: "complete")
        } catch {
            logger.error("PVFILL|E43|stage=seed status=fail step=cache error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "cache")
            return
        }

        // Hygiene: the plaintext staging file carried private key material -- remove it now that
        // it has been consumed and re-encrypted under the REAL wire encoder. Best-effort; this is
        // dev/test tooling, not a production data path.
        try? FileManager.default.removeItem(at: seedInputURL)
    }
}
#endif
