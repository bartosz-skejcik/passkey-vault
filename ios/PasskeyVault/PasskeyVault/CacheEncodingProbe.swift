//
//  CacheEncodingProbe.swift
//  PasskeyVault
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-06, Task 1. The
//  HOST half of the host-writes-then-extension-reads encoding proof (F5's fourth boundary,
//  `41-RESEARCH.md` §F5): logs the SHA-256 digest of every field the host app actually wrote for
//  ONE known cache item -- the nonce and ciphertext of BOTH the key record and the data record,
//  plus `itemId` and `revision` -- so `scripts/ios-autofill-e41.sh e41-6-encoding` can compare
//  them, receiver-side, against `CipherCacheReader.logEncodingProofDigests()`'s own read-side
//  digests (extension target). Digests, never bytes (T-41-01).
//
//  Reads back `TracerFillSeeder.tracerItemId`'s own row through the SAME production accessor
//  `CipherCacheReader`'s happy path uses (`AppGroupCiphertextCacheStore.readCurrentSnapshot`),
//  AFTER `TracerFillSeeder.seed()` has completed (`PasskeyVaultApp.swift`'s own ordering: this
//  probe is dispatched INSIDE the same `Task` block, after the `await`, never in a separate
//  racing `Task`) -- so the digests measure exactly what Phase 39's real writer put on disk, not
//  a value this probe invented.
//
//  Also appends TWO companion rows directly into the same on-disk snapshot, via raw JSON
//  manipulation (bypassing `CachedSnapshot`'s strict `Codable` writer, which cannot represent a
//  missing `revision` key at all -- the same technique `TracerFillSeeder
//  .writeCacheWithRevisionKeyOmitted` already established, generalized here to an APPEND rather
//  than a whole-file replace, so the real tracer item survives alongside them):
//    - a WRONG-ENCODING row (`encKey`/`encData` base64-string-shaped, the "opposite" of B5's
//      resolved number-array shape) -- this task's own wrong-encoding-rejection proof.
//    - a MISSING-REVISION row (the `revision` JSON key entirely absent) -- re-verifying 41-03's
//      own rejection still fires now that this task adds a read-side digest probe alongside it
//      (this task's acceptance criteria: "The missing-`revision` rejection from 41-03 still
//      fires (re-verified here, since this task rewrites the decoder)").
//
//  DEVIATION (Rule 2, GSD executor rules): 41-06-PLAN.md's own `files_modified` list does not name
//  this file's dispatch site (`PasskeyVaultApp.swift`) or `CredentialProviderViewController.swift`
//  (the extension-side dispatch site for `CipherCacheReader.logEncodingProofDigests()`) --
//  without both, this probe can never run. Same class of deviation as
//  `SessionKeyProbeSeeder.swift`/`TracerFillSeeder.swift`/`IdentityStoreSyncProbe.swift`/
//  `MatchingProbe.swift`'s own precedent, documented in 41-06-SUMMARY.md, not silently introduced.
//
//  Compiled in only under `PV_PROBE_CACHE_ENCODING` -- inert for every other build, matching this
//  project's established `PV_PROBE_*` gate convention. Requires `PV_PROBE_FILLTRACER` to also be
//  set (the tracer item this probe reads back), same dependency `PasskeyVaultApp.swift`'s own
//  nesting already encodes.
//

import CryptoKit
import Foundation
import os

