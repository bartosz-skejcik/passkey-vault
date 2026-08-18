//
//  VaultStore.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02. The tracer's observable
//  store: it owns the unlocked key handle, the decrypted array, and the two
//  operations the vertical slice needs (create one note, refresh from
//  `GET /api/sync`).
//
//  Three rules this file exists to hold, each with a reason:
//
//  1. **The wire JSON is never built here.** `encryptItemWire` /
//     `decryptItemWire` (`pv-ffi`'s `wire.rs`) produce and consume it; this
//     file moves opaque `String`s. DR-38-C, and landmine L-17 for what goes
//     wrong otherwise.
//  2. **The key handle is a plain stored property, never observed.** An
//     `@Published`/observed key can reach a SwiftUI diff and a debug
//     description (T-38-02-03).
//  3. **A row that fails to decrypt is kept and marked, never dropped**, and
//     never allowed to abort the loop over the other rows (T-38-02-02).
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03 adds a fourth rule:
//
//  4. **`refresh()`'s `since` comes from the persisted cache, never from
//     `lastKnownRevision` alone.** `SyncClient.pull()` reads the watermark
//     out of `CachedSnapshot` itself (D-11) -- `lastKnownRevision` is
//     updated FROM that response, it is never the value SENT. On the
//     up-to-date branch nothing is written to the cache store at all: that
//     branch structurally carries no collection to write (D-12, L-22,
//     `Sync/SyncModels.swift`'s header). On the snapshot branch the whole
//     cache is REPLACED, never merged (D-15) -- the server sends no
//     deletion markers.
//
//  Plan 39-06 (SYNC-04) adds a fifth rule, on top of #4 above:
//
//  5. **`currentSnapshot` is written on BOTH response branches, never only
//     the snapshot branch.** An up-to-date answer confirms the revision
//     with the server exactly as much as a snapshot answer does -- both are
//     a "pull the server actually answered" (T-39-23); a thrown request
//     writes nothing, on either branch. This is THE SOLE WRITE SITE for
//     `CachedSnapshot.syncedAtMs` (see that field's own header, D-11) --
//     `SyncStatusView` reads it only through the whole `CachedSnapshot`
//     object this store hands it, never the field directly.
//

import Foundation
import Observation
import os

/// Added in plan 38-09, Task 2.
enum VaultStoreError: Error, CustomStringConvertible, Equatable {
    /// See `VaultStore.update`'s own refusal note.
    case cannotSaveUndecryptableItem
    /// Plan 38-11: the store's key handle has been released by `lock()`
    /// BEFORE this call ever reached the network -- the pre-flight `guard
    /// let userKey` in `create`/`update`/`refresh`. Nothing was written,
    /// locally or on the server; the caller's in-progress form/action is
    /// still safe to keep and retry.
    case locked
    /// WR-14 (38-REVIEW.md, iteration 4): the mirror image of `.locked`,
    /// split out because it means the opposite thing. Thrown by the
    /// post-`await` re-check in `create`/`update`: the server has already
    /// accepted the write, and only the LOCAL mirror (the in-memory
    /// `items` array) was refused because a lock landed mid-flight
    /// (CR-04/WR-02, 38-REVIEW.md). Callers must never treat this as a
    /// failed save/move/delete -- there is nothing to retry and nothing to
    /// undo.
    case lockedAfterServerWrite
    /// CR-04 (38-REVIEW.md): the revision this update would encrypt at does
    /// not fit in a `UInt32` -- refuse rather than trap.
    case invalidRevision

    var description: String {
        switch self {
        case .cannotSaveUndecryptableItem:
            return "This item failed to decrypt during the last sync -- refresh before making changes."
        case .locked:
            return "The vault locked -- nothing was saved."
        case .lockedAfterServerWrite:
            return "The vault locked, but this change was already saved."
        case .invalidRevision:
            return "This item's revision is out of range and cannot be saved."
        }
    }
}

