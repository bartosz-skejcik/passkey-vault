// ProbeSeeder.swift -- Phase 36, Plan 36-02, Task 2 (E3).
//
// Host-side half of the cross-process keychain sharing proof. Writes a
// fixed, clearly-labelled 32-byte TEST VECTOR (never real key material, no
// pv-ffi call on this path) into the shared keychain access group, so
// KeychainProbe.swift (the extension) can read it back and compare
// byte-for-byte (QA-03).
//
// The access group string is never an expanded literal (D-14, landmine
// L-8): it is discovered AT RUNTIME by round-tripping a throwaway keychain
// item with no access group specified and reading back which access group
// the OS assigned it to -- see the header comment on KeychainProbe.swift's
// `resolveAccessGroupAtRuntime()` for why (no iOS-available SecTask API).

import Foundation
import Security
import os

enum ProbeSeeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// Fixed probe service name -- must match KeychainProbe.service.
    static let service = "cloud.blonie.PasskeyVault.probe.e3"

    /// Fixed, clearly-labelled 32-byte test vector. Never real key
    /// material: no `pv-ffi`/`FfiUserKey` call anywhere on this path. Must
    /// match KeychainProbe.expectedTestVector.
    static let testVector: [UInt8] = (0..<32).map { UInt8($0) }

    /// Duplicated from KeychainProbe.swift (separate build target, no
    /// shared framework between host app and extension).
    private static func resolveAccessGroupAtRuntime() -> String? {
        let probeService = "cloud.blonie.PasskeyVault.probe.access-group-discovery.host"
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
            logger.error("PVPROBE|stage=seed-discovery add_status=\(addStatus, privacy: .public)")
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
            logger.error("PVPROBE|stage=seed-discovery read_status=\(readStatus, privacy: .public)")
            return nil
        }
        return group
    }

    /// Deletes any prior probe item and adds the fixed test vector under
    /// the shared keychain access group. Logs the OSStatus of both
    /// operations under `PVPROBE|stage=seed`.
    static func seed() {
        guard let accessGroup = resolveAccessGroupAtRuntime() else {
            logger.log("PVPROBE|stage=seed delete_status=n/a add_status=discovery_failed")
            return
        }

        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup
        ]
        let deleteStatus = SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: Data(testVector)
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

        logger.log(
            "PVPROBE|stage=seed delete_status=\(deleteStatus, privacy: .public) add_status=\(addStatus, privacy: .public) access_group=\(accessGroup, privacy: .public)"
        )
    }
}
