//
//  InviteTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06. ONE Swift
//  Testing suite -- deliberately not split into pure/live sibling types the
//  way `FfiSharingTests`/`FfiSharingLiveProofTests` are, because this
//  plan's own `<verify>` commands target `PasskeyVaultTests/InviteTests`
//  (Tasks 1-2, no server) and
//  `PasskeyVaultTests/InviteTests/liveInviteRedeemedByWebAccount` (Task 3,
//  live) as the SAME suite, by name.
//
//  Task 1: the two base64 alphabets (`Base64Alphabets.swift`).
//  Task 2: `InviteService.generateInviteLink` -- pure, network-free via a
//  fake `URLProtocol` transport (`InviteTestsStubURLProtocol`, same shape
//  as `VaultMutationTests.swift`'s `VaultMutationStubURLProtocol`).
//  Task 3: `liveInviteRedeemedByWebAccount` -- E-F2, live, against a real
//  `pv-server` and the `scripts/invite-live-e2e.mjs` Node/pv-wasm harness
//  (the SECOND real client, per this plan's own phase-context override:
//  redemption happens through the established pv-wasm Node driver pattern,
//  not an actual browser page load of `/invite/{id}`).
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Task 1: the two base64 alphabets

extension InviteTests {

    /// Fixed 32-byte literal whose STANDARD base64 encoding contains at
    /// least one `+` and one `/` -- chosen deliberately (computed offline,
    /// never derived from the code under test) so the two alphabets
    /// visibly diverge and a swapped helper cannot pass.
    static let alphabetFixtureBytes: [UInt8] = [
        0xb4, 0xe2, 0xe3, 0x75, 0x80, 0x3c, 0xd1, 0xcc, 0x5c, 0xee, 0xdb, 0x34, 0x83, 0xe3, 0xb3, 0x6b,
        0x2c, 0xf3, 0x95, 0x34, 0x4d, 0x0f, 0xd0, 0x5a, 0x88, 0x27, 0x7f, 0xe8, 0xc5, 0xf3, 0x8c, 0x78,
    ]
    static var alphabetFixtureData: Data { Data(alphabetFixtureBytes) }
    static let expectedUrlSafeNoPad = "tOLjdYA80cxc7ts0g-OzayzzlTRND9BaiCd_6MXzjHg"
    static let expectedStandard = "tOLjdYA80cxc7ts0g+OzayzzlTRND9BaiCd/6MXzjHg="
}

/// `.serialized`: Task 2's tests all mutate the SAME static
/// `InviteTestsStubURLProtocol.handler` -- Swift Testing runs `@Test`
/// methods concurrently by default, which would race two tests setting
/// different handlers against the same class property (the exact hazard
/// `VaultMutationTests.swift`/`ShareMarkerTests.swift` already document
/// this same fix for). Task 3's live test additionally touches a real,
/// process-wide `pv-server` connection -- serializing the whole suite
/// avoids that racing too.
@Suite(.serialized)
struct InviteTests {

    @Test func urlSafeNoPadEncodingMatchesHardCodedLiteral() {
        let encoded = UrlSafeNoPadBase64.encode(Self.alphabetFixtureData)
        #expect(encoded == Self.expectedUrlSafeNoPad)
        #expect(!encoded.contains("="))
        #expect(encoded.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil)
    }

    @Test func urlSafeNoPadRoundTripRecoversOriginalBytes() throws {
        let encoded = UrlSafeNoPadBase64.encode(Self.alphabetFixtureData)
        let decoded = try UrlSafeNoPadBase64.decode(encoded)
        #expect(decoded == Self.alphabetFixtureData)
    }

    @Test func standardEncodingMatchesHardCodedLiteralAndContainsPlusAndSlash() {
        let encoded = StandardBase64.encode(Self.alphabetFixtureData)
        #expect(encoded == Self.expectedStandard)
        #expect(encoded.contains("+"))
        #expect(encoded.contains("/"))
        #expect(encoded != Self.expectedUrlSafeNoPad, "the two encodings of the SAME bytes must visibly differ")
    }

