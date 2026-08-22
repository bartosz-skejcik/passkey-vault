//
//  SavePasswordPreflight.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Plan 44-04 (SAVE-01), Task 1. The testable preflight decision for an `ASSavePasswordRequest` --
//  mirrors `PasskeyRegistrationPreflight.swift`'s own established shape EXACTLY, for the SAME
//  reason that file's own header documents: `CredentialProviderViewController.swift` compiles only
//  into the `PasskeyVaultAutoFill` extension target, which `PasskeyVaultTests`' `@testable import
//  PasskeyVault` (the HOST app module) has NO access to (confirmed from the pbxproj's own
//  `fileSystemSynchronizedGroups`, the same limitation `PasskeyRegistrationPreflight.swift`'s
//  header already cites) -- so the decision logic itself is pulled out into `Shared/`, a pure
//  function with no `SessionLifecycle`/Keychain access of its own, so a unit test can drive it with
//  a plain `Bool` for both lock states without touching a real session.
//
//  Deliberately narrower than `PasskeyRegistrationPreflight`: the save path has no algorithm
//  negotiation to refuse (there is no COSE algorithm concept for a plain password credential), so
//  this enum carries only the two cases the save override's own `<behavior>` (44-04-PLAN.md Task 1)
//  requires.
//

import Foundation

/// The outcome of pre-flighting a save-password request, BEFORE any confirmation UI is ever shown
/// -- `<behavior>` (44-04-PLAN.md Task 1):
///   - `isUnlocked == false` -> `.refuseLocked` (T-43-12's rule, applied identically here: no
///     confirmation screen for an unlocked vault's contents is ever shown to a locked-device
///     attacker).
///   - `isUnlocked == true` -> `.proceed`.
enum SavePasswordPreflight: Equatable {
    case refuseLocked
    case proceed

    /// `isUnlocked` is the caller's own `SessionLifecycle.checkAndExpireIfNeeded(...) == .unlocked`
    /// result, passed in rather than re-derived here -- this type stays a PURE decision function,
    /// with no `SessionLifecycle`/Keychain access of its own, mirroring
    /// `PasskeyRegistrationPreflight.decide(...)`'s own established shape.
    static func decide(isUnlocked: Bool) -> SavePasswordPreflight {
        guard isUnlocked else {
            return .refuseLocked
        }
        return .proceed
    }
}
