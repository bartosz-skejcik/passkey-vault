// AutoFillLockUITests.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-07, Tasks 2 and 3.
//
// E41-4 (Task 2): the cross-process lock, direction 1 -- host unlocks (a REAL ACC-04 unlock,
// biometric, through `LockView`/`BiometricUnlockService`, never a simulated one) -> the
// extension fills silently -> the check is shown able to refuse when the marker is artificially
// expired. E41-7 (Task 3): direction 2 -- extension-only activity keeps the host session alive
// (ACC-07), expiry deletes the real Keychain artifact and a fresh unlock recreates a readable one
// (ACC-06), and a backward-jump clock model does not resurrect an expired session.
//
// Every scenario seeds through `LockE41Seeder` (host app target, `PV_PROBE_E41_LOCK`,
// `PV_UITEST_E41_LOCK_SEED=1`) -- Secret A + one real cache item + one identity, through the SAME
// production writers this repo's whole Phase 41 evidence chain already uses -- then reaches the
// REAL unlock through `PV_UITEST_SCREEN=lock` (the existing forced-route hook,
// `ContentView.swift`), which still runs `LockView`'s genuinely real
// `BiometricUnlockService.unlockWithBiometrics()` (never `PV_UITEST_LOCK_STATE`, which THIS file
// deliberately never sets -- that hook renders a forced SCREENSHOT state and bypasses the real
// Keychain/LAContext path entirely). `scripts/ios-autofill-e41.sh` runs a parallel
// `notifyutil -p com.apple.BiometricKit_Sim.pearl.match` loop for this whole test's duration
// (Safari's own confirmation gate, and this app's own biometric prompt) -- the SAME technique
// `AutoFillFillUITests.swift`/`AutoFillMatchingUITests.swift` already established.
//
// Every falsification/scenario switch (the artificially-expired marker, the backward-clock
// offset, the short idle window) is driven by files/env vars the SCRIPT controls -- never a
// second, hand-written "locked" simulation inside this file -- so every scenario exercises the
// SAME real production code path (`ContentView.handleUnlocked` -> `SessionLifecycle
// .recordHostUnlock()` -> optionally `AutoFillLockE41TestHook.applyMarkerOffsetIfRequested()`).

import Foundation
import XCTest

