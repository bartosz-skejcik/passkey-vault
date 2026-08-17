//
//  VaultAPI.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02. The vault half of the REST
//  contract, sibling to `Core/PvApiClient.swift`'s auth half, against the
//  SAME unmodified `pv-server`.
//
//  DR-38-C (`ios/IOS-SPIKE-LOG.md` §1a) governs this file: `enc_key`,
//  `enc_data` and `enc_name` are `String` on BOTH sides and are moved through
//  here VERBATIM. They arrive already serialized by `pv-ffi`'s `serde_json`
//  and they leave un-inspected. Swift must never build, parse, re-encode or
//  base64 them -- Foundation encodes `Data` as base64 by default while every
//  other client emits `serde_json`'s number-array shape, and `pv-server`
//  stores the column as opaque TEXT that it never parses, so it accepts both
//  and the divergence only ever surfaces in the web client as an integrity
//  warning on a row iOS wrote (landmine L-17, `ios/IOS-SPIKE-LOG.md` §3).
//
//  `JSONEncoder`/`JSONDecoder` are used here for the ENVELOPE only -- the
//  request/response bodies whose members are ordinary `String`s and `Int`s.
//  No `Data`-typed property exists anywhere in this file, which is what makes
//  that safe: Foundation's base64 default has nothing to apply itself to.
//

import Foundation

/// One vault item row exactly as `crates/pv-server/src/routes/vault.rs`'s
/// `VaultItem` serializes it. Field names are the server's own snake_case --
/// there are no rename attributes on either side, so `CodingKeys` would only
/// be a place for the two to drift apart.
struct VaultItemRow: Decodable {
    let id: String
    /// Opaque. See this file's header (DR-38-C).
    let enc_key: String
    /// Opaque. See this file's header (DR-38-C).
    let enc_data: String
    let revision: Int
    let updated_at: String
    let last_used_at: String?
    let is_shared: Bool
    let collection_id: String?
    let last_editor_email: String?
}

/// One folder row (`crates/pv-server/src/routes/folders.rs`'s
/// `FolderRecord`). `enc_name` carries the COMBINED JSON shape, not the split
/// pair items use -- see `pv-ffi`'s `wire.rs` header for the column map.
struct FolderRow: Decodable {
    let id: String
    /// Opaque. See this file's header (DR-38-C).
    let enc_name: String
}

/// `GET /api/sync`'s two response shapes.
///
/// `SyncResponse` is `#[serde(untagged)]` on the server
/// (`crates/pv-server/src/routes/sync.rs:70-81`), so the wire carries NO
/// discriminator: the up-to-date branch is `{"revision":N}` and the snapshot
/// branch is `{"revision":N,"items":[…],"folders":[…]}`. A `Decodable` with a
/// required `items` key throws on the first branch, and the server returns
/// that branch on every poll where nothing changed -- i.e. almost always.
/// Decoding therefore ATTEMPTS the snapshot branch and falls back.
enum SyncResponse: Decodable {
    case upToDate(revision: Int)
    case snapshot(revision: Int, items: [VaultItemRow], folders: [FolderRow])

    private struct SnapshotBody: Decodable {
        let revision: Int
        let items: [VaultItemRow]
        let folders: [FolderRow]
    }

    private struct UpToDateBody: Decodable {
        let revision: Int
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let snapshot = try? container.decode(SnapshotBody.self) {
            self = .snapshot(
                revision: snapshot.revision,
                items: snapshot.items,
                folders: snapshot.folders
            )
            return
        }
        let upToDate = try container.decode(UpToDateBody.self)
        self = .upToDate(revision: upToDate.revision)
    }

    var revision: Int {
        switch self {
        case let .upToDate(revision): return revision
        case let .snapshot(revision, _, _): return revision
        }
    }
}

/// `POST /api/vault/items`' 201 body
/// (`crates/pv-server/src/routes/vault.rs`'s `CreateItemResponse`).
struct CreateItemResponseBody: Decodable {
    let id: String
    let revision: Int
    let updated_at: String
}

/// `POST /api/vault/items/{id}/touch`'s 200 body
/// (`crates/pv-server/src/routes/vault.rs`'s `TouchItemResponse`). A
/// single-column update -- it deliberately carries no `revision`, because
/// `touch()` never bumps one (see `VaultAPI.touchItem`'s own note).
struct TouchItemResponseBody: Decodable {
    let last_used_at: String
}

