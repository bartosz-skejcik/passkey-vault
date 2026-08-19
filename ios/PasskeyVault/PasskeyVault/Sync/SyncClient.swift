//
//  SyncClient.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03. The REST half of
//  the sync layer: one injected base URL, one injected bearer-token
//  provider (this plan's own contract for this type), plus the persisted
//  cache store it reads the `since` watermark FROM -- no other source
//  (`key_links`: "CachedSnapshot.revision -> the only value ever sent as
//  GET /api/sync?since=").
//
//  Wraps `VaultAPI.sync(since:)` (Phase 38's transport, unmodified) rather
//  than re-implementing the HTTP call: `VaultAPI.requireStatus` already
//  throws on a non-2xx response instead of returning an empty/synthetic
//  result, so a failed pull can never be mistaken for an up-to-date answer
//  -- this type adds no second copy of that discipline, it reuses it.
//

import Foundation

struct SyncClient {
    let baseURL: URL
    let tokenProvider: () -> String?
    let cacheStore: CiphertextCacheStore
    let accountId: String
    var session: URLSession = .shared

    /// Reads the current on-disk snapshot's revision for `accountId` --
    /// `0` if none exists yet, or if the persisted snapshot belongs to a
    /// different account (`CiphertextCacheStore`'s absence contract, D-19)
    /// -- and sends exactly that value as `since`. No in-memory counter, no
    /// second watermark, is ever consulted.
    func pull() async throws -> SyncPullResult {
        let since = cacheStore.readCurrentSnapshot(accountId: accountId, serverBaseURL: baseURL.absoluteString)?.revision ?? 0
        let api = VaultAPI(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
        return try await api.sync(since: since)
    }
}
