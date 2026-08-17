//
//  FolderWireInteropTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 3 -- the folder
//  direction of the cross-client proof E-W1's own item direction already
//  settled (`ios/IOS-SPIKE-LOG.md` L-17). An item pass does NOT imply a
//  folder pass: the folder column is a DIFFERENT shape (one combined JSON
//  string, a FIXED revision, an identifier minted client-side before
//  encryption -- see `FolderStore.swift`'s own header), and the last time an
//  identifier was minted on the wrong side of that ordering, every folder
//  name silently failed to decrypt on the next full refresh
//  (`folders.rs::CreateFolderRequest`'s own doc comment).
//
//  Same discipline as `VaultWireInteropTests.swift`: every test drives the
//  REAL `FolderStore`/`VaultStore`, fails loud on a missing env var (never
//  silently skips), and both directions are asserted on the RECEIVING side.
//  Driven by `scripts/verify-ios-web-folder-interop.mjs`, which owns the
//  server/simulator lifecycle and the `pv-wasm` half.
//

import Foundation
import Testing
@testable import PasskeyVault

struct FolderWireInteropTests {

    // MARK: - Shared literals -- mirrored, character for character, in
    // scripts/verify-ios-web-folder-interop.mjs. Neither side computes them
    // from the other.

    static let f1FolderName = "E-W1-folder forward: written on iOS"
    static let f1ItemName = "E-W1-folder forward item: written on iOS"
    static let f2FolderName = "E-W1-folder reverse: written by pv-wasm"
    static let f2ItemName = "E-W1-folder reverse item: written by pv-wasm"

    private static var baseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    private static func env(_ key: String) -> String? {
        if let v = ProcessInfo.processInfo.environment[key], !v.isEmpty { return v }
        if let v = ProcessInfo.processInfo.environment["TEST_RUNNER_\(key)"], !v.isEmpty { return v }
        return nil
    }

    private static func requireEnv(_ keys: [String]) throws -> [String: String] {
        var found: [String: String] = [:]
        var missing: [String] = []
        for key in keys {
            if let v = env(key) { found[key] = v } else { missing.append(key) }
        }
        guard missing.isEmpty else {
            Issue.record(
                """
                FolderWireInteropTests requires \(keys.joined(separator: "/")) to be set by \
                scripts/verify-ios-web-folder-interop.mjs -- missing: \(missing.joined(separator: ", ")). \
                This test FAILS on a missing env var; it never silently skips.
                """
            )
            throw InteropTestError.missingEnvironmentVariables(missing.joined(separator: ", "))
        }
        return found
    }

    // MARK: - F1 (forward): iOS creates a folder + an item assigned to it

