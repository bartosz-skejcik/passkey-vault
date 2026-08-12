//
//  AccountService.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-02. The tracer's ONE
//  path through `pv-ffi` + `PvApiClient`, in the step order
//  `web/src/components/auth/RegisterForm.tsx`/`LoginForm.tsx` already
//  establish: register reuses the SAME `auth_hash` for the immediate
//  follow-up login (no second Argon2id pass); sign-in derives against the
//  SERVER's own stored salt/params via `prelogin`, never a client-cached
//  value from a prior attempt.
//
//  Plan 37-04 adds Keychain persistence for the session token
//  (`SessionTokenStore`) and `restoreSession()`, the re-unlock-after-relaunch
//  route: a stored token + `GET /api/auth/me` recovers `pw_wrapped_uk`
//  without minting a new session row, i.e. without calling `login` again.
//

import Foundation

/// An unlocked vault session: the server-issued bearer token (stored/sent
/// verbatim, never re-encoded) and the live `FfiUserKey` handle capable of
/// encrypting/decrypting real items. Raw key bytes never appear here --
/// `userKey` is the same opaque handle `pv-ffi` hands back everywhere else.
struct UnlockedSession {
    let token: String
    let userKey: FfiUserKey
}

/// Drives the one real account-creation/unlock path through `pv-ffi` and
/// `PvApiClient`. Both the app's UI (`ContentView`) and
/// `AccountFlowLiveTests` call the SAME instance methods here -- neither
/// re-implements the flow.
final class AccountService {
    private let apiClient: PvApiClient

    init(apiClient: PvApiClient) {
        self.apiClient = apiClient
    }

    /// `generateRegistrationSalt()` -> `defaultKdfParamsJson()` ->
    /// `deriveAuthMaterial(...)` -> `FfiUserKey.generate()` ->
    /// `wrapUserKeyJson(...)` -> `POST register` -> `POST login` reusing the
    /// SAME `authHashB64`, with no second Argon2id pass.
    ///
    /// **Interrupted-registration fallback (ACC-01 concurrency edge).** A
    /// `PvApiError.httpError` whose status is `409` and whose message
    /// matches the server's own `"email already registered"` string
    /// (`crates/pv-server/src/routes/auth.rs`'s `register` handler) is
    /// treated as "this account already exists -- sign in instead" rather
    /// than propagated. This is safe because `signIn` re-derives
    /// `auth_hash` against whatever salt the server ACTUALLY stored (a
    /// prior, possibly-interrupted attempt's own committed row), never the
    /// discarded client-side salt this call generated. Any other non-2xx
    /// (wrong password surfacing later, network failure) still propagates
    /// normally -- the fallback fires ONLY on this exact 409-duplicate-email
    /// shape, never as a blanket retry.
    func register(email: String, password: String) async throws -> UnlockedSession {
        let saltData = generateRegistrationSalt()
        let saltB64 = saltData.base64EncodedString()
        let kdfParamsJson = defaultKdfParamsJson()

        var passwordData = Data(password.utf8)
        // CP-4 caller-side mitigation (crates/pv-ffi/src/lib.rs's own header
        // -- UniFFI cannot wipe the caller's buffer for us): immediately
        // after every pv-ffi call that took a password buffer. This MUST be
        // a `defer`, not a trailing statement -- a trailing wipe is skipped
        // entirely if `deriveAuthMaterial` throws (e.g. WR-11's bounds guard
        // rejecting out-of-range KDF params), leaving the plaintext master
        // password un-wiped on the Swift heap. `defer` runs on every exit
        // path, including the `throw`.
        defer { passwordData.resetBytes(in: 0..<passwordData.count) }
        let authMaterial = try deriveAuthMaterial(
            password: passwordData,
            salt: saltData,
            kdfParamsJson: kdfParamsJson
        )

        let userKey = try FfiUserKey.generate()
        let wrappedJson = try wrapUserKeyJson(wrappingKey: authMaterial.wrappingKey, userKey: userKey)

        do {
            _ = try await apiClient.register(
                email: email,
                kdfParamsJson: kdfParamsJson,
                saltB64: saltB64,
                authHashB64: authMaterial.authHashB64,
                pwWrappedUk: wrappedJson
            )
        } catch let error as PvApiError {
            if case let .httpError(status, message) = error,
               status == 409,
               message.contains("already registered") {
                return try await signIn(email: email, password: password)
            }
            throw error
        }

        let loginResult = try await apiClient.login(email: email, authHashB64: authMaterial.authHashB64)
        SessionTokenStore.save(loginResult.sessionToken)
        return UnlockedSession(token: loginResult.sessionToken, userKey: userKey)
    }

