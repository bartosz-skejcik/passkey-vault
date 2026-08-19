//
//  Fsh02ReceiveTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-09.
//
//  Task 1: `InviteRedemptionService` -- in-process, against a tiny
//  fake-invitations-server `URLProtocol` that mirrors
//  `crates/pv-server/src/routes/invitations.rs`'s own proof-hash comparison
//  (SHA-256 of the redemption proof, compared against the stored
//  creation-time hash) closely enough that plan 40-06's REAL
//  `InviteService` (producer) and this plan's REAL `InviteRedemptionService`
//  (consumer) are proven against EACH OTHER, not each against itself --
//  this task's own acceptance criteria, verbatim.
//
//  Tasks 2/3: `livePathAInviteTimeWrap`/`livePathBLazyReseal` -- two
//  INDEPENDENT live runs against a real `pv-server`, two separate account
//  sets, each with its own precondition assertion and its own receiver-side
//  evidence -- SC4's own requirement that neither path is inferred from the
//  other. The lazy-reseal half of Path B (`web/src/lib/families/
//  resealTrigger.ts`/`reseal.ts`) has no iOS caller in this plan's own
//  `files_modified` scope (this plan is iOS-as-RECEIVER only) -- Path B's
//  own reseal step is therefore driven by TEST-ONLY code performing the
//  SAME real `pv-ffi` calls and the SAME `POST /api/vault/collections/{id}/
//  members` call `reshareCollectionToNewMember` itself makes, from account
//  A's own session, mirroring this phase's established "perform BOTH sides
//  of the round trip using REAL pv-ffi calls from Swift ... genuinely live,
//  real crypto, real server round trips" precedent
//  (`InviteTests.redeemInviteSwiftSide`, `RemoveMemberTests.liveRemovalRekeyRun`)
//  for the identical `Foundation.Process`-does-not-exist-on-iOS constraint
//  (L-27).
//

import Foundation
@testable import PasskeyVault
import SwiftUI
import Testing
import CryptoKit

// MARK: - Task 1: a tiny in-process fake invitations server

/// Answers `/api/identity/keypair`, `/api/vault/collections`,
/// `/api/invitations*` requests entirely in-memory -- keyed by the
/// `Authorization: Bearer <token>` header, so two independent "accounts"
/// (the producer and the consumer) can share one `URLSession` and one
/// `baseURL` without colliding. The proof-hash comparison
/// (`SHA-256(decoded invite_proof) == stored proof_hash`) mirrors
/// `crates/pv-server/src/routes/invitations.rs::fetch_metadata`/`accept`'s
/// own comparison exactly (`pv_core::invite::hash_invite_proof` is a plain
/// `SHA-256`, confirmed by reading `crates/pv-core/src/invite.rs` this
/// session) -- this is what makes the round trip a genuine proof that
/// `InviteService` (producer) and `InviteRedemptionService` (consumer)
/// agree with each other, not two independently-mocked halves.
final class Fsh02FakeServerURLProtocol: URLProtocol, @unchecked Sendable {
    struct StoredInvitation {
        let proofHash: Data
        var familyWideKeys: [(collectionId: String, accessLevel: String, wrappedCollectionKey: String)]
        var status: String
    }

    struct StoredIdentity {
        let publicKeyB64: String
        let wrappedSecretKeyJson: String
    }

    static var invitations: [String: StoredInvitation] = [:]
    static var identitiesByToken: [String: StoredIdentity] = [:]
    static var collectionsByToken: [String: [[String: Any]]] = [:]
    static var putIdentityCallCountByToken: [String: Int] = [:]
    static var requestedPaths: [String] = []
    static var lastAcceptRequestBody: [String: Any]?
    static var lastMetadataRequestURLString: String?
    static var lastMetadataRequestBody: [String: Any]?
    /// When set, the family-wide entry for this collection id is corrupted
    /// (its `wrapped_collection_key` replaced with garbage) at CREATE time
    /// -- Task 1's own "one of three entries fails to unwrap" fixture.
    static var corruptFamilyWideCollectionId: String?

    static func reset() {
        invitations = [:]
        identitiesByToken = [:]
        collectionsByToken = [:]
        putIdentityCallCountByToken = [:]
        requestedPaths = []
        lastAcceptRequestBody = nil
        lastMetadataRequestURLString = nil
        lastMetadataRequestBody = nil
        corruptFamilyWideCollectionId = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private func bearerToken() -> String? {
        guard let auth = request.value(forHTTPHeaderField: "Authorization"), auth.hasPrefix("Bearer ") else {
            return nil
        }
        return String(auth.dropFirst("Bearer ".count))
    }

    private func jsonBody() -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: request.httpBodyOrStream())) as? [String: Any] ?? [:]
    }

    private func respond(_ status: Int, _ obj: Any) {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        respondRaw(status, data)
    }

    private func respondRaw(_ status: Int, _ data: Data) {
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
        Self.requestedPaths.append("\(method) \(path)")

        if method == "GET", path == "/api/identity/keypair" {
            guard let tok = bearerToken(), let identity = Self.identitiesByToken[tok] else {
                respondRaw(404, Data())
                return
            }
            respond(200, [
                "public_key": identity.publicKeyB64, "wrapped_secret_key": identity.wrappedSecretKeyJson,
                "adopted_existing": false,
            ])
            return
        }

        if method == "PUT", path == "/api/identity/keypair" {
            guard let tok = bearerToken() else { respondRaw(401, Data()); return }
            let body = jsonBody()
            let publicKeyB64 = body["public_key"] as? String ?? ""
            let wrappedSecretKeyJson = body["wrapped_secret_key"] as? String ?? ""
            Self.putIdentityCallCountByToken[tok, default: 0] += 1
            Self.identitiesByToken[tok] = StoredIdentity(publicKeyB64: publicKeyB64, wrappedSecretKeyJson: wrappedSecretKeyJson)
            respond(200, ["public_key": publicKeyB64, "wrapped_secret_key": wrappedSecretKeyJson, "adopted_existing": false])
            return
        }

        if method == "GET", path == "/api/vault/collections" {
            let tok = bearerToken() ?? ""
            respond(200, Self.collectionsByToken[tok] ?? [])
            return
        }

        if method == "POST", path == "/api/invitations" {
            let body = jsonBody()
            let id = body["id"] as? String ?? ""
            let proofHashB64 = body["proof_hash"] as? String ?? ""
            let proofHash = Data(base64Encoded: proofHashB64) ?? Data()
            let familyWideKeysRaw = body["family_wide_keys"] as? [[String: Any]] ?? []
            let familyWideKeys = familyWideKeysRaw.compactMap { entry -> (String, String, String)? in
                guard let cid = entry["collection_id"] as? String,
                      let level = entry["access_level"] as? String,
                      var wrapped = entry["wrapped_collection_key"] as? String
                else { return nil }
                if cid == Self.corruptFamilyWideCollectionId {
                    // Corrupted so `FfiInviteChannel.unwrapCollectionKey`
                    // throws on the redemption side -- Task 1's own
                    // "reported, never silently dropped" fixture.
                    wrapped = "not-a-real-wrapped-key-json"
                }
                return (cid, level, wrapped)
            }
            Self.invitations[id] = StoredInvitation(proofHash: proofHash, familyWideKeys: familyWideKeys, status: "pending")
            respond(201, ["id": id, "expires_at": "2026-08-19T01:00:00Z"])
            return
        }

        if method == "POST", path.hasPrefix("/api/invitations/"), path.hasSuffix("/accept") {
            let id = String(path.dropFirst("/api/invitations/".count).dropLast("/accept".count))
            let body = jsonBody()
            Self.lastAcceptRequestBody = body
            guard var invitation = Self.invitations[id], invitation.status == "pending" else {
                respondRaw(404, Data())
                return
            }
            let inviteProofB64 = body["invite_proof"] as? String ?? ""
            guard let decodedProof = Data(base64Encoded: inviteProofB64) else {
                respondRaw(404, Data())
                return
            }
            let computed = Data(SHA256.hash(data: decodedProof))
            guard computed == invitation.proofHash else {
                respondRaw(404, Data())
                return
            }
            invitation.status = "accepted"
            Self.invitations[id] = invitation
            respond(200, ["already_member": false])
            return
        }

        if method == "POST", path.hasPrefix("/api/invitations/") {
            let id = String(path.dropFirst("/api/invitations/".count))
            Self.lastMetadataRequestURLString = request.url?.absoluteString
            let body = jsonBody()
            Self.lastMetadataRequestBody = body
            guard let invitation = Self.invitations[id], invitation.status == "pending" else {
                respondRaw(404, Data())
                return
            }
            let inviteProofB64 = body["invite_proof"] as? String ?? ""
            guard let decodedProof = Data(base64Encoded: inviteProofB64) else {
                respondRaw(404, Data())
                return
            }
            let computed = Data(SHA256.hash(data: decodedProof))
            guard computed == invitation.proofHash else {
                respondRaw(404, Data())
                return
            }
            let familyWideKeysJSON = invitation.familyWideKeys.map {
                ["collection_id": $0.0, "access_level": $0.1, "wrapped_collection_key": $0.2]
            }
            respond(200, [
                "inviter_email": "producer@example.invalid",
                "family_name": "Fsh02 Test Family",
                "inviter_fingerprint": NSNull(),
                "collection_id": NSNull(),
                "wrapped_collection_key": NSNull(),
                "family_wide_keys": familyWideKeysJSON,
            ])
            return
        }

        client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
    }

    override func stopLoading() {}
}

