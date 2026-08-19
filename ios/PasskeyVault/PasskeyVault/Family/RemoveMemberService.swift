//
//  RemoveMemberService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-07, Task 2.
//  Removing a family member is NOT a `DELETE` the server interprets -- it is
//  the entire client-side re-key batch (`crates/pv-server/src/routes/
//  families.rs`'s `RemoveMemberRequest`/`apply_member_removal_rekey`), which
//  this file is the ONLY iOS caller of `rewrap_item_key_for_collection` for
//  (`must_haves.key_links`). Per collection the target could reach: a FRESH
//  Collection Key is generated (never reusing the old one for the
//  survivors), sealed to every REMAINING recipient's real published public
//  key, and every real item's `enc_key` rewrapped old->new. `enc_data` never
//  crosses this file in the rewrap path -- `rewrap_item_key_for_collection`
//  structurally accepts no argument shaped like it (`pv-ffi/src/sharing.rs`'s
//  own doc comment).
//
//  `removeMember(userId:userKey:)` (owner removes someone else) and
//  `leaveFamily(userKey:)` (a plain member removes THEMSELVES) build the
//  IDENTICAL batch shape but differ in exactly one place: which collections
//  the target could reach (`resolveTargetCollectionIds`, below). 40-RESEARCH.md
//  records a live-only bug this split exists to avoid: `GET /api/families/
//  members/{user_id}/access` is owner-only (`FamilyMembership<RequireEdit>`)
//  and 403s even when the caller asks about their OWN id -- so a self-removal
//  reads `GET /api/vault/collections` instead, which is always scoped to the
//  CALLER's own `collection_keys` rows and needs no owner privilege.
//
//  `leaveFamily` submits to `DELETE /api/auth/account`, NOT the family
//  removal endpoint -- `families.rs::remove_member` explicitly refuses
//  `target_user_id == caller_user_id` ("cannot remove yourself -- use account
//  deletion to leave the family"). This is therefore a full account
//  deletion, not merely a membership removal; the caller loses their own
//  vault along with their family membership. `account.rs`'s plain-member
//  branch (`delete_account_as_member`) calls the SAME `apply_member_removal_
//  rekey` helper `remove_member` does, with `target_user_id = caller`, so the
//  wire shape this file builds is correct for both submit call sites without
//  a second implementation.
//
//  Deliberately does NOT implement suspension/reinstatement
//  (`must_haves.prohibitions`) -- FAM-02 names invites, the member list, and
//  removal; `POST /api/families/members/{user_id}/suspend`/`/reinstate` exist
//  server-side with no iOS surface, recorded here rather than silently
//  omitted.
//

import Foundation

enum RemoveMemberError: Error, CustomStringConvertible {
    case noSessionToken(String)
    case collectionMissingOwnSealedKey(collectionId: String)
    case requestFailed(String, status: Int, body: String)

    var description: String {
        switch self {
        case let .noSessionToken(path):
            return "no session token available for \(path)"
        case let .collectionMissingOwnSealedKey(collectionId):
            return "cannot re-key collection \(collectionId) -- caller has no sealed_key for it"
        case let .requestFailed(what, status, body):
            return "\(what) failed (\(status)): \(body)"
        }
    }
}

