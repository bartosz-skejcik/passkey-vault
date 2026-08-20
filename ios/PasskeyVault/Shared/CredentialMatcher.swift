//
//  CredentialMatcher.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-05, Task 2 (DR-41-B).
//
//  A pure, dependency-free mirror of this repo's canonical credential<->service matching policy --
//  `extension/entrypoints/background/frame-guard.ts`'s `originEquals`/`itemMatchesOrigin`
//  (`:135-184`, intent stated at `:22-23` as T-10-05: full origin equality, scheme + hostname +
//  port, via `URL#origin` -- deliberately NO suffix/substring matching). `.domain`-typed
//  registration (`IdentityStoreSync.swift`, unchanged by DR-41-B -- see `ios/IOS-SPIKE-LOG.md` §1
//  for the record) means the SYSTEM's own QuickType suggestion set is host-based and, per E41-3
//  (`ios/evidence/41/e41-3-matching-matrix.md`), effectively UNBOUNDED once a registration has
//  propagated -- offered on completely unrelated hosts, not merely same-host variants.
//
//  CORRECTED FINDING (E41-3-policy, live this session, DR-41-B): `request.credentialIdentity
//  .serviceIdentifier` -- the fill entry point's own target -- ECHOES OUR OWN REGISTRATION
//  verbatim, never the actually-visited page. This file therefore CANNOT enforce origin equality
//  against the live page for `.domain`-typed identities; `IdentityStoreSync` derives the
//  registered host directly from the item's own stored URL, so the echoed identity and the item's
//  own data are self-consistent by construction regardless of which page triggered the fill. What
//  this file's fill-time call sites DO genuinely enforce is a DATA-INTEGRITY property: does the
//  identity that was selected actually belong to the item it claims to (T-41-25, a
//  corrupted/malicious identity-store entry) -- proven live via a deliberate item/identity
//  mismatch, not via a mismatched visited page. `prepareCredentialList(for:)`'s own array DOES
//  carry the live page's real `.URL`-typed identifier (confirmed live), but that callback never
//  reaches a specific fill decision in this milestone (no picker UI is built) -- see
//  `logCandidateMatchEvaluation` in `CredentialProviderViewController.swift` for where that
//  signal is evaluated and logged, never gated.
//
//  `MatchTarget` carries the lossy conversion EXPLICITLY in its own cases rather than hiding it
//  inside a helper: a `.domain`-typed identifier structurally carries no scheme or port at all
//  (RFC 1035), so origin equality is UNAVAILABLE for it by construction -- `matches(...)` degrades
//  to host-only comparison for that one case, and every call site can see which case it is in.
//
//  Per-item-type rules mirror `itemMatchesOrigin`'s own asymmetry exactly: login is strictly
//  origin-bound (URL set); totp is bound by issuer/host heuristic (`issuerMatchesHost`, ported
//  verbatim from the TypeScript's own normalization rules); card and identity are offered on ANY
//  http(s)-reachable target (not origin-bound data); note is NEVER offered. This milestone's
//  identity store carries ONLY login items today (`VaultStore.identitySources(from:)` -- only
//  `.login` items ever become an `ASPasswordCredentialIdentity`), so the non-login branches are
//  exercised only by this file's own unit tests (`CredentialMatcherTests.swift`,
//  `PasskeyVaultTests`) -- written for correctness and future-proofing, matching the extension's
//  own policy exactly rather than a narrower "logins only" rule that would silently diverge the
//  moment this milestone's scope widens.
//
//  Prohibition (41-05-PLAN.md's own `must_haves.prohibitions`, T-41-25): this matcher NEVER widens
//  beyond the policy to make a test pass. A location the browser extension would refuse fills on
//  iOS is a DR-41-B finding, never a licence to relax this file.
//

import Foundation

/// The system's own service-identifier target, as `prepareCredentialList(for:)`'s array element or
/// `request.credentialIdentity.serviceIdentifier` hands it to us -- never pre-converted to an
/// origin before reaching this type, so the LOSSY `.domain` case stays visible at every call site.
enum MatchTarget: Equatable {
    /// An RFC-1035 domain, no scheme or port at all -- what `.domain`-typed identifiers (and this
    /// repo's current `IdentityStoreSync` registration, unchanged by DR-41-B) carry.
    case domain(host: String)
    /// An RFC-1738 URL string with a real, unambiguous origin.
    case url(String)

    /// `serviceIdentifier.type` is `.domain`, `.URL`, or (`ios(26.2)`) `.app` -- an `.app` value is
    /// treated as an opaque, non-web identifier: it carries no host or origin this policy can
    /// reason about at all, so it degrades to `.domain` with the raw identifier string (fails
    /// closed on every login-item origin check below, exactly like an unparseable URL does).
    init(serviceIdentifier: ASCredentialServiceIdentifierLike) {
        if serviceIdentifier.matchType == .url {
            self = .url(serviceIdentifier.matchIdentifier)
        } else {
            self = .domain(host: serviceIdentifier.matchIdentifier)
        }
    }
}

