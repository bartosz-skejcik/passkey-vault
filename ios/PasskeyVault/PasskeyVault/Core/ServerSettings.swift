//
//  ServerSettings.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-12, Task 1. The server the app
//  talks to, made a first-class, persisted, validated setting
//  (`docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md`
//  §3.2, §6) instead of the compiled-in `ContentView.defaultServerURL` this
//  plan retires (Task 3). This file is the model and the wiring only -- the
//  onboarding screen that presents it is 38-13.
//
//  Persisted in `UserDefaults`, not the Keychain: this value is the address
//  of a server, not a credential, so Keychain would add a biometric-adjacent
//  failure mode (locked-device unavailability, `.biometryCurrentSet`
//  interaction) for a setting that carries no secret.
//
//  `normalise(_:)` is a pure function -- no `UserDefaults`, no network, no
//  view -- so the whole validation surface is testable directly
//  (`ServerSettingsTests.swift`). It applies three refusals, in this order
//  so the most specific message wins when more than one would apply:
//
//  1. Path component present. Every request in `PvApiClient`/`VaultAPI` is
//     built with an absolute path (`"/api/auth/login"`), and
//     `URL(string:relativeTo:)` resolves an absolute path against the
//     ORIGIN, discarding any base path -- so `https://example.com/vault`
//     would silently issue `https://example.com/api/auth/login`, and
//     neither client can notice. Refusing it is a correct answer the user
//     can act on; accepting it would be a wrong answer with no error
//     anywhere. Supporting subpaths means changing both `send`
//     implementations and proving it against a server actually mounted
//     under a prefix -- out of scope here (landmine + backlog item, Task 3).
//  2. `http://` against a non-loopback host. The app ships no
//     `NSAppTransportSecurity` key (`ios/IOS-SPIKE-LOG.md` §"ATS -- H1
//     confirmed"), so such a request fails at runtime with
//     `NSURLErrorAppTransportSecurityRequiresSecureConnection` (-1022) -- a
//     message no user can map back to the scheme they typed. Loopback
//     (`127.0.0.1`, `::1`, `localhost`) is exempt: ATS permits it, and every
//     live test harness in this repo depends on it.
//  3. Unparseable / no host / non-http(s) scheme.
//

import Foundation

/// The three refusals `ServerSettings.normalise`/`store` can produce.
/// `CustomStringConvertible.description` is the user-facing message -- each
/// case names the specific reason for its refusal rather than a generic
/// "invalid URL".
enum ServerSettingsError: Error, CustomStringConvertible, Equatable {
    /// Refusal 1: the URL carries a path component.
    case pathNotSupported(String)
    /// Refusal 2: `http://` against a host ATS would not exempt.
    case insecureScheme(host: String)
    /// Refusal 3: unparseable, missing host, or a non-http(s) scheme.
    case invalid(String)

    var description: String {
        switch self {
        case let .pathNotSupported(raw):
            return "\"\(raw)\" has a path, and paths are not supported -- enter the server's address only, e.g. \"vault.example.com\"."
        case let .insecureScheme(host):
            return "http:// to \(host) is refused by App Transport Security. Use https://, or http:// only for a loopback address such as 127.0.0.1 or localhost."
        case let .invalid(raw):
            return "\"\(raw)\" is not a valid server address."
        }
    }
}

/// The persisted, validated server setting. `resolved` is the single read
/// path every request-constructing call site (`ContentView`, and 38-13's
/// onboarding form) must use -- never cache the result in a `let` property
/// that outlives a settings change (Task 3 fixes exactly that in
/// `ContentView`).
enum ServerSettings {
    /// `docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md`
    /// §3.2: "Default: `https://vault.blonie.cloud`".
    static let defaultURLString = "https://vault.blonie.cloud"

    private static let userDefaultsKey = "pv.server.url"

    /// The address a fresh install resolves to, and what every stored value
    /// falls back to if it somehow fails to parse (a corrupted or
    /// future-format `UserDefaults` value is not a crash, it is a reset to
    /// the shipped default).
    static var resolved: URL { resolved(in: .standard) }

    /// The same resolution against an EXPLICIT defaults store.
    ///
    /// WHY THIS OVERLOAD EXISTS — a test-isolation defect, not a preference.
    /// `UserDefaults.standard` is disk-backed and shared ACROSS PROCESSES:
    /// CFPreferences re-syncs values written by another process into a running
    /// one. The UI tests pre-seed `pv.server.url` on the simulator via
    /// `simctl` (`ItemListSearchUITests`, `SnapshotEvidenceUITests` both say
    /// so in their headers), so a unit test asserting "with nothing stored"
    /// could call `removeObject` and STILL read the seeded value moments
    /// later, from disk, through no fault of its own.
    ///
    /// Observed 2026-08-17: `withNothingStoredResolvedIsExactlyTheShippedDefault`
    /// failed with `resolved == "http://127.0.0.1:8621"` -- the UI harness's
    /// server -- immediately after its own reset. It passed for the whole of
    /// plan 38-12 only because no UI test had seeded the key yet.
    ///
    /// A test cannot own a cross-process global by mutating it. It can own an
    /// injected one. Production call sites keep using `resolved`; tests pass a
    /// private volatile suite they create and destroy themselves.
    static func resolved(in defaults: UserDefaults) -> URL {
        if let raw = defaults.string(forKey: userDefaultsKey),
           let url = URL(string: raw)
        {
            return url
        }
        return URL(string: defaultURLString)!
    }

