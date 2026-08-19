//
//  SyncCoordinator.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03. The sync layer's
//  entry point: it owns starting/stopping the transport and, for now,
//  exposes a single pull entry point plus a foreground-transition pull. The
//  socket and the poll fallback are 39-04's -- this file exists NOW because
//  it is where the two standing records below belong; splitting them out
//  into a later plan's file would separate them from the code they
//  describe.
//
//  SYNC-05 -- APNs silent push is deliberately NOT built in v1.0.
//
//  A silent push would require `pv-server` to hold an APNs sending
//  capability (an Apple push key, an outbound connection to Apple's
//  gateway, and per-install device-token storage). That is a REQUIRED
//  EXTERNAL DEPENDENCY, against this product's stated position: one Docker
//  container, SQLite on a volume, no required external services. The cost
//  is accepted and disclosed rather than hidden: a backgrounded iOS app
//  receives no vault updates, and the AutoFill extension's cache is fresh
//  only as of the host app's last successful foreground sync. That is what
//  the "last synced" copy in both UIs exists to say. If this is ever
//  revisited it gets its own decision record, in the KEY-05/EXT-10 style
//  (D-04, `39-RESEARCH.md` §"Wording the phase record must use").
//
//  `BGAppRefreshTask` is a separate, discretionary option this record does
//  NOT forbid on its own terms (DR-39-C, `ios/IOS-SPIKE-LOG.md` §1g) -- and
//  DR-39-C decided against registering one for v1.0 anyway, on its own
//  reasoning (the system may simply never run it, so it buys no honest
//  freshness claim). Neither decision is revisited by this file; both are
//  quoted here only so the reader does not have to guess whether this
//  record also covers that question.
//

import Foundation
import os

