//
//  CipherCacheReader.swift
//  PasskeyVaultAutoFill
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03. Reads ONE item's
//  ciphertext out of the Phase-39 cache (`vault-cache-v1.json`, App Group container) by
//  `recordIdentifier`, decoding its `encKey`/`encData` wire-JSON strings into `FfiWrappedKey`
//  WITHOUT ever routing them through `Data`'s default `JSONDecoder` behaviour (base64) -- DR-38-C
//  (`crates/pv-ffi/src/wire.rs`): the cache carries `serde_json`'s number-array shape
//  (`{"nonce":[...],"ciphertext":[...]}`), and only a `[UInt8]`-typed intermediate decodes that
//  shape byte-for-byte. This file is Phase 41's own proof of the F5 hazard's fourth boundary
//  (`41-RESEARCH.md` §F5): host writes the cache, extension reads it, byte-compare.
//
//  Happy path: `AppGroupCiphertextCacheStore.readCurrentSnapshot(accountId:serverBaseURL:)` --
//  the SAME production accessor `CredentialProviderViewController.renderFreshnessSurface()`
//  already uses -- which enforces Phase 39's own D-19 (account scoping) / WR-07 (schema version) /
//  WR-09 (server scoping) rejections. `CachedSnapshot.Item.id`/`.revision` are non-optional Swift
//  members already, so a record that decodes through THAT strict, whole-blob `Codable` path by
//  construction carries both AAD inputs.
//
//  Fallback path (`lookupRaw`): if the strict whole-snapshot decode fails for ANY reason (a
//  genuinely malformed cache, one record missing `itemId`/`revision`, or simply no
//  current-account marker yet written), this reader independently scans the RAW JSON for the
//  target record so a MISSING `itemId`/`revision` on THAT SPECIFIC record is reported BY NAME --
//  never folded into an undifferentiated "cache unavailable" (T-41-11's decoder-rejection
//  requirement: "a missing AAD input surfaces from decrypt_item as something that looks like
//  ciphertext corruption, and diagnosing that at fill time is the failure this rejection
//  prevents").
//

import CryptoKit
import Foundation
import os

enum CipherCacheReaderError: Swift.Error, CustomStringConvertible {
    case containerUnavailable
    case cacheUnavailable
    case itemNotFound(String)
    case missingItemId
    case missingRevision
    case malformedWireKey(field: String)

    var description: String {
        switch self {
        case .containerUnavailable: return "App Group container unavailable"
        case .cacheUnavailable: return "no cache snapshot on disk"
        case let .itemNotFound(id): return "no cache item for recordIdentifier \(id)"
        case .missingItemId: return "cache record missing itemId"
        case .missingRevision: return "cache record missing revision"
        case let .malformedWireKey(field): return "cache record's \(field) is not valid wire JSON"
        }
    }

    /// WR-03 (41-REVIEW.md iteration 2): a CLOSED vocabulary carrying NO user data (never a
    /// `recordIdentifier`, never a field name derived from user content) -- safe to log `.public`
    /// on the real, unconditional fill path. `.description` above remains the FULL diagnostic
    /// (embeds the raw `recordIdentifier` for `.itemNotFound`) and must only ever be logged
    /// `.private`.
    var kindToken: String {
        switch self {
        case .containerUnavailable: return "container-unavailable"
        case .cacheUnavailable: return "cache-unavailable"
        case .itemNotFound: return "not-found"
        case .missingItemId: return "missing-item-id"
        case .missingRevision: return "missing-revision"
        case .malformedWireKey: return "malformed-wire-key"
        }
    }
}

/// One cache row, resolved for the fill path: the two AAD inputs `decrypt_item`/`decryptItem`
/// binds (`itemId`/`revision`), and the two `FfiWrappedKey`-shaped ciphertext members. The
/// plaintext username the fill ultimately needs is NOT carried here -- it lives inside the
/// ENCRYPTED `encData` payload (`SYNC-03`'s own ciphertext-only invariant,
/// `CiphertextCacheStore.swift`'s header: "this store holds EXACTLY what pv-server already holds
/// ... and NOTHING ELSE"), so it is read out AFTER `decryptItem` succeeds, by
/// `CredentialProviderViewController`'s own plaintext decode -- never invented here as a
/// pre-decrypt field the real cache schema does not carry.
struct CachedItem {
    let itemId: String
    let revision: UInt32
    let encKey: FfiWrappedKey
    let encData: FfiWrappedKey
}

enum CipherCacheReader {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"
    private static let fileName = "vault-cache-v1.json"

    /// Mirrors `pv-ffi`'s `wire.rs` output shape EXACTLY (`{"nonce":[...],"ciphertext":[...]}`)
    /// -- `[UInt8]` fields, never `Data`, so `JSONDecoder`'s base64-for-`Data` default is never in
    /// the decode path at all (F5).
    private struct WireWrappedKey: Decodable {
        let nonce: [UInt8]
        let ciphertext: [UInt8]
    }

