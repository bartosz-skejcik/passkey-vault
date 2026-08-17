//
//  ServerSettingsTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-12, Task 1.
//
//  Written FIRST, before `Core/ServerSettings.swift` exists (RED-before-green,
//  transcript recorded in `38-12-SUMMARY.md`). Covers every row in the plan's
//  `<behavior>` block: default resolution, normalisation (whitespace/trailing
//  slash/missing scheme), the three refusals (path, non-loopback `http://`,
//  unparseable), the loopback carve-out asserted BOTH positively and
//  negatively in this same file (acceptance criterion), and the Keychain
//  side effect of `store(_:)`.
//
//  `.serialized`: every test here mutates the SAME shared `UserDefaults` key
//  (`pv.server.url`) and the SAME shared Keychain services
//  (`SessionTokenStore.service`, `UkEnvelopeStore.service`) as
//  `KeychainEnvelopeTests`/`BiometricGateSimulatorTests` already do -- Swift
//  Testing runs `@Test` methods concurrently by default, which would race
//  these on-disk items across methods in this file. Serializing is a
//  correctness requirement, matching the established convention
//  (`KeychainEnvelopeTests.swift`'s own header).
//

import Foundation
import Security
@testable import PasskeyVault
import Testing

@Suite(.serialized)
struct ServerSettingsTests {

    // MARK: - Shared reset

    /// Clears the persisted server URL and both Keychain items this file's
    /// deletion tests exercise, so every test starts from a known state
    /// regardless of run order or what a prior test left behind. Called at
    /// the START of every test that reads `resolved` or calls `store`, and
    /// again via `defer` so a later suite (or a real app launch against this
    /// same simulator) never inherits this file's fixture URL.
    private static func resetPersistedState() {
        UserDefaults.standard.removeObject(forKey: "pv.server.url")
        SessionTokenStore.clear()
        UkEnvelopeStore.delete()
    }

