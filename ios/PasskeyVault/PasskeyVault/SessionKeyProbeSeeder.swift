// SessionKeyProbeSeeder.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-01, Task 2 (E41-1).
//
// Host-side half of the cross-process silent-read proof (SessionKeyProbe.swift is the extension
// half). Writes a FIXED, clearly-labelled 32-byte test vector into the REAL Phase-37 User Key
// envelope location, through `UkEnvelopeStore.store(_:)` ITSELF -- the actual production writer
// (ACC-03, `ios/IOS-SPIKE-LOG.md:353-409`, cited in branch-state.md's B4 row) -- never a
// re-derived query. Unlike `KeychainProbe.swift`/`ProbeSeeder.swift` (Phase 36 E3, which
// duplicated the query shape on both sides because the probe's own service name
// `cloud.blonie.PasskeyVault.probe.e3` never overlaps production code), this seeder deliberately
// calls the REAL `UkEnvelopeStore.store(_:)` because E41-1's own precondition requires reading
// "Phase-37's User-Key Keychain artifact", not a probe-scoped stand-in -- and `UkEnvelopeStore`
// lives in this same host-app target, so there is no cross-target duplication to avoid.
//
// NEVER real key material: no `FfiUserKey`/`pv-ffi` call anywhere on this path (same E3
// discipline, `ProbeSeeder.swift`'s own header). The bytes are a fixed, deterministic 32-byte
// pattern distinguishable from `ProbeSeeder`'s own `0..<32` vector (E3's own probe uses that
// exact sequence for a DIFFERENT, non-ACL-gated item) -- collision would not corrupt anything
// (different `kSecAttrService` values), but a distinct pattern keeps the two probes' evidence
// visually unambiguous in a shared log stream.
//
// This is deviation Rule 2 (auto-add missing critical functionality, GSD executor rules): without
// a host-side write, E41-1's own stated precondition -- "Phase 37's User-Key Keychain artifact
// exists and has been written at least once by the host app" -- can never be satisfied, and
// SessionKeyProbe's three reads would all observe `errSecItemNotFound`, an uninterpretable
// non-verdict. 41-01-PLAN.md's own `files_modified` list did not name this file; it is added here
// because the task is otherwise unexecutable, and is documented as a deviation in
// 41-01-SUMMARY.md, not silently introduced.

import CryptoKit
import Foundation
import os

enum SessionKeyProbeSeeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Fixed, clearly-labelled 32-byte test vector. Never real key material -- no
    /// `pv-ffi`/`FfiUserKey` call anywhere on this path. Distinct from `ProbeSeeder.testVector`'s
    /// `0..<32` sequence (a different, non-ACL-gated Keychain item, Phase 36 E3) so the two
    /// probes' log lines are never confusable by digest alone.
    static let testVector: [UInt8] = (0..<32).map { UInt8(0xA0 &+ UInt8($0)) }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Writes `testVector` through the REAL production writer
    /// (`UkEnvelopeStore.store(_:)`, `ios/PasskeyVault/PasskeyVault/Core/Keychain/
    /// UkEnvelopeStore.swift:81-100`) -- the exact ACC-03-shaped item (`kSecClassGenericPassword`,
    /// `kSecAttrService = "cloud.blonie.PasskeyVault.uk-envelope"`,
    /// `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` + `[.biometryCurrentSet]` via
    /// `SecAccessControlCreateWithFlags`) -- then logs the SHA-256 digest of what it wrote. NEVER
    /// logs the bytes themselves (T-41-01).
    static func seed() {
        do {
            try UkEnvelopeStore.store(Data(testVector))
            logger.log(
                "PVFILL|E41-1|stage=seed status=ok len=\(testVector.count, privacy: .public) digest=\(sha256Hex(Data(testVector)), privacy: .public)"
            )
        } catch {
            logger.error("PVFILL|E41-1|stage=seed status=error error=\(String(describing: error), privacy: .public)")
        }
    }
}
