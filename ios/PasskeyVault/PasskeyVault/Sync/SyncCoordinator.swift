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

@MainActor
final class SyncCoordinator {
    private let store: VaultStore

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

    /// Phase 39 has no lifecycle transport of its own yet (the socket and
    /// poll fallback are 39-04's) -- this is the same `pull()` above, named
    /// separately so a future `UIApplication.willEnterForegroundNotification`
    /// observer has an obvious, already-exercised call site to attach to
    /// rather than inventing its own.
    func foregroundPull() async throws {
        try await pull()
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