/// Decouples this file from `AuthenticationServices` so it stays testable from `PasskeyVaultTests`
/// (a plain XCTest target) without linking the framework's app-extension-only symbols, and so a
/// synthetic identifier can be constructed directly in tests. `CredentialProviderViewController`
/// (the real caller) conforms `ASCredentialServiceIdentifier` to this below.
protocol ASCredentialServiceIdentifierLike {
    var matchIdentifier: String { get }
    var matchType: MatchIdentifierType { get }
}

enum MatchIdentifierType {
    case domain
    case url
}

/// The six item-type union, as far as matching cares. Deliberately NOT `Vault/ItemFields.swift`'s
/// `ItemFields` (HOST-ONLY target membership -- `IdentityStoreSync.swift`'s own header explains
/// why the extension has no dependency on that file); `passkey` is excluded entirely -- this
/// milestone never offers a passkey item as a PASSWORD credential (Phase 43, conditional,
/// `41-RESEARCH.md` "Explicitly NOT in the stack").
enum MatchableItemType {
    case login
    case card
    case identity
    case note
    case totp
}

enum CredentialMatcher {
    /// The single entry point. `urls` is the login item's own stored URL set (empty for every
    /// other type); `issuer`/`name` are the totp item's own fields (`TotpFields.issuer`/`.name`,
    /// empty for every other type) -- the caller passes whatever it has, never contorts a
    /// login-only call site into supplying totp fields or vice versa.
    static func matches(
        itemType: MatchableItemType, urls: [String], issuer: String, name: String, target: MatchTarget
    ) -> Bool {
        switch itemType {
        case .login:
            return urls.contains { !$0.isEmpty && loginUrlMatches($0, target: target) }
        case .totp:
            return issuerMatchesHost(issuer: issuer, name: name, target: target)
        case .card, .identity:
            return true
        case .note:
            return false
        }
    }

    // MARK: - Login: full origin equality (T-10-05), including the `.domain` degradation

    /// CR-02 (41-REVIEW.md): both `stored` and `visited` now derive through
    /// `OriginNormalize.components(fromURLString:)` -- the SAME function `IdentityStoreSync
    /// .serviceHost(fromURLString:)` (the registrar) uses -- so a bare-host stored URL
    /// ("example.com") is read identically at registration time and at fill time. The
    /// https-assumption only ever applies to a string that itself carries no scheme; a `.url`
    /// target from a real visited page always carries an explicit scheme, so a genuine
    /// scheme mismatch (`http://` visit vs a `https://`-assumed stored bare host) still refuses,
    /// preserving T-10-05's full origin equality.
    private static func loginUrlMatches(_ storedUrl: String, target: MatchTarget) -> Bool {
        guard let stored = OriginNormalize.components(fromURLString: storedUrl) else { return false }
        switch target {
        case let .url(raw):
            guard let visited = OriginNormalize.components(fromURLString: raw) else { return false }
            return stored == visited
        case let .domain(host):
            // LOSSY: no scheme/port in a `.domain` identifier -- host-only comparison, explicitly
            // weaker than the canonical full-origin policy. DR-41-B names this cost; it is not
            // hidden here.
            return stored.host.caseInsensitiveCompare(host) == .orderedSame
        }
    }

    // MARK: - Totp: issuer/host heuristic, ported verbatim from `frame-guard.ts`'s own rules

    /// Mirrors `frame-guard.ts`'s `issuerMatchesHost` exactly: lowercases and strips
    /// non-alphanumerics from `issuer`/`name`, splits the target host into labels >= 3 characters
    /// (excluding "com"/"www"/"net"/"org"), and matches if either string contains the other. Fails
    /// CLOSED on an unparseable target -- a `.domain` target has no scheme to fail on, so its raw
    /// host string is used directly (the same lossy-but-still-a-host case `loginUrlMatches` above
    /// names).
    private static func issuerMatchesHost(issuer: String, name: String, target: MatchTarget) -> Bool {
        let host: String
        switch target {
        case let .domain(rawHost):
            host = rawHost.lowercased()
        case let .url(raw):
            guard let url = URL(string: raw), let parsedHost = url.host?.lowercased() else { return false }
            host = parsedHost
        }
        guard !host.isEmpty else { return false }

        let excluded: Set<String> = ["com", "www", "net", "org"]
        let labels = host.split(separator: ".").map(String.init).filter { $0.count >= 3 && !excluded.contains($0) }
        let candidates = [issuer, name]
            .map { raw -> String in
                // `frame-guard.ts`'s `replace(/[^a-z0-9]/g, "")` -- keep only letters and digits.
                String(raw.lowercased().filter { $0.isLetter || $0.isNumber })
            }
            .filter { $0.count >= 3 }
        return candidates.contains { candidate in
            labels.contains { label in label == candidate || label.contains(candidate) || candidate.contains(label) }
        }
    }
}
