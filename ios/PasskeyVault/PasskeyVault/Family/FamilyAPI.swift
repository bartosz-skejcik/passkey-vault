//
//  FamilyAPI.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06, Task 2. The
//  single HTTP surface for `/api/families*` and `/api/invitations*`
//  (`crates/pv-server/src/routes/families.rs`/`invitations.rs`) -- plan
//  40-07 extends this file (roster fetch enrichment, fingerprint-verify
//  call) rather than adding a second client, per this plan's own
//  `key_links`.
//
//  Scoped to exactly what THIS plan's own acceptance criteria need:
//  `createInvite` (`POST /api/invitations`, `InviteService`'s sole caller)
//  and `fetchMembers` (`GET /api/families/members`, Task 3's live E-F2
//  receiver-side proof, and 40-07's own roster screen). `fetch_metadata`/
//  `accept` are the WEB client's job in E-F2's own design (iOS authors an
//  invite, a second unrelated account on the web redeems it -- iOS never
//  redeems here) and are left for whichever plan actually builds
//  `InviteRedeemView` (40-09) -- same "add what THIS plan's own acceptance
//  criteria require, not the full server surface" discipline
//  `Sharing/CollectionService.swift` already established (`fetchCollection`/
//  `createFamilyWideCollection` only, no `access_list`/`update_access`).
//
//  EXTENDED by Phase 40, plan 40-08 -- `40-UI-SPEC.md` §0.3 (binding,
//  orchestrator resolution): plan 40-08's executor also owns the
//  Share-an-item authoring sheet (`Sharing/ShareItemView.swift`), which
//  needs the two write paths `40-UI-SPEC.md` §0.3 names --
//  `createItemShare` (`POST /api/vault/items/{id}/shares`, person scope) and
//  `addCollectionMember` (`POST /api/vault/collections/{id}/members`, whole-
//  family scope) -- neither of which any Phase 40 plan through 40-07 had a
//  caller for. Added here rather than a third client, per this file's own
//  established "one HTTP surface for `/api/families*`/`/api/invitations*`"
//  discipline extended to the two sharing-authoring routes `ShareItemView`
//  needs (`crates/pv-server/src/routes/vault.rs::create_share`,
//  `crates/pv-server/src/routes/collections.rs::add_member`).
//
//  EXTENDED by plan 40-07, Tasks 1/2 -- the roster's fingerprint-verify
//  action (`POST /api/identity/verify/{user_id}`) and the member-removal
//  surface: `verifyFingerprint`, `fetchMemberAccess` (the OWNER-ONLY
//  per-member breakdown, `GET /api/families/members/{user_id}/access`), and
//  `removeMember` (`DELETE /api/families/members/{user_id}`, body carries
//  `RemoveMemberService`'s entire client-computed re-key batch). The three
//  batch element types (`NewSealedKeyEntry`, `ItemRewrapEntry`,
//  `CollectionRekeyBatch`) mirror `crates/pv-server/src/routes/
//  families.rs`'s identically-named structs field-for-field -- the SAME
//  shape `DELETE /api/auth/account`'s plain-member branch accepts too
//  (`routes/account.rs`'s `DeleteAccountRequest.collections` reuses the
//  server-side element type), so `RemoveMemberService` builds one batch
//  shape for both submit call sites, never two. `fetchMemberAccess` is
//  scoped to "someone else" removals ONLY -- `family.rs::
//  owner_sees_per_member_access_breakdown` asserts a member querying THEIR
//  OWN id via this route gets 403 unconditionally (40-RESEARCH.md Pitfall
//  7); `RemoveMemberService.leaveFamily`'s self path never calls this
//  method.
//

import Foundation