    /// `preloginKdf` -> `deriveAuthMaterial` over the SERVER-supplied salt
    /// and params -> `POST login` -> `unwrapUserKeyFromJson(wrappingKey:
    /// wrappedJson: pwWrappedUk)` -> `UnlockedSession`.
    func signIn(email: String, password: String) async throws -> UnlockedSession {
        let prelogin = try await apiClient.preloginKdf(email: email)
        guard let saltData = Data(base64Encoded: prelogin.saltB64) else {
            throw PvApiError.unexpectedResponse("prelogin salt was not valid base64")
        }

        var passwordData = Data(password.utf8)
        // CP-4 caller-side mitigation, `defer`-guarded for the same reason
        // as `register` above: `kdfParamsJson` here comes straight from the
        // SERVER's own `/api/auth/prelogin` response, so a malicious or
        // misbehaving server returning out-of-bounds KDF params (WR-11's
        // guard in crates/pv-ffi/src/lib.rs) can deterministically drive
        // `deriveAuthMaterial` to throw -- a trailing wipe would be skipped
        // on exactly that attacker-triggerable path.
        defer { passwordData.resetBytes(in: 0..<passwordData.count) }
        let authMaterial = try deriveAuthMaterial(
            password: passwordData,
            salt: saltData,
            kdfParamsJson: prelogin.kdfParamsJson
        )

        let loginResult = try await apiClient.login(email: email, authHashB64: authMaterial.authHashB64)
        let userKey = try unwrapUserKeyFromJson(
            wrappingKey: authMaterial.wrappingKey,
            wrappedJson: loginResult.pwWrappedUk
        )
        SessionTokenStore.save(loginResult.sessionToken)
        return UnlockedSession(token: loginResult.sessionToken, userKey: userKey)
    }

    /// A previously stored session token's account, recovered WITHOUT
    /// minting a new session row -- this is the re-unlock-after-relaunch
    /// route (`LockView`'s reason for existing): the User Key is not held
    /// in memory across a cold launch, but the server-issued token and the
    /// account's `pw_wrapped_uk` can be recovered from `GET /api/auth/me`
    /// while the User Key itself waits for a password or biometric unlock.
    /// Returns `nil` when no token is stored (never a thrown error -- "no
    /// session yet" is not a failure). A 401 (the stored token expired or
    /// was revoked server-side) clears the now-useless token before
    /// rethrowing, so a caller's next launch does not repeat the same
    /// doomed call.
    func restoreSession() async throws -> RestoredAccount? {
        guard let token = SessionTokenStore.load() else {
            return nil
        }
        do {
            let me = try await apiClient.me(token: token)
            return RestoredAccount(token: token, email: me.email, pwWrappedUkJson: me.pwWrappedUk)
        } catch let error as PvApiError {
            if case .invalidCredentials = error {
                SessionTokenStore.clear()
            }
            throw error
        }
    }

    /// Best-effort server-side revocation (never blocks on network failure
    /// -- the local token is cleared regardless), then clears the local
    /// session token unconditionally.
    func logout() async {
        if let token = SessionTokenStore.load() {
            try? await apiClient.logout(token: token)
        }
        SessionTokenStore.clear()
    }
}

/// The account recovered from a stored session token via `GET
/// /api/auth/me` -- no live `FfiUserKey` (the User Key is not recoverable
/// from the server alone; `pwWrappedUkJson` still needs a password or
/// biometric unlock to become one).
struct RestoredAccount {
    let token: String
    let email: String
    let pwWrappedUkJson: String
}
