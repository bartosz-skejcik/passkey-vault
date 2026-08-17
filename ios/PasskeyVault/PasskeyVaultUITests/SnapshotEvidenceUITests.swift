// SnapshotEvidenceUITests.swift -- Phase 38, plan 38-05, Task 3 (E-S1).
//
// Drives the REAL registration/sign-in + item-creation code path -- never a
// forced view state (`PV_UITEST_SCREEN`) -- to put a known marker secret on
// the real `ItemDetailView`, then backgrounds the app via an actual
// Home-button press so a real OS snapshot gets written. A forced screen
// state would prove nothing about E-S1: the decoder has to be pointed at a
// snapshot the system ACTUALLY captured of the ACTUAL app process, or a
// passing block-map assertion is worthless (this plan's own must-have
// truths).
//
// Hardcoded local test server (matches `AccountFlowLiveTests.swift`'s own
// `PV_TEST_SERVER` default of `http://127.0.0.1:8621`) and a hardcoded
// email/password/marker -- `TEST_RUNNER_*` env vars do not reach
// `app.launchEnvironment` reliably in this harness
// (`OnboardingServerStepUITests.swift`'s own documented finding), and this
// evidence run is throwaway by construction: E-S1's negative-control and
// discriminating-arm passes each need their own FULL rebuild of the app
// with a different compile-time flag, run as a SEPARATE `xcodebuild test`
// invocation against the SAME already-registered server account.
//
// `pv.server.url`/`pv.onboarding.completed` are set directly on the
// simulator's `UserDefaults` domain BEFORE this test runs (the driving
// shell transcript in 38-05-SUMMARY.md), the same way
// `PV_UITEST_RESET_ONBOARDING` resets keys elsewhere in this repo -- so
// this test can assume it lands on `AuthView` or `LockView`, never
// `OnboardingView`.

import XCTest

final class SnapshotEvidenceUITests: XCTestCase {
    /// A throwaway account against the LOCAL `pv-server`
    /// (`http://127.0.0.1:8621`) started for this evidence run -- never the
    /// hosted `vault.blonie.cloud` instance.
    static let email = "pv-snap-38-05@example.invalid"
    static let password = "PvSnap38-05-EvidencePassword!"
    /// The unique string E-S1's decoder run greps the marker's ABSENCE for
    /// (must-have: "The marker secret string does not appear in any
    /// attached artifact's decoded output").
    static let markerSecret = "PVSNAP3805EVIDENCEMARKER"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Registers (first run) or signs in (every subsequent rebuild against
    /// the same already-registered server account), creates the marker
    /// note if it is not already there, opens its detail screen, confirms
    /// the marker is genuinely on screen, then backgrounds the app with a
    /// real Home-button press -- the scriptable equivalent of the gesture
    /// 38-RESEARCH.md's E-S1 names.
    @MainActor
    func testCreateMarkerItemOpenDetailAndBackground() throws {
        let app = XCUIApplication()
        app.launch()

        try signInOrRegisterOrUnlock(app)

        let marker = Self.markerSecret
        let markerRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", marker)
        ).firstMatch

        if !markerRow.waitForExistence(timeout: 3) {
            let field = app.textFields["vault.create.marker"]
            XCTAssertTrue(field.waitForExistence(timeout: 15), "vault list / create field never appeared")
            field.tap()
            field.typeText(marker)
            app.buttons["vault.create.submit"].tap()
            XCTAssertTrue(markerRow.waitForExistence(timeout: 15), "marker note was never created")
        }
        markerRow.tap()

        // Confirm the REAL detail screen is showing the REAL marker before
        // trusting anything downstream -- a transition to some other screen
        // must not be silently treated as success.
        XCTAssertTrue(
            app.staticTexts[marker].waitForExistence(timeout: 5),
            "item detail screen never showed the marker secret"
        )

        XCUIDevice.shared.press(.home)
        // Give SplashBoard time to actually write the snapshot file before
        // this test (and the whole xcodebuild invocation) exits.
        Thread.sleep(forTimeInterval: 3)
    }

    private func signInOrRegisterOrUnlock(_ app: XCUIApplication) throws {
        let unlockPasswordField = app.secureTextFields["unlock-password-field"]
        let authEmailField = app.textFields.firstMatch

        // LockView: a restored session exists, only the password is needed.
        if unlockPasswordField.waitForExistence(timeout: 5) {
            unlockPasswordField.tap()
            unlockPasswordField.typeText(Self.password)
            app.buttons["Unlock"].tap()
            let listOrField = app.textFields["vault.create.marker"]
            XCTAssertTrue(listOrField.waitForExistence(timeout: 15), "vault list never appeared after unlock")
            return
        }

        // AuthView: try sign-in first (the account may already exist from a
        // PRIOR run of this same test against the same server).
        XCTAssertTrue(authEmailField.waitForExistence(timeout: 10), "neither LockView nor AuthView appeared")
        authEmailField.tap()
        authEmailField.typeText(Self.email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(Self.password)
        app.buttons["Log in"].tap()

        let listField = app.textFields["vault.create.marker"]
        if listField.waitForExistence(timeout: 8) {
            return
        }

        // Sign-in failed (first run ever -- account does not exist yet).
        // Switch to Create account and register instead.
        app.buttons["No account yet? Sign up"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["Create account"].tap()

        XCTAssertTrue(listField.waitForExistence(timeout: 15), "vault list never appeared after registration")
    }
}