    /// Attribute-only existence check -- deliberately requests
    /// `kSecReturnAttributes`, never `kSecReturnData`, so it does NOT trigger
    /// the `.biometryCurrentSet` access-control evaluation `UkEnvelopeStore`
    /// attaches to its item. Same pattern `KeychainEnvelopeTests
    /// .storedTokenItemReportsTheExpectedAccessibleClass` already uses for
    /// `SessionTokenStore`'s item.
    private static func envelopeItemExists() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: UkEnvelopeStore.service,
            kSecUseDataProtectionKeychain as String: true,
            kSecReturnAttributes as String: true,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return status == errSecSuccess
    }

    // MARK: - Default resolution

    /// Asserted against a PRIVATE, volatile defaults suite this test creates
    /// and destroys, never `UserDefaults.standard`.
    ///
    /// The earlier version of this test reset `.standard` and asserted on
    /// `ServerSettings.resolved`. It passed throughout plan 38-12 and began
    /// failing on 2026-08-17 with `resolved == "http://127.0.0.1:8621"` --
    /// the UI harness's own server -- *after* its own reset had run.
    /// `UserDefaults.standard` is disk-backed and shared across processes, the
    /// UI tests seed `pv.server.url` through `simctl`, and CFPreferences
    /// re-syncs that value into this process. The test was not wrong about the
    /// default; it was asserting on a global it could not own.
    ///
    /// This does not weaken the check -- it still asserts the exact shipped
    /// default string, and `defaultIsNotSilentlyDependentOnTheSuite` below
    /// pins that the same answer comes from an empty suite of any name, so a
    /// suite that happened to be pre-populated could not fake a pass.
    @Test func withNothingStoredResolvedIsExactlyTheShippedDefault() throws {
        let name = "pv.tests.serversettings.default"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        defer { defaults.removePersistentDomain(forName: name) }

        #expect(defaults.string(forKey: "pv.server.url") == nil, "the suite must genuinely be empty")
        #expect(ServerSettings.resolved(in: defaults).absoluteString == "https://vault.blonie.cloud")
    }

    /// The falsification companion: a suite with a value stored must NOT
    /// resolve to the default. Without this, the assertion above would pass
    /// identically against an implementation that ignored the store entirely
    /// and always returned the constant.
    @Test func aStoredValueInTheSuiteOverridesTheDefault() throws {
        let name = "pv.tests.serversettings.override"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        defer { defaults.removePersistentDomain(forName: name) }

        defaults.set("https://vault.example.com", forKey: "pv.server.url")
        #expect(ServerSettings.resolved(in: defaults).absoluteString == "https://vault.example.com")
    }

    // MARK: - Normalisation

    @Test func bareHostNormalisesToHttpsPrefixed() throws {
        let url = try ServerSettings.normalise("vault.example.com").get()
        #expect(url.absoluteString == "https://vault.example.com")
    }

    @Test func surroundingWhitespaceAndTrailingSlashNormaliseToTheSameValue() throws {
        let url = try ServerSettings.normalise("  https://vault.example.com/  ").get()
        #expect(url.absoluteString == "https://vault.example.com")
    }

    // MARK: - Refusal 1: path component present

    @Test func urlCarryingAPathIsRefusedAndTheMessageNamesPaths() {
        let result = ServerSettings.normalise("https://example.com/vault")
        guard case let .failure(error) = result else {
            Issue.record("expected refusal for a URL carrying a path")
            return
        }
        #expect("\(error)".localizedCaseInsensitiveContains("path"))
        #expect("\(error)".localizedCaseInsensitiveContains("not supported"))
    }

    // MARK: - Refusal 2: http:// against a non-loopback host, naming ATS

    @Test func nonLoopbackHttpIsRefusedAndNamesAppTransportSecurity() {
        let result = ServerSettings.normalise("http://vault.example.com")
        guard case let .failure(error) = result else {
            Issue.record("expected refusal for non-loopback http://")
            return
        }
        #expect("\(error)".contains("App Transport Security"))
    }

    // MARK: - Loopback carve-out: positive AND negative in this same file

    @Test func loopbackIpv4HttpIsAccepted() throws {
        let url = try ServerSettings.normalise("http://127.0.0.1:8620").get()
        #expect(url.absoluteString == "http://127.0.0.1:8620")
    }

    @Test func loopbackHostnameHttpIsAccepted() throws {
        let url = try ServerSettings.normalise("http://localhost:8620").get()
        #expect(url.absoluteString == "http://localhost:8620")
    }

    @Test func nonLoopbackHttpIsRefusedNotABlanketAccept() {
        // Same assertion as `nonLoopbackHttpIsRefusedAndNamesAppTransportSecurity`,
        // restated as the acceptance criterion's own required negative pairing
        // with the two positive loopback tests immediately above -- the
        // carve-out must not read as "http:// is always fine".
        let result = ServerSettings.normalise("http://vault.example.com")
        guard case .failure = result else {
            Issue.record("expected refusal: loopback carve-out must not be a blanket accept")
            return
        }
    }

    // MARK: - Refusal 3: unparseable / no host / non-http(s) scheme

    @Test func notAUrlIsRefused() {
        let result = ServerSettings.normalise("not a url")
        guard case .failure = result else {
            Issue.record("expected refusal for \"not a url\"")
            return
        }
    }

    @Test func emptyStringIsRefused() {
        let result = ServerSettings.normalise("")
        guard case .failure = result else {
            Issue.record("expected refusal for an empty string")
            return
        }
    }

    @Test func schemeOnlyStringIsRefused() {
        let result = ServerSettings.normalise("https://")
        guard case .failure = result else {
            Issue.record("expected refusal for a scheme-only string")
            return
        }
    }

    // MARK: - store(_:) side effect: server change wipes credentials

    @Test func storingADifferentUrlDeletesTheSessionTokenAndTheUserKeyEnvelope() throws {
        Self.resetPersistedState()
        defer { Self.resetPersistedState() }

        // Establish a known starting server so "different" is unambiguous.
        try ServerSettings.store(URL(string: "https://vault.blonie.cloud")!)

        SessionTokenStore.save("fixture-session-token-38-12")
        try UkEnvelopeStore.store(Data("fixture-envelope-bytes-38-12".utf8))
        #expect(SessionTokenStore.load() != nil)
        #expect(Self.envelopeItemExists())

        try ServerSettings.store(URL(string: "https://vault.example.com")!)

        #expect(SessionTokenStore.load() == nil)
        #expect(!Self.envelopeItemExists())
        #expect(ServerSettings.resolved.absoluteString == "https://vault.example.com")
    }

    @Test func storingTheIdenticalUrlDoesNotDeleteEitherSecret() throws {
        Self.resetPersistedState()
        defer { Self.resetPersistedState() }

        try ServerSettings.store(URL(string: "https://vault.blonie.cloud")!)

        SessionTokenStore.save("fixture-session-token-38-12-identical")
        try UkEnvelopeStore.store(Data("fixture-envelope-bytes-38-12-identical".utf8))
        #expect(SessionTokenStore.load() != nil)
        #expect(Self.envelopeItemExists())

        // Same URL, byte-for-byte -- storing it again must be a no-op for
        // both Keychain items.
        try ServerSettings.store(URL(string: "https://vault.blonie.cloud")!)

        #expect(SessionTokenStore.load() != nil)
        #expect(Self.envelopeItemExists())
    }
}
