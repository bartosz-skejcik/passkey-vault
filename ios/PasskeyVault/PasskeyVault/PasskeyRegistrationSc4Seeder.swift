//
//  PasskeyRegistrationSc4Seeder.swift
//  PasskeyVault
//
//  Phase 43 (warunkowe-passkeys-tylko-je-li-tanie), Plan 43-07, Task 2 (ROADMAP SC4). Seeds a
//  REAL, throwaway account against a LIVE `pv-server` -- unlike `PasskeyTracerSeeder.swift`
//  (Plan 43-03), which points the assertion tracer at an unreachable `serverBaseURL` because
//  assertion only ever reads the local cache. SC4's own claim is "a real registration ceremony
//  produces a server-visible item" -- that claim is meaningless without a genuinely reachable
//  server the extension's new `VaultAPI.createItem` call can actually POST to.
//
//  Drives the SAME `AccountService` the app's own `ContentView`/`AccountFlowLiveTests` drive
//  (never a re-implementation of register) against a server URL staged by
//  `scripts/ios-autofill-e43.sh sc4` BEFORE this app launches -- the same staged-input-file
//  convention `PasskeyTracerSeeder` already established (`pv-43-seed-passkey.json`), a sibling
//  file here (`pv-43-sc4-seed.json`).
//
//  Writes, in order (`ServerSettings.store` clears `SessionTokenStore`/`UkEnvelopeStore` when the
//  server URL changes -- MUST run before `AccountService.register`, never after, or the fresh
//  session token it saves would be wiped):
//    1. `ServerSettings.store(url)` -- the REAL production write, so `VaultAPI.extensionBaseURL()`
//       (the extension's own read path, App Group companion copy) sees the live server.
//    2. `AccountService.register(email:password:)` -- a REAL account, REAL Argon2id/session-token
//       round trip; `register` itself calls `SessionTokenStore.save(...)`, the SAME Keychain item
//       `VaultAPI`'s new extension-process caller reads (DR-43-A).
//    3. Secret C (`SessionKeyStore.store`) + the host-unlock marker (`SessionLifecycle
//       .recordHostUnlock()`) -- the SAME real writers `PasskeyTracerSeeder.seed()` uses, keyed to
//       the REGISTERED account's own `userKey` (never a throwaway key), so the extension's lock
//       check finds a key that genuinely decrypts this account's items.
//    4. An EMPTY `CachedSnapshot` (`accountId: session.email`, matching `ContentView.storeFor`'s
//       own convention) -- gives `AppGroupCiphertextCacheStore.currentAccountMarker()` something
//       to resolve, so `CredentialProviderViewController.existingPasskeysJson`'s cache lookup does
//       not short-circuit on "no cache" before the ceremony ever runs.
//
//  DEVIATION (Rule 2, GSD executor rules): 43-07-PLAN.md's own `files_modified` list does not name
//  this file (or its `PasskeyVaultApp.swift` call site) -- the SAME class of gap
//  `PasskeyTracerSeeder.swift`'s own header documents for Plan 43-03, resolved the same way.
//
//  Compiled in only under `PV_PROBE_E43_SC4` -- inert for every other build.
//

import Foundation
import os

#if DEBUG || PV_PROBE_E43_SC4
enum PasskeyRegistrationSc4Seeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    /// Written by `scripts/ios-autofill-e43.sh sc4` directly onto the App Group container's
    /// host-filesystem path BEFORE this app launches: `{"serverBaseURL":"...","email":"...",
    /// "password":"..."}`.
    private static let seedInputFileName = "pv-43-sc4-seed.json"
    private static let statusFileName = "e43-sc4-seed-status.json"

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
            logger.error("PVFILL|E43-SC4|stage=seed status=fail step=no-container")
            writeStatusMarker(status: "fail", step: "no-container")
            return
        }
        let seedInputURL = containerURL.appendingPathComponent(seedInputFileName)
        guard
            let data = try? Data(contentsOf: seedInputURL),
            let input = try? JSONDecoder().decode(SeedInput.self, from: data),
            let serverURL = URL(string: input.serverBaseURL)
        else {
            logger.error("PVFILL|E43-SC4|stage=seed status=fail step=no-seed-input")
            writeStatusMarker(status: "fail", step: "no-seed-input")
            return
        }

        do {
            try ServerSettings.store(serverURL)
        } catch {
            logger.error("PVFILL|E43-SC4|stage=seed status=fail step=server-settings error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "server-settings")
            return
        }

        let session: UnlockedSession
        do {
            let accountService = AccountService(apiClient: PvApiClient(baseURL: serverURL))
            session = try await accountService.register(email: input.email, password: input.password)
        } catch {
            logger.error("PVFILL|E43-SC4|stage=seed status=fail step=register error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "register")
            return
        }
        logger.log("PVFILL|E43-SC4|stage=seed status=ok step=register email=\(session.email, privacy: .private)")

        // Same real writer `PasskeyTracerSeeder.seed()`/`TracerFillSeeder.seed()` use to simulate a
        // real host-app unlock having just happened.
        SessionLifecycle.recordHostUnlock()

        do {
            var sessionBytes = exportUserKeyForSession(userKey: session.userKey)
            defer { sessionBytes.resetBytes(in: 0..<sessionBytes.count) }
            try SessionKeyStore.store(sessionBytes)
            logger.log("PVFILL|E43-SC4|stage=seed status=ok step=sessionkey")
        } catch {
            logger.error("PVFILL|E43-SC4|stage=seed status=fail step=sessionkey error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "sessionkey")
            return
        }

        let emptySnapshot = CachedSnapshot(
            revision: 0,
            Int64(Date().timeIntervalSince1970 * 1000),
            accountId: session.email,
            serverBaseURL: input.serverBaseURL,
            items: [],
            folders: []
        )
        do {
            try AppGroupCiphertextCacheStore().write(emptySnapshot)
            logger.log("PVFILL|E43-SC4|stage=seed status=ok step=cache")
        } catch {
            logger.error("PVFILL|E43-SC4|stage=seed status=fail step=cache error=\(String(describing: error), privacy: .public)")
            writeStatusMarker(status: "fail", step: "cache")
            return
        }

        writeStatusMarker(status: "ok", step: "complete", extra: session.email)

        // Hygiene: the staging file carries a real, throwaway account password. Remove it now
        // that it has been consumed -- dev/test tooling, not a production data path.
        try? FileManager.default.removeItem(at: seedInputURL)
    }
}
#endif