final class AutoFillLockUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// DUPLICATED from `LockE41Seeder.swift` (host app target) -- UI test targets drive the app
    /// out-of-process via the Accessibility API and do not compile against the app module
    /// (`AutoFillFillUITests.swift`'s own header, same discipline).
    private static let host = "127.0.0.1"
    private static let port = 8765
    private static let expectedPassword = "E41-Lock-07-Fill!"

    // MARK: - Task 2 (E41-4)

    /// Run 1 (unexpired): a REAL biometric unlock, then an immediate QuickType fill. Asserts the
    /// silent, no-ceremony branch DR-41-A(b) predicts fills the correct password.
    ///
    /// TWO separate test methods, not one shared method switched by an environment variable --
    /// found live, this session: `TEST_RUNNER_<VAR>` (Xcode's documented mechanism for injecting
    /// an env var into the XCTest RUNNER process, distinct from `XCUIApplication
    /// .launchEnvironment`, which only reaches the LAUNCHED APP under test) did NOT actually reach
    /// `ProcessInfo.processInfo.environment` inside this file's own test methods on this
    /// toolchain -- confirmed by a run that unconditionally exercised the UNEXPIRED branch
    /// regardless of the `TEST_RUNNER_PV_UITEST_E41_4_EXPECT=expired` override. The XCTest runner
    /// process also has no App Group entitlement, so it cannot read a marker file itself either
    /// (`AutoFillLockE41TestHook`'s own file-based signal only reaches the PRODUCTION app, which
    /// does hold the entitlement) -- splitting into two compile-time-distinct test methods, each
    /// with ITS OWN hardcoded expectation, sidesteps the whole class of problem, and matches this
    /// file's own E41-7 methods, which were never driven by a runtime switch in the first place.
    @MainActor
    func testE41_4_UnexpiredHostUnlockThenExtensionFillsSilently() throws {
        seedLockFixtures()
        performRealHostUnlock()

        let filled = driveLockFormFill()
        XCTAssertEqual(
            filled, Self.expectedPassword,
            "Unexpired run: filled password (\"\(filled)\") did not byte-equal the expected E41-4 fixture plaintext."
        )
        print("PVUITEST|E41-4|scenario=unexpired field-value-equal=\(filled == Self.expectedPassword)")
    }

    /// Run 2 (artificially expired): the IDENTICAL real-unlock sequence, with
    /// `e41-lock-marker-offset.marker` set to a negative offset by the driving script BEFORE this
    /// method runs -- `AutoFillLockE41TestHook.applyMarkerOffsetIfRequested()`, the SAME real
    /// production call site the unexpired run above exercises, just fed a different file. Proves
    /// the lazy check can refuse: if it took the silent branch here too, every PASS above would be
    /// meaningless.
    @MainActor
    func testE41_4_ExpiredMarkerRefusesTheFill() throws {
        seedLockFixtures()
        performRealHostUnlock()

        let filled = driveLockFormFill()
        XCTAssertEqual(
            filled, "-none-",
            "Expired-marker run: password field should still hold its original placeholder, got \"\(filled)\"."
        )
        print("PVUITEST|E41-4|scenario=expired field-value-equal=\(filled == Self.expectedPassword)")
    }

    // MARK: - Task 3 (E41-7)

    /// ACC-07 leg: a short idle window (`PV_UITEST_E41_7_IDLE_MINUTES=1`, set by the driving
    /// script on the seed launch), one real unlock, then a SEQUENCE of extension-only fills, each
    /// gap comfortably inside the 60s window on its own but ACCUMULATING to land well past the
    /// window measured from the ORIGINAL unlock -- with NO host-app launch anywhere in between.
    /// Found live, this session: a single big jump (one ~65s sleep, then one fill) is fragile --
    /// that fill's own UI-driving overhead (Safari navigation + the "Fill Password" confirmation
    /// chain, empirically ~15-20s) pushed the ACTUAL check moment to ~83s after the PRECEDING
    /// refresh, past even the REFRESHED 60s window, producing a FALSE refusal that says nothing
    /// about ACC-07. Three smaller, successive hops (each individual gap staying under 60s) reach
    /// the same "past the original window" destination with much wider margin per hop. The
    /// receiver-side ACC-07 assertion itself (host reads a marker value the extension logged
    /// writing) is verified by the SCRIPT correlating `PasskeyVaultApp`'s own
    /// `PVLOCK|stage=host-launch-read writer=extension` log line (emitted on ITS OWN next
    /// launch, driven separately below) against the extension's `PVLOCK|stage=activity-refresh
    /// writer=extension` line.
    @MainActor
    func testE41_7_ACC07_ExtensionOnlyActivityKeepsHostSessionAlive() throws {
        seedLockFixtures(idleMinutes: 1)
        performRealHostUnlock(idleMinutes: 1)

        var results: [Bool] = []
        for hop in 1...3 {
            let filled = driveLockFormFill()
            let ok = filled == Self.expectedPassword
            results.append(ok)
            XCTAssertTrue(ok, "Extension-only fill #\(hop) should still succeed (got \"\(filled)\").")
            if hop < 3 {
                Thread.sleep(forTimeInterval: 25) // comfortably under the 60s window on its own
            }
        }
        print("PVUITEST|E41-7-ACC07|hops-ok=\(results)")

        // Re-launch the host app (never unlocking it -- `PasskeyVaultApp.init()`'s own
        // unconditional `PVLOCK|stage=host-launch-read` line fires on EVERY launch, before any
        // routing decision) so the SCRIPT can read its receiver-side log line.
        let hostApp = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
        hostApp.launch()
        sleep(2)
        hostApp.terminate()
    }

    /// ACC-06 leg: unlock, let the SHORT idle window expire untouched by either process, invoke
    /// the extension (expect refusal + Secret C deleted -- the delete's own logged `OSStatus` is
    /// this leg's absence evidence, `SessionKeyReader.delete()`'s own header), THEN unlock again
    /// for real and prove a fresh unlock recreates a readable entry (the mandatory PAIRED
    /// positive, never absence alone).
    @MainActor
    func testE41_7_ACC06_ExpiryDeletesRealKeychainEntryAndFreshUnlockRecreatesIt() throws {
        seedLockFixtures(idleMinutes: 1)
        performRealHostUnlock(idleMinutes: 1)

        Thread.sleep(forTimeInterval: 65) // past the 60s window, untouched by either process

        let filledAfterExpiry = driveLockFormFill()
        XCTAssertEqual(
            filledAfterExpiry, "-none-",
            "After the idle window elapses untouched, the extension must refuse -- got \"\(filledAfterExpiry)\"."
        )

        // The paired positive: a FRESH real unlock must recreate a readable Secret C.
        performRealHostUnlock(idleMinutes: 1)
        let filledAfterFreshUnlock = driveLockFormFill()
        XCTAssertEqual(
            filledAfterFreshUnlock, Self.expectedPassword,
            "A fresh unlock after expiry must recreate a READABLE Secret C -- got \"\(filledAfterFreshUnlock)\"."
        )
        print(
            "PVUITEST|E41-7-ACC06|refused=\(filledAfterExpiry == "-none-") " +
                "recreated-ok=\(filledAfterFreshUnlock == Self.expectedPassword)"
        )
    }

    /// Clock leg (backward): DR-41-C's own clock (boot-session id + monotonic `systemUptime`,
    /// never `Date()`) has no live wall-clock attack surface on this harness -- see
    /// `AutoFillLockE41TestHook.swift`'s own header for the reconciliation. This models the
    /// EFFECT a rewound clock would have produced: `e41-lock-marker-offset.marker` set to a
    /// POSITIVE offset (the marker claims to have been written in the future), applied by
    /// `AutoFillLockE41TestHook` immediately after the real unlock below. Must NOT resurrect the
    /// session -- `LockMarker.isUnlockedLazily`'s own `now >= systemUptimeAtUnlock` guard is the
    /// mechanism, already unit-proven pure in `LockMarkerTests
    /// .aMarkerDatedInTheFutureIsNeverUnlocked`; this is that SAME guard's live, two-process leg.
    @MainActor
    func testE41_7_BackwardClockDoesNotResurrectAnExpiredSession() throws {
        seedLockFixtures()
        performRealHostUnlock() // the driving script has ALREADY armed the future-offset marker

        let filled = driveLockFormFill()
        XCTAssertEqual(
            filled, "-none-",
            "A marker claiming to be from the future must never be treated as unlocked -- got \"\(filled)\"."
        )
        print("PVUITEST|E41-7-BACKWARD|refused=\(filled == "-none-")")
    }

    // MARK: - Shared driving helpers

    /// Launch #1 -- seeds Secret A + one real cache item + one identity, through `LockE41Seeder`
    /// (`PV_PROBE_E41_LOCK`, `PV_UITEST_E41_LOCK_SEED=1`). Deliberately a SEPARATE launch from the
    /// real-unlock one below -- `PasskeyVaultApp.init()`'s own comment explains why re-seeding on
    /// the SAME launch as the real unlock would race a fresh `FfiUserKey` against the read the
    /// unlock just performed.
    @MainActor
    private func seedLockFixtures(idleMinutes: Int? = nil) {
        let hostApp = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
        hostApp.launchEnvironment["PV_UITEST_E41_LOCK_SEED"] = "1"
        if let idleMinutes {
            hostApp.launchEnvironment["PV_UITEST_E41_7_IDLE_MINUTES"] = String(idleMinutes)
        }
        hostApp.launch()
        sleep(3)
        hostApp.terminate()
    }

    /// Launch #2 -- the REAL unlock. `PV_UITEST_SCREEN=lock` forces `ContentView`'s route to
    /// `.lock` with a fixture `RestoredAccount` (never a real signed-in session -- this test never
    /// touches the server), but `LockView.setUpOnAppear()` still runs its GENUINELY REAL
    /// `BiometricUnlockService.biometryAvailability()` + auto `attemptBiometricUnlock` (NOT
    /// `PV_UITEST_LOCK_STATE`, which this file never sets). On success, `onUnlocked` ->
    /// `ContentView.handleUnlocked` writes Secret C + calls `SessionLifecycle.recordHostUnlock()`
    /// for real, then (DEBUG only) `AutoFillLockE41TestHook.applyMarkerOffsetIfRequested()` -- a
    /// no-op unless the driving script armed an offset marker file beforehand.
    @MainActor
    private func performRealHostUnlock(idleMinutes: Int? = nil) {
        let hostApp = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
        hostApp.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        if let idleMinutes {
            hostApp.launchEnvironment["PV_UITEST_E41_7_IDLE_MINUTES"] = String(idleMinutes)
        }
        hostApp.launch()
        // Settle margin for the real biometric ceremony (the driving script's own parallel
        // `pearl.match` poster needs a moment to land) + `handleUnlocked`'s own Keychain writes.
        sleep(5)

        // Plan 41-07, Task 1's OWN "host-foreground" entry point (`ContentView`'s `scenePhase`
        // handler, only reachable once `.unlocked` -- SwiftUI's `.onChange` fires on a genuine
        // TRANSITION, never on a route change alone, so this needs an ACTUAL background/foreground
        // round trip): press Home, settle, reactivate WITHOUT a fresh `.launch()` (which would
        // reset app state and lose the `.unlocked` route this is trying to exercise), settle
        // again. Exercised on every real unlock in this file so the entry-point COUNT this task's
        // own acceptance criterion demands ("one line per entry point... a count is required, not
        // a spot check") is observable across every live run in this suite, not a one-off.
        XCUIDevice.shared.press(.home)
        sleep(1)
        hostApp.activate()
        sleep(1)

        hostApp.terminate() // "do not open the host app again" (E41-4's own action text)
    }

    /// Navigates Safari to the E41-lock login form, taps the username field, and ALWAYS attempts
    /// the full "Fill Password" confirmation chain -- NEVER skips the tap for a refused/expired
    /// scenario. `AutoFillMatchingUITests.driveTracerFormFill`'s own header records the reason,
    /// found live in an earlier session: the extension's silent entry point is NOT reliably
    /// invoked by mere field focus alone -- it only reliably runs once a suggestion is actually
    /// TAPPED (the suggestion sheet itself is populated entirely system-side from
    /// `ASCredentialIdentityStore` metadata, independent of Secret C's own state). Driving the
    /// SAME full tap sequence for every scenario and asserting the OUTCOME (filled vs.
    /// `"-none-"`) is what THAT file's own comment calls out explicitly; skipping the tap for a
    /// refused run was tried in an earlier iteration of THIS file and produced a false "filled"
    /// result from a STALE page state, confirmed live this session -- removed. Never calls
    /// `safari.terminate()` either, for the SAME reason: `AutoFillMatchingUITests`'s own
    /// established, PROVEN-live accepted/refused pair distinguishes correctly across TWO SEPARATE
    /// `xcodebuild test` invocations using nothing more than a fresh navigation via the address
    /// bar -- an explicit terminate-then-relaunch was found live, this session, to risk Safari
    /// restoring a STALE prior tab instead of a clean one.
    ///
    /// Duplicated from `AutoFillMatchingUITests.driveTracerFormFill`'s own established shape
    /// (this project's own convention: each UI test file keeps its own copy rather than sharing
    /// one, since UI test targets are not importable modules).
    @MainActor
    private func driveLockFormFill() -> String {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-LOCK|reason=no-address-bar")
            return "-none-"
        }
        addressBar.tap()
        addressBar.typeText("http://\(Self.host):\(Self.port)/")
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-LOCK|reason=no-username-field")
            return "-none-"
        }
        usernameField.tap()
        sleep(2)

        var fillPasswordButton = safari.buttons["FillPasswordButton"]
        if !fillPasswordButton.waitForExistence(timeout: 5) {
            let passwordsAccessory = safari.buttons["Passwords"]
            if passwordsAccessory.waitForExistence(timeout: 4) {
                var providerRow = safari.buttons["PasskeyVault"]
                var attempt = 0
                while attempt < 3 && !providerRow.exists && !safari.buttons["FillPasswordButton"].exists {
                    passwordsAccessory.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    _ = providerRow.waitForExistence(timeout: 3)
                    providerRow = safari.buttons["PasskeyVault"]
                    attempt += 1
                }
                if safari.buttons["FillPasswordButton"].exists {
                    fillPasswordButton = safari.buttons["FillPasswordButton"]
                } else if providerRow.exists {
                    providerRow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    fillPasswordButton = safari.buttons["FillPasswordButton"]
                    _ = fillPasswordButton.waitForExistence(timeout: 5)
                }
            }
        }
        if fillPasswordButton.exists {
            fillPasswordButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            sleep(2)
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            if springboard.alerts.firstMatch.waitForExistence(timeout: 3) {
                let continueButton = springboard.buttons["Continue"]
                if continueButton.exists {
                    continueButton.tap()
                } else {
                    springboard.alerts.firstMatch.buttons.element(
                        boundBy: springboard.alerts.firstMatch.buttons.count - 1
                    ).tap()
                }
            }
        } else {
            // Legitimate for a refused/expired scenario: our extension never completed the
            // request, so the system may never have anything to confirm. Diagnostic only.
            print("PVUITEST|E41-LOCK|reason=no-fill-suggestion-surfaced")
        }

        let passwordReadback = safari.webViews.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "PWFIELD:")
        ).firstMatch
        guard passwordReadback.waitForExistence(timeout: 20) else {
            return "-none-"
        }
        return String(passwordReadback.label.dropFirst("PWFIELD:".count))
    }
}
