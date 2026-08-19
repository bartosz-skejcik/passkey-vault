//
//  SharedItemsStore.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-05, Task 1/2.
//  The SINGLE ingestion point for shared rows -- two ingest functions, one
//  per source, and `ShareMarkerInput.sharedToMe`/`.isFamilyWide` are set by
//  WHICH FUNCTION WAS CALLED, never recomputed from a row's own
//  `isShared`/`collectionId`. See `ShareMarker.swift`'s header for the
//  shipped-and-fixed bug (CR-02) this discipline exists to prevent, and for
//  why a future reader must not "simplify" the two functions below into
//  one that infers the flag from field contents.
//
//  `ingestDirectShared` -- `GET /api/sync/shared/direct`
//  (`pull_shared_direct`): every row is, by construction, an item owned by
//  SOMEONE ELSE and shared directly to this caller. `sharedToMe` is `true`
//  UNCONDITIONALLY here, never read off the row. Mirrors
//  `web/src/lib/vault/store.ts`'s `decryptDirectSharedRow` (unseal
//  `row.sealed_key` under the caller's own identity keypair, then
//  `decryptItemWithSharedKey` -- never `decryptItemWire`, this recipient
//  holds neither the owner's User Key nor a covering Collection Key).
//
//  `ingestPersonalSync` -- the caller's OWN `GET /api/sync` snapshot
//  (`fetch_items_for`'s two arms: personal rows, `collection_id IS NULL`,
//  and the caller's OWN rows inside a collection they are a member of).
//  `sharedToMe` is `false` UNCONDITIONALLY here -- every row this function
//  sees is something the caller owns outright, never something shared TO
//  them (that is `ingestDirectShared`'s job). `isFamilyWide` is resolved
//  from a caller-supplied `familyWideCollectionIds` lookup (mirrors
//  `web/src/lib/vault/collections.ts`'s `isFamilyWideCollection`, which
//  checks a locally cached collections store the same way) -- NEVER from
//  `isShared` alone, which says nothing about family-wide-ness.
//
//  Both functions NEVER throw and NEVER abort the loop over the rest of
//  the rows on one row's decrypt failure -- same T-38-02-02 discipline
//  `VaultStore.decrypt(row:)` already established; a bad row becomes an
//  `.undecryptable` `VaultItemViewModel`, marked with the SAME provenance
//  facts (`sharedToMe`/`isFamilyWide`) it would have carried had it
//  decrypted successfully, so a decrypt failure never masks which
//  ingestion path produced the row.
//

import Foundation

/// One row of `GET /api/sync/shared/direct`'s snapshot arm, exactly as
/// `crates/pv-server/src/routes/sync.rs`'s `DirectSharedItem` serializes
/// it. Deliberately a SEPARATE type from `VaultItemRow`
/// (`Sync/SyncModels.swift`) -- this shape carries the RECIPIENT's own
/// `sealed_key` and omits `enc_key` entirely (the owner's `enc_key` is
/// structurally useless to a recipient who holds neither the owner's User
/// Key nor a covering Collection Key).
struct DirectSharedItemRow: Decodable {
    let id: String
    /// Opaque. See `VaultAPI.swift`'s header (DR-38-C) -- same discipline
    /// applies to this file.
    let enc_data: String
    /// Opaque. The item's own Cipher Key, sealed client-side to THIS
    /// recipient's own published identity public key
    /// (`seal_item_key_for_recipient`).
    let sealed_key: String
    let revision: Int
    let updated_at: String
    let last_used_at: String?
    let is_shared: Bool
    let last_editor_email: String?
    let access_level: String
}

/// The single ingestion point for shared rows (this file's header). Stateless
/// -- unlike `VaultStore`/`FolderStore`, this type holds no key handle and no
/// mutable state of its own; every ingest call is a pure function of its
/// arguments, decrypting through the SAME `pv-ffi` entry points
/// `VaultStore`/`FfiSharingTests` already use.
enum SharedItemsStore {

    // MARK: - `GET /api/sync/shared/direct`

