//
//  ContentView.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. Reduced from
//  35/37-02's minimal tracer screen to the router `37-UI-SPEC.md`'s Screen
//  Inventory names: `AuthView` when there is no session (or the stored
//  session can no longer be confirmed against the server), `LockView` when
//  a session token restores an account but the User Key is not in memory.
//
//  Known simplification, recorded rather than hidden: `LockView`
//  eligibility is decided by a LIVE `GET /api/auth/me` call
//  (`AccountService.restoreSession()`) each launch, not a local cache of
//  `pw_wrapped_uk` -- this avoids a second local-storage mechanism this
//  phase does not otherwise need, at the cost of requiring network
//  reachability to distinguish the two screens on cold launch. True
//  offline-first caching is Phase 39's job (sync/offline cache), not this
//  plan's.
//

import SwiftUI

struct ContentView: View {
    private enum Route {
        case loading
        /// Phase 38, plan 38-13: presented once, before `.auth`, gated by
        /// `OnboardingGate.shouldPresentOnboarding` (a pure decision --
        /// `OnboardingGateTests.swift` falsifies it without touching this
        /// view at all).
        case onboarding
        case auth(initialMode: AuthView.Mode)
        case lock(RestoredAccount)
        case unlocked(UnlockedSession)
    }

    @State private var route: Route = .loading
    /// Same `UserDefaults` key `OnboardingView`'s own `@AppStorage` writes to
    /// -- `OnboardingGate.completedKey` is the single string literal both
    /// bind to, so they cannot drift into two different keys.
    @AppStorage(OnboardingGate.completedKey) private var onboardingCompleted = false
    /// Built once when the vault route is first rendered and kept for the
    /// lifetime of the unlocked session (38-02).
    @State private var vaultStore: VaultStore?
    /// Plan 38-09, Task 3: built alongside `vaultStore`, same one-per-session
    /// discipline (`storeFor(_:)`'s own note on why rebuilding on every body
    /// evaluation would be wrong).
    @State private var folderStore: FolderStore?
    /// Plan 39-06 (Rule 2 deviation -- see this file's own note at
    /// `syncCoordinatorFor(_:store:)`). `SyncCoordinator` existed since
    /// 39-04 but was never actually started from this, the real app's
    /// routing -- only `LiveSyncProbe` (a DEBUG-only, invisible, PARALLEL
    /// session) ever called `.start(...)`. Without this, "a pull on every
    /// foreground transition" (39-04's own key link, this plan's Task 2's
    /// own action text) was not actually true of the shipped app.
    @State private var syncCoordinator: SyncCoordinator?
    /// Plan 39-06: the ONLY unconditional freshness guarantee this design
    /// has (`SyncCoordinator.handleScenePhaseBecameActive()`'s own doc
    /// comment) -- a suspended process's `Timer` does not fire, so a pull
    /// on every transition to `.active` is what keeps the cache from going
    /// silently stale for longer than "however long this session happens
    /// to stay foregrounded".
    @Environment(\.scenePhase) private var scenePhase
    /// Read from `ServerSettings.resolved` at construction (38-12, Task 3)
    /// -- never cached in a `let` bound to a compiled-in URL. `apiClient`
    /// itself is still a `let`: it is read once per `ContentView` instance
    /// the same way it always was, but the VALUE it captures now comes from
    /// the persisted setting rather than a literal, so a fresh app launch
    /// after a server change picks up the new address (a mid-session
    /// change is out of scope -- 38-13's onboarding flow runs before a
    /// session exists).
    private let apiClient = PvApiClient(baseURL: ServerSettings.resolved)

    var body: some View {
        Group {
            switch route {
            case .loading:
                ProgressView()
            case .onboarding:
                OnboardingView(onComplete: handleOnboardingComplete)
            case let .auth(initialMode):
                AuthView(apiClient: apiClient, initialMode: initialMode, onUnlocked: handleUnlocked)
            case let .lock(account):
                LockView(apiClient: apiClient, account: account, onUnlocked: handleUnlocked)
            case let .unlocked(session):
                vault(session)
            }
        }
        .task {
            await determineRoute()
        }
    }