/// `PUT /api/vault/items/{id}`'s 200 body
/// (`crates/pv-server/src/routes/vault.rs`'s `UpdateItemResponse`).
struct UpdateItemResponseBody: Decodable {
    let revision: Int
    let updated_at: String
}

/// `POST /api/vault/folders`'s 201 body
/// (`crates/pv-server/src/routes/folders.rs`'s `CreateFolderResponse`).
struct CreateFolderResponseBody: Decodable {
    let id: String
}

/// Distinguishable from a generic `PvApiError.httpError` -- 38-09, Task 2's
/// own requirement: a stale-revision 409 must surface as a CONFLICT the
/// interface can explain, not a generic failure. `lastEditorEmail` mirrors
/// `crates/pv-server/src/error.rs`'s `StaleRevisionShared` body shape
/// (`{"error": ..., "last_editor_email": ...}`), present only for a SHARED
/// item's conflict -- `nil` for a personal item's (that body has no such
/// key).
enum VaultAPIError: Error, CustomStringConvertible {
    case revisionConflict(lastEditorEmail: String?)

    var description: String {
        switch self {
        case let .revisionConflict(email):
            if let email {
                return "This item was changed elsewhere (by \(email)) -- refresh and try again."
            }
            return "This item was changed elsewhere -- refresh and try again."
        }
    }
}

/// Thin `URLSession` wrapper over `pv-server`'s vault routes. Stateless in
/// exactly the way `PvApiClient` is: the bearer token is supplied by an
/// injected closure on every call, never stored on this struct and never
/// logged (T-38-02-04).
struct VaultAPI {
    let baseURL: URL
    /// Supplies the current session token. A closure rather than a stored
    /// `String` so a token rotation or a lock cannot leave a stale copy alive
    /// inside this value.
    let tokenProvider: () -> String?

    /// Defaults to `.shared`. 38-09, Task 2's own testability requirement:
    /// the ordering/refusal guards in `VaultStore` need a FAKE transport a
    /// unit test can inject a throw into -- `URLSession.shared` cannot be
    /// swapped from inside a test. Production call sites never pass this
    /// argument, so nothing about the real network path changes.
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (vault, 38-02)"

    private struct CreateItemRequestBody: Encodable {
        /// Client-minted, and minted BEFORE encryption: `pv-core`'s AAD binds
        /// the ciphertext to this exact string, so the server cannot mint it
        /// (`vault.rs`'s `CreateItemRequest` doc comment says so itself).
        let id: String
        let enc_key: String
        let enc_data: String
    }

    private struct UpdateItemRequestBody: Encodable {
        let enc_key: String
        let enc_data: String
        let expected_revision: Int
    }

    private struct CreateFolderRequestBody: Encodable {
        let id: String
        let enc_name: String
    }

    /// `POST /api/vault/items`. Expects **201**.
    ///
    /// A 201 here is NOT evidence that the wire format is right -- the server
    /// never parses these two strings. Only a recipient-side decrypt in
    /// another client is (E-W1). Stated here because "the server accepted it"
    /// is the wrong proof and it is the tempting one.
    @discardableResult
    func createItem(id: String, encKeyJson: String, encDataJson: String) async throws
        -> CreateItemResponseBody
    {
        let body = try JSONEncoder().encode(
            CreateItemRequestBody(id: id, enc_key: encKeyJson, enc_data: encDataJson)
        )
        let (data, response) = try await send(
            path: "/api/vault/items", method: "POST", body: body, authenticated: true
        )
        try Self.requireStatus(201, response: response, data: data)
        return try Self.decode(CreateItemResponseBody.self, from: data)
    }

    /// `GET /api/sync?since=N`.
    func sync(since: Int) async throws -> SyncResponse {
        let (data, response) = try await send(
            path: "/api/sync?since=\(since)", method: "GET", body: nil, authenticated: true
        )
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode(SyncResponse.self, from: data)
    }

    /// `DELETE /api/vault/items/{id}`. Expects **204** (`vault.rs`'s
    /// `delete()`, `Ok(StatusCode::NO_CONTENT)`). Permanent -- there is no
    /// trash/soft-delete in this server (its own doc comment: "per
    /// CONTEXT.md's locked decision"). Added in plan 38-06, Task 2, as a
    /// Rule 2 deviation: the swipe-to-delete action the design requires has
    /// nowhere to call without this, and an action that LOOKS like it
    /// deletes but silently does nothing is exactly the "offer an operation
    /// known to fail" anti-pattern `ItemCapabilities.swift`'s own header
    /// warns against.
    func deleteItem(id: String) async throws {
        let (data, response) = try await send(
            path: "/api/vault/items/\(id)", method: "DELETE", body: nil, authenticated: true
        )
        try Self.requireStatus(204, response: response, data: data)
    }

