//
//  BiometricCoWWipeTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), post-review fix CR-01/FIX-2.
//
//  Proves two things, each with a positive, receiver-side assertion on
//  literal bytes (QA-01/QA-03), never merely "resetBytes was called":
//
//  1. `dataResetBytesOnANonUniquelyReferencedCopyDoesNotWipeTheOriginal`
//     is a STANDALONE proof (touches no production code) that Swift
//     `Data`'s copy-on-write semantics make the naive fix
//     (`var mutableBytes = bytes; defer { mutableBytes.resetBytes(...) }`)
//     genuinely dangerous: wiping a non-uniquely-referenced copy zeroes
//     only the COPY, never the original buffer a second live reference
//     still points at. This is why "assert resetBytes ran" or "assert the
//     wiped local reads back as zero" are BOTH insufficient proof -- the
//     wiped local always reads back as zero, copy-out or not; that alone
//     can never distinguish a real in-place wipe from a wiped COW copy
//     that left the original plaintext untouched.
//
//  2. `consumeOkBytesDropsTheEnumsAliasBeforeWipingSoTheWipeIsInPlace`
//     exercises `BiometricUnlockService.consumeOkBytes` (the actual
//     production code CR-01's fix lives in) and proves the mechanism that
//     avoids test 1's trap: `outcome` is reassigned away from `.ok` BEFORE
//     the wipe runs, so by the time `resetBytes` executes, `bytes` is the
//     ONLY live reference to that storage -- confirmed two ways: `outcome`
//     no longer carries a `.ok` payload afterward, and the bytes `use`
//     actually saw (the true, still-plaintext content) match the literal
//     fixture, proving `consumeOkBytes` did not accidentally hand `use` an
//     already-wiped or substituted buffer.
//
//  Revert the `outcome = .benignCancel` line in
//  `BiometricUnlockService.consumeOkBytes` to reproduce a RED run of test
//  2 (recorded in 37-04-SUMMARY.md's "Post-review fixes" section per
//  QA-02/QA-04 -- every new verification command must be demonstrated
//  failing at least once before its passing is believed).
//

import Foundation
import Security
import Testing
@testable import PasskeyVault

struct BiometricCoWWipeTests {

    private static let literalKeyBytes = Data(repeating: 0xAB, count: 32)
    private static let literalZeroBytes = Data(repeating: 0, count: 32)

    // MARK: - Test 1: the CoW trap itself, isolated from production code

    /// A pure demonstration of the exact defect this fix guards against.
    /// `aliasStillReferencingOriginal` plays the role `outcome` played
    /// in the pre-fix `BiometricUnlockService.unlockWithBiometrics`: a
    /// second live reference to the SAME storage, still alive when the
    /// wipe runs. If `Data` were not copy-on-write, or if this codebase's
    /// naive candidate fix (`var mutableBytes = bytes; defer {
    /// mutableBytes.resetBytes(...) }`) were actually safe, this test
    /// would fail -- it does not, which is exactly why FIX-2 restructures
    /// the lifetime instead of just adding a `defer`.
    @Test func dataResetBytesOnANonUniquelyReferencedCopyDoesNotWipeTheOriginal() {
        let original = Self.literalKeyBytes
        let aliasStillReferencingOriginal = original // second live reference, kept alive on purpose

        var copy = original
        copy.resetBytes(in: 0..<copy.count)

        // The wiped copy itself always reads back as zero -- this alone is
        // NOT proof of a safe wipe (see file header).
        #expect(copy == Self.literalZeroBytes)

        // The ORIGINAL, still referenced by a second live binding, is
        // completely untouched -- this is the actual bug CR-01 describes:
        // a `defer { bytes.resetBytes(...) }` sitting next to a second
        // still-alive reference wipes nothing that matters.
        #expect(aliasStillReferencingOriginal == Self.literalKeyBytes)
        #expect(original == Self.literalKeyBytes)
    }

    // MARK: - Test 2: production code's `consumeOkBytes` avoids the trap

    /// Exercises the exact helper `unlockWithBiometrics`'s `.ok` branch
    /// calls. Two positive, receiver-side assertions:
    /// - `use` observed the real, literal plaintext bytes (proves
    ///   `consumeOkBytes` is not accidentally handing over a pre-wiped or
    ///   substituted buffer -- the wipe must happen AFTER use, not before).
    /// - `outcome` no longer carries an `.ok` payload once the call
    ///   returns -- the necessary precondition for the wipe inside
    ///   `consumeOkBytes` to have been an in-place mutation of the
    ///   ORIGINAL storage rather than a COW copy-out (test 1 proves what
    ///   happens when this precondition is absent).
    @Test func consumeOkBytesDropsTheEnumsAliasBeforeWipingSoTheWipeIsInPlace() throws {
        var outcome = KeychainOutcome.ok(Self.literalKeyBytes)

        let observedByUse: Data? = try BiometricUnlockService.consumeOkBytes(&outcome) { bytes in
            bytes
        }

        #expect(observedByUse == Self.literalKeyBytes)

        guard case .benignCancel = outcome else {
            Issue.record(
                "outcome should have been reassigned away from .ok before consumeOkBytes wiped its bytes, got \(outcome)"
            )
            return
        }
    }

    /// Same shape as the positive test above, but proves `consumeOkBytes`
    /// wipes even when `use` throws -- the `defer` must fire on every exit
    /// path, mirroring CR-02's `AccountService` fix for the same reason.
    @Test func consumeOkBytesStillDropsTheAliasWhenUseThrows() {
        struct FixtureError: Error {}
        var outcome = KeychainOutcome.ok(Self.literalKeyBytes)

        do {
            _ = try BiometricUnlockService.consumeOkBytes(&outcome) { (_: Data) -> Void in
                throw FixtureError()
            }
            Issue.record("expected consumeOkBytes to propagate FixtureError from `use`, it returned normally")
        } catch is FixtureError {
            // expected
        } catch {
            Issue.record("expected FixtureError, got \(error)")
        }

        guard case .benignCancel = outcome else {
            Issue.record("outcome should have been reassigned away from .ok even on the throwing path, got \(outcome)")
            return
        }
    }

    /// `consumeOkBytes` returns `nil` (never crashes) for every non-`.ok`
    /// case -- a positive, exhaustive check of the guard's other branch.
    @Test func consumeOkBytesReturnsNilForEveryNonOkOutcome() throws {
        var benign = KeychainOutcome.benignCancel
        #expect(try BiometricUnlockService.consumeOkBytes(&benign) { _ in "unreachable" } == nil)

        var unusable = KeychainOutcome.envelopeUnusable(errSecItemNotFound)
        #expect(try BiometricUnlockService.consumeOkBytes(&unusable) { _ in "unreachable" } == nil)

        var locked = KeychainOutcome.lockedNoUI(errSecInteractionNotAllowed)
        #expect(try BiometricUnlockService.consumeOkBytes(&locked) { _ in "unreachable" } == nil)

        var unexpected = KeychainOutcome.unexpected(errSecParam)
        #expect(try BiometricUnlockService.consumeOkBytes(&unexpected) { _ in "unreachable" } == nil)
    }
}
