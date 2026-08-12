//
//  BiometricGateSimulatorTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-05.
//
//  E1/E2/E4/E6 (Task 1), E3/E3-alt/E5 (Task 2). Every claim here is a
//  statement about THIS simulator's mock AKS (`ios/IOS-SPIKE-LOG.md`'s own
//  MP-1 pre-registration), never a claim about a physical device.
//
//  Getting a machine-readable result OUT of this test process, this run
//  (recorded because print()/os_log were already found empty by 37-03, and
//  a NEW finding this plan adds): Foundation's `Process` type is UNAVAILABLE
//  on iOS entirely (a real compile error, not a runtime restriction --
//  `error: cannot find 'Process' in scope`), so the pattern this file
//  originally tried (spawning `xcrun simctl spawn ... notifyutil` FROM
//  inside the test, timed against the blocking call) cannot exist on this
//  platform. What DOES work, verified directly this run with a throwaway
//  probe test and read back from the host shell: a plain
//  `Data(...).write(to: URL(fileURLWithPath: "/private/tmp/..."))` from
//  inside a Simulator-hosted test process lands on the REAL host
//  filesystem, unlike a physical device's sandboxed container. Every
//  experiment below writes its observed result to a fixed
//  `/private/tmp/pv37-05-<name>.txt` path; `scripts/run-ios-biometry-experiments.sh`
//  reads these back after `xcodebuild test` returns, and is responsible for
//  sending the `notifyutil` biometric-response notifications from the HOST
//  side, timed with a fixed sleep before invoking `xcodebuild test` in the
//  background -- there is no in-test alternative on this SDK.
//
//  Requires a single already-booted simulator, its UDID supplied via
//  `PV_TARGET_UDID` (plain) or `TEST_RUNNER_PV_TARGET_UDID` (only the
//  `TEST_RUNNER_`-prefixed spelling was found to forward reliably on this
//  toolchain, 37-03's own finding) -- present here only for tests that need
//  to know their own target for documentation in the written result; the
//  actual `notifyutil` calls are the shell orchestrator's job.
//

import Foundation
import Testing
import Security
import LocalAuthentication
@testable import PasskeyVault

/// Writes one experiment's result to a fixed, predictable path under
/// `/private/tmp/` so the HOST shell orchestrator can read it back after
/// `xcodebuild test` returns -- the only channel this run found that
/// actually survives a Swift Testing run under `xcodebuild test` (print()/
/// os_log do not; see this file's header).
enum ResultFile {
    static func write(_ name: String, _ contents: String) {
        let url = URL(fileURLWithPath: "/private/tmp/pv37-05-\(name).txt")
        try? contents.data(using: .utf8)?.write(to: url, options: .atomic)
    }
}