struct FamilyAPI {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-06)"

    /// Field-for-field identical to `invitations.rs`'s `FamilyWideKeyEntry`
    /// (30-03) -- the opaque `WrappedKey`-shaped blob this server never
    /// unwraps.
    struct FamilyWideKeyEntry: Encodable {
        let collectionId: String
        let accessLevel: String
        let wrappedCollectionKey: String

        enum CodingKeys: String, CodingKey {
            case collectionId = "collection_id"
            case accessLevel = "access_level"
            case wrappedCollectionKey = "wrapped_collection_key"
        }
    }

    struct CreateInvitationResult {
        let id: String
        let expiresAt: String
    }

    private struct CreateInvitationRequestBody: Encodable {
        let id: String
        let collection_id: String?
        let access_level: String?
        let wrapped_collection_key: String?
        let family_wide_keys: [FamilyWideKeyEntry]
        let proof_hash: String
        let expires_in: String
    }

    private struct CreateInvitationResponseBody: Decodable {
        let id: String
        let expires_at: String
    }

    /// One family member row, decoded from `GET /api/families/members`
    /// (`crates/pv-server/src/routes/families.rs`'s `FamilyMemberRecord`).
    struct FamilyMemberRecord: Decodable, Equatable {
        let userId: String
        let email: String
        let role: String
        let joinedAt: String
        let publicKey: String?
        let fingerprint: String?
        let verifiedAt: String?
        let status: String

        enum CodingKeys: String, CodingKey {
            case userId = "user_id"
            case email
            case role
            case joinedAt = "joined_at"
            case publicKey = "public_key"
            case fingerprint
            case verifiedAt = "verified_at"
            case status
        }
    }

    // MARK: - Public API

    /// `POST /api/invitations` -- owner-only (server-side `RequireEdit`).
    @discardableResult
    func createInvite(
        id: String,
        collectionId: String?,
        accessLevel: String?,
        wrappedCollectionKey: String?,
        familyWideKeys: [FamilyWideKeyEntry],
        proofHash: String,
        expiresIn: String
    ) async throws -> CreateInvitationResult {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/invitations")
        }
        let requestBody = CreateInvitationRequestBody(
            id: id, collection_id: collectionId, access_level: accessLevel,
            wrapped_collection_key: wrappedCollectionKey, family_wide_keys: familyWideKeys,
            proof_hash: proofHash, expires_in: expiresIn
        )
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(path: "/api/invitations", method: "POST", body: body, token: token)
        try Self.requireStatus(201, response: response, data: data)
        let decoded = try Self.decode(CreateInvitationResponseBody.self, from: data)
        return CreateInvitationResult(id: decoded.id, expiresAt: decoded.expires_at)
    }

    /// Mirrors `families.rs`'s `FamilyResponse` field-for-field.
    struct FamilyRecord: Decodable, Equatable {
        let id: String
        let name: String
        let ownerUserId: String
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case ownerUserId = "owner_user_id"
            case createdAt = "created_at"
        }
    }

    private struct CreateFamilyRequestBody: Encodable {
        let name: String
    }

    /// `POST /api/families` -- `crates/pv-server/src/routes/
    /// families.rs::create`. CR-04(b) (40-REVIEW.md, iteration 2): the ONLY
    /// route with no membership check at all (creating the family IS what
    /// establishes the caller's own membership) -- the missing client call
    /// this fix adds. A second call (the singleton family already exists)
    /// 409s, never a silent duplicate; that server behaviour is preserved
    /// here as a thrown `PvApiError.httpError(status: 409, _)`, never
    /// papered over as success. Expects **201**.
    @discardableResult
    func createFamily(name: String) async throws -> FamilyRecord {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/families")
        }
        let body = try JSONEncoder().encode(CreateFamilyRequestBody(name: name))
        let (data, response) = try await send(path: "/api/families", method: "POST", body: body, token: token)
        try Self.requireStatus(201, response: response, data: data)
        return try Self.decode(FamilyRecord.self, from: data)
    }

    /// `GET /api/families/members` -- any family member may list the roster.
    func fetchMembers() async throws -> [FamilyMemberRecord] {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/families/members")
        }
        let (data, response) = try await send(path: "/api/families/members", method: "GET", body: nil, token: token)
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode([FamilyMemberRecord].self, from: data)
    }

    /// `POST /api/identity/verify/{user_id}` -- the CALLER (viewer) marks
    /// `user_id` as fingerprint-verified, out of band (this method sends no
    /// body -- the server's own `verify` handler reads nothing but the path
    /// segment and the session). Idempotent; a repeat call refreshes
    /// `verified_at` rather than erroring. Expects **204**.
    func verifyFingerprint(userId: String) async throws {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/identity/verify/\(userId)")
        }
        let (data, response) = try await send(
            path: "/api/identity/verify/\(userId)", method: "POST", body: nil, token: token
        )
        try Self.requireStatus(204, response: response, data: data)
    }

    // MARK: - Public API (Phase 40, plan 40-07, Task 2 -- member removal)

    /// One remaining recipient's freshly-`seal()`ed Collection Key, client
    /// side -- mirrors `families.rs`'s `NewSealedKeyEntry` field-for-field.
    /// Opaque `sealedKey`, never re-encoded by this file (DR-40-A).
    struct NewSealedKeyEntry: Encodable, Equatable {
        let recipientUserId: String
        let sealedKey: String

        enum CodingKeys: String, CodingKey {
            case recipientUserId = "recipient_user_id"
            case sealedKey = "sealed_key"
        }
    }

    /// One item's freshly-rewrapped `enc_key` -- mirrors `families.rs`'s
    /// `ItemRewrapEntry`. Deliberately no `enc_data` field on this type: the
    /// server-side counterpart carries none either, which is SC 6/KEY-02's
    /// rewrap-only guarantee made structural, not just disciplinary.
    struct ItemRewrapEntry: Encodable, Equatable {
        let itemId: String
        let encKey: String

        enum CodingKeys: String, CodingKey {
            case itemId = "item_id"
            case encKey = "enc_key"
        }
    }

    /// One collection's full re-key batch -- mirrors `families.rs`'s
    /// `CollectionRekeyBatch`. The SAME shape `DELETE
    /// /api/families/members/{user_id}` (below) and `DELETE /api/auth/account`'s
    /// plain-member branch both accept -- `RemoveMemberService` is the ONE
    /// place that builds this shape, for both submit call sites.
    struct CollectionRekeyBatch: Encodable, Equatable {
        let collectionId: String
        let newSealedKeys: [NewSealedKeyEntry]
        let itemRewraps: [ItemRewrapEntry]

        enum CodingKeys: String, CodingKey {
            case collectionId = "collection_id"
            case newSealedKeys = "new_sealed_keys"
            case itemRewraps = "item_rewraps"
        }
    }

    private struct RemoveMemberRequestBody: Encodable {
        let collections: [CollectionRekeyBatch]
    }

    /// `DELETE /api/families/members/{user_id}` -- owner-only
    /// (`FamilyMembership<RequireEdit>`). The body carries the ENTIRE
    /// client-precomputed re-key batch (`RemoveMemberService`'s job to
    /// build -- this method never computes any part of it). Expects **204**;
    /// the server applies the batch inside a transaction and rolls the whole
    /// thing back on any failure -- this method reports that failure via the
    /// thrown `PvApiError`, and never mutates local state to claim success on
    /// a non-204 response (T-40-32).
    func removeMember(userId: String, collections: [CollectionRekeyBatch]) async throws {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/families/members/\(userId)")
        }
        let body = try JSONEncoder().encode(RemoveMemberRequestBody(collections: collections))
        let (data, response) = try await send(
            path: "/api/families/members/\(userId)", method: "DELETE", body: body, token: token
        )
        try Self.requireStatus(204, response: response, data: data)
    }

    struct MemberAccessCollectionEntry: Decodable, Equatable {
        let id: String
        let accessLevel: String

        enum CodingKeys: String, CodingKey {
            case id
            case accessLevel = "access_level"
        }
    }

    struct MemberAccessItemShareEntry: Decodable, Equatable {
        let itemId: String
        let accessLevel: String

        enum CodingKeys: String, CodingKey {
            case itemId = "item_id"
            case accessLevel = "access_level"
        }
    }

    /// Decoded `GET /api/families/members/{user_id}/access` response --
    /// `item_shares` is decoded for completeness (the wire carries it) but
    /// `RemoveMemberService` reads only `collections`: `apply_member_removal_
    /// rekey`'s own step 4 severs every `item_shares` row the target held
    /// unconditionally, server-side, never something the client batch
    /// carries (40-RESEARCH.md's own note on this route).
    struct MemberAccessResult: Decodable, Equatable {
        let collections: [MemberAccessCollectionEntry]
        let itemShares: [MemberAccessItemShareEntry]

        enum CodingKeys: String, CodingKey {
            case collections
            case itemShares = "item_shares"
        }
    }

    /// `GET /api/families/members/{user_id}/access` -- OWNER-ONLY. See this
    /// file's own header and `RemoveMemberService.swift`'s header for why a
    /// self-removal must never call this (403, unconditionally, even for the
    /// caller's own id -- 40-RESEARCH.md Pitfall 7).
    func fetchMemberAccess(userId: String) async throws -> MemberAccessResult {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/families/members/\(userId)/access")
        }
        let (data, response) = try await send(
            path: "/api/families/members/\(userId)/access", method: "GET", body: nil, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode(MemberAccessResult.self, from: data)
    }

    // MARK: - Public API (Phase 40, plan 40-08 -- Share-an-item sheet)

    private struct CreateItemShareRequestBody: Encodable {
        let recipient_user_id: String
        let sealed_key: String
        let access_level: String
    }

    /// `POST /api/vault/items/{id}/shares` -- `crates/pv-server/src/routes/
    /// vault.rs::create_share`, `Membership<Item, RequireEdit>`-gated.
    /// `sealedKeyJson` is the item's OWN Cipher Key, `seal()`ed client-side
    /// to `recipientUserId`'s published `IdentityPublicKey`
    /// (`sealItemKeyForRecipient`, `crates/pv-ffi/src/sharing.rs`) -- opaque
    /// to this server, never inspected here. Expects **201**.
    func createItemShare(
        itemId: String,
        recipientUserId: String,
        sealedKeyJson: String,
        accessLevel: String
    ) async throws {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/vault/items/\(itemId)/shares")
        }
        let requestBody = CreateItemShareRequestBody(
            recipient_user_id: recipientUserId, sealed_key: sealedKeyJson, access_level: accessLevel
        )
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(
            path: "/api/vault/items/\(itemId)/shares", method: "POST", body: body, token: token
        )
        try Self.requireStatus(201, response: response, data: data)
    }

    private struct UpdateItemShareRequestBody: Encodable {
        let access_level: String
    }

    /// `PUT /api/vault/items/{id}/shares/{user_id}` -- `crates/pv-server/
    /// src/routes/vault.rs::update_share`. CR-08 (40-REVIEW.md, iteration
    /// 2): the recipient already holds SOME grant for this item (a 409 on
    /// `createItemShare` above), and this call changes its LEVEL only --
    /// `update_share`'s own doc comment records that the row's
    /// `sealed_key` never needs to change for a level edit (the recipient
    /// already holds the same Item Key). 404s if no `item_shares` row
    /// exists for this pair (an edit of an existing row, never a silent
    /// upsert); expects **204**.
    func updateItemShare(
        itemId: String,
        recipientUserId: String,
        accessLevel: String
    ) async throws {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse(
                "no session token available for /api/vault/items/\(itemId)/shares/\(recipientUserId)"
            )
        }
        let requestBody = UpdateItemShareRequestBody(access_level: accessLevel)
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(
            path: "/api/vault/items/\(itemId)/shares/\(recipientUserId)", method: "PUT", body: body, token: token
        )
        try Self.requireStatus(204, response: response, data: data)
    }

    private struct AddCollectionMemberRequestBody: Encodable {
        let recipient_user_id: String
        let sealed_key: String
        let access_level: String
    }

    /// `POST /api/vault/collections/{id}/members` --
    /// `crates/pv-server/src/routes/collections.rs::add_member`. `sealedKeyJson`
    /// is the SAME `CollectionKey` the collection was created with,
    /// independently `seal()`ed to `recipientUserId`'s own identity public
    /// key -- never unwrapped/validated server-side. Expects **201**.
    func addCollectionMember(
        collectionId: String,
        recipientUserId: String,
        sealedKeyJson: String,
        accessLevel: String
    ) async throws {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse(
                "no session token available for /api/vault/collections/\(collectionId)/members"
            )
        }
        let requestBody = AddCollectionMemberRequestBody(
            recipient_user_id: recipientUserId, sealed_key: sealedKeyJson, access_level: accessLevel
        )
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(
            path: "/api/vault/collections/\(collectionId)/members", method: "POST", body: body, token: token
        )
        try Self.requireStatus(201, response: response, data: data)
    }

    // MARK: - Transport (mirrors IdentityService.swift/CollectionService.swift)

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
