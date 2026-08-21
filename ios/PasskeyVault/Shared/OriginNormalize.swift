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
        //
        // WR-04 (41-REVIEW.md iteration 2): "carries no scheme at all" is NOT the same test as
        // "`URL(string:).scheme == nil`". RFC 3986's scheme grammar is `ALPHA *( ALPHA / DIGIT /
        // "+" / "-" / "." )` -- a dotted label like `example.com` is a SYNTACTICALLY valid scheme
        // name, so `URL(string: "example.com:8443")` reports `scheme == "example.com"`, `host ==
        // nil`, and the guard above never fired for it: CR-02's own issue text named exactly this
        // string ("example.com:8443", "localhost:8765") as normal user input, and both were
        // silently dropped (no QuickType entry, only a `status=skipped-unparseable-url` line
        // carrying no identifier). Treat "a scheme parsed, but there is no authority AND the raw
        // string never wrote `//` itself" as scheme-less too -- a REAL scheme+authority URL
        // (`https://example.com`, `ftp://files.example.com`) always satisfies at least one of
        // "has a host" or "the author wrote `//`", so this never overrides a genuine explicit
        // scheme.
        let looksSchemeless = (URL(string: trimmed)?.scheme == nil)
            || (URL(string: trimmed)?.host == nil && !trimmed.contains("//"))
        let candidate = looksSchemeless ? "https://\(trimmed)" : trimmed
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

    /// True when `host` has the SHAPE of a reverse-DNS app package identifier
    /// (`com.xiaomi.smarthome`, `com.contextlogic.wish` -- real values pulled from a real device
    /// log of an imported vault, 2026-08-21) rather than a real DNS hostname. A genuine hostname
    /// always carries its TLD LAST (`xiaomi.com`); a bundle identifier carries a TLD-looking word
    /// FIRST. This is the one shape difference distinguishing the two without a network
    /// round-trip -- used to fail closed BOTH in `IdentityStoreSync` (stop registering a package
    /// name as a `.domain` identity that can never match a real page) and in `FaviconLoader` (stop
    /// issuing a DNS lookup that can never return a favicon; see that file's own header).
    ///
    /// `host` is expected pre-normalized (lowercased, no scheme, no port) -- `components(fromURLString:)`'s
    /// own output already satisfies that; callers with a raw value should route through that
    /// function first rather than duplicating its parsing here.
    static func looksLikeAppPackageName(_ host: String) -> Bool {
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, let first = labels.first?.lowercased(), !first.isEmpty else { return false }
        return packageNameFirstLabels.contains(first)
    }

    /// Deliberately small and specific (not a general TLD list) -- these are the prefixes that
    /// show up as the FIRST label of a real-world app bundle identifier (`com.`, `net.`, `org.`,
    /// `io.`, `app.`); a real hostname practically never begins with one of these AND has 2+ more
    /// labels after it (a real `io.example.com` is vanishingly rare next to the volume of
    /// `com.example.app`-shaped package names an imported vault can carry).
    private static let packageNameFirstLabels: Set<String> = ["com", "net", "org", "io", "app"]
}
