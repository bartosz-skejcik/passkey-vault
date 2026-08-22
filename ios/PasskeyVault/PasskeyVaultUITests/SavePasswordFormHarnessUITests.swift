// SavePasswordFormHarnessUITests.swift -- Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-03,
// Task 1. Drives `SavePasswordFormView.swift`'s two real `UITextField`s (username / new-password,
// both `UIViewRepresentable`-wrapped, carrying real `.textContentType`/`UITextInputPasswordRules`)
// and taps "Submit" (which unfocuses both fields) -- then polls for whatever system chrome, if
// any, the OS draws in response, tapping through a best-effort "Save Password"/"Continue"/"Not
// Now" chain when found.
//
// Structure duplicated from `NativeAppRegisterUITests.swift`'s own established shape (this
// project's own discipline: no shared framework between separate UI test files) --
// `.activate()` never `.launch()`, screenshot+hierarchy diagnostics at every meaningful step. This
// test's own PASS/FAIL verdict is NOT the load-bearing evidence for this plan -- the extension
// process's own `PVDIAG|method=prepareInterface(for:AS...)` log lines
// (`scripts/ios-autofill-e44.sh probe`'s own log-capture step) are. This test's job is only to
// perform the real, human-shaped interaction that MIGHT cause the system to invoke those
// overrides, and to leave behind visual evidence of whatever the system actually showed.

import Foundation
import XCTest

final class SavePasswordFormHarnessUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private static let harnessBundleId = "cloud.blonie.PasskeyVaultHarness"

    @MainActor
    func testDriveSavePasswordForm() throws {
        let harness = XCUIApplication(bundleIdentifier: Self.harnessBundleId)
        // `.activate()`, never `.launch()` -- matches `NativeAppRegisterUITests.swift`'s own
        // established precedent for this already-running harness process.
        harness.activate()

        let usernameField = harness.textFields["savePasswordForm.username"]
        guard usernameField.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.username never appeared.")
            return
        }
        attachDiagnostics(app: harness, label: "before-type")

        usernameField.tap()
        usernameField.typeText("pv-e44-tracer-user")

        // The password field is a `UIViewRepresentable`-wrapped `UITextField` with
        // `isSecureTextEntry = true` -- XCUITest exposes it as a `secureTextFields` query, not
        // `textFields`.
        let passwordField = harness.secureTextFields["savePasswordForm.password"]
        guard passwordField.waitForExistence(timeout: 5) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.password never appeared.")
            return
        }
        passwordField.tap()
        // Satisfies the harness's own real rules descriptor (minlength 10-20, required
        // lower/upper/digit) -- the SAME DSL shape Plan 44-02's `parse_password_rules` was built
        // against.
        passwordField.typeText("Tracer9Pass")
        attachDiagnostics(app: harness, label: "after-type")

        // Dismiss the keyboard via Return BEFORE looking for the Submit button -- LIVE FINDING
        // this session: with the keyboard up, `savePasswordForm.submit` sits off-screen with no
        // scroll path from a bare (pre-fix) `VStack`, and XCUITest's own tap silently computed an
        // invalid hit point `{-1, -1}` rather than throwing, so the tap never actually landed.
        // `PVAutoFillTextField.Coordinator.textFieldShouldReturn` resigns first responder on
        // Return, collapsing the keyboard for real.
        passwordField.typeText("\n")
        usleep(400_000)
        attachDiagnostics(app: harness, label: "after-keyboard-dismiss")

        let submitButton = harness.buttons["savePasswordForm.submit"]
        guard submitButton.waitForExistence(timeout: 5) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.submit never appeared.")
            return
        }
        submitButton.tap()
        attachDiagnostics(app: harness, label: "after-submit-tap")

        // Best-effort poll: tap through whatever system chrome appears (unknown wording ahead of
        // time -- this is exactly Open Question 1's own uncertainty). Never required for this
        // test's own completion; `scripts/ios-autofill-e44.sh probe`'s own log grep is the real
        // verdict. "Save Password"/"Not Now" are checked BEFORE the bare "Save" substring --
        // LIVE FINDING this session: a bare "Save" substring also matches this harness's OWN
        // instructional StaticText ("New-account form (SAVE-01/02 tracer)..."), which caused the
        // first probe run to spend its whole poll window re-tapping harmless static text instead
        // of ever finding real system chrome. Restricted to buttons only (never `.any`) to close
        // this off structurally, not just by search order.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [harness, springboard]
        let deadline = Date().addingTimeInterval(20)
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            var actedThisPoll = false
            for app in candidateApps {
                if let element = Self.firstHittableButton(in: app, labelContains: "Save Password")
                    ?? Self.firstHittableButton(in: app, labelContains: "Not Now")
                    ?? Self.firstHittableButton(in: app, labelContains: "Continue")
                    ?? Self.firstHittableButton(in: app, labelContains: "Save")
                {
                    attachDiagnostics(app: app, label: "system-chrome-found-poll\(pollCount)")
                    if element.exists {
                        element.tap()
                        actedThisPoll = true
                    }
                    break
                }
            }
            if pollCount <= 5 || actedThisPoll {
                attachDiagnostics(app: harness, label: "poll-\(pollCount)")
            }
            if !actedThisPoll {
                usleep(500_000)
            }
        }

        let statusLabel = harness.staticTexts["savePasswordForm.status"]
        let statusText = statusLabel.exists ? statusLabel.label : "<status label not found>"
        attachDiagnostics(app: harness, label: "final-state-status=\(statusText)")
    }

    // MARK: - Helpers (duplicated from NativeAppRegisterUITests.swift's own precedent -- no
    // shared framework between separate UI test files, this project's established discipline).

    @MainActor
    private static func firstHittableElement(in app: XCUIApplication, labelContains text: String) -> XCUIElement? {
        let predicate = NSPredicate(format: "label CONTAINS[cd] %@", text)
        let query = app.descendants(matching: .any).matching(predicate)
        let count = min(query.count, 5)
        guard count > 0 else { return nil }
        for i in 0..<count {
            let element = query.element(boundBy: i)
            if element.exists && element.isHittable {
                return element
            }
        }
        return nil
    }

    /// Restricted to `.button` (never `.any`) -- closes off, structurally, the false-positive
    /// match this test's own probe run hit live: a bare `.any` query matching "Save" also matches
    /// this harness's own instructional `StaticText` ("...SAVE-01/02 tracer)...").
    @MainActor
    private static func firstHittableButton(in app: XCUIApplication, labelContains text: String) -> XCUIElement? {
        let predicate = NSPredicate(format: "label CONTAINS[cd] %@", text)
        let query = app.descendants(matching: .button).matching(predicate)
        let count = min(query.count, 5)
        guard count > 0 else { return nil }
        for i in 0..<count {
            let element = query.element(boundBy: i)
            if element.exists && element.isHittable {
                return element
            }
        }
        return nil
    }

    @MainActor
    private func attachDiagnostics(app: XCUIApplication, label: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(label)-screenshot"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(label)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    @MainActor
    private func recordFailureWithDiagnostics(app: XCUIApplication, message: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.lifetime = .keepAlways
        add(hierarchy)

        XCTFail(message)
    }
}
