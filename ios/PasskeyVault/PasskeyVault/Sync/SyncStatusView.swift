//
//  SyncStatusView.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-06 (SYNC-04).
//
//  A CONNECTION INDICATOR ALONE IS PRECISELY THE IMPLICATION SYNC-04
//  FORBIDS. This product has no push notification and a backgrounded
//  process holds no live socket (SyncCoordinator's own SYNC-05 record) --
//  "connected" describes THIS process's transport at this instant, and says
//  nothing about whether the AutoFill extension (a separate process that
//  never syncs in this milestone) holds current data. A green dot with no
//  timestamp is exactly the shape T-39-24 exists to prevent.
//
//  So this view's PRIMARY content is the last-synced time -- sourced from
//  `CachedSnapshot.syncedAtMs` via `SyncFreshness`, never from a live
//  socket state. This app builds no connection indicator today; if one is
//  ever added here, it must render visibly SMALLER and MUTED relative to
//  this text, and its label must say "connection", never "synced" or
//  "up to date" -- the two say different things.
//

import SwiftUI

struct SyncStatusView: View {
    /// `nil` before any successful pull has ever completed for this
    /// account -- `SyncFreshness.describe`'s own `nil` contract.
    let snapshot: CachedSnapshot?
    /// Injected so this view's render is a pure function of its two
    /// arguments, mirroring `SyncFreshness.describe`'s own no-global-clock
    /// discipline up to this call site. Defaults to "now" for production
    /// call sites; evidence/test call sites can pin it.
    var reference: Date = Date()

    var body: some View {
        Text(verbatim: SyncFreshness.describe(syncedAtMs: snapshot?.syncedAtMs, reference: reference))
            .font(.caption)
            .foregroundStyle(Color("PVTextMuted"))
            .accessibilityIdentifier("vault.sync.lastSynced")
    }
}