    /// Ingests every row of a direct-shared snapshot. `sharedToMe` is `true`
    /// on EVERY resulting item, by construction -- see this file's header.
    static func ingestDirectShared(
        rows: [DirectSharedItemRow],
        identityKey: FfiIdentityKey
    ) -> [VaultItemViewModel] {
        rows.map { decryptDirectSharedRow($0, identityKey: identityKey) }
    }

    private static func decryptDirectSharedRow(
        _ row: DirectSharedItemRow,
        identityKey: FfiIdentityKey
    ) -> VaultItemViewModel {
        guard let revision32 = UInt32(exactly: row.revision) else {
            return VaultItemViewModel(
                id: row.id, revision: row.revision,
                content: .undecryptable(reason: "server returned an out-of-range revision"),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: nil, sharedToMe: true, accessLevel: row.access_level,
                isFamilyWide: false
            )
        }
        do {
            let ck = try unsealCollectionKey(myIdentityKey: identityKey, sealedJson: row.sealed_key)
            let plaintext = try decryptItemWithSharedKey(
                ck: ck, encDataJson: row.enc_data, itemId: row.id, revision: revision32
            )
            let fields = try ItemNormalize.normalizeItemFields(fromPlaintext: plaintext)
            return VaultItemViewModel(
                id: row.id, revision: row.revision, content: .fields(fields),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: nil, sharedToMe: true, accessLevel: row.access_level,
                isFamilyWide: false
            )
        } catch {
            return VaultItemViewModel(
                id: row.id, revision: row.revision,
                content: .undecryptable(reason: String(describing: error)),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: nil, sharedToMe: true, accessLevel: row.access_level,
                isFamilyWide: false
            )
        }
    }

    // MARK: - The caller's own `GET /api/sync` snapshot

    /// Ingests every row of the caller's OWN personal sync snapshot.
    /// `sharedToMe` is `false` on EVERY resulting item -- see this file's
    /// header. `familyWideCollectionIds` is the caller-supplied set of
    /// collection ids known (from `CollectionService`/`GET
    /// /api/vault/collections/{id}`) to carry a non-nil `family_wide_kind`;
    /// a row whose `collection_id` is a member of that set resolves
    /// `isFamilyWide: true`, independent of `is_shared`.
    static func ingestPersonalSync(
        rows: [VaultItemRow],
        familyWideCollectionIds: Set<String>,
        userKey: FfiUserKey
    ) -> [VaultItemViewModel] {
        rows.map {
            decryptPersonalSyncRow($0, familyWideCollectionIds: familyWideCollectionIds, userKey: userKey)
        }
    }

    private static func decryptPersonalSyncRow(
        _ row: VaultItemRow,
        familyWideCollectionIds: Set<String>,
        userKey: FfiUserKey
    ) -> VaultItemViewModel {
        let isFamilyWide = row.collection_id.map { familyWideCollectionIds.contains($0) } ?? false
        guard let revision32 = UInt32(exactly: row.revision) else {
            return VaultItemViewModel(
                id: row.id, revision: row.revision,
                content: .undecryptable(reason: "server returned an out-of-range revision"),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id, sharedToMe: false, accessLevel: nil,
                isFamilyWide: isFamilyWide
            )
        }
        do {
            let plaintext = try decryptItemWire(
                userKey: userKey, encKeyJson: row.enc_key, encDataJson: row.enc_data,
                itemId: row.id, revision: revision32
            )
            let fields = try ItemNormalize.normalizeItemFields(fromPlaintext: plaintext)
            return VaultItemViewModel(
                id: row.id, revision: row.revision, content: .fields(fields),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id, sharedToMe: false, accessLevel: nil,
                isFamilyWide: isFamilyWide
            )
        } catch {
            return VaultItemViewModel(
                id: row.id, revision: row.revision,
                content: .undecryptable(reason: String(describing: error)),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: row.collection_id, sharedToMe: false, accessLevel: nil,
                isFamilyWide: isFamilyWide
            )
        }
    }

    // MARK: - `GET /api/vault/collections/{id}/sync` -- ANY author, CR-04

