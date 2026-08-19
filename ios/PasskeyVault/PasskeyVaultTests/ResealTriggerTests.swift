//
//  ResealTriggerTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-10.
//
//  Task 1: `ResealService` -- an in-process fake-server `URLProtocol`
//  (`ResealFakeServerURLProtocol`) drives REAL `pv-ffi` calls (real
//  `FfiIdentityKey`/`FfiCollectionKey` instances, real `seal`/`unseal`/
//  `encrypt`/`decrypt` round trips) against a production `ResealService`,
//  never mocked crypto -- same discipline `RemoveMemberTests`/
//  `Fsh02ReceiveTests` already established for this phase.
//
//  Task 2: `ResealTrigger` -- cadence/concurrency tests against the SAME
//  fake server, using `ResealFakeServerURLProtocol`'s per-collection delay/
//  semaphore hooks (mirrors `LockTeardownTests.DelayedLockRaceStubURLProtocol`'s
//  own precedent for making a race deterministic) to prove the synchronous-
//  claim-before-first-await guarantee and the never-blocks-unlock contract.
//
//  Task 3: `liveIosPropagatesKey` -- an extension at the bottom of this
//  file, named INSIDE `ResealTriggerTests` so the plan's own gate
//  (`-only-testing:.../ResealTriggerTests/liveIosPropagatesKey()` --
//  TRAILING PARENS, ios/IOS-SPIKE-LOG.md L-30) can target it by name and
//  this file's own fixture-backed tests above cannot stand in for it.
//  Mirrors `Fsh02ReceiveTests.livePathBLazyReseal` (E-F4b) with roles
//  swapped, but calls the PRODUCTION `ResealTrigger`/`ResealService` types
//  this plan built directly -- unlike every prior Phase 40 live run, which
//  reimplemented the reseal composition as test-only code because no
//  production caller existed yet (`40-09-SUMMARY.md`'s own "Next Phase
//  Readiness" note). `Foundation.Process` does not exist on iOS (L-27), so
//  this test still cannot spawn a literal second app process to tap a real
//  lock screen -- it invokes the exact production entry point
//  `SyncCoordinator.pull()`'s `fireResealTriggerIfPossible()` calls
//  instead, which is the strictly stronger substitution available.
//

import Foundation
@testable import PasskeyVault
import SwiftUI
import Testing

// MARK: - Task 1/2: a tiny in-process fake server

/// Answers `/api/identity/keypair`, `/api/families/members`, `/api/vault/
/// collections/{id}` (GET), and `/api/vault/collections/{id}/members`
/// (POST) entirely in-memory -- keyed by the `Authorization: Bearer <token>`
/// header, mirroring `Fsh02FakeServerURLProtocol`'s own precedent. Adds
/// per-collection response-status/delay/semaphore hooks
/// (`grantResponseStatus`/`grantDelayMs`/`grantRequestStarted`) so Task 2's
/// concurrency/never-blocks-unlock tests can deterministically control
/// timing -- the SAME `Thread.sleep` + `DispatchSemaphore` technique
/// `LockTeardownTests.DelayedLockRaceStubURLProtocol` already established
/// for making an otherwise-racy assertion reproducible.
final class ResealFakeServerURLProtocol: URLProtocol, @unchecked Sendable {
    struct StoredIdentity {
        let publicKeyB64: String
        let wrappedSecretKeyJson: String
    }

    struct StoredMember {
        let userId: String
        let publicKeyB64: String?
    }

    struct StoredCollection {
        var sealedKeyByToken: [String: String]
        var familyWideAccessLevel: String?
        var ownAccessLevel: String?
    }

    static var identitiesByToken: [String: StoredIdentity] = [:]
    static var membersByToken: [String: [StoredMember]] = [:]
    static var collections: [String: StoredCollection] = [:]
    static var requestedPaths: [String] = []
    static var capturedGrantBodies: [String: [[String: Any]]] = [:]
    static var grantResponseStatus: [String: Int] = [:]
    static var grantDelayMs: [String: Int] = [:]
    static var grantRequestStarted: [String: DispatchSemaphore] = [:]

