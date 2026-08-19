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

// MARK: - Task 3: E-F5 -- a real removal from the phone, proven receiver-side

enum LiveRemovalRekeyRunError: Error, CustomStringConvertible {
    case requestFailed(String, status: Int, body: String)
    case unexpectedSyncShape(String)
    case rowNotFound(String)
    case malformedEncryptedItemJson(String)
    case expectedThrowDidNotOccur(String)
    case unexpectedStatus(String, Int)

    var description: String {
        switch self {
        case let .requestFailed(what, status, body): return "\(what) failed (\(status)): \(body)"
        case let .unexpectedSyncShape(detail): return "unexpected sync response shape: \(detail)"
        case let .rowNotFound(detail): return "row not found: \(detail)"
        case let .malformedEncryptedItemJson(json): return "malformed EncryptedItem JSON: \(json)"
        case let .expectedThrowDidNotOccur(what): return "expected \(what) to throw, but it did not"
        case let .unexpectedStatus(what, status): return "\(what): unexpected status \(status)"
        }
    }
}

extension RemoveMemberTests {

    /// Same hardcoded-default-over-skip discipline as `AccessLevelTests
    /// .liveServerBaseURL`/`ShareMarkerTests.liveServerBaseURL` -- this
    /// test's own precondition requires the caller to have started
    /// `scripts/ios-live-server.sh` on that exact default port beforehand,
    /// against a THROWAWAY database (`reversibility="costly"`: a removal
    /// rotates Collection Keys for real).
    private static var liveServerBaseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    private static var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // PasskeyVault/
            .deletingLastPathComponent() // ios/
            .deletingLastPathComponent() // repo root
    }

    private static var planningEvidenceDirectory: URL {
        repoRoot
            .appendingPathComponent(".planning")
            .appendingPathComponent("phases")
            .appendingPathComponent("40-rodzina-i-wsp-dzielenie-na-telefonie")
            .appendingPathComponent("evidence")
    }

    private static var durableEvidenceDirectory: URL {
        repoRoot.appendingPathComponent("ios").appendingPathComponent("evidence").appendingPathComponent("40")
    }

    // MARK: Test-only write-path helpers (setup plumbing only -- mirrors
    // `AccessLevelTests`/`ShareMarkerTests`'s own established "add what THIS
    // live run needs, nothing wired into production" discipline)

    private static func createFamily(baseURL: URL, token: String, name: String) async throws {
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
            throw LiveRemovalRekeyRunError.requestFailed("createFamily", status: status, body: body)
        }
    }

    private static func addFamilyMember(baseURL: URL, ownerToken: String, memberUserId: String) async throws {
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
            throw LiveRemovalRekeyRunError.requestFailed("addFamilyMember", status: status, body: body)
        }
    }

    /// `POST /api/vault/collections` -- a PLAIN (non-family-wide) collection,
    /// same shape `AccessLevelTests.createCollection` uses.
    private static func createCollection(
        baseURL: URL, token: String, id: String, encNameJson: String, sealedKeyJson: String
    ) async throws {
        struct Body: Encodable {
            let id: String
            let enc_name: String
            let sealed_key: String
            let family_wide_kind: String?
            let family_wide_access_level: String?
        }
        let url = URL(string: "/api/vault/collections", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(
            Body(id: id, enc_name: encNameJson, sealed_key: sealedKeyJson, family_wide_kind: nil, family_wide_access_level: nil)
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 201 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveRemovalRekeyRunError.requestFailed("createCollection", status: status, body: body)
        }
    }

    /// `PUT /api/vault/items/{id}/collection` -- moves a personal item into
    /// `newCollectionId`. Same shape `AccessLevelTests.moveItem` uses.
    @discardableResult
    private static func moveItem(
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
            throw LiveRemovalRekeyRunError.requestFailed("moveItem", status: status, body: body)
        }
        return try JSONDecoder().decode(ResponseBody.self, from: data).revision
    }

    /// `GET /api/vault/collections/{id}/sync` (no `since` -- always a full
    /// snapshot). Every item in the collection, any author -- see
    /// `RemoveMemberService.fetchCollectionItemRows`'s own header for why
    /// this is the ONLY correct item-enumeration endpoint for a collection
    /// member who did not personally author every item in it.
    private static func fetchSharedCollectionItems(baseURL: URL, token: String, collectionId: String) async throws -> [VaultItemRow] {
        struct SnapshotBody: Decodable { let revision: Int; let items: [VaultItemRow] }
        let url = URL(string: "/api/vault/collections/\(collectionId)/sync", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 200 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveRemovalRekeyRunError.requestFailed("fetchSharedCollectionItems", status: status, body: body)
        }
        guard let snapshot = try? JSONDecoder().decode(SnapshotBody.self, from: data) else {
            throw LiveRemovalRekeyRunError.unexpectedSyncShape("expected a snapshot from GET /api/vault/collections/\(collectionId)/sync")
        }
        return snapshot.items
    }

    /// `GET /api/vault/collections/{id}` -- returns the RAW status code
    /// rather than throwing, since the removed member's OWN claim in this
    /// test IS the status code (404).
    private static func collectionFetchStatus(baseURL: URL, token: String, collectionId: String) async throws -> Int {
        let url = URL(string: "/api/vault/collections/\(collectionId)", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? -1
    }

    /// E-F5: a real removal from the phone, proven complete by the people
    /// who remain and proven incomplete when deliberately made so.
    ///
    /// Fixture: owner A (iOS), remaining member B, target member T; two
    /// PLAIN collections, two items each, A/B/T all holding a key to both.
    ///
    /// Receiver-side proof: B (the REMAINING member) is driven through the
    /// SAME real `pv-ffi` calls a second client would make -- `CollectionService
    /// .fetchCollection`/`decryptItemForCollection`, never mocked -- rather
    /// than a literal separate web-browser process. `ios/IOS-SPIKE-LOG.md`
    /// §L-27 records why: `Foundation.Process` does not exist on iOS, so no
    /// Swift Testing method can spawn a Node/pv-wasm "second client" driver
    /// mid-test; plan 40-06's own `liveInviteRedeemedByWebAccount` (E-F2)
    /// already chose this SAME option (b) -- "perform BOTH sides of the round
    /// trip using REAL pv-ffi calls from Swift ... genuinely live, real
    /// crypto, real server round trips, just not a JS/wasm interop claim
    /// specifically" -- for the identical constraint, earlier in this same
    /// phase. This run follows that established precedent rather than
    /// building a new Node harness.
    ///
    /// Falsification: `RemoveMemberService.testOnlyDropLastRecipient` (a
    /// DEBUG-only fault-injection flag, mirroring `families.rs`'s own
    /// `FAULT_INJECT_AFTER_COLLECTION_INDEX`) drops the last remaining
    /// recipient from the batch. The REAL server's own KEY-07 completeness
    /// guard (`apply_member_removal_rekey`'s step 2: the submitted remaining-
    /// recipient set must match the collection's ACTUAL remaining recipients
    /// EXACTLY) rejects the shrunk batch with 409 and rolls back -- so the
    /// observed falsification is "the incomplete batch is REFUSED, not
    /// silently applied", which is the correct, stronger form of "a member
    /// can no longer decrypt": the guard prevents that outcome from ever
    /// being reachable against this server, rather than merely being caught
    /// after the fact.
    @MainActor
    @Test func liveRemovalRekeyRun() async throws {
        let baseURL = Self.liveServerBaseURL
        let runSuffix = UUID().uuidString.lowercased()
        let emailOwner = "pv-ef5-owner-\(runSuffix)@example.invalid"
        let emailRemaining = "pv-ef5-remaining-\(runSuffix)@example.invalid"
        let emailTarget = "pv-ef5-target-\(runSuffix)@example.invalid"
        let password = "PvEF5-40-07-EvidencePassword!"

        let sessionOwner = try await AccountService(apiClient: PvApiClient(baseURL: baseURL))
            .register(email: emailOwner, password: password)
        let sessionRemaining = try await AccountService(apiClient: PvApiClient(baseURL: baseURL))
            .register(email: emailRemaining, password: password)
        let sessionTarget = try await AccountService(apiClient: PvApiClient(baseURL: baseURL))
            .register(email: emailTarget, password: password)

        let apiClient = PvApiClient(baseURL: baseURL)
        let meOwner = try await apiClient.me(token: sessionOwner.token)
        let meRemaining = try await apiClient.me(token: sessionRemaining.token)
        let meTarget = try await apiClient.me(token: sessionTarget.token)

        try await Self.createFamily(baseURL: baseURL, token: sessionOwner.token, name: "E-F5 family \(runSuffix)")
        try await Self.addFamilyMember(baseURL: baseURL, ownerToken: sessionOwner.token, memberUserId: meRemaining.userId)
        try await Self.addFamilyMember(baseURL: baseURL, ownerToken: sessionOwner.token, memberUserId: meTarget.userId)

        let identityOwner = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionOwner.token })
            .ensureOwnIdentityKeypair(userKey: sessionOwner.userKey)
        let identityRemaining = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionRemaining.token })
            .ensureOwnIdentityKeypair(userKey: sessionRemaining.userKey)
        let identityTarget = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionTarget.token })
            .ensureOwnIdentityKeypair(userKey: sessionTarget.userKey)
        let ownerPk = try FfiIdentityPublicKey.fromBytes(bytes: identityOwner.publicKeyBytes())
        let remainingPk = try FfiIdentityPublicKey.fromBytes(bytes: identityRemaining.publicKeyBytes())
        let targetPk = try FfiIdentityPublicKey.fromBytes(bytes: identityTarget.publicKeyBytes())

        let familyAPIAsOwner = FamilyAPI(baseURL: baseURL, tokenProvider: { sessionOwner.token })

        // ---- Fixture: two collections, two items each, A/B/T all holding a key ----

        struct FixtureCollection {
            let id: String
            let ck: FfiCollectionKey
            let itemIds: [String]
            let plaintexts: [String: String]
        }

        var collections: [FixtureCollection] = []
        for collectionIndex in 0..<2 {
            let collectionId = VaultStore.mintItemId()
            let ck = try FfiCollectionKey.generate()
            let ownSealedJson = try sealCollectionKey(recipientPk: ownerPk, ck: ck)
            let encNameJson = try encryptItemForCollection(
                ck: ck, plaintext: "EF5 collection \(collectionIndex)", collectionId: collectionId, itemId: collectionId, revision: 1
            )
            try await Self.createCollection(
                baseURL: baseURL, token: sessionOwner.token, id: collectionId, encNameJson: encNameJson, sealedKeyJson: ownSealedJson
            )

            let remainingSealedJson = try sealCollectionKey(recipientPk: remainingPk, ck: ck)
            try await familyAPIAsOwner.addCollectionMember(
                collectionId: collectionId, recipientUserId: meRemaining.userId, sealedKeyJson: remainingSealedJson, accessLevel: "read"
            )
            let targetSealedJson = try sealCollectionKey(recipientPk: targetPk, ck: ck)
            try await familyAPIAsOwner.addCollectionMember(
                collectionId: collectionId, recipientUserId: meTarget.userId, sealedKeyJson: targetSealedJson, accessLevel: "read"
            )

            var itemIds: [String] = []
            var plaintexts: [String: String] = [:]
            let vaultAPIAsOwner = VaultAPI(baseURL: baseURL, tokenProvider: { sessionOwner.token })
            for itemIndex in 0..<2 {
                let itemId = VaultStore.mintItemId()
                let personalPlaintext =
                    "{\"type\":\"note\",\"name\":\"EF5 item \(collectionIndex)-\(itemIndex)\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
                let personalWire = try encryptItemWire(
                    userKey: sessionOwner.userKey, plaintext: personalPlaintext, itemId: itemId, revision: 1
                )
                _ = try await vaultAPIAsOwner.createItem(
                    id: itemId, encKeyJson: personalWire.encKeyJson, encDataJson: personalWire.encDataJson
                )

                let collectionScopedPlaintext =
                    "{\"type\":\"note\",\"name\":\"EF5 item \(collectionIndex)-\(itemIndex) (collection-scoped)\",\"folderId\":null,\"tags\":[],\"body\":\"ef5-\(runSuffix)-\(collectionIndex)-\(itemIndex)\"}"
                let collectionItemJson = try encryptItemForCollection(
                    ck: ck, plaintext: collectionScopedPlaintext, collectionId: collectionId, itemId: itemId, revision: 2
                )
                let (encKeyJson, encDataJson) = try Self.splitEncryptedItemJson(collectionItemJson)
                _ = try await Self.moveItem(
                    baseURL: baseURL, token: sessionOwner.token, itemId: itemId, newCollectionId: collectionId,
                    encKeyJson: encKeyJson, encDataJson: encDataJson, expectedRevision: 1
                )

                itemIds.append(itemId)
                plaintexts[itemId] = collectionScopedPlaintext
            }

            collections.append(FixtureCollection(id: collectionId, ck: ck, itemIds: itemIds, plaintexts: plaintexts))
        }

        // ---- Falsification FIRST, on the untouched fixture: a shrunk batch must be REFUSED ----

        let removeService = RemoveMemberService(baseURL: baseURL, tokenProvider: { sessionOwner.token })

        RemoveMemberService.testOnlyDropLastRecipient = true
        var falsificationStatus: Int?
        do {
            _ = try await removeService.removeMember(userId: meTarget.userId, userKey: sessionOwner.userKey)
            RemoveMemberService.testOnlyDropLastRecipient = false
            throw LiveRemovalRekeyRunError.expectedThrowDidNotOccur("the falsified (recipient-dropped) removal")
        } catch RemoveMemberError.rekeySetMismatch(let status, _) {
            // WR-03: the service now maps a 409 from the submit call site
            // to this specific, actionable error rather than the raw
            // `PvApiError.httpError` -- same status, more specific type.
            falsificationStatus = status
        }
        RemoveMemberService.testOnlyDropLastRecipient = false
        #expect(
            falsificationStatus == 409,
            "the server's own completeness guard must REFUSE a batch missing a remaining recipient, got \(String(describing: falsificationStatus))"
        )

        // T must still be a member after the refused attempt (transaction rolled back).
        let rosterAfterFalsification = try await familyAPIAsOwner.fetchMembers()
        #expect(rosterAfterFalsification.contains { $0.userId == meTarget.userId })

        // ---- The REAL removal ----

        let batch = try await removeService.removeMember(userId: meTarget.userId, userKey: sessionOwner.userKey)

        #expect(batch.count == 2, "exactly the two fixture collections T could reach")
        for collectionBatch in batch {
            #expect(collectionBatch.newSealedKeys.count == 2, "remaining recipients: owner + B, T excluded")
            #expect(collectionBatch.itemRewraps.count == 2, "both items in this collection")
            #expect(
                Set(collectionBatch.newSealedKeys.map(\.recipientUserId)) == Set([meOwner.userId, meRemaining.userId])
            )
        }

        // ---- Capture the request body, exactly as submitted ----

        struct CapturedRequestBody: Encodable { let collections: [FamilyAPI.CollectionRekeyBatch] }
        let requestBodyData = try JSONEncoder().encode(CapturedRequestBody(collections: batch))
        let requestBodyJson = String(decoding: requestBodyData, as: UTF8.self)

        // ---- Receiver-side proof: B, the REMAINING member, decrypts every item in both collections ----

        let collectionServiceAsRemaining = CollectionService(baseURL: baseURL, tokenProvider: { sessionRemaining.token })
        var remainingDecryptResults: [String: String] = [:]
        for fixture in collections {
            let record = try await collectionServiceAsRemaining.fetchCollection(id: fixture.id)
            guard let freshSealedKey = record.sealedKey else {
                throw LiveRemovalRekeyRunError.rowNotFound("B's fresh sealed_key for collection \(fixture.id)")
            }
            let freshCk = try unsealCollectionKey(myIdentityKey: identityRemaining, sealedJson: freshSealedKey)

            // `GET /api/vault/collections/{id}/sync` -- NOT `GET /api/sync`
            // (`VaultAPI.sync`), whose collection arm is scoped to items the
            // CALLER personally authored (`vault::fetch_items_for`'s own
            // `i.user_id = ?` bind) -- these items were authored by A (the
            // owner), not B, so that endpoint would silently return nothing
            // for B. `RemoveMemberService.fetchCollectionItemRows`'s own
            // header records this as a real bug this live run found.
            let items = try await Self.fetchSharedCollectionItems(baseURL: baseURL, token: sessionRemaining.token, collectionId: fixture.id)
            for itemId in fixture.itemIds {
                guard let row = items.first(where: { $0.id == itemId }) else {
                    throw LiveRemovalRekeyRunError.rowNotFound(
                        "item \(itemId) in B's own sync snapshot (collection \(fixture.id), snapshot had \(items.count) items: \(items.map { "\($0.id):\($0.collection_id ?? "nil")" }))"
                    )
                }
                let combinedJson = try Self.combinedEncryptedItemJson(encKeyJson: row.enc_key, encDataJson: row.enc_data)
                let decrypted = try decryptItemForCollection(
                    ck: freshCk, itemJson: combinedJson,
                    collectionId: fixture.id, itemId: itemId, revision: UInt32(row.revision)
                )
                remainingDecryptResults[itemId] = decrypted
                #expect(
                    decrypted == fixture.plaintexts[itemId],
                    "B must decrypt item \(itemId) to the SAME plaintext it was written with, after the removal"
                )
            }
        }
        #expect(remainingDecryptResults.count == 4, "all 4 items across both collections, decrypted by the remaining member")

        // ---- The removed member's client gets 404 on both affected collections ----

        var targetStatuses: [String: Int] = [:]
        for fixture in collections {
            let status = try await Self.collectionFetchStatus(baseURL: baseURL, token: sessionTarget.token, collectionId: fixture.id)
            targetStatuses[fixture.id] = status
            #expect(status == 404, "the removed member must get 404 on collection \(fixture.id), got \(status)")
        }

        // ---- Evidence ----

        let planningDir = Self.planningEvidenceDirectory
        try FileManager.default.createDirectory(at: planningDir, withIntermediateDirectories: true)
        let durableDir = Self.durableEvidenceDirectory
        try FileManager.default.createDirectory(at: durableDir, withIntermediateDirectories: true)

        let transcript = """
        E-F5 live member-removal re-key run -- Phase 40, plan 40-07, Task 3
        Recorded: \(Date())
        Server origin: \(baseURL.absoluteString)

        Account A (owner, performs the removal): \(emailOwner) (user_id \(meOwner.userId))
        Account B (remaining member): \(emailRemaining) (user_id \(meRemaining.userId))
        Account T (removed): \(emailTarget) (user_id \(meTarget.userId))

        Fixture: 2 plain (non-family-wide) collections, 2 items each, A/B/T all holding a
        collection_keys row on both before removal.
          Collection 0: \(collections[0].id) -- items \(collections[0].itemIds)
          Collection 1: \(collections[1].id) -- items \(collections[1].itemIds)

        Falsification FIRST (RemoveMemberService.testOnlyDropLastRecipient = true, a DEBUG-only
        fault-injection flag dropping the last remaining recipient from the seal loop):
          DELETE /api/families/members/\(meTarget.userId) with a batch missing one remaining
          recipient's new_sealed_keys entry -> HTTP \(falsificationStatus.map(String.init) ?? "?")
          (expected 409 -- the server's own apply_member_removal_rekey Step 2 completeness guard
          rejects a submitted remaining-recipient set that does not EXACTLY match the collection's
          actual remaining recipients, and rolls the whole transaction back).
          T still a family member immediately afterward: \(rosterAfterFalsification.contains { $0.userId == meTarget.userId })
          This is the correct, stronger form of "the dropped member can no longer decrypt": the
          guard makes that outcome unreachable against this server, rather than merely catching it
          after the fact.

        The REAL removal (flag reset to false): DELETE /api/families/members/\(meTarget.userId).
        Captured request body (2 collections, 2 new_sealed_keys + 2 item_rewraps each -- exactly
        matching the fixture's member and item counts):

        \(requestBodyJson)

        Receiver-side proof (B, the REMAINING member, driven through REAL pv-ffi calls -- see this
        test's own header for why this stands in for a literal separate web-browser process,
        following plan 40-06's E-F2 precedent, ios/IOS-SPIKE-LOG.md §L-27):
          B re-fetched both collections' FRESH sealed_key (rewrapped under the NEW post-removal
          Collection Key) and decrypted all 4 items to their original plaintexts.
          Decrypted item ids: \(remainingDecryptResults.keys.sorted())

        Removed member's client (T): GET /api/vault/collections/{id} on both affected collections:
          \(targetStatuses)
          (expected 404 on both -- T's collection_keys row is gone)

        No green fabricated-fixture RemoveMemberTests test (Task 2) was accepted as evidence for
        this claim -- this live run against a real pv-server is SC/E-F5's actual evidence.
        """
        try transcript.write(
            to: planningDir.appendingPathComponent("40-07-ef5-transcript.txt"), atomically: true, encoding: .utf8
        )
        try transcript.write(
            to: durableDir.appendingPathComponent("40-07-ef5-transcript.txt"), atomically: true, encoding: .utf8
        )
        try requestBodyData.write(to: planningDir.appendingPathComponent("40-07-ef5-request-body.json"))
        try requestBodyData.write(to: durableDir.appendingPathComponent("40-07-ef5-request-body.json"))
    }

    /// Recombines `enc_key`/`enc_data` (each already a JSON object string on
    /// the wire, `SyncModels.swift`'s `VaultItemRow`) into the single
    /// `EncryptedItem` JSON shape `decryptItemForCollection` expects --
    /// inverse of `splitEncryptedItemJson`.
    private static func combinedEncryptedItemJson(encKeyJson: String, encDataJson: String) throws -> String {
        guard
            let encKeyData = encKeyJson.data(using: .utf8),
            let encDataData = encDataJson.data(using: .utf8),
            let encKeyObj = try? JSONSerialization.jsonObject(with: encKeyData),
            let encDataObj = try? JSONSerialization.jsonObject(with: encDataData)
        else {
            throw LiveRemovalRekeyRunError.malformedEncryptedItemJson("\(encKeyJson) / \(encDataJson)")
        }
        let combined = try JSONSerialization.data(withJSONObject: ["enc_key": encKeyObj, "enc_data": encDataObj])
        return String(decoding: combined, as: UTF8.self)
    }
}
