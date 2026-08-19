//
//  VaultStoreMergeTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2) -- CR-06, CR-07, WR-16 regression coverage for
//  `VaultStore.mergeSharedAndFamilyWideItems()`'s two extracted, `static`,
//  directly-testable helpers: `applyMergedSharedItems` (the compute-then-
//  swap dedupe/apply step) and `resolveOwnCollectionAccessLevel` (which
//  level a family-wide collection's items are stamped with for THIS
//  caller). Both were previously inline in a private `async` method that
//  hits four HTTP endpoints -- untestable without a live server; extracting
//  them as pure `static` functions makes the exact defects this iteration
//  found falsifiable without one.
//

import Foundation
import Testing
@testable import PasskeyVault

@MainActor
struct VaultStoreMergeTests {

    /// Mirrors `RemoveMemberTests.swift`'s identical private helper --
    /// `encryptItemForCollection` returns one combined JSON object with
    /// `enc_key`/`enc_data` sub-objects; `VaultItemRow` (and every server
    /// row shape it mirrors) carries them as two separate opaque strings.
    private static func splitEncryptedItemJson(_ json: String) throws -> (encKeyJson: String, encDataJson: String) {
        let data = Data(json.utf8)
        let obj = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let encKeyObj = try #require(obj["enc_key"])
        let encDataObj = try #require(obj["enc_data"])
        let encKeyData = try JSONSerialization.data(withJSONObject: encKeyObj)
        let encDataData = try JSONSerialization.data(withJSONObject: encDataObj)
        return (String(decoding: encKeyData, as: UTF8.self), String(decoding: encDataData, as: UTF8.self))
    }

    // MARK: - CR-06: duplicate ids on merge

    /// THE decisive test (CR-06's own fix note): a personal snapshot row and
    /// a family-wide-collection-sync row sharing the SAME id must resolve to
    /// exactly one row after the merge is applied, and it must be the
    /// merged/provenance-bearing copy (never the stale personal one).
    ///
    /// Falsifiability: reverting `applyMergedSharedItems` to the pre-fix
    /// shape (`items.removeAll { previousSharedItemIds.contains($0.id) }`,
    /// unconditional append with no `mergedIds` check) makes this test go
    /// RED -- `items.map(\.id)` then contains the shared id twice.
    @Test func mergeDedupesAnIdThatAppearsInBothThePersonalSnapshotAndTheCollectionSync() throws {
        let sharedId = "item-shared-and-personal"
        let personalCopy = VaultItemViewModel(
            id: sharedId, revision: 1, content: .undecryptable(reason: "personal-arm placeholder"),
            sharedToMe: false, accessLevel: nil, isFamilyWide: false
        )
        let mergedCopy = VaultItemViewModel(
            id: sharedId, revision: 1, content: .undecryptable(reason: "collection-arm placeholder"),
            sharedToMe: false, accessLevel: "edit", isFamilyWide: true
        )

        let result = VaultStore.applyMergedSharedItems(
            existingItems: [personalCopy],
            merged: [mergedCopy],
            previousSharedItemIds: [], // first refresh after unlock -- CR-06's own worst case
            armFailed: false
        )

        let ids = result.items.map(\.id)
        #expect(ids.count == 1, "duplicate ids in the merged list: \(ids)")
        #expect(result.items.first?.isFamilyWide == true, "the merged/provenance-bearing row must win, not the stale personal copy")
        #expect(result.sharedItemIds == [sharedId])
        #expect(result.lastError == nil)
    }

    /// A personal-only item (never present in `merged`) must survive the
    /// merge untouched -- the dedupe must only ever remove ids `merged`
    /// itself is about to reintroduce, or ids this store already knows are
    /// shared from a previous cycle.
    @Test func mergeLeavesAPurelyPersonalItemUntouched() throws {
        let personalOnly = VaultItemViewModel(
            id: "purely-personal", revision: 1, content: .undecryptable(reason: "personal fixture"),
            sharedToMe: false, accessLevel: nil, isFamilyWide: false
        )

        let result = VaultStore.applyMergedSharedItems(
            existingItems: [personalOnly], merged: [], previousSharedItemIds: [], armFailed: false
        )

        #expect(result.items.map(\.id) == ["purely-personal"])
        #expect(result.sharedItemIds.isEmpty)
    }

    /// A shared item present LAST cycle (`previousSharedItemIds`) but absent
    /// from THIS cycle's `merged` (e.g. access was revoked) must be pruned
    /// on a successful cycle -- the removal set must cover ids from BOTH
    /// this cycle and the previous one, not just this cycle's.
    @Test func mergePrunesAPreviouslySharedItemNoLongerPresentOnSuccess() throws {
        let staleShared = VaultItemViewModel(
            id: "revoked-item", revision: 1, content: .undecryptable(reason: "stale fixture"),
            sharedToMe: true, accessLevel: "read", isFamilyWide: false
        )

        let result = VaultStore.applyMergedSharedItems(
            existingItems: [staleShared], merged: [], previousSharedItemIds: ["revoked-item"], armFailed: false
        )

        #expect(result.items.isEmpty, "a revoked share must not survive a successful merge cycle")
        #expect(result.sharedItemIds.isEmpty)
    }

    // MARK: - WR-16: arm-failure semantics (compute-then-swap)