    /// Ingests every row of ONE family-wide collection's full item set --
    /// `GET /api/vault/collections/{id}/sync` (`pull_shared_collection`),
    /// which is scoped by `collection_id` ALONE, unlike `/api/sync`'s
    /// collection arm (`ingestPersonalSync`, above), which additionally
    /// binds `i.user_id = caller` and therefore never surfaces an item
    /// another member authored inside a collection the caller shares with
    /// them -- the exact bug `RemoveMemberService.fetchCollectionItemRows`'s
    /// own header documents (there, for the re-key batch; here, for the
    /// vault list itself). `sharedToMe` is `false` on every resulting item
    /// (a family-wide share is not a direct share -- `ShareMarker`'s own
    /// ordering depends on the two staying distinct); `isFamilyWide` is
    /// `true` unconditionally, since every row here came from a collection
    /// this function's caller has already confirmed carries a non-nil
    /// `family_wide_kind`.
    ///
    /// Decrypts via `decryptItemForCollection` (the Collection Key), NEVER
    /// `decryptItemWire` (the caller's own User Key) -- an item authored by
    /// someone else in this collection was never wrapped under this
    /// caller's User Key at all; only the Collection Key recovers it.
    static func ingestFamilyWideCollectionItems(
        rows: [VaultItemRow],
        collectionId: String,
        collectionKey: FfiCollectionKey,
        accessLevel: String?
    ) -> [VaultItemViewModel] {
        rows.map {
            decryptFamilyWideCollectionRow(
                $0, collectionId: collectionId, collectionKey: collectionKey, accessLevel: accessLevel
            )
        }
    }

    private static func decryptFamilyWideCollectionRow(
        _ row: VaultItemRow, collectionId: String, collectionKey: FfiCollectionKey, accessLevel: String?
    ) -> VaultItemViewModel {
        guard let revision32 = UInt32(exactly: row.revision) else {
            return VaultItemViewModel(
                id: row.id, revision: row.revision,
                content: .undecryptable(reason: "server returned an out-of-range revision"),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: collectionId, sharedToMe: false, accessLevel: accessLevel,
                isFamilyWide: true
            )
        }
        do {
            let combinedJson = try combineEncryptedItemJson(encKeyJson: row.enc_key, encDataJson: row.enc_data)
            let plaintext = try decryptItemForCollection(
                ck: collectionKey, itemJson: combinedJson, collectionId: collectionId,
                itemId: row.id, revision: revision32
            )
            let fields = try ItemNormalize.normalizeItemFields(fromPlaintext: plaintext)
            return VaultItemViewModel(
                id: row.id, revision: row.revision, content: .fields(fields),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: collectionId, sharedToMe: false, accessLevel: accessLevel,
                isFamilyWide: true
            )
        } catch {
            return VaultItemViewModel(
                id: row.id, revision: row.revision,
                content: .undecryptable(reason: String(describing: error)),
                updatedAt: row.updated_at, lastUsedAt: row.last_used_at,
                isShared: row.is_shared, lastEditorEmail: row.last_editor_email,
                collectionId: collectionId, sharedToMe: false, accessLevel: accessLevel,
                isFamilyWide: true
            )
        }
    }

    /// `enc_key`/`enc_data`, as returned split by every `VaultItemRow`-shaped
    /// endpoint, recombined into the single JSON object
    /// `decryptItemForCollection`/`encryptItemForCollection` expect
    /// (`{"enc_key": ..., "enc_data": ...}`) -- the same technique
    /// `ResealTriggerTests.combinedEncryptedItemJson` already proves live,
    /// ported into production for this call site.
    private static func combineEncryptedItemJson(encKeyJson: String, encDataJson: String) throws -> String {
        guard
            let encKeyData = encKeyJson.data(using: .utf8),
            let encDataData = encDataJson.data(using: .utf8),
            let encKeyObj = try? JSONSerialization.jsonObject(with: encKeyData),
            let encDataObj = try? JSONSerialization.jsonObject(with: encDataData)
        else {
            throw PvApiError.unexpectedResponse("malformed EncryptedItem JSON for enc_key/enc_data")
        }
        let combined = try JSONSerialization.data(withJSONObject: ["enc_key": encKeyObj, "enc_data": encDataObj])
        return String(decoding: combined, as: UTF8.self)
    }

