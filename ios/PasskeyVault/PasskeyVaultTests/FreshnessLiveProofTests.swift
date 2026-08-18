//
//  FreshnessLiveProofTests.swift
//  PasskeyVaultTests
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-06, Task 2 (E-F1).
//
//  Driven by `scripts/ios-freshness-e-f1-proof.sh`, which owns the server
//  lifecycle: it starts an isolated `pv-server`, runs the BASELINE method
//  below, reads the persisted `syncedAtMs` straight off the App Group
//  container (the same host-read technique `SyncTracerLiveProofTests`
//  already established), stops the server for real (SIGTERM to the PID
//  `lsof` reports bound to the port -- an external action, never a flag in
//  this file), then runs the AFTER-STOP method below, and reads the SAME
//  file again to compare (D-07: a positive comparison of two captured
//  values, never "no error appeared").
//
//  TWO SEPARATE PROCESSES, ONE PERSISTED FILE. `establishABaselineWithAConfirmedPull`
//  and `aForcedPullAgainstAStoppedServerLeavesTheCacheUntouched` are
//  independent `xcodebuild test` invocations sharing nothing but the
//  App Group container and a `accountId` the driving script fixes in
//  advance (`PV_FRESHNESS_ACCOUNT_ID`). The AFTER method deliberately does
//  NOT sign in -- it cannot, the server is down by the time it runs -- and
//  does not need to: `VaultStore.refresh()`'s pre-flight guard only checks
//  `userKey != nil`, and decrypt is never reached on a path that throws
//  before the response arrives, so a freshly generated, functionally
//  unrelated `FfiUserKey` is sufficient. What matters is the `accountId`
//  matching the baseline's, so `hydrateFromCache()` reads the SAME
//  snapshot the baseline pull persisted (D-19's own account check).
//
//  RENDERED-STRING METHODOLOGY, stated plainly: both methods compute
//  `SyncFreshness.describe(syncedAtMs:reference:)` with `reference` PINNED
//  to the synced instant itself (elapsed = 0), not to "now". Two
//  independent process invocations, separated by however long the host
//  script's kill sequence and the second `xcodebuild test` launch take,
//  would otherwise risk the RELATIVE phrase crossing a minute boundary
//  between captures for reasons that have nothing to do with whether the
//  freshness value moved -- a false failure this design avoids by
//  construction, while still calling the real production formatter.
//

import Foundation
import Testing
@testable import PasskeyVault

struct FreshnessLiveProofTests {
    private enum ProofError: Error, CustomStringConvertible {
        case missingEnvironmentVariable(String)
        case appGroupContainerUnavailable
        case noSnapshotAfterConfirmedPull

        var description: String {
            switch self {
            case let .missingEnvironmentVariable(key):
                return "FreshnessLiveProofTests requires \(key) -- set by scripts/ios-freshness-e-f1-proof.sh"
            case .appGroupContainerUnavailable:
                return "the App Group container did not resolve -- Branch H (DR-1) is not available on this run"
            case .noSnapshotAfterConfirmedPull:
                return "no CachedSnapshot was persisted after a pull the server answered"
            }
        }
    }

    private static var baseURL: URL {
        let raw = env("PV_TEST_SERVER") ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// Plain name first, then `TEST_RUNNER_`-prefixed -- `xcodebuild test`
    /// forwards one or the other depending on version (established by
    /// `SyncTracerLiveProofTests.env`, reproduced here).
    private static func env(_ key: String) -> String? {
        if let v = ProcessInfo.processInfo.environment[key], !v.isEmpty { return v }
        if let v = ProcessInfo.processInfo.environment["TEST_RUNNER_\(key)"], !v.isEmpty { return v }
        return nil
    }

    private static func requireEnv(_ key: String) throws -> String {
        guard let v = env(key) else {
            Issue.record("missing required env var: \(key)")
            throw ProofError.missingEnvironmentVariable(key)
        }
        return v
    }

    private static func appGroupContainerURL() throws -> URL {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
            )
        else {
            throw ProofError.appGroupContainerUnavailable
        }
        return container
    }

    /// Writes a small, human/`jq`-readable JSON probe into the App Group
    /// container -- the same directory the driving script already resolves
    /// via `simctl get_app_container ... groups` to read the production
    /// cache file, so no new host-side resolution technique is needed.
    private static func writeProbe(name: String, ts: Int64?, rendered: String) throws {
        let container = try appGroupContainerURL()
        let payload: [String: Any] = ["ts": ts ?? NSNull(), "rendered": rendered]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        try data.write(to: container.appendingPathComponent(name), options: .atomic)
    }

