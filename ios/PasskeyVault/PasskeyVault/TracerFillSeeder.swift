//
//  TracerFillSeeder.swift
//  PasskeyVault
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03, Task 1 (the
//  tracer). Host-side seed sequence for the end-to-end fill: writes Secret C
//  (`SessionKeyStore`), a real host-app unlock marker (`LockMarker`), ONE real encrypted login
//  item into the Phase-39 cache (`AppGroupCiphertextCacheStore`), and registers ONE identity
//  (`IdentityStoreSync`) -- everything the tracer's own precondition needs, all produced through
//  the REAL production call at each step: `encryptItemWire` (the real `pv-ffi` wire encoder, the
//  same one the real sync pipeline receives from the server), `exportUserKeyForSession` (the real
//  session-export function), `SessionKeyStore.store`/`LockMarker.write` (this task's own real
//  writers), `AppGroupCiphertextCacheStore().write` (Phase 39's real cache writer), and
//  `IdentityStoreSync.registerTracerIdentity` (this task's own real identity writer). Only the
//  DATA is synthetic (a throwaway `FfiUserKey`, a literal tracer password) -- the SAME
//  "real writer, synthetic content" discipline `SessionKeyProbeSeeder`/`ProbeSeeder` already
//  established for Phase 36/41-01's own evidence.
//
//  DEVIATION (Rule 2, GSD executor rules): 41-03-PLAN.md's own `files_modified` list does not
//  name this file. Without a host-side seeder, the tracer's own stated precondition -- "Phase
//  39's cache contains at least one real vault item written by the host app" plus a readable
//  Secret C plus a registered identity -- can never be satisfied from a bare simulator.
//  Documented as a deviation in 41-03-SUMMARY.md, not silently introduced.
//
//  Compiled in only under `PV_PROBE_FILLTRACER` -- inert for every other build, matching this
//  project's established `PV_PROBE_*`/`PV_UITEST_*` gate convention
//  (`PasskeyVaultApp.swift`'s own header). NEVER logs the password or key bytes themselves
//  (T-41-12) -- only a SHA-256 digest of the exported session bytes, for cross-checking against
//  the extension's own read, mirroring `SessionKeyProbeSeeder`'s own discipline.
//
//  A completion marker (`tracer-seed-status.json`, App Group container) is written LAST, so
//  `AutoFillFillUITests`/`scripts/ios-autofill-e41.sh tracer` can, if ever needed, distinguish
//  "seeding is still in flight" from "seeding failed silently" without racing a blind sleep --
//  though the PRIMARY proof this task's own `<verify>` relies on is the filled Safari field's
//  value, not this seeder's own marker.
//

import CryptoKit
import Foundation
import os

enum TracerFillSeeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// A username string that exists NOWHERE else on the simulator (Pitfall 6, `41-RESEARCH.md`)
    /// -- the discriminator that makes a QuickType suggestion attributable to OUR provider.
    static let tracerUsername = "tracer41-03@pv.test"
    static let tracerPassword = "Tr4c3r-Fill-41-03!"
    static let tracerItemId = "tracer-item-41-03"
    /// A bare host, `.domain`-typed (F3, `41-RESEARCH.md`: `.domain` matching is host-only,
    /// ignoring port) -- `127.0.0.1` so `AutoFillFillUITests` can serve the login form from a
    /// LOCAL static file server it starts itself, entirely offline (no real DNS/network reach
    /// needed): a `data:` URL page carries no host at all, so a `.domain` identity can never match
    /// it -- discovered empirically running this exact test live.
    static let tracerServiceIdentifier = "127.0.0.1"
    static let tracerAccountId = "tracer-account-41-03"
    static let tracerServerBaseURL = "https://tracer-41-03.invalid"

    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"
    private static let statusFileName = "tracer-seed-status.json"

    /// T-41-11's own falsification leg (this task's acceptance criteria): re-run with the cache
    /// record's `revision` altered by one and observe `decrypt_item`'s AAD binding fail closed.
    /// `scripts/ios-autofill-e41.sh tracer --assert-revision-mutation` writes this marker file
    /// directly into the App Group container from the host Mac (a real directory on disk) BEFORE
    /// driving this run -- an environment variable forwarded through
    /// `XCUIApplication.launchEnvironment` was observed live NOT to reach this process at all, so
    /// a file-based signal is the reliable channel (see `AutoFillFillUITests.swift`'s own header).
    private static let mutateRevisionMarkerFileName = "tracer-mutate-revision.marker"

    private static func shouldMutateRevision() -> Bool {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else { return false }
        return FileManager.default.fileExists(
            atPath: containerURL.appendingPathComponent(mutateRevisionMarkerFileName).path
        )
    }

    /// Second falsification leg's own marker file -- see `writeCacheWithRevisionKeyOmitted`'s
    /// header for what it triggers.
    private static let omitRevisionMarkerFileName = "tracer-omit-revision.marker"

    private static func shouldOmitRevisionKey() -> Bool {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else { return false }
        return FileManager.default.fileExists(
            atPath: containerURL.appendingPathComponent(omitRevisionMarkerFileName).path
        )
    }

    /// Writes `vault-cache-v1.json` as RAW JSON TEXT, bypassing `CachedSnapshot`'s strict
    /// `Codable` encoder entirely, with the one item row's `revision` key literally ABSENT --
    /// the exact malformed-record shape this task's own acceptance criteria names ("the cache
    /// decoder rejects a record with a missing revision"). Every OTHER field matches what the
    /// real writer would have produced, so this is a minimal, targeted omission, not a
    /// wholesale reinvention of the cache shape.
    private static func writeCacheWithRevisionKeyOmitted(encKeyJson: String, encDataJson: String) {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else {
            writeStatusMarker(status: "fail", step: "cache-omit-revision-no-container")
            return
        }
        let encKeyEscaped = encKeyJson.replacingOccurrences(of: "\"", with: "\\\"")
        let encDataEscaped = encDataJson.replacingOccurrences(of: "\"", with: "\\\"")
        let updatedAt = ISO8601DateFormatter().string(from: Date())
        let rawJSON = """
        {"schemaVersion":1,"revision":1,"syncedAtMs":\(Int64(Date().timeIntervalSince1970 * 1000)),\
        "accountId":"\(tracerAccountId)","serverBaseURL":"\(tracerServerBaseURL)","folders":[],\
        "items":[{"id":"\(tracerItemId)","encKey":"\(encKeyEscaped)","encData":"\(encDataEscaped)",\
        "updatedAt":"\(updatedAt)","lastUsedAt":null,"isShared":false,"collectionId":null,\
        "lastEditorEmail":null}]}
        """
        let fileURL = containerURL.appendingPathComponent("vault-cache-v1.json")
        do {
            try rawJSON.write(to: fileURL, atomically: true, encoding: .utf8)
            logger.log("PVFILL|stage=seed status=ok step=cache-omit-revision itemId=\(tracerItemId, privacy: .public)")
        } catch {
            logger.error("PVFILL|stage=seed status=fail step=cache-omit-revision error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "cache-omit-revision")
        }
    }

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

    /// Runs the whole seed sequence in order: generate a throwaway `FfiUserKey`; write
    /// `LockMarker` (simulating a real host-app unlock just happened); write Secret C; encrypt
    /// ONE login item and write it into the Phase-39 cache; register ONE identity.
    static func seed() async {
        guard let userKey = try? FfiUserKey.generate() else {
            logger.error("PVFILL|stage=seed status=fail step=generate")
            writeStatusMarker(status: "fail", step: "generate")
            return
        }

        let bootSessionId = LockMarker.currentBootSessionId() ?? "unknown-boot-session"
        LockMarker.write(LockMarker(
            bootSessionId: bootSessionId,
            systemUptimeAtUnlock: ProcessInfo.processInfo.systemUptime
        ))
        logger.log("PVFILL|stage=seed status=ok step=lockmarker")

        do {
            var sessionBytes = exportUserKeyForSession(userKey: userKey)
            defer { sessionBytes.resetBytes(in: 0..<sessionBytes.count) }
            let digest = sha256Hex(sessionBytes)
            try SessionKeyStore.store(sessionBytes)
            logger.log("PVFILL|stage=seed status=ok step=sessionkey digest=\(digest, privacy: .public)")
        } catch {
            logger.error("PVFILL|stage=seed status=fail step=sessionkey error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sessionkey")
            return
        }

        // The plaintext JSON matches `LoginFields`' own wire shape exactly
        // (`Vault/ItemFields.swift`) so a real decode of this exact string through
        // `ItemNormalize.normalizeItemFields(fromPlaintext:)` would succeed unchanged -- this
        // seeder does not special-case a shape the real product does not otherwise produce.
        let plaintext = """
        {"type":"login","name":"Tracer 41-03","folderId":null,"tags":[],\
        "username":"\(tracerUsername)","password":"\(tracerPassword)",\
        "urls":["http://\(tracerServiceIdentifier):8765"],"notes":""}
        """

        let wire: FfiEncryptedItemWire
        do {
            wire = try encryptItemWire(
                userKey: userKey, plaintext: plaintext, itemId: tracerItemId, revision: 1
            )
        } catch {
            logger.error("PVFILL|stage=seed status=fail step=encrypt error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "encrypt")
            return
        }

        // T-41-11's own falsification leg (this task's acceptance criteria): re-run with the
        // cache record's `revision` altered by one and observe `decrypt_item`'s AAD binding fail
        // closed, rather than filling something plausible. Introduced HERE, at seed time -- the
        // ciphertext is still encrypted under `revision: 1` (the AAD `decrypt_item` will be asked
        // to authenticate against later never changes), but the CACHE ROW's `revision` field is
        // deliberately wrong, exactly modelling the tampering scenario the acceptance criterion
        // describes. Gated behind a marker FILE checked at SEED time (never a compile-time flag)
        // so the driving script can toggle it per-run without a second build -- see
        // `shouldMutateRevision()`'s own header for why a marker file, not an env var.
        let seededRevision = shouldMutateRevision() ? 2 : 1

        if shouldOmitRevisionKey() {
            // Second falsification leg (acceptance criteria): "the cache decoder rejects a
            // record with a missing revision". `CachedSnapshot.Item.revision` is a NON-optional
            // Swift `Int` -- there is no way to construct one with the JSON key literally absent
            // through the strict `Codable` writer `AppGroupCiphertextCacheStore.write(_:)` uses.
            // This branch bypasses it and writes the raw JSON text directly, omitting the
            // `revision` key from the one item row -- the exact malformed-record shape
            // `CipherCacheReader.lookupRaw`'s own `.missingRevision` case exists to name.
            writeCacheWithRevisionKeyOmitted(encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson)
            let registerResult = await IdentityStoreSync.registerTracerIdentity(
                serviceIdentifier: tracerServiceIdentifier,
                user: tracerUsername,
                recordIdentifier: tracerItemId
            )
            switch registerResult {
            case .success:
                writeStatusMarker(status: "ok", step: "complete")
            case .failure:
                writeStatusMarker(status: "fail", step: "identity")
            }
            return
        }

        let item = CachedSnapshot.Item(
            id: tracerItemId,
            encKey: wire.encKeyJson,
            encData: wire.encDataJson,
            revision: seededRevision,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            lastUsedAt: nil,
            isShared: false,
            collectionId: nil,
            lastEditorEmail: nil
        )
        let snapshot = CachedSnapshot(
            revision: 1,
            Int64(Date().timeIntervalSince1970 * 1000),
            accountId: tracerAccountId,
            serverBaseURL: tracerServerBaseURL,
            items: [item],
            folders: []
        )

        do {
            try AppGroupCiphertextCacheStore().write(snapshot)
            logger.log("PVFILL|stage=seed status=ok step=cache itemId=\(tracerItemId, privacy: .public)")
        } catch {
            logger.error("PVFILL|stage=seed status=fail step=cache error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "cache")
            return
        }

        let registerResult = await IdentityStoreSync.registerTracerIdentity(
            serviceIdentifier: tracerServiceIdentifier,
            user: tracerUsername,
            recordIdentifier: tracerItemId
        )
        switch registerResult {
        case .success:
            logger.log("PVFILL|stage=seed status=ok step=identity")
            writeStatusMarker(status: "ok", step: "complete")
        case let .failure(error):
            logger.error("PVFILL|stage=seed status=fail step=identity error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "identity")
        }
    }
}
