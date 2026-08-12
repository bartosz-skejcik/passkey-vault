//
//  CrossClientInteropTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-03. The two-direction
//  cross-client `pw_wrapped_uk` proof this milestone's own IOS-SPIKE-LOG.md
//  §4 q.5 names as the largest remaining correctness risk: DR-37-A settled
//  the DESIGN (Plan 37-01) and 37-02's Task 2 settled the on-wire SHAPE
//  against one real row -- neither settles INTEROP. A symmetric-but-wrong
//  encoding (both clients independently agreeing on the same wrong shape)
//  would pass either direction alone; only running both, against real
//  ciphertext each side actually produced, closes the gap.
//
//  Orchestrated externally by `scripts/verify-ios-web-interop.mjs run-interop`
//  (the mandatory automated gate -- see that script's own header), which
//  drives BOTH test methods below via `xcodebuild test -only-testing:...`
//  and cross-checks against the real `pv-wasm` artifact on the Node side.
//  Neither test method here is a self-contained round trip -- each is
//  exactly one HALF of one direction, by design, so a green run genuinely
//  means the OTHER client (not this process) could read what this process
//  wrote (or vice versa).
//
//  GETTING DATA OUT OF THE SIMULATOR PROCESS -- an empirical finding, not an
//  assumption. `print()` output is NOT reliably retrievable from a Swift
//  Testing run under `xcodebuild test`: `xcresulttool get log --type
//  console` and `test-results activities` both came back EMPTY against a
//  real recorded run (checked directly this task). This project's own
//  `os_log`/`Logger` `PVPROBE|` convention (`ProbeSeeder.swift`,
//  `KeychainProbe.swift`, etc., read back via `xcrun simctl spawn <udid> log
//  show`) was the next candidate, but `xcodebuild test` was ALSO observed
//  (this task) to run every test on an EPHEMERAL "Clone N of <device>"
//  simulator -- confirmed via `Test suite '...' started on 'Clone 1 of
//  iPhone 17 ...'` in the build log, and the clone is torn down by the time
//  `xcodebuild test` returns, taking its separate per-device log store with
//  it, regardless of whether the ORIGINAL device UDID was already booted.
//  `xcrun simctl spawn <original-udid> log show` after the fact cannot see
//  it. So `direction1_iosRegisters_forWebUnlock` uses neither -- it POSTs
//  the encrypted item to the REAL, ALREADY-EXISTING `POST /api/vault/items`
//  endpoint (`crates/pv-server/src/routes/vault.rs`) under the session it
//  just opened, and the external harness reads it back with a plain SQL
//  query against the (still real, still `/private/tmp`-only) database --
//  exactly the same "read the row the OTHER side wrote" shape 37-02's
//  `scripts/check-ios-wire-shape.sh` already established for `pw_wrapped_uk`,
//  applied to `vault_items` this time. This is not a new server surface
//  invented for this test -- `/api/vault/items` is a real, already-shipped
//  route this task only calls, never edits (ACC-01 holds).
//
//  NEITHER test method here ever uses a skip-on-missing-precondition
//  API/an early return on missing environment -- `direction2_webRegistered_iosUnlocks`
//  FAILS explicitly (`Issue.record` + throw) when its required env vars are
//  absent. A test
//  that can silently skip is a check that cannot fail (this repo's own
//  landmine L-3 family, `ios/IOS-SPIKE-LOG.md` §3).
//

import Foundation
import Testing
@testable import PasskeyVault

enum InteropTestError: Error, CustomStringConvertible {
    case malformedItemJson(String)
    case missingEnvironmentVariables(String)
    case vaultItemCreateFailed(String)

    var description: String {
        switch self {
        case let .malformedItemJson(detail):
            return "malformed EncryptedItem JSON: \(detail)"
        case let .missingEnvironmentVariables(detail):
            return "missing required environment variable(s): \(detail)"
        case let .vaultItemCreateFailed(detail):
            return "POST /api/vault/items failed: \(detail)"
        }
    }
}

struct CrossClientInteropTests {

    private static var baseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    private static func freshEmail() -> String {
        "ios-interop-d1-\(UUID().uuidString.lowercased())@example.com"
    }

    // MARK: - Direction 1 fixture literals (mirrored EXACTLY as constants in
    // scripts/verify-ios-web-interop.mjs -- D1_PASSWORD/D1_ITEM_ID/
    // D1_LITERAL_PLAINTEXT. The interop oracle requires both files to agree
    // on these values by construction, not by discovery at runtime. Note
    // `direction1ItemId` is the pv-core AAD item id (bound into the
    // ciphertext), independent of the `vault_items.id` UUID primary key
    // `POST /api/vault/items` requires -- the two identifiers serve
    // different purposes and are never conflated below.)

    private static let direction1Password =
        "correct horse battery staple (37-03 CrossClientInteropTests D1)"
    private static let direction1ItemId = "cross-client-interop-d1-item"
    private static let direction1LiteralPlaintext =
        "{\"type\":\"note\",\"body\":\"CrossClientInteropTests D1 fixture, phase 37-03\"}"

