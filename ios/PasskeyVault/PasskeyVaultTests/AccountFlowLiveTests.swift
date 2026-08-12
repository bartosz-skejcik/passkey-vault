//
//  AccountFlowLiveTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-02. The end-to-end
//  proof: drives the SAME `AccountService` the app's `ContentView` drives
//  (never a re-implementation of register/signIn inside this file) against
//  a LIVE, unmodified `pv-server`.
//
//  Base URL: `PV_TEST_SERVER` env var, defaulting to `http://127.0.0.1:8621`
//  -- a hardcoded default rather than a skip, because a test that silently
//  skips is a check that cannot fail (this repo's own landmine L-3 family).
//
//  `pv_ffi.swift` is compiled into the `PasskeyVault` APP target (37-02
//  moved module ownership there) -- `@testable import PasskeyVault` below
//  reaches `FfiUserKey`/`encryptItem`/`decryptItem` (UniFFI's generated
//  `public` symbols, which a PLAIN `import` would already see, exactly as
//  FfiRoundTripTests.swift/FfiPanicSafetyTests.swift do) AND
//  `AccountService`/`PvApiClient`/`PvApiError`/`UnlockedSession` (this
//  plan's own app-level types, deliberately `internal` -- Phase 38 owns
//  turning them into a real public app API, this tracer does not
//  pre-emptively widen their access level just to satisfy a test import).
//  `@testable` is the real reason here, discovered from an actual compile
//  error ("cannot find 'AccountService'/'PvApiClient' in scope" under a
//  plain `import`), not applied speculatively.
//

import Foundation
import Testing
@testable import PasskeyVault

struct AccountFlowLiveTests {

    private static var baseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    private static func freshEmail() -> String {
        "ios-tracer-\(UUID().uuidString.lowercased())@example.com"
    }

    /// Shared fixture password across this file's tests -- not a literal
    /// this file compares crypto OUTPUT against (SC2 discipline is about
    /// output literals, not input fixtures).
    private static let fixturePassword = "correct horse battery staple (37-02 AccountFlowLiveTests)"

    /// Literal plaintext authored HERE -- never produced by calling the
    /// code under test and comparing it back to itself.
    private static let literalPlaintext =
        "{\"type\":\"note\",\"body\":\"AccountFlowLiveTests fixture, phase 37-02\"}"

    // MARK: - Test 1: full tracer, byte-for-byte against a literal

    /// Register a unique email, assert a non-empty session token and a
    /// user id that parses as a UUID; encrypt a LITERAL plaintext; build a
    /// SECOND, fresh `AccountService`, `signIn` with the same credentials,
    /// decrypt that SAME ciphertext, and assert byte-for-byte equality
    /// against the literal -- never "no error was thrown", never a length
    /// check.
    @Test func registerThenSignInReconstructsSameUserKeyAndDecryptsRealCiphertext() async throws {
        let email = Self.freshEmail()
        let apiClient = PvApiClient(baseURL: Self.baseURL)
        let accountService = AccountService(apiClient: apiClient)

        let session = try await accountService.register(email: email, password: Self.fixturePassword)
        #expect(!session.token.isEmpty, "register must return a non-empty session token")

        let me = try await apiClient.me(token: session.token)
        #expect(
            UUID(uuidString: me.userId) != nil,
            "the registered account's user id must parse as a UUID, got: \(me.userId)"
        )

        let item = try encryptItem(
            userKey: session.userKey,
            plaintext: Self.literalPlaintext,
            itemId: "account-flow-live-test-item",
            revision: 1
        )

        // A SECOND, fresh AccountService/PvApiClient -- never reuses the
        // first's instances or FfiUserKey handle.
        let secondAccountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        let secondSession = try await secondAccountService.signIn(email: email, password: Self.fixturePassword)
        #expect(!secondSession.token.isEmpty, "signIn must return a non-empty session token")

        let decrypted = try decryptItem(
            userKey: secondSession.userKey,
            item: item,
            itemId: "account-flow-live-test-item",
            revision: 1
        )
        #expect(decrypted == Self.literalPlaintext)
    }

    // MARK: - Test 2: wrong password fails at the server, never produces a User Key

    /// A wrong password on `signIn` fails at the server with 401 and never
    /// produces a User Key -- discriminated as `PvApiError.invalidCredentials`
    /// specifically, not merely "some error was thrown".
    @Test func wrongPasswordYieldsInvalidCredentialsAndNoSession() async throws {
        let email = Self.freshEmail()
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))
        _ = try await accountService.register(email: email, password: Self.fixturePassword)

        do {
            _ = try await accountService.signIn(email: email, password: "definitely the wrong password")
            Issue.record("expected signIn with a wrong password to throw")
        } catch let error as PvApiError {
            guard case .invalidCredentials = error else {
                Issue.record("expected PvApiError.invalidCredentials, got: \(error)")
                return
            }
        }
    }

    // MARK: - Test 3: ACC-01 concurrency edge -- interrupted-registration fallback

    /// Calls `AccountService.register` TWICE in immediate succession with
    /// the SAME fresh email/password, simulating a client that never
    /// learned the first attempt succeeded (crash, network drop between
    /// the server persisting the row and the client observing the
    /// response). The SECOND call must still return a non-nil
    /// `UnlockedSession` with a non-empty session token -- i.e. the 409
    /// fallback inside `AccountService.register` reached `signIn` rather
    /// than surfacing the duplicate-email error to a caller who has no way
    /// to know the account already exists.
    @Test func secondRegisterCallWithSameCredentialsStillReturnsAnUnlockedSession() async throws {
        let email = Self.freshEmail()
        let accountService = AccountService(apiClient: PvApiClient(baseURL: Self.baseURL))

        let first = try await accountService.register(email: email, password: Self.fixturePassword)
        #expect(!first.token.isEmpty)

        let second = try await accountService.register(email: email, password: Self.fixturePassword)
        #expect(!second.token.isEmpty, "the second register call (ACC-01 concurrency edge) must still yield an UnlockedSession")
    }
}