    /// On a failed cycle, a previously-shared item this cycle did NOT
    /// re-confirm must be RETAINED (never silently dropped), and
    /// `lastError` must be set so the failure is surfaced.
    ///
    /// Falsifiability: the pre-fix shape removed `previousSharedItemIds`
    /// eagerly before the network calls even started, so a failure after
    /// that point returned with `items` already missing every previously
    /// shared row -- this test's `result.items` would be empty instead of
    /// retaining `stillShared`.
    @Test func armFailureRetainsPreviouslySharedItemsAndSurfacesAnError() throws {
        let stillShared = VaultItemViewModel(
            id: "still-shared", revision: 1, content: .undecryptable(reason: "retained fixture"),
            sharedToMe: true, accessLevel: "read", isFamilyWide: false
        )

        let result = VaultStore.applyMergedSharedItems(
            existingItems: [stillShared], merged: [], previousSharedItemIds: ["still-shared"], armFailed: true
        )

        #expect(result.items.map(\.id) == ["still-shared"], "a failed cycle must retain last cycle's shared rows")
        #expect(result.sharedItemIds == ["still-shared"])
        #expect(result.lastError != nil, "a failed merge cycle must surface an error, not fail silently")
    }

    /// Arm independence: even when the OTHER arm failed this cycle, an arm
    /// that DID succeed (e.g. direct shares, while `listCollections()`
    /// failed) must still be applied and deduped against the id it
    /// previously held -- not discarded wholesale by the failure.
    @Test func armFailureStillAppliesTheArmThatSucceeded() throws {
        let freshDirectShare = VaultItemViewModel(
            id: "fresh-direct-share", revision: 2, content: .undecryptable(reason: "fresh fixture"),
            sharedToMe: true, accessLevel: "edit", isFamilyWide: false
        )

        let result = VaultStore.applyMergedSharedItems(
            existingItems: [], merged: [freshDirectShare], previousSharedItemIds: [], armFailed: true
        )

        #expect(result.items.map(\.id) == ["fresh-direct-share"])
        #expect(result.sharedItemIds == ["fresh-direct-share"])
        #expect(result.lastError != nil)
    }

    // MARK: - CR-07: the caller's own held level, never the propagation level

    /// THE decisive test (CR-07's own fix note): a collection whose
    /// PROPAGATION level (`familyWideAccessLevel`) is `read` but whose
    /// caller-held level (`accessLevel`) is `edit` (the creator's row,
    /// `collections::create`'s hard-coded `edit` regardless of the
    /// collection's declared level) must resolve to `edit` -- never `read`.
    ///
    /// Falsifiability: reverting `resolveOwnCollectionAccessLevel` to
    /// `record.familyWideAccessLevel ?? record.accessLevel ?? "read"` (the
    /// pre-fix precedence) makes this test go RED.
    @Test func resolvesTheCallerSOwnHeldLevelNeverThePropagationLevel() throws {
        let record = CollectionRecord(
            id: "collection-1", encName: "enc", createdAt: "2026-08-19T00:00:00Z",
            accessLevel: "edit", sealedKey: "sealed", familyWideKind: "folder", familyWideAccessLevel: "read"
        )

        #expect(VaultStore.resolveOwnCollectionAccessLevel(record: record) == "edit")
    }

    /// End-to-end downstream proof: the resolved level, once stamped onto a
    /// real decrypted `VaultItemViewModel` via `SharedItemsStore
    /// .ingestFamilyWideCollectionItems` (the actual production call site),
    /// makes `ItemCapabilities.canEditItem` return `true` for the
    /// collection's OWN creator -- the exact capability CR-07 restores.
    @Test func creatorOfAReadPropagationCollectionKeepsEditOnTheirOwnItems() throws {
        let ownerUserKey = try FfiUserKey.generate()
        let plaintext = "{\"type\":\"note\",\"name\":\"CR-07 fixture\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
        let itemId = "cr-07-fixture-item"
        let ck = try FfiCollectionKey.generate()
        let combinedJson = try encryptItemForCollection(
            ck: ck, plaintext: plaintext, collectionId: "collection-1", itemId: itemId, revision: 1
        )
        let (encKeyJson, encDataJson) = try Self.splitEncryptedItemJson(combinedJson)

        let row = VaultItemRow(
            id: itemId, enc_key: encKeyJson, enc_data: encDataJson,
            revision: 1, updated_at: "2026-08-19T00:00:00Z", last_used_at: nil,
            is_shared: true, collection_id: "collection-1", last_editor_email: nil
        )

        let record = CollectionRecord(
            id: "collection-1", encName: "enc", createdAt: "2026-08-19T00:00:00Z",
            accessLevel: "edit", sealedKey: "sealed", familyWideKind: "folder", familyWideAccessLevel: "read"
        )

        let ingested = SharedItemsStore.ingestFamilyWideCollectionItems(
            rows: [row], collectionId: "collection-1", collectionKey: ck,
            accessLevel: VaultStore.resolveOwnCollectionAccessLevel(record: record)
        )

        #expect(ingested.count == 1)
        #expect(ingested[0].fields != nil, "fixture failed to decrypt -- test is not exercising the real path")
        #expect(ItemCapabilities.canEditItem(ingested[0]) == true)
    }
}
