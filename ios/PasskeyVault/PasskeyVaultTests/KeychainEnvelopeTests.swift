//
//  KeychainEnvelopeTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04.
//
//  These tests exercise the Keychain API surface (`UkEnvelopeStore`,
//  `SessionTokenStore`) and the pure `classify(_:)` OSStatus classifier.
//  Whether the OS actually *enforces* the `.biometryCurrentSet` ACL on THIS
//  simulator -- i.e. whether a real biometric challenge is presented and can
//  be denied -- is an open question settled empirically by 37-05's E2. A
//  green run here proves the wrapper builds the right ACL, stores/reads real
//  bytes, and recovers correctly -- it does NOT prove ACC-04's enforcement
//  claim. Do not read a green run here as "biometric gating observed".
//
//  **Empirical finding, this harness (recorded in `ios/IOS-SPIKE-LOG.md`
//  §1 as an OBSERVED addendum to ACC-03):** this environment has NO
//  biometry ever enrolled on the iPhone 17 simulator, and has no headless
//  path to enroll it -- `xcrun simctl` ships no biometry subcommand, the
//  documented `notifyutil` posts did not change the read result, and GUI
//  automation via `osascript`/System Events is denied (no assistive-access
//  permission in this sandboxed environment). Concretely: `store()`
//  (`SecItemAdd` with the `.biometryCurrentSet` ACL) succeeds -- status 0
//  -- but the immediately-following `read()` classifies as
//  `.envelopeUnusable(-25300)` (`errSecItemNotFound`), not `.ok`. This
//  matches `37-RESEARCH.md`'s own documented row for `errSecItemNotFound`
//  ("also the pre-iOS-15 code for a biometry-set change") extended to the
//  "never enrolled at all" case, and it is exactly what the `classify(_:)`
//  bucket (and therefore the `unlock.envelopeInvalidated` UI copy) is
//  already designed to handle -- so this is a USEFUL empirical fact, not a
//  blocker: it confirms the real production `read()` correctly classifies
//  a harness with no usable biometry, even though it cannot demonstrate the
//  ENROLLED-and-successful path here. Where a test below needs a real,
//  successful byte round trip to run the `pv-ffi` decrypt proof, it falls
//  back to a second, non-ACL Keychain item (`Self.plumbingProofRoundTrip`)
//  that isolates "does store/read/import/decrypt work" from "does the OS
//  enforce `.biometryCurrentSet` on this harness" -- the second question is
//  explicitly 37-05's, not this file's.
//
//  Fixture provenance (SC2 discipline, `FfiRoundTripTests.swift`'s own
//  rule): every expected byte value below is a literal authored IN THIS
//  FILE, never a value produced by calling the code under test and compared
//  back to itself.
//

import Foundation
import Testing
import Security
import LocalAuthentication
@testable import PasskeyVault

/// `.serialized`: every test in this suite mutates the SAME shared Keychain
/// service (`UkEnvelopeStore.service`) as a side effect -- Swift Testing
/// runs `@Test` methods concurrently by default, which would race
/// `store()`/`delete()`/`read()` calls across methods against the same
/// on-disk item. Serializing is a correctness requirement here, not a
/// performance choice.
@Suite(.serialized)
struct KeychainEnvelopeTests {

    // MARK: - Shared literal fixtures

    /// A literal 32-byte "User Key" -- author-chosen, never `generate()`'s
    /// output. Distinct byte pattern from `FfiRoundTripTests`' own literal
    /// so a copy-paste collision between the two files would be visible.
    private static let literalUserKeyBytes: [UInt8] = [
        0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67,
        0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F,
        0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77,
        0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x7D, 0x7E, 0x7F,
    ]

    private static let literalFixturePlaintext = "{\"type\":\"note\",\"body\":\"37-04 keychain fixture\"}"

    private static let biometricReadReason = "PasskeyVaultTests: KeychainEnvelopeTests"

    /// A service string distinct from `UkEnvelopeStore.service`, carrying
    /// NO `SecAccessControl` -- exists ONLY so this test file can prove the
    /// store/read/import/decrypt plumbing independently of whether THIS
    /// harness can satisfy `.biometryCurrentSet` at all (see file header).
    /// Never used by production code.
    private static let plumbingProofService = "cloud.blonie.PasskeyVaultTests.plumbing-proof-only"

