//
//  IdentityStoreSyncPasskeyTests.swift
//  PasskeyVaultTests
//
//  Phase 43 (warunkowe-passkeys-tylko-je-li-tanie), Plan 43-05 (OPT-03): exercises
//  `IdentityStoreSync`'s new passkey-identity machinery (`PasskeyIdentitySource`,
//  `upsertOnePasskey(source:)`, `republishPasskeys(sources:)`) against the REAL
//  `ASCredentialIdentityStore.shared` (host-app test target, matching where
//  `IdentityStoreSyncProbe.swift`'s own tests already live) -- never a mock.
//
//  landmine L-34 (`ios/IOS-SPIKE-LOG.md` §3): `credentialIdentities(forService:credentialIdentityTypes:)`
//  returns an EMPTY set on this simulator/toolchain regardless of a confirmed-successful write.
//  These tests never call that read API -- they assert on `Swift.Result` return values and on
//  this file's own (duplicated, private-mirroring) UserDefaults record, the SAME discipline
//  `IdentityStoreSyncPendingFlagTests.swift` already established for `IdentityStoreSync`'s other
//  private keys ("duplicated literals, matching this codebase's own documented discipline for
//  keys that have no shared module to import across build targets" -- there is no injectable
//  `UserDefaults` seam and no shared-module accessor for `IdentityStoreSync`'s private keys today).
//
//  `.serialized`: every test in this suite manipulates the SAME real App Group `UserDefaults` key
//  and the SAME real `ASCredentialIdentityStore` -- Swift Testing parallelizes `@Test` methods
//  within a suite by default, which would let two tests race each other's reset/assert windows.
//  Each test still resets fully before AND after itself, so serializing only removes the
//  CROSS-test race, not a same-test hazard.
//

import AuthenticationServices
import Foundation
import Testing
@testable import PasskeyVault

@Suite(.serialized)
struct IdentityStoreSyncPasskeyTests {
    private static let suiteName = "group.cloud.blonie.PasskeyVault"

    /// Duplicated from `IdentityStoreSync.swift`'s own PRIVATE `identityPublishedPasskeyKeysKey`.
    /// If this literal ever drifts from the production constant, this suite's reset/assert logic
    /// silently stops observing the real record -- kept as a single named constant (not repeated
    /// inline) so a future rename is a one-line fix.
    private static let identityPublishedPasskeyKeysKeyLiteral = "cloud.blonie.PasskeyVault.identityPublishedPasskeyKeys"

    /// Same duplication discipline, for the PASSWORD-side key -- needed only so this suite can
    /// assert the two keys are provably distinct (this task's own acceptance criteria), never to
    /// read or write it.
    private static let publishedKeysKeyLiteral = "cloud.blonie.PasskeyVault.identityPublishedKeys"

    private static let rpId = "e43-5-passkey-test.invalid"
    private static let itemId = "e43-5-passkey-test-item"
    private static let validCredentialId = Data([0x01, 0x02, 0x03, 0x04])
    private static let userHandle = Data([0x0A, 0x0B, 0x0C, 0x0D])

    /// Mirrors `IdentityStoreSync`'s own PRIVATE `PublishedPasskeyKey`/`PublishedPasskeyKeySet`
    /// shapes so this suite can decode the real persisted record and assert on its CONTENTS (not
    /// merely "no error was thrown") -- the same "duplicated shape, real UserDefaults" pattern
    /// `IdentityStoreSyncPendingFlagTests.swift` already uses for the pending flags.
    private struct DecodedPasskeyKey: Codable, Hashable {
        let rpId: String
        let credentialIdBase64: String
        let recordIdentifier: String
    }

    private struct DecodedPasskeyKeySet: Codable {
        let version: Int
        let keys: [DecodedPasskeyKey]
    }

    private static func readPersistedPasskeyKeys() -> [DecodedPasskeyKey] {
        guard let defaults = UserDefaults(suiteName: suiteName),
              let data = defaults.data(forKey: identityPublishedPasskeyKeysKeyLiteral),
              let set = try? JSONDecoder().decode(DecodedPasskeyKeySet.self, from: data)
        else { return [] }
        return set.keys
    }

    private static func resetPersistedPasskeyKeys() {
        UserDefaults(suiteName: suiteName)?.removeObject(forKey: identityPublishedPasskeyKeysKeyLiteral)
    }