    static func reset() {
        identitiesByToken = [:]
        membersByToken = [:]
        collections = [:]
        requestedPaths = []
        capturedGrantBodies = [:]
        grantResponseStatus = [:]
        grantDelayMs = [:]
        grantRequestStarted = [:]
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
                "adopted_existing": true,
            ])
            return
        }

        if method == "GET", path == "/api/families/members" {
            guard let tok = bearerToken() else { respondRaw(401, Data()); return }
            let members = Self.membersByToken[tok] ?? []
            let arr: [[String: Any]] = members.map { m in
                [
                    "user_id": m.userId, "email": "\(m.userId)@example.invalid", "role": "member",
                    "joined_at": "2026-01-01T00:00:00Z", "status": "active",
                    "public_key": m.publicKeyB64 as Any? ?? NSNull(),
                    "fingerprint": NSNull(), "verified_at": NSNull(),
                ]
            }
            respond(200, arr)
            return
        }

        if method == "GET", path.hasPrefix("/api/vault/collections/") {
            let collectionId = String(path.dropFirst("/api/vault/collections/".count))
            guard let tok = bearerToken(), let stored = Self.collections[collectionId] else {
                respondRaw(404, Data())
                return
            }
            let sealedKey = stored.sealedKeyByToken[tok]
            respond(200, [
                "id": collectionId, "enc_name": "irrelevant-for-these-tests",
                "created_at": "2026-01-01T00:00:00Z",
                "access_level": stored.ownAccessLevel as Any? ?? NSNull(),
                "sealed_key": sealedKey as Any? ?? NSNull(),
                "family_wide_kind": "folder",
                "family_wide_access_level": stored.familyWideAccessLevel as Any? ?? NSNull(),
            ])
            return
        }

        if method == "POST", path.hasPrefix("/api/vault/collections/"), path.hasSuffix("/members") {
            let inner = path.dropFirst("/api/vault/collections/".count).dropLast("/members".count)
            let collectionId = String(inner)
            let body = jsonBody()
            Self.capturedGrantBodies[collectionId, default: []].append(body)
            Self.grantRequestStarted[collectionId]?.signal()
            if let delayMs = Self.grantDelayMs[collectionId], delayMs > 0 {
                Thread.sleep(forTimeInterval: Double(delayMs) / 1000.0)
            }
            let status = Self.grantResponseStatus[collectionId] ?? 201
            respond(status, [:])
            return
        }

        respondRaw(404, Data())
    }

    override func stopLoading() {}
}

/// `URLProtocol`-intercepted requests sometimes carry the body as
/// `httpBodyStream` rather than `httpBody` -- file-scoped copy of the
/// SAME helper `Fsh02ReceiveTests.swift`/`InviteTests.swift`/
/// `VaultMutationTests.swift` each keep (a `private extension` is
/// file-scoped in Swift, so this does not collide with those).
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

/// `.serialized`: every test mutates the SAME static
/// `ResealFakeServerURLProtocol` state -- same hazard `InviteTests.swift`/
/// `RemoveMemberTests.swift`/`Fsh02ReceiveTests.swift` already document
/// this identical fix for.
@Suite(.serialized)
struct ResealTriggerTests {

    fileprivate static let fakeBaseURL = URL(string: "https://reseal-tests.invalid")!

