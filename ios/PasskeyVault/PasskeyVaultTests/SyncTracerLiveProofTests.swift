//
//  SyncTracerLiveProofTests.swift
//  PasskeyVaultTests
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03, Task 1's tracer
//  proof. Driven by `scripts/ios-sync-live-proof.sh`, which owns the server
//  lifecycle and the web-client (real `pv-wasm`) half: it registers an
//  account and authors ONE login item -- with the password literal the
//  caller supplied via `--expect-password` -- through the real WASM crypto
//  the web app itself ships, BEFORE this test ever runs. This file performs
//  the RECEIVING half, on the real iOS production path (`AccountService`,
//  `VaultAPI`, `VaultStore`, `pv-ffi` decrypt), and is the "rendered on the
//  iOS screen" assertion this plan's D-07 requires: `VaultItemViewModel
//  .content` is the exact value `ItemDetailView`/`ItemListView` render from
//  (`VaultWireInteropTests.swift`'s established precedent for what "iOS
//  reads it" means -- the same store type, the same two calls the UI makes,
//  never a hand-rolled test path).
//
//  Three assertions, matching this plan's own <action> wording verbatim:
//    1. the decrypted password on this item equals the literal the web
//       client was given (D-07, positive receiver-side comparison).
//    2. (performed by the DRIVING SCRIPT, which reads the App Group
//       container straight off the host filesystem and the server's raw
//       response straight off `curl` -- see that script's own header) the
//       persisted ciphertext strings are digest-identical to the ones
//       `curl` fetched in the same session (D-13).
//    3. a SECOND pull, answered with the up-to-date branch (nothing changed
//       server-side), leaves the persisted cache file byte-for-byte
//       unchanged (D-12/T-39-10) -- asserted HERE, by reading the App Group
//       container's raw bytes before and after the second `refresh()`, so
//       this exact assertion is what the RED demonstration (this plan's own
//       `<acceptance_criteria>`) exercises when `SyncModels.swift`'s decoder
//       is mutated to synthesize an empty snapshot instead of `.upToDate`.
//
//  FAILS on a missing environment variable, never skips -- 37-03's rule
//  (`VaultWireInteropTests.swift`'s own header), re-stated here for the same
//  reason: a silent skip would report this tracer green without having run
//  it.
//

import CryptoKit
import Foundation
import Testing
@testable import PasskeyVault

struct SyncTracerLiveProofTests {

    private enum TracerTestError: Error, CustomStringConvertible {
        case missingEnvironmentVariables(String)
        case noItemsAfterFirstPull
        case notALoginItem(String)
        case appGroupContainerUnavailable

        var description: String {
            switch self {
            case let .missingEnvironmentVariables(keys):
                return "SyncTracerLiveProofTests requires \(keys) -- set by scripts/ios-sync-live-proof.sh"
            case .noItemsAfterFirstPull:
                return "the first refresh() produced no items -- the web-authored row never arrived"
            case let .notALoginItem(got):
                return "expected the ONE item to decode as .login, got \(got)"
            case .appGroupContainerUnavailable:
                return "the App Group container did not resolve -- Branch H (DR-1) is not available on this run"
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

    /// Plain name first, then `TEST_RUNNER_`-prefixed -- `xcodebuild test`
    /// forwards one or the other depending on version (37-03's finding,
    /// `VaultWireInteropTests.swift`'s own `env` helper, reproduced here).
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
            throw TracerTestError.missingEnvironmentVariables(joined)
        }
        return found
    }

    /// The exact same path the App Group's own store resolves against
    /// (`AppGroupCiphertextCacheStore.groupIdentifier`/`.fileName`) --
    /// resolved independently HERE only because this is the raw-bytes
    /// half of the third assertion; `AppGroupCiphertextCacheStore` itself
    /// is the production type under test, used unmodified via `VaultStore`
    /// below.
    private static func persistedCacheFileURL() throws -> URL {
        guard
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
            )
        else {
            throw TracerTestError.appGroupContainerUnavailable
        }
        return container.appendingPathComponent(AppGroupCiphertextCacheStore.fileName)
    }

