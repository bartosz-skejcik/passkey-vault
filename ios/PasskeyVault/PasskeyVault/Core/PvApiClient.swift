//
//  PvApiClient.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-02. Faithfully
//  reimplements the REST contract `web/src/lib/auth/api.ts` already
//  establishes against the SAME, unmodified `pv-server` (ACC-01):
//  Bearer-header auth (never cookies), base64-encoded `auth_hash`/`salt`/
//  `pw_wrapped_uk` as opaque strings this client never decodes, endpoints
//  `/api/auth/{prelogin,register,login,logout,me}`.
//
//  `pw_wrapped_uk` and `auth_hash` cross this file as plain `String` and are
//  NEVER decoded/re-encoded here -- DR-37-A (`ios/IOS-SPIKE-LOG.md` §1)
//  makes `serde_json` (via `pv-ffi`'s `wrap_user_key_json`/
//  `unwrap_user_key_from_json`) the ONLY encoder/decoder for the envelope on
//  both clients; a Swift-side `Codable` `Data` field for either of those two
//  strings would silently produce base64 where the server (and every other
//  client) expects `serde_json`'s number-array shape.
//

import Foundation

/// `PvApiError` (the typed error surface this file's own `send`/`requireStatus` throws) moved to
/// `Shared/PvApiError.swift` by Plan 43-06, Task 1 -- `VaultAPI.swift`'s own move into `Shared/`
/// (reachable from `PasskeyVaultAutoFill`) needed this type visible there too, and it carries no
/// host-app-only dependency, so its declaration relocated rather than being duplicated. Same
/// module, unqualified reference below is unchanged.

/// Thin `URLSession` wrapper over `pv-server`'s `/api/auth/*` routes.
/// Stateless (no stored session token) -- every authenticated call takes its
/// bearer token as an explicit parameter, exactly the string the server
/// returned, never round-tripped through `Data(base64Encoded:)`.
struct PvApiClient {
    let baseURL: URL

    private static let userAgent = "PasskeyVault-iOS/1.0 (pv-ffi tracer, 37-02)"

    // MARK: - Wire shapes (CodingKeys are the exact snake_case names
    // `pv-server`'s serde structs use -- `crates/pv-server/src/routes/
    // auth.rs`, no rename attributes on either side).

    private struct KdfParamsBody: Codable {
        let m_cost_kib: UInt32
        let t_cost: UInt32
        let p_cost: UInt32
    }

    private struct PreloginResponseBody: Decodable {
        let kdf: KdfParamsBody
        let salt: String
    }

    private struct RegisterRequestBody: Encodable {
        let email: String
        let kdf: KdfParamsBody
        let salt: String
        let auth_hash: String
        let pw_wrapped_uk: String
    }

    private struct RegisterResponseBody: Decodable {
        let user_id: String
    }

    private struct LoginRequestBody: Encodable {
        let email: String
        let auth_hash: String
    }

    private struct LoginResponseBody: Decodable {
        let session_token: String
        let pw_wrapped_uk: String
    }

    private struct MeResponseBody: Decodable {
        let user_id: String
        let email: String
        let pw_wrapped_uk: String
    }

    private struct ServerErrorBody: Decodable {
        let error: String
    }

    // MARK: - Public API

    /// `POST /api/auth/prelogin`. Decodes the server's `kdf`/`salt` and
    /// RE-ENCODES `kdf` with `JSONEncoder` so `pv-ffi`'s
    /// `deriveAuthMaterial(kdfParamsJson:)` receives the exact three fields
    /// the server sent -- never a Swift-side default, never a numeric
    /// literal in this file.
    func preloginKdf(email: String) async throws -> (kdfParamsJson: String, saltB64: String) {
        let body = try JSONEncoder().encode(["email": email])
        let (data, response) = try await send(path: "/api/auth/prelogin", method: "POST", body: body, token: nil)
        try Self.requireStatus(200, response: response, data: data)
        let decoded = try Self.decode(PreloginResponseBody.self, from: data)
        let kdfJson = try Self.encodeUtf8String(decoded.kdf)
        return (kdfJson, decoded.salt)
    }