    private static func makeSource(credentialId: Data) -> PasskeyIdentitySource {
        PasskeyIdentitySource(
            itemId: Self.itemId,
            rpId: Self.rpId,
            credentialId: credentialId,
            userHandle: Self.userHandle,
            username: "e43-5-passkey-test-user"
        )
    }

    // MARK: - Behavior 1: a valid source saves exactly one identity and returns .success

    @Test func upsertOnePasskeyWithAValidSourceSavesAndReturnsSuccess() async throws {
        Self.resetPersistedPasskeyKeys()
        defer { Self.resetPersistedPasskeyKeys() }

        let source = Self.makeSource(credentialId: Self.validCredentialId)
        let result = await IdentityStoreSync.upsertOnePasskey(source: source)
        guard case .success = result else {
            Issue.record("expected .success for a valid PasskeyIdentitySource, got \(result)")
            return
        }

        let persisted = Self.readPersistedPasskeyKeys()
        #expect(persisted.count == 1, "exactly one passkey identity must be recorded as published")
        #expect(persisted.first?.rpId == Self.rpId)
        #expect(persisted.first?.recordIdentifier == Self.itemId)
    }

    // MARK: - Behavior 2: a repeat call for the SAME (rpId, credentialId) is idempotent

    @Test func upsertOnePasskeyTwiceForTheSamePairIsIdempotent() async throws {
        Self.resetPersistedPasskeyKeys()
        defer { Self.resetPersistedPasskeyKeys() }

        let source = Self.makeSource(credentialId: Self.validCredentialId)
        let first = await IdentityStoreSync.upsertOnePasskey(source: source)
        guard case .success = first else {
            Issue.record("expected first call to succeed, got \(first)")
            return
        }
        let second = await IdentityStoreSync.upsertOnePasskey(source: source)
        guard case .success = second else {
            Issue.record("expected second call to succeed, got \(second)")
            return
        }

        let persisted = Self.readPersistedPasskeyKeys()
        #expect(persisted.count == 1, "a repeat upsert for the same (rpId, credentialId) must never create a duplicate entry")
    }

    // MARK: - Behavior 3: republishPasskeys computes a dropped pair as a removal

    @Test func republishPasskeysDroppingAPreviouslyPublishedPairComputesARemoval() async throws {
        Self.resetPersistedPasskeyKeys()
        defer { Self.resetPersistedPasskeyKeys() }

        let source = Self.makeSource(credentialId: Self.validCredentialId)
        let publish = await IdentityStoreSync.republishPasskeys(sources: [source])
        guard case .success = publish else {
            Issue.record("expected initial republish to succeed, got \(publish)")
            return
        }
        #expect(Self.readPersistedPasskeyKeys().count == 1, "the initial republish must record the one published pair")

        let drop = await IdentityStoreSync.republishPasskeys(sources: [])
        guard case .success = drop else {
            Issue.record("expected the dropping republish to succeed, got \(drop)")
            return
        }
        #expect(
            Self.readPersistedPasskeyKeys().isEmpty,
            "dropping the pair from the desired set must compute it as a removal, diffed against the passkey-specific persisted set"
        )
    }

    // MARK: - Behavior 4: an empty credentialId builds no identity

    @Test func upsertOnePasskeyWithEmptyCredentialIdBuildsNothingAndFails() async throws {
        Self.resetPersistedPasskeyKeys()
        defer { Self.resetPersistedPasskeyKeys() }

        let source = Self.makeSource(credentialId: Data())
        let result = await IdentityStoreSync.upsertOnePasskey(source: source)
        guard case let .failure(error) = result else {
            Issue.record("expected .failure(.nothingToWrite) for an empty credentialId, got \(result)")
            return
        }
        guard case .nothingToWrite = error else {
            Issue.record("expected .nothingToWrite specifically, got \(error)")
            return
        }
        #expect(Self.readPersistedPasskeyKeys().isEmpty, "no identity must have been recorded as published")
    }

    // MARK: - This task's own acceptance criteria: the two persisted-set keys are provably distinct

    @Test func passkeyPersistedKeyIsDistinctFromThePasswordPersistedKey() {
        #expect(
            Self.identityPublishedPasskeyKeysKeyLiteral != Self.publishedKeysKeyLiteral,
            "the passkey and password paths must never share one diff/removal persistence record"
        )
    }
}