/// `URLProtocol`-intercepted requests sometimes carry the body as
/// `httpBodyStream` rather than `httpBody` -- same helper `InviteTests
/// .swift`/`VaultMutationTests.swift` each keep their own file-scoped copy
/// of (a top-level `private extension` is file-scoped in Swift, so this
/// does not collide with those).
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

/// `.serialized`: every Task 1 test mutates the SAME static
/// `Fsh02FakeServerURLProtocol` state -- same hazard `InviteTests.swift`/
/// `RemoveMemberTests.swift` already document this identical fix for.
@Suite(.serialized)
struct Fsh02ReceiveTests {

    fileprivate static func stubSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Fsh02FakeServerURLProtocol.self]
        return URLSession(configuration: config)
    }

    fileprivate static let fakeBaseURL = URL(string: "https://fsh02-tests.invalid")!

    // MARK: - Producer/consumer round trip, proven against each other

    /// This task's own acceptance criterion, verbatim: "A test builds an
    /// invite payload through plan 40-06's `InviteService` and redeems it
    /// through this service in-process, asserting the recovered Collection
    /// Key unseals to the same 32 bytes the producer wrapped -- producer
    /// and consumer proven against each other, not each against itself."
    /// Also covers "Redemption reuses an existing published identity
    /// keypair rather than publishing a second one" -- both accounts'
    /// keypairs are pre-seeded, so a PUT call for either token would be a
    /// FAILURE of that behavior, not its absence.
    @Test func producerAndConsumerRoundTripRecoverTheSameCollectionKeyThroughRealServices() async throws {
        Fsh02FakeServerURLProtocol.reset()
        let session = Self.stubSession()
        let producerToken = "producer-token-1"
        let consumerToken = "consumer-token-1"
        let producerUserKey = try FfiUserKey.generate()
        let consumerUserKey = try FfiUserKey.generate()

        let producerIdentity = try FfiIdentityKey.generate()
        Fsh02FakeServerURLProtocol.identitiesByToken[producerToken] = .init(
            publicKeyB64: producerIdentity.publicKeyBytes().base64EncodedString(),
            wrappedSecretKeyJson: try wrapIdentitySecretKey(uk: producerUserKey, isk: producerIdentity)
        )
        let consumerIdentity = try FfiIdentityKey.generate()
        Fsh02FakeServerURLProtocol.identitiesByToken[consumerToken] = .init(
            publicKeyB64: consumerIdentity.publicKeyBytes().base64EncodedString(),
            wrappedSecretKeyJson: try wrapIdentitySecretKey(uk: consumerUserKey, isk: consumerIdentity)
        )

        let producerPublicKey = try FfiIdentityPublicKey.fromBytes(bytes: producerIdentity.publicKeyBytes())
        let collectionId = "fixture-collection-round-trip"
        let originalCk = try FfiCollectionKey.generate()
        let sealedKeyJson = try sealCollectionKey(recipientPk: producerPublicKey, ck: originalCk)
        Fsh02FakeServerURLProtocol.collectionsByToken[producerToken] = [[
            "id": collectionId, "enc_name": "ignored", "created_at": "2026-08-19T00:00:00Z",
            "access_level": "edit", "sealed_key": sealedKeyJson,
            "family_wide_kind": "folder", "family_wide_access_level": "read",
        ]]

        let inviteService = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { producerToken }, session: session)
        let inviteURL = try await inviteService.generateInviteLink(userKey: producerUserKey, expiresIn: "1h")
        #expect(
            Fsh02FakeServerURLProtocol.putIdentityCallCountByToken[producerToken, default: 0] == 0,
            "the producer's pre-seeded keypair must be reused, never republished"
        )

        let redemptionService = InviteRedemptionService(baseURL: Self.fakeBaseURL, tokenProvider: { consumerToken }, session: session)
        let result = try await redemptionService.redeem(url: inviteURL, userKey: consumerUserKey)

        #expect(
            Fsh02FakeServerURLProtocol.putIdentityCallCountByToken[consumerToken, default: 0] == 0,
            "the consumer's pre-seeded keypair must be reused, never republished (this task's own must_haves.truths)"
        )
        #expect(result.familyWideSucceeded == [collectionId])
        #expect(result.familyWideFailed.isEmpty)

        // Producer and consumer proven against each other: recover the
        // `sealed_for_self` the consumer ACTUALLY submitted (captured by
        // the fake server, independent of the service's own internal
        // state), unseal it independently, and prove it recovers the SAME
        // 32 bytes the producer wrapped -- `FfiCollectionKey` has no byte
        // accessor by design, so this is proven the same way
        // `RemoveMemberTests`'s own reseal proof does it: encrypt a probe
        // item under the ORIGINAL key, confirm the RECOVERED key decrypts
        // it to the same plaintext.
        let acceptBody = try #require(Fsh02FakeServerURLProtocol.lastAcceptRequestBody)
        let familyWideSealedKeys = try #require(acceptBody["family_wide_sealed_keys"] as? [[String: Any]])
        #expect(familyWideSealedKeys.count == 1)
        let sealedForSelf = try #require(familyWideSealedKeys.first?["sealed_for_self"] as? String)

        let recoveredCk = try unsealCollectionKey(myIdentityKey: consumerIdentity, sealedJson: sealedForSelf)

        let probeItemId = "probe-item"
        let probePlaintext = "producer-consumer-round-trip-\(UUID().uuidString)"
        let probeJson = try encryptItemForCollection(
            ck: originalCk, plaintext: probePlaintext, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        let decrypted = try decryptItemForCollection(
            ck: recoveredCk, itemJson: probeJson, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        #expect(
            decrypted == probePlaintext,
            "the consumer's recovered Collection Key must unseal to the SAME 32 bytes the producer wrapped"
        )
    }

    // MARK: - Local self-consistency rejection (no network call)

    /// This plan's own `must_haves.truths`: a fragment/path mismatch is
    /// rejected LOCALLY, before any network call.
    @Test func tamperedFragmentIsRejectedLocallyBeforeAnyNetworkCall() async throws {
        Fsh02FakeServerURLProtocol.reset()
        let secret = generateInviteSecret()
        let channel = try FfiInviteChannel.fromSecret(secret: secret)
        let pathId = channel.inviteId()
        let goodFragment = UrlSafeNoPadBase64.encode(secret)

        var chars = Array(goodFragment)
        let candidates: [Character] = ["A", "B"]
        let replacement = try #require(candidates.first(where: { $0 != chars[0] }))
        chars[0] = replacement
        let tamperedFragment = String(chars)
        let tamperedURL = try #require(URL(string: "\(Self.fakeBaseURL.absoluteString)/invite/\(pathId)#\(tamperedFragment)"))

        let redemptionService = InviteRedemptionService(
            baseURL: Self.fakeBaseURL, tokenProvider: { "any-token" }, session: Self.stubSession()
        )
        let consumerUserKey = try FfiUserKey.generate()

        await #expect(throws: InviteRedemptionError.self) {
            _ = try await redemptionService.redeem(url: tamperedURL, userKey: consumerUserKey)
        }
        #expect(Fsh02FakeServerURLProtocol.requestedPaths.isEmpty, "a tampered fragment must be rejected before ANY network call")
    }

    // MARK: - The proof travels in the body, never the URL

    @Test func metadataRequestCarriesTheProofInTheBodyNeverInTheURL() async throws {
        Fsh02FakeServerURLProtocol.reset()
        let session = Self.stubSession()
        let producerToken = "producer-token-3"
        let consumerToken = "consumer-token-3"
        let producerUserKey = try FfiUserKey.generate()
        let consumerUserKey = try FfiUserKey.generate()
        Fsh02FakeServerURLProtocol.collectionsByToken[producerToken] = []

        let inviteService = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { producerToken }, session: session)
        let inviteURL = try await inviteService.generateInviteLink(userKey: producerUserKey, expiresIn: "1h")

        let fragment = try #require(inviteURL.fragment)
        let secretBytes = try UrlSafeNoPadBase64.decode(fragment)
        let independentChannel = try FfiInviteChannel.fromSecret(secret: secretBytes)
        let expectedRawProofB64 = StandardBase64.encode(independentChannel.proofForRedemption())

        let redemptionService = InviteRedemptionService(baseURL: Self.fakeBaseURL, tokenProvider: { consumerToken }, session: session)
        _ = try await redemptionService.redeem(url: inviteURL, userKey: consumerUserKey)

        let requestedURLString = try #require(Fsh02FakeServerURLProtocol.lastMetadataRequestURLString)
        #expect(!requestedURLString.contains(expectedRawProofB64), "the raw proof must never appear in a request URL")

        let metadataBody = try #require(Fsh02FakeServerURLProtocol.lastMetadataRequestBody)
        #expect(
            metadataBody["invite_proof"] as? String == expectedRawProofB64,
            "the raw proof must be present in the metadata request's BODY"
        )
    }

    // MARK: - Per-collection failure reporting

    /// This task's own acceptance criterion, verbatim: "when one of three
    /// family-wide entries fails to unwrap, the accept body carries two
    /// entries and the caller receives a report naming the third."
    @Test func oneOfThreeFamilyWideEntriesFailingToUnwrapIsReportedNeverSilentlyDropped() async throws {
        Fsh02FakeServerURLProtocol.reset()
        let session = Self.stubSession()
        let producerToken = "producer-token-4"
        let consumerToken = "consumer-token-4"
        let producerUserKey = try FfiUserKey.generate()
        let consumerUserKey = try FfiUserKey.generate()

        let producerIdentity = try FfiIdentityKey.generate()
        Fsh02FakeServerURLProtocol.identitiesByToken[producerToken] = .init(
            publicKeyB64: producerIdentity.publicKeyBytes().base64EncodedString(),
            wrappedSecretKeyJson: try wrapIdentitySecretKey(uk: producerUserKey, isk: producerIdentity)
        )
        let producerPublicKey = try FfiIdentityPublicKey.fromBytes(bytes: producerIdentity.publicKeyBytes())

        let collectionIds = ["fixture-a", "fixture-b", "fixture-c"]
        var rows: [[String: Any]] = []
        for id in collectionIds {
            let ck = try FfiCollectionKey.generate()
            let sealedKeyJson = try sealCollectionKey(recipientPk: producerPublicKey, ck: ck)
            rows.append([
                "id": id, "enc_name": "ignored", "created_at": "2026-08-19T00:00:00Z",
                "access_level": "edit", "sealed_key": sealedKeyJson,
                "family_wide_kind": "folder", "family_wide_access_level": "read",
            ])
        }
        Fsh02FakeServerURLProtocol.collectionsByToken[producerToken] = rows
        Fsh02FakeServerURLProtocol.corruptFamilyWideCollectionId = "fixture-b"

        let inviteService = InviteService(baseURL: Self.fakeBaseURL, tokenProvider: { producerToken }, session: session)
        let inviteURL = try await inviteService.generateInviteLink(userKey: producerUserKey, expiresIn: "24h")

        let redemptionService = InviteRedemptionService(baseURL: Self.fakeBaseURL, tokenProvider: { consumerToken }, session: session)
        let result = try await redemptionService.redeem(url: inviteURL, userKey: consumerUserKey)

        #expect(Set(result.familyWideSucceeded) == Set(["fixture-a", "fixture-c"]))
        #expect(result.familyWideFailed.count == 1)
        #expect(result.familyWideFailed.first?.collectionId == "fixture-b")

        let acceptBody = try #require(Fsh02FakeServerURLProtocol.lastAcceptRequestBody)
        let familyWideSealedKeys = try #require(acceptBody["family_wide_sealed_keys"] as? [[String: Any]])
        #expect(familyWideSealedKeys.count == 2, "the accept body must carry exactly the two entries that DID unwrap")
    }
}

