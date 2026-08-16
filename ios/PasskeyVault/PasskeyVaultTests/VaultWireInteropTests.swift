//
//  VaultWireInteropTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02, Task 3 -- the iOS half of
//  experiment **E-W1**, the decisive experiment of this phase.
//
//  The question E-W1 settles: does an item row written by iOS decrypt in the
//  OTHER client, and vice versa? It is not the same question as "did the
//  server accept it". `pv-server` stores `enc_key`/`enc_data` as opaque TEXT
//  it never parses (`enc_data TEXT NOT NULL`,
//  `crates/pv-server/migrations/0003_vault_items_rebuild.sql:20`), so it
//  answers 201 to `serde_json`'s number-array encoding and to Foundation's
//  base64 encoding alike. The ROADMAP's SC2 ("visible on the server") passes
//  on the broken case -- landmine L-17, `ios/IOS-SPIKE-LOG.md` §3.
//
//  WHAT IS DIFFERENT FROM 37-03's `CrossClientInteropTests`, and why this
//  file exists rather than an extra method there: that file builds the
//  `enc_key`/`enc_data` JSON **in Swift** (its own `wrappedKeyToJson`,
//  written before DR-38-C existed) and POSTs through a test-local
//  `URLSession` helper. It therefore proves interop for a hand-rolled test
//  path, not for the path the app ships. Every test in THIS file drives the
//  real `VaultStore` + `VaultAPI` -- `store.create(noteNamed:body:)` and
//  `store.refresh()`, the same two calls `ItemListView` makes -- so a defect
//  in the production wire path cannot hide behind a correct test fixture.
//
//  Both directions are asserted on the RECEIVING side, separately: a pass in
//  one direction does not imply the other, because the two directions
//  exercise two different serializers.
//
//  Driven by `scripts/verify-ios-web-item-interop.mjs`, which owns the
//  server/simulator lifecycle and the `pv-wasm` half. These tests FAIL on a
//  missing environment variable, never skip -- a silent skip would report a
//  direction green without having run it (37-03 established that rule after
//  a `-only-testing:` filter matched zero tests and still exited 0).
//

import Foundation
import Testing
@testable import PasskeyVault

struct VaultWireInteropTests {

    // MARK: - Shared literals
    //
    // These four constants are mirrored, character for character, in
    // `scripts/verify-ios-web-item-interop.mjs`. Neither side computes them
    // from the other: each is typed independently, which is what makes the
    // comparison an oracle rather than a self-comparison.

    /// D1: the note name iOS writes and the Node/pv-wasm side must recover.
    static let d1NoteName = "E-W1 forward: written on iOS"
    static let d1NoteBody = "38-02 Task 3 forward-direction fixture"

    /// D2: the note name the Node/pv-wasm side writes and iOS must recover.
    static let d2NoteName = "E-W1 reverse: written by pv-wasm"
    static let d2NoteBody = "38-02 Task 3 reverse-direction fixture"