/// Races an async operation against a wall-clock timeout WITHOUT being able
/// to truly cancel a blocking C call mid-flight (`SecItemCopyMatching` has
/// no cancellation token) -- the loser keeps running in an orphaned detached
/// task, harmless because the test PROCESS exits at suite end regardless.
/// Used only to bound how long a single experiment can hold up the whole
/// suite while still reporting an honest "did not resolve" result.
func raceWithTimeout<T: Sendable>(
    seconds: Double,
    operation: @escaping @Sendable () async -> T
) async -> T? {
    await withTaskGroup(of: T?.self) { group in
        group.addTask { await operation() }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}

@Suite(.serialized)
struct BiometricGateSimulatorTests {

    static let literalUserKeyBytes: [UInt8] = [
        0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97,
        0x98, 0x99, 0x9A, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F,
        0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
        0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF,
    ]

    static let literalFixturePlaintext = "{\"type\":\"note\",\"body\":\"37-05 biometric-gate fixture\"}"

    private static let e1Service = "cloud.blonie.PasskeyVaultTests.e1-passcode-probe"

    private static func deleteE1Item() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: e1Service,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - E1 -- can this simulator hold a passcode? (shipped protection class testable?)

    /// `SecItemAdd` the envelope-shaped item under the SHIPPED ACC-03
    /// protection class (`kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` +
    /// `.biometryCurrentSet`). status 0 -> shipped class is testable as
    /// shipped; `errSecNotAvailable` (-25291) -> no passcode on this
    /// simulator, falsifying "the shipped class is provable here" (MP-1);
    /// `errSecParam` (-50) belongs to E4, not E1.
    @Test func e1_canThisSimulatorHoldAPasscode() throws {
        Self.deleteE1Item()
        defer { Self.deleteE1Item() }

        var acError: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet],
            &acError
        ) else {
            ResultFile.write("e1", "AC_CONSTRUCTION_FAILED \(String(describing: acError))")
            Issue.record("E1: SecAccessControlCreateWithFlags itself failed: \(String(describing: acError))")
            return
        }

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.e1Service,
            kSecUseDataProtectionKeychain as String: true,
            kSecValueData as String: Data(Self.literalUserKeyBytes),
            kSecAttrAccessControl as String: ac,
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        ResultFile.write("e1", "status=\(status)")
        // The status itself is the finding -- this test does not fail on
        // either documented outcome, only on something OUTSIDE the
        // documented trichotomy, which is a genuine surprise worth
        // investigating by hand.
        #expect(status == errSecSuccess || status == errSecNotAvailable || status == errSecParam)
    }

    // MARK: - E2 -- the gate for everything else: does this simulator enforce the ACL?

    /// `SecItemCopyMatching` with `kSecReturnData: true` and NO `LAContext`
    /// at all, against a freshly-stored ACC-03 envelope. The HOST shell
    /// orchestrator sends a `pearl.match` notification ~2s after launching
    /// this suite, in case Result A holds and a system sheet needs a
    /// response to resolve within the bounded wait below. Result A: the
    /// call does not return the data unconditionally (blocks past the
    /// bounded wait, or returns a non-success status) -> enforcement
    /// observed. Result B: status 0 and the 32 bytes return immediately ->
    /// enforcement NOT observed on this simulator.
    @Test func e2_doesThisSimulatorEnforceTheAcl() async throws {
        await UkEnvelopeStore.delete()
        defer { Task { await UkEnvelopeStore.delete() } }
        try await UkEnvelopeStore.store(Data(Self.literalUserKeyBytes))

        let outcome = await raceWithTimeout(seconds: 10.0) { () -> (OSStatus, [UInt8]?) in
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: UkEnvelopeStore.service,
                kSecUseDataProtectionKeychain as String: true,
                kSecReturnData as String: true,
            ]
            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            let bytes = (result as? Data).map { Array($0) }
            return (status, bytes)
        }

        guard let (status, bytes) = outcome else {
            ResultFile.write("e2", "VERDICT=A NOTE=no-result-within-10s-bounded-wait")
            return
        }

        if status == errSecSuccess, let bytes, bytes == Self.literalUserKeyBytes {
            ResultFile.write("e2", "VERDICT=B status=\(status) bytes-match=true")
            #expect(bytes == Self.literalUserKeyBytes)
        } else {
            ResultFile.write("e2", "VERDICT=A status=\(status) data-present=\(bytes != nil)")
        }
    }

    // MARK: - E4 -- kSecAttrAccessible x kSecAttrAccessControl collision

    /// Add the SAME item twice: once with only `kSecAttrAccessControl`
    /// naming a class, once with BOTH that `kSecAttrAccessControl` AND the
    /// same class again as `kSecAttrAccessible`. `errSecParam` (-50) on the
    /// second -> the third-party folklore is right; `0` -> refuted.
    @Test func e4_accessibleAndAccessControlCollision() throws {
        let service = "cloud.blonie.PasskeyVaultTests.e4-collision-probe"
        func deleteItem() {
            let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
            SecItemDelete(q as CFDictionary)
        }
        deleteItem()
        defer { deleteItem() }

        var acError: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [],
            &acError
        ) else {
            ResultFile.write("e4", "AC_CONSTRUCTION_FAILED \(String(describing: acError))")
            Issue.record("E4: SecAccessControlCreateWithFlags failed: \(String(describing: acError))")
            return
        }

        // First add: ONLY kSecAttrAccessControl.
        let firstAddQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
            kSecValueData as String: Data([0x01, 0x02, 0x03]),
            kSecAttrAccessControl as String: ac,
        ]
        let firstStatus = SecItemAdd(firstAddQuery as CFDictionary, nil)
        #expect(firstStatus == errSecSuccess)
        deleteItem()

        // Second add: BOTH kSecAttrAccessControl AND kSecAttrAccessible
        // naming the SAME class.
        let secondAddQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
            kSecValueData as String: Data([0x01, 0x02, 0x03]),
            kSecAttrAccessControl as String: ac,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let secondStatus = SecItemAdd(secondAddQuery as CFDictionary, nil)
        ResultFile.write("e4", "status=\(secondStatus)")
        #expect(secondStatus == errSecParam || secondStatus == errSecSuccess)
        if secondStatus == errSecSuccess {
            deleteItem()
        }
    }

    // MARK: - E6 -- does anything expire the envelope across a shutdown/boot cycle?

    /// Writes the fixture and confirms the write; the shutdown/boot/re-read
    /// cycle itself is driven from the shell orchestrator (a `simctl
    /// shutdown`+`boot` from INSIDE a running `xcodebuild test` invocation
    /// is not meaningful -- the test process itself would be torn down with
    /// the simulator). `E6ReadBackTests` (below, a SEPARATE suite run by the
    /// orchestrator AFTER the reboot) reads back through the same
    /// `UkEnvelopeStore` API and records survival.
    @Test func e6_writeFixtureForShutdownBootProbe() throws {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: UkEnvelopeStore.service,
            kSecUseDataProtectionKeychain as String: true,
        ] as CFDictionary)

        var acError: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet],
            &acError
        ) else {
            Issue.record("E6 setup: SecAccessControlCreateWithFlags failed: \(String(describing: acError))")
            return
        }
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: UkEnvelopeStore.service,
            kSecUseDataProtectionKeychain as String: true,
            kSecValueData as String: Data(Self.literalUserKeyBytes),
            kSecAttrAccessControl as String: ac,
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        ResultFile.write("e6-write", "status=\(status)")
        #expect(status == errSecSuccess)
        // Deliberately no cleanup -- E6's whole point is whether this item
        // survives a shutdown/boot cycle.
    }
}