    /// `GET /api/vault/collections/{id}/sync` -- no `since` query param
    /// (`OptionalSyncQuery`'s contract: an absent `since` is ALWAYS a
    /// full-snapshot request), same discipline
    /// `RemoveMemberService.fetchCollectionItemRows` already established
    /// for this identical endpoint. Snapshot-shape-first decode (L-22): the
    /// up-to-date shape has no `items` key on the wire at all, so this
    /// probes for it rather than risking an optional-with-default silently
    /// producing an empty list on any decode.
    static func fetchCollectionSyncRows(
        collectionId: String,
        baseURL: URL,
        tokenProvider: () -> String?,
        session: URLSession = .shared
    ) async throws -> [VaultItemRow] {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/vault/collections/\(collectionId)/sync")
        }
        guard let url = URL(string: "/api/vault/collections/\(collectionId)/sync", relativeTo: baseURL) else {
            throw PvApiError.unexpectedResponse(
                "could not construct URL for /api/vault/collections/\(collectionId)/sync against \(baseURL)"
            )
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PvApiError.network(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PvApiError.unexpectedResponse("response was not an HTTP response")
        }
        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 { throw PvApiError.invalidCredentials }
            let message = String(data: data, encoding: .utf8)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw PvApiError.httpError(status: httpResponse.statusCode, message: message)
        }
        struct SnapshotBody: Decodable { let revision: Int; let items: [VaultItemRow] }
        struct UpToDateBody: Decodable { let revision: Int }
        struct ProbeBody: Decodable { let items: [VaultItemRow]? }

        let probe: ProbeBody
        do {
            probe = try JSONDecoder().decode(ProbeBody.self, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode /api/vault/collections/\(collectionId)/sync response: \(error)")
        }
        guard probe.items != nil else {
            _ = try? JSONDecoder().decode(UpToDateBody.self, from: data)
            return []
        }
        do {
            let snapshot = try JSONDecoder().decode(SnapshotBody.self, from: data)
            return snapshot.items
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode /api/vault/collections/\(collectionId)/sync snapshot: \(error)")
        }
    }

    // MARK: - `GET /api/sync/shared/direct`

    /// The two-shape response `pull_shared_direct` returns -- same
    /// untagged `UpToDate`/`Snapshot` convention `Sync/SyncModels.swift`'s
    /// `SyncPullResult` already established for `GET /api/sync`.
    enum DirectSharedFetchResult {
        case upToDate(revision: Int)
        case snapshot(revision: Int, items: [DirectSharedItemRow])
    }

    private struct DirectSharedSnapshotBody: Decodable {
        let revision: Int
        let items: [DirectSharedItemRow]
    }

    private struct DirectSharedUpToDateBody: Decodable {
        let revision: Int
    }

    /// WR-02: a shape-discrimination probe, decoded FIRST -- `items` is
    /// `Optional` here (unlike `DirectSharedSnapshotBody.items`, which is
    /// non-optional and therefore throws on a malformed row), so this
    /// probe can succeed even on a partially-malformed snapshot payload and
    /// still correctly report "this IS a snapshot, not an up-to-date
    /// response" via `items != nil`.
    private struct DirectSharedProbeBody: Decodable {
        let items: [DirectSharedItemRow]?
    }

