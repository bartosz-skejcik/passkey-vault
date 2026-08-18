//
//  LiveSyncProbe.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-04, Task 2. DEBUG-only,
//  inert unless `PV_WS_PROOF_EMAIL`/`PV_WS_PROOF_PASSWORD` are both set --
//  matches this repo's established `PV_UITEST_*`/`PV_PROBE_*` env-var hook
//  convention (`PasskeyVaultApp.swift`'s own note on the same pattern;
//  `ProbeSeeder.swift`'s `PVPROBE|` os_log convention, reused here as
//  `PVSYNC|`).
//
//  `scripts/ios-ws-push-proof.sh` launches the REAL host app on the
//  simulator with these two env vars set. This hook is that script's own
//  "signs in" step: it drives the SAME production path (`AccountService` ->
//  `VaultStore` -> `SyncCoordinator` -> `SyncSocket`) 39-03's
//  `SyncTracerLiveProofTests` already exercises in-process, from inside the
//  REAL, continuously-running app rather than a one-shot XCTest -- because
//  Task 2's proof needs ONE socket connection to survive across TWO
//  independent web-client mutations, and only a long-lived process can hold
//  a connection open across that span (an `xcodebuild test` invocation ends
//  with the test method, which would tear the socket down between the two
//  mutations).
//
//  `repeatingPullDisabled` is hardwired `true` here, UNCONDITIONALLY: this
//  probe exists only for the two-push proof, and a working poll disguises a
//  one-shot receive as a working socket (D-06) -- there is no legitimate
//  reason for this specific code path to ever want it enabled.
//  `scripts/ios-ws-push-proof.sh`'s own preflight greps THIS file for the
//  literal `repeatingPullDisabled = true` and refuses to run if it is
//  absent (demonstrated failing once, this plan's own acceptance criteria).
//
//  Logs `PVSYNC|event=render` via `os.Logger` (subsystem
//  `cloud.blonie.PasskeyVault`, category `sync`) whenever a login item's
//  decrypted password changes -- `privacy: .public`, deliberately: these
//  are throwaway test literals THIS SAME SCRIPT generates and passes in via
//  `--literal-one`/`--literal-two`, never real vault data, and the whole
//  point of this file is for the shell script to read the DECRYPTED value
//  off the device log. `VaultItemViewModel.content` is this codebase's own
//  established definition of "rendered" (`SyncTracerLiveProofTests.swift`'s
//  header: "the exact value ItemDetailView/ItemListView render from").
//

#if DEBUG
import Foundation
import os

enum LiveSyncProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "sync")

    /// Called once from `ContentView.determineRoute()`. A no-op unless both
    /// env vars are set -- inert for every normal DEBUG launch (and
    /// compiled out entirely in Release, this whole file is `#if DEBUG`).
    static func runIfRequested() {
        let env = ProcessInfo.processInfo.environment
        guard
            let email = env["PV_WS_PROOF_EMAIL"], !email.isEmpty,
            let password = env["PV_WS_PROOF_PASSWORD"], !password.isEmpty
        else {
            return
        }
        let baseURL = ServerSettings.resolved
        Task { @MainActor in
            await run(email: email, password: password, baseURL: baseURL)
        }
    }

    @MainActor
    private static func run(email: String, password: String, baseURL: URL) async {
        do {
            let accountService = AccountService(apiClient: PvApiClient(baseURL: baseURL))
            let session = try await accountService.signIn(email: email, password: password)
            let store = VaultStore(
                userKey: session.userKey,
                api: VaultAPI(baseURL: baseURL, tokenProvider: { session.token }),
                accountId: session.email,
                cacheStore: AppGroupCiphertextCacheStore()
            )
            let coordinator = SyncCoordinator(store: store)
            coordinator.repeatingPullDisabled = true // see this file's header -- the D-06 requirement
            coordinator.start(baseURL: baseURL, tokenProvider: { session.token })
            logger.log("PVSYNC|event=signedin")

            // Polls the ALREADY-DECRYPTED in-memory store (never a second
            // decode path) and logs only on CHANGE, so the shell script can
            // read one `PVSYNC|event=render` line per distinct value rather
            // than one every 300ms.
            var lastLoggedPassword: [String: String] = [:]
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 300_000_000)
                for item in store.items {
                    guard case let .fields(.login(loginFields)) = item.content else { continue }
                    if lastLoggedPassword[item.id] != loginFields.password {
                        lastLoggedPassword[item.id] = loginFields.password
                        logger.log(
                            "PVSYNC|event=render item=\(item.id, privacy: .public) password=\(loginFields.password, privacy: .public)"
                        )
                    }
                }
            }
        } catch {
            logger.error("PVSYNC|event=error message=\(String(describing: error), privacy: .public)")
        }
    }
}
#endif
