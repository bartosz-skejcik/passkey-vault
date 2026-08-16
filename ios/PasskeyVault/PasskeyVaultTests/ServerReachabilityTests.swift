//
//  ServerReachabilityTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-12, Task 2.
//
//  Written FIRST, before `Core/ServerReachability.swift` exists
//  (RED-before-green, transcript recorded in `38-12-SUMMARY.md`).
//
//  The `wrongServer` case is the load-bearing one this task exists for
//  (a 200 from a captive portal / unrelated web server / misdirected proxy
//  must never read as reachable): it is driven by a local `URLProtocol`
//  stub, not a hostile server in the wild, so the assertion does not depend
//  on finding one. `ReachabilityStubURLProtocol` is registered ONLY on a
//  per-test, per-call `URLSessionConfiguration` (`Self.stubSession()`) --
//  never via the global `URLProtocol.registerClass(_:)` -- so it can never
//  leak into another test file's real networking.
//
//  The live-server case follows `AccountFlowLiveTests`' own `PV_TEST_SERVER`
//  convention (defaulting to `http://127.0.0.1:8621`), but -- unlike that
//  file's own choice to hardcode-rather-than-skip -- is wrapped in
//  `.enabled(if:)` against a synchronous TCP probe of that same host/port,
//  so the suite stays green with no server running rather than failing for
//  an environmental reason (this plan's own action text). A SKIPPED run of
//  this test is not evidence by itself -- this task's SUMMARY records a
//  transcript where it actually ran against a real, live `pv-server`.
//

import Foundation
@testable import PasskeyVault
import Testing

// MARK: - Stub URLProtocol

/// Answers every request with a canned status code and body, and records the
/// most recently observed `URLRequest` so a test can assert on
/// `timeoutInterval` without needing a real timeout to elapse. Registered
/// only on an ephemeral `URLSessionConfiguration` built per test
/// (`ServerReachabilityTests.stubSession()`) -- this class is never told
/// about the shared session.
final class ReachabilityStubURLProtocol: URLProtocol, @unchecked Sendable {
    struct Stub {
        let statusCode: Int
        let body: Data
    }

    /// Set by each test immediately before calling `check`, cleared via
    /// `defer` -- this file's suite is `.serialized` (below) so only one
    /// stub is ever in flight.
    static var stub: Stub?
    static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        guard let stub = Self.stub, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        let response = HTTPURLResponse(
            url: url,
            statusCode: stub.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// `.serialized`: every test in this file mutates the SAME static
/// `ReachabilityStubURLProtocol.stub`/`.lastRequest` state -- Swift Testing
/// runs `@Test` methods concurrently by default, which would race two tests
/// setting different stub responses against the same class properties.
@Suite(.serialized)
struct ServerReachabilityTests {

    // MARK: - Live server convention (matches `AccountFlowLiveTests`)

    private static var liveServerURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// Synchronous TCP connect probe, used only to decide whether the live
    /// test below should run or be skipped -- deliberately NOT the code
    /// under test (`ServerReachability.check` is async and parses a body;
    /// this is a plain `connect(2)`).
    private static func isPortOpen(host: String, port: UInt16) -> Bool {
        let sock = socket(AF_INET, SOCK_STREAM, 0)
        guard sock >= 0 else { return false }
        defer { close(sock) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr(host)

        let result = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                connect(sock, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }

    private static var liveServerIsUp: Bool {
        guard let host = liveServerURL.host else { return false }
        return isPortOpen(host: host, port: UInt16(liveServerURL.port ?? 80))
    }

    // MARK: - Stub session helper

    private static func stubSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReachabilityStubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    // MARK: - The load-bearing case: 200 with a body that is not ours

    @Test func serverAnswering200WithAForeignBodyReportsWrongServerNotReachable() async {
        ReachabilityStubURLProtocol.stub = .init(
            statusCode: 200, body: Data(#"{"hello":"world"}"#.utf8)
        )
        defer { ReachabilityStubURLProtocol.stub = nil }

        let result = await ServerReachability.check(
            URL(string: "http://stub.invalid")!, session: Self.stubSession()
        )
        #expect(result == .wrongServer)
    }

    // MARK: - A 200 with the real body reports reachable (positive control
    // for the case immediately above -- proves the stub path isn't just
    // always returning `.wrongServer`)

    @Test func serverAnswering200WithTheRealHealthBodyReportsReachable() async {
        ReachabilityStubURLProtocol.stub = .init(
            statusCode: 200, body: Data(#"{"status":"ok"}"#.utf8)
        )
        defer { ReachabilityStubURLProtocol.stub = nil }

        let result = await ServerReachability.check(
            URL(string: "http://stub.invalid")!, session: Self.stubSession()
        )
        #expect(result == .reachable)
    }

    // MARK: - Nothing listening

    @Test func nothingListeningReportsUnreachableWithTheTransportErrorNotAGenericFailure() async {
        // A real, unused loopback port -- no stub involved, a genuine TCP
        // connection attempt that is refused immediately.
        let result = await ServerReachability.check(URL(string: "http://127.0.0.1:1")!)
        guard case let .unreachable(reason) = result else {
            Issue.record("expected .unreachable, got \(result)")
            return
        }
        #expect(!reason.isEmpty)
        // A generic failure would carry no distinguishing text at all;
        // URLSession's own connection-refused description names the
        // transport layer.
        #expect(reason.localizedCaseInsensitiveContains("connect")
            || reason.localizedCaseInsensitiveContains("network")
            || reason.localizedCaseInsensitiveContains("server"))
    }

    // MARK: - Bounded timeout

    @Test func theProbeSetsABoundedTenSecondTimeoutOnTheRequestItBuilds() async {
        ReachabilityStubURLProtocol.stub = .init(statusCode: 200, body: Data(#"{"status":"ok"}"#.utf8))
        defer {
            ReachabilityStubURLProtocol.stub = nil
            ReachabilityStubURLProtocol.lastRequest = nil
        }

        _ = await ServerReachability.check(
            URL(string: "http://stub.invalid")!, session: Self.stubSession()
        )

        #expect(ReachabilityStubURLProtocol.lastRequest?.timeoutInterval == 10)
    }

    // MARK: - Live server (skips cleanly when nothing is running; NOT a
    // substitute for the SUMMARY's own recorded live transcript)

    @Test(.enabled(if: ServerReachabilityTests.liveServerIsUp))
    func liveServerReportsReachable() async {
        let result = await ServerReachability.check(Self.liveServerURL)
        #expect(result == .reachable)
    }
}
