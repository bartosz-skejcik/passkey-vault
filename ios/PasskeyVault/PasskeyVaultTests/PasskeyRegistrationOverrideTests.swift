//
//  PasskeyRegistrationOverrideTests.swift
//  PasskeyVaultTests
//
//  Phase 43 (warunkowe-passkeys-tylko-je-li-tanie), Plan 43-07 (OPT-03): exercises the two
//  `<behavior>` refusal cases the registration override (`CredentialProviderViewController
//  .prepareInterfaceForPasskeyRegistration`) must guarantee, via `PasskeyRegistrationPreflight`
//  (`Shared/PasskeyRegistrationPreflight.swift`) -- the PURE decision function that override's own
//  body calls before presenting any UI or touching `PvFfi.providerMakeCredential`.
//
//  Why THIS file, not `CredentialProviderViewController.swift` directly (43-PLAN-CHECK.md C5):
//  that file compiles only into the `PasskeyVaultAutoFill` extension target
//  (`fileSystemSynchronizedGroups` in the pbxproj), which this test target's `@testable import
//  PasskeyVault` -- the HOST app module -- cannot see; `ASCredentialProviderViewController` also
//  has no usable `extensionContext` outside a real, live extension host, so driving the override
//  itself from a plain XCTest/Swift-Testing target is not possible here. The decision logic was
//  therefore factored into `Shared/`, testable the same way `IdentityStoreSyncPasskeyTests.swift`
//  already tests `IdentityStoreSync`'s passkey machinery -- against a REAL `ASPasskeyCredentialRequest`
//  fixture, never a mock.
//
//  Also covers the carry-forward obligation 43-05-SUMMARY.md left for this plan: on a device where
//  `ASCredentialIdentityStore.shared.state().supportsIncrementalUpdates` is `false`,
//  `IdentityStoreSync.republish(sources:)` and `.republishPasskeys(sources:)` EACH fall back to a
//  store-wide `replaceCredentialIdentities`, so calling them independently would erase each other's
//  identities. `IdentityStoreSync.combinedRebuildIdentities(passwordSources:passkeySources:)` is the
//  PURE fix this plan adds, tested directly below -- this simulator/toolchain always reports
//  `supportsIncrementalUpdates == true` (43-05-SUMMARY.md's own finding), so the live collision
//  itself cannot be exercised end-to-end here; this test proves the FIX exists and is correct
//  without needing to control that read-only system property.
//

import AuthenticationServices
import Foundation
import Testing
@testable import PasskeyVault

@Suite(.serialized)
struct PasskeyRegistrationOverrideTests {
    private static let rpId = "e43-7-passkey-reg-test.invalid"

    private static func makeRequest(supportedAlgorithms: [ASCOSEAlgorithmIdentifier]) -> ASPasskeyCredentialRequest {
        let identity = ASPasskeyCredentialIdentity(
            relyingPartyIdentifier: Self.rpId,
            userName: "e43-7-user",
            credentialID: Data([0x01, 0x02, 0x03]),
            userHandle: Data([0x0A, 0x0B]),
            recordIdentifier: "e43-7-item"
        )
        return ASPasskeyCredentialRequest(
            credentialIdentity: identity,
            clientDataHash: Data([0xAA, 0xBB, 0xCC]),
            userVerificationPreference: .preferred,
            supportedAlgorithms: supportedAlgorithms
        )
    }

    // MARK: - Behavior 1 (43-07-PLAN.md <behavior>): supportedAlgorithms excluding ES256/-7 is
    // refused BEFORE the confirmation screen -- never a UI the user confirms into a guaranteed
    // Rust-side failure.

    @Test func aRequestWithoutES256IsRefusedRegardlessOfLockState() {
        // EdDSA (-8) only -- a real RP that never offers ES256, per A1 (43-RESEARCH.md's own
        // Assumptions Log): must fail cleanly, not silently substitute an algorithm.
        let request = Self.makeRequest(supportedAlgorithms: [ASCOSEAlgorithmIdentifier(rawValue: -8)])

        let whenUnlocked = PasskeyRegistrationPreflight.decide(
            supportedAlgorithms: request.supportedAlgorithms, isUnlocked: true
        )
        #expect(whenUnlocked == .refuseUnsupportedAlgorithm, "an ES256-less request must be refused even when the vault is unlocked")

        let whenLocked = PasskeyRegistrationPreflight.decide(
            supportedAlgorithms: request.supportedAlgorithms, isUnlocked: false
        )
        #expect(whenLocked == .refuseUnsupportedAlgorithm, "the algorithm check must be the FIRST refusal reason, checked independently of lock state")
    }