    /// Registers a fresh account, creates a folder through the REAL
    /// `FolderStore.create`, then a note through `VaultStore.create` with
    /// `folderId` set to that folder's id -- proving BOTH the folder
    /// direction AND the item-assignment direction in one write, since
    /// assignment is nothing more than the item's own `folderId` field.
    @Test func f1_iosCreatesAFolderAndAnAssignedItem() async throws {
        let env = try Self.requireEnv(["PV_INTEROP_EMAIL", "PV_INTEROP_PASSWORD"])
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.register(
            email: env["PV_INTEROP_EMAIL"]!, password: env["PV_INTEROP_PASSWORD"]!
        )

        let api = VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token })
        let folderStore = await FolderStore(userKey: session.userKey, api: api)
        let folder = try await folderStore.create(name: Self.f1FolderName)
        #expect(
            folder.id.range(of: "^[0-9a-f-]{36}$", options: .regularExpression) != nil,
            "folder id must be a lowercase UUID, got \(folder.id)"
        )

        let vaultStore = await VaultStore(userKey: session.userKey, api: api)
        let created = try await vaultStore.create(
            fields: .note(NoteFields(name: Self.f1ItemName, folderId: folder.id, tags: [], body: "f1 fixture"))
        )

        // Local round trip, defense in depth -- catches a bug on THIS side
        // before blaming the Node/pv-wasm half for it.
        try await folderStore.refresh()
        try await vaultStore.refresh()
        let reloadedFolder = await folderStore.folders.first { $0.id == folder.id }
        #expect(reloadedFolder?.name == Self.f1FolderName, "iOS must be able to decrypt its own folder")
        let reloadedItem = await vaultStore.items.first { $0.id == created.id }
        #expect(reloadedItem?.isUndecryptable == false)
        #expect(reloadedItem?.fields?.folderId == folder.id)
    }

    // MARK: - F2 (reverse): pv-wasm creates a folder + an item assigned to it

    /// Signs in to an account the Node/`pv-wasm` half registered and
    /// populated (one folder, one item whose `folderId` points at it), then
    /// pulls with the REAL `FolderStore.refresh()`/`VaultStore.refresh()`
    /// and asserts both decrypt AND the assignment survived.
    @Test func f2_iosReadsAFolderAndAnAssignedItemPvWasmWrote() async throws {
        let env = try Self.requireEnv(["PV_INTEROP_EMAIL", "PV_INTEROP_PASSWORD", "PV_INTEROP_FOLDER_ID"])
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.signIn(
            email: env["PV_INTEROP_EMAIL"]!, password: env["PV_INTEROP_PASSWORD"]!
        )

        let api = VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token })
        let folderStore = await FolderStore(userKey: session.userKey, api: api)
        try await folderStore.refresh()
        let folder = await folderStore.folders.first { $0.id == env["PV_INTEROP_FOLDER_ID"]! }
        #expect(folder != nil, "the pv-wasm-written folder must appear in GET /api/sync")
        #expect(
            folder?.name == Self.f2FolderName,
            "a folder written by pv-wasm must decrypt on iOS -- if this fails, the wire encodings disagree"
        )

        let vaultStore = await VaultStore(userKey: session.userKey, api: api)
        try await vaultStore.refresh()
        let item = await vaultStore.items.first { $0.fields?.name == Self.f2ItemName }
        #expect(item != nil, "the pv-wasm-written item must appear in GET /api/sync")
        #expect(item?.isUndecryptable == false)
        #expect(item?.fields?.folderId == env["PV_INTEROP_FOLDER_ID"]!, "the assignment must survive the reverse direction too")
    }

    // MARK: - F3: the falsification arm -- identifier minted AFTER encryption

    /// The exact ordering defect this plan's own action text names: minting
    /// the identifier AFTER encryption instead of before. The AAD is bound
    /// to `wrongId` (minted first, used only for encryption) while the
    /// server is told the row's id is `realId` (minted second) -- so ANY
    /// client that later decrypts against the server's own `row.id` (which
    /// is `realId`) gets an AAD mismatch and a decrypt failure, exactly the
    /// symptom `folders.rs::CreateFolderRequest`'s doc comment describes.
    /// Confirmed to fail on iOS's OWN next refresh here (defense in depth);
    /// the driver script confirms the SAME row also fails to decrypt in
    /// `pv-wasm`, which is the acceptance criterion this arm exists for.
    @Test func f3_iosCreatesAFalsifiedFolderWithIdMintedAfterEncryption() async throws {
        let env = try Self.requireEnv(["PV_INTEROP_EMAIL", "PV_INTEROP_PASSWORD"])
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.register(
            email: env["PV_INTEROP_EMAIL"]!, password: env["PV_INTEROP_PASSWORD"]!
        )

        // The ordering defect, reproduced deliberately: encrypt FIRST
        // (binding the AAD to `wrongId`), mint the REAL id SECOND, and post
        // under the real id -- exactly the shape a server-minted identifier
        // used to produce, before 26-13-PLAN.md's fix, on every client.
        let wrongId = FolderStore.mintFolderId()
        let plaintext = try JSONEncoder().encode(FolderPlaintext(name: "F3 falsification -- must not decrypt"))
        let plaintextString = String(data: plaintext, encoding: .utf8)!
        let combined = try encryptItemCombinedJson(
            userKey: session.userKey, plaintext: plaintextString, itemId: wrongId, revision: FolderStore.folderRevision
        )
        let realId = FolderStore.mintFolderId()

        let api = VaultAPI(baseURL: Self.baseURL, tokenProvider: { session.token })
        let created = try await api.createFolder(id: realId, encNameJson: combined)
        #expect(created.id == realId)

        // Defense in depth: iOS's OWN next refresh must ALSO fail to
        // decrypt this row -- it uses the exact same `decrypt_item_combined_json`
        // the web client's `pv-wasm` equivalent does.
        let folderStore = await FolderStore(userKey: session.userKey, api: api)
        try await folderStore.refresh()
        let reloaded = await folderStore.folders.first { $0.id == realId }
        #expect(reloaded == nil, "a folder whose id was minted after encryption must fail to decrypt, on iOS too")
    }
}
