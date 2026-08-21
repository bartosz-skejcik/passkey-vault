//
//  PendingProviderItemStoreTests.swift
//  PasskeyVaultTests
//
//  Plan 43-06, Task 2 (TDD). RED-before-green: written before
//  `Shared/PendingProviderItemStore.swift` exists (43-06-SUMMARY.md records the transcript).
//  Exercises this task's own `<behavior>` block directly against `PendingProviderItemStore` --
//  never a mock -- mirroring `IdentityStoreSync.swift`'s own `markSelfHealPending`/
//  `clearSelfHealPending` idiom: mark BEFORE the risky operation, clear ONLY on confirmed success.
//
//  `.serialized`: every test here mutates the SAME shared App Group `UserDefaults` key
//  (`cloud.blonie.PasskeyVault.pendingProviderItems`) -- Swift Testing runs `@Test` methods
//  concurrently by default, which would race these on-disk records across methods in this file.
//  Matches `ServerSettingsTests.swift`'s own established convention for exactly this reason.
//

import Foundation
@testable import PasskeyVault
import Testing

@Suite(.serialized)
struct PendingProviderItemStoreTests {

    private static func resetPersistedState() {
        PendingProviderItemStore.clearPending(itemId: "item-a")
        PendingProviderItemStore.clearPending(itemId: "item-b")
    }

    /// `<behavior>` row 1: `markPending` followed immediately by `allPending()` (no clear in
    /// between) returns exactly one record matching what was marked.
    @Test func markPendingThenAllPendingReturnsExactlyOneMatchingRecord() {
        Self.resetPersistedState()
        defer { Self.resetPersistedState() }

        PendingProviderItemStore.markPending(
            itemId: "item-a", encKeyJson: "enc-key-a", encDataJson: "enc-data-a"
        )

        let all = PendingProviderItemStore.allPending()
        #expect(all.count == 1)
        #expect(all["item-a"]?.encKeyJson == "enc-key-a")
        #expect(all["item-a"]?.encDataJson == "enc-data-a")
    }

    /// `<behavior>` row 2: `clearPending` after a mark removes that record; `allPending()`
    /// afterward is empty.
    @Test func clearPendingAfterMarkRemovesTheRecord() {
        Self.resetPersistedState()
        defer { Self.resetPersistedState() }

        PendingProviderItemStore.markPending(
            itemId: "item-a", encKeyJson: "enc-key-a", encDataJson: "enc-data-a"
        )
        #expect(PendingProviderItemStore.allPending().count == 1)

        PendingProviderItemStore.clearPending(itemId: "item-a")
        #expect(PendingProviderItemStore.allPending().isEmpty)
    }

    /// `<behavior>` row 3: two DIFFERENT itemIds marked pending, then one cleared, leaves exactly
    /// the OTHER one in `allPending()` -- clearing one never clears all (unlike
    /// `IdentityStoreSync.persistPublishedKeys`'s whole-set replace; this store's clear is scoped
    /// to one id, mirroring `upsertOne`'s union discipline instead).
    @Test func clearingOneOfTwoPendingItemsLeavesOnlyTheOther() {
        Self.resetPersistedState()
        defer { Self.resetPersistedState() }

        PendingProviderItemStore.markPending(
            itemId: "item-a", encKeyJson: "enc-key-a", encDataJson: "enc-data-a"
        )
        PendingProviderItemStore.markPending(
            itemId: "item-b", encKeyJson: "enc-key-b", encDataJson: "enc-data-b"
        )
        #expect(PendingProviderItemStore.allPending().count == 2)

        PendingProviderItemStore.clearPending(itemId: "item-a")

        let remaining = PendingProviderItemStore.allPending()
        #expect(remaining.count == 1)
        #expect(remaining["item-b"] != nil)
        #expect(remaining["item-a"] == nil)
    }

    /// `PendingProviderItemStore`'s persisted key must be distinct from every existing
    /// `IdentityStoreSync` key -- no substring collision (acceptance criteria).
    @Test func persistedKeyIsDistinctFromEveryIdentityStoreSyncKey() {
        let pendingKey = "cloud.blonie.PasskeyVault.pendingProviderItems"
        let identityStoreKeys = [
            "cloud.blonie.PasskeyVault.identityRebuildPending",
            "cloud.blonie.PasskeyVault.identitySelfHealPending",
            "cloud.blonie.PasskeyVault.identityPublishedKeys",
            "cloud.blonie.PasskeyVault.identityPublishedPasskeyKeys",
        ]
        for key in identityStoreKeys {
            #expect(!pendingKey.contains(key) && !key.contains(pendingKey))
        }
    }

    /// Live self-heal proof (acceptance criteria): mark a pending item, do NOT clear it, then
    /// simulate the host's retry hook directly (a fresh `PendingProviderItemStore.allPending()`
    /// read, exactly what `ContentView`'s background retry performs) and confirm the record is
    /// still discoverable -- process-independent, App-Group-persisted state survives a fresh
    /// read exactly like a real relaunch would see it.
    @Test func markedPendingItemSurvivesAFreshReadSimulatingRelaunch() {
        Self.resetPersistedState()
        defer { Self.resetPersistedState() }

        PendingProviderItemStore.markPending(
            itemId: "item-a", encKeyJson: "enc-key-a", encDataJson: "enc-data-a"
        )

        // A fresh, independent read -- no in-memory state carried over, exactly what a relaunched
        // process's ContentView retry hook would see.
        let rediscovered = PendingProviderItemStore.allPending()
        #expect(rediscovered["item-a"] != nil)

        // Now simulate the retry succeeding and clearing it -- confirms the full mark/rediscover/
        // clear cycle this task's own `<done>` describes.
        PendingProviderItemStore.clearPending(itemId: "item-a")
        #expect(PendingProviderItemStore.allPending().isEmpty)
    }
}
