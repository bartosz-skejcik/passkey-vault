//
//  ShareItemUpdateTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), CR-08: `ShareItemView.share()`'s 409 branch
//  now discriminates -- a re-share at a DIFFERENT access level attempts
//  `FamilyAPI.updateItemShare` (PUT .../shares/{user_id}) instead of
//  silently reporting the stale grant as success. `share()` itself is a
//  `private` method on a `View` struct (file-scoped in Swift -- not reachable
//  even via `@testable import`), so this file proves the plumbing CR-08's
//  fix actually depends on: `createItemShare` returning a 409 that
//  `ResealService.isConflictError` recognizes, and the NEW
//  `FamilyAPI.updateItemShare` sending the right method/path/body to the
//  right endpoint and mapping the server's success/failure statuses
//  correctly. A minimal in-process `URLProtocol` fake -- no live server --
//  mirrors `ResealFakeServerURLProtocol`'s established precedent for this
//  phase's test suite.
//

import Foundation
import Testing
@testable import PasskeyVault

/// Same file-scoped-copy discipline as `ResealTriggerTests.swift`/
/// `Fsh02ReceiveTests.swift`/`InviteTests.swift`/`VaultMutationTests.swift`
/// -- a top-level `private extension` does not collide across files.
private extension URLRequest {
    func httpBodyOrStream() -> Data {
        if let body = self.httpBody { return body }
        guard let stream = self.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 4096
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            if read > 0 { data.append(buffer, count: read) } else { break }
        }
        return data
    }
}

/// Answers exactly the two routes CR-08's fix touches:
/// `POST /api/vault/items/{id}/shares` (configurable status, simulates the
/// pre-existing-grant 409) and `PUT /api/vault/items/{id}/shares/{user_id}`
/// (captures the request body so a test can assert the SENT access_level).
final class ShareUpdateFakeServerURLProtocol: URLProtocol, @unchecked Sendable {
    static var createResponseStatus = 201
    static var updateResponseStatus = 204
    static var capturedUpdateBody: [String: Any]?
    static var capturedUpdatePath: String?

    static func reset() {
        createResponseStatus = 201
        updateResponseStatus = 204
        capturedUpdateBody = nil
        capturedUpdatePath = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private func respond(_ status: Int, _ obj: Any) {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func startLoading() {
        let method = request.httpMethod ?? ""
        let path = request.url?.path ?? ""

        if method == "POST", path.hasSuffix("/shares") {
            if Self.createResponseStatus == 201 {
                respond(201, [:])
            } else {
                respond(Self.createResponseStatus, ["error": "conflict"])
            }
            return
        }

        if method == "PUT", path.contains("/shares/") {
            Self.capturedUpdatePath = path
            Self.capturedUpdateBody = (try? JSONSerialization.jsonObject(
                with: request.httpBodyOrStream()
            )) as? [String: Any]
            if Self.updateResponseStatus == 204 {
                respond(204, [:])
            } else {
                respond(Self.updateResponseStatus, ["error": "not found"])
            }
            return
        }

        respond(404, ["error": "unhandled route in ShareUpdateFakeServerURLProtocol: \(method) \(path)"])
    }

    override func stopLoading() {}
}

/// `.serialized`: every test mutates the SAME static
/// `ShareUpdateFakeServerURLProtocol` state (mirrors `ResealTriggerTests`'
/// own identical note) -- Swift Testing parallelizes sibling tests within a
/// suite by default, which would otherwise race `reset()`/response-status
/// writes across concurrently-running tests.
@Suite(.serialized)
@MainActor
struct ShareItemUpdateTests {

    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ShareUpdateFakeServerURLProtocol.self]
        return URLSession(configuration: config)
    }

    private static func makeAPI() -> FamilyAPI {
        FamilyAPI(baseURL: URL(string: "https://fixture.invalid")!, tokenProvider: { "fixture-token" }, session: makeSession())
    }

    /// The precondition CR-08's discrimination depends on: a 409 from
    /// `createItemShare` must be recognized by `ResealService.isConflictError`,
    /// exactly as it is for `ResealService`'s own call site.
    @Test func createItemShareConflictIsRecognizedByIsConflictError() async throws {
        ShareUpdateFakeServerURLProtocol.reset()
        ShareUpdateFakeServerURLProtocol.createResponseStatus = 409
        let api = Self.makeAPI()

        do {
            try await api.createItemShare(
                itemId: "item-1", recipientUserId: "user-2", sealedKeyJson: "{}", accessLevel: "edit"
            )
            Issue.record("expected a 409 to throw")
        } catch {
            #expect(ResealService.isConflictError(error), "a 409 from createItemShare must satisfy isConflictError")
        }
    }

    /// THE decisive test (CR-08's own fix note): `updateItemShare` sends a
    /// `PUT` to the per-recipient shares endpoint with the NEW access level
    /// in the body, and succeeds on the server's documented 204.
    ///
    /// Falsifiability: before this fix, `ShareItemView`'s 409 branch never
    /// called this endpoint at all -- a re-share at a different level was
    /// reported as success with NOTHING sent to the server. This test pins
    /// that the plumbing this fix depends on actually reaches the right
    /// route with the right payload.
    @Test func updateItemShareSendsAPutWithTheNewAccessLevelAndSucceedsOn204() async throws {
        ShareUpdateFakeServerURLProtocol.reset()
        let api = Self.makeAPI()

        try await api.updateItemShare(itemId: "item-1", recipientUserId: "user-2", accessLevel: "hidden_password")

        #expect(ShareUpdateFakeServerURLProtocol.capturedUpdatePath == "/api/vault/items/item-1/shares/user-2")
        #expect(ShareUpdateFakeServerURLProtocol.capturedUpdateBody?["access_level"] as? String == "hidden_password")
    }

    /// `update_share`'s own doc comment (`crates/pv-server/src/routes/
    /// vault.rs`): a `PUT` against a pair with no existing `item_shares` row
    /// is a 404, never a silent upsert -- `updateItemShare` must propagate
    /// that as a thrown error, not swallow it.
    @Test func updateItemShareThrowsOnA404NeverSilentlySucceeding() async throws {
        ShareUpdateFakeServerURLProtocol.reset()
        ShareUpdateFakeServerURLProtocol.updateResponseStatus = 404
        let api = Self.makeAPI()

        await #expect(throws: (any Error).self) {
            try await api.updateItemShare(itemId: "item-1", recipientUserId: "user-2", accessLevel: "hidden_password")
        }
    }
}