@MainActor
@Observable
final class VaultStore {
    /// The decrypted (or explicitly undecryptable) rows, newest server
    /// snapshot wins. Observed -- this is what the list renders.
    private(set) var items: [VaultItemViewModel] = []

    /// Last `vault_revision` merged; the `since` watermark for the next pull.
    private(set) var lastKnownRevision: Int = 0

    /// Plan 39-06 (SYNC-04). The whole persisted snapshot, mirrored here so
    /// `SyncStatusView` can read `syncedAtMs` (and, in a later plan,
    /// `items`/`folders` if ever needed) WITHOUT this store's own callers
    /// having to know the field's name -- `ItemListView` hands this object
    /// straight through, it never reads `syncedAtMs` itself (see the
    /// single-source gate in this plan's own acceptance criteria). Set by
    /// `hydrateFromCache()` on init/re-hydration and by BOTH `refresh()`
    /// branches below (rule 5 above); never anywhere else.
    private(set) var currentSnapshot: CachedSnapshot?

    private(set) var lastError: String?

    /// The union of every tag on every decoded row, recomputed on EVERY
    /// mutation (38-03).
    ///
    /// The web client's equivalent (`store.ts`'s `recomputeAllTags`) iterated
    /// `item.fields.tags` unguarded and ran on create, update, sync AND
    /// delete -- so one `tags`-less row threw out of every one of those,
    /// including the delete that would have removed it. One malformed row
    /// wedged the whole account, permanently. Here the coalescing happens BOTH
    /// at decode (`ItemNormalize`) and at the point of use (`item.tags`
    /// returns `[]` for the two field-less content cases), because the web
    /// client learned twice that a single choke point ASSUMED complete is
    /// what fails.
    private(set) var allTags: [String] = []

    /// Plan 38-11: whether this store has completed at least one `refresh()`
    /// since the last unlock (mirrors `web/src/lib/vault/store.ts`'s own
    /// `hydrated` flag). `lock()` resets it to `false` -- a re-unlock is
    /// genuinely a fresh "not yet known" window, exactly the web client's own
    /// discipline ("Arm 'not yet known' FIRST, before any async work
    /// starts -- every unlock re-opens the hydration window").
    private(set) var isHydrated = false

    /// NOT observed (T-38-02-03). `@ObservationIgnored` keeps the unlocked
    /// User Key handle out of the observation graph entirely, so it cannot be
    /// read by a SwiftUI dependency trace or rendered into a synthesized
    /// debug description of this object.
    ///
    /// Plan 38-11: a `var`, not a `let` -- `lock()` sets it `nil`, releasing
    /// the only strong reference this store holds to the decrypted session's
    /// key handle. Every read site below guards it explicitly rather than
    /// force-unwrapping, because after a lock this genuinely can be `nil`
    /// while the store instance itself is still alive and reachable (held by
    /// `ContentView`'s `@State`).
    @ObservationIgnored private var userKey: FfiUserKey?
    /// WR-03 (38-REVIEW.md): a `var`, not a `let` -- `lock()` replaces this
    /// with a dead `tokenProvider` (see `lock()`'s own note). Was `let`,
    /// which made `ContentView.storeFor`'s own comment ("a lock ... cannot
    /// leave a stale copy alive") false: `tokenProvider: { [token =
    /// session.token] in token }` captures the token BY VALUE, not late-
    /// bound, and this store never discarded `api` on a lock, so a call
    /// with no `userKey` guard (`touch(itemId:)`, fire-and-forget) could
    /// still authenticate with the pre-lock token afterward.
    @ObservationIgnored private var api: VaultAPI
    /// Plan 39-03. The account this store belongs to -- the value written
    /// into, and checked against, every `CachedSnapshot` this store reads
    /// or writes (D-19). Defaults to `""` so every pre-39-03 unit-test call
    /// site (`VaultStore(userKey:api:)`) keeps compiling and behaving
    /// exactly as before: an empty accountId paired with the default
    /// `NullCiphertextCacheStore` below never resolves to a real cache read.
    @ObservationIgnored private let accountId: String
    /// Plan 39-03. Branch H's App Group store in production
    /// (`ContentView.storeFor`); `NullCiphertextCacheStore` (no-op) by
    /// default for every existing test construction that has nothing to do
    /// with the cache.
    @ObservationIgnored private let cacheStore: CiphertextCacheStore
    @ObservationIgnored private static let log = Logger(
        subsystem: "cloud.blonie.PasskeyVault", category: "vault"
    )

