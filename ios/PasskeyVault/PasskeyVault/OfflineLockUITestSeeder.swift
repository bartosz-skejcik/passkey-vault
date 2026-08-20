// OfflineLockUITestSeeder.swift -- Phase 42-era correction, evidence/proof harness for
// `.planning/debug/ios-cold-launch-blank-offline.md` (REQUIRED FIX proof (a)/(b)/(c)) and
// `LaunchOfflineLockUITests.swift`.
//
// Seeds EVERYTHING `ContentView.routeToLockOrAuth()`'s local-only path needs -- an unreachable
// server address (through the REAL `ServerSettings.store(_:)`) and a REAL, locally-wrapped
// account envelope (through the REAL `deriveAuthMaterial`/`wrapUserKeyJson` FFI calls
// `AccountService.register`/`signIn` themselves use, never a hand-rolled JSON shape) -- with ZERO
// network involved anywhere in this file. This is deliberately NOT `AccountService.register`
// itself: that call requires a live server (`POST /api/auth/register`/`login`); this seeder proves
// the SAME cryptographic artifact can be produced and consumed with the server absent entirely,
// which is the whole point of the offline-unlock proof.
//
// Runs from `PasskeyVaultApp.init()`, BEFORE `ContentView` is ever constructed -- load-bearing:
// `ContentView.apiClient` is a `let` property whose initializer captures `ServerSettings.resolved`
// AT CONSTRUCTION TIME (that property's own doc comment). Setting the server URL any later (e.g.
// from inside `ContentView.determineRoute()`) would miss it entirely, and the background refresh
// (`refreshSessionInBackground()`) would silently hit whatever URL was resolved before the seed
// ran -- possibly a REAL, reachable server, defeating the whole point of this harness.
//
// Also clears `UkEnvelopeStore` (Secret A, Phase 37's biometric envelope) unconditionally: this
// simulator/device may carry a STALE envelope from an earlier, unrelated session (biometric
// enrollment is orthogonal to which account is signed in), and a stale-but-valid envelope would
// let `LockView`'s automatic biometric attempt silently succeed before this harness's own
// PASSWORD-path proof ever gets to run. Clearing it deterministically routes `LockView` into its
// password-primary layout instead -- exactly what `LaunchOfflineLockUITests` needs to exercise.
//
// #if DEBUG only, inert unless `PV_UITEST_OFFLINE_LOCK_SEED` is set (this repo's established
// `PV_UITEST_*` hook convention -- see `PasskeyVaultApp.swift`'s own header, or
// `SessionKeyProbeSeeder.swift`'s identical "real writer, zero fake shapes" discipline).

import Foundation
import os

#if DEBUG
enum OfflineLockUITestSeeder {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Fixture account identity -- never a real, server-known account (this harness never talks to
    /// a server at all). Distinguishable at a glance from any real email in a log/screenshot.
    static let fixtureEmail = "offline-lock-uitest@pv.test.invalid"
    /// The REAL master password this fixture's envelope is wrapped under -- `LaunchOfflineLockUITests`
    /// types this exact string into the password field to prove REQUIRED FIX proof (b)/(c): unlock
    /// succeeds with the server unreachable.
    static let fixturePassword = "Offline-Lock-42-Fixture!"
    /// Never a real server-issued token (this harness mints no session server-side) -- clearly
    /// labelled so a log line naming it is unambiguous about its own fixture-ness.
    static let fixtureToken = "pv-uitest-offline-lock-fixture-token"

    /// `serverURLString`: the UNREACHABLE address this proof run points the app at (the env var's
    /// own VALUE, not just its presence -- one env var serves as both the trigger and the payload,
    /// matching `PV_UITEST_E41_7_IDLE_MINUTES`'s own established shape in `PasskeyVaultApp.swift`).
    static func seed(serverURLString: String) {
        guard let url = URL(string: serverURLString) else {
            logger.error("PVLOCK|stage=offline-lock-uitest-seed status=bad-server-url")
            return
        }
        // REAL `ServerSettings.store(_:)` -- the SAME call `SettingsView`'s own server-address
        // form uses -- so this proof run ALSO exercises the "clears cached secrets on server
        // change" path (`ServerSettings.swift`'s own Phase-42 addition) rather than merely
        // asserting it exists.
        try? ServerSettings.store(url)

        // See this file's own header: a stale biometric envelope from an earlier session would
        // otherwise let LockView auto-unlock before the password-path proof runs.
        UkEnvelopeStore.delete()
        SessionKeyStore.delete()

        // Onboarding must already be complete -- a fresh `pv.onboarding.completed` would route to
        // `.onboarding`, never reaching `routeToLockOrAuth()` at all.
        UserDefaults.standard.set(true, forKey: OnboardingGate.completedKey)

        let saltData = generateRegistrationSalt()
        let kdfParamsJson = defaultKdfParamsJson()
        var passwordData = Data(fixturePassword.utf8)
        defer { passwordData.resetBytes(in: 0..<passwordData.count) }

        guard let authMaterial = try? deriveAuthMaterial(
            password: passwordData, salt: saltData, kdfParamsJson: kdfParamsJson
        ) else {
            logger.error("PVLOCK|stage=offline-lock-uitest-seed status=derive-auth-material-failed")
            return
        }
        guard let userKey = try? FfiUserKey.generate() else {
            logger.error("PVLOCK|stage=offline-lock-uitest-seed status=generate-user-key-failed")
            return
        }
        guard let wrappedJson = try? wrapUserKeyJson(wrappingKey: authMaterial.wrappingKey, userKey: userKey) else {
            logger.error("PVLOCK|stage=offline-lock-uitest-seed status=wrap-user-key-failed")
            return
        }

        SessionTokenStore.save(fixtureToken)
        AccountEnvelopeCache.save(CachedAccountEnvelope(
            email: fixtureEmail, pwWrappedUkJson: wrappedJson,
            saltB64: saltData.base64EncodedString(), kdfParamsJson: kdfParamsJson
        ))
        logger.log("PVLOCK|stage=offline-lock-uitest-seed status=ok server=\(url.absoluteString, privacy: .public)")
    }
}
#endif