/// Thin `URLSession` wrapper that composes and submits a member-removal
/// re-key batch. Owns its own minimal transport for the two endpoints
/// `FamilyAPI`/`CollectionService` do not cover (`GET /api/vault/collections`,
/// `GET /api/vault/collections/{id}/access`, `DELETE /api/auth/account`) --
/// mirrors every other Phase 40 service file's own "each file owns its
/// transport" precedent (`FamilyAPI`/`CollectionService`/`IdentityService`
/// each duplicate `send`/`requireStatus`/`decode` rather than sharing one).
struct RemoveMemberService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-07)"

    private var familyAPI: FamilyAPI { FamilyAPI(baseURL: baseURL, tokenProvider: tokenProvider, session: session) }
    private var identityService: IdentityService {
        IdentityService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }
    private var collectionService: CollectionService {
        CollectionService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }

    // MARK: - Public API (network-integrated)

    /// Owner removes a DIFFERENT member. Builds the whole batch, THEN submits
    /// exactly once (`FamilyAPI.removeMember`) -- a throw anywhere in batch
    /// construction (a missing recipient public key, a collection with no
    /// own `sealed_key`) happens strictly BEFORE this method's one network
    /// write, never after a partial submit.
    @discardableResult
    func removeMember(userId: String, userKey: FfiUserKey) async throws -> [FamilyAPI.CollectionRekeyBatch] {
        let batch = try await buildRemovalBatch(targetUserId: userId, userKey: userKey, isSelf: false)
        try await familyAPI.removeMember(userId: userId, collections: batch)
        return batch
    }

    /// A plain member removes THEMSELVES -- see this file's own header for
    /// why this submits to `DELETE /api/auth/account`, not the family removal
    /// endpoint (a full account deletion, not merely a membership removal).
    @discardableResult
    func leaveFamily(userKey: FfiUserKey) async throws -> [FamilyAPI.CollectionRekeyBatch] {
        guard let token = tokenProvider() else {
            throw RemoveMemberError.noSessionToken("/api/auth/account")
        }
        let me = try await PvApiClient(baseURL: baseURL).me(token: token)
        let batch = try await buildRemovalBatch(targetUserId: me.userId, userKey: userKey, isSelf: true)
        try await deleteAccount(token: token, collections: batch)
        return batch
    }

    // MARK: - The isSelf source-of-truth split (40-RESEARCH.md Pitfall 7)

    /// Resolves which collections `targetUserId` currently reaches. `isSelf
    /// == true` reads `GET /api/vault/collections` (always scoped to the
    /// CALLER's own `collection_keys` rows, no owner privilege needed);
    /// `isSelf == false` reads the OWNER-ONLY `GET /api/families/
    /// members/{user_id}/access`. `internal`, not `private`, so
    /// `RemoveMemberTests` can exercise this ONE decision point directly,
    /// isolated from the rest of the batch-building pipeline (crypto, item
    /// rewraps) -- a single shared code path silently satisfying BOTH a
    /// self-removal test and a remove-another test would hide exactly the
    /// live-only bug this split exists to prevent.
    func resolveTargetCollectionIds(targetUserId: String, isSelf: Bool) async throws -> [String] {
        if isSelf {
            return try await fetchOwnCollectionIds()
        }
        let access = try await familyAPI.fetchMemberAccess(userId: targetUserId)
        return access.collections.map(\.id)
    }

    // MARK: - Batch composition, pure/testable (no network calls inside)

    /// One remaining recipient's identity as resolved from the roster --
    /// `publicKeyBase64 == nil` means "no published key", the T-25-16 throw
    /// condition below.
    struct RemainingRecipient {
        let userId: String
        let publicKeyBase64: String?
    }

    struct ItemToRewrap {
        let itemId: String
        let encKeyJson: String
    }

    enum BatchBuilderError: Error, CustomStringConvertible {
        case recipientMissingPublicKey(userId: String, collectionId: String)
        case malformedPublicKey(userId: String, collectionId: String)

        var description: String {
            switch self {
            case let .recipientMissingPublicKey(userId, collectionId):
                return "cannot re-key collection \(collectionId) -- remaining recipient \(userId) has no published public key"
            case let .malformedPublicKey(userId, collectionId):
                return "cannot re-key collection \(collectionId) -- remaining recipient \(userId)'s public_key is not valid base64"
            }
        }
    }

    #if DEBUG
    /// TEST-ONLY fault injection (Task 3, E-F5's falsification run) --
    /// mirrors `crates/pv-server/src/routes/families.rs`'s own
    /// `FAULT_INJECT_AFTER_COLLECTION_INDEX` thread-local precedent for the
    /// identical "prove a completeness gate can fail" need. When `true`,
    /// drops the LAST remaining recipient from the seal loop below, exactly
    /// as a real "silently shrunk recipient set" bug would. `#if DEBUG`-gated
    /// (this whole project ships/tests Debug-only, L-14) and read ONLY here
    /// -- no production call site ever sets it; `false` by default, so every
    /// ordinary call is completely unaffected.
    static var testOnlyDropLastRecipient = false
    #endif

    /// Builds ONE collection's re-key batch entirely client-side -- no
    /// network calls anywhere in this function, which is why "a missing
    /// public key throws before any request is issued" is not merely
    /// disciplined here, it is structural: this function never touches
    /// `URLSession`. A fresh Collection Key is generated (never the old one,
    /// T-40-29), sealed to every `remainingRecipients` entry, and every
    /// `items` entry's key is rewrapped old->new. Returns the fresh key
    /// alongside the batch so a caller (a test, in practice -- no production
    /// caller currently needs it) can prove the "differs from the
    /// pre-removal key" / "every sealed entry recovers to the SAME key"
    /// claims without this type ever exposing raw bytes (`FfiCollectionKey`
    /// has no byte accessor by design).
    static func buildCollectionBatch(
        collectionId: String,
        oldCk: FfiCollectionKey,
        remainingRecipients: [RemainingRecipient],
        items: [ItemToRewrap]
    ) throws -> (newCk: FfiCollectionKey, batch: FamilyAPI.CollectionRekeyBatch) {
        let newCk = try FfiCollectionKey.generate()

        var recipientsToSeal = remainingRecipients
        #if DEBUG
        if testOnlyDropLastRecipient {
            recipientsToSeal = Array(recipientsToSeal.dropLast())
        }
        #endif

        var newSealedKeys: [FamilyAPI.NewSealedKeyEntry] = []
        newSealedKeys.reserveCapacity(recipientsToSeal.count)
        for recipient in recipientsToSeal {
            guard let publicKeyBase64 = recipient.publicKeyBase64 else {
                throw BatchBuilderError.recipientMissingPublicKey(userId: recipient.userId, collectionId: collectionId)
            }
            guard let publicKeyBytes = Data(base64Encoded: publicKeyBase64) else {
                throw BatchBuilderError.malformedPublicKey(userId: recipient.userId, collectionId: collectionId)
            }
            let recipientPk = try FfiIdentityPublicKey.fromBytes(bytes: publicKeyBytes)
            let sealedKeyJson = try sealCollectionKey(recipientPk: recipientPk, ck: newCk)
            newSealedKeys.append(
                FamilyAPI.NewSealedKeyEntry(recipientUserId: recipient.userId, sealedKey: sealedKeyJson)
            )
        }

        var itemRewraps: [FamilyAPI.ItemRewrapEntry] = []
        itemRewraps.reserveCapacity(items.count)
        for item in items {
            let newEncKeyJson = try rewrapItemKeyForCollection(
                oldCk: oldCk, newCk: newCk, oldEncKeyJson: item.encKeyJson,
                collectionId: collectionId, itemId: item.itemId
            )
            itemRewraps.append(FamilyAPI.ItemRewrapEntry(itemId: item.itemId, encKey: newEncKeyJson))
        }

        let batch = FamilyAPI.CollectionRekeyBatch(
            collectionId: collectionId, newSealedKeys: newSealedKeys, itemRewraps: itemRewraps
        )
        return (newCk, batch)
    }

    // MARK: - Orchestration (network-integrated batch assembly)

    /// Resolves every affected collection, and for each one: the caller's
    /// own current Collection Key (unsealed from `CollectionService
    /// .fetchCollection`'s `sealedKey`), the collection's current
    /// co-recipients (`GET /api/vault/collections/{id}/access`, minus the
    /// target), and that collection's real items (`VaultAPI.sync(since: 0)`,
    /// filtered by `collection_id` -- the snapshot's collection-item join is
    /// scoped by `collection_keys.recipient_user_id = caller`, i.e. every
    /// item in every collection the caller holds a key for, regardless of
    /// item owner -- exactly the set `apply_member_removal_rekey`'s own
    /// server-side item-set check expects). Then delegates the actual
    /// composition to `buildCollectionBatch` -- this function's own job is
    /// resolving real server data, not crypto.
    private func buildRemovalBatch(
        targetUserId: String, userKey: FfiUserKey, isSelf: Bool
    ) async throws -> [FamilyAPI.CollectionRekeyBatch] {
        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: userKey)
        let roster = try await familyAPI.fetchMembers()
        let collectionIds = try await resolveTargetCollectionIds(targetUserId: targetUserId, isSelf: isSelf)

        var batches: [FamilyAPI.CollectionRekeyBatch] = []
        batches.reserveCapacity(collectionIds.count)

        for collectionId in collectionIds {
            let record = try await collectionService.fetchCollection(id: collectionId)
            guard let ownSealedKey = record.sealedKey else {
                throw RemoveMemberError.collectionMissingOwnSealedKey(collectionId: collectionId)
            }
            let oldCk = try unsealCollectionKey(myIdentityKey: identityKey, sealedJson: ownSealedKey)

            let coRecipients = try await fetchAccessList(collectionId: collectionId)
            let remaining: [RemainingRecipient] = coRecipients
                .filter { $0.userId != targetUserId }
                .map { recipient in
                    let publicKeyBase64 = roster.first(where: { $0.userId == recipient.userId })?.publicKey
                    return RemainingRecipient(userId: recipient.userId, publicKeyBase64: publicKeyBase64)
                }

            // Per collection, NOT a single prefetched list -- see
            // `fetchCollectionItemRows`'s own header for why `GET
            // /api/vault/collections/{id}/sync` (every item in THIS
            // collection, any author) is the only correct source here.
            let itemRows = try await fetchCollectionItemRows(collectionId: collectionId)
            let items: [ItemToRewrap] = itemRows.map { ItemToRewrap(itemId: $0.id, encKeyJson: $0.enc_key) }

            let (_, batch) = try Self.buildCollectionBatch(
                collectionId: collectionId, oldCk: oldCk, remainingRecipients: remaining, items: items
            )
            batches.append(batch)
        }

        return batches
    }

    // MARK: - Transport: the two reads not covered by FamilyAPI/CollectionService

    private struct OwnCollectionRow: Decodable { let id: String }

    /// `GET /api/vault/collections` -- `FamilyMembership<RequireRead>`-gated,
    /// always scoped to the CALLER's own `collection_keys` rows by
    /// construction (never parameterized by a target id). This is the
    /// self-removal half of `resolveTargetCollectionIds`.
    private func fetchOwnCollectionIds() async throws -> [String] {
        guard let token = tokenProvider() else {
            throw RemoveMemberError.noSessionToken("/api/vault/collections")
        }
        let (data, response) = try await send(path: "/api/vault/collections", method: "GET", body: nil, token: token)
        try Self.requireStatus(200, response: response, data: data)
        let rows = try Self.decode([OwnCollectionRow].self, from: data)
        return rows.map(\.id)
    }

    private struct CoRecipientRow: Decodable {
        let userId: String
        enum CodingKeys: String, CodingKey { case userId = "user_id" }
    }

    /// `GET /api/vault/collections/{id}/access` -- `Membership<Collection,
    /// RequireRead>`-gated symmetric co-recipient visibility
    /// (`collections.rs::access_list`). Never includes `sealed_key`; this
    /// method only reads `user_id`, the set "remaining recipients" is
    /// filtered from.
    private func fetchAccessList(collectionId: String) async throws -> [CoRecipientRow] {
        guard let token = tokenProvider() else {
            throw RemoveMemberError.noSessionToken("/api/vault/collections/\(collectionId)/access")
        }
        let (data, response) = try await send(
            path: "/api/vault/collections/\(collectionId)/access", method: "GET", body: nil, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode([CoRecipientRow].self, from: data)
    }

    private struct SharedCollectionSyncSnapshotBody: Decodable {
        let revision: Int
        let items: [VaultItemRow]
    }

    private struct SharedCollectionSyncUpToDateBody: Decodable {
        let revision: Int
    }

    /// `GET /api/vault/collections/{id}/sync` (`sync.rs::pull_shared_collection`,
    /// NO `since` query param -- `OptionalSyncQuery`'s own documented
    /// contract: an absent `since` is ALWAYS a full-snapshot request). This
    /// is the ONLY item-enumeration endpoint correct for this file's own
    /// purpose: `WHERE collection_id = ?` with NO `user_id` filter of any
    /// kind, so it returns EVERY item in the collection regardless of who
    /// created it.
    ///
    /// `VaultAPI.sync(since:)` (`GET /api/sync`, `vault::fetch_items_for`) is
    /// the WRONG endpoint here, discovered live during this plan's own E-F5
    /// run (`pull_shared_collection`'s own doc comment names it "Pitfall
    /// A"): its collection arm carries an ADDITIONAL `i.user_id = ?` bind on
    /// top of the `collection_keys` join -- it is scoped to "items in a
    /// collection I hold a key for AND that I personally authored", by
    /// design (that module's own header: "scoped strictly to
    /// `session.user_id`"). A remaining-recipient B who never personally
    /// authored an item in a shared collection would silently vanish from
    /// `RemoveMemberService`'s own item enumeration, producing a re-key
    /// batch that never rewraps that item's key for the new Collection Key
    /// at all -- exactly the T-40-28 "incomplete re-key batch" failure mode
    /// this file's own threat-register mitigation is supposed to prevent.
    /// Same "snapshot-shape-first" decode discipline `SyncModels.swift`'s
    /// own header documents for `SyncPullResult` (L-22): the up-to-date
    /// shape has no `items` KEY at all on the wire, so an optional-with-
    /// default decode would silently produce an empty list on ANY decode,
    /// not just the genuine up-to-date case.
    private func fetchCollectionItemRows(collectionId: String) async throws -> [VaultItemRow] {
        guard let token = tokenProvider() else {
            throw RemoveMemberError.noSessionToken("/api/vault/collections/\(collectionId)/sync")
        }
        let (data, response) = try await send(
            path: "/api/vault/collections/\(collectionId)/sync", method: "GET", body: nil, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        if let snapshot = try? JSONDecoder().decode(SharedCollectionSyncSnapshotBody.self, from: data) {
            return snapshot.items
        }
        _ = try Self.decode(SharedCollectionSyncUpToDateBody.self, from: data)
        return []
    }

    private struct DeleteAccountRequestBody: Encodable {
        let collections: [FamilyAPI.CollectionRekeyBatch]
    }

    /// `DELETE /api/auth/account` -- `SessionUser`-gated (never `Membership`),
    /// branches server-side (owner / plain member / no family) on the
    /// caller's OWN resolved role. `leaveFamily`'s batch is built for the
    /// plain-member branch (`account.rs::delete_account_as_member`), which
    /// reuses `apply_member_removal_rekey` -- the SAME shape `removeMember`
    /// submits, over a different endpoint. Expects **204**.
    private func deleteAccount(token: String, collections: [FamilyAPI.CollectionRekeyBatch]) async throws {
        let body = try JSONEncoder().encode(DeleteAccountRequestBody(collections: collections))
        let (data, response) = try await send(path: "/api/auth/account", method: "DELETE", body: body, token: token)
        try Self.requireStatus(204, response: response, data: data)
    }

    // MARK: - Transport (mirrors FamilyAPI.swift/CollectionService.swift)

    private func send(
        path: String,
        method: String,
        body: Data?,
        token: String?
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw PvApiError.unexpectedResponse("could not construct URL for \(path) against \(baseURL)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

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
        return (data, httpResponse)
    }

    private static func requireStatus(_ expected: Int, response: HTTPURLResponse, data: Data) throws {
        if response.statusCode == expected { return }
        if response.statusCode == 401 { throw PvApiError.invalidCredentials }
        let message = String(data: data, encoding: .utf8)
            ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        throw PvApiError.httpError(status: response.statusCode, message: message)
    }

    private static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode \(type): \(error)")
        }
    }
}