    @Test func standardRoundTripRecoversOriginalBytes() throws {
        let encoded = StandardBase64.encode(Self.alphabetFixtureData)
        let decoded = try StandardBase64.decode(encoded)
        #expect(decoded == Self.alphabetFixtureData)
    }

    /// `expectedUrlSafeNoPad` contains `-`/`_`, which are NOT members of
    /// the standard base64 alphabet -- `StandardBase64.decode` must throw,
    /// never silently produce different-but-plausible-looking bytes. This
    /// is the acceptance criterion's "round-tripping through the WRONG
    /// helper does not silently produce plausible-looking bytes",
    /// demonstrated as a thrown error rather than a byte mismatch.
    @Test func decodingUrlSafeStringWithStandardDecoderThrowsRatherThanRecoveringWrongBytes() {
        let urlSafeEncoded = UrlSafeNoPadBase64.encode(Self.alphabetFixtureData)
        #expect(urlSafeEncoded.contains("-") || urlSafeEncoded.contains("_"),
                "the fixture must exercise the divergence -- otherwise this test proves nothing")
        #expect(throws: (any Error).self) {
            _ = try StandardBase64.decode(urlSafeEncoded)
        }
    }
}

// MARK: - Task 2: InviteService.generateInviteLink, fake transport

/// Answers requests via a per-test handler closure keyed on
/// `(method, path)`. Registered ONLY on an ephemeral
/// `URLSessionConfiguration` built per test (`InviteTests.stubSession`),
/// never via the global `URLProtocol.registerClass(_:)` -- same shape as
/// `VaultMutationTests.swift`'s `VaultMutationStubURLProtocol`.
final class InviteTestsStubURLProtocol: URLProtocol, @unchecked Sendable {
    /// `nil` return means "fail this request".
    static var handler: (@Sendable (URLRequest) -> (Int, Data)?)?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
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

// MARK: - HTTPBodyStream helper (mirrors VaultMutationTests.swift's own copy)

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

extension InviteTests {
    fileprivate static func stubSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [InviteTestsStubURLProtocol.self]
        return URLSession(configuration: config)
    }

    fileprivate static let fakeBaseURL = URL(string: "https://invite-tests.invalid")!

    /// Builds the `GET /api/identity/keypair` 200 response body carrying
    /// `identityKey` (already wrapped under `userKey`) as the "existing"
    /// keypair -- `IdentityService.ensureOwnIdentityKeypair` adopts it
    /// without generating a second one, so every Task 2 test controls
    /// exactly which identity key `InviteService` ends up using.
    fileprivate static func keypairResponseJSON(userKey: FfiUserKey, identityKey: FfiIdentityKey) throws -> Data {
        let wrappedJson = try wrapIdentitySecretKey(uk: userKey, isk: identityKey)
        let publicKeyB64 = identityKey.publicKeyBytes().base64EncodedString()
        let obj: [String: Any] = [
            "public_key": publicKeyB64,
            "wrapped_secret_key": wrappedJson,
            "adopted_existing": false,
        ]
        return try JSONSerialization.data(withJSONObject: obj)
    }

    /// One fabricated `/api/vault/collections` row -- field names match
    /// `CollectionResponse` (`crates/pv-server/src/routes/collections.rs`)
    /// exactly.
    fileprivate static func collectionRowJSON(
        id: String, accessLevel: String?, sealedKey: String?,
        familyWideKind: String?, familyWideAccessLevel: Any?
    ) -> [String: Any] {
        var obj: [String: Any] = [
            "id": id, "enc_name": "ignored", "created_at": "2026-08-19T00:00:00Z",
        ]
        obj["access_level"] = accessLevel ?? NSNull()
        obj["sealed_key"] = sealedKey ?? NSNull()
        obj["family_wide_kind"] = familyWideKind ?? NSNull()
        obj["family_wide_access_level"] = familyWideAccessLevel ?? NSNull()
        return obj
    }
}

extension InviteTests {

