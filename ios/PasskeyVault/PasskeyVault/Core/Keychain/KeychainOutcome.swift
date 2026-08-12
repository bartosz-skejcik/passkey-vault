//
//  KeychainOutcome.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. The three-bucket
//  OSStatus/LAError classifier ACC-03 (ios/IOS-SPIKE-LOG.md §1) specifies.
//  This is the ONLY place that maps a raw status code to meaning anywhere in
//  this app -- every caller reasons about `KeychainOutcome` cases, never a
//  numeric code directly, so a raw status can never leak into a user-visible
//  string (that grep guard lives in Core/I18n/I18nDictionaryTests.swift).
//

import Foundation
import LocalAuthentication
import Security

/// The outcome of one Keychain/`LAContext` operation against the User Key
/// envelope, collapsed into exactly the three buckets ACC-03 names plus the
/// two terminal cases (`ok`/`unexpected`). No caller anywhere in this app
/// branches on a raw `OSStatus`/`LAError` value -- only on this enum's cases.
enum KeychainOutcome: Equatable {
    /// `errSecSuccess` -- carries the retrieved secret bytes.
    case ok(Data)
    /// The user dismissed the system sheet or tapped "Enter Password".
    /// `{errSecUserCanceled(-128), LAError.userCancel(-2),
    /// LAError.userFallback(-3)}`. No alarm, no retry counter -- the UI
    /// silently reverts to its idle state.
    case benignCancel
    /// The envelope itself cannot be used and recovery is
    /// `SecItemDelete`-then-`SecItemAdd`.
    /// `{errSecAuthFailed(-25293), errSecItemNotFound(-25300),
    /// errSecNotAvailable(-25291), LAError.biometryNotEnrolled(-7)}`.
    ///
    /// These three `OSStatus` members are recorded in `ios/IOS-SPIKE-LOG.md`
    /// §1 ACC-03 as ONE equivalence class, not three distinguishable causes:
    /// Apple names no single status for "biometric set changed", third-party
    /// reports disagree on which of `errSecItemNotFound`/`errSecAuthFailed`
    /// fires on which OS version, and the reported value already changed
    /// once between iOS 14 and 15. Branching on which member appeared here
    /// would be building a feature on a fact the sources themselves say is
    /// unstable -- so no code anywhere in this app is permitted to
    /// distinguish them; the identifying `OSStatus` is deliberately not part
    /// of this case's associated value for that reason. (`biometryNotEnrolled`
    /// is grouped in the same bucket because it, too, means "nothing usable
    /// is available right now, and re-enrolling starts the same recovery
    /// path" -- not a status-value disagreement, a semantic one.)
    case envelopeUnusable(OSStatus)
    /// The device is locked / no UI can be presented right now -- report
    /// "locked", never "missing". `{errSecInteractionNotAllowed(-25308),
    /// errSecInteractionRequired(-25315), LAError.notInteractive(-1004)}`.
    case lockedNoUI(OSStatus)
    /// Anything not in one of the three documented buckets above. Must
    /// surface loudly -- never silently folded into `envelopeUnusable` or
    /// any other bucket, because an unrecognized status is exactly the case
    /// where guessing which bucket it "probably" belongs in would be wrong.
    case unexpected(OSStatus)
}

/// Pure classifier: one `OSStatus` in, one `KeychainOutcome` bucket out. No
/// I/O, no Keychain calls -- exhaustively testable against the documented
/// status table without touching the Keychain at all.
func classify(_ status: OSStatus) -> KeychainOutcome {
    switch status {
    case errSecSuccess:
        // Callers attach the actual data separately (`ok(Data)` is
        // constructed at the read call site, which has the bytes); this
        // classifier only distinguishes the status, so success alone maps
        // to an empty placeholder that callers immediately replace.
        return .ok(Data())

    case errSecUserCanceled,
         Int32(LAError.userCancel.rawValue),
         Int32(LAError.userFallback.rawValue):
        return .benignCancel

    case errSecAuthFailed,
         errSecItemNotFound,
         errSecNotAvailable,
         Int32(LAError.biometryNotEnrolled.rawValue):
        return .envelopeUnusable(status)

    case errSecInteractionNotAllowed,
         errSecInteractionRequired,
         Int32(LAError.notInteractive.rawValue):
        return .lockedNoUI(status)

    default:
        return .unexpected(status)
    }
}
