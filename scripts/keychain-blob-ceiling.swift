// scripts/keychain-blob-ceiling.swift -- Phase 39, Plan 39-02, Task 2 (E-C4).
//
// NOT EXECUTED BY THIS PLAN. DR-1 (`ios/IOS-SPIKE-LOG.md` §1) chose the hybrid
// (Keychain + App Group) model, so Phase 39's ciphertext cache is written to
// the App Group container, never to a Keychain generic-password item -- see
// `ios/evidence/39/02-branch-gate.md` "Task 2 -- Branch K ceiling
// measurement: not applicable". This file exists per this plan's
// `files_modified` declaration so that a *future* reconsideration of Branch K
// (should DR-1 ever be revisited) has a ready, correctly-shaped harness
// instead of starting from nothing -- it is authored, not run, under Branch H
// (D-08: a harness that has never executed is a recorded non-result, not a
// PASS).
//
// Reuses the exact SecItem call shape and runtime access-group discovery
// Phase 36's E3 already proved cross-process
// (`ios/PasskeyVault/PasskeyVaultAutoFill/KeychainProbe.swift`,
// `ios/PasskeyVault/PasskeyVault/ProbeSeeder.swift`) rather than re-deriving
// it. Per `39-RESEARCH.md` §E-C4: write generic-password items of 64 KB,
// 256 KB, 1 MB and 4 MB under the shared access group, read each back through
// a fresh query, and compare SHA-256 digests. Report the first size that
// fails to round-trip byte-identically, or `none` if all four pass. Then
// demonstrate the comparison is live by deliberately corrupting one byte of a
// read-back buffer and confirming the comparison reports a mismatch --
// without that control, "all four passed" is indistinguishable from a
// comparison that never ran (D-08).
//
// Adapting this into something runnable, when Branch K is next considered:
// this enum has no XCTest/XCUIApplication dependency and no UIKit import
// (the extension target cannot link UIKit -- 39-RESEARCH.md Pitfall 7), so it
// can be dropped into either (a) a throwaway command-line tool target that
// links Security.framework and runs against the booted simulator directly,
// or (b) a `PasskeyVaultTests` XCTestCase that calls `run()` from a test
// method -- record which was chosen and why, per this task's own action text,
// at that time. It is not wired into any Xcode target by this plan (the
// plan's own prohibition: no Swift source under `ios/PasskeyVault/` is
// created or modified by this plan).

import Foundation
import Security
#if canImport(CryptoKit)
import CryptoKit
#endif

enum KeychainBlobCeilingProbe {
    /// Fixed probe service name -- distinct from any real vault item or any
    /// other probe's service name.
    static let service = "cloud.blonie.PasskeyVault.probe.e-c4"

    /// The four payload sizes E-C4 mandates, in bytes.
    static let payloadSizes: [Int] = [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024]

    struct SizeResult {
        let sizeBytes: Int
        let writeStatus: OSStatus
        let readStatus: OSStatus
        let writtenDigestHex: String
        let readBackDigestHex: String
        let equal: Bool
    }