    /// `GET /api/sync/shared/direct?since=N`. Decode ATTEMPTS the snapshot
    /// shape first, same discipline as `SyncPullResult`'s own decoder (L-22)
    /// -- the up-to-date branch carries no `items` key on the wire at all.
    static func fetchDirectShared(
        baseURL: URL,
        tokenProvider: () -> String?,
        since: Int,
        session: URLSession = .shared
    ) async throws -> DirectSharedFetchResult {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/sync/shared/direct")
        }
        guard let url = URL(string: "/api/sync/shared/direct?since=\(since)", relativeTo: baseURL) else {
            throw PvApiError.unexpectedResponse(
                "could not construct URL for /api/sync/shared/direct against \(baseURL)"
            )
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PvApiError.network(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PvApiError.unexpectedResponse("response was not an HTTP response")
        }
        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 { throw PvApiError.invalidCredentials }
            let message = String(data: data, encoding: .utf8)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw PvApiError.httpError(status: httpResponse.statusCode, message: message)
        }
        // WR-02: discriminate on the PAYLOAD (does an `items` key exist at
        // all?), never on decode luck. The previous "try the snapshot shape,
        // fall back to up-to-date" ordering meant a snapshot whose `items`
        // array failed to decode for ANY reason (one bad row, a future
        // nullable field) fell through the `try?` and decoded cleanly as
        // `.upToDate` instead -- every shared item would silently vanish
        // with no error raised anywhere. `DirectSharedProbeBody.items` is
        // `nil` ONLY when the wire genuinely omits the key (the up-to-date
        // shape); once we know which shape we are looking at, a malformed
        // row in the snapshot arm THROWS instead of being swallowed.
        let probe: DirectSharedProbeBody
        do {
            probe = try JSONDecoder().decode(DirectSharedProbeBody.self, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode /api/sync/shared/direct response: \(error)")
        }
        guard probe.items != nil else {
            do {
                let upToDate = try JSONDecoder().decode(DirectSharedUpToDateBody.self, from: data)
                return .upToDate(revision: upToDate.revision)
            } catch {
                throw PvApiError.unexpectedResponse("failed to decode /api/sync/shared/direct up-to-date response: \(error)")
            }
        }
        do {
            let snapshot = try JSONDecoder().decode(DirectSharedSnapshotBody.self, from: data)
            return .snapshot(revision: snapshot.revision, items: snapshot.items)
        } catch {
            // A row that fails to decode here throws, rather than being
            // silently absorbed into an "up to date, nothing new" result.
            throw PvApiError.unexpectedResponse("failed to decode /api/sync/shared/direct snapshot response: \(error)")
        }
    }

    // MARK: - `GET /api/families/family-wide-pending` -> `PendingKeyState`

    /// Fetches `family_wide_pending`'s response and applies its `missing`
    /// array to `state` BY REPLACEMENT (`PendingKeyState.applyFamilyWidePending`'s
    /// own discipline -- see `PendingKeyState.swift`'s header). This is the
    /// wiring Task 2 describes: `SharedItemsStore` owns the network call,
    /// `PendingKeyState` owns the replacement-based pruning, and this
    /// function is the ONE place the two are connected -- a future reader
    /// adding a second call site would have to duplicate this function, not
    /// quietly reach into `PendingKeyState` from somewhere else.
    static func applyFamilyWidePending(
        to state: PendingKeyState,
        baseURL: URL,
        tokenProvider: @escaping () -> String?,
        session: URLSession = .shared
    ) async throws {
        let response = try await fetchFamilyWidePending(
            baseURL: baseURL, tokenProvider: tokenProvider, session: session
        )
        state.applyFamilyWidePending(missing: response.missing)
    }

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-05)"

    /// `GET /api/families/family-wide-pending`. Mirrors
    /// `IdentityService`/`CollectionService`'s own thin `URLSession`
    /// transport -- stateless, bearer token supplied by an injected
    /// closure, never stored.
    static func fetchFamilyWidePending(
        baseURL: URL,
        tokenProvider: () -> String?,
        session: URLSession = .shared
    ) async throws -> FamilyWidePendingResponseBody {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/families/family-wide-pending")
        }
        guard let url = URL(string: "/api/families/family-wide-pending", relativeTo: baseURL) else {
            throw PvApiError.unexpectedResponse(
                "could not construct URL for /api/families/family-wide-pending against \(baseURL)"
            )
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PvApiError.network(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PvApiError.unexpectedResponse("response was not an HTTP response")
        }
        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 { throw PvApiError.invalidCredentials }
            let message = String(data: data, encoding: .utf8)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw PvApiError.httpError(status: httpResponse.statusCode, message: message)
        }
        do {
            return try JSONDecoder().decode(FamilyWidePendingResponseBody.self, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode FamilyWidePendingResponseBody: \(error)")
        }
    }
}
