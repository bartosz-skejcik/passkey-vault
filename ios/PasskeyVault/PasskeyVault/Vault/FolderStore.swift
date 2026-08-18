//
//  FolderStore.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 3. Create/delete for
//  folders -- create, delete, assign-item-to-folder ONLY.
//
//  L-18 (`ios/IOS-SPIKE-LOG.md`): `pv-server` exposes GET/POST on
//  `/api/vault/folders` and DELETE on `/api/vault/folders/{id}`. There is NO
//  PUT, no PATCH, no rename verb, and this milestone's own premise is that
//  the server does not change for iOS. Folder RENAMING is therefore not
//  offered anywhere in this file or in `FolderPicker.swift` -- it is
//  delete-and-recreate on every client today, not an iOS limitation this
//  plan introduces.
//
//  The folder column is a DIFFERENT shape from the item columns (DR-38-C):
//  ONE combined JSON string (`encrypt_item_combined_json` /
//  `decrypt_item_combined_json`), at a FIXED revision -- folders have no
//  per-row revision column server-side (`folders.rs`'s own doc comment), so
//  every client (including `web/src/lib/vault/store.ts`'s
//  `createVaultFolder`/`decryptFolderRow`) encrypts and decrypts at the
//  literal constant `1`, never the item-style "current revision + 1".
//
//  The folder identifier is minted HERE, on the phone, BEFORE encryption --
//  the associated data binds the name's ciphertext to this exact id
//  (`build_item_aad`, `crates/pv-core/src/items.rs`), and a server-minted
//  identifier once made every folder name silently fail to decrypt on the
//  next full refresh (the exact defect `folders.rs`'s own `CreateFolderRequest
//  .id` doc comment describes, in a client that had never even read the
//  creation response).
//
//  Tags exist ONLY as `VaultStore.allTags`'s recomputed union -- nothing in
//  this file, or anywhere else on iOS, persists a tag entity.
//

import Foundation
import Observation
import os

struct FolderPlaintext: Codable {
    let name: String
}

struct Folder: Identifiable, Equatable, Hashable {
    let id: String
    var name: String
}

@MainActor
@Observable
final class FolderStore {
    /// The fixed revision every client encrypts/decrypts a folder's
    /// `enc_name` at -- folders carry no per-row revision column
    /// server-side.
    static let folderRevision: UInt32 = 1

    private(set) var folders: [Folder] = []
    private(set) var lastError: String?

    /// Plan 38-11: `var`, not `let` -- `lock()` releases it, mirroring
    /// `VaultStore.userKey`'s own note.
    @ObservationIgnored private var userKey: FfiUserKey?
    @ObservationIgnored private let api: VaultAPI
    @ObservationIgnored private static let log = Logger(
        subsystem: "cloud.blonie.PasskeyVault", category: "folders"
    )

    init(userKey: FfiUserKey, api: VaultAPI) {
        self.userKey = userKey
        self.api = api
    }

    // MARK: - Lock

    /// The folder half of `VaultRootController.lockTeardown()` -- empties
    /// `folders` and releases the key handle, same discipline as
    /// `VaultStore.lock()`.
    func lock() {
        folders = []
        lastError = nil
        userKey = nil
    }

    /// A lowercase UUID string -- matching `VaultStore.mintItemId`'s own
    /// discipline (case-sensitivity is load-bearing here too: the id is a
    /// URL path component AND part of the AEAD associated data).
    nonisolated static func mintFolderId() -> String {
        UUID().uuidString.lowercased()
    }

    // MARK: - Create

    /// Mint id -> encrypt `{"name": name}` into the COMBINED shape at the
    /// fixed revision -> `POST /api/vault/folders` with that same id.
    @discardableResult
    func create(name: String) async throws -> Folder {
        guard let userKey else { throw VaultStoreError.locked }
        let id = Self.mintFolderId()
        let plaintext = try Self.plaintextJSON(name: name)
        let combined = try encryptItemCombinedJson(
            userKey: userKey, plaintext: plaintext, itemId: id, revision: Self.folderRevision
        )
        _ = try await api.createFolder(id: id, encNameJson: combined)

        let folder = Folder(id: id, name: name)
        // Post-commit bookkeeping only after the server has already
        // accepted the write -- same discipline as VaultStore.create.
        folders.append(folder)
        return folder
    }

    // MARK: - Delete

    /// No rename/update path exists (see this file's header) -- delete is
    /// the only mutation besides create.
    func delete(_ folder: Folder) async throws {
        try await api.deleteFolder(id: folder.id)
        folders.removeAll { $0.id == folder.id }
    }

    // MARK: - Refresh

    /// A full pull, independent of `VaultStore`'s own watermark -- Phase 39
    /// owns a shared incremental sync engine; until then each store manages
    /// its own `since=0` pull. Small dataset (folders, not items), so the
    /// duplication is a deliberate, bounded simplification, not an oversight.
    func refresh() async throws {
        guard userKey != nil else { throw VaultStoreError.locked }
        let response = try await api.sync(since: 0)
        guard case let .snapshot(_, _, rows) = response else {
            return
        }
        folders = rows.compactMap(decrypt(row:))
        lastError = nil
    }

    /// Decrypts one folder row, or drops it (logged) -- never aborts the
    /// loop over the rest. A folder-name decrypt failure is rarer and less
    /// urgent than an item's (no secret lives here), so unlike
    /// `VaultStore.decrypt(row:)` this does not retain an `undecryptable`
    /// placeholder entity; dropping keeps `FolderPicker`'s list honest
    /// (never a folder rendered as "Unreadable" that the user then tries to
    /// assign items into).
    private func decrypt(row: FolderRow) -> Folder? {
        // `refresh()` already guards `userKey != nil` -- this is
        // defense-in-depth, matching `VaultStore.decrypt(row:)`'s own note.
        guard let userKey else { return nil }
        do {
            let plaintext = try decryptItemCombinedJson(
                userKey: userKey, combinedJson: row.enc_name, itemId: row.id, revision: Self.folderRevision
            )
            let data = Data(plaintext.utf8)
            let decoded = try JSONDecoder().decode(FolderPlaintext.self, from: data)
            return Folder(id: row.id, name: decoded.name)
        } catch {
            Self.log.error(
                "folder \(row.id, privacy: .public) failed to decrypt: \(String(describing: error), privacy: .public)"
            )
            lastError = "a folder could not be decrypted"
            return nil
        }
    }

    /// Plaintext JSON is built in Swift (never the WIRE/ciphertext JSON --
    /// DR-38-C forbids that) via `JSONEncoder`, sorted keys for a stable,
    /// comparable byte shape, matching `ItemNormalize.plaintextJSON`'s own
    /// discipline for items.
    private static func plaintextJSON(name: String) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(FolderPlaintext(name: name))
        guard let json = String(data: data, encoding: .utf8) else {
            throw ItemNormalizeError.notAnObject
        }
        return json
    }
}