/// A SEPARATE suite, run by the orchestrator only AFTER a `simctl
/// shutdown`+`boot` cycle, to answer E6 without needing the ORIGINAL test
/// process (torn down by the reboot) to still be alive.
@Suite(.serialized)
struct E6ReadBackTests {
    @Test func e6_readBackAfterReboot() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: UkEnvelopeStore.service,
            kSecUseDataProtectionKeychain as String: true,
            kSecReturnAttributes as String: true,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        let survived = (status == errSecSuccess)
        ResultFile.write("e6", "item_survived_reboot=\(survived ? "yes" : "no") status=\(status)")
    }
}

// MARK: - Task 2: E3-alt (E2 = Result B, so E3 does not apply -- run per the plan's own instruction)

/// E2 observed Result B (`ios/IOS-SPIKE-LOG.md`'s own `E2 VERDICT: Result B`
/// line): this simulator returns ACL-protected data unconditionally with NO
/// `LAContext` at all, so E3's premise (a real gate exists to drive to both
/// outcomes) does not hold here. E3-alt runs instead: prove the ACL OBJECT
/// itself carries the right constraint, and prove the CODE genuinely asks
/// the OS via a real `LAContext.evaluateAccessControl` gate before it will
/// reach `SecItemCopyMatching` -- explicitly NOT a claim that a device would
/// deny the read (this simulator cannot demonstrate that, per E2).
@Suite(.serialized)
struct E3AltTests {
    static let literalBytes: [UInt8] = BiometricGateSimulatorTests.literalUserKeyBytes