    // MARK: - Direction 2 fixture literals (mirrored in the .mjs file as
    // D2_ITEM_ID/D2_LITERAL_PLAINTEXT -- email/password are chosen by the
    // Node harness at registration time and passed in via env vars, since
    // THIS side never registers for direction 2).

    private static let direction2ItemId = "cross-client-interop-d2-item"
    private static let direction2LiteralPlaintext =
        "{\"type\":\"note\",\"body\":\"CrossClientInteropTests D2 fixture, phase 37-03\"}"

    // MARK: - Test-only wire (de)serialization of FfiWrappedKey
    //
    // NOT a DR-37-A violation: DR-37-A governs `pw_wrapped_uk` specifically
    // (the field this app ever WRITES to/READS from the server as an opaque
    // string via `pv-ffi`'s `wrapUserKeyJson`/`unwrapUserKeyFromJson`).
    // `enc_key`/`enc_data` on `POST /api/vault/items` are ALSO opaque
    // `WrappedKey`-shaped `TEXT` the server never parses
    // (`crates/pv-server/src/routes/vault.rs`'s own header: "Serwer widzi
    // wyłącznie {id, enc_key, blob, revision}") -- `pv-ffi` has no
    // `encrypt_item_json`/`decrypt_item_json` helper yet (Phase 38 owns the
    // real vault-item wire format), so this hand-built serializer exists
    // ONLY to produce the exact `serde_json` `#[derive(Serialize)]` shape
    // `pv_core::keys::WrappedKey` already has on every OTHER client
    // (`{"nonce":[<u8...>],"ciphertext":[<u8...>]}`) -- never `Codable`'s
    // default base64-`Data` encoding, which is precisely the D-21-shaped
    // mismatch this whole plan exists to catch.
    private static func wrappedKeyToJson(_ w: FfiWrappedKey) -> String {
        let nonce = [UInt8](w.nonce).map(String.init).joined(separator: ",")
        let ciphertext = [UInt8](w.ciphertext).map(String.init).joined(separator: ",")
        return "{\"nonce\":[\(nonce)],\"ciphertext\":[\(ciphertext)]}"
    }

    private static func wrappedKeyFromJsonObject(_ obj: [String: Any]) throws -> FfiWrappedKey {
        guard let nonceNums = obj["nonce"] as? [Int], let ciphertextNums = obj["ciphertext"] as? [Int] else {
            throw InteropTestError.malformedItemJson("expected .nonce/.ciphertext as JSON number arrays, got: \(obj)")
        }
        let nonceBytes = Data(nonceNums.map { UInt8(truncatingIfNeeded: $0) })
        let ciphertextBytes = Data(ciphertextNums.map { UInt8(truncatingIfNeeded: $0) })
        return FfiWrappedKey(nonce: nonceBytes, ciphertext: ciphertextBytes)
    }

