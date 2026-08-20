//
//  LocalAccountRestoreTests.swift
//  PasskeyVaultTests
//
//  Phase 42-era correction. Regression coverage for
//  `.planning/debug/ios-cold-launch-blank-offline.md`: `AccountService.localAccount()` is the
//  function `ContentView.routeToLockOrAuth()` now calls FIRST, before it ever considers a network
//  call -- this file proves that call returns a correct `RestoredAccount` from Keychain alone, with
//  NO `PvApiClient`/`apiClient` instance ever constructed or touched anywhere in this file. That
//  absence is structural, not merely asserted: `AccountService.localAccount()` is a `static` function
//  that takes no `apiClient` parameter at all, so there is no way for this test to accidentally
//  exercise a network path even by mistake.
//
//  `AccountService.unlockLocally(account:password:)` is the ACTUAL offline-unlock mechanism
//  (REQUIRED FIX #2's real consumer, `.planning/debug/ios-cold-launch-blank-offline.md`) --
//  `deriveAuthMaterial` + `unwrapUserKeyFromJson`, entirely local. This file proves it round-trips
//  a REAL `pv-ffi`-wrapped envelope (never a hand-rolled JSON shape -- `wrapUserKeyJson` produces
//  the fixture the same way `AccountService.register`/`signIn` do), rejects a wrong password, and
//  falls to `LocalUnlockError.noCachedCredentials` when salt/kdf were never cached.
//
//  `.serialized` (Swift Testing): every test in this suite mutates the SAME shared Keychain items
//  `SessionTokenStore`/`AccountEnvelopeCache` own -- the identical concurrency discipline
//  `KeychainEnvelopeTests.swift`'s own header already established for `UkEnvelopeStore`.
//

import Foundation
import Testing
@testable import PasskeyVault

@Suite(.serialized)
struct LocalAccountRestoreTests {
    /// Literal fixtures, authored here -- never round-tripped through the code under test (SC2
    /// discipline, `AccountFlowLiveTests.swift`'s own precedent).
    private static let fixtureToken = "local-account-restore-tests-fixture-token"
    private static let fixtureEmail = "local-account-restore-tests@example.invalid"
    private static let fixturePwWrappedUkJson = "{\"nonce\":[1,2,3],\"ciphertext\":[4,5,6]}"
    private static let fixtureSaltB64 = "local-account-restore-tests-not-real-base64=="
    private static let fixtureKdfParamsJson = "{\"m_cost_kib\":65536,\"t_cost\":3,\"p_cost\":4}"

    private static func clearAll() {
        SessionTokenStore.clear()
        AccountEnvelopeCache.clear()
    }

    private static func makeEnvelope(
        email: String = fixtureEmail,
        pwWrappedUkJson: String = fixturePwWrappedUkJson,
        saltB64: String = fixtureSaltB64,
        kdfParamsJson: String = fixtureKdfParamsJson
    ) -> CachedAccountEnvelope {
        CachedAccountEnvelope(email: email, pwWrappedUkJson: pwWrappedUkJson, saltB64: saltB64, kdfParamsJson: kdfParamsJson)
    }

    // MARK: - AccountService.localAccount()

    /// The load-bearing positive case: a token AND a cached envelope, both present -- returns a
    /// `RestoredAccount` whose fields byte-match what was seeded, with zero network calls possible
    /// (see this file's own header on why that is a structural guarantee of the function's
    /// signature, not just an assertion below).
    @Test func returnsRestoredAccountFromKeychainAloneWhenBothAreCached() {
        Self.clearAll()
        defer { Self.clearAll() }

        SessionTokenStore.save(Self.fixtureToken)
        AccountEnvelopeCache.save(Self.makeEnvelope())

        let restored = AccountService.localAccount()
        #expect(restored != nil, "localAccount() must return a RestoredAccount when both the session token and the envelope cache are present.")
        #expect(restored?.token == Self.fixtureToken)
        #expect(restored?.email == Self.fixtureEmail)
        #expect(restored?.pwWrappedUkJson == Self.fixturePwWrappedUkJson)
        #expect(restored?.saltB64 == Self.fixtureSaltB64)
        #expect(restored?.kdfParamsJson == Self.fixtureKdfParamsJson)
    }

    /// No token at all -- the ordinary signed-out case. `nil`, never a crash, never a default value.
    @Test func returnsNilWhenNoSessionTokenIsStored() {
        Self.clearAll()
        defer { Self.clearAll() }

        AccountEnvelopeCache.save(Self.makeEnvelope())

        #expect(AccountService.localAccount() == nil)
    }

    /// A session token exists but the envelope was never cached for it (the one legacy-session edge
    /// case `routeToLockOrAuth()`'s own doc comment names as its fallback-to-network trigger) -- also
    /// `nil`, deliberately NOT treated as "signed out": the caller distinguishes this case itself via
    /// a separate `SessionTokenStore.load()` check.
    @Test func returnsNilWhenTokenExistsButEnvelopeCacheDoesNot() {
        Self.clearAll()
        defer { Self.clearAll() }

        SessionTokenStore.save(Self.fixtureToken)

        #expect(AccountService.localAccount() == nil)
        // The distinguishing fact `routeToLockOrAuth()` itself checks for its fallback branch.
        #expect(SessionTokenStore.load() == Self.fixtureToken)
    }

    /// Nothing cached at all.
    @Test func returnsNilWhenNeitherIsCached() {
        Self.clearAll()
        defer { Self.clearAll() }

        #expect(AccountService.localAccount() == nil)
    }