    private static func persistedCacheDigest() -> String? {
        guard
            let url = try? Self.persistedCacheFileURL(),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    @Test func iOSPullsAWebAuthoredItemThroughThePersistedCacheAndASecondPullLeavesItUnchanged() async throws {
        let vars = try Self.requireEnv([
            "PV_TRACER_EMAIL", "PV_TRACER_ACCOUNT_PASSWORD", "PV_TRACER_ITEM_PASSWORD",
        ])
        let email = vars["PV_TRACER_EMAIL"]!
        let accountPassword = vars["PV_TRACER_ACCOUNT_PASSWORD"]!
        let expectedItemPassword = vars["PV_TRACER_ITEM_PASSWORD"]!

        // Purge first: this simulator's App Group container is shared
        // across every run this session, and D-19's own account-identifier
        // check would already reject a stale foreign-account snapshot -- but
        // this test's OWN before/after digest comparison must start from a
        // known, empty state, not "whatever a previous run happened to
        // leave", so a leftover snapshot from an EARLIER run of this same
        // freshly-minted-per-run email cannot exist, and a leftover from a
        // DIFFERENT account cannot leave a stale file for the "never
        // written" read path either.
        AppGroupCiphertextCacheStore().purge()

        // ---- sign in through the REAL production path -----------------
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

        // ---- first pull: the web-authored row must arrive and decrypt -
        try await store.refresh()
        let items = await store.items
        guard let only = items.first else {
            throw TracerTestError.noItemsAfterFirstPull
        }
        #expect(items.count == 1, "the tracer authors exactly ONE item; a stale leftover would mean the purge above did not run")
        #expect(only.isUndecryptable == false, "iOS must be able to decrypt the row pv-wasm wrote")

        // Assertion 1 (D-07): the RENDERED password -- `only.content` is the
        // exact value `ItemDetailView`'s password field reads from.
        guard case let .fields(.login(loginFields)) = only.content else {
            throw TracerTestError.notALoginItem(String(describing: only.content))
        }
        #expect(
            loginFields.password == expectedItemPassword,
            "rendered password \(loginFields.password.debugDescription) != the literal the web client was given \(expectedItemPassword.debugDescription)"
        )

        // ---- Assertion 3 (D-12/T-39-10): a second, up-to-date pull must
        // leave the persisted cache file byte-for-byte unchanged. This is
        // the exact check the RED mutation in SyncDecodeTests' own
        // acceptance criteria demonstrates able to fail: if the up-to-date
        // branch's decoder is ever mutated to synthesize an empty
        // .snapshot instead of .upToDate, VaultStore.refresh() calls
        // persistSnapshotToCache with an EMPTY item array on this second
        // pull, and the digest below changes.
        // `#require`, not `#expect`: a `nil` digest here (App Group
        // unresolved, or nothing written) must HALT immediately -- otherwise
        // a nil-vs-nil comparison below would be a VACUOUS pass ("both
        // sides absent" is not "both sides equal and present"), exactly the
        // evidence-that-measures-the-wrong-thing shape this codebase has
        // been burned by before.
        let digestBeforeSecondPull = try #require(
            Self.persistedCacheDigest(), "the first pull must have persisted a REAL cache file -- got nil"
        )

        try await store.refresh()
        let itemsAfterSecondPull = await store.items
        #expect(itemsAfterSecondPull.count == 1, "an up-to-date pull must not have emptied the in-memory list")

        let digestAfterSecondPull = try #require(
            Self.persistedCacheDigest(), "the cache file vanished between the two pulls"
        )
        #expect(
            digestBeforeSecondPull == digestAfterSecondPull,
            "the persisted cache changed after an up-to-date pull -- the up-to-date branch must carry no path to the cache writer (D-12)"
        )
    }
}
