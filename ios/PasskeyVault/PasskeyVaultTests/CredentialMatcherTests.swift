//
//  CredentialMatcherTests.swift
//  PasskeyVaultTests
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-05, Task 2 (DR-41-B).
//
//  Rule 2 deviation (GSD executor rules): 41-05-PLAN.md's own `files_modified` does not name this
//  file, but `CredentialMatcher.swift` is a pure, dependency-free function -- exactly the shape this
//  target's own existing tests (`VaultSearchTests.swift`, `OtpauthParserTests.swift`) already unit
//  test directly -- and this task's own acceptance criteria requires the per-item-type behaviour
//  (note never offered; card/identity never URL-gated) to be checked, not merely asserted in prose.
//  Documented as a deviation in 41-05-SUMMARY.md, matching `IdentityStoreSyncProbe.swift`'s own
//  precedent for this exact class of addition.
//
//  Every case here is written against `extension/entrypoints/background/frame-guard.ts`'s ACTUAL
//  behaviour (`itemMatchesOrigin`/`originEquals`/`issuerMatchesHost`, `:135-214`), never against an
//  intuition about what "matching" ought to do -- mirroring `VaultSearchTests.swift`'s own stated
//  discipline (D5).
//

import Foundation
import Testing
@testable import PasskeyVault

struct CredentialMatcherTests {

    // MARK: - Login: full origin equality, URL-typed target (unambiguous)

