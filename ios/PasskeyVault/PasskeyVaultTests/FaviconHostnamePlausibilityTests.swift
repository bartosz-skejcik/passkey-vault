//
//  FaviconHostnamePlausibilityTests.swift
//  PasskeyVaultTests
//
//  Privacy fix, 2026-08-21 -- real device log (Bartek's own vault, hosted instance): an imported
//  entry whose URL field held an Android app package name (`com.xiaomi.smarthome`,
//  `com.contextlogic.wish`) was being resolved as a DNS hostname on every list render, i.e. a
//  `favicon.ico` GET was attempted against it -- a lookup that can NEVER return a favicon (a
//  package name is not a website) while still handing the resolver "a vault entry named this
//  exists" for free. `FaviconLoader.isPlausibleDNSHostname` is the guard that stops it;
//  `OriginNormalize.looksLikeAppPackageName` is the shape predicate it (and the identity-store
//  registrar, `IdentityStoreSync.serviceHost`) both reuse rather than duplicating.
//
//  Test values are taken directly from the evidence: `com.xiaomi.smarthome` and
//  `com.contextlogic.wish` are the two package names that actually appeared in Bartek's own
//  `-1003 could not be found` log lines.
//

import Foundation
import Testing
@testable import PasskeyVault

struct FaviconHostnamePlausibilityTests {

    // MARK: - Reject: app package names (the actual leak this fix closes)

    @Test func rejectsXiaomiSmarthomePackageName() {
        #expect(!FaviconLoader.isPlausibleDNSHostname("com.xiaomi.smarthome"))
    }

    @Test func rejectsContextlogicWishPackageName() {
        #expect(!FaviconLoader.isPlausibleDNSHostname("com.contextlogic.wish"))
    }

    // MARK: - Reject: non-http(s) schemes

    @Test func rejectsAndroidappScheme() {
        #expect(!FaviconLoader.isPlausibleDNSHostname("androidapp://com.foo.bar"))
    }

    @Test func rejectsOtpauthScheme() {
        #expect(!FaviconLoader.isPlausibleDNSHostname("otpauth://totp/Example:alice@example.com?secret=ABC"))
    }

    // MARK: - Reject: single-label hosts

    @Test func rejectsSingleLabelLocalhost() {
        #expect(!FaviconLoader.isPlausibleDNSHostname("localhost"))
    }

    // MARK: - Reject: empty/blank

    @Test func rejectsEmptyString() {
        #expect(!FaviconLoader.isPlausibleDNSHostname(""))
    }

    @Test func rejectsBlankString() {
        #expect(!FaviconLoader.isPlausibleDNSHostname("   "))
    }

    // MARK: - Accept: ordinary hosts

    @Test func acceptsOrdinaryDomain() {
        #expect(FaviconLoader.isPlausibleDNSHostname("github.com"))
    }

    @Test func acceptsMultiLabelSubdomain() {
        #expect(FaviconLoader.isPlausibleDNSHostname("sub.example.co.uk"))
    }

    @Test func acceptsDomainWithPort() {
        #expect(FaviconLoader.isPlausibleDNSHostname("example.com:8443"))
    }

    // MARK: - Accept: IP literals (self-hosted/LAN entries are legitimate, WR-09-style)

    @Test func acceptsIPv4Literal() {
        #expect(FaviconLoader.isPlausibleDNSHostname("192.168.1.10"))
    }

    @Test func acceptsIPv4LiteralWithPort() {
        #expect(FaviconLoader.isPlausibleDNSHostname("192.168.1.10:8080"))
    }

    @Test func acceptsIPv6Literal() {
        #expect(FaviconLoader.isPlausibleDNSHostname("2001:db8::1"))
    }

    @Test func acceptsBracketedIPv6LiteralWithPort() {
        #expect(FaviconLoader.isPlausibleDNSHostname("[::1]:8080"))
    }

    // MARK: - The shared shape predicate (`OriginNormalize.looksLikeAppPackageName`) directly

    @Test func sharedPredicateFlagsPackageNameShape() {
        #expect(OriginNormalize.looksLikeAppPackageName("com.xiaomi.smarthome"))
        #expect(OriginNormalize.looksLikeAppPackageName("com.contextlogic.wish"))
    }

    @Test func sharedPredicateDoesNotFlagOrdinaryDomains() {
        #expect(!OriginNormalize.looksLikeAppPackageName("github.com"))
        #expect(!OriginNormalize.looksLikeAppPackageName("sub.example.co.uk"))
    }
}