    private static func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupIdentifier)
    }

    private static func decodeWireKey(_ json: String, field: String) -> FfiWrappedKey? {
        guard let wire = try? JSONDecoder().decode(WireWrappedKey.self, from: Data(json.utf8)) else {
            logger.error("PVFILL|stage=cache-decode field=\(field, privacy: .public) status=malformed")
            return nil
        }
        return FfiWrappedKey(nonce: Data(wire.nonce), ciphertext: Data(wire.ciphertext))
    }

    /// The happy path: the SAME production, account/server/schema-scoped accessor the freshness
    /// surface already uses.
    ///
    /// CR-05 (41-REVIEW.md): the fallback to `lookupRaw` is narrowed to the case it actually
    /// documents -- "a genuinely malformed cache, one record missing itemId/revision, or simply no
    /// current-account marker yet written". Before this fix, ANY failure of the strict decode chain
    /// (including a row that decoded FINE but was scoped OUT by D-19/WR-07/WR-09's own account/
    /// schema/server rejections) fell through to `lookupRaw`, which reads the raw JSON with no
    /// scoping at all -- silently bypassing exactly the checks `readCurrentSnapshot` exists to
    /// enforce. Now: no marker, or the whole-snapshot decode itself failing, are the ONLY cases
    /// that fall through (genuinely "cannot determine provenance yet" / "cache unreadable"); a
    /// snapshot that decoded successfully but does not contain this record is reported by name
    /// (`.itemNotFound`), never silently re-read unscoped.
    static func lookup(recordIdentifier: String) -> Swift.Result<CachedItem, CipherCacheReaderError> {
        let store = AppGroupCiphertextCacheStore()
        guard let marker = store.currentAccountMarker() else {
            return lookupRaw(recordIdentifier: recordIdentifier)
        }
        guard let snapshot = store.readCurrentSnapshot(accountId: marker.accountId, serverBaseURL: marker.serverBaseURL) else {
            // CR-01 (41-REVIEW.md iteration 2): the comment this replaced asserted the fallback
            // below only ever runs on a genuine decode failure -- untrue, because
            // `readCurrentSnapshot` also returns `nil` for the three SCOPING rejections (D-19
            // account, WR-07 schema, WR-09 server). Ask `rawSnapshotIsScopedOut` cheaply and
            // refuse BY NAME on a scoping rejection -- NEVER widen a foreign-account/foreign-
            // server/unrecognized-schema blob onto the unscoped raw scan below, which applies no
            // account/server/schema check of any kind.
            if store.rawSnapshotIsScopedOut(accountId: marker.accountId, serverBaseURL: marker.serverBaseURL) {
                return .failure(.itemNotFound(recordIdentifier))
            }
            // Genuinely unreadable/undecodable (absent file, unreadable data, malformed JSON) --
            // diagnose by name via the raw scan, exactly as documented.
            return lookupRaw(recordIdentifier: recordIdentifier)
        }
        guard let row = snapshot.items.first(where: { $0.id == recordIdentifier }) else {
            // The scoped snapshot decoded fine: this row is genuinely not ours (wrong account,
            // wrong server, or simply absent) -- NEVER fall through to the unscoped raw scan here,
            // which would silently bypass D-19/WR-07/WR-09's own rejections.
            return .failure(.itemNotFound(recordIdentifier))
        }
        guard let encKey = decodeWireKey(row.encKey, field: "encKey") else {
            return .failure(.malformedWireKey(field: "encKey"))
        }
        guard let encData = decodeWireKey(row.encData, field: "encData") else {
            return .failure(.malformedWireKey(field: "encData"))
        }
        // CR-05 (41-REVIEW.md): the CHECKED conversion, matching the rebuild path
        // (`CredentialProviderViewController.runIdentityRebuildIfPending`'s own `UInt32(exactly:)`)
        // -- the trapping initializer used here before aborted the extension mid-fill on a
        // negative or out-of-range `revision` (a corrupted App-Group blob, or a server field this
        // client never range-checked).
        guard let revision32 = UInt32(exactly: row.revision) else {
            return .failure(.missingRevision)
        }
        return .success(CachedItem(
            itemId: row.id,
            revision: revision32,
            encKey: encKey,
            encData: encData
        ))
    }

    /// Independent raw-JSON scan, used ONLY when the strict whole-snapshot decode above did not
    /// produce the target record -- so a record-specific missing `itemId`/`revision` is reported
    /// by name instead of disappearing into the strict path's own `nil`.
    private static func lookupRaw(recordIdentifier: String) -> Swift.Result<CachedItem, CipherCacheReaderError> {
        guard let url = containerURL()?.appendingPathComponent(fileName) else {
            return .failure(.containerUnavailable)
        }
        guard let data = try? Data(contentsOf: url) else {
            return .failure(.cacheUnavailable)
        }
        guard let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let items = top["items"] as? [[String: Any]]
        else {
            return .failure(.cacheUnavailable)
        }
        guard let row = items.first(where: { ($0["id"] as? String) == recordIdentifier }) else {
            return .failure(.itemNotFound(recordIdentifier))
        }
        guard let itemId = row["id"] as? String, !itemId.isEmpty else {
            return .failure(.missingItemId)
        }
        guard let revisionNumber = row["revision"] as? NSNumber else {
            return .failure(.missingRevision)
        }
        // CR-05 (41-REVIEW.md): `UInt32(exactly:)`, never `UInt32(truncating:)` -- a truncated
        // revision silently produces the WRONG AAD, which `decrypt_item` then rejects as if the
        // ciphertext itself were corrupted (an unexplainable, misdiagnosed decrypt failure). A
        // revision that does not fit `UInt32` exactly is reported BY NAME instead, matching the
        // strict path's own `.missingRevision` case.
        guard let revision32 = UInt32(exactly: revisionNumber.int64Value) else {
            return .failure(.missingRevision)
        }
        guard let encKeyJson = row["encKey"] as? String,
              let encKey = decodeWireKey(encKeyJson, field: "encKey")
        else {
            return .failure(.malformedWireKey(field: "encKey"))
        }
        guard let encDataJson = row["encData"] as? String,
              let encData = decodeWireKey(encDataJson, field: "encData")
        else {
            return .failure(.malformedWireKey(field: "encData"))
        }
        return .success(CachedItem(
            itemId: itemId,
            revision: revision32,
            encKey: encKey,
            encData: encData
        ))
    }

    // MARK: - Phase 41, Plan 41-06, Task 1 -- the read-side half of the encoding proof (F5)

    /// DUPLICATED from `CacheEncodingProbe.swift` (host app target) -- see this file's own
    /// header ("separate build targets, no shared framework between them", the same discipline
    /// `SessionKeyProbe`/`SessionKeyReader` already established) and
    /// `TracerFillSeeder.tracerItemId` (host app target). Mutating any ONE of these three
    /// literals without its sibling is exactly what this task's own falsification (a deliberate
    /// mismatch) exists to catch.
    private static let tracerItemId = "tracer-item-41-03"
    private static let wrongShapeItemId = "encoding-probe-wrong-shape-41-06"
    private static let missingRevisionItemId = "encoding-probe-missing-revision-41-06"

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Entry point, dispatched from `CredentialProviderViewController
    /// .prepareInterfaceForExtensionConfiguration()` under `PV_PROBE_CACHE_ENCODING` -- the
    /// receiver side of `CacheEncodingProbe.swift`'s own write-side digests, PLUS the two
    /// negative-encoding proofs (T-41-28): a wrong-shape record rejected by name, and 41-03's
    /// own missing-`revision` rejection re-verified live now that this task hardens the read
    /// path alongside it. NEVER logs raw bytes (T-41-01) -- only digests and named error
    /// descriptions.
    static func logEncodingProofDigests() {
        switch lookup(recordIdentifier: tracerItemId) {
        case let .success(item):
            logger.log("PVFILL|E41-6|stage=read-digest field=encKey.nonce digest=\(sha256Hex(item.encKey.nonce), privacy: .public)")
            logger.log("PVFILL|E41-6|stage=read-digest field=encKey.ciphertext digest=\(sha256Hex(item.encKey.ciphertext), privacy: .public)")
            logger.log("PVFILL|E41-6|stage=read-digest field=encData.nonce digest=\(sha256Hex(item.encData.nonce), privacy: .public)")
            logger.log("PVFILL|E41-6|stage=read-digest field=encData.ciphertext digest=\(sha256Hex(item.encData.ciphertext), privacy: .public)")
            logger.log("PVFILL|E41-6|stage=read-digest field=itemId digest=\(sha256Hex(Data(item.itemId.utf8)), privacy: .public)")
            logger.log("PVFILL|E41-6|stage=read-digest field=revision digest=\(sha256Hex(Data(String(item.revision).utf8)), privacy: .public)")
        case let .failure(error):
            // WR-02 (41-REVIEW.md): `error`'s description can embed the raw `recordIdentifier`
            // (`.itemNotFound(id)`'s own case) -- `.private`, never `.public`, even in this
            // `PV_PROBE_CACHE_ENCODING`-only evidence path.
            logger.error("PVFILL|E41-6|stage=read-digest status=fail error=\(String(describing: error), privacy: .private)")
        }

        switch lookup(recordIdentifier: wrongShapeItemId) {
        case .success:
            logger.error("PVFILL|E41-6|stage=wrong-encoding-rejection status=unexpected-success")
        case let .failure(error):
            logger.log("PVFILL|E41-6|stage=wrong-encoding-rejection status=rejected error=\(String(describing: error), privacy: .public)")
        }

        switch lookup(recordIdentifier: missingRevisionItemId) {
        case .success:
            logger.error("PVFILL|E41-6|stage=missing-revision-rejection status=unexpected-success")
        case let .failure(error):
            logger.log("PVFILL|E41-6|stage=missing-revision-rejection status=rejected error=\(String(describing: error), privacy: .public)")
        }
    }
}