    #if DEBUG
    /// WR-06 (38-REVIEW.md, iteration 2): test-visible confirmation that a
    /// post-`await` lock re-check actually fired -- distinguishes "the
    /// guard caught a lock that landed mid-flight" from "the lock merely
    /// ran after the response already arrived", which an outcome-only
    /// assertion (`store.items.isEmpty`) cannot tell apart under timing
    /// slip. DEBUG-only; production code never reads it.
    private(set) var lockedMidFlightGuardHits = 0
    #endif

    init(
        userKey: FfiUserKey,
        api: VaultAPI,
        accountId: String = "",
        cacheStore: CiphertextCacheStore = NullCiphertextCacheStore()
    ) {
        self.userKey = userKey
        self.api = api
        self.accountId = accountId
        self.cacheStore = cacheStore
        hydrateFromCache()
    }

    // MARK: - Cache hydration (plan 39-03)

    /// Reads the persisted snapshot BEFORE any network call, so a cold,
    /// offline launch still renders the last-known vault instead of an
    /// empty list. Deliberately does NOT set `isHydrated` -- that flag's
    /// contract (`refresh()`'s own note, T-38-11) is "at least one
    /// CONFIRMED server pull since unlock"; a disk read is not one, and a
    /// caller must not mistake a stale cached row for a just-confirmed
    /// sync.
    private func hydrateFromCache() {
        guard let snapshot = cacheStore.readCurrentSnapshot(accountId: accountId) else { return }
        currentSnapshot = snapshot
        items = snapshot.items.map { VaultItemRow(cached: $0) }.map(decrypt(row:))
        lastKnownRevision = snapshot.revision
        recomputeTags()
    }

    // MARK: - Lock

    /// THE single teardown for everything this store owns (plan 38-11,
    /// T-38-11-01/T-38-11-05): empties every array/map, clears the hydration
    /// flag, and releases the key handle -- in that order, in ONE place, so
    /// a lock can never forget a second one the way `web/src/lib/vault/
    /// store.ts`'s own header warns about (the whole reason that file uses a
    /// single subscription rather than several independent observers).
    ///
    /// Releasing `userKey` here is what a weak-reference test can observe:
    /// this store is the LAST strong holder of the decrypted session's key
    /// handle mid-render (`ContentView`'s `@State private var vaultStore`
    /// keeps the STORE instance alive across a lock -- only clearing its
    /// insides, not deallocating the store itself, actually tears the
    /// session down).
    func lock() {
        items = []
        allTags = []
        lastKnownRevision = 0
        isHydrated = false
        userKey = nil
        // WR-03 fix: replace the token supply with a dead one -- any call
        // still holding this `VaultStore` instance (e.g. `touch(itemId:)`,
        // which carries no `userKey` guard of its own by design, see its
        // header) now fails cleanly ("no session token available") instead
        // of authenticating with the pre-lock token.
        api = VaultAPI(baseURL: api.baseURL, tokenProvider: { nil }, session: api.session)
    }

    // MARK: - Id minting

    /// A lowercase UUID string.
    ///
    /// Foundation's `UUID().uuidString` is UPPERCASE hex; `crypto.randomUUID()`
    /// (web/extension) and Rust's `uuid` crate both produce lowercase. That id
    /// is a dictionary key and a URL path component in three clients, AND it
    /// is bound into the AEAD associated data by `pv-core`
    /// (`build_item_aad`), so a case mismatch does not merely look untidy --
    /// it makes the row undecryptable. `wire_shape.rs`'s
    /// `wrong_item_id_fails_to_decrypt` pins exactly that.
    ///
    /// `nonisolated` deliberately: minting an id touches no actor state, and
    /// the round-trip test needs it from a synchronous non-main context.
    nonisolated static func mintItemId() -> String {
        UUID().uuidString.lowercased()
    }

