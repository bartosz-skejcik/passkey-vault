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
