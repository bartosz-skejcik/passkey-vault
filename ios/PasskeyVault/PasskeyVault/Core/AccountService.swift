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
///
/// `email` (plan 39-03, Rule 2 deviation): the account identifier
/// `ContentView.storeFor` threads into `VaultStore`'s `accountId`, which
/// `CiphertextCacheStore` checks on every read (D-19) -- without it, the
/// persisted cache would have no way to reject a snapshot left behind by a
/// different account on the same device. Every construction site already
/// has the email in scope; this is not a new network call.
struct UnlockedSession {
    let token: String
    let userKey: FfiUserKey
    let email: String
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
        // Phase 42-era correction (`.planning/debug/ios-cold-launch-blank-offline.md`,
        // `AccountEnvelopeCache.swift`'s own header): every real login success caches
        // `pw_wrapped_uk` + `email` + `salt`/`kdf` locally, so a later cold launch can route
        // straight to `LockView` AND unlock offline (`salt`/`kdf` are what let `LockView` run
        // `deriveAuthMaterial` locally -- without them a password unlock still needs a live
        // `prelogin` round trip) without ever needing this call again.
        AccountEnvelopeCache.save(CachedAccountEnvelope(
            email: email, pwWrappedUkJson: loginResult.pwWrappedUk,
            saltB64: saltB64, kdfParamsJson: kdfParamsJson
        ))
        return UnlockedSession(token: loginResult.sessionToken, userKey: userKey, email: email)
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
        // Phase 42-era correction: same caching this file's `register` now also does -- see
        // `AccountEnvelopeCache.swift`'s own header. `prelogin.saltB64`/`prelogin.kdfParamsJson`
        // are the SERVER's own values (never a client-cached copy from a prior attempt, matching
        // this function's own long-standing rule stated in this file's header) -- caching them here
        // is what makes the NEXT unlock of this same session local-only.
        AccountEnvelopeCache.save(CachedAccountEnvelope(
            email: email, pwWrappedUkJson: loginResult.pwWrappedUk,
            saltB64: prelogin.saltB64, kdfParamsJson: prelogin.kdfParamsJson
        ))
        return UnlockedSession(token: loginResult.sessionToken, userKey: userKey, email: email)
    }

    /// A LOCAL-ONLY restore: reads `SessionTokenStore`/`AccountEnvelopeCache` straight off the
    /// Keychain, no network call, no `apiClient` involved at all (this is a `static` function
    /// precisely so its signature itself proves that -- there is no way for it to reach the
    /// network by accident). This is what `ContentView.determineRoute()`/`performLock()` now use
    /// for the FIRST render: it either returns a `RestoredAccount` immediately (an app that has
    /// ever completed one real login/restore on this device) or `nil` (nothing cached yet -- the
    /// caller's own fallback is a real `restoreSession()` call, exactly the pre-fix behaviour, for
    /// that one edge case). `nil` is also returned when a session token exists but the envelope
    /// cache does not (a session established before this cache existed) -- deliberately NOT
    /// treated as "signed out": the caller distinguishes that case via `SessionTokenStore.load()`
    /// itself and falls back to the network path rather than this file re-implementing that
    /// distinction twice.
    static func localAccount() -> RestoredAccount? {
        guard let token = SessionTokenStore.load(),
              let envelope = AccountEnvelopeCache.load()
        else {
            return nil
        }
        return RestoredAccount(
            token: token, email: envelope.email, pwWrappedUkJson: envelope.pwWrappedUkJson,
            saltB64: envelope.saltB64, kdfParamsJson: envelope.kdfParamsJson
        )
    }

    /// The offline password-unlock primitive itself (REQUIRED FIX #2's actual consumer):
    /// `deriveAuthMaterial` -> `unwrapUserKeyFromJson`, entirely local, no `apiClient`, no
    /// `AccountService` instance even needed (`static`, same discipline as `localAccount()`).
    /// Throws `LocalUnlockError.noCachedCredentials` when `account.saltB64`/`kdfParamsJson` are
    /// empty (a legacy/pre-cache session -- `CachedAccountEnvelope`'s own header) -- the caller's
    /// signal to fall back to the network-based `signIn` flow for that one case. Any OTHER thrown
    /// error (from `deriveAuthMaterial` or, far more commonly, `unwrapUserKeyFromJson`'s AEAD
    /// open failing) means exactly one thing to the caller: wrong password -- there is no server
    /// round trip here to distinguish "wrong password" from any other rejection reason, which is
    /// the whole point: the wrapped key's own AEAD tag IS the credential check.
    static func unlockLocally(account: RestoredAccount, password: String) throws -> FfiUserKey {
        guard !account.saltB64.isEmpty, !account.kdfParamsJson.isEmpty,
              let saltData = Data(base64Encoded: account.saltB64)
        else {
            throw LocalUnlockError.noCachedCredentials
        }
        var passwordData = Data(password.utf8)
        // CP-4 caller-side mitigation, same discipline as `register`/`signIn` above.
        defer { passwordData.resetBytes(in: 0..<passwordData.count) }
        let authMaterial = try deriveAuthMaterial(
            password: passwordData, salt: saltData, kdfParamsJson: account.kdfParamsJson
        )
        return try unwrapUserKeyFromJson(wrappingKey: authMaterial.wrappingKey, wrappedJson: account.pwWrappedUkJson)
    }

    /// A previously stored session token's account, recovered WITHOUT
    /// minting a new session row -- the server-issued token and the
    /// account's CURRENT `pw_wrapped_uk` can be recovered from `GET
    /// /api/auth/me`. Returns `nil` when no token is stored (never a thrown
    /// error -- "no session yet" is not a failure). A 401 (the stored token
    /// expired or was revoked server-side) clears the now-useless token
    /// before rethrowing, so a caller's next launch does not repeat the same
    /// doomed call.
    ///
    /// Phase 42-era correction: no longer `LockView`'s ONLY reason for
    /// existing (`ContentView.determineRoute()` now routes to `.lock` from
    /// `localAccount()`'s cached copy FIRST, with zero network) -- this call
    /// is now the BACKGROUND REFRESH `ContentView` fires once the lock
    /// screen is already showing, never a gate in front of it. On success it
    /// re-caches the envelope (`AccountEnvelopeCache.save`), which is both
    /// how the cache STAYS fresh across a long-lived install and, per
    /// `ios/evidence/42/`'s own proof requirement, an assertable side
    /// effect: a caller can read the cache back and see it rewritten.
    func restoreSession() async throws -> RestoredAccount? {
        guard let token = SessionTokenStore.load() else {
            return nil
        }
        do {
            let me = try await apiClient.me(token: token)
            // MERGE, never blank: `GET /api/auth/me` (`pv-server`'s own route contract, never
            // modified by this fix) does not return `salt`/`kdf` at all, so a background refresh
            // must PRESERVE whatever `register`/`signIn` already cached for this session --
            // overwriting them with empty strings here would silently downgrade an
            // already-offline-capable session back into one that needs the network to unlock
            // (`CachedAccountEnvelope`'s own header).
            let existing = AccountEnvelopeCache.load()
            let envelope = CachedAccountEnvelope(
                email: me.email, pwWrappedUkJson: me.pwWrappedUk,
                saltB64: existing?.saltB64 ?? "", kdfParamsJson: existing?.kdfParamsJson ?? ""
            )
            AccountEnvelopeCache.save(envelope)
            return RestoredAccount(
                token: token, email: me.email, pwWrappedUkJson: me.pwWrappedUk,
                saltB64: envelope.saltB64, kdfParamsJson: envelope.kdfParamsJson
            )
        } catch let error as PvApiError {
            if case .invalidCredentials = error {
                // The ONLY case that may bounce a signed-in user to sign-in (REQUIRED FIX #3): a
                // real, server-confirmed rejection of this token -- never a transport failure,
                // which is handled entirely by LockView's own offline treatment (38-11 state 8)
                // and must never reach here as a reason to sign anyone out.
                SessionTokenStore.clear()
                AccountEnvelopeCache.clear()
            }
            throw error
        }
    }

    /// Best-effort server-side revocation (never blocks on network failure
    /// -- the local token is cleared regardless), then clears the local
    /// session token AND the cached account envelope unconditionally --
    /// `AccountEnvelopeCache`'s own header names this as one of the two
    /// places (alongside `ServerSettings.store(_:)`) that must clear it
    /// alongside `SessionTokenStore`.
    func logout() async {
        if let token = SessionTokenStore.load() {
            try? await apiClient.logout(token: token)
        }
        SessionTokenStore.clear()
        AccountEnvelopeCache.clear()
    }
}

/// The account recovered from either a local Keychain read (`AccountService
/// .localAccount()`) or a live `GET /api/auth/me` (`AccountService
/// .restoreSession()`) -- no live `FfiUserKey` (the User Key is not
/// recoverable from either source alone; `pwWrappedUkJson` still needs a
/// password or biometric unlock to become one). `saltB64`/`kdfParamsJson`
/// are `""` when not yet cached (a legacy/pre-cache session) -- `LockView`
/// reads that as "no local unlock is possible yet" (`AccountService
/// .unlockLocally`'s own doc comment).
struct RestoredAccount {
    let token: String
    let email: String
    let pwWrappedUkJson: String
    let saltB64: String
    let kdfParamsJson: String
}

/// Thrown by `AccountService.unlockLocally(account:password:)` when the account's cached envelope
/// carries no `salt`/`kdf` yet -- the caller's signal to fall back to the network-based `signIn`
/// flow (see that function's own doc comment).
enum LocalUnlockError: Error {
    case noCachedCredentials
}