    fileprivate static func stubSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ResealFakeServerURLProtocol.self]
        return URLSession(configuration: config)
    }

    /// One propagator + `pairCount` distinct (collection, recipient) pairs,
    /// each wired for a default-success (201) grant, `family_wide_access_level:
    /// "read"`, and the propagator's OWN `access_level: "edit"` -- the exact
    /// "share declared read, propagator's own row is edit" shape T-40-43
    /// targets, so every test built on this fixture is already exercising
    /// the level distinction unless it says otherwise.
    fileprivate struct Fixture {
        let token: String
        let userKey: FfiUserKey
        let resealService: ResealService
        let grants: [ResealableGrantRow]
        /// By collection id -- the ORIGINAL `ck`, pre-reseal, for same-key
        /// proofs (`FfiCollectionKey` has no byte accessor by design, same
        /// precedent `RemoveMemberTests`'s own header documents).
        let collectionKeys: [String: FfiCollectionKey]
        /// By recipient user id -- lets a test unseal the POSTed
        /// `sealed_key` and prove it recovers the SAME key.
        let recipientIdentities: [String: FfiIdentityKey]
    }

    fileprivate static func makeFixture(pairCount: Int, id: String = UUID().uuidString) throws -> Fixture {
        let token = "propagator-\(id)"
        let userKey = try FfiUserKey.generate()
        let ownIdentity = try FfiIdentityKey.generate()
        ResealFakeServerURLProtocol.identitiesByToken[token] = .init(
            publicKeyB64: ownIdentity.publicKeyBytes().base64EncodedString(),
            wrappedSecretKeyJson: try wrapIdentitySecretKey(uk: userKey, isk: ownIdentity)
        )
        let ownPk = try FfiIdentityPublicKey.fromBytes(bytes: ownIdentity.publicKeyBytes())

        var members: [ResealFakeServerURLProtocol.StoredMember] = []
        var grants: [ResealableGrantRow] = []
        var collectionKeys: [String: FfiCollectionKey] = [:]
        var recipientIdentities: [String: FfiIdentityKey] = [:]

        for i in 0..<pairCount {
            let recipientId = "recipient-\(id)-\(i)"
            let recipientIdentity = try FfiIdentityKey.generate()
            members.append(.init(userId: recipientId, publicKeyB64: recipientIdentity.publicKeyBytes().base64EncodedString()))
            recipientIdentities[recipientId] = recipientIdentity

            let collectionId = "collection-\(id)-\(i)"
            let ck = try FfiCollectionKey.generate()
            let ownSealedJson = try sealCollectionKey(recipientPk: ownPk, ck: ck)
            ResealFakeServerURLProtocol.collections[collectionId] = .init(
                sealedKeyByToken: [token: ownSealedJson], familyWideAccessLevel: "read", ownAccessLevel: "edit"
            )
            collectionKeys[collectionId] = ck
            grants.append(ResealableGrantRow(collection_id: collectionId, recipient_user_id: recipientId))
        }
        ResealFakeServerURLProtocol.membersByToken[token] = members

        let resealService = ResealService(baseURL: Self.fakeBaseURL, tokenProvider: { token }, session: Self.stubSession())
        return Fixture(
            token: token, userKey: userKey, resealService: resealService, grants: grants,
            collectionKeys: collectionKeys, recipientIdentities: recipientIdentities
        )
    }

    // MARK: - Task 1: `ResealService`

    /// This task's own acceptance criterion, verbatim: the sealed key sent
    /// to the recipient unseals, through the FFI with the recipient's key,
    /// to the SAME 32 bytes the propagator recovered -- captured (as a
    /// probe ciphertext, `FfiCollectionKey` has no byte accessor) BEFORE
    /// the seal call, not re-derived.
    @Test func theResealedKeyIsTheSameKeyNeverAFreshOne() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let grant = fixture.grants[0]
        let originalCk = try #require(fixture.collectionKeys[grant.collection_id])

        // Captured BEFORE reshareCollection runs -- proves what the
        // PROPAGATOR held, not something re-derived after the fact.
        let probeItemId = "probe-item"
        let probePlaintext = "probe-\(UUID().uuidString)"
        let probeJson = try encryptItemForCollection(
            ck: originalCk, plaintext: probePlaintext, collectionId: grant.collection_id, itemId: probeItemId, revision: 1
        )

        try await fixture.resealService.reshareCollection(
            collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: fixture.userKey
        )

        let postedBodies = ResealFakeServerURLProtocol.capturedGrantBodies[grant.collection_id] ?? []
        #expect(postedBodies.count == 1)
        let sealedKeyJson = try #require(postedBodies.first?["sealed_key"] as? String)
        let recipientIdentity = try #require(fixture.recipientIdentities[grant.recipient_user_id])
        let recipientCk = try unsealCollectionKey(myIdentityKey: recipientIdentity, sealedJson: sealedKeyJson)
        let decrypted = try decryptItemForCollection(
            ck: recipientCk, itemJson: probeJson, collectionId: grant.collection_id, itemId: probeItemId, revision: 1
        )
        #expect(decrypted == probePlaintext, "the recipient's unsealed key must recover the SAME key the propagator held")
    }

    /// T-25-16: a recipient with no published public key throws BEFORE any
    /// getCollection/addCollectionMember call for that pair.
    @Test func missingRecipientPublicKeyThrowsBeforeAnyCollectionOrGrantRequest() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let grant = fixture.grants[0]
        // Strip the recipient's public key from the roster -- the exact
        // "no published key" condition.
        ResealFakeServerURLProtocol.membersByToken[fixture.token] = [
            .init(userId: grant.recipient_user_id, publicKeyB64: nil),
        ]

        await #expect(throws: ResealServiceError.self) {
            try await fixture.resealService.reshareCollection(
                collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: fixture.userKey
            )
        }

        let collectionPath = "GET /api/vault/collections/\(grant.collection_id)"
        let grantPath = "POST /api/vault/collections/\(grant.collection_id)/members"
        #expect(
            !ResealFakeServerURLProtocol.requestedPaths.contains(collectionPath),
            "a missing public key must never let getCollection run for this pair"
        )
        #expect(
            !ResealFakeServerURLProtocol.requestedPaths.contains(grantPath),
            "a missing public key must never let a doomed grant reach the network, even partially"
        )
    }

    /// The delivered level is the SHARE's own `family_wide_access_level`
    /// ("read"), never the propagator's own held `access_level` ("edit",
    /// this fixture's default -- T-40-43).
    @Test func readLevelShareDeliversReadEvenWhenPropagatorHoldsEdit() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let grant = fixture.grants[0]

        try await fixture.resealService.reshareCollection(
            collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: fixture.userKey
        )

        let posted = try #require(ResealFakeServerURLProtocol.capturedGrantBodies[grant.collection_id]?.first)
        #expect(posted["access_level"] as? String == "read")
    }

    /// A `NULL` `family_wide_access_level` (a legacy family-wide collection)
    /// falls back to `"read"`, NEVER the propagator's own level.
    @Test func nullFamilyWideLevelFallsBackToReadNeverThePropagatorsOwnLevel() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let grant = fixture.grants[0]
        ResealFakeServerURLProtocol.collections[grant.collection_id]?.familyWideAccessLevel = nil
        ResealFakeServerURLProtocol.collections[grant.collection_id]?.ownAccessLevel = "edit"

        try await fixture.resealService.reshareCollection(
            collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: fixture.userKey
        )

        let posted = try #require(ResealFakeServerURLProtocol.capturedGrantBodies[grant.collection_id]?.first)
        #expect(posted["access_level"] as? String == "read")
    }

    /// A structural 409 from the grant endpoint resolves as SUCCESS.
    @Test func conflictResponseResolvesAsSuccess() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let grant = fixture.grants[0]
        ResealFakeServerURLProtocol.grantResponseStatus[grant.collection_id] = 409

        // Must NOT throw.
        try await fixture.resealService.reshareCollection(
            collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: fixture.userKey
        )
    }

    /// The produced request body's field set equals an ordinary share's
    /// field set (`FamilyAPI.addCollectionMember`'s own wire shape) --
    /// nothing on the wire reveals this grant originated from a reseal.
    @Test func grantBodyFieldSetMatchesAnOrdinaryShareBody() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let grant = fixture.grants[0]

        try await fixture.resealService.reshareCollection(
            collectionId: grant.collection_id, recipientUserId: grant.recipient_user_id, userKey: fixture.userKey
        )

        let posted = try #require(ResealFakeServerURLProtocol.capturedGrantBodies[grant.collection_id]?.first)
        #expect(Set(posted.keys) == Set(["recipient_user_id", "sealed_key", "access_level"]))
    }

    // MARK: - Task 2: `ResealTrigger`

    /// Three fresh pairs produce three attempts; an empty list produces
    /// zero, paired here so the attempt count is shown to MOVE rather than
    /// sit at a constant zero (40-RESEARCH.md Pitfall 6).
    @Test func threeFreshPairsProduceThreeAttemptsWhileAnEmptyListProducesZero() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 3)
        let trigger = ResealTrigger(resealService: fixture.resealService)

        let emptyOutcome = await trigger.run(resealable: [], userKey: fixture.userKey)
        #expect(emptyOutcome.attempted == 0)
        #expect(emptyOutcome.succeeded.isEmpty)
        #expect(emptyOutcome.failed.isEmpty)

        let threeOutcome = await trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
        #expect(threeOutcome.attempted == 3, "the attempt count must MOVE, not sit at a constant zero")
        #expect(threeOutcome.succeeded.count == 3)
        #expect(threeOutcome.failed.isEmpty)
    }

    /// One failing pair among three does not prevent the other two from
    /// completing, and `run` never throws (it has no `throws` at all).
    @Test func oneFailingPairAmongThreeStillCompletesTheOtherTwoAndNeverThrows() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 3)
        let failingCollectionId = fixture.grants[1].collection_id
        // A genuine failure, NOT 409 (which is success) and NOT a missing
        // public key (Task 1's own concern) -- a plain server error.
        ResealFakeServerURLProtocol.grantResponseStatus[failingCollectionId] = 500

        let trigger = ResealTrigger(resealService: fixture.resealService)
        let outcome = await trigger.run(resealable: fixture.grants, userKey: fixture.userKey)

        #expect(outcome.attempted == 3)
        #expect(outcome.succeeded.count == 2)
        #expect(outcome.failed.count == 1)
        #expect(outcome.failed.first?.attempt.collectionId == failingCollectionId)
    }

    /// A lock transition (`resetAttempts()`) clears the set, so a pair
    /// already attempted this session is attempted again after it.
    @Test func lockTransitionClearsTheSetSoAPreviouslyAttemptedPairIsAttemptedAgain() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let trigger = ResealTrigger(resealService: fixture.resealService)

        let firstRun = await trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
        #expect(firstRun.attempted == 1)

        let secondRunSameSession = await trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
        #expect(secondRunSameSession.attempted == 0, "same-session repeat must be skipped -- bounds repeat work")

        await trigger.resetAttempts() // the lock/unlock transition

        let thirdRunAfterReset = await trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
        #expect(thirdRunAfterReset.attempted == 1, "a lock transition must clear the set so the pair is retried next unlock")
    }

    /// Two concurrent invocations over the SAME pair result in exactly ONE
    /// attempt -- the claim happens synchronously, before the first
    /// `await`, so Swift's actor reentrancy model makes this a structural
    /// guarantee. `grantDelayMs` widens the window the two calls' network
    /// legs genuinely overlap in, so this is a real race, not a lucky
    /// scheduling order.
    @Test func twoConcurrentInvocationsOverTheSamePairResultInExactlyOneAttempt() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let collectionId = fixture.grants[0].collection_id
        ResealFakeServerURLProtocol.grantDelayMs[collectionId] = 300

        let trigger = ResealTrigger(resealService: fixture.resealService)
        async let first = trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
        async let second = trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
        let (outcomeA, outcomeB) = await (first, second)

        #expect(
            outcomeA.attempted + outcomeB.attempted == 1,
            "the pair must be claimed by exactly ONE of the two concurrent invocations"
        )
        #expect(
            (ResealFakeServerURLProtocol.capturedGrantBodies[collectionId]?.count ?? 0) == 1,
            "exactly one grant request must have been issued for the pair"
        )
    }

    /// The trigger is never awaited on the unlock critical path -- a
    /// caller that fires it via `Task { await trigger.run(...) }` (the
    /// EXACT shape `SyncCoordinator.fireResealTriggerIfPossible()` uses)
    /// returns immediately while the trigger's own network leg is still
    /// outstanding.
    @Test func unlockPathCompletesWhileTriggersWorkIsStillOutstanding() async throws {
        ResealFakeServerURLProtocol.reset()
        let fixture = try Self.makeFixture(pairCount: 1)
        let collectionId = fixture.grants[0].collection_id
        ResealFakeServerURLProtocol.grantDelayMs[collectionId] = 500
        let started = DispatchSemaphore(value: 0)
        ResealFakeServerURLProtocol.grantRequestStarted[collectionId] = started

        let trigger = ResealTrigger(resealService: fixture.resealService)
        let flag = ResealTestCompletionFlag()

        // The "unlock path" -- fire-and-forget, mirrors
        // `SyncCoordinator.fireResealTriggerIfPossible()`'s own shape
        // exactly. This function call itself returns synchronously; the
        // trigger's own work continues in the detached `Task`.
        func simulatedUnlockPath() {
            Task {
                _ = await trigger.run(resealable: fixture.grants, userKey: fixture.userKey)
                await flag.markDone()
            }
        }
        simulatedUnlockPath() // already returned by the time control reaches here

        let requestStarted = started.wait(timeout: .now() + 2)
        #expect(requestStarted == .success, "the trigger's grant request must actually have started")
        let doneRightAfterStart = await flag.done
        #expect(doneRightAfterStart == false, "the trigger's work must still be outstanding immediately after the unlock path returned")

        try await Task.sleep(nanoseconds: 700_000_000)
        let doneAfterWaiting = await flag.done
        #expect(doneAfterWaiting == true, "the trigger's work must eventually complete on its own")
    }
}