    static func makeAcl() throws -> SecAccessControl {
        var acError: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet],
            &acError
        ) else {
            throw AccessControlConstructionError(underlying: acError?.takeRetainedValue())
        }
        return ac
    }

    /// `SecAccessControlCreateWithFlags` returns non-nil, and its
    /// `CFCopyDescription` is dumped into the log as evidence the object
    /// carries the `.biometryCurrentSet` constraint -- inspectable, not
    /// merely asserted "it constructed".
    @Test func e3alt_aclConstructsAndDescribesTheBiometryConstraint() throws {
        let ac = try Self.makeAcl()
        let description = CFCopyDescription(ac) as String
        ResultFile.write("e3alt-acl-description", description)
        #expect(!description.isEmpty)
    }

    /// The MATCH half: a real `LAContext.evaluateAccessControl(_:operation:localizedReason:)`
    /// gate in front of the read, driven with a `pearl.match` sent by the
    /// HOST orchestrator (this file cannot spawn `notifyutil` itself --
    /// `Process` is unavailable on iOS, see this file's header). Records
    /// whether the evaluation succeeded and, ONLY if it did, whether
    /// `SecItemCopyMatching` was reached -- the observable side effect that
    /// stands in for a call counter.
    @Test func e3alt_matchingFaceReachesSecItemCopyMatching() async throws {
        let ac = try Self.makeAcl()
        let context = LAContext()
        defer { context.invalidate() }

        do {
            let success = try await context.evaluateAccessControl(
                ac,
                operation: .useItem,
                localizedReason: "E3-alt match path"
            )
            var reachedSecItemCopyMatching = false
            var status: OSStatus = -9999
            if success {
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: UkEnvelopeStore.service,
                    kSecUseDataProtectionKeychain as String: true,
                    kSecReturnData as String: true,
                ]
                var result: AnyObject?
                status = SecItemCopyMatching(query as CFDictionary, &result)
                reachedSecItemCopyMatching = true
            }
            ResultFile.write(
                "e3alt-match",
                "evaluateSuccess=\(success) reachedSecItemCopyMatching=\(reachedSecItemCopyMatching) status=\(status)"
            )
        } catch {
            ResultFile.write("e3alt-match", "evaluateThrew=true error=\(error) reachedSecItemCopyMatching=false")
        }
    }

    /// The NON-MATCH half, the falsifiability-relevant one: driven with a
    /// `pearl.nomatch` sent by the host orchestrator, and asserts the code
    /// demonstrably never reaches `SecItemCopyMatching` -- `reached` is
    /// FALSE, positively recorded, not inferred from an absent log line.
    @Test func e3alt_nonMatchingFaceNeverReachesSecItemCopyMatching() async throws {
        let ac = try Self.makeAcl()
        let context = LAContext()
        defer { context.invalidate() }

        var reachedSecItemCopyMatching = false
        do {
            let success = try await context.evaluateAccessControl(
                ac,
                operation: .useItem,
                localizedReason: "E3-alt nomatch path"
            )
            if success {
                // Would only happen if the evaluation itself did not honor
                // the nomatch signal -- reached is set TRUE so the marker
                // reflects reality rather than the expected shape.
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: UkEnvelopeStore.service,
                    kSecUseDataProtectionKeychain as String: true,
                    kSecReturnData as String: true,
                ]
                var result: AnyObject?
                _ = SecItemCopyMatching(query as CFDictionary, &result)
                reachedSecItemCopyMatching = true
            }
            ResultFile.write(
                "e3alt-nomatch",
                "evaluateSuccess=\(success) reachedSecItemCopyMatching=\(reachedSecItemCopyMatching)"
            )
            #expect(reachedSecItemCopyMatching == false)
        } catch {
            ResultFile.write(
                "e3alt-nomatch",
                "evaluateThrew=true error=\(error) reachedSecItemCopyMatching=\(reachedSecItemCopyMatching)"
            )
            #expect(reachedSecItemCopyMatching == false)
        }
    }
}

// MARK: - Task 2: E5 -- SC5, biometric-set-change invalidation, both halves

/// Two-part suite: Part A stores the envelope and reads it once
/// successfully, recording the pre-change `stateHash`. The orchestrator then
/// performs the enrolled-set change (Simulator.app Features -> Face ID ->
/// Enrolled off/on, via `osascript`, now that assistive access is granted
/// this session -- see the log's own amendment) BETWEEN Part A and Part B,
/// in a SEPARATE `xcodebuild test` invocation, because the change itself is
/// driven from the host, not from inside the test process.
@Suite(.serialized)
struct E5Tests {
    static let literalBytes: [UInt8] = BiometricGateSimulatorTests.literalUserKeyBytes

