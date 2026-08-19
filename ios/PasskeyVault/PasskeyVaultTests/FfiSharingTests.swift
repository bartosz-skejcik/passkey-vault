//
//  FfiSharingTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-02. Two Swift
//  types, deliberately kept in this ONE file (matching this plan's own
//  `<files>` scope) but deliberately kept as TWO SEPARATE Swift Testing
//  types, mirroring this project's own established split between
//  `FfiRoundTripTests` (pure, no network) and `CrossClientInteropTests`/
//  `AccountFlowLiveTests`/`SyncTracerLiveProofTests` (live, environment-
//  gated, require a running `pv-server`):
//
//  - `FfiSharingTests` — pure FFI calls, no network. This is what
//    `-only-testing:PasskeyVaultTests/FfiSharingTests` (this plan's own
//    literal `<verify><automated>` command, run with NO server and NO
//    environment variables) exercises, and what it must pass on every
//    plain `xcodebuild test` invocation.
//  - `FfiSharingLiveProofTests` — the E-W2 two-direction live proof
//    (Task 1/2's `<human-check>`, Task 3's required-by-name
//    `webSealedCollectionKeyUnsealsOnIosAndNameMatchesLiteral`). These
//    methods require `PV_TEST_SERVER`/`PV_SHARING_EMAIL`/
//    `PV_SHARING_PASSWORD` (and, for the reverse direction,
//    `PV_SHARING_WEB_COLLECTION_ID`) and FAIL HARD (never silently skip)
//    when they are absent -- exactly `CrossClientInteropTests`'
//    `direction2_webRegistered_iosUnlocks` discipline. Run individually,
//    against an isolated live server, via
//    `-only-testing:PasskeyVaultTests/FfiSharingLiveProofTests/<method>()`
//    -- never bundled into the plain, no-server invocation above. This
//    split is what makes BOTH true at once: the plan's own literal
//    automated command stays server-free and green, and the required live
//    proof is still runnable, and reproducible, on demand. Recorded as a
//    judgment call in 40-02-SUMMARY.md.
//
//  DR-40-A (`ios/IOS-SPIKE-LOG.md` §1h) governs every JSON string this file
//  touches: `wrapIdentitySecretKey`/`sealCollectionKey`/
//  `encryptItemForCollection` etc. all return `String`s produced by
//  `serde_json` INSIDE Rust -- this file only ever parses them with
//  `JSONSerialization` to ASSERT their shape, never re-encodes or
//  reconstructs them with `JSONEncoder`/`Codable Data`.
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - FfiSharingTests: pure FFI calls, no network, no environment

struct FfiSharingTests {

    /// Task 1: generate -> wrap -> unwrap through the REAL FFI, asserted on
    /// the EFFECT (the recovered identity key's own public key bytes),
    /// captured BEFORE the wrap call -- never re-derived from the code
    /// under test.
    @Test func identityWrapUnwrapRoundTripThroughRealFfi() throws {
        let userKey = try FfiUserKey.generate()
        let identityKey = try FfiIdentityKey.generate()
        let expectedPublicKeyBytes = identityKey.publicKeyBytes()

        let wrappedJson = try wrapIdentitySecretKey(uk: userKey, isk: identityKey)
        let unwrapped = try unwrapIdentitySecretKey(uk: userKey, wrappedJson: wrappedJson)

        #expect(unwrapped.publicKeyBytes() == expectedPublicKeyBytes)
    }

