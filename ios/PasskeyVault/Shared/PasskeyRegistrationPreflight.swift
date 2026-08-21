//
//  PasskeyRegistrationPreflight.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Plan 43-07 (OPT-03), Task 1. The testable preflight decision for a passkey REGISTRATION
//  request -- pulled OUT of `CredentialProviderViewController.swift` (extension-target-only, and
//  the file `PasskeyVaultTests` has NO access to: that target's own `fileSystemSynchronizedGroups`
//  lists only its own folder, never `PasskeyVaultAutoFill`/`0B428FE9E49C0BB22AF61E01`, so
//  `@testable import PasskeyVault` -- the mechanism `IdentityStoreSyncPasskeyTests.swift`/
//  `PendingProviderItemStoreTests.swift` already use for every OTHER `Shared/` type -- would
//  never see a type declared only in the extension folder) into this file, so
//  `PasskeyRegistrationOverrideTests` (43-PLAN-CHECK.md C5) can exercise both `<behavior>` refusal
//  cases against a REAL `ASPasskeyCredentialRequest` fixture, with no live extension context.
//
//  One narrower than `CredentialMatcher.swift`'s own "deliberately AuthenticationServices-free"
//  precedent (DR-41-B): this file DOES import AuthenticationServices, because ES256 negotiation
//  genuinely needs `ASCOSEAlgorithmIdentifier` (COSE algorithm ids) -- an OS-defined vocabulary a
//  plain `[Int]` would only approximate. `IdentityStoreSync.swift` already sets the precedent that
//  a `Shared/` file may import `AuthenticationServices` and still be testable via `@testable import
//  PasskeyVault` (its own passkey-identity tests already do this).
//

import AuthenticationServices
import Foundation

/// The outcome of pre-flighting a passkey registration request, BEFORE the confirmation screen is
/// ever shown -- `<behavior>` (43-07-PLAN.md):
///   - A request whose `supportedAlgorithms` excludes ES256/-7 is refused before any UI (mirrors
///     `make_credential_ctap2`'s own Rust-side check, `crates/pv-provider/src/ceremony.rs` -- never a
///     UI the user confirms into a guaranteed failure).
///   - A LOCKED vault never reaches the confirmation screen at all (T-43-12: no confirmation screen
///     for an unlocked vault's contents is ever shown to a locked-device attacker) -- this mirrors
///     `fillOrCancel`'s own unlock-gating sequence, run BEFORE presenting any UI. Unlike the password
///     fill path, this extension draws no separate lock/biometric-prompt surface of its own to fall
///     back to (`fillOrCancel` has none either -- it simply cancels with `.userInteractionRequired`
///     and lets the system/host handle re-authentication); registration does the same rather than
///     inventing a THIRD unlock UI (43-07-PLAN.md's own `<read_first>` note).
enum PasskeyRegistrationPreflight: Equatable {
    case refuseUnsupportedAlgorithm
    case refuseLocked
    case proceed

    /// ES256 == -7 (COSE Algorithms registry, `ASCOSEConstants.h`'s own
    /// `ASCOSEAlgorithmIdentifierES256`), the ONLY algorithm `pv-provider`'s authenticator issues.
    private static let es256CoseAlg = -7

    /// `isUnlocked` is the caller's own `SessionLifecycle.checkAndExpireIfNeeded(...) == .unlocked`
    /// result, passed in rather than re-derived here -- this type stays a PURE decision function,
    /// with no `SessionLifecycle`/Keychain access of its own, so a unit test can drive it with a
    /// plain `Bool` for both lock states without touching a real session.
    static func decide(supportedAlgorithms: [ASCOSEAlgorithmIdentifier], isUnlocked: Bool) -> PasskeyRegistrationPreflight {
        guard supportedAlgorithms.contains(where: { $0.rawValue == es256CoseAlg }) else {
            return .refuseUnsupportedAlgorithm
        }
        guard isUnlocked else {
            return .refuseLocked
        }
        return .proceed
    }
}
