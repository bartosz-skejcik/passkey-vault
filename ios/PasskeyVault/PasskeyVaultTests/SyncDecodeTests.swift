//
//  SyncDecodeTests.swift
//  PasskeyVaultTests
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03, Task 1.
//
//  Decodes the TWO response bodies `scripts/sync-contract-probe.sh` captured
//  live from an unmodified `pv-server` in plan 39-01, byte for byte, straight
//  off disk (`#filePath`, the same technique `InfoPlistLocalizationTests.swift`
//  and `ContrastTests.swift` already use for reading a real project file
//  rather than a hand-written fixture) -- never a string literal typed by
//  this file's author. A fixture an author writes always carries the item
//  list, which is exactly why the up-to-date branch's missing-key shape
//  (L-22, `ios/IOS-SPIKE-LOG.md` §3) is invisible to a unit suite that reads
//  its own hand-rolled JSON.
//
//  Also covers `CiphertextCacheStore`'s round-trip contract (D-11, D-15,
//  D-19) against a FAKE App Group container -- `FakeContainerFileManager`
//  below overrides `containerURL(forSecurityApplicationGroupIdentifier:)`
//  on the SAME `fileManager:` seam `AppGroupCiphertextCacheStore` already
//  exposes for production use, pointed at a throwaway `mktemp`-style
//  directory. This is the real store type under test, not a second
//  reimplementation of it -- only the container resolution is faked.
//

import CryptoKit
import Foundation
import Testing
@testable import PasskeyVault

struct SyncDecodeTests {

    // MARK: - Reading the captured server bodies straight off disk