    /// Task 1's own Swift `<behavior>` bullet, verbatim: "the JSON string
    /// returned by wrapIdentitySecretKey parses as an object whose nonce is
    /// a JSON ARRAY of numbers -- asserted by JSONSerialization on the
    /// Swift side, on a value Rust produced." The D-21 defect shape this
    /// guards against: a base64-string-shaped `nonce` (what Swift's own
    /// `JSONEncoder` would have produced for a `Data` field) would satisfy
    /// `obj["nonce"] as? String`, never `as? [Any]` -- asserting the ARRAY
    /// cast is what makes this a positive proof of the correct shape.
    @Test func wrapIdentitySecretKeyJsonHasNonceAsJsonArrayNeverAString() throws {
        let userKey = try FfiUserKey.generate()
        let identityKey = try FfiIdentityKey.generate()
        let wrappedJson = try wrapIdentitySecretKey(uk: userKey, isk: identityKey)

        guard let data = wrappedJson.data(using: .utf8) else {
            Issue.record("wrapIdentitySecretKey output was not valid UTF-8: \(wrappedJson)")
            return
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            Issue.record("wrapIdentitySecretKey output did not parse as a JSON object: \(wrappedJson)")
            return
        }
        guard let nonce = obj["nonce"] as? [Any] else {
            Issue.record(
                "expected .nonce to deserialize as a JSON ARRAY of numbers, got: \(String(describing: obj["nonce"]))"
            )
            return
        }
        #expect(!nonce.isEmpty)
        #expect(
            (obj["nonce"] as? String) == nil,
            "nonce must never deserialize as a String -- that is the base64/JSONEncoder defect shape this test exists to catch"
        )
    }

    /// Task 2: seal -> unseal through the REAL FFI. `FfiCollectionKey` has
    /// no byte accessor by design (T-40-08), so the round trip is proven
    /// through its EFFECT: encrypt under the ORIGINAL handle, decrypt under
    /// the UNSEALED one, and compare the recovered plaintext to a literal
    /// declared in this file.
    @Test func sealUnsealCollectionKeyRoundTripThroughRealFfi() throws {
        let recipient = try FfiIdentityKey.generate()
        let recipientPk = try FfiIdentityPublicKey.fromBytes(bytes: recipient.publicKeyBytes())
        let collectionKey = try FfiCollectionKey.generate()

        let sealedJson = try sealCollectionKey(recipientPk: recipientPk, ck: collectionKey)
        let unsealed = try unsealCollectionKey(myIdentityKey: recipient, sealedJson: sealedJson)

        let literalPlaintext = "sealed collection key roundtrip fixture (40-02 FfiSharingTests)"
        let itemJson = try encryptItemForCollection(
            ck: collectionKey,
            plaintext: literalPlaintext,
            collectionId: "fixture-collection",
            itemId: "fixture-item",
            revision: 1
        )
        let decrypted = try decryptItemForCollection(
            ck: unsealed,
            itemJson: itemJson,
            collectionId: "fixture-collection",
            itemId: "fixture-item",
            revision: 1
        )
        #expect(decrypted == literalPlaintext)
    }

    /// Task 2's own `<behavior>` bullet applied locally: a `SealedKey`
    /// whose `ephemeral_pk` is a small-order/all-zero encoding is rejected
    /// by `unsealCollectionKey` with `Err`, never a wrong key -- and a
    /// blob sealed to a DIFFERENT recipient's identity key is rejected too.
    @Test func unsealCollectionKeyRejectsWrongRecipient() throws {
        let recipientA = try FfiIdentityKey.generate()
        let recipientB = try FfiIdentityKey.generate()
        let recipientAPk = try FfiIdentityPublicKey.fromBytes(bytes: recipientA.publicKeyBytes())
        let collectionKey = try FfiCollectionKey.generate()

        let sealedJson = try sealCollectionKey(recipientPk: recipientAPk, ck: collectionKey)

        #expect(throws: (any Error).self) {
            _ = try unsealCollectionKey(myIdentityKey: recipientB, sealedJson: sealedJson)
        }
    }

    /// Task 3's own Swift-side wire-shape assertion, exercised locally
    /// here (and again in `FfiSharingLiveProofTests` against a genuine
    /// server-returned string, in `webSealedCollectionKeyUnsealsOnIosAndNameMatchesLiteral`):
    /// `ephemeral_pk` deserialises as an `[Any]` of count 32, never as a
    /// `String`.
    @Test func sealedCollectionKeyJsonHasEphemeralPkAsThirtyTwoElementArray() throws {
        let recipient = try FfiIdentityKey.generate()
        let recipientPk = try FfiIdentityPublicKey.fromBytes(bytes: recipient.publicKeyBytes())
        let collectionKey = try FfiCollectionKey.generate()
        let sealedJson = try sealCollectionKey(recipientPk: recipientPk, ck: collectionKey)

        try Self.assertEphemeralPkIsThirtyTwoElementJsonArray(sealedJson: sealedJson)
    }

    /// Shared wire-shape assertion, reused by `FfiSharingLiveProofTests`
    /// against a real server-returned `sealed_key` string.
    static func assertEphemeralPkIsThirtyTwoElementJsonArray(sealedJson: String) throws {
        guard let data = sealedJson.data(using: .utf8) else {
            Issue.record("sealed_key was not valid UTF-8: \(sealedJson)")
            return
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            Issue.record("sealed_key did not parse as a JSON object: \(sealedJson)")
            return
        }
        guard let ephemeralPk = obj["ephemeral_pk"] as? [Any] else {
            Issue.record(
                "expected .ephemeral_pk to deserialize as a JSON ARRAY, got: \(String(describing: obj["ephemeral_pk"]))"
            )
            return
        }
        #expect(ephemeralPk.count == 32)
        #expect((obj["ephemeral_pk"] as? String) == nil)
    }
}

