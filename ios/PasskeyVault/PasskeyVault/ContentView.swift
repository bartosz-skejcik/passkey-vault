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
    @ViewBuilder
    private func vault(_ session: UnlockedSession) -> some View {
        let store = storeFor(session)
        ItemListView(store: store)
    }

    private func storeFor(_ session: UnlockedSession) -> VaultStore {
        if let vaultStore {
            return vaultStore
        }
        let store = VaultStore(
            userKey: session.userKey,
            api: VaultAPI(
                baseURL: ServerSettings.resolved,
                // A closure, not a captured `String`: the token is read at
                // request time so a lock or rotation cannot leave a stale
                // copy alive inside `VaultAPI`.
                tokenProvider: { [token = session.token] in token }
            )
        )
        vaultStore = store
        return store
    }
}

#Preview {
    ContentView()
}