    // MARK: - Create

    /// Creates one note: mint id -> encrypt bound to that id at revision 1 ->
    /// `POST /api/vault/items`.
    ///
    /// Revision 1 at creation, matching `web/src/lib/vault/store.ts`'s
    /// `createVaultItem`. The server's 201 is NOT taken as evidence the wire
    /// format is correct -- see `VaultAPI.createItem`'s own note.
    @discardableResult
    func create(noteNamed name: String, body: String) async throws -> VaultItemViewModel {
        try await create(
            fields: .note(NoteFields(name: name, folderId: nil, tags: [], body: body))
        )
    }

    /// Creates one item of any type.
    @discardableResult
    func create(fields: ItemFields) async throws -> VaultItemViewModel {
        guard let userKey else { throw VaultStoreError.locked }
        let id = Self.mintItemId()
        let plaintext = try ItemNormalize.plaintextJSON(for: fields)

        let wire = try encryptItemWire(
            userKey: userKey, plaintext: plaintext, itemId: id, revision: 1
        )
        _ = try await api.createItem(
            id: id, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson
        )

        let item = VaultItemViewModel(id: id, revision: 1, content: .fields(fields))

        // CR-02 fix: re-check the lock immediately after the `await` and
        // before touching `self` -- the `guard let userKey` above binds a
        // LOCAL that survives the suspension point, so `lock()` setting
        // `self.userKey = nil` does not by itself stop this bookkeeping.
        // If a lock landed while the write was in flight, the server write
        // already stands (nothing to undo), but the local store must stay
        // torn down rather than re-populated with decrypted plaintext.
        //
        // WR-02 (iteration 2): throw rather than `return item` -- a normal
        // return here was indistinguishable from the non-locked success
        // path, so the caller (`ItemFormView.save()`) ran `onSaved?(item)`
        // unconditionally and handed decrypted plaintext to a controller
        // that `lockTeardown` had already reset.
        //
        // WR-14 (38-REVIEW.md, iteration 4): `.lockedAfterServerWrite`, not
        // `.locked` -- the server write above already succeeded; only this
        // local bookkeeping is refused. Reusing `.locked` here made this
        // site indistinguishable from the pre-flight `guard let userKey`
        // above, which means the opposite ("nothing was written").
        guard self.userKey != nil else {
            #if DEBUG
            lockedMidFlightGuardHits += 1
            #endif
            throw VaultStoreError.lockedAfterServerWrite
        }

        // Post-commit bookkeeping: the server write has already been
        // accepted, so a local failure here must never be reported as a
        // failed creation (the web client's `createVaultItem` carries the
        // same discipline for the same reason -- a retry into duplicate
        // rows).
        items.append(item)
        recomputeTags()
        return item
    }

    // MARK: - Update

    /// Refuses to save over a row the client could not decrypt (T-38-03-05,
    /// 38-09's own must-have). That row's retained `revision` is stale by
    /// construction -- see `VaultItemViewModel.Content.undecryptable`'s own
    /// doc comment -- so using it as `expected_revision` would either 409
    /// forever or, worse, succeed against a row that has since moved.
    func cannotSaveUndecryptableItem(_ item: VaultItemViewModel) -> Bool {
        item.isUndecryptable
    }