@MainActor
final class SyncCoordinator {
    /// WR-01 (39-REVIEW.md): every `Task { try? await self.pull() }` site
    /// below used to discard a thrown pull error with no log line at all --
    /// a persistent failure (an expired token producing 401 on every pull,
    /// an unreachable host) was invisible. `try?` still keeps a failed pull
    /// from propagating anywhere a caller would have to handle it (none of
    /// these call sites are awaited), but the failure itself is now logged.
    private static let log = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "sync")

    private let store: VaultStore
    private var socket: SyncSocket?
    private var foregroundPullTimer: Timer?

    /// Task 2's live two-push proof cannot fail while this optimisation
    /// runs -- a working poll disguises a one-shot receive as a working
    /// socket (D-06). Set BEFORE calling `start(baseURL:tokenProvider:)`;
    /// exposed so that proof, and only that proof, can disable it.
    var repeatingPullDisabled = false

    init(store: VaultStore) {
        self.store = store
    }

    /// One full pull through `VaultStore.refresh()` -- the SAME production
    /// path `ItemListView`'s pull-to-refresh and `FolderPicker` already use
    /// (this plan does not duplicate that logic). This is the call site the
    /// identity-store hook below runs from, so that call site exists and is
    /// obvious (D-22) rather than left for a later plan to invent.
    func pull() async throws {
        try await store.refresh()
        notifyIdentityStore()
    }

    /// Named separately from `pull()` so a `UIApplication
    /// .willEnterForegroundNotification`/`scenePhase` observer has an
    /// obvious, already-exercised call site to attach to (`sync.ts`'s own
    /// `onopen`-fires-a-catch-up-pull discipline extends here: a transition
    /// to foreground is this platform's equivalent "the transport might have
    /// missed something, go find out").
    func foregroundPull() async throws {
        try await pull()
    }

    /// Starts the WebSocket transport (39-04) against `baseURL`, plus the
    /// in-foreground repeating pull unless `repeatingPullDisabled` is set.
    /// Idempotent: calling this while already started stops the previous
    /// transport first (`SyncSocket.start()`'s own idempotent re-entry).
    func start(baseURL: URL, tokenProvider: @escaping () -> String?) {
        stop()
        let socket = SyncSocket(
            urlProvider: { SyncSocket.wsURL(base: baseURL, token: tokenProvider()) },
            pull: { [weak self] in
                guard let self else { return }
                Task {
                    do { try await self.pull() } catch {
                        Self.log.error("socket-triggered pull failed: \(String(describing: error), privacy: .public)")
                    }
                }
            }
        )
        self.socket = socket
        socket.start()
        startRepeatingPullIfNeeded()
    }

    /// Tears down the socket and the repeating pull. Never touches the
    /// persisted cache or the store's session state -- that is
    /// `ContentView.performLock()`/`performSignOut()`'s job, not this
    /// type's.
    ///
    /// WR-01 (39-REVIEW.md, iteration 2): `socket.teardown()`, not
    /// `socket.stop()` -- this is the LAST strong reference this type holds
    /// to the socket (`socket = nil` immediately after), and every
    /// `SyncSocket` in production wraps a REAL `URLSessionSyncSocketTransport`
    /// whose session retains it until explicitly invalidated. `stop()` alone
    /// cancels the live task and disarms reconnection but never breaks that
    /// retain cycle, so dropping this reference without tearing down first
    /// leaked one full transport+session+delegate triple per lock/unlock
    /// cycle (`ContentView.performLock` drops the coordinator on every
    /// lock).
    func stop() {
        socket?.teardown()
        socket = nil
        stopRepeatingPull()
    }

    /// The honest fallback (39-RESEARCH.md's Freshness section; `sync.ts`'s
    /// own header comment, ported): a suspended process's timer does not
    /// fire, so a pull on EVERY transition to the active scene phase is the
    /// only unconditional freshness guarantee this design has. The
    /// in-foreground repeating timer below is an optimisation on top of
    /// this, never a substitute for it.
    func handleScenePhaseBecameActive() {
        Task {
            do { try await foregroundPull() } catch {
                Self.log.error("foreground-transition pull failed: \(String(describing: error), privacy: .public)")
            }
        }
    }

    /// In-foreground OPTIMISATION only, NOT a guarantee: a backgrounded
    /// process's `Timer` does not fire (the same reason the poll-by-alarm
    /// rewrite exists in the extension, `sync-client.ts`'s own header) --
    /// `handleScenePhaseBecameActive()` above is what actually keeps this
    /// design honest across a background/foreground cycle. Disabled
    /// entirely when `repeatingPullDisabled` is set (Task 2's live two-push
    /// proof), because a working poll disguises a one-shot receive loop as
    /// a working socket (D-06) -- with it disabled, the experiment can fail.
    private func startRepeatingPullIfNeeded() {
        guard !repeatingPullDisabled else { return }
        let timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task {
                do { try await self.pull() } catch {
                    Self.log.error("repeating-timer pull failed: \(String(describing: error), privacy: .public)")
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        foregroundPullTimer = timer
    }

    private func stopRepeatingPull() {
        foregroundPullTimer?.invalidate()
        foregroundPullTimer = nil
    }

    /// FILL-03 (`.planning/REQUIREMENTS.md` §FILL) -- Phase 41's to
    /// implement, named here on the post-pull path so the call site exists
    /// rather than being invented later. `ASCredentialIdentityStore` must be
    /// updated on every vault mutation, or QuickType entries silently fail
    /// to appear -- a documented pitfall (36-RESEARCH.md), not a
    /// hypothesis. The real store call has a deprecated near-twin differing
    /// by one character in its selector:
    /// `replaceCredentialIdentities(with:completion:)` (deprecated, takes
    /// `[ASPasswordCredentialIdentity]`) vs. `replaceCredentialIdentities(_:
    /// completion:)` (current, takes `[ASCredentialIdentity]`) -- whoever
    /// implements this must check which one they are calling before wiring
    /// it up.
    ///
    /// Empty body, DELIBERATELY: an unimplemented hook that is honest is
    /// better than a real store call whose failure nobody observes (D-22).
    /// Never pass a `nil` completion to a real call from here -- that would
    /// make a genuine store failure silently unobservable, which is worse
    /// than this hook's current, visible no-op.
    private func notifyIdentityStore() {
        // Intentionally empty. See doc comment above -- FILL-03, Phase 41
        // owns the implementation.
    }
}
