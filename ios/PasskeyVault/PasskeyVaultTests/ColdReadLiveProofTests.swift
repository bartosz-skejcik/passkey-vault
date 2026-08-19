//
//  ColdReadLiveProofTests.swift
//  PasskeyVaultTests
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-07, Task 1's host-side
//  half (SYNC-02, E-C1/E-C3). NOT in this plan's own `files_modified` list
//  -- added because the plan's own acceptance criteria (a REAL, externally
//  terminable host process; `simctl terminate`/`launchctl list` confirming
//  its absence; a write digest computed independently of the read) cannot
//  be produced by any file already in this repository without one of two
//  changes: modifying `LiveSyncProbe.swift` (39-04's own, narrowly-scoped
//  WS-push hook) to serve a second, unrelated purpose, or adding this file.
//  Documented as a deviation (Rule 2 -- necessary functionality) in this
//  plan's own SUMMARY.
//
//  Driven by `scripts/ios-cold-read-proof.sh`, which owns: the isolated
//  server, the web-authored fixture item (real `pv-wasm`, matching every
//  prior interop script in this phase), the pinned evidence `reference`
//  instant (`PV_COLDREAD_REFERENCE_MS` here; the SAME literal is also
//  written into the App Group container as `freshness-reference.txt` for
//  `CredentialProviderViewController`'s own evidence sequence to read on
//  the extension side -- ONE coordinated clock, not two independent
//  `Date()` reads separated by however long a real cold-read proof takes),
//  the `simctl terminate`/`launchctl list` sequence this file's own HOLD
//  makes possible, and the resulting evidence file
//  (`ios/evidence/39/07-cold-read.md`).
//
//  WHY A HOSTED UNIT TEST, NOT `xcrun simctl launch` (unlike
//  `LiveSyncProbe.swift`'s WS-push proof, 39-04): this file's own HOLD
//  keeps a REAL, externally-terminable process alive for exactly as long as
//  the driving script needs it. `xcodebuild test`'s "Host Application"
//  mechanism launches the actual `cloud.blonie.PasskeyVault` process on the
//  simulator for the duration of the test method -- visible to `launchctl
//  list` and killable by `simctl terminate` from outside, precisely the
//  proof E-C3/SC2's fixed sentence (`ios/evidence/39/02-branch-gate.md`)
//  names. The test method is EXPECTED to be killed mid-HOLD by the driving
//  script; that termination is the point, not a failure to route around --
//  `scripts/ios-cold-read-proof.sh` never asserts this test's own
//  `xcodebuild test` invocation exits 0.
//

import CryptoKit
import Foundation
import Testing
@testable import PasskeyVault

struct ColdReadLiveProofTests {
    private enum ProofError: Error, CustomStringConvertible {
        case missingEnvironmentVariables(String)
        case invalidReference(String)
        case noItemsAfterFirstPull

        var description: String {
            switch self {
            case let .missingEnvironmentVariables(keys):
                return "ColdReadLiveProofTests requires \(keys) -- set by scripts/ios-cold-read-proof.sh"
            case let .invalidReference(raw):
                return "PV_COLDREAD_REFERENCE_MS is not a valid Int64: \(raw.debugDescription)"
            case .noItemsAfterFirstPull:
                return "the first refresh() produced no items -- the web-authored row never arrived"
            }
        }
    }

    private static var baseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// Plain name first, then `TEST_RUNNER_`-prefixed -- this repo's
    /// established `env()` helper convention
    /// (`SyncTracerLiveProofTests.swift`, `FreshnessLiveProofTests.swift`).
    private static func env(_ key: String) -> String? {
        if let v = ProcessInfo.processInfo.environment[key], !v.isEmpty { return v }
        if let v = ProcessInfo.processInfo.environment["TEST_RUNNER_\(key)"], !v.isEmpty { return v }
        return nil
    }