    /// `A test asserts the produced URL matches ...` -- Task 2's own
    /// acceptance criterion, verbatim. No family-wide collections in this
    /// fixture (`GET /api/vault/collections` answers `[]`) -- this test is
    /// about the URL SHAPE, not the fold-in (that is the next two tests'
    /// job).
    @Test func generatedURLMatchesShapeAndPathIdEqualsChannelInviteIdForSameSecret() async throws {
        let userKey = try FfiUserKey.generate()
        let identityKey = try FfiIdentityKey.generate()

        InviteTestsStubURLProtocol.handler = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/identity/keypair"):
                return (200, (try? Self.keypairResponseJSON(userKey: userKey, identityKey: identityKey)) ?? Data())
            case ("GET", "/api/vault/collections"):
                return (200, Data("[]".utf8))
            case ("POST", "/api/invitations"):
                let body = (try? JSONSerialization.jsonObject(with: request.httpBodyOrStream())) as? [String: Any]
                let id = (body?["id"] as? String) ?? ""
                return (201, Data(#"{"id":"\#(id)","expires_at":"2026-08-19T01:00:00Z"}"#.utf8))
            default:
                return nil
            }
        }

        let service = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let url = try await service.generateInviteLink(userKey: userKey, expiresIn: "1h")

        #expect(
            url.absoluteString.range(
                of: #"^https?://[^/]+/invite/[0-9a-zA-Z_-]+#[A-Za-z0-9_-]+$"#, options: .regularExpression
            ) != nil,
            "unexpected URL shape: \(url.absoluteString)"
        )

        guard let fragment = url.fragment else {
            Issue.record("generated URL carried no fragment: \(url.absoluteString)")
            return
        }
        #expect(!fragment.contains("="))
        #expect(!fragment.contains("+"))
        #expect(!fragment.contains("/"))