    @Test func e5_partA_storeAndReadBeforeChange() async throws {
        await UkEnvelopeStore.delete()
        try await UkEnvelopeStore.store(Data(Self.literalBytes))

        let stateHashContext = LAContext()
        let stateHashBefore: Data?
        if #available(iOS 18.0, *) {
            stateHashBefore = stateHashContext.domainState.biometry.stateHash
        } else {
            stateHashBefore = nil
        }
        stateHashContext.invalidate()

        let outcome = try await UkEnvelopeStore.read(reason: "E5 part A -- before enrollment change")
        let outcomeDescription: String
        switch outcome {
        case let .ok(bytes):
            outcomeDescription = "ok bytes-match=\(Array(bytes) == Self.literalBytes)"
        case let .envelopeUnusable(status):
            outcomeDescription = "envelopeUnusable status=\(status)"
        default:
            outcomeDescription = "\(outcome)"
        }

        ResultFile.write(
            "e5-before",
            "stateHash=\(stateHashBefore?.base64EncodedString() ?? "nil") outcome=\(outcomeDescription)"
        )
    }

    /// Run by the orchestrator in a SEPARATE `xcodebuild test` invocation,
    /// after the enrolled-set change. Reads the envelope back through the
    /// REAL production `UkEnvelopeStore.read` (a real `LAContext`, exactly
    /// the code path `BiometricUnlockService` drives), asserts membership in
    /// the documented equivalence class if it comes back unusable, and
    /// checks (step 4) whether the underlying Keychain ROW itself is still
    /// present -- deciding whether delete-then-add is load-bearing on this
    /// OS. If the read still succeeds with the correct bytes, that is
    /// recorded honestly as the FAIL/unprovable case, per this plan's own
    /// mandated pairing with an `E5 UNPROVABLE --` log line.
    @Test func e5_partB_readAfterChangeAndCheckRecovery() async throws {
        let stateHashContext = LAContext()
        let stateHashAfter: Data?
        if #available(iOS 18.0, *) {
            stateHashAfter = stateHashContext.domainState.biometry.stateHash
        } else {
            stateHashAfter = nil
        }
        stateHashContext.invalidate()

        let outcome = try await UkEnvelopeStore.read(reason: "E5 part B -- after enrollment change")

        let equivalenceClass: [OSStatus] = [-25293, -25300, -25291]

        switch outcome {
        case let .ok(bytes):
            let bytesMatch = Array(bytes) == Self.literalBytes
            ResultFile.write(
                "e5",
                "status=0 row_survived=n-a stateHash=\(stateHashAfter?.base64EncodedString() ?? "nil") stillOkBytesMatch=\(bytesMatch)"
            )

        case let .envelopeUnusable(status):
            #expect(equivalenceClass.contains(status))

            // Step 4: a SEPARATE attributes-only query decides whether the
            // row itself survived (invalidated-not-deleted) or was removed.
            let attrQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: UkEnvelopeStore.service,
                kSecUseDataProtectionKeychain as String: true,
                kSecReturnAttributes as String: true,
            ]
            var attrResult: AnyObject?
            let attrStatus = SecItemCopyMatching(attrQuery as CFDictionary, &attrResult)
            let rowSurvived = (attrStatus == errSecSuccess)
            ResultFile.write("e5", "status=\(status) row_survived=\(rowSurvived ? "yes" : "no")")

            if rowSurvived {
                // A naive re-add (no delete first) must collide.
                let naiveAddQuery: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: UkEnvelopeStore.service,
                    kSecUseDataProtectionKeychain as String: true,
                    kSecValueData as String: Data(Self.literalBytes),
                ]
                let naiveAddStatus = SecItemAdd(naiveAddQuery as CFDictionary, nil)
                ResultFile.write("e5-naive-readd", "status=\(naiveAddStatus)")
                #expect(naiveAddStatus == errSecDuplicateItem)
            }

            // Positive user-visible half: the mapped outcome's copy contains
            // "password" in English, per ACC-03's fallback copy.
            let mapped = BiometricUnlockOutcome.envelopeInvalidated
            let englishCopy = t(mapped.copyKey!, locale: .en)
            #expect(englishCopy.localizedCaseInsensitiveContains("password"))
            ResultFile.write("e5-ui-copy", englishCopy)

        default:
            ResultFile.write("e5", "status=UNEXPECTED outcome=\(outcome)")
        }
    }
}
