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
    /// Default target for this plan's own manual/automated verification
    /// runs. Phase 38 owns real, user-configurable server settings.
    private static let defaultServerURL = URL(string: "http://127.0.0.1:8620")!

    private enum Route {
        case loading
        case auth
        case lock(RestoredAccount)
        case unlocked(UnlockedSession)
    }

    @State private var route: Route = .loading
    /// Built once when the vault route is first rendered and kept for the
    /// lifetime of the unlocked session (38-02).
    @State private var vaultStore: VaultStore?
    private let apiClient = PvApiClient(baseURL: ContentView.defaultServerURL)

    var body: some View {
        Group {
            switch route {
            case .loading:
                ProgressView()
            case .auth:
                AuthView(apiClient: apiClient, onUnlocked: handleUnlocked)
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
        if let forced = ProcessInfo.processInfo.environment["PV_UITEST_SCREEN"] {
            switch forced {
            case "auth":
                route = .auth
            case "lock":
                route = .lock(
                    RestoredAccount(
                        token: "uitest-fixture-token",
                        email: "bartek@paczesny.pl",
                        pwWrappedUkJson: "{}"
                    )
                )
            default:
                route = .auth
            }
            return
        }
        #endif
        let service = AccountService(apiClient: apiClient)
        do {
            if let restored = try await service.restoreSession() {
                route = .lock(restored)
            } else {
                route = .auth
            }
        } catch {
            route = .auth
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
                baseURL: ContentView.defaultServerURL,
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