    private func determineRoute() async {
        #if DEBUG
        // Plan 39-04, Task 2: fires off `scripts/ios-ws-push-proof.sh`'s
        // own sign-in-and-hold-a-socket-open probe, if requested via env
        // var -- see `LiveSyncProbe.swift`'s own header. Runs in its own
        // detached `Task`, never blocking this routing call, so the normal
        // onboarding/auth/lock flow below is unaffected either way.
        LiveSyncProbe.runIfRequested()
        // TEST-ONLY (Task 5 screenshot matrix, `ios/evidence/37/`): forces the
        // router's outcome deterministically so the UI-test driver never
        // depends on a live server or a real stored session -- mirrors the
        // `PV_AUTOFILL_UITEST_ROUTE`/`PV_PROBE_KEYCHAIN` env-var hooks already
        // established elsewhere in this repo. Compiled into DEBUG builds
        // only; never reachable in Release. This hook renders a VIEW's
        // layout for a screenshot -- it never claims biometric ENFORCEMENT
        // was observed (37-05's job), because it never touches the real
        // Keychain/LAContext path at all.
        // TEST-ONLY (Task 2 screenshot matrix, `ios/evidence/38/`): a fresh
        // simulator launch shares the SAME `UserDefaults` suite across
        // separate `XCUIApplication().launch()` calls within one
        // `xcodebuild test` invocation -- unlike a real fresh install, so a
        // scenario earlier in the same test run (e.g. one that reaches
        // `ServerSettings.store(_:)`) would otherwise leak into a later
        // one's "default value" assumption. Resetting both keys the
        // onboarding flow touches at the START of a forced-screen launch
        // gives each UI test method its own clean slate without needing a
        // real reinstall between them.
        if ProcessInfo.processInfo.environment["PV_UITEST_RESET_ONBOARDING"] != nil {
            UserDefaults.standard.removeObject(forKey: "pv.server.url")
            UserDefaults.standard.removeObject(forKey: OnboardingGate.completedKey)
        }
        if let forced = ProcessInfo.processInfo.environment["PV_UITEST_SCREEN"] {
            switch forced {
            case "auth":
                route = .auth(initialMode: .signIn)
            // Register mode needs its own forced value: reaching it by tapping
            // the ghost control requires simulator input, which times out in
            // this environment often enough that screenshot evidence for the
            // register screen was going uncaptured.
            case "authRegister":
                route = .auth(initialMode: .register)
            case "lock":
                route = .lock(
                    RestoredAccount(
                        token: "uitest-fixture-token",
                        email: "bartek@paczesny.pl",
                        pwWrappedUkJson: "{}"
                    )
                )
            // Phase 38, plan 38-13, Task 1: lands the UI test driver on
            // onboarding's first step without depending on a clean install
            // (a real device/simulator that has already completed
            // onboarding once would otherwise skip straight past it).
            case "onboarding":
                route = .onboarding
            default:
                route = .auth(initialMode: .signIn)
            }
            return
        }
        #endif
        // Phase 38, plan 38-13: onboarding is checked BEFORE any network
        // call -- a fresh install must show Welcome without first waiting on
        // `AccountService.restoreSession()` to fail.
        guard onboardingCompleted else {
            route = .onboarding
            return
        }
        await reroute()
    }

    /// `OnboardingWelcomeStep`'s two controls decide which `AuthView` mode
    /// the flow lands on (Task 1's "carry the branch" requirement) -- passed
    /// through as a value on this completion callback, never a second
    /// persisted flag.
    private func handleOnboardingComplete(_ intent: OnboardingEntryIntent) {
        switch intent {
        case .newVault:
            route = .auth(initialMode: .register)
        case .existingVault:
            route = .auth(initialMode: .signIn)
        }
    }

    private func handleUnlocked(_ session: UnlockedSession) {
        route = .unlocked(session)
    }

