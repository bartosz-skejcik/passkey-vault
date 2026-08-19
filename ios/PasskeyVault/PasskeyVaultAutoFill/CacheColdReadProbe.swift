// CacheColdReadProbe.swift -- Phase 39 (synchronizacja-i-cache-offline),
// Plan 39-07, Task 1 (E-C1/E-C3, SYNC-02).
//
// The claim no client in this product has proven before: a snapshot written
// by the HOST process is readable, cold, by a SECOND, independently
// scheduled process (D-16 sibling -- 39-02 already fixed which sentence this
// phase is permitted to close on; this file supplies the observation that
// sentence transcribes). Decrypts NOTHING and holds no key -- computes a
// SHA-256 over the exact bytes on disk and reports the item count/watermark
// alongside it. FILL-05 (real decrypt inside the extension) is Phase 41's;
// a `#if PV_PROBE_COLDREAD` call anywhere near a decrypt entry point in this
// file would be the exact prohibition this plan's own threat register names
// (T-39-30).
//
// RAW FILE READ, DELIBERATELY NOT
// `CiphertextCacheStore.readCurrentSnapshot(accountId:)`: that production
// method rejects a snapshot whose `accountId` does not match the caller's
// (D-19) -- correct for the real app, but this extension carries no
// session/account context in this milestone (FILL-03's identity-store hook
// is still unimplemented, D-22). This probe proves BYTE REACHABILITY, not
// the account-scoped read path, so it resolves the App Group container and
// reads `AppGroupCiphertextCacheStore.fileName` directly. The digest is
// computed over the RAW bytes, before any JSON decode -- decoding is only
// attempted afterward, to report the item count/`syncedAtMs` alongside the
// digest, never in place of it.
//
// THE MANDATORY WRONG-IDENTIFIER NEGATIVE CONTROL (E-C1): the same read,
// repeated against a sharing identifier this bundle does NOT declare in its
// entitlements. `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`
// returning nil for an undeclared identifier IS the platform's enforcement
// (`AppGroupProbe.swift`'s own `resolved=nil` case, Phase 36 E2) -- if it
// instead resolved, the positive read above would prove nothing about what
// protected it.
//
// THE DELETED-CACHE CONTROL is not a second method here: calling
// `runPositiveAndNegativeControl()` again after the driving script has
// removed the cache file produces `status=absent` on its own, by
// construction -- proving the reader reads STORAGE, not an in-process copy
// that survived from the first call (this file carries no cache of its
// own; every call re-reads disk).

import CryptoKit
import Foundation
import os