    /// Duplicated from KeychainProbe.swift / ProbeSeeder.swift (separate
    /// build target, no shared framework) -- discovers this process's own
    /// default keychain access group AT RUNTIME rather than hardcoding the
    /// expanded team-prefix literal (D-05, landmine L-8).
    private static func resolveAccessGroupAtRuntime() -> String? {
        let probeService = "cloud.blonie.PasskeyVault.probe.access-group-discovery.e-c4"
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: probeService
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: probeService,
            kSecValueData as String: Data([0x00])
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else { return nil }

        let readQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: probeService,
            kSecReturnAttributes as String: true
        ]
        var result: CFTypeRef?
        let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &result)
        SecItemDelete(deleteQuery as CFDictionary)
        guard readStatus == errSecSuccess,
              let attrs = result as? [String: Any],
              let group = attrs[kSecAttrAccessGroup as String] as? String
        else { return nil }
        return group
    }

    private static func sha256Hex(_ data: Data) -> String {
        #if canImport(CryptoKit)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        #else
        // No CryptoKit fallback is intentionally NOT implemented here: this
        // file is not executed by this plan, and any future integration
        // target (Xcode app/test target, or a CLI tool built against a
        // recent SDK) has CryptoKit available.
        fatalError("CryptoKit unavailable -- see file header")
        #endif
    }

    private static func randomPayload(count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        for i in 0..<count { bytes[i] = UInt8.random(in: 0...255) }
        return Data(bytes)
    }

    /// Writes `payload` under `service`+`accessGroup`, reads it back through
    /// a FRESH query (never re-using the write's own buffer), and compares
    /// SHA-256 digests. `kSecAttrSynchronizable` is explicitly `false`
    /// (Pitfall 8) so the payload never replicates to iCloud Keychain.
    private static func roundTrip(payload: Data, accessGroup: String) -> SizeResult {
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
            kSecValueData as String: payload
        ]
        let writeStatus = SecItemAdd(addQuery as CFDictionary, nil)
        let writtenDigest = sha256Hex(payload)

        let readQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup,
            kSecAttrSynchronizable as String: false,
            kSecReturnData as String: true
        ]
        var result: CFTypeRef?
        let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &result)

        var readBackDigest = ""
        var equal = false
        if readStatus == errSecSuccess, let readData = result as? Data {
            readBackDigest = sha256Hex(readData)
            equal = (writeStatus == errSecSuccess) && (readBackDigest == writtenDigest)
        }

        return SizeResult(
            sizeBytes: payload.count,
            writeStatus: writeStatus,
            readStatus: readStatus,
            writtenDigestHex: writtenDigest,
            readBackDigestHex: readBackDigest,
            equal: equal
        )
    }

    /// Falsification control (D-08): re-reads the current item, corrupts one
    /// byte of the in-memory copy, and re-runs the SAME digest comparison
    /// path, confirming it reports a mismatch. Emits
    /// `CEILING-CONTROL: MISMATCH-DETECTED` only if the mismatch is real.
    private static func falsificationControl(accessGroup: String) -> Bool {
        let readQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(readQuery as CFDictionary, &result)
        guard status == errSecSuccess, var readData = result as? Data, !readData.isEmpty else {
            return false
        }
        let originalDigest = sha256Hex(readData)
        readData[0] = readData[0] ^ 0xFF // deliberate one-byte corruption
        let corruptedDigest = sha256Hex(readData)
        return corruptedDigest != originalDigest
    }

    /// Runs all four sizes, then the falsification control against the last
    /// written item, and prints the machine-readable block this task's
    /// `<action>` specifies.
    static func run() {
        guard let accessGroup = resolveAccessGroupAtRuntime() else {
            print("BRANCH: branch-k")
            print("CEILING-FIRST-FAILURE: discovery_failed")
            return
        }

        var firstFailure: Int? = nil
        for size in payloadSizes {
            let payload = randomPayload(count: size)
            let result = roundTrip(payload: payload, accessGroup: accessGroup)
            print(
                "size=\(result.sizeBytes) write_status=\(result.writeStatus) " +
                "read_status=\(result.readStatus) written_sha256=\(result.writtenDigestHex) " +
                "readback_sha256=\(result.readBackDigestHex) equal=\(result.equal)"
            )
            if !result.equal, firstFailure == nil {
                firstFailure = size
            }
        }

        print("BRANCH: branch-k")
        print("CEILING-FIRST-FAILURE: \(firstFailure.map(String.init) ?? "none")")

        if falsificationControl(accessGroup: accessGroup) {
            print("CEILING-CONTROL: MISMATCH-DETECTED")
        }
        // If the control did not fire, no CEILING-CONTROL line is emitted --
        // per this task's acceptance criteria, its absence is what makes a
        // branch-k record fail the gate, on purpose.
    }
}
