//
//  TotpInsertSc6Seeder.swift
//  PasskeyVault
//
//  Plan 44-06, Task 2 (SAVE-03's own live drive). Mirrors `PasskeyInteropSeeder.swift`'s own
//  established shape (Plan 43-09) exactly, not `PasskeyRegistrationSc4Seeder.swift`'s (which
//  writes an EMPTY cache): signs IN (never registers) to an account
//  `scripts/ios-autofill-e44.sh sc-insert` has ALREADY registered AND populated with one real TOTP
//  item via an INDEPENDENT `pv-wasm` client (`scripts/ios-autofill-e43-sc4-probe.mjs`'s new
//  `create-totp` action -- a genuine `POST /api/vault/items`, never this app's own encryption
//  path), then drives the SAME production `VaultStore.refresh()` `ContentView` itself calls on
//  every foreground/open -- a real `GET /api/sync` round trip, real decrypt, real write into
//  `AppGroupCiphertextCacheStore` via `persistSnapshotToCache`. This is what makes the
//  independently-created TOTP item genuinely present in the extension's own cold cache
//  (`prepareInterfaceForUserChoosingTextToInsert()`'s ONLY data source, FILL-05's offline
//  discipline) rather than merely present in a hand-built local cache blob.
//
//  DEVIATION (Rule 2, GSD executor rules): 44-06-PLAN.md's own `files_modified` list does not name
//  this file (or its `PasskeyVaultApp.swift` call site) -- the SAME class of gap
//  `PasskeyRegistrationSc4Seeder.swift`/`PasskeyInteropSeeder.swift` already document for their own
//  plans, resolved the same way: without a host-side seeder that performs a REAL sign-in + REAL
//  sync, this plan's own live-invocation attempt has no genuine cached TOTP item to offer at all.
//
//  Compiled in only under `PV_PROBE_E44_06_SEED` -- inert for every other build.
//

import Foundation
import os

#if DEBUG || PV_PROBE_E44_06_SEED
@MainActor
enum TotpInsertSc6Seeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    /// Written by `scripts/ios-autofill-e44.sh sc-insert` directly onto the App Group container's
    /// host-filesystem path BEFORE this app launches: `{"serverBaseURL":"...","email":"...",
    /// "password":"..."}` -- the SAME account the script's own `create-totp` mjs action already
    /// registered and populated with one real, server-visible TOTP item.
    private static let seedInputFileName = "pv-44-06-sc-insert-seed.json"
    private static let statusFileName = "e44-06-sc-insert-seed-status.json"

    private struct SeedInput: Decodable {
        let serverBaseURL: String
        let email: String
        let password: String
    }

    private static func writeStatusMarker(status: String, step: String, extra: String = "") {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else { return }
        let payload = "{\"status\":\"\(status)\",\"step\":\"\(step)\",\"extra\":\"\(extra)\"}"
        try? payload.write(
            to: containerURL.appendingPathComponent(statusFileName), atomically: true, encoding: .utf8
        )
    }

    static func seed() async {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else {
            logger.error("PVFILL|E44-06-SC-INSERT|stage=seed status=fail step=no-container")
            writeStatusMarker(status: "fail", step: "no-container")
            return
        }
        let seedInputURL = containerURL.appendingPathComponent(seedInputFileName)
        guard
            let data = try? Data(contentsOf: seedInputURL),
            let input = try? JSONDecoder().decode(SeedInput.self, from: data),
            let serverURL = URL(string: input.serverBaseURL)
        else {
            logger.error("PVFILL|E44-06-SC-INSERT|stage=seed status=fail step=no-seed-input")
            writeStatusMarker(status: "fail", step: "no-seed-input")
            return
        }

        do {
            try ServerSettings.store(serverURL)
        } catch {
            logger.error("PVFILL|E44-06-SC-INSERT|stage=seed status=fail step=server-settings error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "server-settings")
            return
        }

        let session: UnlockedSession
        do {
            // signIn, NEVER register -- the mjs `create-totp` action already registered this
            // account and wrote its one real item server-side.
            let accountService = AccountService(apiClient: PvApiClient(baseURL: serverURL))
            session = try await accountService.signIn(email: input.email, password: input.password)
        } catch {
            logger.error("PVFILL|E44-06-SC-INSERT|stage=seed status=fail step=signin error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "signin")
            return
        }
        logger.log("PVFILL|E44-06-SC-INSERT|stage=seed status=ok step=signin email=\(session.email, privacy: .private)")

        // Same real writer PasskeyRegistrationSc4Seeder.seed()/PasskeyInteropSeeder.seed() use to
        // simulate a real host-app unlock having just happened.
        SessionLifecycle.recordHostUnlock()

        do {
            var sessionBytes = exportUserKeyForSession(userKey: session.userKey)
            defer { sessionBytes.resetBytes(in: 0..<sessionBytes.count) }
            try SessionKeyStore.store(sessionBytes)
            logger.log("PVFILL|E44-06-SC-INSERT|stage=seed status=ok step=sessionkey")
        } catch {
            logger.error("PVFILL|E44-06-SC-INSERT|stage=seed status=fail step=sessionkey error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sessionkey")
            return
        }

        // The REAL sync pull -- ContentView.storeFor's own VaultStore construction, then
        // refresh() (GET /api/sync -> SyncClient.pull() -> decrypt -> persistSnapshotToCache), the
        // identical production path the host app drives on every foreground/open. This is what
        // makes the independently-created TOTP item genuinely usable by the extension's own cold
        // cache -- never a hand-staged single-item cache write.
        let store = VaultStore(
            userKey: session.userKey,
            api: VaultAPI(baseURL: serverURL, tokenProvider: { [token = session.token] in token }),
            accountId: session.email,
            cacheStore: AppGroupCiphertextCacheStore()
        )
        do {
            try await store.refresh()
            logger.log("PVFILL|E44-06-SC-INSERT|stage=seed status=ok step=sync itemCount=\(store.items.count)")
        } catch {
            logger.error("PVFILL|E44-06-SC-INSERT|stage=seed status=fail step=sync error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sync")
            return
        }

        writeStatusMarker(status: "ok", step: "complete", extra: "\(store.items.count)")

        // Hygiene: the staging file carries a real, throwaway account password. Remove it now
        // that it has been consumed -- dev/test tooling, not a production data path.
        try? FileManager.default.removeItem(at: seedInputURL)
    }
}
#endif
