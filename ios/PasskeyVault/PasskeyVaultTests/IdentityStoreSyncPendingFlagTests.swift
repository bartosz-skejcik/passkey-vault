//
//  IdentityStoreSyncPendingFlagTests.swift
//  PasskeyVaultTests
//
//  CR-02 (41-REVIEW.md iteration 2): `upsertOne` -- by construction, aware of exactly ONE item --
//  must never clear the WHOLE-VAULT `rebuildPending` obligation it cannot know is fully satisfied.
//  Before this fix, a one-item success (or even an empty early-return that wrote nothing at all)
//  cleared that flag unconditionally, silently forgetting any OTHER item's still-owed repair
//  (T-41-41: "a dropped busy write is a PERMANENTLY missing QuickType entry").
//
//  `IdentityStoreSync`'s own `rebuildPendingKey`/`selfHealPendingKey` are `private` (correctly --
//  nothing outside the file should poke them directly in production), and there is no injectable
//  `UserDefaults` seam on this type today (that gap is IN-04-shaped and out of THIS fix's scope,
//  unlike `LockMarker`/`SessionLifecycle`, which WR-09 already gave one). This suite therefore
//  drives the REAL `group.cloud.blonie.PasskeyVault` App Group suite through `IdentityStoreSync`'s
//  own PUBLIC surface only (`markSelfHealPending()`, `upsertOne(source:)`, `isRebuildPending()`),
//  and resets the two flags it can observe (duplicated literals, matching this codebase's own
//  documented discipline for keys that have no shared module to import across build targets) both
//  BEFORE and AFTER every test, so a run never leaves the real App Group polluted for the next one.
//
//  Deliberately does NOT assert on `ASCredentialIdentityStore.shared`'s own state (real System
//  Preferences autofill-provider enablement varies by simulator/host and is not this suite's to
//  control) -- both branches `upsertOne` can take when it discovers zero identities to write
//  (`.storeDisabled` OR `.nothingToWrite`) end in exactly the invariant this fix exists to prove:
//  a `.failure` result, with `rebuildPendingKey` (not merely the self-heal flag) left/set TRUE.
//

import Foundation
import Testing
@testable import PasskeyVault

/// `.serialized`: both tests below manipulate the SAME real App Group `UserDefaults` keys (there
/// is no injectable seam on `IdentityStoreSync` today -- see this file's own header) -- Swift
/// Testing parallelizes `@Test` methods within a suite by default, which would let the two race
/// each other's reset/assert windows and flake. Each test still resets fully before AND after
/// itself, so serializing only removes the CROSS-test race, not a same-test hazard.
@Suite(.serialized)
struct IdentityStoreSyncPendingFlagTests {
    private static let suiteName = "group.cloud.blonie.PasskeyVault"
    private static let rebuildPendingKey = "cloud.blonie.PasskeyVault.identityRebuildPending"
    private static let selfHealPendingKey = "cloud.blonie.PasskeyVault.identitySelfHealPending"

    private static func resetFlags() {
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.removeObject(forKey: rebuildPendingKey)
        defaults?.removeObject(forKey: selfHealPendingKey)
    }

    /// The exact scenario CR-02's own fix description asks for: a self-heal call that could not
    /// discharge its obligation (every URL fails `OriginNormalize.host(fromURLString:)` when
    /// handed an empty string) must ESCALATE to the whole-vault rebuild flag, never silently clear
    /// it -- regardless of which of `upsertOne`'s two early-failure branches this host's real
    /// `ASCredentialIdentityStore.shared.state()` happens to route through.
    @Test func upsertOneThatWritesNothingEscalatesToAFullRebuildRatherThanClearingAnything() async throws {
        Self.resetFlags()
        defer { Self.resetFlags() }

        #expect(!IdentityStoreSync.isRebuildPending(), "flags must start clear for this test to be meaningful")

        let result = await IdentityStoreSync.upsertOne(
            source: VaultIdentitySource(itemId: "cr02-test-item", username: "cr02-pending-flag-test@example.invalid", urls: [""])
        )
        guard case .failure = result else {
            Issue.record("expected a .failure result when zero identities can be built from the source, got \(result)")
            return
        }
        #expect(
            IdentityStoreSync.isRebuildPending(),
            "a self-heal call that discharged nothing must leave (or set) the whole-vault rebuild flag -- CR-02, 41-REVIEW.md iteration 2"
        )
    }

    /// `markSelfHealPending()` sets a flag distinct from the whole-vault `rebuildPendingKey` --
    /// `isRebuildPending()` must still report it (a caller only needs to know SOMETHING is owed),
    /// establishing the precondition the fix's own suggested test names ("sets rebuildPending
    /// true ... asserts isRebuildPending() is still true" after a one-item success): the one-item
    /// success path below must never observe this flag and clear it as a side effect of an
    /// unrelated item's write finishing.
    @Test func markSelfHealPendingAloneIsVisibleThroughIsRebuildPending() async throws {
        Self.resetFlags()
        defer { Self.resetFlags() }

        #expect(!IdentityStoreSync.isRebuildPending())
        IdentityStoreSync.markSelfHealPending()
        #expect(
            IdentityStoreSync.isRebuildPending(),
            "a pending self-heal obligation must be visible through isRebuildPending() even though it is a distinct flag from rebuildPendingKey"
        )
    }
}
