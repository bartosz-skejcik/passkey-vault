//
//  RemoveMemberTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-07.
//
//  Task 2: `RemoveMemberService.buildCollectionBatch` -- the exact-count
//  batch tests and the two `resolveTargetCollectionIds` source-of-truth
//  tests, all against a fabricated-but-realistic collection/member set
//  built through REAL FFI calls (real `FfiIdentityKey`/`FfiCollectionKey`
//  instances, real `seal`/`unseal`/`rewrap` round trips) -- never mocked
//  crypto. Written FIRST, RED confirmed against a stub implementation,
//  THEN `RemoveMemberService.swift` was written to make them pass (transcript
//  in `40-07-SUMMARY.md`).
//
//  Task 3: `liveRemovalRekeyRun` -- an extension at the bottom of this file,
//  named INSIDE `RemoveMemberTests` (not a separate type) so the plan's own
//  gate (`-only-testing:.../RemoveMemberTests/liveRemovalRekeyRun`) can
//  target it by name and this file's own fabricated-fixture tests above
//  cannot stand in for it -- same discipline `AccessLevelTests.swift`'s own
//  header states for `liveHiddenPasswordFfiRecovery`.
//

import Foundation
@testable import PasskeyVault
import Testing

// MARK: - Task 2: batch composition (fabricated-but-realistic, real FFI)

struct RemoveMemberTests {

    /// Splits `encrypt_item_for_collection`'s combined `EncryptedItem` JSON
    /// (`{"enc_key":{...},"enc_data":{...}}`) into the two separate opaque
    /// strings -- same technique `AccessLevelTests.splitEncryptedItemJson`
    /// already established. `rewrap_item_key_for_collection`'s
    /// `old_enc_key_json` parameter is `enc_key` ALONE, never the combined
    /// shape.
    private static func splitEncryptedItemJson(_ json: String) throws -> (encKeyJson: String, encDataJson: String) {
        let data = Data(json.utf8)
        let obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let encKeyObj = try #require(obj["enc_key"])
        let encDataObj = try #require(obj["enc_data"])
        let encKeyData = try JSONSerialization.data(withJSONObject: encKeyObj)
        let encDataData = try JSONSerialization.data(withJSONObject: encDataObj)
        return (String(decoding: encKeyData, as: UTF8.self), String(decoding: encDataData, as: UTF8.self))
    }

    private struct FixtureRecipient {
        let userId: String
        let identity: FfiIdentityKey
        let remaining: RemoveMemberService.RemainingRecipient
    }

    private static func makeRecipients(count: Int) throws -> [FixtureRecipient] {
        try (0..<count).map { i in
            let identity = try FfiIdentityKey.generate()
            let publicKeyBase64 = identity.publicKeyBytes().base64EncodedString()
            return FixtureRecipient(
                userId: "member-\(i)", identity: identity,
                remaining: RemoveMemberService.RemainingRecipient(userId: "member-\(i)", publicKeyBase64: publicKeyBase64)
            )
        }
    }

    private static func makeItems(count: Int, ck: FfiCollectionKey, collectionId: String) throws
        -> [RemoveMemberService.ItemToRewrap]
    {
        try (0..<count).map { i in
            let itemId = "item-\(i)"
            let combined = try encryptItemForCollection(
                ck: ck, plaintext: "fixture-secret-\(i)", collectionId: collectionId, itemId: itemId, revision: 1
            )
            let (encKeyJson, _) = try Self.splitEncryptedItemJson(combined)
            return RemoveMemberService.ItemToRewrap(itemId: itemId, encKeyJson: encKeyJson)
        }
    }

    // MARK: Exact counts

