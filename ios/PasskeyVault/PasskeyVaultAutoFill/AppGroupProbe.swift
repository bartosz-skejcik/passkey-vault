// AppGroupProbe.swift -- Phase 36, Plan 36-02, Task 1 (E2).
//
// Inside view of the App Group container question (36-RESEARCH.md "E2").
// Calls FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)
// from WITHIN the running extension process -- a positive assertion made by
// the process that will actually depend on this container, not an inference
// drawn for it (D-02, QA-03, D-09). It then writes and immediately reads
// back a small fixed byte sequence inside that container and logs a
// roundtrip=ok|fail field.
//
// The group identifier lives in exactly ONE Swift constant here, mirroring
// `com.apple.security.application-groups` in both PasskeyVault.entitlements
// and PasskeyVaultAutoFill.entitlements -- never an expanded literal (D-14).

import Foundation
import os

enum AppGroupProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// Mirrors `com.apple.security.application-groups` in both
    /// entitlements files. This identifier needs no runtime resolution
    /// (unlike the keychain access group, D-14/L-8): App Group identifiers
    /// carry no team-prefix expansion, so the same literal string is valid
    /// in both source and the entitlements plist.
    static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    private static let roundtripFileName = "appgroup-probe.bin"
    /// Fixed, clearly-labelled marker bytes ("PVAG" + 4 sentinel bytes) --
    /// never real vault data, never a pv-ffi output.
    private static let roundtripPayload: [UInt8] = [0x50, 0x56, 0x41, 0x47, 0x01, 0x02, 0x03, 0x04]

    /// Emits exactly one `PVPROBE|stage=appgroup` line: the resolved
    /// container path (or an explicit `resolved=nil` marker) and the
    /// write-then-read-back roundtrip result.
    static func emit() {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else {
            logger.log("PVPROBE|stage=appgroup resolved=nil roundtrip=fail")
            return
        }

        let fileURL = containerURL.appendingPathComponent(roundtripFileName)
        var roundtrip = "fail"
        do {
            let data = Data(roundtripPayload)
            try data.write(to: fileURL, options: .atomic)
            let readBack = try Data(contentsOf: fileURL)
            roundtrip = (readBack == data) ? "ok" : "fail"
        } catch {
            logger.error("PVPROBE|stage=appgroup roundtrip_error=\(String(describing: error), privacy: .public)")
        }

        logger.log(
            "PVPROBE|stage=appgroup resolved=\(containerURL.path, privacy: .public) roundtrip=\(roundtrip, privacy: .public)"
        )
    }
}
