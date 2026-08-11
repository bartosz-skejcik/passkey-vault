// KeychainProbe.swift -- Phase 36, Plan 36-02, Task 2 (E3).
//
// Extension-side half of the cross-process keychain sharing proof.
// Performs two queries, both logged from the READING side (QA-03):
//   (i)  the real query, under the shared access group -- logs OSStatus,
//        returned byte count, and a byte-for-byte `equal=true|false`
//        comparison against the same fixed test vector ProbeSeeder.swift
//        (host app) wrote. Never "non-nil", never length-only.
//   (ii) the mandatory negative control -- an otherwise identical query
//        under an access group this bundle does NOT declare, logging its
//        OSStatus so the record can assert it matches errSecMissingEntitlement
//        (-34018), the control that makes (i) mean anything
//        (36-RESEARCH.md "E3").
//
// The access group string is never an expanded literal (D-14, landmine
// L-8): it is discovered AT RUNTIME by round-tripping a throwaway keychain
// item with no access group specified and reading back which access group
// the OS assigned it to. There is no iOS-available SecTask API to read this
// bundle's own entitlements directly -- SecTaskCreateFromSelf /
// SecTaskCopyValueForEntitlement are macOS-only and absent from the iOS SDK
// Security.framework headers (verified this session: `SecTask.h` does not
// exist under the iphonesimulator SDK's Security.framework/Headers).

import Foundation
import Security
import os

enum KeychainProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// Fixed probe service name -- distinct from any real vault item.
    static let service = "cloud.blonie.PasskeyVault.probe.e3"

    /// Fixed, clearly-labelled 32-byte test vector. Never real key
    /// material: no `pv-ffi`/`FfiUserKey` call anywhere on this path.
    static let expectedTestVector: [UInt8] = (0..<32).map { UInt8($0) }

    /// Bundle-id-suffix component of the keychain access group -- this is
    /// NOT the team prefix (D-14 only forbids the expanded team-prefix
    /// literal); it is the same public bundle-id string already hardcoded
    /// throughout the project (Info.plist, entitlements files).
    private static let accessGroupSuffix = "cloud.blonie.PasskeyVault"

    /// Discovers this process's own default keychain access group AT
    /// RUNTIME: adds a throwaway item with NO access group specified (the
    /// OS assigns its default -- this bundle's sole `keychain-access-groups`
    /// entry, i.e. `$(AppIdentifierPrefix)cloud.blonie.PasskeyVault`
    /// expanded), then reads the assignment back via `kSecReturnAttributes`.
    /// Shared logic with ProbeSeeder.swift, duplicated rather than shared
    /// because the host app and the extension are separate build targets
    /// with no shared framework between them.
    private static func resolveAccessGroupAtRuntime() -> String? {
        let probeService = "cloud.blonie.PasskeyVault.probe.access-group-discovery.appex"
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
        guard addStatus == errSecSuccess else {
            logger.error("PVPROBE|stage=keychain-discovery add_status=\(addStatus, privacy: .public)")
            return nil
        }

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
        else {
            logger.error("PVPROBE|stage=keychain-discovery read_status=\(readStatus, privacy: .public)")
            return nil
        }
        return group
    }

    private static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[i] ^ b[i] }
        return diff == 0
    }

    /// Runs both queries and logs both from the reading side.
    static func emit() {
        guard let realGroup = resolveAccessGroupAtRuntime() else {
            logger.log("PVPROBE|stage=keychain status=discovery_failed bytes=0 equal=false")
            logger.log("PVPROBE|stage=keychain-negative status=discovery_failed")
            return
        }

        // (i) Positive query -- the receiver-side byte-for-byte assertion.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: realGroup,
            kSecReturnData as String: true
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        var bytes = 0
        var equal = false
        if status == errSecSuccess, let data = result as? Data {
            bytes = data.count
            equal = constantTimeEqual([UInt8](data), expectedTestVector)
        }
        logger.log(
            "PVPROBE|stage=keychain status=\(status, privacy: .public) bytes=\(bytes, privacy: .public) equal=\(equal, privacy: .public)"
        )

        // (ii) Mandatory negative control -- same discovered team prefix,
        // a suffix this bundle does not declare in keychain-access-groups.
        if realGroup.hasSuffix(accessGroupSuffix) {
            let prefix = String(realGroup.dropLast(accessGroupSuffix.count))
            let bogusGroup = prefix + "cloud.blonie.NotOurs"
            let negQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccessGroup as String: bogusGroup,
                kSecReturnData as String: true
            ]
            var negResult: CFTypeRef?
            let negStatus = SecItemCopyMatching(negQuery as CFDictionary, &negResult)
            logger.log("PVPROBE|stage=keychain-negative status=\(negStatus, privacy: .public)")
        } else {
            logger.error(
                "PVPROBE|stage=keychain-negative status=skipped_prefix_mismatch discovered=\(realGroup, privacy: .public)"
            )
        }
    }
}