    private static func requireEnv(_ keys: [String]) throws -> [String: String] {
        var found: [String: String] = [:]
        var missing: [String] = []
        for key in keys {
            if let v = env(key) { found[key] = v } else { missing.append(key) }
        }
        guard missing.isEmpty else {
            let joined = missing.joined(separator: ", ")
            Issue.record("missing required env vars: \(joined)")
            throw ProofError.missingEnvironmentVariables(joined)
        }
        return found
    }

    private static func appGroupContainerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier)
    }

    /// Writes the host's own rendered freshness line into the App Group
    /// container -- the SAME "shared storage as the channel" technique
    /// `FreshnessLiveProofTests.writeProbe` already established (39-06),
    /// reused (not re-derived) for a value the extension-side half of this
    /// plan reads back and compares against.
    private static func writeFreshnessProbe(rendered: String, syncedAtMs: Int64) throws {
        guard let container = appGroupContainerURL() else { return }
        let payload: [String: Any] = ["rendered": rendered, "syncedAtMs": syncedAtMs]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        try data.write(to: container.appendingPathComponent("coldread-freshness-host.json"), options: .atomic)
    }

    @Test func establishHostCacheAndHoldForExternalTermination() async throws {
        let vars = try Self.requireEnv([
            "PV_COLDREAD_EMAIL", "PV_COLDREAD_ACCOUNT_PASSWORD", "PV_COLDREAD_REFERENCE_MS",
        ])
        let email = vars["PV_COLDREAD_EMAIL"]!
        let accountPassword = vars["PV_COLDREAD_ACCOUNT_PASSWORD"]!
        let referenceRaw = vars["PV_COLDREAD_REFERENCE_MS"]!
        guard let referenceMs = Int64(referenceRaw) else {
            Issue.record("PV_COLDREAD_REFERENCE_MS is not a valid Int64: \(referenceRaw.debugDescription)")
            throw ProofError.invalidReference(referenceRaw)
        }
        let reference = Date(timeIntervalSince1970: Double(referenceMs) / 1000)

        // Purge first: this simulator's App Group container is shared
        // across every run this session -- SyncTracerLiveProofTests.swift's
        // own established discipline, reused verbatim.
        AppGroupCiphertextCacheStore().purge()

        // ---- sign in through the REAL production path -----------------
        // (the driving script registers this account AND authors one item
        // via the real pv-wasm artifact BEFORE this test runs, matching
        // scripts/ios-sync-live-proof.sh's own author.mjs technique.)
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.signIn(email: email, password: accountPassword)
        #expect(!session.token.isEmpty)
        #expect(session.email == email)

        let store = await MainActor.run {
            VaultStore(
                userKey: session.userKey,
                api: VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token }),
                accountId: session.email,
                cacheStore: AppGroupCiphertextCacheStore()
            )
        }

        // ---- first pull: at least one item must arrive and persist ----
        try await store.refresh()
        let items = await store.items
        guard !items.isEmpty else {
            throw ProofError.noItemsAfterFirstPull
        }
        #expect(items.count >= 1, "the cold-read proof needs at least one item in the persisted cache")

        let syncedAtMs = try #require(
            await MainActor.run { store.currentSnapshot?.syncedAtMs },
            "the first pull must have persisted a real cache with a syncedAtMs"
        )
        let rendered = SyncFreshness.describe(syncedAtMs: syncedAtMs, reference: reference)
        try Self.writeFreshnessProbe(rendered: rendered, syncedAtMs: syncedAtMs)

        // ---- HOLD: the driving script polls for `coldread-freshness-
        // host.json` to confirm the write above landed, then captures the
        // BEFORE `launchctl list` output, independently computes its own
        // SHA-256 over the raw persisted cache file, issues `xcrun simctl
        // terminate`, and captures the AFTER `launchctl list` output -- all
        // while this test sits here. Being killed mid-sleep is the
        // expected, load-bearing outcome (this file's own header); it is
        // not a bug to route around.
        try await Task.sleep(nanoseconds: 35_000_000_000)
    }
}
