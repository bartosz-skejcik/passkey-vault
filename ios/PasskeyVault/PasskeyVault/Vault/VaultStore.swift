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
//     updated FROM that response, it is never the value SENT. The DECODED
//     up-to-date response structurally carries no item collection at all
//     (D-12, L-22, `Sync/SyncModels.swift`'s header) -- but as of plan
//     39-06/rule 5 below (hardened by CR-02, 39-REVIEW.md),
//     `persistUpToDateToCache` DOES still write a re-persisted blob on that
//     branch, re-reading its items from the EXISTING on-disk snapshot, never
//     from a decoded collection. This corrects an earlier version of this
//     comment, which claimed "nothing is written to the cache store at all"
//     on that branch -- true only before plan 39-06. On the snapshot branch
//     the whole cache is REPLACED, never merged (D-15) -- the server sends
//     no deletion markers.
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
    /// CR-03 (39-REVIEW.md): the in-flight latch `refresh()` uses to
    /// serialise pulls. Six independent triggers can call `refresh()` with
    /// no de-duplication otherwise (the WS open/frame catch-up pull, the
    /// 30s foreground timer, every scenePhase-active transition,
    /// `ItemListView`'s `.task`, and pull-to-refresh) -- a caller that
    /// arrives while a pull is already running awaits THIS task's result
    /// rather than starting a second, overlapping network round trip.
    @ObservationIgnored private var pullInFlight: Task<Void, Error>?
    /// WR-03 (39-REVIEW.md, iteration 2): set by a caller that arrives
    /// while `pullInFlight` is already running -- `SyncSocket` is
    /// notification-only (this type's own header on `refresh()`, `d
    /// `SyncSocket.swift`'s own "any frame means go pull"); a frame arriving
    /// mid-pull was, before this fix, silently COALESCED into the
    /// already-in-flight request (whose `GET /api/sync?since=N` was issued
    /// BEFORE the frame arrived, so its response may predate the change the
    /// frame is announcing) rather than producing a NEW pull afterwards.
    /// Read and cleared only inside `refresh()`'s own `repeat` loop below,
    /// all on the main actor -- never a source of the race this member's
    /// sibling already closed.
    @ObservationIgnored private var pullRequestedDuringFlight = false

    /// CR-04 (40-REVIEW.md): the ids of every row currently in `items` that
    /// came from a SHARED source (direct share or family-wide collection),
    /// not the personal `/api/sync` snapshot -- tracked so
    /// `mergeSharedAndFamilyWideItems()` can strip exactly last refresh's
    /// shared rows before re-adding fresh ones, on every call, regardless
    /// of which branch the personal pull above took. Without this, a
    /// direct share or family-wide item would duplicate on every
    /// subsequent refresh.
    @ObservationIgnored private var sharedItemIds: Set<String> = []

    /// WR-17 (40-REVIEW.md, iteration 2): mirrors `SyncCoordinator`'s own
    /// identically-named/-purposed cache -- `mergeSharedAndFamilyWideItems`
    /// gates its ENTIRE four-endpoint fan-out (including
    /// `ensureOwnIdentityKeypair`, whose first call durably PUBLISHES an
    /// identity keypair server-side) on this flag once a family-gated
    /// endpoint has confirmed "not a member of any family" for the current
    /// session. WR-20: cleared by `familyMembershipMayHaveChanged()` when
    /// this account creates or joins a family IN-SESSION (`FamilyRootView
    /// .createFamily`/`InviteRedeemView.onFinished`) -- see that method's
    /// own doc comment for why latching this for the rest of the session
    /// would otherwise strand a brand-new member with no merge ever running
    /// again until a lock/unlock.
    @ObservationIgnored private var hasNoFamily = false

    /// WR-10 (40-REVIEW.md): real production state now. Was built,
    /// tested, and had zero callers before this fix -- `applyFamilyWidePending`
    /// is now driven by a real pull cycle (`mergeSharedAndFamilyWideItems`,
    /// best-effort), and `markDecryptFailed` is now called from the
    /// family-wide row decrypt path this same fix adds. `@Observable`
    /// itself, so a view holding this store can read `pendingKeyState`
    /// directly without this store re-exporting each field.
    let pendingKeyState = PendingKeyState()

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
        guard let snapshot = cacheStore.readCurrentSnapshot(accountId: accountId, serverBaseURL: api.baseURL.absoluteString) else { return }
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
        // CR-04/WR-10: the shared-row tracking and pending-key state this
        // fix adds are just as much "everything this store owns" as
        // `items`/`allTags` above -- see this type's own header discipline.
        sharedItemIds = []
        pendingKeyState.reset()
        // WR-08 (39-REVIEW.md): added in plan 39-06, `currentSnapshot` holds
        // every item's ciphertext, the account id and the server URL for the
        // lifetime of this store -- this type's own header says "empties
        // EVERY array/map", and until this fix, this member was the one
        // exception. It is ciphertext, so this was never a key leak, but the
        // invariant itself was false, and a later reader inheriting `lock()`
        // would reasonably assume it was complete.
        currentSnapshot = nil
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
        let response = try await api.createItem(
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
        // WR-04/WR-07 (39-REVIEW.md): a local mutation never reaches the
        // persisted cache through any other path -- see
        // `patchCacheAfterLocalMutation(_:)`'s own header. The ciphertext
        // patched in is the SAME `wire.encKeyJson`/`encDataJson` just sent
        // to the server, moved verbatim (D-13), never re-derived from the
        // decrypted `item` above.
        patchCacheAfterLocalMutation(.upsert(CachedSnapshot.Item(
            id: id,
            encKey: wire.encKeyJson,
            encData: wire.encDataJson,
            revision: response.revision,
            updatedAt: response.updated_at,
            lastUsedAt: nil,
            isShared: false,
            collectionId: nil,
            lastEditorEmail: nil
        )))
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
        // WR-04/WR-07 (39-REVIEW.md): patched in place, never purged -- see
        // `patchCacheAfterLocalMutation(_:)`'s own header. `wire.encKeyJson`/
        // `encDataJson` moved verbatim (D-13); every other field preserved
        // from the item's own prior metadata, since none of it changed.
        patchCacheAfterLocalMutation(.upsert(CachedSnapshot.Item(
            id: item.id,
            encKey: wire.encKeyJson,
            encData: wire.encDataJson,
            revision: response.revision,
            updatedAt: response.updated_at,
            lastUsedAt: item.lastUsedAt,
            isShared: item.isShared ?? false,
            collectionId: item.collectionId,
            lastEditorEmail: item.lastEditorEmail
        )))
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
        // WR-04/WR-07 (39-REVIEW.md): patched in place (removed by id),
        // never purged -- see `patchCacheAfterLocalMutation(_:)`'s own
        // header.
        patchCacheAfterLocalMutation(.remove(id: item.id))
    }

    /// WR-04 (39-REVIEW.md): `create`/`update`/`delete` mutate the server
    /// and the in-memory `items` array, but until this fix never touched
    /// `cacheStore`/`currentSnapshot` -- so until the next successful
    /// `refresh()`, the persisted blob still held a deleted item's
    /// ciphertext (and missed newly created ones). That is the exact
    /// "keeps offering a credential the user deleted" hazard
    /// `CiphertextCacheStore.write`'s own doc comment (D-15) gives as the
    /// reason merges are forbidden -- an un-refreshed persisted cache is a
    /// merge-shaped staleness by omission, just deferred rather than
    /// immediate.
    ///
    /// WR-07 (39-REVIEW.md, iteration 2): this used to `purge()` the WHOLE
    /// cache (blob + watermark + current-account marker, since WR-05) on
    /// EVERY successful local edit, with nothing scheduling a re-populate.
    /// One create/update/delete therefore left the device with NO offline
    /// copy at all until the next successful pull -- and if the network
    /// dropped in that window, the next cold launch's `hydrateFromCache()`
    /// (a REAL cold reader in the host app itself, not merely a probe)
    /// rendered an EMPTY vault, and (Phase 41) AutoFill offered nothing.
    /// The iteration-1 review's premise ("today the only cold reader is a
    /// probe") overlooked that.
    ///
    /// This now PATCHES the existing on-disk snapshot's item list in place
    /// instead of purging it -- `revision`/`syncedAtMs` are left UNCHANGED
    /// (this is a local application of a mutation the server ALREADY
    /// accepted, not a merge of two independent views of server state, so
    /// D-15's prohibition does not apply). Leaving the watermark behind is
    /// safe by construction: the next `refresh()` still sends the OLD
    /// `since` value, and the server answers with a snapshot including this
    /// same mutation (now confirmed server-side too), which reconciles
    /// fully regardless of what this function did in between. A no-op if
    /// nothing has EVER been cached for this account -- there is nothing to
    /// patch, and fabricating a partial cache from nothing would itself be
    /// exactly the kind of invention D-15 forbids.
    private func patchCacheAfterLocalMutation(_ mutation: LocalCacheMutation) {
        guard let existing = cacheStore.readCurrentSnapshot(accountId: accountId, serverBaseURL: api.baseURL.absoluteString) else {
            return
        }
        var patchedItems = existing.items
        switch mutation {
        case let .upsert(item):
            if let index = patchedItems.firstIndex(where: { $0.id == item.id }) {
                patchedItems[index] = item
            } else {
                patchedItems.append(item)
            }
        case let .remove(id):
            patchedItems.removeAll { $0.id == id }
        }
        let patched = CachedSnapshot(
            revision: existing.revision,
            existing.syncedAtMs,
            accountId: existing.accountId,
            serverBaseURL: existing.serverBaseURL,
            items: patchedItems,
            folders: existing.folders
        )
        writeSnapshot(patched, context: "local-mutation-patch")
    }

    /// WR-07 (39-REVIEW.md, iteration 2). Closed over `create`/`update`
    /// (`.upsert`, the server-confirmed row's ciphertext VERBATIM, D-13) and
    /// `delete` (`.remove`, by id only -- nothing to re-encrypt).
    private enum LocalCacheMutation {
        case upsert(CachedSnapshot.Item)
        case remove(id: String)
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
    /// `CachedSnapshot` itself (D-11, the watermark's single copy). The
    /// up-to-date branch DOES write to the cache store (39-06/CR-02, see
    /// `persistUpToDateToCache`'s own header) -- re-persisting whatever is
    /// ALREADY on disk under an advanced watermark, never a collection this
    /// decode step produced (it structurally carries none, D-12). On the
    /// snapshot branch the cache is REPLACED whole, never merged (D-15).
    ///
    /// CR-03 (39-REVIEW.md): serialised via `pullInFlight` -- a caller
    /// arriving while a pull is already running awaits that SAME task's
    /// result instead of starting a second, overlapping request. This alone
    /// stops two network round trips from ever being in flight at once, but
    /// a response can still legitimately describe an OLDER server state
    /// than one this store already merged (a retried request racing a
    /// fresher one at the HTTP layer, for instance) -- `performRefresh()`'s
    /// own monotonicity guard on both branches is the backstop for that.
    ///
    /// WR-03 (39-REVIEW.md, iteration 2): a caller arriving mid-flight no
    /// longer merely JOINS the in-flight task's result -- it also sets
    /// `pullRequestedDuringFlight`, so the leader's `repeat` loop below
    /// issues a FRESH pull once the current one completes. `SyncSocket` is
    /// notification-only: a WS frame arriving while a pull is already
    /// running means "something changed AFTER the request that pull already
    /// sent was issued" -- joining that in-flight task silently discarded
    /// the notification (its response could predate the change the frame
    /// announced, and nothing retried). This also closes the narrower
    /// finished-but-not-yet-nilled race the same finding named: the
    /// `defer { pullInFlight = nil }` below and this loop's `while` check
    /// run in the SAME uninterrupted stretch of main-actor execution as
    /// `task.value` resuming (no `await` between them), so a caller cannot
    /// observe `pullInFlight` as non-nil for a task that has already
    /// finished, nor nil for one that has not yet started its next
    /// iteration.
    func refresh() async throws {
        #if DEBUG
        if ProcessInfo.processInfo.environment[Self.uitestCapabilityFixtureEnvKey] != nil {
            applyCapabilityGatingFixture()
            isHydrated = true
            return
        }
        #endif
        if let inFlight = pullInFlight {
            pullRequestedDuringFlight = true
            try await inFlight.value
            return
        }
        repeat {
            pullRequestedDuringFlight = false
            let task = Task { try await self.performRefresh() }
            pullInFlight = task
            defer { pullInFlight = nil }
            try await task.value
        } while pullRequestedDuringFlight
    }

    private func performRefresh() async throws {
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
            // CR-03: discard a response that has already been superseded --
            // defense in depth on top of `pullInFlight`'s serialisation
            // above, for a response that itself describes older server
            // state than this store already knows about.
            guard revision >= lastKnownRevision else {
                Self.log.error("discarding out-of-order up-to-date sync response (\(revision) < \(self.lastKnownRevision))")
                return
            }
            lastKnownRevision = revision
            persistUpToDateToCache(revision: revision)
        case let .snapshot(revision, rows, folderRows):
            guard revision >= lastKnownRevision else {
                Self.log.error("discarding out-of-order snapshot sync response (\(revision) < \(self.lastKnownRevision))")
                return
            }
            items = rows.map(decrypt(row:))
            lastKnownRevision = revision
            persistSnapshotToCache(revision: revision, items: rows, folders: folderRows)
        }
        recomputeTags()
        isHydrated = true

        // CR-04: direct-shared items and family-wide-collection items (any
        // author) -- see `mergeSharedAndFamilyWideItems()`'s own header.
        // Runs on every refresh, not just the `.snapshot` branch above:
        // these are separate endpoints with their own state, not covered
        // by the personal pull's up-to-date/snapshot split.
        await mergeSharedAndFamilyWideItems()
    }

    /// CR-04 item 4 (40-REVIEW.md): the raw `enc_key` a `ShareItemView`
    /// caller needs to build a `ShareableItem` -- fetched fresh, on
    /// demand, never stored as a property on this `@Observable` type.
    /// `ShareableItem`'s own header explains why: `VaultItemViewModel`
    /// deliberately carries no raw `enc_key`/`enc_data` (DR-38-C, this
    /// file's own header rule 1 -- "the wire JSON is never built here").
    /// A full `sync(since: 0)` round trip is the only client already
    /// wrapping this read; only the ONE matching row's `enc_key` is ever
    /// returned, and it is never assigned to any stored/observed property
    /// of this store.
    func fetchRawEncKeyJson(forOwnedItemId itemId: String) async throws -> String? {
        guard userKey != nil else { throw VaultStoreError.locked }
        let result = try await api.sync(since: 0)
        guard case let .snapshot(_, rows, _) = result else { return nil }
        return rows.first(where: { $0.id == itemId })?.enc_key
    }

    /// WR-20 (40-REVIEW.md, iteration 2): `hasNoFamily`'s own `guard` at the
    /// top of `mergeSharedAndFamilyWideItems` latches for the rest of the
    /// session once set -- correct for "this account will never be in a
    /// family without a fresh unlock", WRONG once CR-04(b)'s new in-session
    /// join paths exist (`FamilyRootView.createFamily`, `InviteRedeemView`
    /// presented from `ContentView`, neither of which re-derives a session
    /// or calls `SyncCoordinator.start(...)`). Without this, a member who
    /// creates or joins a family mid-session would see the merge disabled
    /// for the remainder of it -- their own new shares/collections would
    /// never appear until the app is locked and unlocked. Called by both of
    /// those success paths; a no-op if the flag was never set.
    func familyMembershipMayHaveChanged() {
        hasNoFamily = false
    }

    /// Computed, not stored -- nothing to `@ObservationIgnored` (that
    /// attribute only applies to stored properties); a fresh, stateless
    /// service value per call, same pattern every other Phase 40 service
    /// consumer in this codebase already uses (`RemoveMemberService`'s own
    /// `familyAPI`/`identityService`/`collectionService` computed
    /// properties).
    private var identityService: IdentityService {
        IdentityService(baseURL: api.baseURL, tokenProvider: api.tokenProvider, session: api.session)
    }

    private var collectionService: CollectionService {
        CollectionService(baseURL: api.baseURL, tokenProvider: api.tokenProvider, session: api.session)
    }

    /// CR-04 (40-REVIEW.md): closes the "a received share, or a family-wide
    /// collection's items authored by anyone else, never appears in the
    /// vault list" gap -- `/api/sync`'s collection arm is author-scoped
    /// (`ingestPersonalSync`'s own header), and nothing called
    /// `/api/sync/shared/direct` at all before this. Best-effort: any
    /// failure here is logged and this store's items simply carry no
    /// shared rows for this cycle, never surfaced as a failed refresh --
    /// the personal pull above already completed and is not retroactively
    /// invalidated by this step failing.
    private func mergeSharedAndFamilyWideItems() async {
        guard let uk = userKey else { return }
        // WR-17: skip the ENTIRE fan-out once this session has confirmed
        // "not a member of any family" -- see `hasNoFamily`'s own doc
        // comment for what this replaces.
        guard !hasNoFamily else { return }

        // WR-16 (40-REVIEW.md, iteration 2): `merged` is built ENTIRELY
        // before `items`/`sharedItemIds` are touched -- compute-then-swap.
        // The previous shape removed last cycle's shared rows FIRST, then
        // returned empty-handed from the `catch` (or any of the
        // `guard userKey != nil` early exits) below, so a transient failure
        // AFTER the direct-share fetch already succeeded (e.g.
        // `listCollections()`) dropped every direct share too -- nothing
        // appended, nothing retained, and no error surfaced anywhere
        // (`Self.log.error` is `privacy: .private`-only). `items` now keeps
        // last cycle's shared rows on any failure, and `lastError` is set so
        // `SyncStatusView` shows the user something actually failed.
        var merged: [VaultItemViewModel] = []
        var armFailed = false
        let identityKey: FfiIdentityKey
        do {
            identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: uk)
        } catch {
            Self.log.error("identity keypair fetch failed: \(String(describing: error), privacy: .private)")
            lastError = "Couldn't refresh items shared with you."
            return
        }

        // Post-await lock re-check (CR-02/CR-03 discipline, this file's own
        // established shape) -- a lock landing during any of the round
        // trips below must never resurrect decrypted content after the
        // vault explicitly locked.
        guard userKey != nil else { return }

        // WR-16: the direct-share arm settles INDEPENDENTLY of the
        // family-wide-collection arm below -- a failure in `listCollections()`
        // or one collection's own fetch must not discard direct shares that
        // already succeeded (and vice versa is not possible: the collection
        // arm runs after and does not depend on this one's outcome).
        do {
            let directResult = try await SharedItemsStore.fetchDirectShared(
                baseURL: api.baseURL, tokenProvider: api.tokenProvider, since: 0, session: api.session
            )
            guard userKey != nil else { return }
            if case let .snapshot(_, directRows) = directResult {
                merged.append(contentsOf: SharedItemsStore.ingestDirectShared(rows: directRows, identityKey: identityKey))
            }
        } catch {
            Self.log.error("direct-shared fetch failed: \(String(describing: error), privacy: .private)")
            armFailed = true
        }

        do {
            // WR-17 (40-REVIEW.md, iteration 2): `GET /api/families/
            // family-wide-pending` is `ActiveFamilyMembership<RequireRead>`-
            // gated (same fact `SyncCoordinator`'s own `hasNoFamily` cache
            // already relies on) -- a 404/403 here is the authoritative "not
            // a member of any family" signal, never a genuine failure. WR-10
            // originally swallowed this via `try?` so a real failure could
            // never abort the rest of the merge; that discipline is
            // preserved below (a NON-404/403 error still falls through
            // without setting `hasNoFamily` or skipping anything), but the
            // 404/403 case now ALSO latches `hasNoFamily` for the rest of
            // this session -- before this, EVERY 30-second pull re-issued
            // this call, `GET /api/vault/collections` (also family-gated,
            // see below), `GET /api/sync/shared/direct`, and
            // `ensureOwnIdentityKeypair` (which durably PUBLISHES an
            // identity keypair on first call, a server-visible side effect
            // for an account that has never touched a family feature) --
            // forever, for this product's primary solo-self-hoster persona.
            var skipCollectionsThisCycle = false
            do {
                let pending = try await SharedItemsStore.fetchFamilyWidePending(
                    baseURL: api.baseURL, tokenProvider: api.tokenProvider, session: api.session
                )
                pendingKeyState.applyFamilyWidePending(missing: pending.missing)
                // A collection in `missing` has NO `collection_keys` row
                // for this caller yet, so `GET /api/vault/collections`
                // below never returns it -- there is no real item set to
                // enumerate. `Content.pendingFamilyKey` (`ItemFields.swift`)
                // already exists, is already rendered by `ItemDetailView
                // .pendingFamilyKeyPanel()`, and had no producer anywhere
                // in production before this: one synthetic row per pending
                // collection is what makes it reachable.
                for grant in pending.missing {
                    merged.append(
                        VaultItemViewModel(
                            id: "pending-collection-\(grant.collection_id)",
                            revision: 0,
                            content: .pendingFamilyKey,
                            collectionId: grant.collection_id,
                            sharedToMe: false,
                            accessLevel: grant.access_level,
                            isFamilyWide: true
                        )
                    )
                }
            } catch {
                if case let PvApiError.httpError(status, _) = error, status == 404 || status == 403 {
                    hasNoFamily = true
                    skipCollectionsThisCycle = true
                }
                // Any other error: WR-10's original best-effort discipline
                // -- never abort the direct-share/family-wide merge above
                // or below over a transient failure on this one endpoint.
            }
            guard userKey != nil else { return }

            // Family-wide collections: enumerate what this account already
            // holds a key for, unseal each Collection Key once, and pull
            // every item in it via the collection-scoped sync endpoint
            // (any author) -- NOT `/api/sync`, whose collection arm is
            // author-scoped (`ingestPersonalSync`'s own header; the exact
            // bug `RemoveMemberService.fetchCollectionItemRows` already
            // documents for the re-key batch). Also `FamilyMembership
            // <RequireRead>`-gated server-side (`collections.rs::list`) --
            // skipped this cycle if `hasNoFamily` was JUST latched above,
            // since it would 404 identically.
            let collections = skipCollectionsThisCycle ? [] : try await collectionService.listCollections()
            guard userKey != nil else { return }
            for record in collections {
                guard record.familyWideKind != nil, let sealedKey = record.sealedKey else { continue }
                do {
                    let ck = try unsealCollectionKey(myIdentityKey: identityKey, sealedJson: sealedKey)
                    let rows = try await SharedItemsStore.fetchCollectionSyncRows(
                        collectionId: record.id, baseURL: api.baseURL, tokenProvider: api.tokenProvider, session: api.session
                    )
                    guard userKey != nil else { return }
                    let collectionItems = SharedItemsStore.ingestFamilyWideCollectionItems(
                        rows: rows, collectionId: record.id, collectionKey: ck,
                        accessLevel: Self.resolveOwnCollectionAccessLevel(record: record)
                    )
                    // WR-10: a row that failed to decrypt with a key we DO
                    // hold is the genuine integrity signal `PendingKeyState
                    // .decryptFailed` exists for -- distinct from
                    // `.awaitingKey`, which `applyFamilyWidePending` above
                    // already owns.
                    if let firstFailure = collectionItems.first(where: \.isUndecryptable),
                       case let .undecryptable(reason) = firstFailure.content {
                        pendingKeyState.markDecryptFailed(collectionId: record.id, reason: reason)
                    }
                    merged.append(contentsOf: collectionItems)
                } catch {
                    Self.log.error(
                        "family-wide collection \(record.id, privacy: .public) merge failed: \(String(describing: error), privacy: .private)"
                    )
                }
            }
        } catch {
            Self.log.error("shared-item merge failed: \(String(describing: error), privacy: .private)")
            // WR-16: does NOT `return` here -- `merged` may already carry a
            // successful direct-share arm (above), and that must still be
            // applied. `armFailed` drives the `lastError` surface below.
            armFailed = true
        }

        guard userKey != nil else { return }
        let result = Self.applyMergedSharedItems(
            existingItems: items, merged: merged, previousSharedItemIds: sharedItemIds, armFailed: armFailed
        )
        items = result.items
        sharedItemIds = result.sharedItemIds
        if let mergeError = result.lastError {
            lastError = mergeError
        }
        recomputeTags()
    }

    /// CR-07 (40-REVIEW.md, iteration 2): pulled out for direct
    /// unit-testability (`VaultStoreMergeTests.swift`) -- the caller's OWN
    /// held access level for a family-wide collection is
    /// `record.accessLevel` (`ck.access_level` for THIS caller, returned by
    /// `GET /api/vault/collections`; hard-coded `edit` for the creator's
    /// row by `collections::create` regardless of the collection's
    /// propagation level), NEVER `record.familyWideAccessLevel` (what a NEW
    /// recipient is granted when the collection is shared onward --
    /// `ResealService`'s own documented fallback discipline, which is about
    /// an OUTBOUND grant, not a statement about what level the caller
    /// already holds). Stamping the propagation level here made the
    /// creator of a `read`-propagation collection lose Edit (and, at
    /// `hidden_password`, lose sight of their own password) on their own
    /// items. The `?? familyWideAccessLevel ?? "read"` fallback chain is
    /// defense in depth for a decode shape the server does not currently
    /// produce for a collection this account already holds a key for --
    /// never the intended path.
    static func resolveOwnCollectionAccessLevel(record: CollectionRecord) -> String {
        record.accessLevel ?? record.familyWideAccessLevel ?? "read"
    }

    /// WR-23 (40-REVIEW.md, iteration 2): pulled out for direct
    /// unit-testability (`SyncStatusViewCoverageTests.swift`) --
    /// `SyncStatusView.hasUncachedSharedItems`'s own doc comment explains
    /// WHY these two flags are the ones this store's cache never covers
    /// (`persistSnapshotToCache` is called with the PERSONAL `/api/sync`
    /// rows only, before this store's own merge runs).
    static func hasAnySharedOrFamilyWideItem(_ items: [VaultItemViewModel]) -> Bool {
        items.contains { $0.sharedToMe == true || $0.isFamilyWide }
    }

    /// CR-06/WR-16 (40-REVIEW.md, iteration 2): the compute-then-swap
    /// application step, extracted as a pure, `static` function so it is
    /// directly unit-testable without a live server (`VaultStoreMergeTests
    /// .swift`) -- `mergeSharedAndFamilyWideItems` above is the only
    /// caller.
    ///
    /// `GET /api/vault/collections/{id}/sync` is scoped by `collection_id`
    /// ALONE, with no author filter (`crates/pv-server/src/routes/
    /// sync.rs`) -- it returns the caller's OWN rows inside a family-wide
    /// collection too, which the personal `/api/sync` pull already put in
    /// `existingItems`. `previousSharedItemIds` only tracks LAST cycle's
    /// merged ids, so the very first refresh after every unlock (and any
    /// refresh where a newly-authored own item has not yet been through
    /// one merge cycle) appended a second, duplicate-id copy -- undefined
    /// behaviour for the `ForEach(sectionRows)` this feeds
    /// (`ItemListView.swift`). Dedupe by id at this boundary: the
    /// merged/provenance-bearing row wins (it carries the correct
    /// `sharedToMe`/`isFamilyWide`/`accessLevel`, see CR-07), and the
    /// removal covers BOTH this cycle's incoming ids and last cycle's, so a
    /// personal row that is no longer part of `merged` (e.g. the
    /// collection lost its family-wide kind) is not resurrected either --
    /// this is the `!armFailed` branch.
    ///
    /// When `armFailed` is `true`, one arm of the merge (direct-share
    /// fetch, identity keypair, family-wide-pending, `listCollections()`,
    /// or one collection's own fetch/decrypt) failed this cycle, so
    /// `merged` reflects only whichever arm(s) DID succeed. Do not replace
    /// `previousSharedItemIds` wholesale in that case: that would prune
    /// last cycle's rows from the arm that failed THIS cycle, even though
    /// nothing this cycle confirmed they should disappear. Only the ids
    /// this cycle actually produced are deduped/refreshed; everything else
    /// from last cycle is left exactly as it was, and `lastError` is set so
    /// the failure is surfaced instead of silently dropping items.
    static func applyMergedSharedItems(
        existingItems: [VaultItemViewModel],
        merged: [VaultItemViewModel],
        previousSharedItemIds: Set<String>,
        armFailed: Bool
    ) -> (items: [VaultItemViewModel], sharedItemIds: Set<String>, lastError: String?) {
        let mergedIds = Set(merged.map(\.id))
        var items = existingItems
        let sharedItemIds: Set<String>
        let lastError: String?
        if armFailed {
            items.removeAll { mergedIds.contains($0.id) }
            sharedItemIds = previousSharedItemIds.union(mergedIds)
            items.append(contentsOf: merged)
            lastError = "Couldn't refresh items shared with you."
        } else {
            items.removeAll { mergedIds.contains($0.id) || previousSharedItemIds.contains($0.id) }
            sharedItemIds = mergedIds
            items.append(contentsOf: merged)
            lastError = nil
        }
        return (items, sharedItemIds, lastError)
    }

    /// DR-39-A: one JSON blob, written whole and replaced whole. Failure is
    /// logged, never thrown -- the server write (nothing happens here) and
    /// the in-memory `items` array are already correct at this point in
    /// `refresh()`; a cache-persistence failure must not be reported to the
    /// caller as a failed sync.
    ///
    /// CR-01 (39-REVIEW.md, iteration 2): routed through the shared
    /// `writeSnapshot(_:context:)` helper -- this branch used to assign
    /// `currentSnapshot = snapshot` BEFORE attempting the write and only log
    /// on failure, so `SyncStatusView` (which renders from the in-memory
    /// mirror) kept claiming "Last synced n seconds ago" after a
    /// `containerUnavailable`/`writeFailed` error even though nothing
    /// reached the App Group container. `writeSnapshot` only advances
    /// `currentSnapshot` after a successful write and records `lastError`
    /// on failure, matching the up-to-date branch's already-correct
    /// behaviour (WR-03, iteration 1).
    private func persistSnapshotToCache(revision: Int, items rows: [VaultItemRow], folders folderRows: [FolderRow]) {
        let snapshot = CachedSnapshot(
            revision: revision,
            Int64(Date().timeIntervalSince1970 * 1000), // syncedAtMs, positional (CachedSnapshot.init's own note)
            accountId: accountId,
            serverBaseURL: api.baseURL.absoluteString,
            items: rows.map(CachedSnapshot.Item.init(row:)),
            folders: folderRows.map(CachedSnapshot.Folder.init(row:))
        )
        writeSnapshot(snapshot, context: "snapshot")
    }

    /// Plan 39-06 (SYNC-04, T-39-23). The up-to-date branch structurally
    /// carries no item collection (D-12) -- 39-03 only needed the snapshot
    /// branch's write. This re-persists whatever items/folders are ALREADY
    /// cached under an updated `revision`/`syncedAtMs`, because an up-to-date
    /// answer is JUST as much a confirmed pull as a snapshot answer is --
    /// both response branches confirm the revision with the server; a
    /// thrown request writes nothing (see `refresh()`'s own note above).
    ///
    /// CR-02 (39-REVIEW.md, iteration 1): the items re-persisted here are
    /// read FRESH FROM DISK (`cacheStore.readCurrentSnapshot`) -- the exact
    /// same call, on the exact same source, `SyncClient.pull()` used to read
    /// the `since` watermark this response confirms (D-11: one watermark,
    /// one copy). The pre-fix version re-derived this collection from
    /// `self.items`/`currentSnapshot` -- this STORE INSTANCE's own
    /// in-memory mirror -- which is a SECOND, independent source for the
    /// same invariant: any divergence between it and the on-disk blob (a
    /// second live `VaultStore` over the same App Group file, or a
    /// `readCurrentSnapshot` that failed transiently at `init` but
    /// succeeded inside `pull()`) turned "the server says you are up to
    /// date" into "erase the cache and keep the advanced revision" --
    /// permanently, because the next pull reads that same advanced revision
    /// back off disk and the server answers up-to-date again. Reading the
    /// disk snapshot here closes that gap: this function can now only ever
    /// re-persist what is ALREADY on disk, never something a divergent
    /// in-memory mirror invented.
    ///
    /// If nothing has ever been cached, this still records the pull -- with
    /// an EMPTY item set, which is exactly what the server confirmed exists
    /// -- rather than leaving the freshness value permanently absent for an
    /// account that has, in fact, synced. This is reachable on a brand-new
    /// account's very first pull: `since=0` already equals a fresh
    /// account's `revision=0`, so the FIRST response a new account ever
    /// sees can be up-to-date, never a snapshot. A non-zero revision with
    /// nothing on disk is refused outright -- that combination means the
    /// server thinks this account is already past revision 0 while this
    /// device has never persisted anything for it, which is not a state
    /// this function can honestly reconcile by fabricating an empty cache
    /// at a non-zero watermark.
    private func persistUpToDateToCache(revision: Int) {
        guard let existing = cacheStore.readCurrentSnapshot(accountId: accountId, serverBaseURL: api.baseURL.absoluteString) else {
            guard revision == 0 else {
                Self.log.error(
                    "refusing to persist up-to-date revision \(revision) with no existing on-disk snapshot for this account"
                )
                return
            }
            let snapshot = CachedSnapshot(
                revision: revision,
                Int64(Date().timeIntervalSince1970 * 1000), // syncedAtMs, positional (CachedSnapshot.init's own note)
                accountId: accountId,
                serverBaseURL: api.baseURL.absoluteString,
                items: [],
                folders: []
            )
            writeSnapshot(snapshot, context: "up-to-date, first pull")
            return
        }
        // CR-03 (39-REVIEW.md): never regress the on-disk watermark -- a
        // slower, superseded response landing after a faster/newer one must
        // not overwrite it.
        guard revision >= existing.revision else {
            Self.log.error(
                "discarding out-of-order up-to-date response (\(revision) < on-disk revision \(existing.revision))"
            )
            return
        }
        let snapshot = CachedSnapshot(
            revision: revision,
            Int64(Date().timeIntervalSince1970 * 1000), // syncedAtMs, positional (CachedSnapshot.init's own note)
            accountId: accountId,
            serverBaseURL: api.baseURL.absoluteString,
            items: existing.items,
            folders: existing.folders
        )
        writeSnapshot(snapshot, context: "up-to-date")
    }

    /// Shared write helper for both persist paths above. `context` is only
    /// ever used for the error log line -- never a behavioural switch.
    ///
    /// WR-03 (39-REVIEW.md): `currentSnapshot` is assigned ONLY after a
    /// successful write, never before attempting it. The pre-fix version set
    /// `currentSnapshot = snapshot` unconditionally, then only logged on
    /// failure -- so after a `containerUnavailable`/`writeFailed` error,
    /// `SyncStatusView` (which renders from `store.currentSnapshot`, the
    /// in-memory mirror) kept showing "Last synced n seconds ago" while
    /// NOTHING was actually persisted, and the AutoFill extension (which
    /// reads the file) would show a stale or absent time -- the in-memory
    /// mirror silently described memory instead of disk. `lastError` now
    /// records the failure so a future caller can surface it.
    private func writeSnapshot(_ snapshot: CachedSnapshot, context: String) {
        do {
            try cacheStore.write(snapshot)
            currentSnapshot = snapshot
        } catch {
            Self.log.error(
                "failed to persist sync cache (\(context, privacy: .public)): \(String(describing: error), privacy: .public)"
            )
            lastError = "Synced, but this device could not save its offline copy."
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