// MARK: - FfiSharingLiveProofTests: E-W2, environment-gated, requires a live pv-server

enum SharingLiveProofError: Error, CustomStringConvertible {
    case missingEnvironmentVariables(String)

    var description: String {
        switch self {
        case let .missingEnvironmentVariables(detail):
            return "missing required environment variable(s): \(detail)"
        }
    }
}

struct FfiSharingLiveProofTests {

    /// The literal collection name this test authors -- mirrored EXACTLY
    /// as a literal in the external Node/`pv-wasm` harness that drives the
    /// reverse direction, per this project's own `CrossClientInteropTests`
    /// precedent (mirrored fixture constants, not discovered at runtime).
    /// Contains a non-ASCII character and an embedded digit sequence so a
    /// truncation or re-encoding is visible (Task 3's own instruction).
    static let iosAuthoredCollectionNameLiteral =
        "Rodzina Kowalskich \u{1F511} 40-02 #13579"

    /// Mirrored in the external harness as the literal the WEB side
    /// authors and iOS must recover byte-for-byte.
    static let webAuthoredCollectionNameLiteral =
        "Zaufana rodzina \u{1F5DD} 40-02 #24680"

    private static var baseURL: URL {
        let raw = env("PV_TEST_SERVER")?.value ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// Same plain-then-`TEST_RUNNER_`-prefixed lookup as
    /// `CrossClientInteropTests.env` -- see that file's own header for why.
    private static func env(_ key: String) -> (value: String, source: String)? {
        if let v = ProcessInfo.processInfo.environment[key], !v.isEmpty {
            return (v, "direct")
        }
        if let v = ProcessInfo.processInfo.environment["TEST_RUNNER_\(key)"], !v.isEmpty {
            return (v, "TEST_RUNNER_-prefixed")
        }
        return nil
    }

    private static func requireEnv(_ keys: [String]) throws -> [String: String] {
        var result: [String: String] = [:]
        var missing: [String] = []
        for key in keys {
            if let found = env(key) {
                result[key] = found.value
            } else {
                missing.append(key)
            }
        }
        guard missing.isEmpty else {
            let joined = missing.joined(separator: ", ")
            Issue.record(
                "requires \(keys.joined(separator: "/")) (plain or TEST_RUNNER_-prefixed) to be set by the external live-proof harness -- missing: \(joined). This test FAILS on a missing env var, it never silently skips."
            )
            throw SharingLiveProofError.missingEnvironmentVariables(joined)
        }
        return result
    }

    /// Registers (or, via `AccountService.register`'s own ACC-01 fallback,
    /// signs in to) the externally-supplied account, so this test and its
    /// siblings below always operate on the SAME account the external
    /// harness's own `PV_SHARING_EMAIL`/`PV_SHARING_PASSWORD` name --
    /// never a randomly-generated one this process alone knows about (the
    /// "getting data out of the simulator process" landmine
    /// `CrossClientInteropTests`' own header documents: this file avoids it
    /// entirely by never generating account credentials INSIDE the
    /// process -- the external harness always supplies them, then performs
    /// its own independent, real-`pv-wasm` login to verify).
    private static func openSession(email: String, password: String) async throws -> UnlockedSession {
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        return try await accountService.register(email: email, password: password)
    }

    // MARK: - Task 1's human-check: iOS publishes its identity keypair

    /// The external harness (Node + real `pv-wasm`) independently logs into
    /// the SAME account afterward and unwraps `wrapped_secret_key` -- the
    /// receiver-side half is verified OUTSIDE this process (see this file's
    /// header and 40-02-SUMMARY.md's live-proof transcript), because a
    /// second, real, independent client is the only thing that proves
    /// interop; this process asserting against its own output would not.
    @Test func iosPublishesIdentityKeypairForWebToRead() async throws {
        let creds = try Self.requireEnv(["PV_SHARING_EMAIL", "PV_SHARING_PASSWORD"])
        let session = try await Self.openSession(email: creds["PV_SHARING_EMAIL"]!, password: creds["PV_SHARING_PASSWORD"]!)

        let identityService = IdentityService(baseURL: Self.baseURL, tokenProvider: { session.token })
        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: session.userKey)

        #expect(identityKey.publicKeyBytes().count == 32)
    }