enum CacheEncodingProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Fixed, deterministic ids for the two deliberately-malformed companion rows this probe
    /// appends -- distinguishable from `TracerFillSeeder.tracerItemId` at a glance in evidence.
    static let wrongShapeItemId = "encoding-probe-wrong-shape-41-06"
    static let missingRevisionItemId = "encoding-probe-missing-revision-41-06"

    /// Mirrors `CipherCacheReader`'s own private `WireWrappedKey` shape EXACTLY (`[UInt8]`
    /// fields, never `Data`) -- duplicated here for the same "separate build targets, no shared
    /// framework" reason `SessionKeyProbe`/`SessionKeyReader` already duplicate this shape.
    private struct WireWrappedKey: Decodable {
        let nonce: [UInt8]
        let ciphertext: [UInt8]
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func decodeWireKeyBytes(_ json: String) -> (nonce: Data, ciphertext: Data)? {
        guard let wire = try? JSONDecoder().decode(WireWrappedKey.self, from: Data(json.utf8)) else {
            return nil
        }
        return (Data(wire.nonce), Data(wire.ciphertext))
    }

    /// Reads `TracerFillSeeder.tracerItemId`'s own row through the SAME production, account-
    /// scoped accessor `CipherCacheReader.lookup`'s happy path uses, and logs the six write-side
    /// digests: `encKey.nonce`, `encKey.ciphertext`, `encData.nonce`, `encData.ciphertext`,
    /// `itemId`, `revision`.
    private static func logWriteDigests() -> Bool {
        let store = AppGroupCiphertextCacheStore()
        guard
            let marker = store.currentAccountMarker(),
            let snapshot = store.readCurrentSnapshot(accountId: marker.accountId, serverBaseURL: marker.serverBaseURL),
            let row = snapshot.items.first(where: { $0.id == TracerFillSeeder.tracerItemId })
        else {
            logger.error("PVFILL|E41-6|stage=write-digest status=no-cache-row")
            return false
        }
        guard
            let keyBytes = decodeWireKeyBytes(row.encKey),
            let dataBytes = decodeWireKeyBytes(row.encData)
        else {
            logger.error("PVFILL|E41-6|stage=write-digest status=malformed")
            return false
        }
        logger.log("PVFILL|E41-6|stage=write-digest field=encKey.nonce digest=\(sha256Hex(keyBytes.nonce), privacy: .public)")
        logger.log("PVFILL|E41-6|stage=write-digest field=encKey.ciphertext digest=\(sha256Hex(keyBytes.ciphertext), privacy: .public)")
        logger.log("PVFILL|E41-6|stage=write-digest field=encData.nonce digest=\(sha256Hex(dataBytes.nonce), privacy: .public)")
        logger.log("PVFILL|E41-6|stage=write-digest field=encData.ciphertext digest=\(sha256Hex(dataBytes.ciphertext), privacy: .public)")
        logger.log("PVFILL|E41-6|stage=write-digest field=itemId digest=\(sha256Hex(Data(row.id.utf8)), privacy: .public)")
        logger.log("PVFILL|E41-6|stage=write-digest field=revision digest=\(sha256Hex(Data(String(row.revision).utf8)), privacy: .public)")
        return true
    }

    /// Appends the two deliberately-malformed companion rows directly into the on-disk snapshot,
    /// via raw JSON manipulation -- `CachedSnapshot`'s strict `Codable` writer cannot represent a
    /// row with a missing `revision` key at all (`revision: Int` is non-optional), so this
    /// bypasses it the same way `TracerFillSeeder.writeCacheWithRevisionKeyOmitted` already does,
    /// generalized to an APPEND so the real tracer item (and its digests, already logged above)
    /// survives unchanged alongside them.
    private static func appendCompanionRows() {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
            )
        else {
            logger.error("PVFILL|E41-6|stage=write-companion status=fail step=no-container")
            return
        }
        let fileURL = containerURL.appendingPathComponent(AppGroupCiphertextCacheStore.fileName)
        guard
            let data = try? Data(contentsOf: fileURL),
            var top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            var items = top["items"] as? [[String: Any]]
        else {
            logger.error("PVFILL|E41-6|stage=write-companion status=fail step=read-current")
            return
        }

        let updatedAt = ISO8601DateFormatter().string(from: Date())

        // The "opposite" of B5's resolved encoding: base64-string-shaped `nonce`/`ciphertext`
        // instead of the real number-array shape `wire.rs` produces. Content is irrelevant --
        // decode must fail on SHAPE alone, before any byte ever matters.
        let wrongShapeKey = "{\"nonce\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAA\",\"ciphertext\":\"AAAAAAAAAAAAAAAAAAAAAA==\"}"
        items.append([
            "id": wrongShapeItemId,
            "encKey": wrongShapeKey,
            "encData": wrongShapeKey,
            "revision": 1,
            "updatedAt": updatedAt,
            "lastUsedAt": NSNull(),
            "isShared": false,
            "collectionId": NSNull(),
            "lastEditorEmail": NSNull(),
        ])

        // The `revision` KEY is entirely ABSENT -- not `null`, not `0` -- exactly the malformed
        // shape `CipherCacheReader.lookupRaw`'s own `.missingRevision` case exists to name.
        // `encKey`/`encData` are validly-shaped-but-arbitrary: `lookupRaw` checks `revision`
        // BEFORE ever attempting to decode either wrapped-key field, so their content never
        // matters for this row's own outcome.
        items.append([
            "id": missingRevisionItemId,
            "encKey": wrongShapeKey,
            "encData": wrongShapeKey,
            "updatedAt": updatedAt,
            "lastUsedAt": NSNull(),
            "isShared": false,
            "collectionId": NSNull(),
            "lastEditorEmail": NSNull(),
        ])

        top["items"] = items
        guard let outData = try? JSONSerialization.data(withJSONObject: top) else {
            logger.error("PVFILL|E41-6|stage=write-companion status=fail step=serialize")
            return
        }
        do {
            try outData.write(to: fileURL, options: [.atomic])
            logger.log("PVFILL|E41-6|stage=write-companion status=ok")
        } catch {
            logger.error("PVFILL|E41-6|stage=write-companion status=fail step=write error=\(String(describing: error), privacy: .public)")
        }
    }

    /// Entry point, dispatched from `PasskeyVaultApp.swift` INSIDE the SAME `Task` block as
    /// `TracerFillSeeder.seed()`, after its `await` -- never a separately-scheduled `Task`, which
    /// would race the cache write this probe reads back.
    static func run() {
        guard logWriteDigests() else { return }
        appendCompanionRows()
    }
}