    /// Pure. Trims, prepends `https://` when no scheme is present, parses
    /// with `URLComponents`, then applies the three refusals documented in
    /// this file's header.
    static func normalise(_ raw: String) -> Result<URL, ServerSettingsError> {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .failure(.invalid(raw))
        }
        let candidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let components = URLComponents(string: candidate) else {
            return .failure(.invalid(raw))
        }
        return validate(components, raw: raw)
    }

    /// Shared by `normalise` and `store` so the boundary has exactly one
    /// implementation of the three refusals. `store` re-validates rather
    /// than trusting a caller already ran `normalise` -- the Keychain wipe
    /// below depends on this boundary being correct.
    private static func validate(
        _ components: URLComponents,
        raw: String
    ) -> Result<URL, ServerSettingsError> {
        // Refusal 1: path component present. Checked on the parsed
        // components regardless of scheme validity, so it wins over the
        // other two refusals when more than one would apply -- the most
        // specific message wins.
        let path = components.path
        if !path.isEmpty, path != "/" {
            return .failure(.pathNotSupported(raw))
        }

        // Refusal 2: http:// against a non-loopback host.
        if let scheme = components.scheme?.lowercased(), scheme == "http" {
            let host = components.host ?? ""
            if !isLoopback(host) {
                return .failure(.insecureScheme(host: host))
            }
        }

        // Refusal 3: unparseable / no host / non-http(s) scheme.
        guard let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty
        else {
            return .failure(.invalid(raw))
        }

        var canonical = components
        canonical.path = ""
        guard let url = canonical.url else {
            return .failure(.invalid(raw))
        }
        return .success(url)
    }

    /// ATS's own loopback carve-out (`ios/IOS-SPIKE-LOG.md` §"ATS -- H1
    /// confirmed"): `127.0.0.1`/`::1`/`localhost`, plus the wider
    /// `127.0.0.0/8` loopback block.
    private static func isLoopback(_ host: String) -> Bool {
        let lower = host.lowercased()
        return lower == "127.0.0.1" || lower == "::1" || lower == "localhost"
            || lower.hasPrefix("127.")
    }

    /// Persists `url` as the resolved server. Re-validates via the same
    /// three refusals `normalise` applies (see `validate` above) -- this is
    /// the boundary the Keychain wipe below depends on being correct, so it
    /// does not trust that the caller already validated.
    ///
    /// When the incoming URL differs from the currently resolved one, the
    /// session token and the User Key envelope are deleted BEFORE the new
    /// value is written: a session token is issued by one server and the
    /// envelope wraps a User Key for one account on that server. Carrying
    /// either across a server change would route the user to a Lock screen
    /// for an account the new server has never heard of, and the failure
    /// would surface as an unexplained auth error rather than as the server
    /// change that caused it.
    static func store(_ url: URL) throws {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw ServerSettingsError.invalid(url.absoluteString)
        }
        let validated: URL
        switch validate(components, raw: url.absoluteString) {
        case let .success(u):
            validated = u
        case let .failure(error):
            throw error
        }

        let previous = resolved
        if validated.absoluteString != previous.absoluteString {
            SessionTokenStore.clear()
            UkEnvelopeStore.delete()
            // Phase 42-era correction: the cached account envelope
            // (`AccountEnvelopeCache`) is the SAME class of per-server
            // secret as the two above -- it wraps a User Key for one
            // account on the PREVIOUS server, and carrying it across a
            // server change would let `ContentView`'s local-first restore
            // route straight to a Lock screen for an account the NEW server
            // has never heard of. `AccountEnvelopeCache.swift`'s own header
            // names this file as one of the two places (alongside
            // `AccountService.logout()`) that must clear it.
            AccountEnvelopeCache.clear()
        }
        UserDefaults.standard.set(validated.absoluteString, forKey: userDefaultsKey)
        // Plan 43-06, Task 1 (DR-43-A): an ADDITIONAL, read-only companion copy for the
        // AutoFill extension -- `.standard` is disk-backed but per-BUNDLE-ID, and the host app
        // and `.AutoFill` extension are different bundle ids, so `.standard` alone never reaches
        // the extension process. This does not replace `.standard` as the host's own primary
        // read path (`resolved`/`resolved(in:)` above, unchanged) -- it is a second write of the
        // SAME value, to the SAME App Group suite `IdentityStoreSync.swift` already uses, so
        // `VaultAPI.extensionBaseURL()` can read it. The extension never calls `store(_:)` itself.
        UserDefaults(suiteName: "group.cloud.blonie.PasskeyVault")?.set(
            validated.absoluteString, forKey: userDefaultsKey
        )
    }
}
