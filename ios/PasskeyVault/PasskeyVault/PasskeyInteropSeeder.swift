//
//  PasskeyInteropSeeder.swift
//  PasskeyVault
//
//  43-09-PLAN.md Task 2 (ROADMAP SC5, direction 2: "extension creates -> iOS asserts"). Unlike
//  `PasskeyTracerSeeder.swift` (43-03, hand-stages a single item into the App Group cache) and
//  `PasskeyRegistrationSc4Seeder.swift` (43-07, `AccountService.register` against a FRESH account,
//  then writes an EMPTY `CachedSnapshot`), this seeder's own job is the REAL SYNC PULL 43-09's own
//  `must_haves.truths` requires: sign IN (never register) to an account
//  `scripts/ios-autofill-e43.sh interop` ALREADY registered and populated with one real passkey
//  item via the extension's own production `wasmCreateProviderCredential` code path (a genuine
//  `POST /api/vault/items`), then drive the SAME production `VaultStore.refresh()` `ContentView`
//  itself calls on every foreground/open -- a real `GET /api/sync` round trip, real decrypt, real
//  write into `AppGroupCiphertextCacheStore` via `persistSnapshotToCache`. This is what makes the
//  item "usable on iOS after a real sync pull" rather than merely present in a hand-built local
//  cache blob.
//
//  DEVIATION (Rule 2, GSD executor rules): 43-09-PLAN.md's own `files_modified` list does not name
//  this file (or its `PasskeyVaultApp.swift` call site) -- the SAME class of gap
//  `PasskeyTracerSeeder.swift`/`PasskeyRegistrationSc4Seeder.swift` already document for their own
//  plans, resolved the same way: without a host-side seeder that performs a REAL sign-in + REAL
//  sync, direction 2's own must_haves ("after a real sync pull") is structurally unsatisfiable from
//  a bare simulator.
//
//  Compiled in only under `PV_PROBE_E43_INTEROP` -- inert for every other build.
//

import Foundation
import os

#if DEBUG || PV_PROBE_E43_INTEROP
@MainActor
enum PasskeyInteropSeeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    /// Written by `scripts/ios-autofill-e43.sh interop` directly onto the App Group container's
    /// host-filesystem path BEFORE this app launches: `{"serverBaseURL":"...","email":"...",
    /// "password":"..."}` -- the SAME account `interop`'s own Node-side create step already
    /// registered and populated with one real, server-visible passkey item.
    private static let seedInputFileName = "pv-43-interop-seed.json"
    private static let statusFileName = "e43-interop-seed-status.json"

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
            logger.error("PVFILL|E43-INTEROP|stage=seed status=fail step=no-container")
            writeStatusMarker(status: "fail", step: "no-container")
            return
        }
        let seedInputURL = containerURL.appendingPathComponent(seedInputFileName)
        guard
            let data = try? Data(contentsOf: seedInputURL),
            let input = try? JSONDecoder().decode(SeedInput.self, from: data),
            let serverURL = URL(string: input.serverBaseURL)
        else {
            logger.error("PVFILL|E43-INTEROP|stage=seed status=fail step=no-seed-input")
            writeStatusMarker(status: "fail", step: "no-seed-input")
            return
        }

        do {
            try ServerSettings.store(serverURL)
        } catch {
            logger.error("PVFILL|E43-INTEROP|stage=seed status=fail step=server-settings error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "server-settings")
            return
        }

        let session: UnlockedSession
        do {
            // signIn, NEVER register -- interop's Node-side create step already registered this
            // account. AccountService.register would fail (email already taken) or, worse, silently
            // create a SECOND, unrelated account if the server's own register endpoint were ever
            // relaxed to tolerate a duplicate email -- signIn is the only correct verb here.
            let accountService = AccountService(apiClient: PvApiClient(baseURL: serverURL))
            session = try await accountService.signIn(email: input.email, password: input.password)
        } catch {
            logger.error("PVFILL|E43-INTEROP|stage=seed status=fail step=signin error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "signin")
            return
        }
        logger.log("PVFILL|E43-INTEROP|stage=seed status=ok step=signin email=\(session.email, privacy: .private)")

        // Same real writer PasskeyTracerSeeder.seed()/PasskeyRegistrationSc4Seeder.seed() use to
        // simulate a real host-app unlock having just happened.
        SessionLifecycle.recordHostUnlock()

        do {
            var sessionBytes = exportUserKeyForSession(userKey: session.userKey)
            defer { sessionBytes.resetBytes(in: 0..<sessionBytes.count) }
            try SessionKeyStore.store(sessionBytes)
            logger.log("PVFILL|E43-INTEROP|stage=seed status=ok step=sessionkey")
        } catch {
            logger.error("PVFILL|E43-INTEROP|stage=seed status=fail step=sessionkey error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sessionkey")
            return
        }

        // The REAL sync pull -- ContentView.storeFor's own VaultStore construction, then refresh()
        // (GET /api/sync -> SyncClient.pull() -> decrypt -> persistSnapshotToCache), the identical
        // production path the host app drives on every foreground/open. This is what makes the
        // extension-created item genuinely "usable on iOS after a real sync pull" -- never a
        // hand-staged single-item cache write.
        let store = VaultStore(
            userKey: session.userKey,
            api: VaultAPI(baseURL: serverURL, tokenProvider: { [token = session.token] in token }),
            accountId: session.email,
            cacheStore: AppGroupCiphertextCacheStore()
        )
        do {
            try await store.refresh()
            logger.log("PVFILL|E43-INTEROP|stage=seed status=ok step=sync itemCount=\(store.items.count)")
        } catch {
            logger.error("PVFILL|E43-INTEROP|stage=seed status=fail step=sync error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sync")
            return
        }

        writeStatusMarker(status: "ok", step: "complete", extra: "\(store.items.count)")

        // Hygiene: the staging file carries a real, throwaway account password. Remove it now that
        // it has been consumed -- dev/test tooling, not a production data path.
        try? FileManager.default.removeItem(at: seedInputURL)
    }
}
#endif
