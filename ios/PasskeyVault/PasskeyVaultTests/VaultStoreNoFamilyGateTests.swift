//
//  VaultStoreNoFamilyGateTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), WR-17/WR-20: `VaultStore
//  .mergeSharedAndFamilyWideItems()` previously issued its full four-
//  endpoint fan-out (`ensureOwnIdentityKeypair` -- which durably PUBLISHES
//  an identity keypair on first call -- `GET /api/sync/shared/direct`,
//  `GET /api/families/family-wide-pending`, `GET /api/vault/collections`)
//  on EVERY refresh, forever, for a caller with no family. This proves,
//  against a real in-process fake server (`URLProtocol`, same precedent as
//  `Fsh02FakeServerURLProtocol`), that: (1) the merge's endpoints are
//  called on the FIRST refresh, (2) a 404 from `family-wide-pending`
//  latches `hasNoFamily` and skips `listCollections()` in the SAME cycle,
//  (3) NONE of the four merge endpoints are called on a SECOND refresh
//  while the gate is latched, and (4) `familyMembershipMayHaveChanged()`
//  clears the gate so a THIRD refresh calls them again.
//

import Foundation
import Testing
@testable import PasskeyVault

final class NoFamilyGateFakeServerURLProtocol: URLProtocol, @unchecked Sendable {
    static var requestedPaths: [String] = []
    static var identityPublicKeyB64: String?
    static var identityWrappedSecretKeyJson: String?

    static func reset() {
        requestedPaths = []
        identityPublicKeyB64 = nil
        identityWrappedSecretKeyJson = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private func jsonBody() -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: request.httpBodyOrStream())) as? [String: Any] ?? [:]
    }

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
        Self.requestedPaths.append("\(method) \(path)")

        if method == "GET", path == "/api/sync" {
            respond(200, ["revision": 1, "items": [], "folders": []])
            return
        }
        if method == "GET", path == "/api/identity/keypair" {
            if let pk = Self.identityPublicKeyB64, let wsk = Self.identityWrappedSecretKeyJson {
                respond(200, ["public_key": pk, "wrapped_secret_key": wsk, "adopted_existing": true])
            } else {
                respond(404, [:])
            }
            return
        }
        if method == "PUT", path == "/api/identity/keypair" {
            let body = jsonBody()
            let pk = body["public_key"] as? String ?? ""
            let wsk = body["wrapped_secret_key"] as? String ?? ""
            Self.identityPublicKeyB64 = pk
            Self.identityWrappedSecretKeyJson = wsk
            respond(200, ["public_key": pk, "wrapped_secret_key": wsk, "adopted_existing": false])
            return
        }
        if method == "GET", path == "/api/sync/shared/direct" {
            respond(200, ["revision": 0, "items": []])
            return
        }
        if method == "GET", path == "/api/families/family-wide-pending" {
            // families.rs::family_wide_pending is family-gated -- 404 for a
            // non-member, mirroring the real server this fixture stands in
            // for.
            respond(404, ["error": "not found"])
            return
        }
        if method == "GET", path == "/api/vault/collections" {
            // collections.rs::list is FamilyMembership<RequireRead>-gated --
            // 404 for a non-member. Reached ONLY if the gate this test
            // exists to prove failed to skip it.
            respond(404, ["error": "not found"])
            return
        }

        respond(404, ["error": "unhandled route in NoFamilyGateFakeServerURLProtocol: \(method) \(path)"])
    }

    override func stopLoading() {}
}

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
/// `NoFamilyGateFakeServerURLProtocol` state -- same hazard
/// `ResealTriggerTests`/`ShareItemUpdateTests` already document this
/// identical fix for.
@Suite(.serialized)
@MainActor
struct VaultStoreNoFamilyGateTests {

    private static let mergeEndpointPaths: Set<String> = [
        "GET /api/identity/keypair", "PUT /api/identity/keypair",
        "GET /api/sync/shared/direct", "GET /api/families/family-wide-pending", "GET /api/vault/collections",
    ]

    private static func makeStore() throws -> VaultStore {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [NoFamilyGateFakeServerURLProtocol.self]
        let session = URLSession(configuration: config)
        let userKey = try FfiUserKey.generate()
        let api = VaultAPI(baseURL: URL(string: "https://fixture.invalid")!, tokenProvider: { "fixture-token" }, session: session)
        return VaultStore(userKey: userKey, api: api)
    }

    /// THE decisive test (WR-17's own fix note): the merge's endpoints ARE
    /// called on the first refresh, a 404 on `family-wide-pending` skips
    /// `listCollections()` in that SAME cycle (never requested), and NONE
    /// of the four merge endpoints are requested again on a second refresh
    /// while the gate is latched.
    @Test func secondRefreshIssuesNoneOfTheFourMergeEndpointsOnceNoFamilyIsLatched() async throws {
        NoFamilyGateFakeServerURLProtocol.reset()
        let store = try Self.makeStore()

        try await store.refresh()
        let firstCyclePaths = Set(NoFamilyGateFakeServerURLProtocol.requestedPaths)
        #expect(firstCyclePaths.contains("GET /api/families/family-wide-pending"))
        #expect(
            !firstCyclePaths.contains("GET /api/vault/collections"),
            "listCollections() must be skipped in the SAME cycle once family-wide-pending 404s"
        )

        NoFamilyGateFakeServerURLProtocol.requestedPaths = []
        try await store.refresh()
        let secondCyclePaths = Set(NoFamilyGateFakeServerURLProtocol.requestedPaths)
        let mergeCallsOnSecondCycle = secondCyclePaths.intersection(Self.mergeEndpointPaths)
        #expect(
            mergeCallsOnSecondCycle.isEmpty,
            "no merge endpoint should be called on a second refresh while hasNoFamily is latched, got \(mergeCallsOnSecondCycle)"
        )
        // The personal pull itself is NOT gated -- only the merge fan-out.
        #expect(secondCyclePaths.contains("GET /api/sync"))
    }

    /// THE decisive test (WR-20's own fix note): `familyMembershipMayHaveChanged()`
    /// clears the gate, so a subsequent refresh issues the merge's
    /// endpoints again -- a member who joins a family in-session is not
    /// stranded until the next lock/unlock.
    @Test func familyMembershipMayHaveChangedReenablesTheMergeOnTheNextRefresh() async throws {
        NoFamilyGateFakeServerURLProtocol.reset()
        let store = try Self.makeStore()

        try await store.refresh() // latches hasNoFamily
        NoFamilyGateFakeServerURLProtocol.requestedPaths = []
        try await store.refresh() // gated -- no merge calls
        #expect(
            Set(NoFamilyGateFakeServerURLProtocol.requestedPaths).intersection(Self.mergeEndpointPaths).isEmpty
        )

        store.familyMembershipMayHaveChanged()
        NoFamilyGateFakeServerURLProtocol.requestedPaths = []
        try await store.refresh()
        let thirdCyclePaths = Set(NoFamilyGateFakeServerURLProtocol.requestedPaths)
        #expect(
            thirdCyclePaths.contains("GET /api/families/family-wide-pending"),
            "the merge must run again after familyMembershipMayHaveChanged()"
        )
    }
}