    /// `POST /api/vault/items/{id}/touch`. Expects **200**.
    ///
    /// Added in plan 38-07, Task 1, as a Rule 3 deviation: the detail
    /// screen's reveal/copy last-used wiring has nowhere to call without
    /// this, and the route already exists on the server
    /// (`crates/pv-server/src/routes/vault.rs`'s `touch()`, wired at
    /// `routes/mod.rs`) -- unmodified, per this plan's environment rule 8.
    /// Records "this item's secret was just used" WITHOUT bumping
    /// `revision`, so it can never fabricate a stale-revision conflict for
    /// another device/tab.
    @discardableResult
    func touchItem(id: String) async throws -> TouchItemResponseBody {
        let (data, response) = try await send(
            path: "/api/vault/items/\(id)/touch", method: "POST", body: nil, authenticated: true
        )
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode(TouchItemResponseBody.self, from: data)
    }

    /// `PUT /api/vault/items/{id}`. Expects **200**. A **409** is NOT routed
    /// through `requireStatus`/`PvApiError.httpError` -- it is a distinct,
    /// expected outcome (the whole point of optimistic concurrency), not a
    /// generic failure, and `VaultStore.update` needs to tell it apart from
    /// every other error to refuse an overwrite rather than one.
    ///
    /// Added in plan 38-09, Task 2: the create/detail/list plans (38-02,
    /// 38-06, 38-07) never needed an update path; the real create/edit form
    /// does.
    @discardableResult
    func updateItem(id: String, encKeyJson: String, encDataJson: String, expectedRevision: Int) async throws
        -> UpdateItemResponseBody
    {
        let body = try JSONEncoder().encode(
            UpdateItemRequestBody(enc_key: encKeyJson, enc_data: encDataJson, expected_revision: expectedRevision)
        )
        let (data, response) = try await send(
            path: "/api/vault/items/\(id)", method: "PUT", body: body, authenticated: true
        )
        if response.statusCode == 409 {
            throw VaultAPIError.revisionConflict(lastEditorEmail: Self.extractLastEditorEmail(from: data))
        }
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode(UpdateItemResponseBody.self, from: data)
    }

    /// `{"error": ..., "last_editor_email": ...}` -- present only for a
    /// SHARED item's 409 (`crates/pv-server/src/error.rs`'s
    /// `StaleRevisionShared`); a personal item's 409 body has no such key at
    /// all, so this returns `nil` for that case rather than distinguishing
    /// "absent" from "null" (both mean the same thing here).
    private static func extractLastEditorEmail(from data: Data) -> String? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object["last_editor_email"] as? String
    }

    // MARK: - Folders (plan 38-09, Task 3)

    /// `POST /api/vault/folders`. Expects **201**. `id` MUST already be
    /// minted and its ciphertext bound to it -- see `FolderStore.create`'s
    /// own note; this function never mints anything.
    @discardableResult
    func createFolder(id: String, encNameJson: String) async throws -> CreateFolderResponseBody {
        let body = try JSONEncoder().encode(CreateFolderRequestBody(id: id, enc_name: encNameJson))
        let (data, response) = try await send(
            path: "/api/vault/folders", method: "POST", body: body, authenticated: true
        )
        try Self.requireStatus(201, response: response, data: data)
        return try Self.decode(CreateFolderResponseBody.self, from: data)
    }

    /// `DELETE /api/vault/folders/{id}`. Expects **204**. There is no
    /// update/rename verb for folders at all (L-18) -- this and `createFolder`
    /// are the only two mutations this file offers for the resource.
    func deleteFolder(id: String) async throws {
        let (data, response) = try await send(
            path: "/api/vault/folders/\(id)", method: "DELETE", body: nil, authenticated: true
        )
        try Self.requireStatus(204, response: response, data: data)
    }

    // MARK: - Transport

    private func send(
        path: String,
        method: String,
        body: Data?,
        authenticated: Bool
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
        if authenticated {
            guard let token = tokenProvider() else {
                throw PvApiError.unexpectedResponse("no session token available for \(path)")
            }
            // Verbatim, same discipline as PvApiClient's: session.rs hashes
            // the base64 STRING's bytes, not the decoded 32 bytes.
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
