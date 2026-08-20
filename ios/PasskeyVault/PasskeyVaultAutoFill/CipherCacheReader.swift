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
    static func lookup(recordIdentifier: String) -> Swift.Result<CachedItem, CipherCacheReaderError> {
        let store = AppGroupCiphertextCacheStore()
        if let marker = store.currentAccountMarker(),
           let snapshot = store.readCurrentSnapshot(accountId: marker.accountId, serverBaseURL: marker.serverBaseURL),
           let row = snapshot.items.first(where: { $0.id == recordIdentifier })
        {
            guard let encKey = decodeWireKey(row.encKey, field: "encKey") else {
                return .failure(.malformedWireKey(field: "encKey"))
            }
            guard let encData = decodeWireKey(row.encData, field: "encData") else {
                return .failure(.malformedWireKey(field: "encData"))
            }
            return .success(CachedItem(
                itemId: row.id,
                revision: UInt32(row.revision),
                encKey: encKey,
                encData: encData
            ))
        }
        return lookupRaw(recordIdentifier: recordIdentifier)
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
            revision: UInt32(truncating: revisionNumber),
            encKey: encKey,
            encData: encData
        ))
    }
}