    /// `POST /api/auth/register`. Expects **201**; a 200 (or any other
    /// status) is treated as a contract violation and thrown, never silently
    /// accepted.
    func register(
        email: String,
        kdfParamsJson: String,
        saltB64: String,
        authHashB64: String,
        pwWrappedUk: String
    ) async throws -> String {
        let kdf: KdfParamsBody = try Self.decode(KdfParamsBody.self, from: Data(kdfParamsJson.utf8))
        let requestBody = RegisterRequestBody(
            email: email,
            kdf: kdf,
            salt: saltB64,
            auth_hash: authHashB64,
            pw_wrapped_uk: pwWrappedUk
        )
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(path: "/api/auth/register", method: "POST", body: body, token: nil)
        try Self.requireStatus(201, response: response, data: data)
        let decoded = try Self.decode(RegisterResponseBody.self, from: data)
        return decoded.user_id
    }

    /// `POST /api/auth/login`.
    func login(email: String, authHashB64: String) async throws -> (sessionToken: String, pwWrappedUk: String) {
        let requestBody = LoginRequestBody(email: email, auth_hash: authHashB64)
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(path: "/api/auth/login", method: "POST", body: body, token: nil)
        try Self.requireStatus(200, response: response, data: data)
        let decoded = try Self.decode(LoginResponseBody.self, from: data)
        return (decoded.session_token, decoded.pw_wrapped_uk)
    }

    /// `GET /api/auth/me`. Authenticated -- `token` is sent verbatim in the
    /// `Authorization: Bearer <token>` header, never re-encoded.
    func me(token: String) async throws -> (userId: String, email: String, pwWrappedUk: String) {
        let (data, response) = try await send(path: "/api/auth/me", method: "GET", body: nil, token: token)
        try Self.requireStatus(200, response: response, data: data)
        let decoded = try Self.decode(MeResponseBody.self, from: data)
        return (decoded.user_id, decoded.email, decoded.pw_wrapped_uk)
    }

    /// `POST /api/auth/logout`. Expects **204 with an empty body**.
    func logout(token: String) async throws {
        let (data, response) = try await send(path: "/api/auth/logout", method: "POST", body: nil, token: token)
        try Self.requireStatus(204, response: response, data: data)
    }

    // MARK: - Transport

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
            // Exactly one space, capital "B", the token string exactly as
            // received from the server -- never re-encoded via
            // Data(base64Encoded:)/.base64EncodedString() (ACC-03's own
            // transport-correctness note: session.rs hashes the base64
            // STRING's bytes, not the decoded 32 bytes).
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw PvApiError.network(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PvApiError.unexpectedResponse("response was not an HTTP response")
        }
        return (data, httpResponse)
    }

    // MARK: - Response handling helpers

    private static func requireStatus(_ expected: Int, response: HTTPURLResponse, data: Data) throws {
        if response.statusCode == expected {
            return
        }
        throw try errorFor(response: response, data: data)
    }

    /// Decodes the server's uniform error body `{"error": "<message>"}`.
    /// A 401 maps to `.invalidCredentials` regardless of the server's own
    /// message text (T-37-08 -- no hint about which of email/password was
    /// wrong). Every other non-matching status becomes `.httpError`.
    private static func errorFor(response: HTTPURLResponse, data: Data) throws -> PvApiError {
        if response.statusCode == 401 {
            return .invalidCredentials
        }
        let message: String
        if let body = try? JSONDecoder().decode(ServerErrorBody.self, from: data) {
            message = body.error
        } else {
            message = String(data: data, encoding: .utf8) ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        }
        return .httpError(status: response.statusCode, message: message)
    }

    private static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode \(type): \(error)")
        }
    }

    private static func encodeUtf8String<T: Encodable>(_ value: T) throws -> String {
        let data = try JSONEncoder().encode(value)
        guard let string = String(data: data, encoding: .utf8) else {
            throw PvApiError.unexpectedResponse("JSONEncoder produced non-UTF8 output")
        }
        return string
    }
}