    /// Phase 38, plan 38-02: the unlocked route now renders the real vault
    /// list instead of 37-04's "Vault unlocked" placeholder.
    ///
    /// The store is built once per unlocked session and held in `@State` —
    /// rebuilding it on every body evaluation would drop the decrypted array
    /// and re-pull the whole snapshot on each render. `session.userKey` goes
    /// in as a plain (non-observed) property of the store; see
    /// `VaultStore`'s own note (T-38-02-03).
    ///
    /// Plan 38-11: renders `VaultRootView`, not `ItemListView` directly, so
    /// its `VaultRootController` owns the navigation path/sheet/reveal/
    /// search state a lock must tear down, and wires the REAL "Lock now"/
    /// "Sign out" affordances -- both rendered but DISABLED before this plan
    /// (`ItemListView`'s own former note on why: a half-built lock action is
    /// the exact "true in the artifact, false in reality" shape this project
    /// keeps paying for).
    @ViewBuilder
    private func vault(_ session: UnlockedSession) -> some View {
        let store = storeFor(session)
        VaultRootView(
            store: store,
            folderStore: folderStoreFor(session),
            onLockRequested: { performLock() },
            onSignOutRequested: { performSignOut() }
        )
        .task {
            // WR-14 (39-REVIEW.md): construction AND start moved here, out
            // of `body` evaluation. `syncCoordinatorFor` writes `@State`
            // (`syncCoordinator = coordinator`) and, on first call,
            // `SyncSocket.start()` opens a network connection and schedules
            // a repeating timer -- both real side effects that used to run
            // as a consequence of evaluating a `@ViewBuilder` function's
            // body (`vault(_:)` was called directly from `body`'s own
            // `switch`). Mutating `@State` during view update is undefined
            // behaviour in SwiftUI (the runtime's "Modifying state during
            // view update" warning) and made socket startup depend on how
            // many times SwiftUI decided to evaluate the body.
            // `storeFor`/`folderStoreFor` above share the construction-only
            // shape but perform no I/O, so they are unaffected.
            _ = syncCoordinatorFor(session, store: store)
            await Self.seedTooShortTotpSecretIfRequested(store: store)
            await Self.seedDockFixtureIfRequested(store: store)
        }
        // Plan 39-06: the real foreground-transition trigger. `newPhase ==
        // .active` fires on EVERY transition into the foreground, cold
        // launch included -- the coordinator's own `pull()` is idempotent
        // (just another `VaultStore.refresh()`), so an extra call here on
        // first appearance costs nothing. Reads the `@State` coordinator
        // directly (WR-14) -- it is no longer computed synchronously in
        // `body`, so a transition landing before `.task` has run yet is a
        // safe no-op rather than a crash.
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                syncCoordinator?.handleScenePhaseBecameActive()
            }
        }
    }

    /// Runs AFTER `VaultRootController.lockTeardown()` has already emptied
    /// the store/folderStore's own arrays and released their key handles --
    /// this closure's job is what that controller cannot reach: the ROUTE
    /// itself, and the `@State` references this view holds to the now-locked
    /// store instances.
    ///
    /// `vaultStore`/`folderStore` are set `nil` here, NOT merely left
    /// pointing at their now-empty-but-still-alive instances: the next
    /// unlock's `UnlockedSession` carries a FRESH `FfiUserKey` object (a new
    /// `LockView` unlock, or a fresh sign-in), and `storeFor(_:)`/
    /// `folderStoreFor(_:)` only build a new store when their cached
    /// reference is `nil` -- reusing the OLD, now-permanently-locked
    /// instance would make the vault unrecoverable without relaunching the
    /// app.
    ///
    /// Re-derives the `.lock` route the SAME way cold launch does
    /// (`AccountService.restoreSession()`, a live `GET /api/auth/me` call)
    /// rather than caching the account/`pwWrappedUkJson` locally -- this
    /// file's own header already documents that `LockView` eligibility is
    /// decided by a live call each time, not a local cache; a lock is just
    /// another entry into that same decision.
    private func performLock() {
        syncCoordinator?.stop()
        syncCoordinator = nil
        vaultStore = nil
        folderStore = nil
        route = .loading
        Task { await reroute() }
    }

    /// Same teardown as `performLock()`, plus forgetting the local session
    /// token server-side/locally (`AccountService.logout()`) -- a signed-out
    /// account has no session left to restore into `.lock`, so this always
    /// lands on `.auth`, never re-derived.
    ///
    /// Plan 39-03: also purges the persisted ciphertext cache -- the cache,
    /// its in-blob watermark and the session token die together on
    /// sign-out (D-19). `purge()` needs no live `VaultStore` instance (it
    /// resolves the App Group container itself), so this runs regardless of
    /// whether `vaultStore` had already been constructed this session.
    private func performSignOut() {
        syncCoordinator?.stop()
        syncCoordinator = nil
        vaultStore = nil
        folderStore = nil
        route = .loading
        Task {
            let service = AccountService(apiClient: apiClient)
            await service.logout()
            AppGroupCiphertextCacheStore().purge()
            route = .auth(initialMode: .signIn)
        }
    }

    /// The SAME decision `determineRoute()`'s post-onboarding branch makes,
    /// factored out so `performLock()` can reuse it without also re-running
    /// the onboarding/DEBUG-forced-route checks that only make sense at
    /// initial launch.
    private func reroute() async {
        let service = AccountService(apiClient: apiClient)
        do {
            if let restored = try await service.restoreSession() {
                route = .lock(restored)
            } else {
                route = .auth(initialMode: .signIn)
            }
        } catch {
            route = .auth(initialMode: .signIn)
        }
    }

    /// [Rule 2 deviation, plan 38-06 dock work] The dock's load-bearing
    /// claim -- "the bottom bar minimises but never disappears while
    /// scrolling" -- is only observable on a list that actually SCROLLS.
    /// The existing fixtures cannot produce one: `PV_UITEST_VAULT_FIXTURE`
    /// forces exactly two synthetic rows, and driving the tracer's marker
    /// bar 20+ times through XCUITest keystrokes is neither fast nor
    /// reliable enough to be evidence.
    ///
    /// This hook creates a spread of REAL items through the REAL
    /// `VaultStore.create(fields:)` path -- real client-side encryption,
    /// real `POST /api/vault/items`, real decrypt on the way back -- so the
    /// rows under the dock are genuinely decrypted rows off the wire, not a
    /// forced array. Only the DECISION to create them is synthetic.
    ///
    /// Idempotent by construction: it returns immediately if the account
    /// already holds any item whose name carries the fixture marker, so a
    /// re-run against the same throwaway account does not multiply the list.
    /// DEBUG only, inert unless `PV_UITEST_SEED_DOCK_LIST` is set, matching
    /// this repo's established `PV_UITEST_*` hook convention.
    #if DEBUG
    static let dockFixtureMarker = "\u{2009}·"

    private static func seedDockFixtureIfRequested(store: VaultStore) async {
        guard ProcessInfo.processInfo.environment["PV_UITEST_SEED_DOCK_LIST"] != nil else { return }
        guard !store.items.contains(where: { $0.displayName.hasSuffix(dockFixtureMarker) }) else {
            return
        }
        for fields in dockFixtureItems() {
            _ = try? await store.create(fields: fields)
        }
    }

    /// Real-looking vault contents across all six types, so every section of
    /// the All tab (including `identity` and `note`, the two with no tab of
    /// their own) is populated and the list is long enough to scroll.
    /// Card numbers are the public Luhn-valid TEST numbers the payment
    /// networks publish for exactly this purpose -- never a real PAN.
    private static func dockFixtureItems() -> [ItemFields] {
        let m = dockFixtureMarker
        var out: [ItemFields] = []
        let logins: [(String, String, String)] = [
            ("GitHub", "bartek@paczesny.pl", "github.com"),
            ("Google", "bartek@paczesny.pl", "accounts.google.com"),
            ("Cloudflare", "bartek@paczesny.pl", "dash.cloudflare.com"),
            ("Hetzner", "bartek", "console.hetzner.cloud"),
            ("Fastmail", "bartek@paczesny.pl", "app.fastmail.com"),
            ("Vercel", "bartek", "vercel.com"),
            ("Stripe", "bartek@paczesny.pl", "dashboard.stripe.com"),
            ("Linear", "bartek@paczesny.pl", "linear.app"),
            ("npm", "j5on", "npmjs.com"),
            ("Figma", "bartek@paczesny.pl", "figma.com"),
        ]
        for (name, user, host) in logins {
            out.append(.login(LoginFields(
                name: name + m, folderId: nil, tags: [], username: user,
                password: "fixture-not-a-real-password", urls: ["https://\(host)"], notes: ""
            )))
        }
        let cards: [(String, String, String)] = [
            ("Revolut", "4242424242424242", "04/29"),
            ("mBank", "5555555555554444", "11/28"),
            ("Amex", "378282246310005", "07/27"),
        ]
        for (name, number, expiry) in cards {
            out.append(.card(CardFields(
                name: name + m, folderId: nil, tags: [], cardholderName: "BARTLOMIEJ PACZESNY",
                number: number, expiry: expiry, cvv: "123", pin: nil, zip: nil, notes: ""
            )))
        }
        for (name, issuer) in [("GitHub", "GitHub"), ("Google", "Google"), ("AWS", "Amazon")] {
            out.append(.totp(TotpFields(
                name: name + m, folderId: nil, tags: [],
                secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", issuer: issuer,
                algorithm: "SHA1", digits: 6, period: 30, notes: ""
            )))
        }
        for (name, rpId) in [("Google", "google.com"), ("Adobe", "adobe.com")] {
            out.append(.passkey(PasskeyFields(
                name: name + m, folderId: nil, tags: [], rpId: rpId,
                credentialId: "Zml4dHVyZS1jcmVkZW50aWFs", username: "bartek@paczesny.pl",
                userDisplayName: "Bartek", rawPasskeyJson: "{}"
            )))
        }
        out.append(.identity(IdentityFields(
            name: "Bartek" + m, folderId: nil, tags: [], firstName: "Bartlomiej",
            lastName: "Paczesny", email: "bartek@paczesny.pl", phone: "", address: "",
            addressLine1: nil, addressLine2: nil, city: nil, state: nil, zip: nil,
            country: nil, notes: ""
        )))
        for (name, body) in [
            ("Recovery codes", "one per line"),
            ("Router admin", "192.168.1.1"),
            ("Wi-Fi", "guest network"),
        ] {
            out.append(.note(NoteFields(name: name + m, folderId: nil, tags: [], body: body)))
        }
        return out
    }
    #else
    private static func seedDockFixtureIfRequested(store: VaultStore) async {}
    #endif

    /// [Rule 2 deviation, plan 38-10] Not in this plan's `files_modified` --
    /// added because Task 2's own acceptance criteria (a screenshot of the
    /// TOTP error state) and Task 3's E-T1 second falsification arm both
    /// need a real, server-persisted item carrying a secret `totp-rs`
    /// rejects, and `ItemFormView`'s client-side `TotpValidation` refuses
    /// to save one through the normal create flow (by design -- 38-09).
    /// `VaultStore.create(fields:)` itself does no such validation (the
    /// server is zero-knowledge and never inspects the TOTP parameters
    /// either), so this hook goes straight through it -- the SAME call
    /// path `ItemFormView`'s own save button uses, just without that one
    /// view's client-side gate in front of it. Compiled into DEBUG builds
    /// only, inert unless `PV_UITEST_SEED_BAD_TOTP` is set (this repo's
    /// established `PV_UITEST_*` hook convention -- see
    /// `PasskeyVaultApp.swift`'s own note on the same pattern).
    #if DEBUG
    private static func seedTooShortTotpSecretIfRequested(store: VaultStore) async {
        guard ProcessInfo.processInfo.environment["PV_UITEST_SEED_BAD_TOTP"] != nil else { return }
        // 16 base32 characters = 10 decoded bytes, below `totp-rs`'s 16-byte
        // floor -- the exact secret `extension/entrypoints/background/
        // autofill-match.test.ts:295` uses under a MOCKED `totpNow`
        // (Pitfall 4, `38-RESEARCH.md`). Used here for the opposite reason:
        // to prove the REAL path rejects it.
        _ = try? await store.create(fields: .totp(TotpFields(
            name: "Bad Secret (UI test fixture)", folderId: nil, tags: [],
            secret: "JBSWY3DPEHPK3PXP", issuer: "TooShort", algorithm: "SHA1",
            digits: 6, period: 30, notes: ""
        )))
    }
    #else
    private static func seedTooShortTotpSecretIfRequested(store: VaultStore) async {}
    #endif

    private func storeFor(_ session: UnlockedSession) -> VaultStore {
        if let vaultStore {
            return vaultStore
        }
        let store = VaultStore(
            userKey: session.userKey,
            api: VaultAPI(
                baseURL: ServerSettings.resolved,
                // WR-03 (38-REVIEW.md): this closure captures `session
                // .token` BY VALUE at construction, not a late read -- the
                // comment here previously (and falsely) claimed the
                // opposite. What actually prevents a stale copy surviving a
                // lock is `VaultStore.lock()`/`FolderStore.lock()`
                // replacing `api` with a dead `tokenProvider` (see either
                // type's own note); a session TOKEN ROTATION without a
                // lock is not covered by that and would still authenticate
                // with the value captured here.
                tokenProvider: { [token = session.token] in token }
            ),
            // Plan 39-03: the real Branch H cache (App Group container) and
            // the account identifier it is checked against on every read
            // (D-19). Every other `VaultStore(userKey:api:)` construction
            // in this codebase is a test call site that keeps its pre-39-03
            // defaults (no cache configured).
            accountId: session.email,
            cacheStore: AppGroupCiphertextCacheStore()
        )
        vaultStore = store
        return store
    }

    /// Plan 39-06 (Rule 2 deviation, SYNC-04). Same one-per-session
    /// construction discipline as `storeFor(_:)` -- built once, `.start`ed
    /// once, and kept alive for the session's lifetime.
    ///
    /// **Why this exists now, and did not before:** `SyncCoordinator` (the
    /// socket + foreground-pull transport 39-04 built) was, until this
    /// plan, instantiated ONLY inside `LiveSyncProbe.swift` -- a DEBUG-only
    /// hook that runs a SECOND, invisible, parallel session for a live-proof
    /// script's benefit. It was never started from THIS view's own routing,
    /// so the real, shipped app had no socket and no foreground-pull trigger
    /// at all; every sync happened only via `ItemListView`'s own
    /// `.task { refresh() }` on first appearance and pull-to-refresh. 39-04's
    /// own key link ("scenePhase transition to active -> SyncCoordinator
    /// .pull") and this plan's Task 2 action text ("force a pull from the
    /// app -- by a foreground transition, which is the honest trigger this
    /// phase built") both assume this wiring exists; it did not, until here.
    /// `repeatingPullDisabled` is left at its default (`false`) -- the
    /// in-foreground 30s timer stays on for real usage; only the D-06 live
    /// proof (`LiveSyncProbe`) needs it off in that file's own context.
    ///
    /// A SECOND, DIFFERENT reason to disable it, DEBUG-only and opt-in via
    /// `PV_UITEST_DISABLE_REPEATING_PULL` (this repo's established
    /// `PV_UITEST_*` hook convention): plan 39-06's `FreshnessEvidenceUITests`
    /// needs to hold a signed-in session open across a real, external
    /// server stop to prove SC4/E-F2's stale-cache artifact, and the SAME
    /// 30s repeating timer this note defends for real usage was observed
    /// LIVE to fire mid-test, mid-server-kill-window, and leave the app
    /// unresponsive to further XCUITest interaction (a background pull
    /// racing that test's own, deliberately-triggered one against a
    /// now-dead server). Disabling it there removes that race without
    /// touching the mechanism itself -- the test's own explicit
    /// pull-to-refresh gesture is the ONLY pull it needs or wants.
    private func syncCoordinatorFor(_ session: UnlockedSession, store: VaultStore) -> SyncCoordinator {
        if let syncCoordinator {
            return syncCoordinator
        }
        let coordinator = SyncCoordinator(store: store)
        #if DEBUG
        // `PV_UITEST_DISABLE_REPEATING_PULL` skips `.start(...)` entirely --
        // NOT just the 30s timer. `FreshnessEvidenceUITests` observed live
        // that the underlying `SyncSocket`'s OWN reconnect loop (independent
        // of `repeatingPullDisabled`, which only gates SyncCoordinator's
        // separate in-foreground timer) kept the app unresponsive to further
        // XCUITest interaction once the server it was reconnecting against
        // died mid-test. That test drives `VaultStore.refresh()` directly
        // via pull-to-refresh, never through this coordinator or its socket
        // -- so skipping `.start()` here costs that test nothing.
        if ProcessInfo.processInfo.environment["PV_UITEST_DISABLE_REPEATING_PULL"] != nil {
            syncCoordinator = coordinator
            return coordinator
        }
        #endif
        coordinator.start(
            baseURL: ServerSettings.resolved,
            tokenProvider: { [token = session.token] in token },
            userKey: session.userKey
        )
        syncCoordinator = coordinator
        return coordinator
    }

    /// Same one-per-session construction discipline as `storeFor(_:)`, its
    /// own `VaultAPI` instance (a lightweight, stateless struct -- see that
    /// type's own header) rather than sharing `vaultStore`'s.
    private func folderStoreFor(_ session: UnlockedSession) -> FolderStore {
        if let folderStore {
            return folderStore
        }
        let store = FolderStore(
            userKey: session.userKey,
            api: VaultAPI(
                baseURL: ServerSettings.resolved,
                tokenProvider: { [token = session.token] in token }
            )
        )
        folderStore = store
        return store
    }
}

#Preview {
    ContentView()
}