/// Test-only synchronization point for `unlockPathCompletesWhileTriggersWorkIsStillOutstanding`
/// -- an `actor` so `done` is read/written without a data race, mirroring
/// this file's own `ResealTrigger` precedent for why an actor (not a lock)
/// is the right tool here.
private actor ResealTestCompletionFlag {
    private(set) var done = false
    func markDone() { done = true }
}

// MARK: - Task 3: E-F6, live -- iOS delivers a key to a member who could not open it

enum LiveResealError: Error, CustomStringConvertible {
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

extension ResealTriggerTests {

    /// Same hardcoded-default-over-skip discipline as every other Phase 40
    /// live test (`RemoveMemberTests`/`Fsh02ReceiveTests`) -- this run's own
    /// precondition requires `scripts/ios-live-server.sh` already running
    /// on that exact default port, against a THROWAWAY database
    /// (`reversibility="costly"`: a reseal issues a real grant).
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
    // every other Phase 40 live test's own established "add what THIS live
    // run needs, nothing wired into production" discipline)

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
            throw LiveResealError.requestFailed("createFamily", status: status, body: body)
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
            throw LiveResealError.requestFailed("addFamilyMember", status: status, body: body)
        }
    }

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
            throw LiveResealError.requestFailed("moveItem", status: status, body: body)
        }
        return try JSONDecoder().decode(ResponseBody.self, from: data).revision
    }

    fileprivate static func splitEncryptedItemJson(_ json: String) throws -> (encKeyJson: String, encDataJson: String) {
        let data = Data(json.utf8)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let encKeyObj = obj["enc_key"], let encDataObj = obj["enc_data"]
        else {
            throw LiveResealError.unexpectedShape("malformed EncryptedItem JSON: \(json)")
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
            throw LiveResealError.unexpectedShape("malformed EncryptedItem JSON: \(encKeyJson) / \(encDataJson)")
        }
        let combined = try JSONSerialization.data(withJSONObject: ["enc_key": encKeyObj, "enc_data": encDataObj])
        return String(decoding: combined, as: UTF8.self)
    }

    /// Creates a personal item then moves it into `collectionId` under
    /// `ck` -- same two-step pattern `RemoveMemberTests`/`Fsh02ReceiveTests`
    /// each already establish (a collection-scoped item cannot be created
    /// directly).
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
            throw LiveResealError.requestFailed("fetchSharedCollectionItems", status: status, body: body)
        }
        guard let snapshot = try? JSONDecoder().decode(SnapshotBody.self, from: data) else {
            throw LiveResealError.unexpectedShape("expected a snapshot from GET /api/vault/collections/\(collectionId)/sync")
        }
        return snapshot.items
    }

    /// `GET /api/vault/collections/{id}` -- returns the RAW status code
    /// rather than throwing, since the web member's OWN claim (no
    /// `collection_keys` row yet) IS the status code (404), same technique
    /// `RemoveMemberTests.collectionFetchStatus` already established.
    fileprivate static func collectionFetchStatus(baseURL: URL, token: String, collectionId: String) async throws -> Int {
        let url = URL(string: "/api/vault/collections/\(collectionId)", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? -1
    }

    /// E-F6: mirror of E-F4b (40-09) with roles swapped. A web account joins
    /// the family FIRST, before any family-wide collection exists. The iOS
    /// account THEN creates the family-wide collection (with an item), so
    /// iOS is the ONLY keyholder and the web member is missing. Unlocking
    /// the iOS app -- represented here by invoking the PRODUCTION
    /// `ResealTrigger`/`ResealService` types directly, the exact call
    /// `SyncCoordinator.pull()`'s `fireResealTriggerIfPossible()` makes --
    /// and NOTHING ELSE, heals it.
    @MainActor
    @Test func liveIosPropagatesKey() async throws {
        let baseURL = Self.liveServerBaseURL
        let runSuffix = "\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8))".lowercased()
        let emailIos = "pv-ef6-ios-\(runSuffix)@example.invalid"
        let emailWeb = "pv-ef6-web-\(runSuffix)@example.invalid"
        let password = "PvEF6-40-10-EvidencePassword!"
        let collectionName = "EF6 collection \(runSuffix)"

        let sessionIos = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailIos, password: password)
        let sessionWeb = try await AccountService(apiClient: PvApiClient(baseURL: baseURL)).register(email: emailWeb, password: password)
        let apiClient = PvApiClient(baseURL: baseURL)
        let meIos = try await apiClient.me(token: sessionIos.token)
        let meWeb = try await apiClient.me(token: sessionWeb.token)

        // ---- Order (what makes this E-F6): the web member joins the
        // family FIRST, before any family-wide collection exists. ----
        try await Self.createFamily(baseURL: baseURL, token: sessionIos.token, name: "E-F6 family \(runSuffix)")
        try await Self.addFamilyMember(baseURL: baseURL, ownerToken: sessionIos.token, memberUserId: meWeb.userId)

        // The web member publishes its identity keypair -- a real client
        // would do this on its own login/first-run; without it the reseal
        // throws before any network call and looks identical to a broken
        // trigger (Pitfall 5). Published BEFORE the collection exists,
        // exactly like E-F4b's own account B/C precedent.
        _ = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionWeb.token })
            .ensureOwnIdentityKeypair(userKey: sessionWeb.userKey)

        // ---- iOS THEN creates the family-wide collection, at "read" --
        // while iOS's OWN creator row is server-hard-coded "edit"
        // (`collections::create`) -- the exact level-mismatch fixture
        // T-40-43 targets. ----
        let collectionServiceIos = CollectionService(baseURL: baseURL, tokenProvider: { sessionIos.token })
        let collectionId = try await collectionServiceIos.createFamilyWideCollection(
            name: collectionName, accessLevel: "read", userKey: sessionIos.userKey
        )
        let identityIos = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionIos.token })
            .ensureOwnIdentityKeypair(userKey: sessionIos.userKey)
        let collectionRecordIos1 = try await collectionServiceIos.fetchCollection(id: collectionId)
        guard let sealedKeyIos1 = collectionRecordIos1.sealedKey else {
            throw LiveResealError.rowNotFound("iOS's own sealed_key for collection \(collectionId)")
        }
        #expect(collectionRecordIos1.accessLevel == "edit", "the creator's own row must be the server's hard-coded 'edit', not 'read'")
        let ck = try unsealCollectionKey(myIdentityKey: identityIos, sealedJson: sealedKeyIos1)

        let (itemId, itemPlaintext) = try await Self.createAndMoveItem(
            baseURL: baseURL, token: sessionIos.token, userKey: sessionIos.userKey, ck: ck,
            collectionId: collectionId, name: "EF6 item", secretBody: "ef6-\(runSuffix)"
        )

        // ---- Precondition: the run must be able to fail. BEFORE the iOS
        // unlock, the web member holds NO key for this collection. ----
        let pendingWebBefore = try await SharedItemsStore.fetchFamilyWidePending(baseURL: baseURL, tokenProvider: { sessionWeb.token })
        guard pendingWebBefore.missing.contains(where: { $0.collection_id == collectionId }) else {
            throw LiveResealError.preconditionViolated(
                "web member's family-wide-pending missing array does not contain \(collectionId) BEFORE the iOS unlock -- this run proves nothing"
            )
        }
        let collectionStatusBefore = try await Self.collectionFetchStatus(baseURL: baseURL, token: sessionWeb.token, collectionId: collectionId)
        #expect(collectionStatusBefore == 404, "the web member must have NO collection_keys row yet -- GET must 404")

        // ---- Distinguish "the trigger never fired" from "the recipient
        // has no published key" (Pitfall 5) BEFORE concluding either. ----
        let membersAsIos = try await FamilyAPI(baseURL: baseURL, tokenProvider: { sessionIos.token }).fetchMembers()
        guard let webMemberRecord = membersAsIos.first(where: { $0.userId == meWeb.userId }), webMemberRecord.publicKey != nil else {
            throw LiveResealError.preconditionViolated(
                "web member has no published public key on GET /api/families/members -- cannot distinguish a missing key from a broken trigger"
            )
        }

        // ---- THE iOS UNLOCK. Nothing else happens between this line and
        // the receiver-side assertions below -- no other client is opened.
        // This calls the PRODUCTION `ResealTrigger`/`ResealService` types
        // directly: the exact call `SyncCoordinator.pull()`'s
        // `fireResealTriggerIfPossible()` makes on every unlock/sync
        // transition, not a reimplementation. ----
        let pendingForIos = try await SharedItemsStore.fetchFamilyWidePending(baseURL: baseURL, tokenProvider: { sessionIos.token })
        #expect(
            pendingForIos.resealable.contains { $0.collection_id == collectionId && $0.recipient_user_id == meWeb.userId },
            "iOS's own family-wide-pending resealable array must name this exact pair before the trigger runs"
        )
        let productionTrigger = ResealTrigger(
            resealService: ResealService(baseURL: baseURL, tokenProvider: { sessionIos.token })
        )
        let triggerOutcome = await productionTrigger.run(resealable: pendingForIos.resealable, userKey: sessionIos.userKey)
        #expect(triggerOutcome.failed.isEmpty, "the reseal must succeed -- any failure here means the unlock did NOT heal the family")
        #expect(triggerOutcome.succeeded.contains { $0.collectionId == collectionId && $0.recipientUserId == meWeb.userId })

        // ---- Receiver-side proof: the web member now decrypts. ----
        let collectionServiceWeb = CollectionService(baseURL: baseURL, tokenProvider: { sessionWeb.token })
        let identityWeb = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionWeb.token })
            .ensureOwnIdentityKeypair(userKey: sessionWeb.userKey)
        let collectionRecordWeb = try await collectionServiceWeb.fetchCollection(id: collectionId)
        guard let sealedKeyWeb = collectionRecordWeb.sealedKey else {
            throw LiveResealError.rowNotFound("web member's fresh sealed_key for collection \(collectionId), after the iOS unlock")
        }
        let ckWeb = try unsealCollectionKey(myIdentityKey: identityWeb, sealedJson: sealedKeyWeb)
        let decryptedNameWeb = try decryptItemForCollection(
            ck: ckWeb, itemJson: collectionRecordWeb.encName, collectionId: collectionId, itemId: collectionId, revision: 1
        )
        #expect(decryptedNameWeb == collectionName, "the web member must decrypt the collection's REAL name, not a raw identifier")

        let itemsAsWeb = try await Self.fetchSharedCollectionItems(baseURL: baseURL, token: sessionWeb.token, collectionId: collectionId)
        guard let rowWeb = itemsAsWeb.first(where: { $0.id == itemId }) else {
            throw LiveResealError.rowNotFound("item \(itemId) in the web member's own sync snapshot, after the iOS unlock")
        }
        let combinedJsonWeb = try Self.combinedEncryptedItemJson(encKeyJson: rowWeb.enc_key, encDataJson: rowWeb.enc_data)
        let decryptedItemWeb = try decryptItemForCollection(
            ck: ckWeb, itemJson: combinedJsonWeb, collectionId: collectionId, itemId: itemId, revision: UInt32(rowWeb.revision)
        )
        #expect(decryptedItemWeb == itemPlaintext, "the web member must decrypt the item to the SAME plaintext iOS created")

        let pendingWebAfter = try await SharedItemsStore.fetchFamilyWidePending(baseURL: baseURL, tokenProvider: { sessionWeb.token })
        #expect(
            !pendingWebAfter.missing.contains { $0.collection_id == collectionId },
            "missing must be EMPTY for this collection after the iOS unlock"
        )
        let collectionStatusAfter = try await Self.collectionFetchStatus(baseURL: baseURL, token: sessionWeb.token, collectionId: collectionId)
        #expect(collectionStatusAfter == 200, "the web member must now have a collection_keys row -- GET must succeed")

        // ---- Same-key proof: a probe ciphertext sealed under iOS's
        // ORIGINAL `ck` (captured before the reseal) also opens under the
        // web member's newly-recovered key. ----
        let probeItemId = "probe-\(runSuffix)"
        let probePlaintext = "same-key-probe-\(UUID().uuidString)"
        let probeJson = try encryptItemForCollection(
            ck: ck, plaintext: probePlaintext, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        let decryptedProbeByWeb = try decryptItemForCollection(
            ck: ckWeb, itemJson: probeJson, collectionId: collectionId, itemId: probeItemId, revision: 1
        )
        #expect(decryptedProbeByWeb == probePlaintext, "the web member's recovered key must open the SAME key iOS held -- reseal, never rotation")

        // ---- Level proof: the delivered level equals the share's own
        // family_wide_access_level ("read"), never iOS's own "edit" row. ----
        let membersAccessAsWeb = try await FamilyAPI(baseURL: baseURL, tokenProvider: { sessionIos.token }).fetchMemberAccess(userId: meWeb.userId)
        let deliveredLevel = membersAccessAsWeb.collections.first { $0.id == collectionId }?.accessLevel
        #expect(deliveredLevel == "read", "the delivered level must be the SHARE's own 'read', never iOS's own 'edit'")

        // ---- Evidence ----
        let planningDir = Self.planningEvidenceDirectory
        try FileManager.default.createDirectory(at: planningDir, withIntermediateDirectories: true)
        let durableDir = Self.durableEvidenceDirectory
        try FileManager.default.createDirectory(at: durableDir, withIntermediateDirectories: true)

        let transcript = """
        E-F6 live iOS-as-propagator run -- Phase 40, plan 40-10, Task 3
        Recorded: \(Date())
        Server origin: \(baseURL.absoluteString)

        Account iOS (owner, holds the ONLY key, runs the production ResealTrigger): \(emailIos) (user_id \(meIos.userId))
        Account web (joins the family FIRST, before any family-wide collection exists): \(emailWeb) (user_id \(meWeb.userId))

        Order (what makes this E-F6, mirror of E-F4b with roles swapped): the web member joined the
        family BEFORE the family-wide collection \(collectionId) ("\(collectionName)") existed. iOS
        THEN created it at family_wide_access_level="read", with 1 item -- iOS's own creator row is
        server-hard-coded "edit" (collections::create), confirmed: \(collectionRecordIos1.accessLevel ?? "nil").

        Precondition (this run's own falsifiable assertion), BEFORE the iOS unlock:
          GET /api/families/family-wide-pending as web: missing contains \(collectionId) = \(pendingWebBefore.missing.contains { $0.collection_id == collectionId })
          GET /api/vault/collections/\(collectionId) as web: status = \(collectionStatusBefore) (expected 404 -- no collection_keys row)

        THE iOS UNLOCK (nothing else happened between this line and the receiver-side assertions --
        no other client was opened). This invoked the PRODUCTION ResealTrigger.run(resealable:userKey:)
        / ResealService.reshareCollection(...) types this plan built directly -- the EXACT call
        SyncCoordinator.pull()'s fireResealTriggerIfPossible() makes on every unlock/sync transition,
        not a reimplementation (unlike every prior Phase 40 live run, which had no production caller
        yet to invoke -- 40-09-SUMMARY.md's own "Next Phase Readiness" note):
          iOS's own family-wide-pending resealable array named (\(collectionId), \(meWeb.userId)) before the run.
          web member's published public key (GET /api/families/members): present.
          ResealTrigger.run outcome: attempted=\(triggerOutcome.attempted) succeeded=\(triggerOutcome.succeeded.count) failed=\(triggerOutcome.failed.count)

        Receiver-side proof on the web member, AFTER the iOS unlock:
          Collection name decrypted: "\(decryptedNameWeb)" (expected "\(collectionName)")
          Item decrypted: "\(decryptedItemWeb)" (expected "\(itemPlaintext)")
          GET /api/families/family-wide-pending as web, AFTER: missing contains \(collectionId) = \(pendingWebAfter.missing.contains { $0.collection_id == collectionId }) (expected false)
          GET /api/vault/collections/\(collectionId) as web, AFTER: status = \(collectionStatusAfter) (expected 200)

        Same-key proof: a probe ciphertext sealed under iOS's ORIGINAL Collection Key (captured
        before the reseal) opens under the web member's newly-recovered key: \(decryptedProbeByWeb == probePlaintext)

        Level proof: delivered access_level = \(deliveredLevel ?? "nil") (expected "read", the SHARE's own
        level -- NOT iOS's own "edit" creator row).
        """
        try transcript.write(
            to: planningDir.appendingPathComponent("40-10-ef6-transcript.txt"), atomically: true, encoding: .utf8
        )
        try transcript.write(
            to: durableDir.appendingPathComponent("40-10-ef6-transcript.txt"), atomically: true, encoding: .utf8
        )

        let beforeScreenshotView = ResealEvidenceScreen(
            heading: "E-F6 -- BEFORE the iOS unlock",
            primaryLine: PendingKeyCopy.awaitingKeyDetailTitle,
            secondaryLines: [PendingKeyCopy.awaitingKeyDetailBody]
        )
        let afterScreenshotView = ResealEvidenceScreen(
            heading: "E-F6 -- AFTER the iOS unlock",
            primaryLine: decryptedNameWeb,
            secondaryLines: [decryptedItemWeb]
        )
        let beforeRenderer = ImageRenderer(content: beforeScreenshotView)
        beforeRenderer.scale = 3
        let afterRenderer = ImageRenderer(content: afterScreenshotView)
        afterRenderer.scale = 3
        guard let beforeImage = beforeRenderer.uiImage, let beforePng = beforeImage.pngData(),
              let afterImage = afterRenderer.uiImage, let afterPng = afterImage.pngData()
        else {
            throw LiveResealError.unexpectedShape("failed to render the E-F6 evidence screenshots")
        }
        try beforePng.write(to: planningDir.appendingPathComponent("40-10-ef6-web-before.png"))
        try beforePng.write(to: durableDir.appendingPathComponent("40-10-ef6-web-before.png"))
        try afterPng.write(to: planningDir.appendingPathComponent("40-10-ef6-web-after.png"))
        try afterPng.write(to: durableDir.appendingPathComponent("40-10-ef6-web-after.png"))
    }
}

/// The captured-for-the-record evidence screen -- same "not the live app
/// view itself, but the same tokens/copy, real values" precedent
/// `Fsh02EvidenceScreen`/`InviteTests.InviteCreateEvidenceScreen` each
/// already establish (file-scoped copy, `private`, so this does not
/// collide with those).
private struct ResealEvidenceScreen: View {
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