enum CacheColdReadProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// A sharing identifier this bundle does NOT declare in
    /// `PasskeyVaultAutoFill.entitlements` -- never the real
    /// `AppGroupCiphertextCacheStore.groupIdentifier` plus a suffix that
    /// could be confused for it, matching `KeychainProbe`'s own "…NotOurs"
    /// convention (36-02, E3).
    private static let undeclaredGroupIdentifier = "group.cloud.blonie.PasskeyVault.NeverDeclared"

    private enum RawReadResult {
        /// `containerURL(forSecurityApplicationGroupIdentifier:)` itself
        /// returned nil -- the identifier is not one this process is
        /// entitled to.
        case resolveFailed
        /// The container resolved, but no cache file exists there.
        case absent
        /// A file exists but did not decode as `CachedSnapshot` -- recorded
        /// distinctly, never folded into either "present" or "absent".
        case presentButUndecodable(digest: String)
        case present(digest: String, itemCount: Int, syncedAtMs: Int64)
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func readRaw(groupIdentifier: String) -> RawReadResult {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else {
            return .resolveFailed
        }
        let fileURL = containerURL.appendingPathComponent(AppGroupCiphertextCacheStore.fileName)
        guard let data = try? Data(contentsOf: fileURL) else {
            return .absent
        }
        let digest = sha256Hex(data)
        guard let snapshot = try? JSONDecoder().decode(CachedSnapshot.self, from: data) else {
            return .presentButUndecodable(digest: digest)
        }
        return .present(digest: digest, itemCount: snapshot.items.count, syncedAtMs: snapshot.syncedAtMs)
    }

    /// One call's worth of both halves (positive read + the mandatory
    /// wrong-identifier negative control), machine-readable -- written to
    /// the App Group container as a small marker file under
    /// `PV_PROBE_COLDREAD` (Task 1/2's own evidence sequence,
    /// `CredentialProviderViewController.swift`) so the driving script can
    /// poll for its EXISTENCE as a coordination signal, more robust than
    /// racing `log stream`'s own attach latency (`scripts
    /// /ios-ws-push-proof.sh`'s own documented `sleep 1` workaround for
    /// exactly that race -- this file's marker-file channel does not need
    /// it). The `PVPROBE|` log lines below still fire too, for the same
    /// human-readable record every other probe in this codebase carries.
    struct ColdReadOutcome: Codable {
        let status: String // "present" | "absent" | "present_undecodable" | "resolve_failed"
        let digest: String?
        let itemCount: Int?
        let syncedAtMs: Int64?
        let negativeStatus: String
    }

    /// Positive read (real, declared group identifier) + the mandatory
    /// wrong-identifier negative control -- `KeychainProbe.emit()`'s own
    /// established shape (36-02, E3), reused here for the App Group case.
    /// Call this AGAIN after the driving script deletes the cache file to
    /// get the deleted-cache control's own `status=absent` outcome -- no
    /// separate method, see this file's header.
    @discardableResult
    static func runPositiveAndNegativeControl() -> ColdReadOutcome {
        var status = ""
        var digest: String?
        var itemCount: Int?
        var syncedAtMs: Int64?
        switch readRaw(groupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier) {
        case .resolveFailed:
            status = "resolve_failed"
            logger.error("PVPROBE|stage=coldread status=resolve_failed")
        case .absent:
            status = "absent"
            logger.log("PVPROBE|stage=coldread status=absent")
        case let .presentButUndecodable(d):
            status = "present_undecodable"
            digest = d
            logger.error("PVPROBE|stage=coldread status=present_undecodable digest=\(d, privacy: .public)")
        case let .present(d, count, ts):
            status = "present"
            digest = d
            itemCount = count
            syncedAtMs = ts
            logger.log(
                "PVPROBE|stage=coldread status=present digest=\(d, privacy: .public) items=\(count, privacy: .public) syncedAtMs=\(ts, privacy: .public)"
            )
        }

        // Negative control: same file name, an UNDECLARED sharing
        // identifier. Only `resolve_failed` is the expected/passing
        // outcome -- anything else means the boundary was not enforced on
        // this setup, and is logged as an ERROR line so it is impossible
        // to mistake for a clean pass while reading the raw log.
        var negativeStatus = ""
        switch readRaw(groupIdentifier: undeclaredGroupIdentifier) {
        case .resolveFailed:
            negativeStatus = "resolve_failed"
            logger.log("PVPROBE|stage=coldread-negative status=resolve_failed")
        case .absent:
            negativeStatus = "unexpectedly_reachable_absent"
            logger.error("PVPROBE|stage=coldread-negative status=unexpectedly_reachable_absent")
        case .presentButUndecodable:
            negativeStatus = "unexpectedly_reachable_undecodable"
            logger.error("PVPROBE|stage=coldread-negative status=unexpectedly_reachable_undecodable")
        case .present:
            negativeStatus = "unexpectedly_reachable_present"
            logger.error("PVPROBE|stage=coldread-negative status=unexpectedly_reachable_present")
        }

        return ColdReadOutcome(
            status: status, digest: digest, itemCount: itemCount, syncedAtMs: syncedAtMs, negativeStatus: negativeStatus
        )
    }

    /// Writes `outcome`/`text` into the App Group container under `name` --
    /// the evidence-sequence coordination channel described on
    /// `ColdReadOutcome`'s own header. `PV_PROBE_COLDREAD`-only callers.
    static func writeMarker(_ outcome: ColdReadOutcome, name: String) {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
        ), let data = try? JSONEncoder().encode(outcome) else { return }
        try? data.write(to: containerURL.appendingPathComponent(name), options: .atomic)
    }

    static func writeMarker(text: String, name: String) {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
        ) else { return }
        try? text.data(using: .utf8)?.write(to: containerURL.appendingPathComponent(name), options: .atomic)
    }

    /// Exposed for the freshness surface (Task 2): the real group
    /// identifier's current `syncedAtMs`, or `nil` if absent/unreadable.
    /// Reuses `readRaw` rather than a second read implementation -- D-11's
    /// "no second copy" discipline, extended to this probe's own
    /// consumers.
    static func currentSyncedAtMs() -> Int64? {
        if case let .present(_, _, syncedAtMs) = readRaw(groupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier) {
            return syncedAtMs
        }
        return nil
    }
}