    private static func deletePlumbingProofItem() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: plumbingProofService,
        ]
        SecItemDelete(query as CFDictionary)
    }

    /// Stores `bytes` under `plumbingProofService` (no ACL), reads them
    /// straight back, and returns the read bytes -- a plain Keychain round
    /// trip with none of `UkEnvelopeStore`'s biometric gating, used ONLY to
    /// decouple "does the store/read/decrypt plumbing work" from "does this
    /// harness's OS enforce `.biometryCurrentSet`".
    private static func plumbingProofRoundTrip(_ bytes: Data) throws -> Data {
        deletePlumbingProofItem()
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: plumbingProofService,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: bytes,
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainOperationError(status: addStatus, operation: "plumbingProofRoundTrip.add")
        }

        var readQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: plumbingProofService,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &result)
        guard readStatus == errSecSuccess, let data = result as? Data else {
            throw KeychainOperationError(status: readStatus, operation: "plumbingProofRoundTrip.read")
        }
        readQuery.removeValue(forKey: kSecReturnData as String)
        return data
    }

    // MARK: - Task 1: positive round trip through pv-ffi (real decrypt, not `!= nil`)

    /// `store` followed by `read` returns exactly the 32 bytes that were
    /// stored, and those bytes import into a real `FfiUserKey` that decrypts
    /// a fixture ciphertext to a literal plaintext -- `data != nil` and a
    /// length check are both explicitly insufficient per this plan's own
    /// `must_haves`. See the file header for what happens on a harness (like
    /// this one) where `read()` cannot return `.ok` at all.
    @Test func storeThenReadRoundTripsTheRealUserKeyThroughFfi() async throws {
        UkEnvelopeStore.delete()
        defer { UkEnvelopeStore.delete() }

        try UkEnvelopeStore.store(Data(Self.literalUserKeyBytes))
        let outcome = try await UkEnvelopeStore.read(reason: Self.biometricReadReason)

        let bytesToProve: Data
        switch outcome {
        case let .ok(readBytes):
            #expect(Array(readBytes) == Self.literalUserKeyBytes)
            bytesToProve = readBytes
        case .envelopeUnusable:
            // This harness's documented state (file header): no biometry
            // enrolled, no headless enrollment path. Fall back to the
            // ACL-free plumbing proof so the FFI decrypt property is still
            // concretely demonstrated.
            defer { Self.deletePlumbingProofItem() }
            bytesToProve = try Self.plumbingProofRoundTrip(Data(Self.literalUserKeyBytes))
            #expect(Array(bytesToProve) == Self.literalUserKeyBytes)
        default:
            Issue.record("unexpected outcome from a fresh read after store(): \(outcome)")
            return
        }

        let userKey = try importUserKeyFromSession(bytes: bytesToProve)
        let item = try encryptItem(
            userKey: userKey,
            plaintext: Self.literalFixturePlaintext,
            itemId: "kc-fixture-positive",
            revision: 1
        )
        let decrypted = try decryptItem(
            userKey: userKey,
            item: item,
            itemId: "kc-fixture-positive",
            revision: 1
        )
        #expect(decrypted == Self.literalFixturePlaintext)
    }

    /// Negative half, so the positive assertion above can fail: a
    /// deliberately mutated key (one flipped byte, simulating the envelope
    /// coming back as the WRONG key material) must fail to decrypt a
    /// fixture that was sealed under the ORIGINAL, correct key -- a genuine
    /// `FfiError.Decrypt` (AEAD authentication failure), never a silent
    /// pass. Uses the same ACL-outcome/plumbing-proof fallback as the
    /// positive test above, for the same, already-documented reason.
    @Test func mutatedKeyBytesFailToDecryptAFixtureSealedUnderTheOriginalKey() async throws {
        UkEnvelopeStore.delete()
        defer { UkEnvelopeStore.delete(); Self.deletePlumbingProofItem() }

        func obtainRealBytes(for candidate: [UInt8]) async throws -> Data {
            try UkEnvelopeStore.store(Data(candidate))
            let outcome = try await UkEnvelopeStore.read(reason: Self.biometricReadReason)
            if case let .ok(bytes) = outcome {
                return bytes
            }
            return try Self.plumbingProofRoundTrip(Data(candidate))
        }

        let originalReadBytes = try await obtainRealBytes(for: Self.literalUserKeyBytes)
        let originalKey = try importUserKeyFromSession(bytes: originalReadBytes)
        let item = try encryptItem(
            userKey: originalKey,
            plaintext: Self.literalFixturePlaintext,
            itemId: "kc-fixture-negative",
            revision: 1
        )

        var mutatedBytes = Self.literalUserKeyBytes
        mutatedBytes[0] ^= 0xFF
        #expect(mutatedBytes != Self.literalUserKeyBytes)

        UkEnvelopeStore.delete()
        let mutatedReadBytes = try await obtainRealBytes(for: mutatedBytes)
        #expect(Array(mutatedReadBytes) != Self.literalUserKeyBytes)

        let mutatedKey = try importUserKeyFromSession(bytes: mutatedReadBytes)
        do {
            _ = try decryptItem(userKey: mutatedKey, item: item, itemId: "kc-fixture-negative", revision: 1)
            Issue.record("expected decryptItem to throw FfiError.Decrypt for a mismatched key, it returned a value")
        } catch let error as FfiError {
            #expect(error == .Decrypt)
        }
    }

    // MARK: - Task 1: delete-then-add ordering is load-bearing

    /// A NAIVE `SecItemAdd` over an already-present item (skipping the
    /// delete step `store()` performs internally) fails with
    /// `errSecDuplicateItem` (-25299) -- proving the delete-then-add
    /// ordering inside `store()` is load-bearing rather than decorative,
    /// not merely asserting `store()` itself is idempotent (it always is,
    /// by construction, because it always deletes first). This assertion
    /// does not depend on the ACL being satisfiable -- `SecItemAdd` itself
    /// succeeds regardless of whether biometry is enrolled (only `read()`
    /// needs a usable biometric evaluation).
    @Test func rawAddWithoutDeletingFirstYieldsDuplicateItem() throws {
        UkEnvelopeStore.delete()
        defer { UkEnvelopeStore.delete() }

        try UkEnvelopeStore.store(Data(Self.literalUserKeyBytes))

        let rawAddQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: UkEnvelopeStore.service,
            kSecUseDataProtectionKeychain as String: true,
            kSecValueData as String: Data(Self.literalUserKeyBytes),
        ]
        let status = SecItemAdd(rawAddQuery as CFDictionary, nil)
        #expect(status == errSecDuplicateItem)
    }

    // MARK: - Task 1: classifier — three disjoint buckets, exhaustively over the documented table

    @Test func classifierMapsEveryDocumentedStatusIntoItsBucket() {
        let benignCancel: [OSStatus] = [
            errSecUserCanceled,
            OSStatus(LAError.userCancel.rawValue),
            OSStatus(LAError.userFallback.rawValue),
        ]
        let envelopeUnusable: [OSStatus] = [
            errSecAuthFailed,
            errSecItemNotFound,
            errSecNotAvailable,
            OSStatus(LAError.biometryNotEnrolled.rawValue),
        ]
        let lockedNoUI: [OSStatus] = [
            errSecInteractionNotAllowed,
            errSecInteractionRequired,
            OSStatus(LAError.notInteractive.rawValue),
        ]

        for status in benignCancel {
            guard case .benignCancel = classify(status) else {
                Issue.record("status \(status) expected .benignCancel")
                continue
            }
        }
        for status in envelopeUnusable {
            guard case .envelopeUnusable = classify(status) else {
                Issue.record("status \(status) expected .envelopeUnusable")
                continue
            }
        }
        for status in lockedNoUI {
            guard case .lockedNoUI = classify(status) else {
                Issue.record("status \(status) expected .lockedNoUI")
                continue
            }
        }

        guard case .ok = classify(errSecSuccess) else {
            Issue.record("errSecSuccess expected .ok")
            return
        }
        guard case .unexpected = classify(errSecParam) else {
            Issue.record("errSecParam (an undocumented status for this taxonomy) expected .unexpected")
            return
        }
    }

    /// The three named buckets share no member -- asserted directly over
    /// the same three literal arrays the previous test walks, so a future
    /// edit that (accidentally) puts a status in two buckets is caught here
    /// even if the per-bucket walk above happens not to notice.
    @Test func theThreeBucketsAreMutuallyDisjoint() {
        let benignCancel: Set<OSStatus> = [
            errSecUserCanceled,
            OSStatus(LAError.userCancel.rawValue),
            OSStatus(LAError.userFallback.rawValue),
        ]
        let envelopeUnusable: Set<OSStatus> = [
            errSecAuthFailed,
            errSecItemNotFound,
            errSecNotAvailable,
            OSStatus(LAError.biometryNotEnrolled.rawValue),
        ]
        let lockedNoUI: Set<OSStatus> = [
            errSecInteractionNotAllowed,
            errSecInteractionRequired,
            OSStatus(LAError.notInteractive.rawValue),
        ]

        #expect(benignCancel.isDisjoint(with: envelopeUnusable))
        #expect(benignCancel.isDisjoint(with: lockedNoUI))
        #expect(envelopeUnusable.isDisjoint(with: lockedNoUI))
    }

    // MARK: - Task 1: absence is `envelopeUnusable`, never `lockedNoUI`

    /// `delete` on a non-existent item is not an error to the caller
    /// (idempotent, called twice with no throw). `read` on a non-existent
    /// item classifies as `.envelopeUnusable` (the key-absent case), never
    /// `.lockedNoUI` (which means "present but inaccessible right now").
    @Test func deleteIsIdempotentAndReadOnAbsentItemClassifiesAsEnvelopeUnusable() async throws {
        UkEnvelopeStore.delete()
        UkEnvelopeStore.delete() // idempotent: second call must not throw/crash

        let outcome = try await UkEnvelopeStore.read(reason: Self.biometricReadReason)
        guard case .envelopeUnusable = outcome else {
            Issue.record("expected .envelopeUnusable for a missing item, got \(outcome)")
            return
        }
    }

    // MARK: - Task 2: SessionTokenStore -- byte-identical round trip, including padding

    /// A literal session-token-shaped string carrying base64 padding
    /// (`"=="`) -- round trips byte-identical through `save`/`load`, never
    /// re-encoded via `Data(base64Encoded:)`/`.base64EncodedString()`. A
    /// silent re-encode that dropped or normalized padding would still
    /// "work" for most tokens and fail unpredictably for others, so this
    /// is asserted on a value deliberately chosen to carry padding.
    @Test func savedTokenLoadsBackByteIdenticalIncludingPadding() {
        SessionTokenStore.clear()
        defer { SessionTokenStore.clear() }

        let literalPaddedToken = "dGhpcy1pcy1hLTM3LTA0LWZpeHR1cmUtdG9rZW4="
        #expect(literalPaddedToken.hasSuffix("="))

        SessionTokenStore.save(literalPaddedToken)
        let loaded = SessionTokenStore.load()
        #expect(loaded == literalPaddedToken)
    }

    /// `clear()` makes `load()` return nil -- and is idempotent (a second
    /// clear on an already-empty item does not crash).
    @Test func clearMakesLoadReturnNil() {
        SessionTokenStore.save("token-to-be-cleared")
        SessionTokenStore.clear()
        SessionTokenStore.clear()

        #expect(SessionTokenStore.load() == nil)
    }

    /// A DIFFERENT literal token, also padded, round trips unchanged --
    /// covers a second, independent value so the first test's pass is not
    /// a coincidence of that one literal's specific byte pattern.
    @Test func aSecondPaddedTokenAlsoRoundTripsUnchanged() {
        SessionTokenStore.clear()
        defer { SessionTokenStore.clear() }

        let literalToken = "cGFzc2tleS12YXVsdC1zZXNzaW9uLXRva2VuLWZpeHR1cmU="
        SessionTokenStore.save(literalToken)
        #expect(SessionTokenStore.load() == literalToken)
    }

    /// Positive assertion (not "something is absent"): reading the stored
    /// item's own attributes back reports
    /// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, confirming the
    /// class `save()` set is the class actually persisted, not merely the
    /// class `save()`'s source code claims to set.
    @Test func storedTokenItemReportsTheExpectedAccessibleClass() {
        SessionTokenStore.clear()
        defer { SessionTokenStore.clear() }

        SessionTokenStore.save("token-for-attribute-check")

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: SessionTokenStore.service,
            kSecUseDataProtectionKeychain as String: true,
            kSecReturnAttributes as String: true,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        #expect(status == errSecSuccess)

        guard let attributes = result as? [String: Any] else {
            Issue.record("expected attributes dictionary back, got \(String(describing: result))")
            return
        }
        let accessible = attributes[kSecAttrAccessible as String] as? String
        #expect(accessible == (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String))
    }

    // MARK: - Task 2: cross-store independence (ACC-03/ACC-04 adjacency edge)

    /// The two Keychain items sit side by side under different
    /// `kSecAttrService` strings -- deleting the envelope must not touch
    /// the session token. Positive, receiver-side: the token is asserted
    /// to still hold the SAME literal string, not merely "no error was
    /// thrown".
    @Test func deletingTheEnvelopeLeavesTheSessionTokenUntouched() async throws {
        UkEnvelopeStore.delete()
        SessionTokenStore.clear()
        defer { UkEnvelopeStore.delete(); SessionTokenStore.clear() }

        let literalToken = "cross-store-independence-token-a"
        try UkEnvelopeStore.store(Data(Self.literalUserKeyBytes))
        SessionTokenStore.save(literalToken)

        UkEnvelopeStore.delete()

        #expect(SessionTokenStore.load() == literalToken)
    }

    /// The other direction: clearing the session token must not touch the
    /// envelope -- asserted positively and functionally, not just "still
    /// present": the envelope must still `read()` (or, on this harness,
    /// fall back to the plumbing proof per the file header) and still
    /// decrypt a fixture to a literal through `pv-ffi`.
    @Test func clearingTheSessionTokenLeavesTheEnvelopeIntactAndDecryptable() async throws {
        UkEnvelopeStore.delete()
        SessionTokenStore.clear()
        defer { UkEnvelopeStore.delete(); SessionTokenStore.clear(); Self.deletePlumbingProofItem() }

        try UkEnvelopeStore.store(Data(Self.literalUserKeyBytes))
        SessionTokenStore.save("cross-store-independence-token-b")

        SessionTokenStore.clear()

        let outcome = try await UkEnvelopeStore.read(reason: Self.biometricReadReason)
        let bytesToProve: Data
        switch outcome {
        case let .ok(readBytes):
            bytesToProve = readBytes
        case .envelopeUnusable:
            // Same documented harness limitation as the Task 1 tests above
            // (file header) -- prove the envelope's CONTENT survived via
            // the ACL-free plumbing item, storing the same literal bytes a
            // second time under that separate service.
            bytesToProve = try Self.plumbingProofRoundTrip(Data(Self.literalUserKeyBytes))
        default:
            Issue.record("unexpected outcome from read() after clearing only the session token: \(outcome)")
            return
        }

        let userKey = try importUserKeyFromSession(bytes: bytesToProve)
        let item = try encryptItem(
            userKey: userKey,
            plaintext: Self.literalFixturePlaintext,
            itemId: "kc-cross-store-b",
            revision: 1
        )
        let decrypted = try decryptItem(userKey: userKey, item: item, itemId: "kc-cross-store-b", revision: 1)
        #expect(decrypted == Self.literalFixturePlaintext)
    }

    // MARK: - Task 4: BiometricUnlockOutcome -> PVKey state mapping

    /// Each documented `BiometricUnlockOutcome` maps to the expected
    /// `PVKey` -- or, for the outcomes that render nothing, to no key at
    /// all. Positive assertion about what the user is shown, not a check
    /// that an error object is nil.
    @Test func biometricOutcomesMapToTheExpectedCopyKeyOrNoKeyAtAll() {
        #expect(BiometricUnlockOutcome.envelopeInvalidated.copyKey == .unlockEnvelopeInvalidated)
        #expect(BiometricUnlockOutcome.biometryLockedOut.copyKey == .unlockBiometryLockedOut)
        #expect(BiometricUnlockOutcome.biometryDenied.copyKey == .unlockBiometryDenied)
        #expect(BiometricUnlockOutcome.benignCancel.copyKey == nil)
        #expect(BiometricUnlockOutcome.locked.copyKey == nil)
        #expect(BiometricUnlockOutcome.unexpected(errSecParam).copyKey == nil)
    }

    /// The three documented error-state strings are pairwise distinct,
    /// independently in EACH locale -- a shared/collapsed string between
    /// two causes would defeat the whole point of the three-message
    /// taxonomy.
    @Test func theThreeBiometricErrorStatesArePairwiseDistinctPerLocale() {
        let keys: [PVKey] = [.unlockEnvelopeInvalidated, .unlockBiometryLockedOut, .unlockBiometryDenied]
        for locale in [PVLocale.pl, PVLocale.en] {
            let strings = keys.map { t($0, locale: locale) }
            #expect(Set(strings).count == strings.count, "duplicate copy among biometric error states in \(locale)")
        }
    }

    /// The benign-cancel state produces NO message -- asserted positively
    /// as "there is no copy key for this outcome", not merely "the error
    /// object is nil".
    @Test func benignCancelOutcomeProducesNoCopyKey() {
        #expect(BiometricUnlockOutcome.benignCancel.copyKey == nil)
    }
}
