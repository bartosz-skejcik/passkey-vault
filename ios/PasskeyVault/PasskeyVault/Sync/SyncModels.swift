//
//  SyncModels.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03. THE single
//  decoding site for `GET /api/sync`'s two-shape response.
//
//  Moved here from Phase 38's `Vault/VaultAPI.swift`, where `SyncResponse`
//  (renamed `SyncPullResult` below) and its two row types originally lived
//  -- one definition, one decoding site, never two (this plan's own
//  prohibition: "There must NOT be a second decoding site for the sync
//  response; if Phase 38 already shipped one, it is moved or extended,
//  never duplicated"). `VaultAPI.sync(since:)` still performs the HTTP call
//  and still calls into this file's decoder; `FolderStore.refresh()` and
//  `SyncClient.pull()` (this plan's new type) both consume the SAME
//  decoded value from that one call path.
//
//  L-22 (`ios/IOS-SPIKE-LOG.md` §3): `crates/pv-server/src/routes/sync.rs`'s
//  `SyncResponse` is `#[serde(untagged)]` over TWO STRUCTURALLY DIFFERENT
//  bodies, not one struct with an optional `items` field -- the up-to-date
//  branch has NO `items`/`folders` KEY on the wire at all. A decoder that
//  models the collections as optional and defaults a missing value to `[]`
//  would silently erase a persisted cache on the server's most common
//  answer (every poll after the first one, on an unchanged vault). Decoding
//  therefore ATTEMPTS the snapshot shape first and falls back to the
//  up-to-date shape -- there is structurally no path from `.upToDate` to a
//  collection a caller could pass to a cache writer (D-12).
//

import Foundation

/// One vault item row exactly as `crates/pv-server/src/routes/vault.rs`'s
/// `VaultItem` serializes it. Field names are the server's own snake_case --
/// there are no rename attributes on either side, so `CodingKeys` would only
/// be a place for the two to drift apart.
struct VaultItemRow: Decodable {
    let id: String
    /// Opaque. See `VaultAPI.swift`'s header (DR-38-C).
    let enc_key: String
    /// Opaque. See `VaultAPI.swift`'s header (DR-38-C).
    let enc_data: String
    let revision: Int
    let updated_at: String
    let last_used_at: String?
    let is_shared: Bool
    let collection_id: String?
    let last_editor_email: String?
}

/// One folder row (`crates/pv-server/src/routes/folders.rs`'s
/// `FolderRecord`). `enc_name` carries the COMBINED JSON shape, not the
/// split pair items use -- see `pv-ffi`'s `wire.rs` header for the column
/// map.
struct FolderRow: Decodable {
    let id: String
    /// Opaque. See `VaultAPI.swift`'s header (DR-38-C).
    let enc_name: String
}

/// `GET /api/sync`'s two response shapes -- a closed, two-case result
/// (D-12, L-22). See this file's header for why a required-key decode
/// attempt, not an optional field, is what keeps the up-to-date branch from
/// ever reaching a cache writer with an empty collection.
enum SyncPullResult: Decodable {
    case upToDate(revision: Int)
    case snapshot(revision: Int, items: [VaultItemRow], folders: [FolderRow])

    private struct SnapshotBody: Decodable {
        let revision: Int
        let items: [VaultItemRow]
        let folders: [FolderRow]
    }

    private struct UpToDateBody: Decodable {
        let revision: Int
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let snapshot = try? container.decode(SnapshotBody.self) {
            self = .snapshot(
                revision: snapshot.revision,
                items: snapshot.items,
                folders: snapshot.folders
            )
            return
        }
        let upToDate = try container.decode(UpToDateBody.self)
        self = .upToDate(revision: upToDate.revision)
    }

    var revision: Int {
        switch self {
        case let .upToDate(revision): return revision
        case let .snapshot(revision, _, _): return revision
        }
    }
}

// MARK: - Wire <-> persisted-cache bridging

//  `PvShared/CachedSnapshot.swift`'s own row types (`CachedSnapshot.Item`/
//  `CachedSnapshot.Folder`) are deliberately independent of `VaultItemRow`/
//  `FolderRow` above -- `PvShared` carries no dependency on this file or on
//  anything network-shaped (its own header's "no UIKit, no shared
//  application object" discipline extends to "no wire-decode types"), so a
//  future extension-target build of `PvShared` alone never needs to compile
//  `SyncModels.swift`. These four conversions are the ONLY bridge between
//  the two shapes, and they move every ciphertext-bearing field VERBATIM
//  (D-13) -- never re-encoded, never parsed.

extension CachedSnapshot.Item {
    init(row: VaultItemRow) {
        self.init(
            id: row.id,
            encKey: row.enc_key,
            encData: row.enc_data,
            revision: row.revision,
            updatedAt: row.updated_at,
            lastUsedAt: row.last_used_at,
            isShared: row.is_shared,
            collectionId: row.collection_id,
            lastEditorEmail: row.last_editor_email
        )
    }
}

extension VaultItemRow {
    init(cached: CachedSnapshot.Item) {
        self.init(
            id: cached.id,
            enc_key: cached.encKey,
            enc_data: cached.encData,
            revision: cached.revision,
            updated_at: cached.updatedAt,
            last_used_at: cached.lastUsedAt,
            is_shared: cached.isShared,
            collection_id: cached.collectionId,
            last_editor_email: cached.lastEditorEmail
        )
    }
}

extension CachedSnapshot.Folder {
    init(row: FolderRow) {
        self.init(id: row.id, encName: row.enc_name)
    }
}

extension FolderRow {
    init(cached: CachedSnapshot.Folder) {
        self.init(id: cached.id, enc_name: cached.encName)
    }
}
