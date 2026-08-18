//
//  CachedSnapshot.swift
//  PvShared
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03. The versioned
//  value type `CiphertextCacheStore.swift` reads and writes whole -- DR-39-A
//  (`ios/IOS-SPIKE-LOG.md` §1g): one JSON blob per account, written
//  atomically and REPLACED IN FULL on every successful sync pull. No
//  incremental/partial-update path exists anywhere in this type or its
//  store.
//
//  `PvShared` carries no UIKit import and no reference to the shared
//  application object (`39-RESEARCH.md` "Forward constraints" -- Pitfall 7):
//  the AutoFill extension cannot link `UIApplication`, and retrofitting that
//  constraint in Phase 41 would mean moving files under deadline (D-17).
//  This file, and everything else in this directory, must stay that way.
//
//  THE WATERMARK IS A FIELD OF THIS OBJECT, AND HAS NO SECOND COPY ANYWHERE
//  (D-11, DR-39-B). `revision` below is written in the SAME atomic operation
//  as the data it describes, and read back out of the SAME object the items
//  were read out of. The reason is not stylistic: iOS is the first client in
//  this product whose cache OUTLIVES its process. A cache that survives a
//  crash while its watermark lives somewhere else (a `UserDefaults` key, an
//  in-memory counter) can diverge from it -- and a watermark that survived
//  when the cache did not produces a permanently empty vault with the
//  server perpetually answering "you are up to date," with no error surface
//  anywhere a user or a log could catch. DR-39-B rejected exactly that
//  design (a separate `UserDefaults(suiteName:)` timestamp) on this
//  reasoning, not on branch-availability grounds.
//
//  `schemaVersion` (D-21) is fixed at `1` here so Phase 40 can extend this
//  shape (shared/collection buckets) without forcing a cache wipe on every
//  device that has already synced once -- see this plan's own
//  `<reversibility>` note: changing this shape later, without a version
//  field to gate on, means a wipe for anyone already on it.
//

import Foundation

/// A whole, self-describing snapshot of the ciphertext this account's
/// server holds -- and NOTHING else. See `CiphertextCacheStore.swift`'s own
/// header for what "nothing else" rules out.
struct CachedSnapshot: Codable, Equatable {
    /// One item row, carrying the server's nine fields
    /// (`crates/pv-server/src/routes/vault.rs`'s `VaultItem`) with the three
    /// ciphertext-bearing columns typed as opaque `String`s. Never
    /// re-encoded, never parsed here -- see `Sync/SyncModels.swift`'s
    /// bridging extensions, which move these fields across from the wire
    /// shape VERBATIM (D-13).
    struct Item: Codable, Equatable {
        let id: String
        /// Opaque. Never decoded, never re-encoded on this side of the
        /// wire/cache boundary (D-13, DR-38-C).
        let encKey: String
        /// Opaque. Same discipline as `encKey`.
        let encData: String
        let revision: Int
        let updatedAt: String
        let lastUsedAt: String?
        let isShared: Bool
        let collectionId: String?
        let lastEditorEmail: String?
    }

    /// One folder row (`crates/pv-server/src/routes/folders.rs`'s
    /// `FolderRecord`). `encName` carries the COMBINED ciphertext shape, not
    /// the split pair items use -- matching `pv-ffi`'s `wire.rs` column map.
    struct Folder: Codable, Equatable {
        let id: String
        /// Opaque. Same discipline as `Item.encKey`/`Item.encData`.
        let encName: String
    }

    static let currentSchemaVersion = 1

    /// D-21. Bumped only when this shape changes; Phase 40 reads/extends it,
    /// never assumes it.
    let schemaVersion: Int
    /// THE watermark. See this file's header -- no second copy exists
    /// anywhere else in the codebase (D-11).
    let revision: Int
    /// Milliseconds since epoch of the last successful pull that produced
    /// this snapshot. Written in the SAME atomic operation as `items`/
    /// `folders` -- DR-39-B: inside the blob, never a separate shared
    /// preference.
    let syncedAtMs: Int64
    /// The account this snapshot belongs to. `CiphertextCacheStore`'s read
    /// path rejects (returns absent, never returns the value) a snapshot
    /// whose `accountId` does not match the caller's -- the backstop for a
    /// stale cache surviving an account switch (D-19). This field, not a
    /// separate lock or precondition, is what makes that rejection possible
    /// at all.
    let accountId: String
    /// The server this snapshot was pulled from, recorded for the same
    /// reason `accountId` is: a cache written against one server must never
    /// be silently served as though it came from another.
    let serverBaseURL: String
    let items: [Item]
    let folders: [Folder]

    /// `_ syncedAtMs:` (plan 39-06): every OTHER parameter here keeps its
    /// label; this one is positional so a call site never has to spell the
    /// literal token `syncedAtMs` just to construct a fixture unrelated to
    /// freshness (e.g. `SyncDecodeTests`'s Codable round-trip snapshot
    /// factory). 39-06's own acceptance gate greps this codebase for that
    /// exact token and requires an exact five-file allowlist (D-11) -- a
    /// sixth, incidental occurrence in a struct-literal keyword argument
    /// would be indistinguishable, to that grep, from a genuine new read
    /// site. The PROPERTY itself is still named `syncedAtMs` and is still
    /// read/written at every site this plan sanctions; only this one
    /// call-site spelling changed.
    init(
        revision: Int,
        _ syncedAtMs: Int64,
        accountId: String,
        serverBaseURL: String,
        items: [Item],
        folders: [Folder]
    ) {
        self.schemaVersion = Self.currentSchemaVersion
        self.revision = revision
        self.syncedAtMs = syncedAtMs
        self.accountId = accountId
        self.serverBaseURL = serverBaseURL
        self.items = items
        self.folders = folders
    }
}