    /// These are the bytes `scripts/sync-contract-probe.sh` captured live
    /// from a real `pv-server` in plan 39-01 -- lifted OUT of
    /// `ios/evidence/39/01-server-contract.md` and into their own fixture
    /// files here.
    ///
    /// Why they moved (found by Phase 41's verification, fixed in Phase 42):
    /// this suite used to parse the fenced ```json blocks out of the
    /// evidence markdown itself. That file is REWRITTEN by
    /// `scripts/ios-live-server.sh` on every live run, and Phase 40's
    /// commit `6701e61` overwrote it with a version carrying no fenced
    /// blocks at all -- turning both decode tests permanently RED for
    /// reasons that had nothing to do with the decoder. A test whose input
    /// is a document other processes rewrite is a test that measures the
    /// document, not the code.
    ///
    /// The provenance the old arrangement was reaching for is preserved by
    /// the fixtures being byte-identical to what the probe captured
    /// (recovered from commit `0da012d`); the evidence file remains the
    /// human-readable record of the run, and is no longer load-bearing for
    /// any assertion.
    private static func capturedBody(_ name: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .appendingPathComponent("Fixtures")
            .appendingPathComponent(name)
        let data = try Data(contentsOf: url)
        guard let text = String(data: data, encoding: .utf8) else {
            throw TestSupportError.unreadableFixture(path: url.path)
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// (a) the snapshot branch, (b) the up-to-date branch (D-12).
    private static func fencedJSONBlock(_ index: Int) throws -> String {
        switch index {
        case 0: return try capturedBody("39-sync-snapshot-body.json")
        case 1: return try capturedBody("39-sync-uptodate-body.json")
        default: throw TestSupportError.unknownBody(index: index)
        }
    }

    private enum TestSupportError: Error, CustomStringConvertible {
        case unreadableFixture(path: String)
        case unknownBody(index: Int)

        var description: String {
            switch self {
            case let .unreadableFixture(path):
                return "captured-body fixture is missing or not UTF-8: \(path)"
            case let .unknownBody(index):
                return "no captured body at index \(index) -- this suite has two (snapshot, up-to-date)"
            }
        }
    }

    /// `CryptoKit.SHA256` -- a byte-equality COMPARISON over already-
    /// decrypted, non-secret ciphertext/ID strings, never a cryptographic
    /// primitive standing in for `pv-ffi` (this test never touches the User
    /// Key or any wrapping key).
    private static func sha256Hex(_ string: String) -> String {
        SHA256.hash(data: Data(string.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// `.sortedKeys` -- the SAME discipline `ItemNormalize.plaintextJSON`
    /// already documents ("Sorted keys so a decode/encode round trip is
    /// byte-stable and therefore comparable in a test"): two structurally
    /// EQUAL `CachedSnapshot` values, encoded independently, are only
    /// digest-comparable if key order is pinned rather than left to
    /// `JSONEncoder`'s own unspecified default.
    private static func sortedKeysJSONString(_ snapshot: CachedSnapshot) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return String(data: try encoder.encode(snapshot), encoding: .utf8)!
    }

    // MARK: - Fixtures

    /// WR-09 (39-REVIEW.md): the one `serverBaseURL` every fixture below
    /// shares, so `readCurrentSnapshot(accountId:serverBaseURL:)` call sites
    /// in this file stay in sync with what `snapshot()` actually wrote.
    private static let fixtureServerBaseURL = "http://127.0.0.1:8621"

    private static func item(id: String, encKey: String = "k", encData: String = "d") -> CachedSnapshot.Item {
        CachedSnapshot.Item(
            id: id, encKey: encKey, encData: encData, revision: 1,
            updatedAt: "2026-08-18 00:00:00", lastUsedAt: nil, isShared: false,
            collectionId: nil, lastEditorEmail: nil
        )
    }

    private static func snapshot(
        revision: Int, accountId: String, items: [CachedSnapshot.Item], folders: [CachedSnapshot.Folder] = []
    ) -> CachedSnapshot {
        CachedSnapshot(
            revision: revision, 1_755_555_555_000, accountId: accountId,
            serverBaseURL: Self.fixtureServerBaseURL, items: items, folders: folders
        )
    }

    /// Overrides ONLY container resolution -- `AppGroupCiphertextCacheStore`
    /// itself is exercised unmodified; this is not a second store
    /// implementation.
    private final class FakeContainerFileManager: FileManager {
        let containerDir: URL

        override init() {
            containerDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("pv-39-03-fake-appgroup-\(UUID().uuidString)")
            super.init()
            try? FileManager.default.createDirectory(at: containerDir, withIntermediateDirectories: true)
        }

        override func containerURL(forSecurityApplicationGroupIdentifier groupIdentifier: String) -> URL? {
            containerDir
        }
    }

    private static func freshStore() -> AppGroupCiphertextCacheStore {
        AppGroupCiphertextCacheStore(fileManager: FakeContainerFileManager())
    }

    // MARK: - 1/2. The two-case decode, over the LIVE-captured bodies

    @Test func decodingASnapshotBodyYieldsTheSnapshotCaseWithNonEmptyItems() throws {
        let json = try Self.fencedJSONBlock(0)
        let result = try JSONDecoder().decode(SyncPullResult.self, from: Data(json.utf8))
        guard case let .snapshot(revision, items, folders) = result else {
            Issue.record("expected the snapshot branch, got \(result)")
            return
        }
        #expect(revision == 1)
        #expect(!items.isEmpty, "the captured since=0 body carries a non-empty item list")
        #expect(items[0].id == "f5e2911d-6593-4daa-9c77-4a59aa1ea99a")
        #expect(folders.isEmpty)
    }

    @Test func decodingAnUpToDateBodyYieldsTheUpToDateCase() throws {
        let json = try Self.fencedJSONBlock(1)
        // D-12/L-22's own falsifiability control, re-run here: this body has
        // NO "items" key at all.
        #expect(!json.contains("items"), "the captured up-to-date body must carry no items key")
        let result = try JSONDecoder().decode(SyncPullResult.self, from: Data(json.utf8))
        guard case let .upToDate(revision) = result else {
            Issue.record("expected the up-to-date branch, got \(result) -- there is structurally no item collection on this branch to hand to a cache writer (D-12)")
            return
        }
        #expect(revision == 1)
    }

    // MARK: - 3. Store round trip, compared by digest over the serialized form

    @Test func writingASnapshotThenReadingItRoundTripsAllFields() throws {
        let store = Self.freshStore()
        let written = Self.snapshot(
            revision: 7, accountId: "alice@example.com",
            items: [Self.item(id: "item-1", encKey: "ek1", encData: "ed1")],
            folders: [CachedSnapshot.Folder(id: "folder-1", encName: "fn1")]
        )
        try store.write(written)
        let read = try #require(store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL))

        #expect(read == written)
        let writtenDigest = Self.sha256Hex(try Self.sortedKeysJSONString(written))
        let readDigest = Self.sha256Hex(try Self.sortedKeysJSONString(read))
        #expect(writtenDigest == readDigest, "the written and read-back snapshot must be digest-identical over their serialized form")
    }

    // MARK: - 4. Never-written vs. empty-but-present

    @Test func readingFromANeverWrittenStoreReportsAbsenceDistinguishableFromAnEmptySnapshot() throws {
        let neverWritten = Self.freshStore()
        #expect(neverWritten.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL) == nil)

        let emptyWritten = Self.freshStore()
        let empty = Self.snapshot(revision: 0, accountId: "alice@example.com", items: [], folders: [])
        try emptyWritten.write(empty)
        let read = emptyWritten.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL)
        #expect(read != nil, "an EXPLICITLY written empty snapshot must be distinguishable from 'never written'")
        #expect(read?.items.isEmpty == true)
    }

    // MARK: - 5. Cross-account rejection (D-19)

    @Test func snapshotWrittenForOneAccountIsRejectedWhenReadUnderAnotherAccount() throws {
        let store = Self.freshStore()
        try store.write(Self.snapshot(revision: 1, accountId: "alice@example.com", items: [Self.item(id: "a")]))
        #expect(store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL) != nil)
        #expect(
            store.readCurrentSnapshot(accountId: "mallory@example.com", serverBaseURL: Self.fixtureServerBaseURL) == nil,
            "a snapshot written for a different account must be REJECTED, not returned (D-19)"
        )
    }

    // MARK: - 5b. Cross-server rejection (WR-09, 39-REVIEW.md)

    @Test func snapshotWrittenForOneServerIsRejectedWhenReadUnderAnotherServer() throws {
        let store = Self.freshStore()
        try store.write(Self.snapshot(revision: 1, accountId: "alice@example.com", items: [Self.item(id: "a")]))
        #expect(store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL) != nil)
        #expect(
            store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: "https://a-different-server.example.invalid") == nil,
            "a snapshot written against a DIFFERENT server must be REJECTED, not returned -- the same account email against a different server must never be served the OTHER server's cached ciphertext (WR-09, 39-REVIEW.md)"
        )
    }

