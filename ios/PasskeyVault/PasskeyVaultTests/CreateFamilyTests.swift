//
//  CreateFamilyTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), CR-04(b): `FamilyAPI.createFamily` --
//  `POST /api/families`, the client call this fix adds so a solo
//  self-hoster's account can create the (singleton) family from the app at
//  all. A minimal in-process URLProtocol fake, same precedent as
//  `ShareItemUpdateTests.swift`.
//

import Foundation
import Testing
@testable import PasskeyVault

final class CreateFamilyFakeServerURLProtocol: URLProtocol, @unchecked Sendable {
    static var responseStatus = 201
    static var capturedBody: [String: Any]?

    static func reset() {
        responseStatus = 201
        capturedBody = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    private func respond(_ status: Int, _ obj: [String: Any]) {
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
        Self.capturedBody = (try? JSONSerialization.jsonObject(
            with: request.httpBodyOrStream()
        )) as? [String: Any]

        if Self.responseStatus == 201 {
            respond(201, [
                "id": "family-fixture-1", "name": Self.capturedBody?["name"] as? String ?? "",
                "owner_user_id": "owner-fixture-1", "created_at": "2026-08-19T00:00:00Z",
            ])
        } else {
            respond(Self.responseStatus, ["error": "family already exists"])
        }
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
@MainActor
struct CreateFamilyTests {

    private static func makeAPI() -> FamilyAPI {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CreateFamilyFakeServerURLProtocol.self]
        return FamilyAPI(
            baseURL: URL(string: "https://fixture.invalid")!, tokenProvider: { "fixture-token" },
            session: URLSession(configuration: config)
        )
    }

    @Test func createFamilySendsThePostedNameAndDecodesTheServerResponseOn201() async throws {
        CreateFamilyFakeServerURLProtocol.reset()
        let api = Self.makeAPI()

        let record = try await api.createFamily(name: "Paczescy")

        #expect(CreateFamilyFakeServerURLProtocol.capturedBody?["name"] as? String == "Paczescy")
        #expect(record.id == "family-fixture-1")
        #expect(record.name == "Paczescy")
        #expect(record.ownerUserId == "owner-fixture-1")
    }

    /// THE decisive test (`families.rs::create`'s own doc comment): a
    /// second create (the singleton family already exists) 409s -- never a
    /// silent duplicate or a second success. `createFamily` must propagate
    /// that as a thrown error.
    @Test func createFamilyPropagatesA409WhenTheFamilyAlreadyExists() async throws {
        CreateFamilyFakeServerURLProtocol.reset()
        CreateFamilyFakeServerURLProtocol.responseStatus = 409
        let api = Self.makeAPI()

        await #expect(throws: (any Error).self) {
            try await api.createFamily(name: "Paczescy")
        }
    }

    /// 40-VERIFICATION.md human item: `FamilyRootView.createFamily()`'s own
    /// 409 branch must route to the honest "this server already has a
    /// family" alert, never the generic "Spróbuj ponownie" retry-forever
    /// copy -- falsified directly against the SAME error shape
    /// `createFamilyPropagatesA409WhenTheFamilyAlreadyExists` above proves
    /// `FamilyAPI.createFamily` actually throws on the live 409 path.
    @Test func isFamilyAlreadyExistsConflictDistinguishesA409FromOtherFailures() async throws {
        CreateFamilyFakeServerURLProtocol.reset()
        CreateFamilyFakeServerURLProtocol.responseStatus = 409
        let api = Self.makeAPI()

        do {
            _ = try await api.createFamily(name: "Paczescy")
            Issue.record("expected createFamily to throw on 409")
        } catch {
            #expect(FamilyRootView.isFamilyAlreadyExistsConflict(error))
        }

        #expect(!FamilyRootView.isFamilyAlreadyExistsConflict(PvApiError.httpError(status: 500, message: "boom")))
        #expect(!FamilyRootView.isFamilyAlreadyExistsConflict(PvApiError.invalidCredentials))
    }
}