// MARK: - Tasks 2/3: live, real pv-server, two independent runs

enum LiveFsh02Error: Error, CustomStringConvertible {
    case requestFailed(String, status: Int, body: String)
    case unexpectedShape(String)
    case rowNotFound(String)
    case preconditionViolated(String)

    var description: String {
        switch self {
        case let .requestFailed(what, status, body): return "\(what) failed (\(status)): \(body)"
        case let .unexpectedShape(detail): return "unexpected response shape: \(detail)"
        case let .rowNotFound(detail): return "row not found: \(detail)"
        case let .preconditionViolated(detail): return "precondition violated: \(detail)"
        }
    }
}

extension Fsh02ReceiveTests {

    /// Same hardcoded-default-over-skip discipline as `InviteTests`/
    /// `RemoveMemberTests` -- this task's own precondition requires
    /// `scripts/ios-live-server.sh` already running on that exact default
    /// port before either live method runs.
    fileprivate static var liveServerBaseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    fileprivate static var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // PasskeyVault/
            .deletingLastPathComponent() // ios/
            .deletingLastPathComponent() // repo root
    }

    fileprivate static var planningEvidenceDirectory: URL {
        repoRoot
            .appendingPathComponent(".planning")
            .appendingPathComponent("phases")
            .appendingPathComponent("40-rodzina-i-wsp-dzielenie-na-telefonie")
            .appendingPathComponent("evidence")
    }

    fileprivate static var durableEvidenceDirectory: URL {
        repoRoot.appendingPathComponent("ios").appendingPathComponent("evidence").appendingPathComponent("40")
    }

    // MARK: Test-only write-path helpers (setup plumbing only -- mirrors
    // `InviteTests`/`RemoveMemberTests`'s own established "add what THIS
    // live run needs, nothing wired into production" discipline)

    fileprivate static func createFamily(baseURL: URL, token: String, name: String) async throws {
        struct Body: Encodable { let name: String }
        let url = URL(string: "/api/families", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(Body(name: name))
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 201 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveFsh02Error.requestFailed("createFamily", status: status, body: body)
        }
    }

    fileprivate static func addFamilyMember(baseURL: URL, ownerToken: String, memberUserId: String) async throws {
        struct Body: Encodable { let user_id: String }
        let url = URL(string: "/api/families/members", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(ownerToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(Body(user_id: memberUserId))
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 201 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveFsh02Error.requestFailed("addFamilyMember", status: status, body: body)
        }
    }

    /// `PUT /api/vault/items/{id}/collection` -- moves a personal item into
    /// `newCollectionId`. Same shape `RemoveMemberTests.moveItem` uses.
    @discardableResult
    fileprivate static func moveItem(
        baseURL: URL, token: String, itemId: String, newCollectionId: String,
        encKeyJson: String, encDataJson: String, expectedRevision: Int
    ) async throws -> Int {
        struct Body: Encodable {
            let new_collection_id: String
            let enc_key: String
            let enc_data: String
            let expected_revision: Int
        }
        struct ResponseBody: Decodable { let revision: Int }
        let url = URL(string: "/api/vault/items/\(itemId)/collection", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(
            Body(new_collection_id: newCollectionId, enc_key: encKeyJson, enc_data: encDataJson, expected_revision: expectedRevision)
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 200 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveFsh02Error.requestFailed("moveItem", status: status, body: body)
        }
        return try JSONDecoder().decode(ResponseBody.self, from: data).revision
    }

    /// `GET /api/vault/collections/{id}/sync` (no `since` -- always a full
    /// snapshot) -- every item in the collection, any author. See
    /// `RemoveMemberTests.fetchSharedCollectionItems`'s own header for why
    /// this, not `GET /api/sync`, is the correct enumeration endpoint for a
    /// non-authoring collection member.
    fileprivate static func fetchSharedCollectionItems(
        baseURL: URL, token: String, collectionId: String
    ) async throws -> [VaultItemRow] {
        struct SnapshotBody: Decodable { let revision: Int; let items: [VaultItemRow] }
        let url = URL(string: "/api/vault/collections/\(collectionId)/sync", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 200 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveFsh02Error.requestFailed("fetchSharedCollectionItems", status: status, body: body)
        }
        guard let snapshot = try? JSONDecoder().decode(SnapshotBody.self, from: data) else {
            throw LiveFsh02Error.unexpectedShape("expected a snapshot from GET /api/vault/collections/\(collectionId)/sync")
        }
        return snapshot.items
    }

    fileprivate static func splitEncryptedItemJson(_ json: String) throws -> (encKeyJson: String, encDataJson: String) {
        let data = Data(json.utf8)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let encKeyObj = obj["enc_key"], let encDataObj = obj["enc_data"]
        else {
            throw LiveFsh02Error.unexpectedShape("malformed EncryptedItem JSON: \(json)")
        }
        let encKeyData = try JSONSerialization.data(withJSONObject: encKeyObj)
        let encDataData = try JSONSerialization.data(withJSONObject: encDataObj)
        return (String(decoding: encKeyData, as: UTF8.self), String(decoding: encDataData, as: UTF8.self))
    }

    fileprivate static func combinedEncryptedItemJson(encKeyJson: String, encDataJson: String) throws -> String {
        guard
            let encKeyData = encKeyJson.data(using: .utf8),
            let encDataData = encDataJson.data(using: .utf8),
            let encKeyObj = try? JSONSerialization.jsonObject(with: encKeyData),
            let encDataObj = try? JSONSerialization.jsonObject(with: encDataData)
        else {
            throw LiveFsh02Error.unexpectedShape("malformed EncryptedItem JSON: \(encKeyJson) / \(encDataJson)")
        }
        let combined = try JSONSerialization.data(withJSONObject: ["enc_key": encKeyObj, "enc_data": encDataObj])
        return String(decoding: combined, as: UTF8.self)
    }

    /// Creates a personal item then moves it into `collectionId` under
    /// `ck` -- a collection-scoped item cannot be created directly; it is
    /// always authored personally first, then moved (same two-step pattern
    /// `RemoveMemberTests`'s own E-F5 fixture uses).
    fileprivate static func createAndMoveItem(
        baseURL: URL, token: String, userKey: FfiUserKey, ck: FfiCollectionKey,
        collectionId: String, name: String, secretBody: String
    ) async throws -> (itemId: String, plaintext: String) {
        let itemId = VaultStore.mintItemId()
        let personalPlaintext = "{\"type\":\"note\",\"name\":\"\(name)\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
        let personalWire = try encryptItemWire(userKey: userKey, plaintext: personalPlaintext, itemId: itemId, revision: 1)
        _ = try await VaultAPI(baseURL: baseURL, tokenProvider: { token }).createItem(
            id: itemId, encKeyJson: personalWire.encKeyJson, encDataJson: personalWire.encDataJson
        )
        let collectionScopedPlaintext = "{\"type\":\"note\",\"name\":\"\(name)\",\"folderId\":null,\"tags\":[],\"body\":\"\(secretBody)\"}"
        let collectionItemJson = try encryptItemForCollection(
            ck: ck, plaintext: collectionScopedPlaintext, collectionId: collectionId, itemId: itemId, revision: 2
        )
        let (encKeyJson, encDataJson) = try Self.splitEncryptedItemJson(collectionItemJson)
        _ = try await Self.moveItem(
            baseURL: baseURL, token: token, itemId: itemId, newCollectionId: collectionId,
            encKeyJson: encKeyJson, encDataJson: encDataJson, expectedRevision: 1
        )
        return (itemId, collectionScopedPlaintext)
    }

    // MARK: - Task 2: E-F4a, Path A (invite-time wrap)

    /// Path A: the family-wide share existed BEFORE the invite was
    /// created. Proven receiver-side on C, and discriminated from Path B
    /// by `GET /api/families/family-wide-pending`'s `missing` array being
    /// EMPTY immediately after redemption (no reseal was ever involved).
    @MainActor
    @Test func livePathAInviteTimeWrap() async throws {
        let baseURL = Self.liveServerBaseURL
        let runSuffix = "\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8))".lowercased()
        let emailA = "pv-ef4a-a-\(runSuffix)@example.invalid"
        let emailC = "pv-ef4a-c-\(runSuffix)@example.invalid"
        let password = "PvEF4a-40-09-EvidencePassword!"
        let collectionName = "EF4a collection \(runSuffix)"

        let sessionA = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailA, password: password)
        let sessionC = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailC, password: password)

        try await Self.createFamily(baseURL: baseURL, token: sessionA.token, name: "E-F4a family \(runSuffix)")

        // ---- Path A order: the family-wide collection (with items) FIRST,
        // the invite generated only AFTER. ----
        let collectionServiceA = CollectionService(baseURL: baseURL, tokenProvider: { sessionA.token })
        let collectionId = try await collectionServiceA.createFamilyWideCollection(
            name: collectionName, accessLevel: "read", userKey: sessionA.userKey
        )
        let identityA = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionA.token })
            .ensureOwnIdentityKeypair(userKey: sessionA.userKey)
        let collectionRecordA = try await collectionServiceA.fetchCollection(id: collectionId)
        guard let sealedKeyA = collectionRecordA.sealedKey else {
            throw LiveFsh02Error.rowNotFound("A's own sealed_key for collection \(collectionId)")
        }
        let ck = try unsealCollectionKey(myIdentityKey: identityA, sealedJson: sealedKeyA)

        var itemIds: [String] = []
        var plaintexts: [String: String] = [:]
        for i in 0..<2 {
            let (itemId, plaintext) = try await Self.createAndMoveItem(
                baseURL: baseURL, token: sessionA.token, userKey: sessionA.userKey, ck: ck,
                collectionId: collectionId, name: "EF4a item \(i)", secretBody: "ef4a-\(runSuffix)-\(i)"
            )
            itemIds.append(itemId)
            plaintexts[itemId] = plaintext
        }

        let inviteService = InviteService(baseURL: baseURL, tokenProvider: { sessionA.token })
        let inviteURL = try await inviteService.generateInviteLink(userKey: sessionA.userKey, expiresIn: "1h")

        // ---- C redeems ----
        let redemptionService = InviteRedemptionService(baseURL: baseURL, tokenProvider: { sessionC.token })
        let result = try await redemptionService.redeem(url: inviteURL, userKey: sessionC.userKey)
        #expect(result.familyWideSucceeded.contains(collectionId), "the invite-time fold-in must carry this collection")
        #expect(result.familyWideFailed.isEmpty)

        // ---- Receiver-side proof: C decrypts the collection's name and
        // both items' plaintext, asserted equal to the literals A created. ----
        let collectionServiceC = CollectionService(baseURL: baseURL, tokenProvider: { sessionC.token })
        let identityC = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionC.token })
            .ensureOwnIdentityKeypair(userKey: sessionC.userKey)
        let collectionRecordC = try await collectionServiceC.fetchCollection(id: collectionId)
        guard let sealedKeyC = collectionRecordC.sealedKey else {
            throw LiveFsh02Error.rowNotFound("C's fresh sealed_key for collection \(collectionId)")
        }
        let ckC = try unsealCollectionKey(myIdentityKey: identityC, sealedJson: sealedKeyC)
        let decryptedName = try decryptItemForCollection(
            ck: ckC, itemJson: collectionRecordC.encName, collectionId: collectionId, itemId: collectionId, revision: 1
        )
        #expect(decryptedName == collectionName, "C must decrypt the collection's name to A's own literal")

        let itemsAsC = try await Self.fetchSharedCollectionItems(baseURL: baseURL, token: sessionC.token, collectionId: collectionId)
        var decryptedItemResults: [String: String] = [:]
        for itemId in itemIds {
            guard let row = itemsAsC.first(where: { $0.id == itemId }) else {
                throw LiveFsh02Error.rowNotFound("item \(itemId) in C's own sync snapshot")
            }
            let combinedJson = try Self.combinedEncryptedItemJson(encKeyJson: row.enc_key, encDataJson: row.enc_data)
            let decrypted = try decryptItemForCollection(
                ck: ckC, itemJson: combinedJson, collectionId: collectionId, itemId: itemId, revision: UInt32(row.revision)
            )
            decryptedItemResults[itemId] = decrypted
            #expect(decrypted == plaintexts[itemId], "C must decrypt item \(itemId) to the SAME plaintext A created")
        }
        #expect(decryptedItemResults.count == 2)

        // ---- Server-side: collection_keys has a row for C ----
        #expect(collectionRecordC.sealedKey != nil, "collection_keys must carry a row for C -- a direct API read confirms non-nil sealed_key")

        // ---- The Path A discriminator ----
        let pendingC = try await SharedItemsStore.fetchFamilyWidePending(baseURL: baseURL, tokenProvider: { sessionC.token })
        #expect(pendingC.missing.isEmpty, "Path A: family-wide-pending's missing array must be EMPTY immediately after redemption")

        // ---- Evidence ----
        let planningDir = Self.planningEvidenceDirectory
        try FileManager.default.createDirectory(at: planningDir, withIntermediateDirectories: true)
        let durableDir = Self.durableEvidenceDirectory
        try FileManager.default.createDirectory(at: durableDir, withIntermediateDirectories: true)

        let transcript = """
        E-F4a live Path A (invite-time wrap) run -- Phase 40, plan 40-09, Task 2
        Recorded: \(Date())
        Server origin: \(baseURL.absoluteString)

        Account A (owner, creates the collection THEN the invite): \(emailA)
        Account C (redeems the invite): \(emailC)

        Order (what makes this Path A): the family-wide collection \(collectionId) ("\(collectionName)"),
        with 2 items, was created BEFORE the invite was generated.

        Invite URL: \(inviteURL.absoluteString)
        C's redemption result: familyWideSucceeded=\(result.familyWideSucceeded) familyWideFailed=\(result.familyWideFailed)

        Receiver-side proof (C, real pv-ffi decrypt, real server round trips):
          Collection name decrypted by C: "\(decryptedName)" (expected "\(collectionName)")
          Items decrypted by C: \(decryptedItemResults)

        Server-side: GET /api/vault/collections/\(collectionId) as C returned sealed_key=\(collectionRecordC.sealedKey != nil ? "present" : "MISSING") -- a collection_keys row exists for C.

        The Path A discriminator (this is what distinguishes Path A from Path B):
          GET /api/families/family-wide-pending as C, immediately after redemption:
          missing=\(pendingC.missing.map { "\($0.collection_id):\($0.kind)" }) resealable=\(pendingC.resealable.count) entries
          missing.isEmpty = \(pendingC.missing.isEmpty) (expected true)

        Falsifiability of this discriminator: cross-referenced against Task 3's (livePathBLazyReseal)
        own transcript, where the SAME command against the SAME endpoint returns a NON-empty missing
        BEFORE that run's reseal step -- proving the emptiness here is informative, not the endpoint's
        default answer (40-RESEARCH.md's own Pitfall 6).
        """
        try transcript.write(
            to: planningDir.appendingPathComponent("40-09-ef4a-transcript.txt"), atomically: true, encoding: .utf8
        )
        try transcript.write(
            to: durableDir.appendingPathComponent("40-09-ef4a-transcript.txt"), atomically: true, encoding: .utf8
        )

        let screenshotView = Fsh02EvidenceScreen(
            heading: "E-F4a — Path A (invite-time wrap)",
            primaryLine: decryptedName,
            secondaryLines: itemIds.compactMap { decryptedItemResults[$0] }
        )
        let renderer = ImageRenderer(content: screenshotView)
        renderer.scale = 3
        guard let uiImage = renderer.uiImage, let pngData = uiImage.pngData() else {
            throw LiveFsh02Error.unexpectedShape("failed to render the E-F4a evidence screenshot")
        }
        try pngData.write(to: planningDir.appendingPathComponent("40-09-ef4a-collection.png"))
        try pngData.write(to: durableDir.appendingPathComponent("40-09-ef4a-collection.png"))
    }

    // MARK: - Task 3: E-F4b, Path B (lazy reseal)

    /// Path B: the invite was created BEFORE any family-wide collection
    /// existed. Proven receiver-side on C (before AND after the reseal),
    /// and proven to be a RESEAL, never a rotation (A's own grant unchanged,
    /// an unrelated existing member B still decrypts afterward).
    @MainActor
    @Test func livePathBLazyReseal() async throws {
        let baseURL = Self.liveServerBaseURL
        let runSuffix = "\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8))".lowercased()
        let emailA = "pv-ef4b-a-\(runSuffix)@example.invalid"
        let emailB = "pv-ef4b-b-\(runSuffix)@example.invalid"
        let emailC = "pv-ef4b-c-\(runSuffix)@example.invalid"
        let password = "PvEF4b-40-09-EvidencePassword!"
        let collectionName = "EF4b collection \(runSuffix)"

        let sessionA = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailA, password: password)
        let sessionB = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailB, password: password)
        let sessionC = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailC, password: password)

        let apiClient = PvApiClient(baseURL: baseURL)
        let meB = try await apiClient.me(token: sessionB.token)
        let meC = try await apiClient.me(token: sessionC.token)

        try await Self.createFamily(baseURL: baseURL, token: sessionA.token, name: "E-F4b family \(runSuffix)")
        try await Self.addFamilyMember(baseURL: baseURL, ownerToken: sessionA.token, memberUserId: meB.userId)

        // ---- Path B order: the invite FIRST, while A holds NO family-wide
        // collection at all. ----
        let inviteService = InviteService(baseURL: baseURL, tokenProvider: { sessionA.token })
        let inviteURL = try await inviteService.generateInviteLink(userKey: sessionA.userKey, expiresIn: "1h")

        let redemptionServiceC = InviteRedemptionService(baseURL: baseURL, tokenProvider: { sessionC.token })
        let redeemResult = try await redemptionServiceC.redeem(url: inviteURL, userKey: sessionC.userKey)
        #expect(redeemResult.familyWideSucceeded.isEmpty, "no family-wide collection existed yet -- nothing to fold in")
        #expect(redeemResult.familyWideFailed.isEmpty)

        // B publishes its identity keypair BEFORE A grants it direct
        // access below (needed to seal a key TO b).
        let identityB = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionB.token })
            .ensureOwnIdentityKeypair(userKey: sessionB.userKey)

        // ---- A THEN creates the family-wide collection, with an item. ----
        let collectionServiceA = CollectionService(baseURL: baseURL, tokenProvider: { sessionA.token })
        let collectionId = try await collectionServiceA.createFamilyWideCollection(
            name: collectionName, accessLevel: "read", userKey: sessionA.userKey
        )
        let identityA = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionA.token })
            .ensureOwnIdentityKeypair(userKey: sessionA.userKey)
        let collectionRecordA1 = try await collectionServiceA.fetchCollection(id: collectionId)
        guard let sealedKeyA1 = collectionRecordA1.sealedKey else {
            throw LiveFsh02Error.rowNotFound("A's own sealed_key for collection \(collectionId)")
        }
        let ck = try unsealCollectionKey(myIdentityKey: identityA, sealedJson: sealedKeyA1)

        let (itemId, itemPlaintext) = try await Self.createAndMoveItem(
            baseURL: baseURL, token: sessionA.token, userKey: sessionA.userKey, ck: ck,
            collectionId: collectionId, name: "EF4b item", secretBody: "ef4b-\(runSuffix)"
        )

        // B, an UNRELATED EXISTING MEMBER, is granted DIRECT access at
        // creation time -- entirely apart from the lazy-reseal mechanism
        // this run targets at C below. This is what makes B a meaningful
        // "still decrypts afterward" witness.
        let identityPublicKeyB = try FfiIdentityPublicKey.fromBytes(bytes: identityB.publicKeyBytes())
        let sealedForB = try sealCollectionKey(recipientPk: identityPublicKeyB, ck: ck)
        try await FamilyAPI(baseURL: baseURL, tokenProvider: { sessionA.token }).addCollectionMember(
            collectionId: collectionId, recipientUserId: meB.userId, sealedKeyJson: sealedForB, accessLevel: "read"
        )

        // ---- Precondition: the run must be able to fail (40-RESEARCH.md
        // Pitfall 6/8) -- `missing` must be NON-EMPTY for C before the
        // reseal, and iOS must render the not-yet-delivered state, never
        // hide or fake-show it. ----
        let pendingBefore = try await SharedItemsStore.fetchFamilyWidePending(baseURL: baseURL, tokenProvider: { sessionC.token })
        guard pendingBefore.missing.contains(where: { $0.collection_id == collectionId }) else {
            throw LiveFsh02Error.preconditionViolated(
                "C's family-wide-pending missing array does not contain \(collectionId) BEFORE the reseal -- this run proves nothing"
            )
        }
        let pendingStateBefore = PendingKeyState()
        pendingStateBefore.applyFamilyWidePending(missing: pendingBefore.missing)
        #expect(
            pendingStateBefore.state(for: collectionId) == .awaitingKey,
            "iOS must render the not-yet-delivered state -- neither hiding it nor showing it as readable"
        )

        // ---- The reseal trigger, simulated: the SAME real crypto + the
        // SAME real `POST /api/vault/collections/{id}/members` call
        // `web/src/lib/families/reseal.ts::reshareCollectionToNewMember`
        // itself makes, driven from A's own account. Foundation.Process
        // does not exist on iOS (L-27), so this test cannot spawn a
        // literal web browser to "unlock" and let the real trigger fire --
        // this performs the SAME real operation the trigger performs. ----
        let familyAPIAsOwner = FamilyAPI(baseURL: baseURL, tokenProvider: { sessionA.token })
        let membersAsA = try await familyAPIAsOwner.fetchMembers()
        guard let cMemberRecord = membersAsA.first(where: { $0.userId == meC.userId }),
              let cPublicKeyB64 = cMemberRecord.publicKey
        else {
            // Distinguishes the two causes (this task's own action text):
            // a recipient with no published key would make a real reseal
            // throw before any network call, which on iOS looks identical
            // to a trigger that never ran.
            throw LiveFsh02Error.preconditionViolated(
                "C has no published public key on GET /api/families/members -- cannot distinguish a missing key from a broken trigger"
            )
        }
        let cPublicKeyBytes = try #require(Data(base64Encoded: cPublicKeyB64))
        let cPublicKey = try FfiIdentityPublicKey.fromBytes(bytes: cPublicKeyBytes)

        // Refetch A's OWN sealed_key fresh, right before resealing -- the
        // SAME key, never a freshly generated one (reseal, never rotation).
        let collectionRecordA2 = try await collectionServiceA.fetchCollection(id: collectionId)
        guard let sealedKeyA2 = collectionRecordA2.sealedKey else {
            throw LiveFsh02Error.rowNotFound("A's own sealed_key for collection \(collectionId), re-fetched before the reseal")
        }
        let ckForReseal = try unsealCollectionKey(myIdentityKey: identityA, sealedJson: sealedKeyA2)
        let sealedForC = try sealCollectionKey(recipientPk: cPublicKey, ck: ckForReseal)
        let declaredLevel = collectionRecordA2.familyWideAccessLevel ?? "read"
        try await familyAPIAsOwner.addCollectionMember(
            collectionId: collectionId, recipientUserId: meC.userId, sealedKeyJson: sealedForC, accessLevel: declaredLevel
        )

        // ---- Receiver-side proof on C, AFTER the reseal ----
        let collectionServiceC = CollectionService(baseURL: baseURL, tokenProvider: { sessionC.token })
        let identityC = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionC.token })
            .ensureOwnIdentityKeypair(userKey: sessionC.userKey)
        let collectionRecordC = try await collectionServiceC.fetchCollection(id: collectionId)
        guard let sealedKeyC = collectionRecordC.sealedKey else {
            throw LiveFsh02Error.rowNotFound("C's fresh sealed_key for collection \(collectionId), after the reseal")
        }
        let ckC = try unsealCollectionKey(myIdentityKey: identityC, sealedJson: sealedKeyC)
        let decryptedNameC = try decryptItemForCollection(
            ck: ckC, itemJson: collectionRecordC.encName, collectionId: collectionId, itemId: collectionId, revision: 1
        )
        #expect(decryptedNameC == collectionName)

        let itemsAsC = try await Self.fetchSharedCollectionItems(baseURL: baseURL, token: sessionC.token, collectionId: collectionId)
        guard let rowC = itemsAsC.first(where: { $0.id == itemId }) else {
            throw LiveFsh02Error.rowNotFound("item \(itemId) in C's own sync snapshot, after the reseal")
        }
        let combinedJsonC = try Self.combinedEncryptedItemJson(encKeyJson: rowC.enc_key, encDataJson: rowC.enc_data)
        let decryptedItemC = try decryptItemForCollection(
            ck: ckC, itemJson: combinedJsonC, collectionId: collectionId, itemId: itemId, revision: UInt32(rowC.revision)
        )
        #expect(decryptedItemC == itemPlaintext, "C must decrypt the item to the SAME plaintext A created")

        let pendingAfter = try await SharedItemsStore.fetchFamilyWidePending(baseURL: baseURL, tokenProvider: { sessionC.token })
        #expect(
            !pendingAfter.missing.contains { $0.collection_id == collectionId },
            "missing must be EMPTY for this collection after the reseal"
        )
        let pendingStateAfter = PendingKeyState()
        pendingStateAfter.applyFamilyWidePending(missing: pendingAfter.missing)
        #expect(
            pendingStateAfter.state(for: collectionId) == nil,
            "the collection must no longer render the not-yet-delivered state"
        )

        // ---- Same-key proof: A's own grant, re-fetched again, still
        // opens to the SAME Collection Key -- proven via a probe
        // ciphertext, since `FfiCollectionKey` exposes no byte accessor by
        // design. ----
        let probeItemId = "probe-\(runSuffix)"
        let probePlaintext = "same-key-probe-\(UUID().uuidString)"
        let probeJson = try encryptItemForCollection(
            ck: ckForReseal, plaintext: probePlaintext, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        let collectionRecordA3 = try await collectionServiceA.fetchCollection(id: collectionId)
        guard let sealedKeyA3 = collectionRecordA3.sealedKey else {
            throw LiveFsh02Error.rowNotFound("A's own sealed_key for collection \(collectionId), after the reseal")
        }
        let ckA3 = try unsealCollectionKey(myIdentityKey: identityA, sealedJson: sealedKeyA3)
        let decryptedByA3 = try decryptItemForCollection(
            ck: ckA3, itemJson: probeJson, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        #expect(
            decryptedByA3 == probePlaintext,
            "A's own grant must still open to the SAME Collection Key after the reseal (reseal, never rotation)"
        )
        let decryptedByCProbe = try decryptItemForCollection(
            ck: ckC, itemJson: probeJson, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        #expect(
            decryptedByCProbe == probePlaintext,
            "C's recovered key must ALSO open the SAME probe ciphertext A's key produced -- the strongest form of 'same key'"
        )

        // ---- Third-party proof: B, untouched by the C-targeted reseal,
        // still decrypts afterward. ----
        let collectionServiceB = CollectionService(baseURL: baseURL, tokenProvider: { sessionB.token })
        let collectionRecordB = try await collectionServiceB.fetchCollection(id: collectionId)
        guard let sealedKeyB = collectionRecordB.sealedKey else {
            throw LiveFsh02Error.rowNotFound("B's sealed_key for collection \(collectionId)")
        }
        let ckB = try unsealCollectionKey(myIdentityKey: identityB, sealedJson: sealedKeyB)
        let itemsAsB = try await Self.fetchSharedCollectionItems(baseURL: baseURL, token: sessionB.token, collectionId: collectionId)
        guard let rowB = itemsAsB.first(where: { $0.id == itemId }) else {
            throw LiveFsh02Error.rowNotFound("item \(itemId) in B's own sync snapshot")
        }
        let combinedJsonB = try Self.combinedEncryptedItemJson(encKeyJson: rowB.enc_key, encDataJson: rowB.enc_data)
        let decryptedItemB = try decryptItemForCollection(
            ck: ckB, itemJson: combinedJsonB, collectionId: collectionId, itemId: itemId, revision: UInt32(rowB.revision)
        )
        #expect(decryptedItemB == itemPlaintext, "B (unrelated existing member) must still decrypt the item after the C-targeted reseal")

        // ---- Evidence ----
        let planningDir = Self.planningEvidenceDirectory
        try FileManager.default.createDirectory(at: planningDir, withIntermediateDirectories: true)
        let durableDir = Self.durableEvidenceDirectory
        try FileManager.default.createDirectory(at: durableDir, withIntermediateDirectories: true)

        let transcript = """
        E-F4b live Path B (lazy reseal) run -- Phase 40, plan 40-09, Task 3
        Recorded: \(Date())
        Server origin: \(baseURL.absoluteString)

        Account A (owner, holds the collection, performs the reseal): \(emailA)
        Account B (unrelated existing member, direct grant at collection-creation time): \(emailB)
        Account C (redeemed the invite BEFORE any family-wide collection existed): \(emailC)

        Order (what makes this Path B): the invite was generated while A held NO family-wide
        collection at all. C redeemed it -- familyWideSucceeded was empty (nothing to fold in).
        A THEN created the family-wide collection \(collectionId) ("\(collectionName)") with 1 item.

        Precondition (this run's own falsifiable assertion), BEFORE the reseal:
          GET /api/families/family-wide-pending as C: missing contains \(collectionId) = \(pendingBefore.missing.contains { $0.collection_id == collectionId })
          iOS PendingKeyState.state(for: \(collectionId)) = .awaitingKey (confirmed)

        Reseal step (simulated via REAL pv-ffi + the REAL POST /api/vault/collections/{id}/members
        call reshareCollectionToNewMember itself makes, driven from A's own account --
        Foundation.Process does not exist on iOS, L-27, so this test cannot spawn a literal web
        browser to let the real client-side trigger fire):
          C's published public key (GET /api/families/members): present
          A's own sealed_key re-fetched immediately before resealing (never a fresh key)
          POST /api/vault/collections/\(collectionId)/members recipient=\(meC.userId) access_level=\(declaredLevel)

        Receiver-side proof on C, AFTER the reseal:
          Collection name decrypted by C: "\(decryptedNameC)" (expected "\(collectionName)")
          Item decrypted by C: "\(decryptedItemC)" (expected "\(itemPlaintext)")
          GET /api/families/family-wide-pending as C, AFTER: missing contains \(collectionId) = \(pendingAfter.missing.contains { $0.collection_id == collectionId }) (expected false)
          iOS PendingKeyState.state(for: \(collectionId)) after = nil (confirmed -- no longer awaiting)

        Reseal-not-rotation proof:
          A's own re-fetched grant still opens the probe ciphertext: \(decryptedByA3 == probePlaintext)
          C's own recovered key ALSO opens the SAME probe ciphertext: \(decryptedByCProbe == probePlaintext)
          B (unrelated existing member, untouched by this reseal) still decrypts the real item after it: \(decryptedItemB == itemPlaintext)

        Cross-reference (the falsification of the Path A discriminator, per Task 2's own transcript):
          Task 2's (livePathAInviteTimeWrap) missing was EMPTY immediately after redemption on a
          collection that existed BEFORE the invite. THIS run's missing was NON-EMPTY immediately
          after redemption on a collection that did NOT exist yet -- the SAME endpoint, the SAME
          command, opposite answers, proving the discriminator moves rather than defaulting to one
          value (40-RESEARCH.md's own Pitfall 6).
        """
        try transcript.write(
            to: planningDir.appendingPathComponent("40-09-ef4b-transcript.txt"), atomically: true, encoding: .utf8
        )
        try transcript.write(
            to: durableDir.appendingPathComponent("40-09-ef4b-transcript.txt"), atomically: true, encoding: .utf8
        )

        let beforeScreenshotView = Fsh02EvidenceScreen(
            heading: "E-F4b — Path B, BEFORE the reseal",
            primaryLine: PendingKeyCopy.awaitingKeyDetailTitle,
            secondaryLines: [PendingKeyCopy.awaitingKeyDetailBody]
        )
        let afterScreenshotView = Fsh02EvidenceScreen(
            heading: "E-F4b — Path B, AFTER the reseal",
            primaryLine: decryptedNameC,
            secondaryLines: [decryptedItemC]
        )
        let beforeRenderer = ImageRenderer(content: beforeScreenshotView)
        beforeRenderer.scale = 3
        let afterRenderer = ImageRenderer(content: afterScreenshotView)
        afterRenderer.scale = 3
        guard let beforeImage = beforeRenderer.uiImage, let beforePng = beforeImage.pngData(),
              let afterImage = afterRenderer.uiImage, let afterPng = afterImage.pngData()
        else {
            throw LiveFsh02Error.unexpectedShape("failed to render the E-F4b evidence screenshots")
        }
        try beforePng.write(to: planningDir.appendingPathComponent("40-09-ef4b-before.png"))
        try beforePng.write(to: durableDir.appendingPathComponent("40-09-ef4b-before.png"))
        try afterPng.write(to: planningDir.appendingPathComponent("40-09-ef4b-after.png"))
        try afterPng.write(to: durableDir.appendingPathComponent("40-09-ef4b-after.png"))
    }
}

/// The captured-for-the-record evidence screen shared by both live runs --
/// renders a heading, a primary decrypted (or state) line, and secondary
/// lines, with REAL values from the run, never a fixture. Same
/// "not the live app view itself, but the same tokens/copy, real values"
/// precedent `InviteTests.InviteCreateEvidenceScreen`/`RemoveMemberTests`'s
/// own evidence screens already establish.
private struct Fsh02EvidenceScreen: View {
    let heading: String
    let primaryLine: String
    let secondaryLines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: PVMetrics.fieldStackGap) {
            Text(heading).font(.system(size: PVMetrics.titleSize, weight: .bold))
            Text(primaryLine)
                .font(.system(size: PVMetrics.subtitleSize, weight: .semibold))
                .foregroundStyle(Color("PVTextPrimary"))
            ForEach(secondaryLines, id: \.self) { line in
                Text(line)
                    .font(.system(size: PVMetrics.footnoteSize))
                    .foregroundStyle(Color("PVTextMuted"))
            }
        }
        .padding(PVMetrics.screenHPadding)
        .frame(width: 393)
        .background(Color("PVBackground"))
    }
}