    private static func encryptedItemFromJson(_ json: String) throws -> FfiEncryptedItem {
        guard let data = json.data(using: .utf8) else {
            throw InteropTestError.malformedItemJson("not valid UTF-8: \(json)")
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let encKeyObj = obj["enc_key"] as? [String: Any],
              let encDataObj = obj["enc_data"] as? [String: Any]
        else {
            throw InteropTestError.malformedItemJson("expected top-level .enc_key/.enc_data objects, got: \(json)")
        }
        let encKey = try wrappedKeyFromJsonObject(encKeyObj)
        let encData = try wrappedKeyFromJsonObject(encDataObj)
        return FfiEncryptedItem(encKey: encKey, encData: encData)
    }

    // MARK: - Minimal direct call to the REAL, already-shipped
    // `POST /api/vault/items` (see this file's header) -- deliberately not
    // routed through `PvApiClient` (that type owns only `/api/auth/*`,
    // Plan 37-02's own scope; adding a vault-items method there is Phase
    // 38's job, not this interop harness's).
    private static func createVaultItem(
        token: String,
        itemId: String,
        encKeyJson: String,
        encDataJson: String
    ) async throws {
        guard let url = URL(string: "/api/vault/items", relativeTo: Self.baseURL) else {
            throw InteropTestError.vaultItemCreateFailed("could not construct URL")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let body: [String: String] = [
            "id": UUID().uuidString.lowercased(),
            "enc_key": encKeyJson,
            "enc_data": encDataJson,
        ]
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 201 else {
            let bodyString = String(data: data, encoding: .utf8) ?? "<non-utf8 body>"
            throw InteropTestError.vaultItemCreateFailed(
                "expected 201, got \((response as? HTTPURLResponse)?.statusCode ?? -1): \(bodyString)"
            )
        }
    }

    // MARK: - Environment lookup with TEST_RUNNER_-prefix fallback
    //
    // `xcodebuild test`'s env-var forwarding to the test process is not
    // guaranteed to forward plain process environment variables set on the
    // `xcodebuild` invocation itself -- some xcodebuild/Xcode versions only
    // forward variables prefixed `TEST_RUNNER_`. This checks the plain name
    // FIRST (the shape this project's own scripts already use elsewhere,
    // e.g. `PV_TEST_SERVER` in AccountFlowLiveTests.swift, which is known to
    // work), then the `TEST_RUNNER_`-prefixed form. `scripts/verify-ios-
    // web-interop.mjs` sets BOTH spellings on every `xcodebuild test`
    // invocation it makes, so whichever this process actually observes IS
    // the empirical finding (recorded in `ios/IOS-SPIKE-LOG.md` from this
    // task's real run, not assumed in either file).
    private static func env(_ key: String) -> (value: String, source: String)? {
        if let v = ProcessInfo.processInfo.environment[key], !v.isEmpty {
            return (v, "direct")
        }
        if let v = ProcessInfo.processInfo.environment["TEST_RUNNER_\(key)"], !v.isEmpty {
            return (v, "TEST_RUNNER_-prefixed")
        }
        return nil
    }

    // MARK: - Direction 1: iOS registers, the Node/pv-wasm harness unlocks

    /// Registers a fresh account via the REAL `AccountService` (the same
    /// production path `AccountFlowLiveTests` proves, `ContentView` drives)
    /// against a live `pv-server`, encrypts a literal fixture plaintext under
    /// the resulting `FfiUserKey`, and persists it as a REAL vault item via
    /// `POST /api/vault/items` -- the external Node harness reads it back
    /// with a direct SQL query against `vault_items` (see this file's
    /// header for why: the alternative, capturing this process's own
    /// stdout/os_log, does not survive `xcodebuild test`'s ephemeral
    /// simulator clone). Always expected to succeed -- registration itself
    /// is not what direction 1 falsifies; `run-interop`'s falsified run
    /// corrupts the stored `pw_wrapped_uk` AFTER this test has already
    /// committed a real row.
    @Test func direction1_iosRegisters_forWebUnlock() async throws {
        let email = Self.freshEmail()
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))

        let session = try await accountService.register(email: email, password: Self.direction1Password)
        #expect(!session.token.isEmpty, "register must return a non-empty session token")

        let item = try encryptItem(
            userKey: session.userKey,
            plaintext: Self.direction1LiteralPlaintext,
            itemId: Self.direction1ItemId,
            revision: 1
        )

        try await Self.createVaultItem(
            token: session.token,
            itemId: Self.direction1ItemId,
            encKeyJson: Self.wrappedKeyToJson(item.encKey),
            encDataJson: Self.wrappedKeyToJson(item.encData)
        )
    }

    // MARK: - Direction 2: the Node/pv-wasm harness registers, iOS unlocks

    /// Reads `PV_INTEROP_EMAIL`/`PV_INTEROP_PASSWORD`/`PV_INTEROP_ITEM_JSON`
    /// (set by `scripts/verify-ios-web-interop.mjs run-interop` on the
    /// `xcodebuild test` invocation), signs in through the REAL
    /// `AccountService` against a `pv-server` account the Node/`pv-wasm`
    /// side registered, decrypts the web-sealed item, and asserts the
    /// plaintext equals a literal authored in THIS file. Any of the three
    /// env vars missing is a hard FAILURE (`Issue.record` + throw), never a
    /// skip -- a missing env var most likely means the external harness
    /// itself is broken, and a silently-skipped test would report this
    /// direction "green" without ever having run it.
    @Test func direction2_webRegistered_iosUnlocks() async throws {
        guard let email = Self.env("PV_INTEROP_EMAIL"),
              let password = Self.env("PV_INTEROP_PASSWORD"),
              let itemJson = Self.env("PV_INTEROP_ITEM_JSON")
        else {
            let missing = ["PV_INTEROP_EMAIL", "PV_INTEROP_PASSWORD", "PV_INTEROP_ITEM_JSON"]
                .filter { Self.env($0) == nil }
                .joined(separator: ", ")
            Issue.record(
                """
                direction2_webRegistered_iosUnlocks requires PV_INTEROP_EMAIL/PV_INTEROP_PASSWORD/\
                PV_INTEROP_ITEM_JSON (plain or TEST_RUNNER_-prefixed) to be set by \
                scripts/verify-ios-web-interop.mjs -- missing: \(missing). This test FAILS on a \
                missing env var, it never silently skips.
                """
            )
            throw InteropTestError.missingEnvironmentVariables(missing)
        }

        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let session = try await accountService.signIn(email: email.value, password: password.value)
        #expect(!session.token.isEmpty, "signIn must return a non-empty session token, env source=\(email.source)")

        let item = try Self.encryptedItemFromJson(itemJson.value)
        let decrypted = try decryptItem(
            userKey: session.userKey,
            item: item,
            itemId: Self.direction2ItemId,
            revision: 1
        )
        #expect(decrypted == Self.direction2LiteralPlaintext)
    }
}
