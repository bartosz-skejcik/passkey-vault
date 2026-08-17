//
//  BiometricUnlockService.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. Composes
//  `UkEnvelopeStore` + `pv-ffi` into the actual product behaviour: enrol a
//  freshly password-unlocked User Key into the biometric envelope, and
//  later attempt a biometric unlock, resolving into exactly the outcomes
//  `LockView` renders. No `LocalAuthentication` code existed anywhere in
//  this repo before this file (`37-PATTERNS.md`) -- built from Apple's
//  documented `LAContext`/`SecItem` contract and ACC-03's recorded taxonomy,
//  not copied from an analog.
//
//  Every `LAContext` created here is local to its function and
//  `invalidate()`d in a `defer` -- never held as a stored property.
//

import Foundation
import LocalAuthentication

/// The result of one `unlockWithBiometrics()` attempt -- exactly the cases
/// `LockView`'s biometric status slot needs to render, per
/// `37-UI-SPEC.md`'s state matrix. `envelopeInvalidated`/`biometryLockedOut`/
/// `biometryDenied` are the three DISTINCT error messages; `benignCancel`
/// renders nothing at all.
enum BiometricUnlockOutcome {
    /// A real, usable `FfiUserKey`, imported from the bytes the ACL-gated
    /// read returned.
    case unlocked(FfiUserKey)
    /// `KeychainOutcome.envelopeUnusable` -- the ACC-03 equivalence class
    /// (biometric set changed, or nothing usable is enrolled).
    /// `UkEnvelopeStore.delete()` has ALREADY been called by the time this
    /// case is returned, so the caller never re-deletes.
    case envelopeInvalidated
    /// `LAError.biometryLockout` (-8) -- too many failed attempts; the
    /// SENSOR itself is locked (an OS-level lock, unrelated to the
    /// envelope). Distinct from `envelopeInvalidated`: this needs the
    /// device passcode to re-arm, not necessarily a new password unlock.
    case biometryLockedOut
    /// `LAError.biometryNotAvailable` (-6) after the user declined (or
    /// later revoked) this app's Face ID/Touch ID consent.
    case biometryDenied
    /// `KeychainOutcome.lockedNoUI` -- report "locked", never "missing".
    case locked
    /// User dismissed the system sheet or tapped "Enter Password". No
    /// banner, no toast, no retry counter -- `LockView` reverts silently to
    /// its idle state.
    case benignCancel
    /// Anything not in one of the documented cases above. Must surface
    /// loudly -- never silently folded into another case.
    case unexpected(OSStatus)
}

/// Pre-flight biometry facts for `LockView`'s idle state: whether the
/// device can attempt biometric auth at all, the human-readable method name
/// for `unlock.biometricCta`'s `{method}` placeholder, and the UX-hint-only
/// enrollment state hash.
struct BiometryAvailability {
    let isAvailable: Bool
    /// `"Face ID"` / `"Touch ID"` / `"Optic ID"` -- Apple's own trademarked
    /// terms, never translated (`Core/I18n/Dictionary.swift`'s own rule).
    let methodName: String
    /// **UX pre-flight hint ONLY** (`37-RESEARCH.md` Pitfall 5): `nil` when
    /// nothing is enrolled, and can change between major iOS versions on
    /// its own. The AUTHORITY on whether the envelope is usable is the
    /// `OSStatus` from `UkEnvelopeStore.read`/`probe`, never this hash --
    /// MUST NOT trigger a destructive `delete()` on its own.
    let biometryStateHash: Data?
    /// `true` only when `canEvaluatePolicy` failed with `LAError.passcodeNotSet`.
    ///
    /// This distinguishes lock state 7 ("Face ID needs a device passcode") from
    /// state 3 ("Face ID isn't available on this device"), which the approved
    /// screens render with DIFFERENT copy in the same muted slot. Without it
    /// both collapsed into one message, and the passcode case is the one worth
    /// separating: it is actionable, and it is the surfaced form of the
    /// write-time refusal ACC-03 chose
    /// `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` specifically to
    /// produce, rather than a class that silently degrades to always-available.
    ///
    /// Defaults to `false` so every existing construction site is unaffected.
    var requiresDevicePasscode: Bool = false
}

extension BiometricUnlockOutcome {
    /// The `PVKey` this outcome's biometric status slot renders -- `nil`
    /// for `.unlocked` (the slot disappears entirely on success),
    /// `.benignCancel` (renders nothing, by design), `.locked` (reports
    /// "locked" via the idle retry button remaining, not a persistent
    /// message), and `.unexpected` (surfaced through logging/diagnostics,
    /// never through a canned copy key that would imply a documented,
    /// expected cause). A positive, receiver-side mapping -- tested
    /// directly in `KeychainEnvelopeTests.swift`.
    var copyKey: PVKey? {
        switch self {
        case .unlocked, .benignCancel, .locked, .unexpected:
            return nil
        case .envelopeInvalidated:
            return .unlockEnvelopeInvalidated
        case .biometryLockedOut:
            return .unlockBiometryLockedOut
        case .biometryDenied:
            return .unlockBiometryDenied
        }
    }
}

enum BiometricUnlockService {

    /// After a successful password unlock: export the session bytes and
    /// hand them to `UkEnvelopeStore.store`, wiping the Swift buffer
    /// immediately after (CP-4 -- UniFFI cannot wipe it for us).
    static func enrol(userKey: FfiUserKey) throws {
        var bytes = exportUserKeyForSession(userKey: userKey)
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        try UkEnvelopeStore.store(bytes)
    }

