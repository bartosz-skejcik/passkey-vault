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
//  CR-05 (39-REVIEW.md): logs `PVSYNC|event=render` via `os.Logger`
//  (subsystem `cloud.blonie.PasskeyVault`, category `sync`) at `privacy:
//  .public`, but ONLY for a login password that is byte-equal to one of the
//  two literals the driving script passed in via a THIRD required env var,
//  `PV_WS_PROOF_LITERALS` (comma-separated, matching `--literal-one`/
//  `--literal-two`) -- never every login item in the account, which is what
//  this file used to do before this fix. `runIfRequested()` is a no-op
//  unless `PV_WS_PROOF_LITERALS` is ALSO set and non-empty, on top of the
//  existing email/password gate -- so a bare `PV_WS_PROOF_EMAIL`/
//  `PV_WS_PROOF_PASSWORD` pair (a plausible mistake against a real account)
//  can no longer publish a single decrypted secret. The loop also carries a
//  hard deadline (`probeDeadline`) and calls `store.lock()` on every exit
//  path, so this probe cannot outlive its own proof or keep holding
//  `session.userKey`/decrypted items after the two-push window closes.
//  `VaultItemViewModel.content` is this codebase's own established
//  definition of "rendered" (`SyncTracerLiveProofTests.swift`'s header: "the
//  exact value ItemDetailView/ItemListView render from").
//

#if DEBUG
import Foundation
import os

enum LiveSyncProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "sync")

    /// CR-05 (39-REVIEW.md): the probe's whole runtime, from sign-in to
    /// `store.lock()`, is bounded by this many seconds -- generous for the
    /// two-push proof's own ~30s-of-work budget (`scripts
    /// /ios-ws-push-proof.sh`'s own 30s-per-wait timeouts), never unbounded
    /// as the pre-fix loop was.
    private static let probeDurationSeconds: TimeInterval = 120

    /// Called once from `ContentView.determineRoute()`. A no-op unless ALL
    /// THREE env vars are set -- inert for every normal DEBUG launch (and
    /// compiled out entirely in Release, this whole file is `#if DEBUG`).
    /// `PV_WS_PROOF_LITERALS` (CR-05, 39-REVIEW.md): the comma-separated
    /// pair of literals this run is allowed to log -- without it, this hook
    /// stays inert even if the email/password pair alone would otherwise
    /// point at a real account.
    static func runIfRequested() {
        let env = ProcessInfo.processInfo.environment
        guard
            let email = env["PV_WS_PROOF_EMAIL"], !email.isEmpty,
            let password = env["PV_WS_PROOF_PASSWORD"], !password.isEmpty,
            let literalsRaw = env["PV_WS_PROOF_LITERALS"], !literalsRaw.isEmpty
        else {
            return
        }
        let expectedLiterals = Set(literalsRaw.split(separator: ",").map(String.init)).filter { !$0.isEmpty }
        guard !expectedLiterals.isEmpty else { return }
        let baseURL = ServerSettings.resolved
        Task { @MainActor in
            await run(email: email, password: password, baseURL: baseURL, expectedLiterals: expectedLiterals)
        }
    }

    @MainActor
    private static func run(email: String, password: String, baseURL: URL, expectedLiterals: Set<String>) async {
        var store: VaultStore?
        // CR-05: every exit path -- deadline, cancellation, or a thrown
        // error after sign-in -- releases the key handle this probe holds,
        // mirroring `ContentView.performLock()`'s own single-teardown
        // discipline. `store` starts `nil` so an error BEFORE sign-in has
        // nothing to lock.
        defer { store?.lock() }
        do {
            let accountService = AccountService(apiClient: PvApiClient(baseURL: baseURL))
            let session = try await accountService.signIn(email: email, password: password)
            let liveStore = VaultStore(
                userKey: session.userKey,
                api: VaultAPI(baseURL: baseURL, tokenProvider: { session.token }),
                accountId: session.email,
                cacheStore: AppGroupCiphertextCacheStore()
            )
            store = liveStore
            let coordinator = SyncCoordinator(store: liveStore)
            coordinator.repeatingPullDisabled = true // see this file's header -- the D-06 requirement
            coordinator.start(baseURL: baseURL, tokenProvider: { session.token })
            logger.log("PVSYNC|event=signedin")

            // Polls the ALREADY-DECRYPTED in-memory store (never a second
            // decode path) and logs only on CHANGE, so the shell script can
            // read one `PVSYNC|event=render` line per distinct value rather
            // than one every 300ms. Bounded by `probeDeadline` (CR-05) --
            // this loop no longer runs for the life of the process.
            let deadline = Date().addingTimeInterval(Self.probeDurationSeconds)
            var lastLoggedPassword: [String: String] = [:]
            while !Task.isCancelled, Date() < deadline {
                try? await Task.sleep(nanoseconds: 300_000_000)
                for item in liveStore.items {
                    guard case let .fields(.login(loginFields)) = item.content else { continue }
                    // CR-05: only the two literals THIS run's driving
                    // script named are ever eligible to be logged --
                    // everything else in the account is skipped, silently.
                    guard expectedLiterals.contains(loginFields.password) else { continue }
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
