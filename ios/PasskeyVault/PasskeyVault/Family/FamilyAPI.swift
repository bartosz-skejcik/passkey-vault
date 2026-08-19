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

    /// `GET /api/families/members` -- any family member may list the roster.
    func fetchMembers() async throws -> [FamilyMemberRecord] {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/families/members")
        }
        let (data, response) = try await send(path: "/api/families/members", method: "GET", body: nil, token: token)
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode([FamilyMemberRecord].self, from: data)
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
