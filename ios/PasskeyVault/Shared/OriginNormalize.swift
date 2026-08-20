//
//  OriginNormalize.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  CR-02 (41-REVIEW.md): before this file existed, `IdentityStoreSync.serviceHost(fromURLString:)`
//  (the REGISTRAR) and `CredentialMatcher.originComponents(fromURLString:)` (the fill-time MATCHER)
//  applied TWO DIFFERENT rules to the SAME stored URL string. The registrar deliberately handled a
//  bare host ("example.com") by retrying with an assumed `https://` prefix; the matcher required an
//  explicit scheme and refused everything else. Result: a login item whose URL was typed without a
//  scheme (a completely normal thing a user types) got a QuickType entry that could NEVER fill --
//  offered, then silently refused at every fill attempt, with no user-visible explanation.
//
//  This file is the ONE place that reading now happens. Both `IdentityStoreSync` and
//  `CredentialMatcher` derive host/origin through this same function, so the two ends of the
//  registrar<->matcher contract can never diverge again by construction.
//
//  The https-assumption applies ONLY to a string that carries NO scheme at all (chosen to match
//  IdentityStoreSync's own pre-existing registrar behaviour, and the web extension's own
//  permissive `new URL()`-style parsing of user-typed values) -- a string that DOES carry an
//  explicit scheme is read as-is, never overridden. This is what keeps the matcher's own full
//  origin-equality policy (T-10-05) intact: a `.url`-typed target from a real visited page always
//  carries an explicit scheme, so the assumption never fires on the VISITED side, only on the
//  STORED side when the stored value itself was scheme-less -- a `http://` visit against a
//  `https://`-assumed stored bare host still correctly refuses (different scheme, different
//  origin), per 41-05-PLAN.md's own prohibition against widening the policy to make a test pass.
//
//  A value that still fails to parse after the https-assumption is a genuine parse failure --
//  both sides refuse it (fail closed), never register/match on the raw, un-parseable string.
//

import Foundation

enum OriginNormalize {
    struct Components: Equatable {
        let scheme: String
        let host: String
        let port: Int
    }

    private static func defaultPort(forScheme scheme: String) -> Int? {
        switch scheme {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    /// Full scheme+host+port, assuming `https://` for an input that carries no scheme at all.
    /// Mirrors `frame-guard.ts`'s own `originEquals` parsing discipline: fails CLOSED (returns
    /// `nil`), never treats "could not parse" as a match, and normalizes an explicit or implicit
    /// port to the scheme's IANA default so `"https://x"` and `"https://x:443"` compare equal.
    static func components(fromURLString raw: String) -> Components? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // A stored/target value with no scheme is read as a bare host/authority -- assume
        // `https://` rather than refusing outright. Only applied when `URL(string:)` itself
        // reports no scheme; a string that DOES carry one (including a non-http(s) one) is passed
        // through unchanged, so this never overrides an explicit scheme mismatch.
        let candidate = (URL(string: trimmed)?.scheme == nil) ? "https://\(trimmed)" : trimmed
        guard let url = URL(string: candidate), let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), !host.isEmpty
        else { return nil }
        let port = url.port ?? defaultPort(forScheme: scheme)
        guard let resolvedPort = port else { return nil }
        return Components(scheme: scheme, host: host, port: resolvedPort)
    }

    /// Host only -- what `.domain`-typed identity-store registration needs
    /// (`IdentityStoreSync.serviceHost(fromURLString:)`). `nil` on a genuine parse failure (fail
    /// closed, never register a raw, un-parseable string as a domain -- WR-09).
    static func host(fromURLString raw: String) -> String? {
        components(fromURLString: raw)?.host
    }
}
