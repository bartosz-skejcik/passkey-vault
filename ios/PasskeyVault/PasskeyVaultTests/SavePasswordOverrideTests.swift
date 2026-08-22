//
//  SavePasswordOverrideTests.swift
//  PasskeyVaultTests
//
//  Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-04 (SAVE-01): exercises the two `<behavior>`
//  refusal/proceed cases the save override (`CredentialProviderViewController.prepareInterface(for:
//  ASSavePasswordRequest)` / `.performWithoutUserInteractionIfPossible(savePasswordRequest:)`) must
//  guarantee, via `SavePasswordPreflight` (`Shared/SavePasswordPreflight.swift`) -- the PURE
//  decision function those overrides call before presenting any UI or touching the save pipeline.
//
//  Why THIS file, not `CredentialProviderViewController.swift` directly (mirrors
//  `PasskeyRegistrationOverrideTests.swift`'s own established rationale, 43-PLAN-CHECK.md C5):
//  that file compiles only into the `PasskeyVaultAutoFill` extension target
//  (`fileSystemSynchronizedGroups` in the pbxproj), which this test target's `@testable import
//  PasskeyVault` -- the HOST app module -- cannot see. The decision logic was therefore factored
//  into `Shared/`, testable against a plain `Bool` for both lock states, with no live extension
//  context required.
//
//  RED-then-GREEN record (44-04-PLAN.md Task 1 `<action>`): this file was written FIRST, against
//  the not-yet-created `SavePasswordPreflight` type -- `xcodebuild test
//  -only-testing:PasskeyVaultTests/SavePasswordOverrideTests` at that point fails to COMPILE (a
//  missing type, not merely a failing assertion), confirming this test genuinely exercises a type
//  that does not yet exist. `Shared/SavePasswordPreflight.swift` was then created and the same
//  invocation reports GREEN. Both states are recorded in `44-04-SUMMARY.md`.
//
//  WR-08 (44-REVIEW.md): the two tests below exercise `SavePasswordPreflight.decide(isUnlocked:)`
//  ONLY -- a two-case identity mapping that is the function restated. They CANNOT fail if
//  `prepareInterface(for: ASSavePasswordRequest)` stopped calling `decide` at all, or called it
//  AFTER presenting `SavePasswordConfirmView`/reading the session key, which is the actual T-43-12
//  security claim (coverage entry D1, 44-04-SUMMARY.md). That claim's real evidence is
//  `scripts/audit-ios-save-preflight-ordering.sh`, a structural gate over the real override source
//  (same family as `audit-ios-identity-store-chokepoint.sh`) asserting
//  `SessionLifecycle.checkAndExpireIfNeeded(` both exists in the override's body and runs before
//  any `present*(`/`SessionKeyReader.importUserKey(` call -- falsified both directions
//  (`ios/evidence/44/44-fix-wr08-falsification.log`). This file's own two tests remain useful for
//  what they actually prove: the PURE decision function's own two cases.
//

import Foundation
import Testing
@testable import PasskeyVault

@Suite(.serialized)
struct SavePasswordOverrideTests {
    // MARK: - Behavior 1 (44-04-PLAN.md <behavior>, T-43-12): a LOCKED vault never yields
    // `.proceed` -- SECURITY: no confirmation screen for an unlocked vault's contents is ever
    // presented to a locked-device attacker.

    @Test func aLockedVaultNeverProceeds() {
        let decision = SavePasswordPreflight.decide(isUnlocked: false)
        #expect(decision == .refuseLocked, "a locked vault must always refuse a save-password request")
        #expect(decision != .proceed)
    }

    // MARK: - Behavior 2: an unlocked vault always proceeds -- this preflight carries no OTHER
    // refusal reason (unlike `PasskeyRegistrationPreflight`, there is no algorithm negotiation for
    // a plain password credential).

    @Test func anUnlockedVaultAlwaysProceeds() {
        let decision = SavePasswordPreflight.decide(isUnlocked: true)
        #expect(decision == .proceed, "an unlocked vault must always be allowed to proceed with a save-password request")
    }
}