    @Test func loginMatchesExactOriginViaUrlTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .url("https://example.com/")
        )
        #expect(matched)
    }

    @Test func loginRefusesDifferentSchemeViaUrlTarget() {
        // T-10-05: full origin equality includes scheme -- http != https at the same host.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .url("http://example.com/")
        )
        #expect(!matched)
    }

    @Test func loginRefusesDifferentPortViaUrlTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .url("https://example.com:8443/")
        )
        #expect(!matched)
    }

    @Test func loginRefusesSubdomainViaUrlTarget() {
        // T-10-05: no suffix/substring matching -- a subdomain is a DIFFERENT origin.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .url("https://evil.example.com/")
        )
        #expect(!matched)
    }

    @Test func loginRefusesLookalikeDomainViaUrlTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://bank.example/login"], issuer: "", name: "",
            target: .url("https://evil-bank.example/")
        )
        #expect(!matched)
    }

    @Test func loginMatchesImplicitDefaultPortAgainstExplicitDefaultPort() {
        // `URL#origin` normalizes an implicit default port and an explicit one to the SAME origin
        // -- this file's own `originComponents` mirrors that.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .url("https://example.com:443/")
        )
        #expect(matched)
    }

    @Test func loginRefusesUnparseableStoredUrl() {
        // Fails CLOSED on an unparseable stored URL, never treats "could not parse" as a match.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["not a url"], issuer: "", name: "",
            target: .url("https://example.com/")
        )
        #expect(!matched)
    }

    @Test func loginRefusesUnparseableTargetUrl() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .url("not a url")
        )
        #expect(!matched)
    }

    // MARK: - Login: the `.domain` LOSSY degradation (host-only, explicitly weaker)

    @Test func loginMatchesHostOnlyViaDomainTarget() {
        // The `.domain` case has no scheme/port at all -- host-only comparison, DR-41-B's own
        // named cost, not a bug.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .domain(host: "example.com")
        )
        #expect(matched)
    }

    @Test func loginDomainTargetIsCaseInsensitive() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://Example.com/login"], issuer: "", name: "",
            target: .domain(host: "EXAMPLE.COM")
        )
        #expect(matched)
    }

    @Test func loginRefusesDifferentHostViaDomainTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://example.com/login"], issuer: "", name: "",
            target: .domain(host: "evil.example.com")
        )
        #expect(!matched)
    }

    @Test func loginChecksEveryStoredUrlNotJustTheFirst() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["https://other.example/", "https://example.com/login"],
            issuer: "", name: "", target: .url("https://example.com/")
        )
        #expect(matched)
    }

    @Test func loginIgnoresEmptyStoredUrlEntries() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: [""], issuer: "", name: "",
            target: .url("https://example.com/")
        )
        #expect(!matched)
    }

    // MARK: - Totp: issuer/host heuristic, ported verbatim

    @Test func totpMatchesIssuerAgainstHostLabel() {
        let matched = CredentialMatcher.matches(
            itemType: .totp, urls: [], issuer: "GitHub", name: "",
            target: .url("https://github.com/")
        )
        #expect(matched)
    }

    @Test func totpFallsBackToNameWhenIssuerEmpty() {
        let matched = CredentialMatcher.matches(
            itemType: .totp, urls: [], issuer: "", name: "GitHub",
            target: .url("https://github.com/")
        )
        #expect(matched)
    }

    @Test func totpMatchesIssuerAgainstDomainTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .totp, urls: [], issuer: "Google", name: "",
            target: .domain(host: "accounts.google.com")
        )
        #expect(matched)
    }

    @Test func totpRefusesUnrelatedIssuer() {
        let matched = CredentialMatcher.matches(
            itemType: .totp, urls: [], issuer: "GitHub", name: "",
            target: .url("https://example.com/")
        )
        #expect(!matched)
    }

    // MARK: - Card/identity: offered everywhere; note: never offered

    @Test func cardIsOfferedRegardlessOfTarget() {
        #expect(CredentialMatcher.matches(
            itemType: .card, urls: [], issuer: "", name: "", target: .url("https://anything.example/")
        ))
        #expect(CredentialMatcher.matches(
            itemType: .card, urls: [], issuer: "", name: "", target: .domain(host: "anything.example")
        ))
    }

    @Test func identityIsOfferedRegardlessOfTarget() {
        #expect(CredentialMatcher.matches(
            itemType: .identity, urls: [], issuer: "", name: "", target: .url("https://anything.example/")
        ))
    }

    @Test func noteIsNeverOffered() {
        #expect(!CredentialMatcher.matches(
            itemType: .note, urls: ["https://example.com/"], issuer: "", name: "",
            target: .url("https://example.com/")
        ))
        #expect(!CredentialMatcher.matches(
            itemType: .note, urls: [], issuer: "", name: "", target: .domain(host: "example.com")
        ))
    }

    // MARK: - `MatchTarget(serviceIdentifier:)` -- the lossy conversion's own construction site

    private struct FakeServiceIdentifier: ASCredentialServiceIdentifierLike {
        let matchIdentifier: String
        let matchType: MatchIdentifierType
    }

    @Test func matchTargetFromDomainTypeIsDomainCase() {
        let target = MatchTarget(serviceIdentifier: FakeServiceIdentifier(matchIdentifier: "example.com", matchType: .domain))
        #expect(target == .domain(host: "example.com"))
    }

    @Test func matchTargetFromUrlTypeIsUrlCase() {
        let target = MatchTarget(serviceIdentifier: FakeServiceIdentifier(matchIdentifier: "https://example.com/", matchType: .url))
        #expect(target == .url("https://example.com/"))
    }

    // MARK: - CR-02 (41-REVIEW.md): a scheme-less stored URL must be fillable, both against a
    // `.domain` target (registrar's own registration shape) and a `.url` target that assumed the
    // SAME https default the registrar assumed -- and a genuine scheme mismatch must still refuse.

    @Test func loginMatchesSchemeLessStoredUrlAgainstDomainTarget() {
        // The registrar registers a `.domain`-typed identity for a bare-host item regardless of
        // scheme, so the domain-target comparison was never broken by CR-02 -- this pins that it
        // stays true now that `loginUrlMatches` routes through `OriginNormalize`.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["example.com"], issuer: "", name: "",
            target: .domain(host: "example.com")
        )
        #expect(matched)
    }

    @Test func loginMatchesSchemeLessStoredUrlAgainstHttpsUrlTarget() {
        // CR-02's own defect: before the shared `OriginNormalize` helper, this was the case that
        // registered fine (via IdentityStoreSync's own bare-host handling) but could NEVER fill
        // (CredentialMatcher required an explicit scheme and refused everything else).
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["example.com"], issuer: "", name: "",
            target: .url("https://example.com/")
        )
        #expect(matched)
    }

    @Test func loginRefusesSchemeMismatchWhenStoredUrlIsSchemeLess() {
        // CR-02's own guard against overcorrection: the https-assumption applies ONLY to the
        // scheme-less STORED value -- a `.url` target visiting over plain http still does not
        // match a stored bare host (which is read as https), preserving T-10-05's full origin
        // equality rather than widening the policy to make scheme-less items match anything.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["example.com"], issuer: "", name: "",
            target: .url("http://example.com/")
        )
        #expect(!matched)
    }

    // MARK: - WR-04 (41-REVIEW.md iteration 2): a bare `host:port` (no scheme at all) is CR-02's
    // own named example of normal user input ("example.com:8443", "localhost:8765") -- Foundation's
    // RFC-3986 scheme grammar accepts a dotted label as a syntactically valid scheme name, so
    // `URL(string:).scheme == nil` alone was not evidence of "no scheme", and both strings were
    // silently dropped (no host, no port, no QuickType entry) before this fix.

    @Test func loginMatchesHostColonPortStoredUrlAgainstDomainTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["example.com:8443"], issuer: "", name: "",
            target: .domain(host: "example.com")
        )
        #expect(matched, "a bare host:port with no scheme must still register/match by host -- WR-04")
    }

    @Test func loginMatchesHostColonPortStoredUrlAgainstHttpsUrlTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["example.com:8443"], issuer: "", name: "",
            target: .url("https://example.com:8443/")
        )
        #expect(matched, "the assumed https scheme plus the EXPLICIT port from the bare host:port string must both carry through -- WR-04")
    }

    @Test func loginMatchesLocalhostColonPortStoredUrlAgainstDomainTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["localhost:8765"], issuer: "", name: "",
            target: .domain(host: "localhost")
        )
        #expect(matched, "localhost:PORT is CR-02's own named example of normal user input -- WR-04")
    }

    @Test func loginMatchesLocalhostColonPortStoredUrlAgainstHttpsUrlTarget() {
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["localhost:8765"], issuer: "", name: "",
            target: .url("https://localhost:8765/")
        )
        #expect(matched)
    }

    @Test func loginRefusesWrongPortWhenStoredUrlIsHostColonPort() {
        // The explicit port from the bare host:port string is load-bearing, not discarded --
        // a visit to a DIFFERENT port on the same host must still refuse (full origin equality,
        // T-10-05), exactly as it would for an explicit-scheme stored URL.
        let matched = CredentialMatcher.matches(
            itemType: .login, urls: ["example.com:8443"], issuer: "", name: "",
            target: .url("https://example.com:9999/")
        )
        #expect(!matched)
    }
}