    // MARK: - 5c. Newer-schema rejection (WR-07, 39-REVIEW.md)

    @Test func aSnapshotWithABumpedSchemaVersionIsRejectedOnRead() throws {
        let fm = FakeContainerFileManager()
        let store = AppGroupCiphertextCacheStore(fileManager: fm)
        // `CachedSnapshot.init` always stamps `currentSchemaVersion` -- a
        // future client's bump has to be written as raw JSON, hand-rolled,
        // to simulate what this build cannot construct through the type's
        // own initialiser.
        let future: [String: Any] = [
            "schemaVersion": CachedSnapshot.currentSchemaVersion + 1,
            "revision": 1,
            "syncedAtMs": 1_755_555_555_000,
            "accountId": "alice@example.com",
            "serverBaseURL": Self.fixtureServerBaseURL,
            "items": [],
            "folders": [],
        ]
        let data = try JSONSerialization.data(withJSONObject: future)
        try data.write(to: fm.containerDir.appendingPathComponent(AppGroupCiphertextCacheStore.fileName))

        #expect(
            store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL) == nil,
            "a snapshot written under a NEWER schema version than this build understands must be rejected, not served (WR-07, 39-REVIEW.md)"
        )
    }

    // MARK: - 5e. CR-01 (41-REVIEW.md iteration 2): distinguishing a SCOPING
    // rejection from a genuine decode failure -- the capability
    // `CipherCacheReader.lookup` depends on to refuse a foreign-account/
    // foreign-server/unrecognized-schema blob BY NAME instead of widening
    // onto its own unscoped raw scan.

    @Test func rawSnapshotIsScopedOutReportsTrueForACrossAccountBlob() throws {
        let store = Self.freshStore()
        try store.write(Self.snapshot(revision: 1, accountId: "alice@example.com", items: [Self.item(id: "a")]))
        #expect(store.readCurrentSnapshot(accountId: "mallory@example.com", serverBaseURL: Self.fixtureServerBaseURL) == nil)
        #expect(
            store.rawSnapshotIsScopedOut(accountId: "mallory@example.com", serverBaseURL: Self.fixtureServerBaseURL),
            "a blob that decoded fine but belongs to a DIFFERENT account must be reported as scoped-out (CR-01), never treated as a decode failure"
        )
    }

    @Test func rawSnapshotIsScopedOutReportsTrueForACrossServerBlob() throws {
        let store = Self.freshStore()
        try store.write(Self.snapshot(revision: 1, accountId: "alice@example.com", items: [Self.item(id: "a")]))
        #expect(
            store.rawSnapshotIsScopedOut(accountId: "alice@example.com", serverBaseURL: "https://a-different-server.example.invalid"),
            "a blob written against a DIFFERENT server must be reported as scoped-out (CR-01)"
        )
    }

    @Test func rawSnapshotIsScopedOutReportsTrueForANewerSchemaBlob() throws {
        let fm = FakeContainerFileManager()
        let store = AppGroupCiphertextCacheStore(fileManager: fm)
        let future: [String: Any] = [
            "schemaVersion": CachedSnapshot.currentSchemaVersion + 1,
            "revision": 1,
            "syncedAtMs": 1_755_555_555_000,
            "accountId": "alice@example.com",
            "serverBaseURL": Self.fixtureServerBaseURL,
            "items": [],
            "folders": [],
        ]
        let data = try JSONSerialization.data(withJSONObject: future)
        try data.write(to: fm.containerDir.appendingPathComponent(AppGroupCiphertextCacheStore.fileName))

        #expect(
            store.rawSnapshotIsScopedOut(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL),
            "a blob written under a NEWER schema version must be reported as scoped-out (CR-01), not as an unreadable blob"
        )
    }

    @Test func rawSnapshotIsScopedOutReportsFalseWhenNothingWasEverWritten() throws {
        let store = Self.freshStore()
        #expect(store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL) == nil)
        #expect(
            !store.rawSnapshotIsScopedOut(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL),
            "a container that has never been written to is a decode/read failure, not a scoping rejection -- a caller must still fall through to the raw scan"
        )
    }

    @Test func rawSnapshotIsScopedOutReportsFalseForAGenuinelyMalformedBlob() throws {
        let fm = FakeContainerFileManager()
        let store = AppGroupCiphertextCacheStore(fileManager: fm)
        try Data("{ not valid json at all".utf8).write(to: fm.containerDir.appendingPathComponent(AppGroupCiphertextCacheStore.fileName))

        #expect(
            !store.rawSnapshotIsScopedOut(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL),
            "a blob that cannot even decode as SOME CachedSnapshot is a genuine decode failure -- it must never be reported as scoped-out"
        )
    }

    // MARK: - 5d. The current-account marker (WR-05, 39-REVIEW.md)

    @Test func writingASnapshotRecordsACurrentAccountMarkerThatPurgeClears() throws {
        let store = Self.freshStore()
        #expect(store.currentAccountMarker() == nil, "a fresh container must carry no marker")

        try store.write(Self.snapshot(revision: 1, accountId: "alice@example.com", items: [Self.item(id: "a")]))
        let marker = try #require(store.currentAccountMarker())
        #expect(marker.accountId == "alice@example.com")
        #expect(marker.serverBaseURL == Self.fixtureServerBaseURL)

        // The marker is what CredentialProviderViewController.renderFreshnessSurface()
        // (WR-05's own production call site) uses to discover which account to
        // pass to the account-scoped read -- round-trip it through that exact call.
        #expect(
            store.readCurrentSnapshot(accountId: marker.accountId, serverBaseURL: marker.serverBaseURL) != nil,
            "the marker must name an account/server pair the store can actually read a snapshot for"
        )

        store.purge()
        #expect(store.currentAccountMarker() == nil, "purge() must clear the marker together with the cache and the watermark (D-19)")
    }

    // MARK: - 6. Whole-replace, never a merge (D-15)

    @Test func applyingASecondSnapshotReplacesThePreviousItemSetEntirely() throws {
        let store = Self.freshStore()
        try store.write(Self.snapshot(
            revision: 1, accountId: "alice@example.com",
            items: [Self.item(id: "item-old"), Self.item(id: "item-kept")]
        ))
        try store.write(Self.snapshot(
            revision: 2, accountId: "alice@example.com",
            items: [Self.item(id: "item-kept"), Self.item(id: "item-new")]
        ))
        let read = try #require(store.readCurrentSnapshot(accountId: "alice@example.com", serverBaseURL: Self.fixtureServerBaseURL))
        let ids = Set(read.items.map(\.id))
        #expect(ids == ["item-kept", "item-new"])
        #expect(!ids.contains("item-old"), "an item present in the FIRST snapshot and absent from the SECOND must be absent afterwards -- no merge (D-15)")
    }
}