        let pathId = url.pathComponents.last ?? ""
        let recoveredSecret = try UrlSafeNoPadBase64.decode(fragment)
        let independentChannel = try FfiInviteChannel.fromSecret(secret: recoveredSecret)
        #expect(independentChannel.inviteId() == pathId, "the path id must equal FfiInviteChannel.inviteId() for the SAME secret")
    }

    /// The exact over-grant this plan's precondition exists to prevent: a
    /// family-wide row declared `read` (the SHARE's own level), held by a
    /// caller whose own `collection_keys` row is `edit` (the propagator's
    /// held level -- `collections::create`'s hard-coded creator row), must
    /// produce an entry carrying `read`, never `edit`.
    @Test func familyWideFoldInCarriesTheShareOwnLevelNeverTheCallerHeldLevel() async throws {
        let userKey = try FfiUserKey.generate()
        let identityKey = try FfiIdentityKey.generate()
        let identityPk = try FfiIdentityPublicKey.fromBytes(bytes: identityKey.publicKeyBytes())
        let collectionKey = try FfiCollectionKey.generate()
        let sealedKeyJson = try sealCollectionKey(recipientPk: identityPk, ck: collectionKey)

        var capturedInvitationBody: [String: Any]?
        InviteTestsStubURLProtocol.handler = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/identity/keypair"):
                return (200, (try? Self.keypairResponseJSON(userKey: userKey, identityKey: identityKey)) ?? Data())
            case ("GET", "/api/vault/collections"):
                let row = Self.collectionRowJSON(
                    id: "fixture-collection", accessLevel: "edit", sealedKey: sealedKeyJson,
                    familyWideKind: "folder", familyWideAccessLevel: "read"
                )
                let data = try! JSONSerialization.data(withJSONObject: [row])
                return (200, data)
            case ("POST", "/api/invitations"):
                capturedInvitationBody =
                    (try? JSONSerialization.jsonObject(with: request.httpBodyOrStream())) as? [String: Any]
                let id = (capturedInvitationBody?["id"] as? String) ?? ""
                return (201, Data(#"{"id":"\#(id)","expires_at":"2026-08-19T01:00:00Z"}"#.utf8))
            default:
                return nil
            }
        }

        let service = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        _ = try await service.generateInviteLink(userKey: userKey, expiresIn: "24h")

        let familyWideKeys = capturedInvitationBody?["family_wide_keys"] as? [[String: Any]]
        #expect(familyWideKeys?.count == 1)
        #expect(
            familyWideKeys?.first?["access_level"] as? String == "read",
            "must carry the SHARE's own declared level (read), never the caller's own held level (edit): \(String(describing: capturedInvitationBody))"
        )
    }

    /// A family-wide row whose `family_wide_access_level` column is null
    /// (the legacy-row case this plan's own precondition guarantees should
    /// not occur post-migration, kept as a defensive fallback) must
    /// produce an entry carrying `"read"`, never the caller's own held
    /// level.
    @Test func familyWideFoldInFallsBackToReadWhenShareLevelIsNull() async throws {
        let userKey = try FfiUserKey.generate()
        let identityKey = try FfiIdentityKey.generate()
        let identityPk = try FfiIdentityPublicKey.fromBytes(bytes: identityKey.publicKeyBytes())
        let collectionKey = try FfiCollectionKey.generate()
        let sealedKeyJson = try sealCollectionKey(recipientPk: identityPk, ck: collectionKey)

        var capturedInvitationBody: [String: Any]?
        InviteTestsStubURLProtocol.handler = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/identity/keypair"):
                return (200, (try? Self.keypairResponseJSON(userKey: userKey, identityKey: identityKey)) ?? Data())
            case ("GET", "/api/vault/collections"):
                let row = Self.collectionRowJSON(
                    id: "fixture-collection", accessLevel: "edit", sealedKey: sealedKeyJson,
                    familyWideKind: "folder", familyWideAccessLevel: nil
                )
                let data = try! JSONSerialization.data(withJSONObject: [row])
                return (200, data)
            case ("POST", "/api/invitations"):
                capturedInvitationBody =
                    (try? JSONSerialization.jsonObject(with: request.httpBodyOrStream())) as? [String: Any]
                let id = (capturedInvitationBody?["id"] as? String) ?? ""
                return (201, Data(#"{"id":"\#(id)","expires_at":"2026-08-19T01:00:00Z"}"#.utf8))
            default:
                return nil
            }
        }

        let service = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        _ = try await service.generateInviteLink(userKey: userKey, expiresIn: "24h")

        let familyWideKeys = capturedInvitationBody?["family_wide_keys"] as? [[String: Any]]
        #expect(familyWideKeys?.count == 1)
        #expect(familyWideKeys?.first?["access_level"] as? String == "read")
    }

    /// The creation request body carries the proof DIGEST, never the raw
    /// proof -- recovered independently from the returned URL's own
    /// fragment (never re-derived from InviteService's internals), so this
    /// asserts against a value this test computed itself.
    @Test func creationBodyCarriesTheDigestNeverTheRawProof() async throws {
        let userKey = try FfiUserKey.generate()
        let identityKey = try FfiIdentityKey.generate()

        var capturedInvitationBody: [String: Any]?
        InviteTestsStubURLProtocol.handler = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/identity/keypair"):
                return (200, (try? Self.keypairResponseJSON(userKey: userKey, identityKey: identityKey)) ?? Data())
            case ("GET", "/api/vault/collections"):
                return (200, Data("[]".utf8))
            case ("POST", "/api/invitations"):
                capturedInvitationBody =
                    (try? JSONSerialization.jsonObject(with: request.httpBodyOrStream())) as? [String: Any]
                let id = (capturedInvitationBody?["id"] as? String) ?? ""
                return (201, Data(#"{"id":"\#(id)","expires_at":"2026-08-19T01:00:00Z"}"#.utf8))
            default:
                return nil
            }
        }

        let service = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { "tok" }, session: Self.stubSession())
        let url = try await service.generateInviteLink(userKey: userKey, expiresIn: "1h")

        guard let fragment = url.fragment else {
            Issue.record("generated URL carried no fragment: \(url.absoluteString)")
            return
        }
        let secretBytes = try UrlSafeNoPadBase64.decode(fragment)
        let independentChannel = try FfiInviteChannel.fromSecret(secret: secretBytes)
        let expectedHashB64 = StandardBase64.encode(independentChannel.proofHashForCreation())
        let rawProofB64 = StandardBase64.encode(independentChannel.proofForRedemption())

        let transmittedProofHash = capturedInvitationBody?["proof_hash"] as? String
        #expect(transmittedProofHash == expectedHashB64, "proof_hash must equal the CREATION digest")
        #expect(transmittedProofHash != rawProofB64, "proof_hash must NEVER equal the raw redemption proof")
    }
}
