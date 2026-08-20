// LaunchOfflineLockUITests.swift -- Phase 42-era correction. Regression coverage for
// `.planning/debug/ios-cold-launch-blank-offline.md` (REQUIRED FIX proof (a)/(b)/(c)).
//
// Drives a REAL cold launch of the host app with the server address pointed at an unreachable
// host and a session already "restored" -- proving, live, that:
//   1. The Lock screen (`lock-title`) renders promptly -- NOT gated on a network round trip
//      (the original defect: a blank `ProgressView()` for as long as `GET /api/auth/me` took to
//      fail).
//   2. The app NEVER lands on the sign-in screen (`auth-title`) merely because the server is
//      unreachable -- the WORSE half of the original defect (a signed-in user silently signed
//      out by a transport failure).
//   3. Password unlock SUCCEEDS with the server still unreachable -- the offline-unlock proof:
//      this can only work if `pw_wrapped_uk` was recovered from a LOCAL cache
//      (`AccountEnvelopeCache`), never from the network.
//
// The seed (`OfflineLockUITestSeeder.seed(serverURLString:)`, host app target, `#if DEBUG`) runs
// from `PasskeyVaultApp.init()` -- BEFORE `ContentView` is ever constructed, which is load-bearing
// (see that seeder's own header: `ContentView.apiClient` captures the server URL at construction
// time). It writes a REAL, locally-wrapped account envelope through the SAME `pv-ffi` calls
// `AccountService.register`/`signIn` use, and points `ServerSettings` at the address this test
// passes via `PV_UITEST_OFFLINE_LOCK_SEED` -- one env var, value IS the payload (this repo's
// `PV_UITEST_E41_7_IDLE_MINUTES` precedent, `PasskeyVaultApp.swift`).
//
// `fixturePassword`/`fixtureEmail` are DUPLICATED here from `OfflineLockUITestSeeder.swift` (host
// app target) -- same "separate build targets, no in-process import" discipline
// `AutoFillColdOfflineUITests.swift`'s own header already established for this exact class of
// cross-target literal (a UI test target drives the app via accessibility, it does not link
// against it).
//
// Marked with this repo's existing offline conventions: this test asserts the SAME class of claim
// `AutoFillColdOfflineUITests`'s own header names ("no network dependency is actually needed"),
// scoped here to the HOST APP's own launch/routing rather than the AutoFill extension's fill path.

import Foundation
import XCTest

final class LaunchOfflineLockUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// TEST-NET-3 (RFC 5737) -- reserved, guaranteed non-routable, and (per this session's own
    /// live proof, `ios/evidence/42/launch-offline/`) fails FAST on this simulator's virtual
    /// networking rather than needing a full connect-timeout, keeping this test's own bound tight.
    private static let unreachableServer = "http://203.0.113.1:9999"

    /// DUPLICATED from `OfflineLockUITestSeeder.swift` (host app target) -- see this file's own
    /// header.
    private static let fixturePassword = "Offline-Lock-42-Fixture!"

    @MainActor
    func testColdLaunchOfflineRendersLockScreenNeverBouncesToSignInAndUnlocksWithPasswordAlone() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_OFFLINE_LOCK_SEED"] = Self.unreachableServer
        // Measured AFTER `app.launch()` returns, deliberately -- `launch()` itself blocks on
        // XCUITest's own install/spawn/UI-quiescence machinery (observed empirically: 5-7s of
        // harness overhead alone, unrelated to anything this app's own routing code does). Timing
        // from `launch()`'s own return isolates the ONLY thing this test is actually about: how
        // long THIS APP's `.task { determineRoute() }` takes to land on `.lock`, not how long the
        // simulator took to boot a fresh process.
        app.launch()
        let launchReturned = Date()

        // --- Proof (a)/(b): the lock screen renders promptly, and this is NOT the sign-in screen.
        let lockTitle = app.staticTexts["lock-title"]
        guard lockTitle.waitForExistence(timeout: 3) else {
            XCTFail(
                "Lock screen ('lock-title') never appeared within 3s of `app.launch()` returning, " +
                    "against an unreachable server -- REQUIRED FIX #1 (launch must never block on " +
                    "the network) has regressed."
            )
            return
        }
        let elapsedToLockScreen = Date().timeIntervalSince(launchReturned)
        // By the time `launch()` returns, XCUITest has already waited for UI quiescence -- so a
        // correctly-fixed app should already show `.lock` (elapsed ~0). This bound stays generous
        // (a real device renders far faster, per `ios/evidence/42/launch-offline/after-fix-*.png`'s
        // own sub-2s wall-clock timestamps) because the OLD, buggy code's own failure mode here
        // would be either a `ProgressView()` that keeps `waitForExistence` above polling for the
        // full 3s before failing outright, or the "Sign in" screen -- both already caught by the
        // guard above and the `auth-title` assertion below; this bound is a second, independent
        // signal, not the only one.
        XCTAssertLessThan(
            elapsedToLockScreen, 2,
            "Lock screen took \(elapsedToLockScreen)s to appear AFTER app.launch() returned -- " +
                "should be near-instant, gated on local Keychain reads only, never on a network " +
                "round trip."
        )
        XCTAssertFalse(
            app.staticTexts["auth-title"].exists,
            "A signed-in session must NEVER land on the sign-in screen just because the server is " +
                "unreachable (REQUIRED FIX #3 -- the ONLY case that may bounce to sign-in is a REAL " +
                "401 from the server, which this offline run can never produce)."
        )

        // --- Proof (c): password unlock succeeds with the server still unreachable. The seed
        // deliberately clears any biometric envelope (`OfflineLockUITestSeeder`'s own header), so
        // the biometry-hero layout (if shown at all) resolves to the password-primary layout on
        // its own once the auto biometric attempt reports `.envelopeInvalidated` -- this loop
        // tolerates that transition without depending on its exact timing.
        var passwordField = app.secureTextFields["unlock-password-field"]
        if !passwordField.waitForExistence(timeout: 1) {
            let useMasterPassword = app.buttons["lock-use-master-password"]
            if useMasterPassword.waitForExistence(timeout: 3) {
                useMasterPassword.tap()
            }
            passwordField = app.secureTextFields["unlock-password-field"]
        }
        guard passwordField.waitForExistence(timeout: 5) else {
            XCTFail("Password field ('unlock-password-field') never appeared -- cannot drive the offline-unlock proof.")
            return
        }
        passwordField.tap()
        passwordField.typeText(Self.fixturePassword)

        let submit = app.buttons["lock-password-submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 3))
        submit.tap()

        // A real, stable, post-unlock-only element -- `ItemListView`'s own "+" create control.
        let unlockedMarker = app.buttons["vault.create.plusMenu"]
        guard unlockedMarker.waitForExistence(timeout: 10) else {
            XCTFail(
                "Password unlock did not reach the unlocked vault with the server unreachable -- " +
                    "the offline-unlock proof (REQUIRED FIX #2, the cached pw_wrapped_uk envelope) " +
                    "has regressed."
            )
            return
        }
        XCTAssertFalse(app.staticTexts["auth-title"].exists, "Still must not be on the sign-in screen after a successful offline unlock.")
    }
}
