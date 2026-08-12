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
//  Session token kept in memory ONLY in this plan -- Keychain storage is
//  37-04's job.
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
        let authMaterial = try deriveAuthMaterial(
            password: passwordData,
            salt: saltData,
            kdfParamsJson: kdfParamsJson
        )
        // CP-4 caller-side mitigation (crates/pv-ffi/src/lib.rs's own header
        // -- UniFFI cannot wipe the caller's buffer for us): immediately
        // after every pv-ffi call that took a password buffer.
        passwordData.resetBytes(in: 0..<passwordData.count)

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
        let authMaterial = try deriveAuthMaterial(
            password: passwordData,
            salt: saltData,
            kdfParamsJson: prelogin.kdfParamsJson
        )
        passwordData.resetBytes(in: 0..<passwordData.count)

        let loginResult = try await apiClient.login(email: email, authHashB64: authMaterial.authHashB64)
        let userKey = try unwrapUserKeyFromJson(
            wrappingKey: authMaterial.wrappingKey,
            wrappedJson: loginResult.pwWrappedUk
        )
        return UnlockedSession(token: loginResult.sessionToken, userKey: userKey)
    }
}