    // MARK: - Task 2's human-check: iOS creates a family-wide collection

    /// Creates a family-wide collection under `iosAuthoredCollectionNameLiteral`.
    /// The external harness reads it back via `GET /api/vault/collections`
    /// (real HTTP, same account) and decrypts `enc_name` with real
    /// `pv-wasm` to prove the receiver side, and runs the two `jq`
    /// discriminators against the same row.
    @Test func iosCreatesFamilyWideCollectionForWebToRead() async throws {
        let creds = try Self.requireEnv(["PV_SHARING_EMAIL", "PV_SHARING_PASSWORD"])
        let session = try await Self.openSession(email: creds["PV_SHARING_EMAIL"]!, password: creds["PV_SHARING_PASSWORD"]!)

        let collectionService = CollectionService(baseURL: Self.baseURL, tokenProvider: { session.token })
        let collectionId = try await collectionService.createFamilyWideCollection(
            name: Self.iosAuthoredCollectionNameLiteral,
            accessLevel: "read",
            userKey: session.userKey
        )

        #expect(collectionId.count == 36)
    }

    // MARK: - Task 3: the reverse direction -- web seals, iOS unseals and decrypts

    /// Required by name (Task 3's own acceptance criteria). Reads
    /// `PV_SHARING_WEB_COLLECTION_ID` (minted by the external Node/`pv-wasm`
    /// harness when IT created and shared a family-wide collection under
    /// `webAuthoredCollectionNameLiteral` to this SAME account), fetches
    /// that collection, unseals its `sealed_key` under this account's OWN
    /// identity key, decrypts `enc_name`, and asserts the recovered
    /// plaintext equals the literal declared in this file -- never a value
    /// computed by calling the code under test.
    @Test func webSealedCollectionKeyUnsealsOnIosAndNameMatchesLiteral() async throws {
        let creds = try Self.requireEnv([
            "PV_SHARING_EMAIL", "PV_SHARING_PASSWORD", "PV_SHARING_WEB_COLLECTION_ID",
        ])
        let collectionId = creds["PV_SHARING_WEB_COLLECTION_ID"]!
        let session = try await Self.openSession(email: creds["PV_SHARING_EMAIL"]!, password: creds["PV_SHARING_PASSWORD"]!)

        let identityService = IdentityService(baseURL: Self.baseURL, tokenProvider: { session.token })
        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: session.userKey)

        let collectionService = CollectionService(baseURL: Self.baseURL, tokenProvider: { session.token })
        let collection = try await collectionService.fetchCollection(id: collectionId)

        guard let sealedKeyJson = collection.sealedKey else {
            Issue.record("collection \(collectionId) carried no sealed_key for this account -- was it actually shared to PV_SHARING_EMAIL?")
            throw SharingLiveProofError.missingEnvironmentVariables("collection.sealedKey")
        }

        // Wire-shape assertion, on the REAL server-returned string, on the
        // RECEIVING side -- Task 3's own required assertion.
        try FfiSharingTests.assertEphemeralPkIsThirtyTwoElementJsonArray(sealedJson: sealedKeyJson)

        let collectionKey = try unsealCollectionKey(myIdentityKey: identityKey, sealedJson: sealedKeyJson)
        let decryptedName = try decryptItemForCollection(
            ck: collectionKey,
            itemJson: collection.encName,
            collectionId: collectionId,
            itemId: collectionId,
            revision: 1
        )

        #expect(decryptedName == Self.webAuthoredCollectionNameLiteral)
    }
}