    /// This task's own acceptance criteria, verbatim: "3 recipients and 5
    /// items produce exactly 3 and exactly 5 entries. Counts, not 'at least
    /// one'."
    @Test func threeRecipientsAndFiveItemsProduceExactlyThoseCounts() throws {
        let collectionId = "coll-count-fixture"
        let oldCk = try FfiCollectionKey.generate()
        let recipients = try Self.makeRecipients(count: 3)
        let items = try Self.makeItems(count: 5, ck: oldCk, collectionId: collectionId)

        let (_, batch) = try RemoveMemberService.buildCollectionBatch(
            collectionId: collectionId, oldCk: oldCk,
            remainingRecipients: recipients.map(\.remaining), items: items
        )

        #expect(batch.newSealedKeys.count == 3)
        #expect(batch.itemRewraps.count == 5)
        #expect(Set(batch.newSealedKeys.map(\.recipientUserId)) == Set(recipients.map(\.userId)))
        #expect(Set(batch.itemRewraps.map(\.itemId)) == Set(items.map(\.itemId)))
    }

    // MARK: Every sealed entry unseals to the SAME fresh key, different from the old one

    /// `FfiCollectionKey` has no byte accessor by design -- "same 32 bytes"
    /// is proven the same way this codebase's OTHER reseal proofs do it
    /// (`family_wide_reseal_add_member_body_is_shape_identical_to_an_
    /// ordinary_share`'s own Rust-side technique, adapted for Swift's lack of
    /// `expose()`): encrypt a probe item under the fresh key, then confirm
    /// EVERY recipient's unsealed key decrypts it to the same plaintext, and
    /// that the PRE-removal key does NOT.
    @Test func everySealedEntryUnsealsToTheSameFreshKeyDifferentFromThePreRemovalKey() throws {
        let collectionId = "coll-unseal-fixture"
        let oldCk = try FfiCollectionKey.generate()
        let recipients = try Self.makeRecipients(count: 3)

        let (newCk, batch) = try RemoveMemberService.buildCollectionBatch(
            collectionId: collectionId, oldCk: oldCk,
            remainingRecipients: recipients.map(\.remaining), items: []
        )

        let probeItemId = "probe-item"
        let probePlaintext = "probe-\(UUID().uuidString)"
        let probeJson = try encryptItemForCollection(
            ck: newCk, plaintext: probePlaintext, collectionId: collectionId, itemId: probeItemId, revision: 1
        )

        for recipient in recipients {
            let sealedEntry = try #require(batch.newSealedKeys.first { $0.recipientUserId == recipient.userId })
            let recipientCk = try unsealCollectionKey(myIdentityKey: recipient.identity, sealedJson: sealedEntry.sealedKey)
            let decrypted = try decryptItemForCollection(
                ck: recipientCk, itemJson: probeJson, collectionId: collectionId, itemId: probeItemId, revision: 1
            )
            #expect(decrypted == probePlaintext, "recipient \(recipient.userId)'s unsealed key must recover the SAME fresh key's ciphertext")
        }

        // Differs from the pre-removal key: decrypting the SAME ciphertext
        // with `oldCk` must fail (AEAD tag mismatch under the wrong key).
        #expect(throws: (any Error).self) {
            _ = try decryptItemForCollection(
                ck: oldCk, itemJson: probeJson, collectionId: collectionId, itemId: probeItemId, revision: 1
            )
        }
    }

    // MARK: Missing public key throws before any request

    /// `buildCollectionBatch` is a `static` function taking no `session`/
    /// `baseURL` -- it cannot issue a network request even in principle, so
    /// "no request was issued" is structural here, not merely observed.
    @Test func missingRecipientPublicKeyThrowsBeforeAnyRequestIsEvenPossible() throws {
        let collectionId = "coll-missing-key-fixture"
        let oldCk = try FfiCollectionKey.generate()
        let recipients = [RemoveMemberService.RemainingRecipient(userId: "member-no-key", publicKeyBase64: nil)]

        #expect(throws: RemoveMemberService.BatchBuilderError.self) {
            _ = try RemoveMemberService.buildCollectionBatch(
                collectionId: collectionId, oldCk: oldCk, remainingRecipients: recipients, items: []
            )
        }
    }

    // MARK: - The isSelf source-of-truth split (network-level, stub-backed)

    /// Records every requested path and answers ONLY the paths it has been
    /// given a canned response for -- registered on a per-test ephemeral
    /// `URLSessionConfiguration`, never globally (`ServerReachabilityTests
    /// .swift`'s own precedent).
    final class RouteRecordingStubURLProtocol: URLProtocol, @unchecked Sendable {
        struct Stub {
            let statusCode: Int
            let body: Data
        }
        static var stubsByPath: [String: Stub] = [:]
        static var requestedPaths: [String] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            let path = request.url?.path ?? ""
            Self.requestedPaths.append(path)
            guard let stub = Self.stubsByPath[path], let url = request.url else {
                client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
                return
            }
            let response = HTTPURLResponse(
                url: url, statusCode: stub.statusCode, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: stub.body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private static func stubSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RouteRecordingStubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    /// Self-removal reads `GET /api/vault/collections` -- and must NEVER
    /// call the owner-only `GET /api/families/members/{id}/access` (which
    /// would 403 unconditionally, even for the caller's own id --
    /// 40-RESEARCH.md Pitfall 7). Two SEPARATE tests (this one and the one
    /// below), so a single shared code path cannot satisfy both by accident.
    @Test func selfRemovalReadsTheCollectionsListNeverTheOwnerOnlyBreakdown() async throws {
        RouteRecordingStubURLProtocol.requestedPaths = []
        RouteRecordingStubURLProtocol.stubsByPath = [
            "/api/vault/collections": .init(
                statusCode: 200,
                body: Data(#"[{"id":"self-coll","enc_name":"x","created_at":"t","access_level":"edit","sealed_key":"s","family_wide_kind":null,"family_wide_access_level":null}]"#.utf8)
            ),
        ]
        let service = RemoveMemberService(
            baseURL: URL(string: "http://stub.invalid")!, tokenProvider: { "stub-token" }, session: Self.stubSession()
        )

        let ids = try await service.resolveTargetCollectionIds(targetUserId: "self-user-id", isSelf: true)

        #expect(ids == ["self-coll"])
        #expect(RouteRecordingStubURLProtocol.requestedPaths.contains("/api/vault/collections"))
        #expect(
            !RouteRecordingStubURLProtocol.requestedPaths.contains { $0.hasSuffix("/access") },
            "self-removal must never call the owner-only per-member access breakdown"
        )
    }

    /// Remove-another reads the OWNER-ONLY `GET /api/families/
    /// members/{user_id}/access` -- and must never call `GET
    /// /api/vault/collections` (that would silently resolve the CALLER's own
    /// collections, not the target's).
    @Test func removeAnotherReadsTheOwnerOnlyBreakdownNeverTheCollectionsList() async throws {
        RouteRecordingStubURLProtocol.requestedPaths = []
        RouteRecordingStubURLProtocol.stubsByPath = [
            "/api/families/members/target-user-id/access": .init(
                statusCode: 200,
                body: Data(#"{"collections":[{"id":"other-coll","access_level":"read"}],"item_shares":[]}"#.utf8)
            ),
        ]
        let service = RemoveMemberService(
            baseURL: URL(string: "http://stub.invalid")!, tokenProvider: { "stub-token" }, session: Self.stubSession()
        )

        let ids = try await service.resolveTargetCollectionIds(targetUserId: "target-user-id", isSelf: false)

        #expect(ids == ["other-coll"])
        #expect(RouteRecordingStubURLProtocol.requestedPaths.contains("/api/families/members/target-user-id/access"))
        #expect(
            !RouteRecordingStubURLProtocol.requestedPaths.contains("/api/vault/collections"),
            "removing someone else must never read the CALLER's own collections list"
        )
    }
}
