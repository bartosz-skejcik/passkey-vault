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

import Foundation
import Observation
import os

@MainActor
@Observable
final class VaultStore {
    /// The decrypted (or explicitly undecryptable) rows, newest server
    /// snapshot wins. Observed -- this is what the list renders.
    private(set) var items: [VaultItemViewModel] = []

    /// Last `vault_revision` merged; the `since` watermark for the next pull.
    private(set) var lastKnownRevision: Int = 0

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

    /// NOT observed (T-38-02-03). `@ObservationIgnored` keeps the unlocked
    /// User Key handle out of the observation graph entirely, so it cannot be
    /// read by a SwiftUI dependency trace or rendered into a synthesized
    /// debug description of this object.
    @ObservationIgnored private let userKey: FfiUserKey
    @ObservationIgnored private let api: VaultAPI
    @ObservationIgnored private static let log = Logger(
        subsystem: "cloud.blonie.PasskeyVault", category: "vault"
    )

    init(userKey: FfiUserKey, api: VaultAPI) {
        self.userKey = userKey
        self.api = api
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
        let id = Self.mintItemId()
        let plaintext = try ItemNormalize.plaintextJSON(for: fields)

        let wire = try encryptItemWire(
            userKey: userKey, plaintext: plaintext, itemId: id, revision: 1
        )
        _ = try await api.createItem(
            id: id, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson
        )

        let item = VaultItemViewModel(id: id, revision: 1, content: .fields(fields))
        // Post-commit bookkeeping: the server write has already been
        // accepted, so a local failure here must never be reported as a
        // failed creation (the web client's `createVaultItem` carries the
        // same discipline for the same reason -- a retry into duplicate
        // rows).
        items.append(item)
        recomputeTags()
        return item
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

    // MARK: - Refresh

    /// `GET /api/sync?since=<watermark>` and merge.
    ///
    /// The up-to-date branch (no `items` key at all) is a normal outcome, not
    /// an error: the server returns it on every pull where nothing changed.
    func refresh() async throws {
        #if DEBUG
        if ProcessInfo.processInfo.environment[Self.uitestCapabilityFixtureEnvKey] != nil {
            applyCapabilityGatingFixture()
            return
        }
        #endif
        let response = try await api.sync(since: lastKnownRevision)
        switch response {
        case let .upToDate(revision):
            lastKnownRevision = revision
        case let .snapshot(revision, rows, _):
            items = rows.map(decrypt(row:))
            lastKnownRevision = revision
        }
        recomputeTags()
    }

    #if DEBUG
    /// TEST-ONLY (plan 38-06, Task 2): when set, `refresh()` short-circuits
    /// to a synthetic two-item fixture instead of calling the real network.
    /// This is the ONLY way to screenshot the "a shared row hides Edit"
    /// acceptance criterion honestly: `VaultItemRow`/`SyncResponse` do not
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
    private func decrypt(row: VaultItemRow) -> VaultItemViewModel {
        do {
            let plaintext = try decryptItemWire(
                userKey: userKey,
                encKeyJson: row.enc_key,
                encDataJson: row.enc_data,
                itemId: row.id,
                revision: UInt32(row.revision)
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