    /// Extracts the raw bytes from an `.ok` `KeychainOutcome`, hands them to
    /// `use`, then wipes them -- `defer`-guarded so the wipe runs even if
    /// `use` throws. Returns `nil` if `outcome` was not `.ok` (never true at
    /// this file's one call site, which only invokes this from inside a
    /// `case .ok` match).
    ///
    /// `outcome` is `inout` and is reassigned to `.benignCancel` BEFORE the
    /// wipe runs -- this is not incidental cleanup, it IS the fix for CR-01.
    /// `Data` is copy-on-write: the local `bytes` bound by
    /// `case var .ok(bytes) = outcome` shares storage with `outcome`'s own
    /// `.ok(...)` payload. If `outcome` (the caller's variable, which
    /// outlives this function's `defer`) kept referencing that SAME
    /// storage while `bytes.resetBytes(...)` ran, the mutation would not be
    /// unique-referenced, so `resetBytes` would trigger a COW copy-out: it
    /// allocates a fresh buffer, zeroes THAT buffer, and leaves `outcome`'s
    /// original buffer -- the one holding the actual plaintext User Key --
    /// completely untouched. (`BiometricCoWWipeTests.swift` proves this
    /// exact trap in isolation, and proves this function avoids it, since a
    /// zeroed LOCAL copy alone -- e.g. asserting `bytes == allZero` -- can
    /// never distinguish an in-place wipe from a wiped COW copy: `bytes`
    /// itself always reads back as zero either way. The only way to tell
    /// the difference is to check that no OTHER live reference to the
    /// original storage survives, which is exactly what reassigning
    /// `outcome` before the wipe guarantees.)
    ///
    /// Not `private` so `BiometricCoWWipeTests` can exercise this exact
    /// bytes-lifetime handling directly, without a real Keychain round trip.
    static func consumeOkBytes<T>(
        _ outcome: inout KeychainOutcome,
        use: (Data) throws -> T
    ) rethrows -> T? {
        guard case var .ok(bytes) = outcome else { return nil }
        outcome = .benignCancel
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        return try use(bytes)
    }

    /// `UkEnvelopeStore.read(reason:)`, then resolved into exactly the
    /// outcomes `LockView` renders. On `.envelopeUnusable`, the envelope is
    /// deleted here (recovery is `SecItemDelete`-then-`SecItemAdd`, and the
    /// delete half happens as soon as the envelope is known unusable, not
    /// deferred to the next enrol). `.unexpected` is inspected once more for
    /// the two LAError codes ACC-03's three Keychain buckets do not cover
    /// (`biometryLockout`/`biometryNotAvailable` are LAContext-level
    /// evaluation failures, not Keychain-item-state codes, so they are
    /// resolved here, one level above `classify(_:)`, never by changing that
    /// function's own three-bucket contract).
    static func unlockWithBiometrics(reason: String) async -> BiometricUnlockOutcome {
        var outcome: KeychainOutcome
        do {
            outcome = try await UkEnvelopeStore.read(reason: reason)
        } catch {
            return .unexpected(errSecParam)
        }

        switch outcome {
        case .ok:
            do {
                let result = try consumeOkBytes(&outcome) { bytes in
                    try importUserKeyFromSession(bytes: bytes)
                }
                guard let userKey = result else {
                    // Unreachable: this branch only runs when `outcome` just
                    // matched `.ok` above, so `consumeOkBytes` always finds
                    // its guard satisfied. Kept as a real, surfaced case
                    // (not `fatalError`) so a future refactor that breaks
                    // this invariant fails loudly instead of crashing.
                    return .unexpected(errSecParam)
                }
                return .unlocked(userKey)
            } catch {
                return .unexpected(errSecParam)
            }

        case .envelopeUnusable:
            UkEnvelopeStore.delete()
            return .envelopeInvalidated

        case .benignCancel:
            return .benignCancel

        case .lockedNoUI:
            return .locked

        case let .unexpected(status):
            if status == OSStatus(LAError.biometryLockout.rawValue) {
                return .biometryLockedOut
            }
            if status == OSStatus(LAError.biometryNotAvailable.rawValue) {
                return .biometryDenied
            }
            return .unexpected(status)
        }
    }

    /// `LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics:)`
    /// for the pre-flight, plus `biometryType` for the CTA's `{method}` copy
    /// and `domainState.biometry.stateHash` (iOS 18.0+; its predecessor
    /// `evaluatedPolicyDomainState` is deprecated exactly at our deployment
    /// floor) as a UX hint only.
    static func biometryAvailability() -> BiometryAvailability {
        let context = LAContext()
        defer { context.invalidate() }

        var evaluationError: NSError?
        let isAvailable = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &evaluationError
        )

        let methodName: String
        switch context.biometryType {
        case .faceID:
            methodName = "Face ID"
        case .touchID:
            methodName = "Touch ID"
        case .opticID:
            methodName = "Optic ID"
        default:
            methodName = "Face ID"
        }

        let stateHash: Data?
        if #available(iOS 18.0, *) {
            stateHash = context.domainState.biometry.stateHash
        } else {
            stateHash = nil
        }

        // `LAError.passcodeNotSet` is the only code that means "set a passcode
        // and this starts working"; every other failure is state 3's generic
        // unavailability. Read from the real NSError, never inferred.
        let requiresPasscode = !isAvailable
            && evaluationError?.domain == LAErrorDomain
            && evaluationError?.code == LAError.passcodeNotSet.rawValue

        return BiometryAvailability(
            isAvailable: isAvailable,
            methodName: methodName,
            biometryStateHash: stateHash,
            requiresDevicePasscode: requiresPasscode
        )
    }
}
