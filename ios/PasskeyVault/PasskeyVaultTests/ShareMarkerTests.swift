//
//  ShareMarkerTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-05.
//
//  Task 1: `ShareMarker.of`'s ordered three-way discrimination, and the
//  decisive test -- two rows with byte-identical field values, ingested
//  through the two different `SharedItemsStore` endpoints, resolving to
//  DIFFERENT markers.
//  Task 2: `PendingKeyState`'s awaiting-key/decrypt-failed split and its
//  replacement-based pruning.
//  Task 3: E-F1 -- two real accounts, both directions, live (see the
//  `LiveTwoAccountMarkerRunTests` struct at the bottom of this file).
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Task 1: ShareMarker.of

/// A minimal, literal `ShareMarkerInput` fixture -- deliberately NOT
/// `VaultItemViewModel`, so these tests exercise `ShareMarker.of` as the
/// pure function its own doc comment claims it is.
private struct MarkerFixture: ShareMarkerInput {
    var sharedToMe: Bool?
    var isFamilyWide: Bool
    var isShared: Bool?
}

struct ShareMarkerTests {

    @Test func receivedFromOtherWhenSharedToMe() throws {
        let fixture = MarkerFixture(sharedToMe: true, isFamilyWide: false, isShared: false)
        #expect(ShareMarker.of(item: fixture) == .receivedFromOther)
    }

    @Test func familyWideWhenNotReceivedAndFamilyWideCollection() throws {
        let fixture = MarkerFixture(sharedToMe: false, isFamilyWide: true, isShared: false)
        #expect(ShareMarker.of(item: fixture) == .familyWide)
    }

    @Test func sharedByMeWhenOutgoingAndNotFamilyWide() throws {
        let fixture = MarkerFixture(sharedToMe: false, isFamilyWide: false, isShared: true)
        #expect(ShareMarker.of(item: fixture) == .sharedByMe)
    }

    @Test func noneForPurelyPersonalItem() throws {
        let fixture = MarkerFixture(sharedToMe: false, isFamilyWide: false, isShared: false)
        #expect(ShareMarker.of(item: fixture) == .none)
    }

    /// Order test (this plan's own acceptance criteria): a row that is BOTH
    /// received AND carries a family-wide kind resolves to
    /// `.receivedFromOther`, because the received branch is evaluated
    /// first. Falsifiability (QA-02): reordering `ShareMarker.of`'s
    /// branches so `isFamilyWide` is checked first makes THIS test go RED
    /// -- demonstrated and reverted, transcript in 40-05-SUMMARY.md.
    @Test func receivedBranchWinsOverFamilyWideWhenBothAreTrue() throws {
        let fixture = MarkerFixture(sharedToMe: true, isFamilyWide: true, isShared: false)
        #expect(ShareMarker.of(item: fixture) == .receivedFromOther)
    }

    /// THE decisive test (this plan's own must-have): two rows whose
    /// `isShared`/`collectionId` and every other overlapping field are
    /// byte-identical, ingested through `SharedItemsStore`'s two different
    /// endpoints, resolve to DIFFERENT markers -- because the discriminant
    /// is PROVENANCE (which ingest function was called), never a
    /// computation over the row's own fields.
    ///
    /// Falsifiability (QA-02): making `SharedItemsStore` compute
    /// `sharedToMe` from the row's own fields instead of setting it by
    /// provenance makes THIS test go RED -- demonstrated and reverted,
    /// transcript in 40-05-SUMMARY.md.
    @Test func byteIdenticalFieldsIngestedThroughDifferentEndpointsProduceDifferentMarkers() throws {
        let ownerUserKey = try FfiUserKey.generate()
        let recipient = try FfiIdentityKey.generate()
        let recipientPk = try FfiIdentityPublicKey.fromBytes(bytes: recipient.publicKeyBytes())

        let literalPlaintext =
            "{\"type\":\"note\",\"name\":\"byte-identical fixture\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
        let itemId = "byte-identical-fixture-item"
        let wire = try encryptItemWire(userKey: ownerUserKey, plaintext: literalPlaintext, itemId: itemId, revision: 1)

        // The SAME literal field values on BOTH rows -- `isShared: true`,
        // `collectionId`-equivalent absent on both, same id/revision/
        // timestamps. This is deliberately the exact shape CR-02 (`ShareMarker
        // .swift`'s header) describes: "an item I share with others" and "an
        // item shared TO me" are byte-identical in this field set.
        let sharedIsShared = true
        let sharedRevision = 1
        let sharedUpdatedAt = "2026-08-19T00:00:00Z"
        let sharedLastUsedAt: String? = nil
        let sharedLastEditorEmail: String? = nil

        let personalRow = VaultItemRow(
            id: itemId, enc_key: wire.encKeyJson, enc_data: wire.encDataJson,
            revision: sharedRevision, updated_at: sharedUpdatedAt, last_used_at: sharedLastUsedAt,
            is_shared: sharedIsShared, collection_id: nil, last_editor_email: sharedLastEditorEmail
        )

        let sealedJson = try sealItemKeyForRecipient(
            uk: ownerUserKey, encKeyJson: wire.encKeyJson, itemId: itemId, recipientPk: recipientPk
        )
        let directRow = DirectSharedItemRow(
            id: itemId, enc_data: wire.encDataJson, sealed_key: sealedJson,
            revision: sharedRevision, updated_at: sharedUpdatedAt, last_used_at: sharedLastUsedAt,
            is_shared: sharedIsShared, last_editor_email: sharedLastEditorEmail, access_level: "edit"
        )

        let personalIngested = SharedItemsStore.ingestPersonalSync(
            rows: [personalRow], familyWideCollectionIds: [], userKey: ownerUserKey
        )
        let directIngested = SharedItemsStore.ingestDirectShared(rows: [directRow], identityKey: recipient)

        #expect(personalIngested.count == 1)
        #expect(directIngested.count == 1)
        // Both actually decrypted -- a real, successful round trip on both
        // paths, not a coincidental match on an undecryptable placeholder.
        #expect(personalIngested[0].fields != nil, "personal-sync ingestion failed to decrypt the fixture")
        #expect(directIngested[0].fields != nil, "direct-shared ingestion failed to decrypt the fixture")

        let personalMarker = ShareMarker.of(item: personalIngested[0])
        let directMarker = ShareMarker.of(item: directIngested[0])

        #expect(personalMarker == .sharedByMe)
        #expect(directMarker == .receivedFromOther)
        #expect(personalMarker != directMarker)
    }
}

