//
//  IdentityService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-02, Task 1.
//  The tracer's ONE path: `ensureOwnIdentityKeypair(userKey:)` -- the single
//  choke point through which every later Phase 40 plan obtains an
//  `FfiIdentityKey`. Mirrors `web/src/lib/identity/ensure.ts`'s
//  `ensureOwnIdentityKeypair` step order exactly (`git show
//  main:web/src/lib/identity/ensure.ts`, read this session): `GET
//  /api/identity/keypair` first; if the server already holds a keypair,
//  ADOPT it via `unwrapIdentitySecretKey` and return -- never publish a
//  second one; only if the server holds none, `generate()`, wrap, `PUT`,
//  and adopt the server's own canonical values if the response says
//  `adopted_existing` (the `ON CONFLICT DO NOTHING` race loser). The PUT
//  response ALREADY carries the canonical `wrapped_secret_key` in that case
//  (`crates/pv-server/src/routes/identity.rs`'s `upsert`, `RETURNING`/
//  `SELECT`-on-conflict) -- web's own source does not re-`GET` after a `PUT`
//  that reports `adopted_existing`, so this file does not either, even
//  though this plan's own prose paraphrase says "re-GET": the literal
//  instruction is "mirror ensure.ts exactly", and this is what ensure.ts
//  itself does.
//
//  DR-40-A (`ios/IOS-SPIKE-LOG.md` §1h): `wrapped_secret_key` crosses this
//  file as a plain `String`, produced/consumed ONLY by `pv-ffi`'s
//  `wrapIdentitySecretKey`/`unwrapIdentitySecretKey` -- never re-encoded by
//  Swift's `JSONEncoder`/`Codable` `Data`. `public_key` is DIFFERENT: per
//  `crates/pv-server/src/routes/identity.rs`'s `KeypairRequest`/
//  `KeypairResponse`, it is base64-`STANDARD`-encoded (NOT `serde_json`
//  array-shaped) on the wire -- this file base64-encodes/decodes it
//  directly, exactly the encoding the server's own `base64::engine::
//  general_purpose::STANDARD` expects, mirroring `PvApiClient.swift`'s own
//  `auth_hash`/salt precedent for a base64 field.
//

import Foundation

/// Thin `URLSession` wrapper over `pv-server`'s `/api/identity/*` routes.
/// Stateless like `VaultAPI`: the bearer token is supplied by an injected
/// closure, never stored.
struct IdentityService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-02)"

    private struct KeypairRequestBody: Encodable {
        let public_key: String
        let wrapped_secret_key: String
    }

    private struct KeypairResponseBody: Decodable {
        let public_key: String
        let wrapped_secret_key: String
        let adopted_existing: Bool
    }

    // MARK: - Public API

    /// On an account with no published keypair: generates one, publishes
    /// it, and returns a usable `FfiIdentityKey`. On an account that
    /// already has a published keypair: unwraps and returns THAT one,
    /// never generating a second. A concurrent race (two devices, one
    /// delayed) leaves exactly one canonical keypair published -- the
    /// loser's locally-generated handle is discarded in favor of the
    /// winner's published blob.
    func ensureOwnIdentityKeypair(userKey: FfiUserKey) async throws -> FfiIdentityKey {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/identity/keypair")
        }

        if let existing = try await fetchExistingKeypair(token: token) {
            let isk = try unwrapIdentitySecretKey(uk: userKey, wrappedJson: existing.wrapped_secret_key)
            try Self.assertOwnPublicKeyMatches(isk: isk, serverPublicKeyB64: existing.public_key)
            return isk
        }

        let isk = try FfiIdentityKey.generate()
        let wrappedJson = try wrapIdentitySecretKey(uk: userKey, isk: isk)
        // The FFI-returned public key bytes, base64-`STANDARD`-encoded --
        // NEVER re-derived from anything Swift computed itself.
        let publicKeyB64 = isk.publicKeyBytes().base64EncodedString()

        let response = try await putKeypair(
            token: token,
            publicKeyB64: publicKeyB64,
            wrappedSecretKeyJson: wrappedJson
        )

        if response.adopted_existing {
            // A concurrent caller won the race -- discard the
            // locally-generated `isk` and adopt the server's canonical
            // one instead (see this file's header).
            let adopted = try unwrapIdentitySecretKey(uk: userKey, wrappedJson: response.wrapped_secret_key)
            try Self.assertOwnPublicKeyMatches(isk: adopted, serverPublicKeyB64: response.public_key)
            return adopted
        }

        return isk
    }

    /// WR-01: in a zero-knowledge threat model the server is untrusted --
    /// it could serve this account's genuine (AEAD-protected, unforgeable)
    /// `wrapped_secret_key` while advertising an ATTACKER's `public_key` to
    /// the rest of the family. Every other member would then seal
    /// Collection Keys to the attacker, and this account would never
    /// notice (it only ever unwrapped its own secret key -- it never
    /// looked at the published public key at all). Fail closed rather than
    /// silently continue using a keypair this account cannot vouch for.
    private static func assertOwnPublicKeyMatches(isk: FfiIdentityKey, serverPublicKeyB64: String) throws {
        let ownPublicKeyB64 = isk.publicKeyBytes().base64EncodedString()
        guard ownPublicKeyB64 == serverPublicKeyB64 else {
            throw PvApiError.unexpectedResponse(
                "published identity public_key does not match this account's own identity key -- refusing to adopt it"
            )
        }
    }

    // MARK: - Transport

    /// `GET /api/identity/keypair`. Returns `nil` on a `404` (the caller
    /// has not published a keypair yet) -- every other non-2xx status is a
    /// thrown `PvApiError`.
    private func fetchExistingKeypair(token: String) async throws -> KeypairResponseBody? {
        let (data, response) = try await send(
            path: "/api/identity/keypair", method: "GET", body: nil, token: token
        )
        if response.statusCode == 404 {
            return nil
        }
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode(KeypairResponseBody.self, from: data)
    }

    /// `PUT /api/identity/keypair`. Idempotent, self-healing upsert --
    /// `crates/pv-server/src/routes/identity.rs`'s `upsert` doc comment.
    private func putKeypair(
        token: String,
        publicKeyB64: String,
        wrappedSecretKeyJson: String
    ) async throws -> KeypairResponseBody {
        let requestBody = KeypairRequestBody(
            public_key: publicKeyB64,
            wrapped_secret_key: wrappedSecretKeyJson
        )
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(
            path: "/api/identity/keypair", method: "PUT", body: body, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        return try Self.decode(KeypairResponseBody.self, from: data)
    }

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