    private static var baseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// Plain name first, then the `TEST_RUNNER_`-prefixed fallback --
    /// `xcodebuild test` forwards one or the other depending on version
    /// (37-03's empirical finding; the driver sets both spellings).
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
                VaultWireInteropTests requires \(keys.joined(separator: "/")) to be set by \
                scripts/verify-ios-web-item-interop.mjs -- missing: \(missing.joined(separator: ", ")). \
                This test FAILS on a missing env var; it never silently skips.
                """
            )
            throw InteropTestError.missingEnvironmentVariables(missing.joined(separator: ", "))
        }
        return found
    }

    @MainActor
    private static func store(for session: UnlockedSession) -> VaultStore {
        VaultStore(
            userKey: session.userKey,
            api: VaultAPI(baseURL: baseURL, tokenProvider: { session.token })
        )
    }

    // MARK: - Direction 1 (forward): iOS writes, pv-wasm reads

    /// Registers a fresh account through the real `AccountService`, then
    /// creates ONE note through the real `VaultStore.create` -- which is the
    /// production path: `encryptItemWire` (pv-ffi/serde_json) ->
    /// `VaultAPI.createItem` -> `POST /api/vault/items`.
    ///
    /// The assertion that matters does NOT live here. This test only writes
    /// the row and proves the write itself succeeded; whether the row is
    /// *decryptable by another client* is asserted by the Node/pv-wasm half,
    /// which reads the row straight out of the throwaway database. A 201 is
    /// deliberately not treated as evidence of a correct wire format.
    @Test func d1_iosWritesAnItemThroughTheProductionPath() async throws {
        let env = try Self.requireEnv(["PV_INTEROP_EMAIL", "PV_INTEROP_PASSWORD"])
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.register(
            email: env["PV_INTEROP_EMAIL"]!, password: env["PV_INTEROP_PASSWORD"]!
        )
        #expect(!session.token.isEmpty)

        let store = await Self.store(for: session)
        let created = try await store.create(noteNamed: Self.d1NoteName, body: Self.d1NoteBody)

        // Lowercase UUID. Foundation mints uppercase; the id is bound into
        // the AEAD associated data, so a case mismatch is a decryption
        // failure in the other client, not a cosmetic difference.
        #expect(
            created.id.range(of: "^[0-9a-f-]{36}$", options: .regularExpression) != nil,
            "item id must be a lowercase UUID, got \(created.id)"
        )

        // Read it back through the SAME store, so a total failure of the
        // round trip fails here rather than being blamed on the Node side.
        try await store.refresh()
        let items = await store.items
        let mine = items.first { $0.id == created.id }
        #expect(mine != nil, "the row iOS just wrote must come back from GET /api/sync")
        #expect(mine?.isUndecryptable == false, "iOS must be able to decrypt its own row")
        #expect(mine?.displayName == Self.d1NoteName)
    }

    // MARK: - Direction 2 (reverse): pv-wasm writes, iOS reads

    /// Signs in to an account the Node/`pv-wasm` half registered and
    /// populated (via `encryptItem` + the same `splitCombinedEncryptedItem`
    /// recombination `web/src/lib/vault/store.ts:201` performs), then pulls
    /// with the real `VaultStore.refresh()` and asserts the item decrypts
    /// **on this side**.
    ///
    /// `PV_INTEROP_GOOD_ITEM_ID` and `PV_INTEROP_BAD_ITEM_ID` are supplied by
    /// the driver: the first is a correctly-encoded row, the second is the
    /// falsification arm's deliberately base64-shaped row living in the SAME
    /// account. Asserting on both in one refresh is what makes the good
    /// result meaningful -- a run where everything decrypts and a run where
    /// nothing does would look identical if only the good row were checked.
    @Test func d2_iosReadsAnItemPvWasmWrote_andTheBase64RowIsRejectedNotAccepted() async throws {
        let env = try Self.requireEnv([
            "PV_INTEROP_EMAIL", "PV_INTEROP_PASSWORD",
            "PV_INTEROP_GOOD_ITEM_ID", "PV_INTEROP_BAD_ITEM_ID",
        ])
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.signIn(
            email: env["PV_INTEROP_EMAIL"]!, password: env["PV_INTEROP_PASSWORD"]!
        )

        let store = await Self.store(for: session)
        try await store.refresh()
        let items = await store.items

        let good = items.first { $0.id == env["PV_INTEROP_GOOD_ITEM_ID"]! }
        #expect(good != nil, "the pv-wasm-written row must appear in GET /api/sync")
        #expect(
            good?.isUndecryptable == false,
            "a row written by pv-wasm must decrypt on iOS -- if this fails, the wire encodings disagree"
        )
        #expect(good?.displayName == Self.d2NoteName)

        // The falsification arm, asserted on the RECEIVING side. A row whose
        // enc_key is base64-shaped -- exactly what Foundation's JSONEncoder
        // would have produced -- must be REJECTED and RETAINED, never
        // silently accepted and never dropped from the list (T-38-02-02).
        let bad = items.first { $0.id == env["PV_INTEROP_BAD_ITEM_ID"]! }
        #expect(bad != nil, "an undecryptable row must be RETAINED in the list, not dropped")
        #expect(
            bad?.isUndecryptable == true,
            "the deliberately base64-shaped row must be rejected -- if iOS accepted it, this whole experiment's green results prove nothing"
        )
    }
}