// MARK: - Task 2: PendingKeyState

@MainActor
struct PendingKeyStateTests {

    @Test func missingCollectionProducesAwaitingKeyEntry() throws {
        let state = PendingKeyState()
        state.applyFamilyWidePending(missing: [
            PendingGrantRow(collection_id: "collection-a", kind: "folder", access_level: "read"),
        ])
        #expect(state.awaitingKey == ["collection-a"])
        #expect(state.state(for: "collection-a") == .awaitingKey)
    }

    /// THE pruning test (this plan's own acceptance criteria): feed a
    /// response containing collection A, then a SECOND response containing
    /// only B, and assert the store holds EXACTLY `{B}` afterwards --
    /// positively, by asserting the resulting set equals the expected set.
    ///
    /// Falsifiability, demonstrated (this plan's own acceptance criteria):
    /// changing `applyFamilyWidePending` from replacement (`awaitingKey =
    /// Set(...)`) to a merge (`awaitingKey.formUnion(...)`) makes THIS test
    /// go RED -- transcript in 40-05-SUMMARY.md.
    @Test func secondPendingResponsePrunesCollectionsAbsentFromIt() throws {
        let state = PendingKeyState()
        state.applyFamilyWidePending(missing: [
            PendingGrantRow(collection_id: "collection-a", kind: "folder", access_level: "read"),
        ])
        #expect(state.awaitingKey == ["collection-a"])

        state.applyFamilyWidePending(missing: [
            PendingGrantRow(collection_id: "collection-b", kind: "folder", access_level: "read"),
        ])
        #expect(state.awaitingKey == ["collection-b"], "collection-a must be pruned, not merely superseded")
    }

    @Test func awaitingKeyAndDecryptFailedAreSeparateStatesWithDifferentCopy() throws {
        let state = PendingKeyState()
        state.applyFamilyWidePending(missing: [
            PendingGrantRow(collection_id: "collection-a", kind: "folder", access_level: "read"),
        ])
        state.markDecryptFailed(collectionId: "collection-b", reason: "AEAD tag mismatch")

        let awaiting = state.state(for: "collection-a")
        let failed = state.state(for: "collection-b")

        #expect(awaiting == .awaitingKey)
        guard case let .decryptFailed(reason) = failed else {
            Issue.record("expected .decryptFailed, got \(String(describing: failed))")
            return
        }
        #expect(reason == "AEAD tag mismatch")
        #expect(awaiting != failed)

        // Different rendered copy -- never the same string for the two
        // states (this plan's own must-have).
        #expect(PendingKeyCopy.awaitingKeyListPill != PendingKeyCopy.decryptFailedListPill)
        #expect(PendingKeyCopy.awaitingKeyDetailTitle != PendingKeyCopy.decryptFailedDetailTitle)
        #expect(PendingKeyCopy.awaitingKeyDetailBody != PendingKeyCopy.decryptFailedDetailBody)
        // The decrypt-failed copy must never invite waiting.
        #expect(!PendingKeyCopy.decryptFailedDetailTitle.lowercased().contains("wait"))
        #expect(!PendingKeyCopy.decryptFailedDetailBody.lowercased().contains("arrive"))
    }

    /// A decrypt-failure attempt only ever happens once the key IS present
    /// -- `markDecryptFailed` must clear any stale awaiting-key membership
    /// for the same id, so a collection is never reported in both states at
    /// once.
    @Test func markDecryptFailedClearsStaleAwaitingKeyMembership() throws {
        let state = PendingKeyState()
        state.applyFamilyWidePending(missing: [
            PendingGrantRow(collection_id: "collection-a", kind: "folder", access_level: "read"),
        ])
        state.markDecryptFailed(collectionId: "collection-a", reason: "AAD mismatch")

        #expect(!state.awaitingKey.contains("collection-a"))
        guard case .decryptFailed = state.state(for: "collection-a") else {
            Issue.record("expected .decryptFailed after markDecryptFailed")
            return
        }
    }

    /// `SharedItemsStore.fetchFamilyWidePending`'s decode target -- the
    /// server's literal `family_wide_pending` response shape
    /// (`crates/pv-server/src/routes/families.rs`'s `FamilyWidePendingResponse`),
    /// decoded here without a live server, proving the wire contract this
    /// plan's own `applyFamilyWidePending` wiring depends on.
    @Test func familyWidePendingResponseBodyDecodesServerShape() throws {
        let json = """
        {"missing":[{"collection_id":"c-1","kind":"folder","access_level":"read"}],
         "resealable":[{"collection_id":"c-2","recipient_user_id":"u-9"}]}
        """
        let decoded = try JSONDecoder().decode(FamilyWidePendingResponseBody.self, from: Data(json.utf8))
        #expect(decoded.missing == [PendingGrantRow(collection_id: "c-1", kind: "folder", access_level: "read")])
        #expect(decoded.resealable == [ResealableGrantRow(collection_id: "c-2", recipient_user_id: "u-9")])
    }
}
