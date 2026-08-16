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
        let id = Self.mintItemId()
        let fields = NoteFields(name: name, body: body)
        let plaintext = try Self.plaintextJSON(for: fields)

        let wire = try encryptItemWire(
            userKey: userKey, plaintext: plaintext, itemId: id, revision: 1
        )
        _ = try await api.createItem(
            id: id, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson
        )

        let item = VaultItemViewModel(id: id, revision: 1, content: .note(fields))
        // Post-commit bookkeeping: the server write has already been
        // accepted, so a local failure here must never be reported as a
        // failed creation (the web client's `createVaultItem` carries the
        // same discipline for the same reason -- a retry into duplicate
        // rows).
        items.append(item)
        return item
    }

    // MARK: - Refresh

    /// `GET /api/sync?since=<watermark>` and merge.
    ///
    /// The up-to-date branch (no `items` key at all) is a normal outcome, not
    /// an error: the server returns it on every pull where nothing changed.
    func refresh() async throws {
        let response = try await api.sync(since: lastKnownRevision)
        switch response {
        case let .upToDate(revision):
            lastKnownRevision = revision
        case let .snapshot(revision, rows, _):
            items = rows.map(decrypt(row:))
            lastKnownRevision = revision
        }
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
            let fields = try JSONDecoder().decode(NoteFields.self, from: Data(plaintext.utf8))
            return VaultItemViewModel(id: row.id, revision: row.revision, content: .note(fields))
        } catch {
            // Logged with the row id and the error only. Never the
            // ciphertext, never any key material.
            Self.log.error(
                "row \(row.id, privacy: .public) failed to decrypt: \(String(describing: error), privacy: .public)"
            )
            return VaultItemViewModel(
                id: row.id,
                revision: row.revision,
                content: .undecryptable(reason: String(describing: error))
            )
        }
    }

    // MARK: - Plaintext encoding

    /// Encodes the field struct to the plaintext JSON that gets encrypted.
    ///
    /// This `JSONEncoder` is safe and is NOT the DR-38-C hazard: it encodes
    /// the PLAINTEXT payload, whose members are `String`/`[String]` only.
    /// `NoteFields` deliberately contains no `Data`-typed property, so
    /// Foundation's base64 default has nothing to apply itself to. The wire
    /// envelope -- the thing that CAN be base64'd wrongly -- is built
    /// exclusively by `pv-ffi`'s `serde_json`, one layer down.
    private static func plaintextJSON(for fields: NoteFields) throws -> String {
        let encoder = JSONEncoder()
        let data = try encoder.encode(fields)
        guard let json = String(data: data, encoding: .utf8) else {
            throw PvApiError.unexpectedResponse("plaintext JSON was not UTF-8")
        }
        return json
    }
}