    /// `reference` pinned to the synced instant -- see this file's own
    /// header on why (removes cross-process wall-clock flakiness from the
    /// character-for-character comparison Task 2 makes).
    private static func renderedAtZeroElapsed(syncedAtMs: Int64?) -> String {
        let reference: Date
        if let syncedAtMs {
            reference = Date(timeIntervalSince1970: Double(syncedAtMs) / 1000)
        } else {
            reference = Date(timeIntervalSince1970: 0)
        }
        return SyncFreshness.describe(syncedAtMs: syncedAtMs, reference: reference)
    }

    // MARK: - BEFORE: one confirmed pull, server up

    @Test func establishABaselineWithAConfirmedPull() async throws {
        let email = try Self.requireEnv("PV_FRESHNESS_ACCOUNT_ID")
        let password = try Self.requireEnv("PV_FRESHNESS_ACCOUNT_PASSWORD")

        AppGroupCiphertextCacheStore().purge()

        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.register(email: email, password: password)
        #expect(session.email == email)

        let store = await MainActor.run {
            VaultStore(
                userKey: session.userKey,
                api: VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token }),
                accountId: email,
                cacheStore: AppGroupCiphertextCacheStore()
            )
        }

        try await store.refresh()
        let ts = try #require(
            await MainActor.run { store.currentSnapshot?.syncedAtMs },
            "the baseline pull must persist a snapshot"
        )
        let rendered = Self.renderedAtZeroElapsed(syncedAtMs: ts)
        try Self.writeProbe(name: "freshness-probe-before.json", ts: ts, rendered: rendered)
    }

    // MARK: - AFTER: a forced pull against a server that cannot answer

    @Test func aForcedPullAgainstAStoppedServerLeavesTheCacheUntouched() async throws {
        let email = try Self.requireEnv("PV_FRESHNESS_ACCOUNT_ID")

        // Deliberately no sign-in: the server is down by the time this
        // method runs. A freshly generated key is sufficient -- see this
        // file's own header on why decrypt correctness is irrelevant here.
        let throwawayKey = try FfiUserKey.generate()
        let store = await MainActor.run {
            VaultStore(
                userKey: throwawayKey,
                api: VaultAPI(baseURL: Self.baseURL, tokenProvider: { "irrelevant-server-is-down" }),
                accountId: email,
                cacheStore: AppGroupCiphertextCacheStore()
            )
        }

        // `init` -> `hydrateFromCache()` must have read the baseline's
        // persisted snapshot already, BEFORE this forced pull ever runs.
        let tsBeforeForcedPull = try #require(
            await MainActor.run { store.currentSnapshot?.syncedAtMs },
            "no baseline snapshot was found -- did establishABaselineWithAConfirmedPull run first, against the SAME PV_FRESHNESS_ACCOUNT_ID?"
        )

        var threw = false
        do {
            try await store.refresh()
        } catch {
            threw = true
        }
        #expect(threw, "a pull against a stopped server must throw, not silently succeed")

        let tsAfter = await MainActor.run { store.currentSnapshot?.syncedAtMs }
        #expect(tsAfter == tsBeforeForcedPull, "the timestamp must not move on a pull the server never answered")

        let renderedAfter = Self.renderedAtZeroElapsed(syncedAtMs: tsAfter)
        try Self.writeProbe(name: "freshness-probe-after.json", ts: tsAfter, rendered: renderedAfter)
    }

    // MARK: - CONTROL: two confirmed pulls in sequence, server up throughout

    @Test func twoConfirmedPullsInSequenceAdvanceTheTimestamp() async throws {
        let email = try Self.requireEnv("PV_FRESHNESS_CONTROL_ACCOUNT_ID")
        let password = try Self.requireEnv("PV_FRESHNESS_CONTROL_ACCOUNT_PASSWORD")

        AppGroupCiphertextCacheStore().purge()

        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.register(email: email, password: password)

        let store = await MainActor.run {
            VaultStore(
                userKey: session.userKey,
                api: VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token }),
                accountId: email,
                cacheStore: AppGroupCiphertextCacheStore()
            )
        }

        try await store.refresh()
        let tsBefore = try #require(await MainActor.run { store.currentSnapshot?.syncedAtMs })
        let renderedBefore = Self.renderedAtZeroElapsed(syncedAtMs: tsBefore)

        try await Task.sleep(nanoseconds: 1_500_000_000)

        try await store.refresh()
        let tsAfter = try #require(await MainActor.run { store.currentSnapshot?.syncedAtMs })
        let renderedAfter = Self.renderedAtZeroElapsed(syncedAtMs: tsAfter)

        #expect(tsAfter > tsBefore, "a second confirmed pull must advance the stored timestamp")

        let container = try Self.appGroupContainerURL()
        let payload: [String: Any] = [
            "beforeTs": tsBefore, "beforeRendered": renderedBefore,
            "afterTs": tsAfter, "afterRendered": renderedAfter,
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        try data.write(to: container.appendingPathComponent("freshness-probe-control.json"), options: .atomic)
    }
}
