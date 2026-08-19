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
//  Task 3: E-F1 -- two real accounts, both directions, live
//  (`ShareMarkerTests.liveTwoAccountMarkerRun`, an extension at the bottom
//  of this file -- named INSIDE `ShareMarkerTests`, not a separate struct,
//  so the plan's own gate (`-only-testing:.../ShareMarkerTests/
//  liveTwoAccountMarkerRun`) can target it by name and Tasks 1-2's unit
//  tests passing cannot stand in for it).
//

import Foundation
import Testing
import SwiftUI
import UIKit
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

// MARK: - Task 3: E-F1 -- two real accounts, both directions, live

enum LiveTwoAccountMarkerRunError: Error, CustomStringConvertible {
    case rowNotFound(String)
    case unexpectedSyncShape(String)
    case shareCreateFailed(status: Int, body: String)
    case screenshotRenderFailed

    var description: String {
        switch self {
        case let .rowNotFound(detail): return "row not found: \(detail)"
        case let .unexpectedSyncShape(detail): return "unexpected sync response shape: \(detail)"
        case let .shareCreateFailed(status, body): return "POST .../shares failed (\(status)): \(body)"
        case .screenshotRenderFailed: return "failed to render the E-F1 evidence screenshot"
        }
    }
}

/// The captured-for-the-record list view (this task's own screenshot
/// requirement, SC1's "wizualnie i tekstowo odróżnialne"). Deliberately
/// minimal -- three rows, each showing the item's display name and the
/// pill text a real list row would render for its resolved `ShareMarker`
/// (`ItemListView`'s own `pills(for:)` convention: `RowPill`-shaped
/// capsules, neutral `PVTextMuted`, never a semantic color -- see
/// `40-UI-SPEC.md` §3). This is NOT `ItemListView` itself -- rendering the
/// full production list would require a live `VaultStore`/navigation
/// stack this plain `Testing` struct does not construct -- but it renders
/// the SAME marker/pill vocabulary (`ShareMarker.pillText`/
/// `.accessibilityLabel`) the production row would, so a human looking at
/// the PNG is looking at the real discriminant, not a stand-in shape.
private struct EF1EvidenceRow: View {
    let name: String
    let marker: ShareMarker
    let count: Int

    private var pillText: String? {
        switch marker {
        case .receivedFromOther, .familyWide:
            return marker.dictionaryLabel
        case .sharedByMe:
            return marker.pillText(count: count)
        case .none:
            return nil
        }
    }

    var body: some View {
        HStack {
            Text(name)
                .font(.system(size: 15))
            Spacer()
            if let pillText {
                Text(pillText)
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(white: 0.5).opacity(0.15))
                    .foregroundStyle(Color(white: 0.35))
                    .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(name), \(marker.accessibilityLabel(count: count))"))
    }
}

private struct EF1EvidenceList: View {
    let xName: String
    let xMarker: ShareMarker
    let yName: String
    let yMarker: ShareMarker
    let zName: String
    let zMarker: ShareMarker

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("E-F1 -- Account B's list")
                .font(.system(size: 17, weight: .bold))
                .padding([.horizontal, .top], 16)
                .padding(.bottom, 8)
            Divider()
            EF1EvidenceRow(name: xName, marker: xMarker, count: 0)
            Divider()
            EF1EvidenceRow(name: yName, marker: yMarker, count: 1)
            Divider()
            EF1EvidenceRow(name: zName, marker: zMarker, count: 0)
        }
        .frame(width: 393)
        .background(Color.white)
    }
}

extension ShareMarkerTests {