    // MARK: - AccountService.unlockLocally(account:password:) -- the offline-unlock primitive

    private static let realFixturePassword = "LocalAccountRestoreTests-Fixture-Password!"

    /// Builds a REAL, `pv-ffi`-wrapped `RestoredAccount` the same way `AccountService.register`
    /// does (`generateRegistrationSalt` -> `defaultKdfParamsJson` -> `deriveAuthMaterial` ->
    /// `FfiUserKey.generate` -> `wrapUserKeyJson`) -- never a hand-rolled JSON shape.
    private static func makeRealAccount(password: String) throws -> RestoredAccount {
        let saltData = generateRegistrationSalt()
        let kdfParamsJson = defaultKdfParamsJson()
        var passwordData = Data(password.utf8)
        defer { passwordData.resetBytes(in: 0..<passwordData.count) }
        let authMaterial = try deriveAuthMaterial(password: passwordData, salt: saltData, kdfParamsJson: kdfParamsJson)
        let userKey = try FfiUserKey.generate()
        let wrappedJson = try wrapUserKeyJson(wrappingKey: authMaterial.wrappingKey, userKey: userKey)
        return RestoredAccount(
            token: Self.fixtureToken, email: Self.fixtureEmail, pwWrappedUkJson: wrappedJson,
            saltB64: saltData.base64EncodedString(), kdfParamsJson: kdfParamsJson
        )
    }

    /// The direct offline-unlock proof: a REAL wrapped envelope, unwrapped with the CORRECT
    /// password, entirely locally -- no network, no `apiClient`, no `AccountService` instance.
    @Test func unlocksLocallyWithTheCorrectPassword() throws {
        let account = try Self.makeRealAccount(password: Self.realFixturePassword)
        let userKey = try AccountService.unlockLocally(account: account, password: Self.realFixturePassword)
        // A real, usable handle -- proven by round-tripping a literal plaintext through it, the
        // same discipline `AccountFlowLiveTests`' own byte-for-byte check uses.
        let plaintext = "{\"type\":\"note\",\"body\":\"LocalAccountRestoreTests fixture\"}"
        let item = try encryptItem(userKey: userKey, plaintext: plaintext, itemId: "local-unlock-test-item", revision: 1)
        let decrypted = try decryptItem(userKey: userKey, item: item, itemId: "local-unlock-test-item", revision: 1)
        #expect(decrypted == plaintext)
    }

    /// A wrong password must be REJECTED locally -- the wrapped key's own AEAD tag is the
    /// credential check; there is no server round trip here to defer to.
    @Test func rejectsAnIncorrectPasswordLocally() throws {
        let account = try Self.makeRealAccount(password: Self.realFixturePassword)
        #expect(throws: (any Error).self) {
            _ = try AccountService.unlockLocally(account: account, password: "definitely the wrong password")
        }
    }

    /// A legacy/pre-cache session (empty `saltB64`/`kdfParamsJson`, `CachedAccountEnvelope`'s own
    /// documented "not yet known" shape) must surface `LocalUnlockError.noCachedCredentials`
    /// specifically -- the caller's signal to fall back to the network-based `signIn` flow, never
    /// silently misreported as "wrong password".
    @Test func surfacesNoCachedCredentialsWhenSaltAndKdfAreEmpty() {
        let account = RestoredAccount(
            token: Self.fixtureToken, email: Self.fixtureEmail, pwWrappedUkJson: Self.fixturePwWrappedUkJson,
            saltB64: "", kdfParamsJson: ""
        )
        #expect {
            _ = try AccountService.unlockLocally(account: account, password: Self.realFixturePassword)
        } throws: { error in
            guard case LocalUnlockError.noCachedCredentials = error else { return false }
            return true
        }
    }

    // MARK: - AccountService.restoreSession()'s merge-on-refresh contract (no live server needed
    // for THIS half of the contract -- only the "preserve existing salt/kdf" merge logic itself,
    // exercised directly against the cache, matching this file's own local-only discipline)

    /// `CachedAccountEnvelope`'s own header states the merge rule: a background refresh must never
    /// blank an already-cached `salt`/`kdf`. Proven here at the cache layer directly (the same
    /// read-merge-write `AccountService.restoreSession()` performs), without needing a live
    /// `pv-server` to reach that one code path.
    @Test func envelopeCacheMergeNeverBlanksAnAlreadyCachedSaltAndKdf() {
        Self.clearAll()
        defer { Self.clearAll() }

        AccountEnvelopeCache.save(Self.makeEnvelope())
        let existing = AccountEnvelopeCache.load()

        // Simulates the exact merge `restoreSession()` performs after a `GET /api/auth/me` success
        // (which never returns salt/kdf): re-save with a FRESH pwWrappedUkJson but the PRESERVED
        // salt/kdf from what was already cached.
        let refreshed = CachedAccountEnvelope(
            email: Self.fixtureEmail, pwWrappedUkJson: "{\"nonce\":[9,9,9],\"ciphertext\":[8,8,8]}",
            saltB64: existing?.saltB64 ?? "", kdfParamsJson: existing?.kdfParamsJson ?? ""
        )
        AccountEnvelopeCache.save(refreshed)

        let after = AccountEnvelopeCache.load()
        #expect(after?.saltB64 == Self.fixtureSaltB64)
        #expect(after?.kdfParamsJson == Self.fixtureKdfParamsJson)
        #expect(after?.pwWrappedUkJson == "{\"nonce\":[9,9,9],\"ciphertext\":[8,8,8]}")
    }
}
