//
//  VaultMutationTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 2.
//
//  Two boundaries this file exercises separately, deliberately:
//
//  * A FAKE transport (`VaultMutationStubURLProtocol`, same shape as
//    `ServerReachabilityTests.swift`'s `ReachabilityStubURLProtocol`) --
//    this is what makes the ordering and refusal guards unit-testable at
//    all: injecting a throw into a REAL network call and asserting on
//    `VaultStore.items` afterward.
//  * The REAL crypto (`FfiUserKey`, `encryptItemWire`/`decryptItemWire`) --
//    a green test over a mocked crypto layer is not evidence for anything
//    crypto-adjacent (`VaultStoreRoundTripTests.swift`'s own header), so the
//    associated-data test and the live-conflict test both drive the real
//    `pv-ffi` framework, the live one against a real, running `pv-server`.
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Fake transport

/// Answers requests via a per-test handler closure keyed on
/// `(method, path)`. Registered ONLY on an ephemeral `URLSessionConfiguration`
/// built per test (`VaultMutationTests.stubSession`), never via the global
/// `URLProtocol.registerClass(_:)`.
final class VaultMutationStubURLProtocol: URLProtocol, @unchecked Sendable {
    /// `nil` return means "fail this request" (used to prove the ordering
    /// guard: the awaited call throws, and nothing after it may run).
    static var handler: (@Sendable (URLRequest) -> (Int, Data)?)?
    /// Incremented on every `startLoading()` -- the refusal test's own
    /// falsifiable assertion that NO request was ever attempted.
    static let requestCount = Counter()

    final class Counter: @unchecked Sendable {
        private var value = 0
        private let lock = NSLock()
        func increment() { lock.lock(); value += 1; lock.unlock() }
        func read() -> Int { lock.lock(); defer { lock.unlock() }; return value }
        func reset() { lock.lock(); value = 0; lock.unlock() }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requestCount.increment()
        guard let handler = Self.handler, let url = request.url,
              let (status, body) = handler(request)
        else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// `.serialized`: every test mutates the SAME static
/// `VaultMutationStubURLProtocol.handler`/`.requestCount` -- Swift Testing
/// runs `@Test` methods concurrently by default, which would race two tests
/// setting different handlers against the same class properties (the exact
/// hazard `FaviconLoaderPersistenceProofTests.swift` and
/// `ServerReachabilityTests.swift` already document this same fix for).
@Suite(.serialized)
struct VaultMutationTests {

    private static func stubSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [VaultMutationStubURLProtocol.self]
        VaultMutationStubURLProtocol.requestCount.reset()
        return URLSession(configuration: config)
    }

    private static let fakeBaseURL = URL(string: "https://vault-mutation-tests.invalid")!

    // MARK: - Create: mints a lowercase id, revision one

