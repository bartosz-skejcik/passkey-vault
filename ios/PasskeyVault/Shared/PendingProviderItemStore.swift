//
//  PendingProviderItemStore.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Plan 43-06 (OPT-03), Task 2. The kill-mid-POST self-heal for the AutoFill extension's new
//  `VaultAPI.createItem` capability (Task 1, DR-43-A, `ios/IOS-SPIKE-LOG.md` §1) -- mirroring
//  `IdentityStoreSync.swift`'s own `markSelfHealPending`/`clearSelfHealPending` idiom EXACTLY:
//  mark BEFORE the risky operation, clear ONLY on confirmed success, so a process kill mid-flight
//  (the extension is torn down the instant `completeRequest` returns, same hazard `IdentityStoreSync`
//  already documents for its own single-item write) leaves an explicit, discoverable repair
//  obligation rather than a silently orphaned server-side item.
//
//  Concept precedent (not code -- language differs): `extension/entrypoints/background/
//  provider-ceremony.ts`'s own `writePendingProviderItem`/`persistPendingProviderItem` mark/
//  attempt/clear shape, on the browser-extension side of this project.
//
//  Persisted key (`cloud.blonie.PasskeyVault.pendingProviderItems`) is a NEW key, distinct from
//  every existing `IdentityStoreSync` key (`identityRebuildPending`/`identitySelfHealPending`/
//  `identityPublishedKeys`/`identityPublishedPasskeyKeys`) -- no substring collision, proven by
//  `PendingProviderItemStoreTests.persistedKeyIsDistinctFromEveryIdentityStoreSyncKey`.
//
//  This store's `clearPending(itemId:)` is scoped to ONE id (mirroring `IdentityStoreSync
//  .upsertOne`'s union discipline), unlike `IdentityStoreSync.persistPublishedKeys`'s whole-set
//  replace -- clearing one pending item must never clear all of them.
//

import Foundation

enum PendingProviderItemStore {
    private static let suiteName = "group.cloud.blonie.PasskeyVault"
    private static let pendingItemsKey = "cloud.blonie.PasskeyVault.pendingProviderItems"

    /// Exactly what `VaultAPI.createItem` needs to retry. `markedAt` is diagnostic only --
    /// deliberately never used for expiry logic in this task (a pending item stays pending, and
    /// discoverable, until it is either cleared by a successful retry or investigated by hand).
    struct PendingItem: Codable, Equatable {
        let itemId: String
        let encKeyJson: String
        let encDataJson: String
        let markedAt: Date
    }

    /// Marks `itemId` as owed BEFORE the caller performs its own fire-and-forget
    /// `VaultAPI.createItem` attempt. Overwrites any existing record for the SAME `itemId`
    /// (re-marking is idempotent, matching `IdentityStoreSync.markSelfHealPending`'s own
    /// idempotent `set(true, ...)`).
    static func markPending(itemId: String, encKeyJson: String, encDataJson: String) {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return }
        var all = readAll(defaults: defaults)
        all[itemId] = PendingItem(
            itemId: itemId, encKeyJson: encKeyJson, encDataJson: encDataJson, markedAt: Date()
        )
        write(all, defaults: defaults)
    }

    /// Clears ONLY `itemId`'s own record -- called only after a CONFIRMED successful
    /// `VaultAPI.createItem` retry, never speculatively. Idempotent: clearing an id with no
    /// pending record is a no-op, not an error.
    static func clearPending(itemId: String) {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return }
        var all = readAll(defaults: defaults)
        all.removeValue(forKey: itemId)
        write(all, defaults: defaults)
    }

    /// Every item still owed, keyed by `itemId`. The host's launch/foreground retry hook
    /// (`ContentView`) iterates this to attempt each one; the extension process reads nothing
    /// from this function today (Task 2's own scope is the mark side only -- the extension's
    /// registration call site, Plan 43-07, is what calls `markPending`).
    static func allPending() -> [String: PendingItem] {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return [:] }
        return readAll(defaults: defaults)
    }

    private static func readAll(defaults: UserDefaults) -> [String: PendingItem] {
        guard let data = defaults.data(forKey: pendingItemsKey),
              let decoded = try? JSONDecoder().decode([String: PendingItem].self, from: data)
        else { return [:] }
        return decoded
    }

    private static func write(_ items: [String: PendingItem], defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(items) else { return }
        defaults.set(data, forKey: pendingItemsKey)
    }
}
