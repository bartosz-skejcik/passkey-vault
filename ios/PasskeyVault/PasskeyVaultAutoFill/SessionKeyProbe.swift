// SessionKeyProbe.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-01, Task 2 (E41-1).
//
// The sole input DR-41-A needs: can the extension read the REAL Phase-37 User Key envelope
// (ACC-03, `UkEnvelopeStore`, cited in ios/evidence/41/branch-state.md's B4 row) WITHOUT UI?
// Three reads, all against the SAME artifact -- the same `kSecClass`/`kSecAttrService` pair
// `UkEnvelopeStore.swift` writes with (branch-state.md B4: `kSecClassGenericPassword` /
// `"cloud.blonie.PasskeyVault.uk-envelope"`, no explicit access group in the query, relying on
// this bundle's sole declared `keychain-access-groups` entry) -- duplicated here rather than
// imported, because the extension and the host app are separate build targets with no shared
// framework between them (`KeychainProbe.swift`'s own header, same discipline, Phase 36 E3):
//
//   (1) silent  -- `LAContext.interactionNotAllowed = true`, via `kSecUseAuthenticationContext`.
//                  `errSecInteractionNotAllowed` (-25308) is the expected "would have prompted"
//                  signal; `errSecSuccess` means the read completed with NO UI at all.
//   (2) no-context -- the identical query with NO `kSecUseAuthenticationContext` key at all,
//                  mirroring Phase 37's own E2 methodology exactly
//                  (`ios/IOS-SPIKE-LOG.md:1962-1979`: "SecItemCopyMatching with kSecReturnData:
//                  true and NO LAContext at all").
//   (3) negative control -- the identical query under a DELIBERATELY WRONG access group. Must
//                  report `errSecMissingEntitlement` (-34018) or every verdict above means
//                  nothing (Pitfall 5, branch-state.md's own closing section): access-group
//                  scoping is the ONE enforcement mechanism this harness's E2 result
//                  (`ios/IOS-SPIKE-LOG.md:1962-1979`) did not already show unenforced.
//
// NEVER logs key bytes. The SHA-256 digest is the comparison channel -- `SessionKeyProbeSeeder`
// (host app, `ios/PasskeyVault/PasskeyVault/SessionKeyProbeSeeder.swift`) logs the digest of the
// FIXED, clearly-labelled 32-byte test vector it wrote via the REAL production writer
// (`UkEnvelopeStore.store(_:)`), and this probe logs the digest of whatever it reads back, so
// `scripts/ios-autofill-e41.sh e41-1`'s comparison is receiver-side and byte-exact without either
// process ever printing the secret itself (QA-03). A non-nil result or a length-32 result is
// never accepted as the proof -- only an equal digest pair is.
//
// Access group derivation: the real access group is discovered AT RUNTIME (no iOS-available
// SecTask API exists to read this bundle's own entitlements directly -- `KeychainProbe.swift`'s
// own header), then the wrong one for the negative control is built by swapping the suffix, the
// SAME technique `KeychainProbe.swift`'s own negative control already uses. Never an expanded
// team-prefix literal anywhere in this file (landmine L-8).
//
// Log contract: os_log subsystem `cloud.blonie.PasskeyVault`, category `fill`, marker prefix
// `PVFILL|E41-1|` -- this phase's own log contract (41-01-PLAN.md "Artifacts this phase produces
// (this plan's share)"), distinct from Phase 36-40's `PVPROBE|`/category `probe` convention.

import CryptoKit
import Foundation
import LocalAuthentication
import Security
import os