    /// Same hardcoded-default-over-skip discipline as `AccountFlowLiveTests`/
    /// `FfiSharingLiveProofTests` (`PV_TEST_SERVER`, defaulting to
    /// `http://127.0.0.1:8621` -- this file's own precondition requires the
    /// caller to have started `scripts/ios-live-server.sh` on that exact
    /// default port before running this method).
    private static var liveServerBaseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// `#filePath` resolves to THIS file's absolute path at compile time,
    /// same technique `ContrastTests.swift`/`SyncDecodeTests.swift` already
    /// use to read/write real repo-relative paths from inside a simulator
    /// test process (the simulator process is NOT sandboxed away from the
    /// host disk the way a real device is).
    private static var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // PasskeyVault/
            .deletingLastPathComponent() // ios/
            .deletingLastPathComponent() // repo root
    }

    /// The gate's own path -- `.planning/phases/40-.../evidence/`. This
    /// plan's own instruction: never a `.planning/`-touching COMMIT, but
    /// the gate reads this path directly off disk, uncommitted.
    private static var planningEvidenceDirectory: URL {
        repoRoot
            .appendingPathComponent(".planning")
            .appendingPathComponent("phases")
            .appendingPathComponent("40-rodzina-i-wsp-dzielenie-na-telefonie")
            .appendingPathComponent("evidence")
    }

    /// The durable, committed mirror (`ios/evidence/40/`, per this
    /// project's established per-phase evidence convention).
    private static var durableEvidenceDirectory: URL {
        repoRoot.appendingPathComponent("ios").appendingPathComponent("evidence").appendingPathComponent("40")
    }

    /// Test-only write path: `POST /api/families` -- creates the singleton
    /// family with the caller (account A) as owner. Setup-only for this
    /// live run (see this method's own comment at its call site); not a
    /// production capability this plan adds.
    private static func createFamily(baseURL: URL, token: String, name: String) async throws {
        struct Body: Encodable { let name: String }
        let url = URL(string: "/api/families", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(Body(name: name))
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 201 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveTwoAccountMarkerRunError.shareCreateFailed(status: status, body: "createFamily: \(body)")
        }
    }

    /// Test-only write path: `POST /api/families/members` -- owner-only
    /// direct add of an already-registered user, no invite token. Setup-only
    /// for this live run.
    private static func addFamilyMember(baseURL: URL, ownerToken: String, memberUserId: String) async throws {
        struct Body: Encodable { let user_id: String }
        let url = URL(string: "/api/families/members", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(ownerToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(Body(user_id: memberUserId))
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 201 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveTwoAccountMarkerRunError.shareCreateFailed(status: status, body: "addFamilyMember: \(body)")
        }
    }

    /// Test-only write path: `POST /api/vault/items/{id}/shares`
    /// (`crates/pv-server/src/routes/vault.rs`'s `CreateItemShareRequest`).
    /// Deliberately NOT added to `VaultAPI.swift`/`Sharing/*.swift` --
    /// authoring a share from iOS is explicitly out of scope for this
    /// milestone's iOS surface (`40-UI-SPEC.md` §0.3); this helper exists
    /// ONLY so this live test can construct a real shared item to ingest
    /// and mark, the same way the external Node/pv-wasm harness would
    /// author account A's share in a two-process run.
    private static func createDirectShare(
        baseURL: URL, token: String, itemId: String,
        recipientUserId: String, sealedKeyJson: String, accessLevel: String
    ) async throws {
        struct Body: Encodable {
            let recipient_user_id: String
            let sealed_key: String
            let access_level: String
        }
        let url = URL(string: "/api/vault/items/\(itemId)/shares", relativeTo: baseURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(
            Body(recipient_user_id: recipientUserId, sealed_key: sealedKeyJson, access_level: accessLevel)
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard status == 201 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8>"
            throw LiveTwoAccountMarkerRunError.shareCreateFailed(status: status, body: body)
        }
    }

    /// E-F1: two real accounts, both directions, live -- see this file's
    /// header and `40-05-PLAN.md` Task 3. Account A shares item X directly
    /// to account B; account B shares item Y directly to account A; a
    /// purely personal item Z exists on B. All assertions run from B's own
    /// perspective: X must read `.receivedFromOther`, Y must read
    /// `.sharedByMe`, Z must read `.none` -- asserted positively, in the
    /// SAME run, against REAL decrypted rows pulled from a REAL isolated
    /// `pv-server` (never a fixture).
    ///
    /// Judgment call, recorded in 40-05-SUMMARY.md: both accounts drive
    /// the real `pv-ffi` seal/unseal/decrypt composition already proven
    /// end-to-end by plan 40-03's `directShareItemKeySealsAndRecipientDecryptsPlaintext`
    /// and cross-client-proven by plan 40-02's E-W2 -- this run's own job
    /// is proving the MARKER (ShareMarker/SharedItemsStore), not proving
    /// crypto interop a second time, so it does not additionally stand up
    /// an external Node/pv-wasm harness for account A's share.
    @MainActor
    @Test func liveTwoAccountMarkerRun() async throws {
        let baseURL = Self.liveServerBaseURL
        let runSuffix = String(Int(Date().timeIntervalSince1970))
        let emailA = "pv-ef1-a-\(runSuffix)@example.invalid"
        let emailB = "pv-ef1-b-\(runSuffix)@example.invalid"
        let password = "PvEF1-40-05-EvidencePassword!"

        let sessionA = try await AccountService(apiClient: PvApiClient(baseURL: baseURL))
            .register(email: emailA, password: password)
        let sessionB = try await AccountService(apiClient: PvApiClient(baseURL: baseURL))
            .register(email: emailB, password: password)

        let apiClient = PvApiClient(baseURL: baseURL)
        let meA = try await apiClient.me(token: sessionA.token)
        let meB = try await apiClient.me(token: sessionB.token)

        let identityA = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionA.token })
            .ensureOwnIdentityKeypair(userKey: sessionA.userKey)
        let identityB = try await IdentityService(baseURL: baseURL, tokenProvider: { sessionB.token })
            .ensureOwnIdentityKeypair(userKey: sessionB.userKey)
        let identityAPk = try FfiIdentityPublicKey.fromBytes(bytes: identityA.publicKeyBytes())
        let identityBPk = try FfiIdentityPublicKey.fromBytes(bytes: identityB.publicKeyBytes())

        // A direct `item_shares` grant requires BOTH accounts to already be
        // in the SAME family (`crates/pv-server/src/routes/vault.rs`'s
        // `create_share`, "recipient is not a family member" -- discovered
        // live, not anticipated from the plan's own read_first list; see
        // this plan's own SUMMARY for the correction). A is the owner, adds
        // B directly (`POST /api/families/members`, no invite token needed
        // for an already-registered user) -- this is NOT plan 40-06's
        // invite-link flow, it is the narrower owner-side add its OWN doc
        // comment describes, used here only as E-F1's setup step.
        try await Self.createFamily(baseURL: baseURL, token: sessionA.token, name: "E-F1 family \(runSuffix)")
        try await Self.addFamilyMember(baseURL: baseURL, ownerToken: sessionA.token, memberUserId: meB.userId)

        let vaultAPIA = VaultAPI(baseURL: baseURL, tokenProvider: { sessionA.token })
        let vaultAPIB = VaultAPI(baseURL: baseURL, tokenProvider: { sessionB.token })

        // Item X: A owns it, shares it DIRECTLY to B.
        let xId = VaultStore.mintItemId()
        let xPlaintext = "{\"type\":\"note\",\"name\":\"E-F1 item X (A shares to B)\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
        let xWire = try encryptItemWire(userKey: sessionA.userKey, plaintext: xPlaintext, itemId: xId, revision: 1)
        _ = try await vaultAPIA.createItem(id: xId, encKeyJson: xWire.encKeyJson, encDataJson: xWire.encDataJson)
        let xSealed = try sealItemKeyForRecipient(
            uk: sessionA.userKey, encKeyJson: xWire.encKeyJson, itemId: xId, recipientPk: identityBPk
        )
        try await Self.createDirectShare(
            baseURL: baseURL, token: sessionA.token, itemId: xId,
            recipientUserId: meB.userId, sealedKeyJson: xSealed, accessLevel: "edit"
        )

        // Item Y: B owns it, shares it DIRECTLY to A -- the reverse direction.
        let yId = VaultStore.mintItemId()
        let yPlaintext = "{\"type\":\"note\",\"name\":\"E-F1 item Y (B shares to A)\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
        let yWire = try encryptItemWire(userKey: sessionB.userKey, plaintext: yPlaintext, itemId: yId, revision: 1)
        _ = try await vaultAPIB.createItem(id: yId, encKeyJson: yWire.encKeyJson, encDataJson: yWire.encDataJson)
        let ySealed = try sealItemKeyForRecipient(
            uk: sessionB.userKey, encKeyJson: yWire.encKeyJson, itemId: yId, recipientPk: identityAPk
        )
        try await Self.createDirectShare(
            baseURL: baseURL, token: sessionB.token, itemId: yId,
            recipientUserId: meA.userId, sealedKeyJson: ySealed, accessLevel: "edit"
        )

        // Item Z: B owns it, purely personal -- no share at all.
        let zId = VaultStore.mintItemId()
        let zPlaintext = "{\"type\":\"note\",\"name\":\"E-F1 item Z (personal)\",\"folderId\":null,\"tags\":[],\"body\":\"\"}"
        let zWire = try encryptItemWire(userKey: sessionB.userKey, plaintext: zPlaintext, itemId: zId, revision: 1)
        _ = try await vaultAPIB.createItem(id: zId, encKeyJson: zWire.encKeyJson, encDataJson: zWire.encDataJson)

        // B's own view: ingest BOTH endpoints, exactly as `SharedItemsStore`
        // is meant to be used.
        let directResult = try await SharedItemsStore.fetchDirectShared(
            baseURL: baseURL, tokenProvider: { sessionB.token }, since: 0
        )
        guard case let .snapshot(_, directRows) = directResult else {
            throw LiveTwoAccountMarkerRunError.unexpectedSyncShape("expected a snapshot from /api/sync/shared/direct")
        }
        let directIngested = SharedItemsStore.ingestDirectShared(rows: directRows, identityKey: identityB)

        let personalResult = try await vaultAPIB.sync(since: 0)
        guard case let .snapshot(_, personalRows, _) = personalResult else {
            throw LiveTwoAccountMarkerRunError.unexpectedSyncShape("expected a snapshot from B's own /api/sync")
        }
        let personalIngested = SharedItemsStore.ingestPersonalSync(
            rows: personalRows, familyWideCollectionIds: [], userKey: sessionB.userKey
        )

        guard let xRow = directIngested.first(where: { $0.id == xId }) else {
            throw LiveTwoAccountMarkerRunError.rowNotFound("item X in B's direct-shared ingestion")
        }
        guard let yRow = personalIngested.first(where: { $0.id == yId }) else {
            throw LiveTwoAccountMarkerRunError.rowNotFound("item Y in B's personal-sync ingestion")
        }
        guard let zRow = personalIngested.first(where: { $0.id == zId }) else {
            throw LiveTwoAccountMarkerRunError.rowNotFound("item Z in B's personal-sync ingestion")
        }

        // Real decrypts, not undecryptable placeholders.
        #expect(xRow.fields != nil, "item X failed to decrypt on B's side")
        #expect(yRow.fields != nil, "item Y failed to decrypt on B's side")
        #expect(zRow.fields != nil, "item Z failed to decrypt on B's side")

        let xMarker = ShareMarker.of(item: xRow)
        let yMarker = ShareMarker.of(item: yRow)
        let zMarker = ShareMarker.of(item: zRow)

        // The decisive assertions -- all three, positively, in the SAME run.
        #expect(xMarker == .receivedFromOther, "item X (received) must read .receivedFromOther, got \(xMarker)")
        #expect(yMarker == .sharedByMe, "item Y (outgoing) must read .sharedByMe, got \(yMarker)")
        #expect(zMarker == .none, "item Z (personal) must read .none, got \(zMarker)")

        let xLabel = xMarker.accessibilityLabel(count: 0)
        let yLabel = yMarker.accessibilityLabel(count: 1)
        let zLabel = zMarker.accessibilityLabel(count: 0)
        #expect(xLabel == "Shared with you")
        #expect(yLabel == "Shared with 1")
        #expect(zLabel.isEmpty)
        #expect(xLabel != yLabel, "X and Y must expose DIFFERENT accessibility labels")
        #expect(zLabel != xLabel && zLabel != yLabel, "Z must expose neither label")

        // ---- Evidence -------------------------------------------------

        let planningDir = Self.planningEvidenceDirectory
        try FileManager.default.createDirectory(at: planningDir, withIntermediateDirectories: true)
        let durableDir = Self.durableEvidenceDirectory
        try FileManager.default.createDirectory(at: durableDir, withIntermediateDirectories: true)

        let transcript = """
        E-F1 live two-account marker run -- Phase 40, plan 40-05, Task 3
        Recorded: \(Date())
        Server origin: \(baseURL.absoluteString)

        Account A: \(emailA) (user_id \(meA.userId))
        Account B: \(emailB) (user_id \(meB.userId))

        Item X (\(xId)): created by A, shared DIRECTLY to B.
          Resolved on B via SharedItemsStore.ingestDirectShared: \(xMarker)
          Accessibility label: "\(xLabel)"

        Item Y (\(yId)): created by B, shared DIRECTLY to A (the reverse direction).
          Resolved on B via SharedItemsStore.ingestPersonalSync: \(yMarker)
          Accessibility label: "\(yLabel)"

        Item Z (\(zId)): created by B, purely personal, never shared.
          Resolved on B via SharedItemsStore.ingestPersonalSync: \(zMarker)
          Accessibility label: "\(zLabel)"

        The evidence for SC1 is THIS live two-account run, not the unit tests in Tasks 1-2.
        """
        try transcript.write(
            to: planningDir.appendingPathComponent("40-05-ef1-transcript.txt"), atomically: true, encoding: .utf8
        )
        try transcript.write(
            to: durableDir.appendingPathComponent("40-05-ef1-transcript.txt"), atomically: true, encoding: .utf8
        )

        let listView = EF1EvidenceList(
            xName: xRow.displayName, xMarker: xMarker,
            yName: yRow.displayName, yMarker: yMarker,
            zName: zRow.displayName, zMarker: zMarker
        )
        let renderer = ImageRenderer(content: listView)
        renderer.scale = 3
        guard let uiImage = renderer.uiImage, let pngData = uiImage.pngData() else {
            throw LiveTwoAccountMarkerRunError.screenshotRenderFailed
        }
        try pngData.write(to: planningDir.appendingPathComponent("40-05-ef1-list.png"))
        try pngData.write(to: durableDir.appendingPathComponent("40-05-ef1-list.png"))
    }
}
