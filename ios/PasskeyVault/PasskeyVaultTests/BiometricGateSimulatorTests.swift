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
