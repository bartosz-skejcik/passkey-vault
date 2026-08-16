//
//  VaultStoreRoundTripTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02, Task 2.
//
//  Runs against the REAL `PvFfi.xcframework` -- there is no mock of the FFI
//  anywhere in this file, and that is load-bearing rather than stylistic.
//  This repo already shipped a green crypto test that passed only because
//  the crypto was mocked (`ios/IOS-SPIKE-LOG.md`, the extension live-proof
//  standard); a mocked crypto test is not evidence for a crypto claim.
//
//  What this file can and cannot prove:
//
//  * It CAN prove the encrypt -> wire-JSON -> decrypt path composes on
//    device/simulator through the real library, that the JSON shape is the
//    number-array one, and that the AAD binding is live.
//  * It CANNOT prove the row is decryptable by ANOTHER client. Nothing that
//    runs only on iOS can. That is E-W1 (Task 3), which asserts on the
//    RECEIVING side in the web client, in both directions.
//

import Foundation
import Testing
@testable import PasskeyVault

struct VaultStoreRoundTripTests {

    /// Authored in this file, never produced by the code under test.
    private static let noteName = "38-02 round trip fixture"
    private static let noteBody = "linia jeden\nlinia dwa — z ogonkami i \u{1F510}"

    /// The whole tracer path, minus the network: mint id -> encrypt through
    /// `pv-ffi`'s `encryptItemWire` -> decrypt through `decryptItemWire` ->
    /// decode into the Swift field model.
    @Test
    func noteRoundTripsThroughTheRealFrameworkAndDecodesIntoTheFieldModel() throws {
        let userKey = try FfiUserKey.generate()
        let id = VaultStore.mintItemId()

        // The id must be lowercase UUID shape. Foundation mints UPPERCASE,
        // every other client mints lowercase, and the id is bound into the
        // AEAD associated data -- so this is a correctness assertion, not a
        // cosmetic one.
        #expect(
            id.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", options: .regularExpression) != nil,
            "minted id must be a lowercase UUID, got \(id)"
        )
        #expect(id.count == 36)

        let fields = NoteFields(name: Self.noteName, folderId: nil, tags: [], body: Self.noteBody)
        let plaintext = try ItemNormalize.plaintextJSON(for: .note(fields))

        let wire = try encryptItemWire(
            userKey: userKey, plaintext: plaintext, itemId: id, revision: 1
        )

        // The Swift side sees the wire shape too, and it must be the
        // number-array one. `wire_shape.rs` asserts this in Rust; asserting
        // it again HERE proves the bytes survived the UniFFI boundary
        // unchanged rather than that the Rust test's own fixture was fine.
        let encKey = try #require(
            try JSONSerialization.jsonObject(with: Data(wire.encKeyJson.utf8)) as? [String: Any]
        )
        #expect(
            encKey["nonce"] is [Any],
            "enc_key.nonce must arrive in Swift as a JSON array, not a base64 string (DR-38-C)"
        )
        #expect(encKey["nonce"] as? String == nil)

        let recovered = try decryptItemWire(
            userKey: userKey,
            encKeyJson: wire.encKeyJson,
            encDataJson: wire.encDataJson,
            itemId: id,
            revision: 1
        )
        let normalized = try ItemNormalize.normalizeItemFields(fromPlaintext: recovered)
        guard case let .note(decoded) = normalized else {
            Issue.record("expected a .note, got \(normalized.typeName)")
            return
        }

        #expect(decoded == fields)
        #expect(decoded.name == Self.noteName)
        #expect(decoded.body == Self.noteBody)
        #expect(normalized.typeName == "note")
    }

    /// The AAD binding, observed from Swift. Without this the round-trip test
    /// above would still pass if `pv-ffi` ignored `itemId` entirely -- i.e.
    /// it would be a check that cannot fail for the reason it claims to.
    @Test
    func aWrongItemIdIsRejectedWithACatchableErrorNotAProcessKill() throws {
        let userKey = try FfiUserKey.generate()
        let id = VaultStore.mintItemId()
        let wire = try encryptItemWire(
            userKey: userKey,
            plaintext: #"{"type":"note","name":"x","folderId":null,"tags":[],"body":"y"}"#,
            itemId: id,
            revision: 1
        )

        #expect(throws: (any Error).self) {
            _ = try decryptItemWire(
                userKey: userKey,
                encKeyJson: wire.encKeyJson,
                encDataJson: wire.encDataJson,
                itemId: id.uppercased(),
                revision: 1
            )
        }
    }

    /// The exact shape Foundation's `JSONEncoder` would have produced for a
    /// `Data` field must be REJECTED, not silently accepted -- and it must
    /// come back as a throw, never a `fatalError` (which is what a non-
    /// `Result`-returning Rust export would have produced; see `pv-ffi`'s
    /// `lib.rs` module header).
    @Test
    func aBase64ShapedEnvelopeIsRejected() throws {
        let userKey = try FfiUserKey.generate()
        let id = VaultStore.mintItemId()
        let wire = try encryptItemWire(
            userKey: userKey,
            plaintext: #"{"type":"note","name":"x","folderId":null,"tags":[],"body":"y"}"#,
            itemId: id,
            revision: 1
        )

        // Re-encode enc_key the way Foundation would, from the real bytes.
        let real = try #require(
            try JSONSerialization.jsonObject(with: Data(wire.encKeyJson.utf8)) as? [String: [Int]]
        )
        let b64 = { (bytes: [Int]) in Data(bytes.map { UInt8($0) }).base64EncodedString() }
        let foundationShaped = String(
            data: try JSONSerialization.data(
                withJSONObject: [
                    "nonce": b64(real["nonce"]!),
                    "ciphertext": b64(real["ciphertext"]!),
                ]
            ),
            encoding: .utf8
        )!

        #expect(throws: (any Error).self) {
            _ = try decryptItemWire(
                userKey: userKey,
                encKeyJson: foundationShaped,
                encDataJson: wire.encDataJson,
                itemId: id,
                revision: 1
            )
        }
    }

    /// `GET /api/sync`'s untagged enum has two shapes on the wire and the
    /// server returns the SHORT one on every pull where nothing changed --
    /// i.e. almost always. A decoder with a required `items` key throws
    /// there. Both branches are decoded from hand-written literals matching
    /// `crates/pv-server/src/routes/sync.rs:70-81`.
    @Test
    func syncResponseDecodesBothBranchesOfTheUntaggedServerEnum() throws {
        let upToDate = try JSONDecoder().decode(
            SyncResponse.self, from: Data(#"{"revision":7}"#.utf8)
        )
        guard case let .upToDate(revision) = upToDate else {
            Issue.record("expected the revision-only branch, got \(upToDate)")
            return
        }
        #expect(revision == 7)

        let snapshotJSON = """
        {"revision":9,"items":[{"id":"aa","enc_key":"{}","enc_data":"{}","revision":1,\
        "updated_at":"2026-08-16T00:00:00Z","last_used_at":null,"is_shared":false,\
        "collection_id":null,"last_editor_email":null}],"folders":[{"id":"bb","enc_name":"{}"}]}
        """
        let snapshot = try JSONDecoder().decode(
            SyncResponse.self, from: Data(snapshotJSON.utf8)
        )
        guard case let .snapshot(rev, items, folders) = snapshot else {
            Issue.record("expected the snapshot branch, got \(snapshot)")
            return
        }
        #expect(rev == 9)
        #expect(items.count == 1)
        #expect(items[0].id == "aa")
        #expect(folders.count == 1)
        #expect(folders[0].id == "bb")
    }
}