    /// Sends `item.revision` as the optimistic-concurrency guard, encrypts
    /// at `revision + 1`, and updates local state ONLY after the server's
    /// response has been awaited successfully -- this exact ordering hazard
    /// ("a thrown error reported over a completed server mutation") has
    /// recurred three times in this repository (`ios/IOS-SPIKE-LOG.md`,
    /// the entry beginning "The post-await bookkeeping hazard has now
    /// recurred THREE times"), each time in a different function. A stale
    /// revision surfaces as `VaultAPIError.revisionConflict`, thrown
    /// straight through -- the local `items` array is untouched, because
    /// control never reaches the append/replace line below on that path.
    @discardableResult
    func update(_ item: VaultItemViewModel, fields: ItemFields) async throws -> VaultItemViewModel {
        guard !cannotSaveUndecryptableItem(item) else {
            throw VaultStoreError.cannotSaveUndecryptableItem
        }
        guard let userKey else { throw VaultStoreError.locked }
        let newRevision = item.revision + 1
        // CR-04 fix: `item.revision` ultimately traces back to a
        // server-controlled `Int` (`decrypt(row:)` below). `UInt32(_:)`
        // TRAPS on a negative/out-of-range value; `UInt32(exactly:)` is
        // failable, routing the same class of bad input into the store's
        // existing "cannot save this item" refusal instead of a crash.
        guard let revision32 = UInt32(exactly: newRevision) else {
            throw VaultStoreError.invalidRevision
        }
        let plaintext = try ItemNormalize.plaintextJSON(for: fields)
        let wire = try encryptItemWire(
            userKey: userKey, plaintext: plaintext, itemId: item.id, revision: revision32
        )
        // Everything above this line is pure computation and network I/O
        // that has not yet mutated `self`. The awaited call is the ONLY
        // thing that can throw a `VaultAPIError.revisionConflict` -- if it
        // does, this function returns via that throw and NOTHING below runs.
        let response = try await api.updateItem(
            id: item.id, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson,
            expectedRevision: item.revision
        )

        // Post-await bookkeeping: the server has already accepted the
        // write, so a local failure here must never be reported as a
        // failed save.
        let updated = VaultItemViewModel(
            id: item.id,
            revision: response.revision,
            content: .fields(fields),
            updatedAt: response.updated_at,
            lastUsedAt: item.lastUsedAt,
            isShared: item.isShared,
            lastEditorEmail: item.lastEditorEmail,
            collectionId: item.collectionId,
            sharedToMe: item.sharedToMe,
            accessLevel: item.accessLevel
        )

        // CR-02 fix: same re-check as `create` -- the `guard let userKey`
        // above bound a LOCAL that survived the `await`, so a `lock()`
        // mid-flight left this bookkeeping unconditional and re-inserted
        // decrypted plaintext into a store that had already been torn
        // down. The server write stands either way; only the LOCAL
        // mutation is gated.
        //
        // WR-02 (iteration 2): throw rather than `return updated`, for the
        // same reason as `create` above -- a look-alike success return let
        // `ItemFormView.save()` run `onSaved?(updated)` unconditionally.
        //
        // WR-14 (38-REVIEW.md, iteration 4): `.lockedAfterServerWrite`, not
        // `.locked` -- see `create`'s own note above. This is also the
        // guard `ItemListView.applyFolderMove` hits, which must not report
        // a move the server accepted as a failure.
        guard self.userKey != nil else {
            #if DEBUG
            lockedMidFlightGuardHits += 1
            #endif
            throw VaultStoreError.lockedAfterServerWrite
        }

        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = updated
        } else {
            items.append(updated)
        }
        recomputeTags()
        return updated
    }

    // MARK: - Delete

    /// Permanent, server-confirmed delete: `DELETE /api/vault/items/{id}`,
    /// then remove locally only on the server's 204. Added in plan 38-06,
    /// Task 2, for the list's swipe-to-delete action -- see
    /// `VaultAPI.deleteItem`'s own note on why a non-functional delete
    /// button would be worse than none.
    ///
    /// Local removal happens AFTER the network call succeeds, mirroring
    /// `create`'s own ordering discipline in reverse: `create` appends
    /// locally only after the server accepts the write; this removes
    /// locally only after the server confirms the delete, so a network
    /// failure never desyncs the on-screen list from the server's actual
    /// state.
    func delete(_ item: VaultItemViewModel) async throws {
        try await api.deleteItem(id: item.id)
        items.removeAll { $0.id == item.id }
        recomputeTags()
    }

    // MARK: - Touch (last-used)

    /// Fire-and-forget: records "this item's secret was just used"
    /// (reveal/copy), never blocking the caller -- mirrors
    /// `touchVaultItem`'s own doc comment (`DetailPanel.tsx`'s single
    /// choke-point, fire-and-forget contract). Added in plan 38-07, Task 1,
    /// as a Rule 3 deviation alongside `VaultAPI.touchItem`: the detail
    /// screen's reveal/copy wiring has nowhere else to call.
    ///
    /// Updates the local `lastUsedAt` on success so the list's
    /// last-used-descending sort reflects it without a full `refresh()`.
    /// Never surfaced as a user-visible error on failure -- a touch is
    /// metadata bookkeeping, not a save the user is waiting on.
    func touch(itemId: String) {
        Task {
            do {
                let response = try await api.touchItem(id: itemId)
                if let index = items.firstIndex(where: { $0.id == itemId }) {
                    items[index].lastUsedAt = response.last_used_at
                }
            } catch {
                Self.log.error(
                    "touch failed for \(itemId, privacy: .public): \(String(describing: error), privacy: .public)"
                )
            }
        }
    }

    // MARK: - Refresh

    /// `GET /api/sync?since=<watermark>` and merge.
    ///
    /// The up-to-date branch (no `items` key at all) is a normal outcome, not
    /// an error: the server returns it on every pull where nothing changed.
    ///
    /// Plan 39-03: the `since` sent is no longer `lastKnownRevision` read
    /// directly -- `SyncClient.pull()` reads it out of the persisted
    /// `CachedSnapshot` itself (D-11, the watermark's single copy). On the
    /// up-to-date branch NOTHING is written to the cache store: that branch
    /// structurally carries no collection to write (D-12). On the snapshot
    /// branch the cache is REPLACED whole, never merged (D-15).
    func refresh() async throws {
        #if DEBUG
        if ProcessInfo.processInfo.environment[Self.uitestCapabilityFixtureEnvKey] != nil {
            applyCapabilityGatingFixture()
            isHydrated = true
            return
        }
        #endif
        guard userKey != nil else { throw VaultStoreError.locked }
        let syncClient = SyncClient(
            baseURL: api.baseURL,
            tokenProvider: api.tokenProvider,
            cacheStore: cacheStore,
            accountId: accountId,
            session: api.session
        )
        let response = try await syncClient.pull()

        // CR-02 fix: re-check the lock immediately after the `await` and
        // before touching `self` -- without this, a lock landing while the
        // pull is in flight left `isHydrated` resurrected to `true` (and,
        // on a `.snapshot` response, `items` repopulated with decrypted
        // plaintext) AFTER the lock had explicitly cleared both. A quiet
        // early return here is correct, not an error: the lock itself is
        // what invalidated this in-flight read, not a network failure --
        // `refresh()` returns `Void`, so there is no look-alike-success
        // value for a caller to misinterpret (contrast `create`/`update`
        // above, WR-02).
        guard userKey != nil else {
            #if DEBUG
            lockedMidFlightGuardHits += 1
            #endif
            return
        }

        switch response {
        case let .upToDate(revision):
            lastKnownRevision = revision
            persistUpToDateToCache(revision: revision)
        case let .snapshot(revision, rows, folderRows):
            items = rows.map(decrypt(row:))
            lastKnownRevision = revision
            persistSnapshotToCache(revision: revision, items: rows, folders: folderRows)
        }
        recomputeTags()
        isHydrated = true
    }

    /// DR-39-A: one JSON blob, written whole and replaced whole. Failure is
    /// logged, never thrown -- the server write (nothing happens here) and
    /// the in-memory `items` array are already correct at this point in
    /// `refresh()`; a cache-persistence failure must not be reported to the
    /// caller as a failed sync.
    private func persistSnapshotToCache(revision: Int, items rows: [VaultItemRow], folders folderRows: [FolderRow]) {
        let snapshot = CachedSnapshot(
            revision: revision,
            Int64(Date().timeIntervalSince1970 * 1000), // syncedAtMs, positional (CachedSnapshot.init's own note)
            accountId: accountId,
            serverBaseURL: api.baseURL.absoluteString,
            items: rows.map(CachedSnapshot.Item.init(row:)),
            folders: folderRows.map(CachedSnapshot.Folder.init(row:))
        )
        currentSnapshot = snapshot
        do {
            try cacheStore.write(snapshot)
        } catch {
            Self.log.error(
                "failed to persist sync cache: \(String(describing: error), privacy: .public)"
            )
        }
    }

    /// Plan 39-06 (SYNC-04, T-39-23). The up-to-date branch structurally
    /// carries no item collection (D-12) -- 39-03 only needed the snapshot
    /// branch's write. This re-persists whatever items/folders are ALREADY
    /// cached (never re-derived from `self.items`, which are already-
    /// decrypted plaintext; the cache holds only ciphertext, D-11/SYNC-03)
    /// under an updated `revision`/`syncedAtMs`, because an up-to-date
    /// answer is JUST as much a confirmed pull as a snapshot answer is --
    /// both response branches confirm the revision with the server; a
    /// thrown request writes nothing (see `refresh()`'s own note above).
    ///
    /// If nothing has ever been cached, this still records the pull -- with
    /// an EMPTY item set, which is exactly what the server confirmed exists
    /// -- rather than leaving the freshness value permanently absent for an
    /// account that has, in fact, synced. This is reachable on a brand-new
    /// account's very first pull: `since=0` already equals a fresh
    /// account's `revision=0`, so the FIRST response a new account ever
    /// sees can be up-to-date, never a snapshot.
    private func persistUpToDateToCache(revision: Int) {
        let snapshot = CachedSnapshot(
            revision: revision,
            Int64(Date().timeIntervalSince1970 * 1000), // syncedAtMs, positional (CachedSnapshot.init's own note)
            accountId: accountId,
            serverBaseURL: api.baseURL.absoluteString,
            items: currentSnapshot?.items ?? [],
            folders: currentSnapshot?.folders ?? []
        )
        currentSnapshot = snapshot
        do {
            try cacheStore.write(snapshot)
        } catch {
            Self.log.error(
                "failed to persist sync cache (up-to-date): \(String(describing: error), privacy: .public)"
            )
        }
    }

    #if DEBUG
    /// TEST-ONLY (plan 38-06, Task 2): when set, `refresh()` short-circuits
    /// to a synthetic two-item fixture instead of calling the real network.
    /// This is the ONLY way to screenshot the "a shared row hides Edit"
    /// acceptance criterion honestly: `VaultItemRow`/`SyncPullResult` do not
    /// carry `access_level`/a shared-direct discriminant at all today (that
    /// sync endpoint, `GET /api/sync/shared/direct`, is Phase 40's job), so
    /// the REAL sync path can never actually produce a `sharedToMe == true`
    /// row for this build to screenshot. Mirrors `ContentView.swift`'s own
    /// `PV_UITEST_SCREEN`/`PV_UITEST_ROUTE` DEBUG-only forced-state
    /// convention -- never compiled into Release, never reachable without
    /// deliberately setting this exact environment variable.
    static let uitestCapabilityFixtureEnvKey = "PV_UITEST_VAULT_FIXTURE"

    private func applyCapabilityGatingFixture() {
        let owned = VaultItemViewModel(
            id: "uitest-owned-login", revision: 1,
            content: .fields(
                .login(
                    LoginFields(
                        name: "Owned Login", folderId: nil, tags: [], username: "me@example.com",
                        password: "hunter2", urls: ["https://example.com"], notes: ""
                    )
                )
            )
        )
        let shared = VaultItemViewModel(
            id: "uitest-shared-login", revision: 1,
            content: .fields(
                .login(
                    LoginFields(
                        name: "Shared Login", folderId: nil, tags: [], username: "them@example.com",
                        password: "hunter3", urls: ["https://shared.example.com"], notes: ""
                    )
                )
            ),
            sharedToMe: true,
            accessLevel: "read"
        )
        items = [owned, shared]
        recomputeTags()
    }
    #endif

    /// The tag union. Reads `item.tags`, which is safe on EVERY content case
    /// including the two that carry no fields at all -- see `allTags`' own
    /// note for the account-wedging defect that shape prevents.
    private func recomputeTags() {
        var seen = Set<String>()
        var ordered: [String] = []
        for item in items {
            for tag in item.tags where !seen.contains(tag) {
                seen.insert(tag)
                ordered.append(tag)
            }
        }
        allTags = ordered
    }

    /// Decrypts one row, or retains it marked. Never throws -- a single bad
    /// row must not abort the loop over the rest of the vault.
    ///
    /// `refresh()` already guards `userKey != nil` before this is ever
    /// called on the real path -- the `guard` below is defense-in-depth
    /// against a future call site, not the primary lock check, and reports
    /// the same "vault is locked" shape as any other decrypt failure rather
    /// than crashing.
    private func decrypt(row: VaultItemRow) -> VaultItemViewModel {
        guard let userKey else {
            return VaultItemViewModel(
                id: row.id,
                revision: row.revision,
                content: .undecryptable(reason: VaultStoreError.locked.description),
                updatedAt: row.updated_at,
                lastUsedAt: row.last_used_at,
                isShared: row.is_shared,
                lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id
            )
        }
        // CR-04 fix: `row.revision` is server-controlled, untrusted input
        // (this product's own threat model). Swift's `UInt32(_:)` TRAPS
        // (uncatchable `fatalError`) on a negative value -- a `do`/`catch`
        // around the decrypt call below cannot save this row from that, and
        // a hostile or corrupted `revision: -1` would crash every client on
        // every launch, permanently, with no way to reach the row to delete
        // it. `UInt32(exactly:)` is failable, so an out-of-range revision
        // becomes an ordinary `.undecryptable` row -- same shape as every
        // other decrypt failure -- instead of a crash.
        guard let revision = UInt32(exactly: row.revision) else {
            Self.log.error(
                "row \(row.id, privacy: .public) has an out-of-range revision (\(row.revision)); marking undecryptable"
            )
            return VaultItemViewModel(
                id: row.id,
                revision: row.revision,
                content: .undecryptable(reason: "server returned an out-of-range revision"),
                updatedAt: row.updated_at,
                lastUsedAt: row.last_used_at,
                isShared: row.is_shared,
                lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id
            )
        }
        do {
            let plaintext = try decryptItemWire(
                userKey: userKey,
                encKeyJson: row.enc_key,
                encDataJson: row.enc_data,
                itemId: row.id,
                revision: revision
            )
            // ONE call, and it is the single complete trust boundary for
            // untrusted plaintext: shape normalization, both legacy
            // migrations, the raw passkey wire sniffer and the tags
            // invariant all live behind it (38-03).
            let fields = try ItemNormalize.normalizeItemFields(fromPlaintext: plaintext)
            return VaultItemViewModel(
                id: row.id,
                revision: row.revision,
                content: .fields(fields),
                updatedAt: row.updated_at,
                lastUsedAt: row.last_used_at,
                isShared: row.is_shared,
                lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id
            )
        } catch {
            // Logged with the row id and the error only. Never the
            // ciphertext, never any key material.
            Self.log.error(
                "row \(row.id, privacy: .public) failed to decrypt: \(String(describing: error), privacy: .public)"
            )
            return VaultItemViewModel(
                id: row.id,
                revision: row.revision,
                content: .undecryptable(reason: String(describing: error)),
                updatedAt: row.updated_at,
                lastUsedAt: row.last_used_at,
                isShared: row.is_shared,
                lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id
            )
        }
    }
}
