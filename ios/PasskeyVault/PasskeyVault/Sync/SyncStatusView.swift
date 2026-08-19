//
//  SyncStatusView.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-06 (SYNC-04).
//
//  A CONNECTION INDICATOR ALONE IS PRECISELY THE IMPLICATION SYNC-04
//  FORBIDS. This product has no push notification and a backgrounded
//  process holds no live socket (the reasoning lives in
//  `SyncCoordinator.swift`'s own decision record, not repeated here) --
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
    /// CR-01 (39-REVIEW.md, iteration 2): `VaultStore.lastError` had no
    /// reader anywhere in the app -- a failed cache write (the memory
    /// mirror advancing, disk refusing) was silently swallowed, so this is
    /// the one place SYNC-04's "the timestamp must be honest" requirement
    /// is actually enforced end to end. `nil` renders nothing; this view
    /// never invents a message of its own.
    let lastError: String?
    /// Injected so this view's render is a pure function of its two
    /// arguments, mirroring `SyncFreshness.describe`'s own no-global-clock
    /// discipline up to this call site. Defaults to "now" for production
    /// call sites; evidence/test call sites can pin it.
    var reference: Date = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: SyncFreshness.describe(syncedAtMs: snapshot?.syncedAtMs, reference: reference))
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("vault.sync.lastSynced")
            if let lastError {
                Text(verbatim: lastError)
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("vault.sync.lastError")
            }
        }
    }
}
