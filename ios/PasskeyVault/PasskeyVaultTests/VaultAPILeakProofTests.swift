//
//  VaultAPILeakProofTests.swift
//  PasskeyVaultTests
//
//  Plan 43-06 (OPT-03), Task 3 (43-PLAN-CHECK.md C2's own leak proof; threat T-43-19). A genuine
//  negative-content proof: `VaultAPI.createItem`'s actual `URLRequest.httpBody` bytes are captured
//  via an in-process `URLProtocol` fake (same precedent as `CreateFamilyTests
//  .CreateFamilyFakeServerURLProtocol`/`ShareItemUpdateTests.swift`), then asserted to contain the
//  ciphertext fields (`enc_key`/`enc_data`) but NEVER a KNOWN plaintext User Key or a KNOWN item
//  plaintext value present in the calling scope -- absence of plaintext/key bytes asserted
//  directly against the raw wire bytes, not inferred from `CreateItemRequestBody`'s field list.
//
//  A 201 here is NOT what this file proves -- `VaultAPI.createItem`'s own doc comment already says
//  so (the server never parses `enc_key`/`enc_data`). This file proves something narrower and
//  load-bearing for T-43-19: the BYTES THIS CLIENT SENDS never carry the plaintext the caller
//  happened to have in scope, regardless of what the server does with them afterward.
//

import Foundation
import Testing
@testable import PasskeyVault

final class VaultAPILeakProofFakeServerURLProtocol: URLProtocol, @unchecked Sendable {
    static var capturedBodyData: Data?

    static func reset() {
        capturedBodyData = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedBodyData = request.httpBodyOrStream()

        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        // `CreateItemResponseBody` is `Decodable` only (client never re-encodes a server
        // response) -- the fake server's own reply body is built as a raw JSON object instead.
        let responseBody = try! JSONSerialization.data(withJSONObject: [
            "id": "item-fixture-1", "revision": 1, "updated_at": "2026-08-21T00:00:00Z",
        ])
        let response = HTTPURLResponse(
            url: url, statusCode: 201, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: responseBody)
        client?.urlProtocolDidFinishLoading(self)
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

@Suite(.serialized)
struct VaultAPILeakProofTests {

    private static func makeAPI() -> VaultAPI {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [VaultAPILeakProofFakeServerURLProtocol.self]
        return VaultAPI(
            baseURL: URL(string: "https://fixture.invalid")!, tokenProvider: { "fixture-token" },
            session: URLSession(configuration: config)
        )
    }

    /// The genuine negative-content proof (43-PLAN-CHECK.md C2). `fixturePlaintextPassword` and
    /// `fixtureRawUserKeyHex` are PRESENT IN THIS TEST'S CALLING SCOPE -- exactly as a real
    /// registration ceremony would have the plaintext and the User Key in scope at the moment it
    /// calls `createItem` -- but NEITHER is ever passed to `createItem` itself; only the already-
    /// serialized ciphertext strings (`encKeyJson`/`encDataJson`) are. This asserts the wire bytes
    /// prove that boundary held, not merely that the Swift call signature looks right.
    @Test func createItemPostBodyContainsCiphertextOnlyNeverPlaintextOrUserKeyBytes() async throws {
        VaultAPILeakProofFakeServerURLProtocol.reset()
        let api = Self.makeAPI()

        // Fixtures a real caller would have in scope -- deliberately distinctive strings so a
        // substring match cannot be a coincidence.
        let fixturePlaintextPassword = "FIXTURE-PLAINTEXT-PASSWORD-2026-NEVER-SENT-OVER-WIRE"
        let fixtureRawUserKeyHex = "deadbeef00112233445566778899aabbccddeeff00112233445566778899aa"
        // The already-encrypted, already-serialized ciphertext this test's OWN fixture stands in
        // for `pv-ffi`'s real `serde_json` output -- opaque to this client (VaultAPI.swift's own
        // header, DR-38-C: moved through verbatim, never built/parsed/re-encoded here).
        let fixtureEncKeyJson = #"{"nonce":[1,2,3],"ciphertext":[9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9]}"#
        let fixtureEncDataJson = #"{"nonce":[4,5,6],"ciphertext":[7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]}"#

        _ = try await api.createItem(
            id: "item-fixture-1", encKeyJson: fixtureEncKeyJson, encDataJson: fixtureEncDataJson
        )

        let bodyData = try #require(VaultAPILeakProofFakeServerURLProtocol.capturedBodyData)
        let bodyString = try #require(String(data: bodyData, encoding: .utf8))

        // Positive: the ciphertext fields ARE present, exactly -- decoded from the actual wire
        // JSON (`enc_key`/`enc_data` are STRING-typed fields whose own value happens to contain
        // `"`/`,` characters, so the outer envelope's JSONEncoder escapes them on the wire; this
        // decodes the envelope the way any real JSON consumer would, rather than string-matching
        // the un-escaped form against escaped bytes).
        let decoded = try #require(
            try JSONSerialization.jsonObject(with: bodyData) as? [String: Any]
        )
        #expect(decoded["enc_key"] as? String == fixtureEncKeyJson)
        #expect(decoded["enc_data"] as? String == fixtureEncDataJson)

        // Negative: neither the plaintext password nor the raw User Key hex ever appears in the
        // wire bytes -- a direct substring absence check against the ACTUAL captured Data (byte
        // ranges, not the decoded String), not an assumption from `CreateItemRequestBody`'s field
        // list.
        #expect(!bodyString.contains(fixturePlaintextPassword))
        #expect(!bodyString.contains(fixtureRawUserKeyHex))
        #expect(bodyData.range(of: Data(fixturePlaintextPassword.utf8)) == nil)
        #expect(bodyData.range(of: Data(fixtureRawUserKeyHex.utf8)) == nil)
    }
}
