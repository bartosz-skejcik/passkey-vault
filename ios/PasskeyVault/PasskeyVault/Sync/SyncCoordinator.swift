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
//  [Rule 2 deviation, plan 40-10] `ResealTrigger`'s wiring lives HERE, not
//  as a new file of its own -- this is the exact "unlock/sync transition"
//  DR-40-B's `must_haves.key_links` names as the trigger's one production
//  call site, and `pull()` (this type's own doc comment: "the call site
//  ... obvious (D-22) rather than left for a later plan to invent") is
//  already that transition's obvious home. `40-09-SUMMARY.md`'s own "Next
//  Phase Readiness" note recorded that iOS had NO production caller for
//  the lazy-reseal trigger yet -- this file is what closes that gap.
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

    /// Plan 40-10: the propagator half of DR-40-B, held for this session's
    /// lifetime (constructed in `start`, torn down in `stop`) -- see
    /// `fireResealTriggerIfPossible()`'s own doc comment for the whole
    /// wiring story.
    private var resealTrigger: ResealTrigger?
    private var resealBaseURL: URL?
    private var resealTokenProvider: (() -> String?)?
    private var resealUserKey: FfiUserKey?

    /// CR-03: held so `stop()` can cancel it. Before this, the detached
    /// `Task` inside `fireResealTriggerIfPossible()` was never held nor
    /// cancelled -- `stop()` only nilled the captured-by-value properties,
    /// so an in-flight reseal cycle kept using the ALREADY-CAPTURED
    /// `FfiUserKey` and session token (network calls, key unwraps) for as
    /// long as the round trip took, after the vault had explicitly locked.
    private var resealTask: Task<Void, Never>?

    /// WR-04: `GET /api/families/family-wide-pending` is `ActiveFamilyMembership
    /// <RequireRead>`-gated (`families.rs:398-401`), so it 404s/403s on
    /// EVERY call for a solo self-hoster -- this product's primary persona.
    /// `pull()` runs on a 30-second timer, every socket push, and every
    /// foreground transition, so without this cache that was an `.error`
    /// log line every 30 seconds forever for a user with no family. Reset
    /// on every fresh `start(...)` (a re-login could join a family
    /// mid-session).
    private var hasNoFamily = false

    /// Task 2's live two-push proof cannot fail while this optimisation
    /// runs -- a working poll disguises a one-shot receive as a working
    /// socket (D-06). Set BEFORE calling `start(baseURL:tokenProvider:userKey:)`;
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
    ///
    /// Plan 40-10: `fireResealTriggerIfPossible()` runs LAST, after the
    /// vault refresh -- fire-and-forget, never awaited by this function's
    /// own return, so a slow or failing reseal fan-out can never delay or
    /// fail the vault refresh this function exists for (`must_haves.truths`:
    /// "The trigger is not awaited on the unlock critical path and its
    /// failures are not surfaced to the user").
    func pull() async throws {
        try await store.refresh()
        notifyIdentityStore()
        fireResealTriggerIfPossible()
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
    ///
    /// Plan 40-10: `userKey` is the propagator's own User Key, needed only
    /// to build the `ResealTrigger` this method constructs fresh for the
    /// session -- never stored anywhere `VaultStore`/`FolderStore` don't
    /// already hold an equivalent handle.
    func start(baseURL: URL, tokenProvider: @escaping () -> String?, userKey: FfiUserKey) {
        stop()
        resealBaseURL = baseURL
        resealTokenProvider = tokenProvider
        resealUserKey = userKey
        // WR-04: a fresh session gets a fresh chance to discover family
        // membership -- a re-login could join a family mid-session, so
        // this is not carried over from a previous `start(...)`.
        hasNoFamily = false
        let trigger = ResealTrigger(resealService: ResealService(baseURL: baseURL, tokenProvider: tokenProvider))
        resealTrigger = trigger
        // Unlock transition -- a fresh session gets a fresh attempted-pair
        // set (this file's own header, `ResealTrigger.resetAttempts()`'s
        // own doc comment). A brand-new `ResealTrigger` already starts
        // empty, so this call is a no-op in practice for THIS instance --
        // kept anyway so the "clear on every lock AND unlock transition"
        // contract is an explicit call at BOTH transitions, not an
        // accident of object lifetime a future refactor could silently
        // break (e.g. if this type is ever changed to reuse one
        // `ResealTrigger` across sessions).
        Task { await trigger.resetAttempts() }

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
        // CR-03: cancel any in-flight reseal fan-out FIRST -- before nilling
        // `resealUserKey` below, so the cancellation itself races nothing.
        // `fireResealTriggerIfPossible()`'s own post-await guard is the
        // second half of this fix: even if a suspension point is crossed
        // between this cancel and the task noticing, the guard stops it
        // from doing any further key/network work.
        resealTask?.cancel()
        resealTask = nil
        // Lock transition -- clears the attempted-pair set (same contract
        // `start(...)`'s own comment documents for the unlock side) BEFORE
        // dropping the reference, so a pair that failed transiently this
        // session is retried from a clean slate whenever the NEXT
        // `start(...)` builds a fresh `ResealTrigger`.
        if let resealTrigger {
            Task { await resealTrigger.resetAttempts() }
        }
        resealTrigger = nil
        resealBaseURL = nil
        resealTokenProvider = nil
        resealUserKey = nil
    }

    /// Plan 40-10: fires the reseal fan-out for the current pull cycle,
    /// fire-and-forget -- `Task { ... }` here is never `await`ed by this
    /// function's own caller (`pull()`), so this can neither delay nor fail
    /// the vault refresh that already completed by the time this runs.
    ///
    /// Fetches `family_wide_pending` itself (`SharedItemsStore
    /// .fetchFamilyWidePending`, the SAME production call plan 40-05 already
    /// built) rather than duplicating that request -- `ResealTrigger`'s own
    /// header explains why fetching is deliberately NOT that type's job.
    /// This is the "one query, two consumers" split `resealTrigger.ts`'s own
    /// header describes: `PendingKeyState`'s `missing` axis is the OTHER
    /// consumer, wired by a future call site, not duplicated here.
    ///
    /// A no-op when the coordinator has not been `start`ed (or has since
    /// been `stop`ped) -- the four `guard let` bindings below all come from
    /// `start(...)`'s own parameters, so a `nil` here just means "no active
    /// session to reseal on behalf of", never a crash.
    private func fireResealTriggerIfPossible() {
        guard let resealTrigger, let resealBaseURL, let resealTokenProvider, let resealUserKey else { return }
        // WR-04: `pull()` runs on a 30-second timer, every socket push, and
        // every foreground transition -- without this cache, a caller with
        // no family (this product's primary self-hoster persona) issued
        // this request, and logged its 404/403 failure at `.error`,
        // forever, on every one of those cadences.
        guard !hasNoFamily else { return }
        // CR-03: cancel any still-running cycle from a previous pull before
        // starting a new one -- `stop()` already cancels on lock, this
        // covers the (rarer) case of two pull cycles racing while unlocked.
        resealTask?.cancel()
        resealTask = Task { [weak self] in
            do {
                let pending = try await SharedItemsStore.fetchFamilyWidePending(
                    baseURL: resealBaseURL, tokenProvider: resealTokenProvider
                )
                // CR-03: the vault may have been locked (or locked and
                // re-unlocked with a NEW key) while that round trip was in
                // flight -- `stop()` nils `resealUserKey` on lock. Re-read
                // `self.resealUserKey` here rather than reusing the value
                // captured in the outer `guard let` above: using the STALE
                // captured key is exactly the CR-03 bug (a key handle the
                // user has locked away kept alive inside a running task).
                // Mirrors `VaultStore.performRefresh`'s own post-await lock
                // re-check for exactly this shape.
                guard
                    !Task.isCancelled, let self,
                    let liveUserKey = self.resealUserKey, let liveTrigger = self.resealTrigger
                else { return }
                _ = await liveTrigger.run(resealable: pending.resealable, userKey: liveUserKey)
            } catch {
                // WR-04: a 404/403 here means "this caller is not an
                // active member of any family" -- not a genuine sync
                // failure, so it must never compete with WR-01 (39-REVIEW
                // .md)'s own `.error` logging for a real failure's
                // visibility. Cached for the rest of this session so the
                // request itself stops being reissued at all.
                if case let PvApiError.httpError(status, _) = error, status == 404 || status == 403 {
                    self?.hasNoFamily = true
                    Self.log.debug("reseal trigger: caller is not in a family -- skipping for this session")
                    return
                }
                Self.log.error("reseal-trigger pending fetch failed: \(String(describing: error), privacy: .public)")
            }
        }
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