    @MainActor
    @Test func createMintsLowercaseIdentifierAndRevisionOne() async throws {
        let userKey = try FfiUserKey.generate()
        var capturedId: String?
        VaultMutationStubURLProtocol.handler = { request in
            guard request.httpMethod == "POST", request.url?.path == "/api/vault/items" else { return nil }
            let body = try? JSONSerialization.jsonObject(with: request.httpBodyOrStream()) as? [String: Any]
            capturedId = body?["id"] as? String
            let responseJSON = #"{"id":"\#(capturedId ?? "")","revision":1,"updated_at":"2026-08-17T00:00:00Z"}"#
            return (201, Data(responseJSON.utf8))
        }
        let api = VaultAPI(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let store = VaultStore(userKey: userKey, api: api)

        let created = try await store.create(fields: .note(NoteFields(name: "x", folderId: nil, tags: [], body: "y")))

        #expect(created.revision == 1)
        #expect(created.id.range(of: "^[0-9a-f-]{36}$", options: .regularExpression) != nil)
        #expect(capturedId == created.id)
    }

    // MARK: - The optimistic-concurrency guard itself

    /// The must-have this task exists to satisfy, asserted directly rather
    /// than only implicitly by the live conflict test below: the PUT's
    /// `expected_revision` is the item's CURRENT revision (never `revision
    /// + 1` -- that is the value the ciphertext is encrypted AT, a
    /// different number carried in the URL/AAD, not sent as the guard).
    @MainActor
    @Test func updateSendsTheItemsCurrentRevisionAsTheExpectedRevisionGuard() async throws {
        let userKey = try FfiUserKey.generate()
        var capturedExpectedRevision: Int?
        VaultMutationStubURLProtocol.handler = { request in
            if request.httpMethod == "POST", request.url?.path == "/api/vault/items" {
                let body = try? JSONSerialization.jsonObject(with: request.httpBodyOrStream()) as? [String: Any]
                let id = body?["id"] as? String ?? ""
                return (201, Data(#"{"id":"\#(id)","revision":1,"updated_at":"2026-08-17T00:00:00Z"}"#.utf8))
            }
            if request.httpMethod == "PUT" {
                let body = try? JSONSerialization.jsonObject(with: request.httpBodyOrStream()) as? [String: Any]
                capturedExpectedRevision = body?["expected_revision"] as? Int
                return (200, Data(#"{"revision":2,"updated_at":"2026-08-17T00:01:00Z"}"#.utf8))
            }
            return nil
        }
        let api = VaultAPI(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let store = VaultStore(userKey: userKey, api: api)
        let created = try await store.create(fields: .note(NoteFields(name: "x", folderId: nil, tags: [], body: "y")))
        #expect(created.revision == 1)

        let updated = try await store.update(created, fields: .note(NoteFields(name: "x2", folderId: nil, tags: [], body: "y2")))

        #expect(capturedExpectedRevision == 1, "expected_revision must be the item's CURRENT revision, not the new one")
        #expect(updated.revision == 2, "local state adopts the server's own post-update revision")
    }

    // MARK: - Ordering: local bookkeeping strictly after the awaited call

    /// This exact hazard ("a thrown error reported over a completed server
    /// mutation") has recurred THREE times in this repository, in three
    /// different functions (`ios/IOS-SPIKE-LOG.md`). This test injects a
    /// throw on the CREATE call and asserts the local array is untouched --
    /// an assertion on state after an injected throw, not a comment.
    @MainActor
    @Test func createDoesNotAppendLocallyWhenTheNetworkCallThrows() async throws {
        let userKey = try FfiUserKey.generate()
        VaultMutationStubURLProtocol.handler = { _ in nil } // every request fails
        let api = VaultAPI(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let store = VaultStore(userKey: userKey, api: api)

        await #expect(throws: (any Error).self) {
            _ = try await store.create(fields: .note(NoteFields(name: "x", folderId: nil, tags: [], body: "y")))
        }
        #expect(store.items.isEmpty, "a thrown create must never leave a local row behind")
    }

    /// The SAME hazard, on `update` -- a stale/failed PUT must never replace
    /// the in-memory item with the failed edit.
    @MainActor
    @Test func updateDoesNotMutateLocalStateWhenTheNetworkCallThrows() async throws {
        let userKey = try FfiUserKey.generate()
        VaultMutationStubURLProtocol.handler = { request in
            guard request.httpMethod == "POST", request.url?.path == "/api/vault/items" else { return nil }
            let body = try? JSONSerialization.jsonObject(with: request.httpBodyOrStream()) as? [String: Any]
            let id = body?["id"] as? String ?? ""
            return (201, Data(#"{"id":"\#(id)","revision":1,"updated_at":"2026-08-17T00:00:00Z"}"#.utf8))
        }
        let api = VaultAPI(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let store = VaultStore(userKey: userKey, api: api)
        let created = try await store.create(
            fields: .note(NoteFields(name: "original", folderId: nil, tags: [], body: "orig"))
        )

        // Now make every request fail -- the update's PUT must throw.
        VaultMutationStubURLProtocol.handler = { _ in nil }

        await #expect(throws: (any Error).self) {
            _ = try await store.update(created, fields: .note(NoteFields(name: "changed", folderId: nil, tags: [], body: "changed")))
        }
        #expect(store.items.count == 1)
        #expect(store.items[0].fields?.name == "original", "a thrown update must never replace the local copy with the failed edit")
    }

    // MARK: - Refusal over an undecryptable row

    /// Refused BEFORE any request is made -- asserted via the fake
    /// transport's own `requestCount`, not merely "the update failed".
    @MainActor
    @Test func updateRefusesAnUndecryptableRowBeforeAnyRequestIsMade() async throws {
        let userKey = try FfiUserKey.generate()
        VaultMutationStubURLProtocol.handler = { _ in (200, Data()) } // would succeed if ever called
        let api = VaultAPI(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let store = VaultStore(userKey: userKey, api: api)

        let staleUndecryptable = VaultItemViewModel(
            id: VaultStore.mintItemId(), revision: 7, content: .undecryptable(reason: "test fixture")
        )

        await #expect(throws: VaultStoreError.self) {
            _ = try await store.update(
                staleUndecryptable, fields: .note(NoteFields(name: "x", folderId: nil, tags: [], body: "y"))
            )
        }
        #expect(VaultMutationStubURLProtocol.requestCount.read() == 0, "no request may be attempted over an undecryptable row")
    }

    // MARK: - Delete: local removal only after server confirmation

    @MainActor
    @Test func deleteRemovesLocallyOnlyAfterTheServerConfirms() async throws {
        let userKey = try FfiUserKey.generate()
        VaultMutationStubURLProtocol.handler = { request in
            if request.httpMethod == "POST", request.url?.path == "/api/vault/items" {
                let body = try? JSONSerialization.jsonObject(with: request.httpBodyOrStream()) as? [String: Any]
                let id = body?["id"] as? String ?? ""
                return (201, Data(#"{"id":"\#(id)","revision":1,"updated_at":"2026-08-17T00:00:00Z"}"#.utf8))
            }
            return nil // DELETE fails
        }
        let api = VaultAPI(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let store = VaultStore(userKey: userKey, api: api)
        let created = try await store.create(fields: .note(NoteFields(name: "x", folderId: nil, tags: [], body: "y")))

        await #expect(throws: (any Error).self) {
            try await store.delete(created)
        }
        #expect(store.items.count == 1, "a thrown delete must leave the item visible")
    }

    // MARK: - Associated-data binding: revision is live, not decorative

    /// `crates/pv-core/src/items.rs`: the key-wrap AAD always uses revision
    /// ZERO, but the PAYLOAD AAD binds the real revision -- a round trip
    /// encrypted at revision 1 and decrypted at revision 2 must fail. This
    /// is the exact rollback/splice protection T-38-09's threat register
    /// names, observed here from Swift rather than only in `pv-core`'s own
    /// Rust suite.
    @Test func decryptingAtAMismatchedRevisionFailsProvingTheAssociatedDataBindingIsLive() throws {
        let userKey = try FfiUserKey.generate()
        let id = VaultStore.mintItemId()
        let wire = try encryptItemWire(
            userKey: userKey,
            plaintext: #"{"type":"note","name":"x","folderId":null,"tags":[],"body":"y"}"#,
            itemId: id,
            revision: 1
        )
        #expect(throws: (any Error).self) {
            _ = try decryptItemWire(
                userKey: userKey, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson,
                itemId: id, revision: 2
            )
        }
        // Falsifies the falsification: the SAME revision must still decrypt
        // -- if this line threw, the test above would not be evidence of
        // anything (it would mean revision 1 never decrypted either).
        _ = try decryptItemWire(
            userKey: userKey, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson,
            itemId: id, revision: 1
        )
    }

    // MARK: - Live: a real stale-revision conflict against `pv-server`

    private static var liveBaseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    private static func freshEmail() -> String {
        "ios-vault-mutation-\(UUID().uuidString.lowercased())@example.com"
    }

    private static let fixturePassword = "correct horse battery staple (38-09 VaultMutationTests)"

    /// The plan's own acceptance criterion: "a live conflict is produced
    /// against the running server -- edit the same item from the web client
    /// and then save from the phone -- and the phone shows a conflict
    /// message rather than overwriting." `web/node_modules` does not exist
    /// in this worktree (the same limitation E-W1/L-17 already records), so
    /// there is no running browser to drive here -- the "other client"'s
    /// edit is a second, real `updateItem` PUT against the SAME live
    /// `pv-server`, bumping the row's revision exactly the way any second
    /// writer (browser, another phone) would. The phone's own `VaultStore
    /// .update` is then attempted with the now-STALE local revision, through
    /// the real save code path `ItemFormView` calls, and is asserted to
    /// throw `VaultAPIError.revisionConflict` -- never overwrite -- and the
    /// local item is asserted UNCHANGED afterward.
    @MainActor
    @Test func aLiveStaleRevisionConflictIsSurfacedAndDoesNotOverwrite() async throws {
        let email = Self.freshEmail()
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.liveBaseURL))
        let session = try await accountService.register(email: email, password: Self.fixturePassword)

        let api = VaultAPI(baseURL: Self.liveBaseURL, tokenProvider: { session.token })
        let store = VaultStore(userKey: session.userKey, api: api)

        let created = try await store.create(
            fields: .note(NoteFields(name: "conflict fixture", folderId: nil, tags: [], body: "v1"))
        )
        #expect(created.revision == 1)

        // "The web client" (or any other device) edits the SAME item first,
        // via a second, independent `updateItem` call against the SAME live
        // server -- bumping the row to revision 2 without the phone's
        // `VaultStore` ever hearing about it.
        let otherWirePlaintext = try ItemNormalize.plaintextJSON(
            for: .note(NoteFields(name: "conflict fixture", folderId: nil, tags: [], body: "edited elsewhere"))
        )
        let otherWire = try encryptItemWire(
            userKey: session.userKey, plaintext: otherWirePlaintext, itemId: created.id, revision: 2
        )
        _ = try await api.updateItem(
            id: created.id, encKeyJson: otherWire.encKeyJson, encDataJson: otherWire.encDataJson,
            expectedRevision: 1
        )

        // The phone, still holding the STALE revision-1 copy, now tries to
        // save through the REAL `VaultStore.update` path.
        await #expect(throws: VaultAPIError.self) {
            _ = try await store.update(
                created, fields: .note(NoteFields(name: "conflict fixture", folderId: nil, tags: [], body: "phone's own edit"))
            )
        }

        // Never overwritten: the local copy is still the pre-conflict one.
        #expect(store.items.count == 1)
        #expect(store.items[0].revision == 1)
        #expect(store.items[0].fields?.name == "conflict fixture")

        // Read back from the server: the OTHER client's edit is the one
        // that stuck, never the phone's.
        let sync = try await api.sync(since: 0)
        guard case let .snapshot(_, rows, _) = sync, let row = rows.first(where: { $0.id == created.id }) else {
            Issue.record("created item did not appear in the sync snapshot")
            return
        }
        #expect(row.revision == 2)
    }
}

// MARK: - HTTPBodyStream helper

private extension URLRequest {
    /// `URLProtocol`-intercepted requests sometimes carry the body as
    /// `httpBodyStream` rather than `httpBody` (Foundation's own transport
    /// choice, not something this file controls) -- this reads either.
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