enum SessionKeyProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Must match `UkEnvelopeStore.service` (`ios/PasskeyVault/PasskeyVault/Core/Keychain/
    /// UkEnvelopeStore.swift:36`) EXACTLY -- branch-state.md's own B4 row states the whole
    /// verdict is void if this probe measures a different item.
    private static let service = "cloud.blonie.PasskeyVault.uk-envelope"

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Mirrors `UkEnvelopeStore.baseQuery` exactly (`UkEnvelopeStore.swift:63-69`): no explicit
    /// `kSecAttrAccessGroup` -- this item resolves to the bundle's sole declared access group by
    /// default, same as the real writer/reader do.
    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Duplicated from `KeychainProbe.swift` (separate build target, no shared framework):
    /// discovers this process's own default keychain access group AT RUNTIME by round-tripping a
    /// throwaway item with no access group specified, then reading back which access group the OS
    /// assigned it to.
    private static func resolveAccessGroupAtRuntime() -> String? {
        let probeService = "cloud.blonie.PasskeyVault.probe.access-group-discovery.e41-1"
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: probeService,
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: probeService,
            kSecValueData as String: Data([0x00]),
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            logger.error("PVFILL|E41-1|stage=discovery add_status=\(addStatus, privacy: .public)")
            return nil
        }

        let readQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: probeService,
            kSecReturnAttributes as String: true,
        ]
        var result: CFTypeRef?
        let readStatus = SecItemCopyMatching(readQuery as CFDictionary, &result)
        SecItemDelete(deleteQuery as CFDictionary)
        guard readStatus == errSecSuccess,
              let attrs = result as? [String: Any],
              let group = attrs[kSecAttrAccessGroup as String] as? String
        else {
            logger.error("PVFILL|E41-1|stage=discovery read_status=\(readStatus, privacy: .public)")
            return nil
        }
        return group
    }

    /// (1) The silent probe: `LAContext.interactionNotAllowed = true`.
    private static func readSilent() {
        let context = LAContext()
        context.interactionNotAllowed = true
        defer { context.invalidate() }

        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data {
            logger.log(
                "PVFILL|E41-1|stage=silent status=\(status, privacy: .public) len=\(data.count, privacy: .public) digest=\(sha256Hex(data), privacy: .public)"
            )
        } else {
            logger.log("PVFILL|E41-1|stage=silent status=\(status, privacy: .public) len=0 digest=n/a")
        }
    }

    /// (2) The identical query with NO `kSecUseAuthenticationContext` key at all -- mirrors Phase
    /// 37's own E2 methodology (`ios/IOS-SPIKE-LOG.md:1962-1979`), never
    /// `interactionNotAllowed = false` on a supplied context, which would be a DIFFERENT query
    /// shape than the one E2 already measured.
    private static func readNoContext() {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data {
            logger.log(
                "PVFILL|E41-1|stage=nocontext status=\(status, privacy: .public) len=\(data.count, privacy: .public) digest=\(sha256Hex(data), privacy: .public)"
            )
        } else {
            logger.log("PVFILL|E41-1|stage=nocontext status=\(status, privacy: .public) len=0 digest=n/a")
        }
    }

    /// (3) The mandatory negative control: the identical query under a DELIBERATELY WRONG access
    /// group. MUST report -34018 or every verdict above is uninterpretable (branch-state.md's own
    /// closing section, Pitfall 5).
    private static func negativeControl(realGroup: String) {
        let suffix = "cloud.blonie.PasskeyVault"
        guard realGroup.hasSuffix(suffix) else {
            logger.error(
                "PVFILL|E41-1|stage=negative-control status=skipped_prefix_mismatch discovered=\(realGroup, privacy: .public)"
            )
            return
        }
        let prefix = String(realGroup.dropLast(suffix.count))
        let bogusGroup = prefix + "cloud.blonie.NotOurs"

        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecAttrAccessGroup as String] = bogusGroup

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        logger.log("PVFILL|E41-1|stage=negative-control status=\(status, privacy: .public)")
    }

    /// Entry point, compiled only under `PV_PROBE_SESSIONKEY`, dispatched from
    /// `CredentialProviderViewController.prepareInterfaceForExtensionConfiguration()` -- the one
    /// stage `AutoFillInvocationUITests` reliably reaches without the provider already being
    /// elected, exactly where every other Phase 36-40 `PV_PROBE_*`/diagnostic probe is dispatched.
    static func run() {
        guard let realGroup = resolveAccessGroupAtRuntime() else {
            logger.log("PVFILL|E41-1|stage=silent status=discovery_failed len=0 digest=n/a")
            logger.log("PVFILL|E41-1|stage=nocontext status=discovery_failed len=0 digest=n/a")
            logger.log("PVFILL|E41-1|stage=negative-control status=discovery_failed")
            return
        }
        readSilent()
        readNoContext()
        negativeControl(realGroup: realGroup)
    }
}
