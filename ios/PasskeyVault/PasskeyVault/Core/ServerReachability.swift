//
//  ServerReachability.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-12, Task 2. Answers "is this
//  address actually a Passkey Vault server" for 38-13's onboarding screen,
//  which checks reachability BEFORE `Continue` succeeds
//  (`docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md`
//  §3.2): *"A typo must fail here, not as a confusing sign-in error two
//  screens later."*
//
//  `GET {base}/healthz` (`crates/pv-server/src/routes/mod.rs`'s `healthz`
//  handler, `Json(json!({ "status": "ok" }))`), and the response is decoded
//  and its `status` field checked -- NEVER accepted on the HTTP status code
//  alone. A 200 is returned by captive portals, by an unrelated web server
//  on the same host, and by a reverse proxy fronting a different
//  application -- every one of which would make the onboarding screen tell
//  a self-hoster their address is correct right before sign-in fails for
//  reasons the screen already had the information to prevent. This is the
//  same defect shape as this repo's own recurring "a check that cannot
//  fail" family (`ios/IOS-SPIKE-LOG.md` L-9).
//
//  An ephemeral `URLSessionConfiguration` (never `URLSession.shared`) means
//  a health response is never written to the on-disk `URLCache`, which
//  would otherwise reveal the configured server while the device is locked.
//

import Foundation

/// Three-case result, so 38-13's screen can say something different for
/// "nothing answered" and "something answered but it is not a Passkey
/// Vault".
enum Reachability: Equatable {
    /// `GET /healthz` returned 200 with `{"status":"ok"}`.
    case reachable
    /// `URLSession` itself failed (no network, DNS, connection refused,
    /// timeout) before an HTTP response was ever received, or the response
    /// was not a 200 at all. `reason` is the transport/HTTP failure's own
    /// description, never a generic placeholder.
    case unreachable(reason: String)
    /// Something answered with 200, but the body did not parse as this
    /// product's health JSON (or `status` was not `"ok"`) -- a captive
    /// portal, an unrelated web server, or a misdirected reverse proxy.
    case wrongServer
}

enum ServerReachability {
    private struct HealthzBody: Decodable {
        let status: String
    }

    /// `session` defaults to a fresh ephemeral session per call so
    /// production call sites need no setup -- exposed as a parameter only
    /// so `ServerReachabilityTests` can inject a stubbed
    /// `URLSessionConfiguration` for the `wrongServer` case, which must not
    /// depend on finding a hostile server in the wild.
    static func check(_ base: URL, session: URLSession = Self.ephemeralSession()) async -> Reachability {
        guard let url = URL(string: "/healthz", relativeTo: base) else {
            return .unreachable(reason: "could not construct /healthz URL against \(base)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        // Explicit request-level timeout: this probe must never hang the
        // calling screen, independent of the session configuration's own
        // default.
        request.timeoutInterval = 10

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            return .unreachable(reason: error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode
            return .unreachable(reason: "server responded with status \(status.map(String.init) ?? "unknown")")
        }

        guard let decoded = try? JSONDecoder().decode(HealthzBody.self, from: data),
              decoded.status == "ok"
        else {
            // The status-code check above already passed -- this is
            // deliberately a DIFFERENT case from `.unreachable`, not a
            // restatement of it: something answered, it just is not us.
            return .wrongServer
        }

        return .reachable
    }

    private static func ephemeralSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }
}
