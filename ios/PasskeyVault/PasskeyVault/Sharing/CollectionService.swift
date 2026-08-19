//
//  CollectionService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-02, Task 2/3.
//  Creates and reads shared collections against `pv-server`'s
//  `/api/vault/collections*` routes (`crates/pv-server/src/routes/
//  collections.rs`, read post-40-01-merge -- the client mints `id` as a
//  UUID-v4 BEFORE encrypting `enc_name`, because that route's own doc
//  comment says `enc_name`'s AAD is bound to this exact id
//  (`encryptItemForCollection(ck, name, id, id, 1)`); the id is never
//  server-minted).
//
//  Composition order mirrors `main:web/src/lib/vault/api.ts`'s
//  `createCollection` call sites: obtain the caller's own identity key via
//  `IdentityService.ensureOwnIdentityKeypair`, generate a fresh
//  `FfiCollectionKey`, seal it to the caller's OWN published public key
//  (the creator's own `collection_keys` row -- `collections.rs::create`'s
//  hard-coded `'edit'` access level for that row is unrelated to
//  `family_wide_access_level`, which is what THIS share is created at and
//  what every later propagation path reads), encrypt the name under the
//  fresh Collection Key, and POST every FFI-returned `String` verbatim.
//
//  `encrypt_item_for_collection`/`decrypt_item_for_collection` (Rule-2
//  addition, see `crates/pv-ffi/src/sharing.rs`'s own module header) supply
//  the `enc_name` blob this file needs -- without them this plan's own E-W2
//  receiver-side proof (the web app rendering the iOS-created collection's
//  decrypted name, and the reverse direction) would have nothing to call.
//
//  `family_wide_kind` is hard-coded to `"folder"` here: this plan's own
//  scope is the identity/Collection-Key tracer, not the dock/Folders UI
//  (that is 40-05's job per `40-UI-SPEC.md`'s ORCHESTRATOR RESOLUTION), and
//  "folder" is the kind that UI work is organized around -- `"item_bucket"`
//  has no iOS caller yet. A later plan that needs `item_bucket` should add
//  a `kind:` parameter rather than assume this hard-coded choice is load-
//  bearing.
//

import Foundation

/// One collection row, decoded from `CollectionResponse`
/// (`crates/pv-server/src/routes/collections.rs`). `encName`/`sealedKey`
/// cross this type as opaque `String`s -- never inspected or re-encoded
/// here (same DR-40-A/DR-38-C discipline as `VaultAPI.swift`).
struct CollectionRecord {
    let id: String
    let encName: String
    let createdAt: String
    let accessLevel: String?
    let sealedKey: String?
    let familyWideKind: String?
    let familyWideAccessLevel: String?
}

/// Thin `URLSession` wrapper over `pv-server`'s `/api/vault/collections*`
/// routes. Stateless like `VaultAPI`/`IdentityService`.
struct CollectionService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-02)"

    private struct CreateCollectionRequestBody: Encodable {
        let id: String
        let enc_name: String
        let sealed_key: String
        let family_wide_kind: String?
        let family_wide_access_level: String?
    }

    private struct CollectionResponseBody: Decodable {
        let id: String
        let enc_name: String
        let created_at: String
        let access_level: String?
        let sealed_key: String?
        let family_wide_kind: String?
        let family_wide_access_level: String?
    }

    private var identityService: IdentityService {
        IdentityService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }

    // MARK: - Public API

    /// Creates a family-wide collection: mints the id client-side, seals a
    /// fresh Collection Key to the CALLER's own published public key,
    /// encrypts `name` under that same key, and `POST`s every FFI-returned
    /// `String` verbatim. Returns the collection id.
    @discardableResult
    func createFamilyWideCollection(
        name: String,
        accessLevel: String,
        userKey: FfiUserKey
    ) async throws -> String {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/vault/collections")
        }

        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: userKey)
        let ownPublicKeyBytes = identityKey.publicKeyBytes()
        let ownPublicKey = try FfiIdentityPublicKey.fromBytes(bytes: ownPublicKeyBytes)

        let collectionKey = try FfiCollectionKey.generate()
        let collectionId = UUID().uuidString.lowercased()

        let sealedKeyJson = try sealCollectionKey(recipientPk: ownPublicKey, ck: collectionKey)
        let encNameJson = try encryptItemForCollection(
            ck: collectionKey,
            plaintext: name,
            collectionId: collectionId,
            itemId: collectionId,
            revision: 1
        )

        let requestBody = CreateCollectionRequestBody(
            id: collectionId,
            enc_name: encNameJson,
            sealed_key: sealedKeyJson,
            family_wide_kind: "folder",
            family_wide_access_level: accessLevel
        )
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(
            path: "/api/vault/collections", method: "POST", body: body, token: token
        )
        try Self.requireStatus(201, response: response, data: data)
        let decoded = try Self.decode(CollectionResponseBody.self, from: data)
        return decoded.id
    }

    /// `GET /api/vault/collections` (list) -- every collection the caller
    /// currently holds a `collection_keys` row for. CR-04 (40-REVIEW.md):
    /// production wiring for `VaultStore`'s family-wide-collection merge,
    /// which needs to enumerate the caller's own family-wide collections
    /// to pull each one's real item set. This duplicates the identical
    /// private helper `InviteService.fetchOwnCollections`/
    /// `RemoveMemberService.fetchOwnCollectionIds` each already carry --
    /// kept as a THIRD copy here (not refactored into a shared call)
    /// because those two files predate this fix and are out of its scope
    /// to touch; a future cleanup can consolidate all three onto this one.
    func listCollections() async throws -> [CollectionRecord] {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/vault/collections")
        }
        let (data, response) = try await send(
            path: "/api/vault/collections", method: "GET", body: nil, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        let rows = try Self.decode([CollectionResponseBody].self, from: data)
        return rows.map {
            CollectionRecord(
                id: $0.id, encName: $0.enc_name, createdAt: $0.created_at,
                accessLevel: $0.access_level, sealedKey: $0.sealed_key,
                familyWideKind: $0.family_wide_kind, familyWideAccessLevel: $0.family_wide_access_level
            )
        }
    }

    /// `GET /api/vault/collections/{id}`.
    func fetchCollection(id: String) async throws -> CollectionRecord {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/vault/collections/\(id)")
        }
        let (data, response) = try await send(
            path: "/api/vault/collections/\(id)", method: "GET", body: nil, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        let decoded = try Self.decode(CollectionResponseBody.self, from: data)
        return CollectionRecord(
            id: decoded.id,
            encName: decoded.enc_name,
            createdAt: decoded.created_at,
            accessLevel: decoded.access_level,
            sealedKey: decoded.sealed_key,
            familyWideKind: decoded.family_wide_kind,
            familyWideAccessLevel: decoded.family_wide_access_level
        )
    }

    // MARK: - Transport (mirrors IdentityService.swift/VaultAPI.swift)

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
        if response.statusCode == expected {
            return
        }
        if response.statusCode == 401 {
            throw PvApiError.invalidCredentials
        }
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