    // MARK: - Behavior 2 (43-07-PLAN.md <behavior>, T-43-12): a LOCKED vault never reaches
    // `PvFfi.providerMakeCredential` -- SECURITY: no confirmation screen for an unlocked vault's
    // contents is ever presented to a locked-device attacker.

    @Test func aLockedVaultWithAValidAlgorithmIsRefusedBeforeTheCeremony() {
        let request = Self.makeRequest(supportedAlgorithms: [ASCOSEAlgorithmIdentifier(rawValue: -7)])

        let decision = PasskeyRegistrationPreflight.decide(
            supportedAlgorithms: request.supportedAlgorithms, isUnlocked: false
        )
        #expect(decision == .refuseLocked, "a locked vault must be refused even for an otherwise-valid ES256 request")
        // `CredentialProviderViewController.prepareInterfaceForPasskeyRegistration(for:)`'s own
        // `switch preflight` returns immediately (`extensionContext.cancelRequest`) on
        // `.refuseLocked`, BEFORE `presentRegistrationConfirm`/`providerMakeCredential` are ever
        // reached -- this decision value is exactly what gates that early return; a `.proceed` here
        // is the only value under which the override continues.
        #expect(decision != .proceed)
    }

    @Test func anUnlockedVaultWithAValidAlgorithmProceeds() {
        let request = Self.makeRequest(supportedAlgorithms: [ASCOSEAlgorithmIdentifier(rawValue: -7)])

        let decision = PasskeyRegistrationPreflight.decide(
            supportedAlgorithms: request.supportedAlgorithms, isUnlocked: true
        )
        #expect(decision == .proceed, "an unlocked vault with ES256 present must be allowed to proceed to the confirmation screen")
    }

    // MARK: - Behavior 3: multiple supported algorithms, ES256 present among others -- proceeds
    // (never refuses merely because OTHER algorithms are also offered).

    @Test func multipleAlgorithmsIncludingES256Proceeds() {
        let request = Self.makeRequest(
            supportedAlgorithms: [ASCOSEAlgorithmIdentifier(rawValue: -257), ASCOSEAlgorithmIdentifier(rawValue: -7)]
        )
        let decision = PasskeyRegistrationPreflight.decide(
            supportedAlgorithms: request.supportedAlgorithms, isUnlocked: true
        )
        #expect(decision == .proceed)
    }

    // MARK: - Carry-forward obligation (43-05-SUMMARY.md): the combined full-vault rebuild fix.

    @Test func combinedRebuildIdentitiesIncludesBothPasswordAndPasskeyEntries() {
        let passwordSource = VaultIdentitySource(itemId: "e43-7-pw-item", username: "alice", urls: ["https://example.invalid"])
        let passkeySource = PasskeyIdentitySource(
            itemId: "e43-7-pk-item", rpId: Self.rpId, credentialId: Data([1, 2, 3]),
            userHandle: Data([4, 5]), username: "alice"
        )

        let combined = IdentityStoreSync.combinedRebuildIdentities(
            passwordSources: [passwordSource], passkeySources: [passkeySource]
        )

        // FAILS WITHOUT THE FIX: before `republishRebuild`/`combinedRebuildIdentities` existed, the
        // full-rebuild recovery path handed ONLY password sources to `republish(sources:)` --
        // passkey identities were never part of any combined full-replacement write at all, so this
        // count would be 1 (password only), never 2.
        #expect(combined.count == 2, "the combined full-replacement write must carry BOTH the password AND the passkey identity, never just one")
        let hasPassword = combined.contains { $0 is ASPasswordCredentialIdentity }
        let hasPasskey = combined.contains { $0 is ASPasskeyCredentialIdentity }
        #expect(hasPassword, "the combined array must include the password-side identity")
        #expect(hasPasskey, "the combined array must include the passkey-side identity")
    }

    @Test func combinedRebuildIdentitiesWithOnlyPasskeySourcesNeverDropsToEmpty() {
        let passkeySource = PasskeyIdentitySource(
            itemId: "e43-7-pk-only-item", rpId: Self.rpId, credentialId: Data([9, 9, 9]),
            userHandle: Data([1]), username: nil
        )
        let combined = IdentityStoreSync.combinedRebuildIdentities(passwordSources: [], passkeySources: [passkeySource])
        #expect(combined.count == 1)
        #expect(combined.first is ASPasskeyCredentialIdentity)
    }
}
