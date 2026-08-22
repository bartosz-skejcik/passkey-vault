// SavePasswordFormHarnessUITests.swift -- Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-03,
// Task 1 (+ Task 1b / checkpoint resolution, run 2). Drives `SavePasswordFormView.swift`'s two
// real `UITextField`s (username / new-password, both `UIViewRepresentable`-wrapped, carrying real
// `.textContentType`/`UITextInputPasswordRules`) and taps "Submit" (which unfocuses both fields)
// -- then polls for whatever system chrome, if any, the OS draws in response, tapping through a
// best-effort "Save Password"/"Continue"/"Not Now" chain when found (`testDriveSavePasswordForm`).
//
// `testDriveGeneratePasswordAffordance` (added for the checkpoint resolution's item D) drives a
// SEPARATE, narrower interaction: tap the new-password field WITHOUT typing, then poll for the
// system's own "Suggest Strong Password" QuickType affordance -- the ONLY path, per the SDK
// header, that can reach the interactive `prepareInterface(for: ASGeneratePasswordsRequest)`
// override (the silent `performWithoutUserInteraction(generatePasswordsRequest:)` override cannot
// trigger it).
//
// Structure duplicated from `NativeAppRegisterUITests.swift`'s own established shape (this
// project's own discipline: no shared framework between separate UI test files) --
// `.activate()` never `.launch()`, screenshot+hierarchy diagnostics at every meaningful step. This
// test's own PASS/FAIL verdict is NOT the load-bearing evidence for this plan -- the extension
// process's own `PVDIAG|method=prepareInterface(for:AS...)` /
// `PVDIAG|method=performWithoutUserInteraction...` log lines (`scripts/ios-autofill-e44.sh
// probe`'s own log-capture step) are. This test's job is only to perform the real, human-shaped
// interaction that MIGHT cause the system to invoke those overrides, and to leave behind visual
// evidence of whatever the system actually showed.

import Foundation
import XCTest
import os

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

    /// Identifier-exact overload (`NativeAppRegisterUITests.swift`'s own established precedent) --
    /// this plan's own `generatePassword.use`/`generatePassword.candidate` accessibility
    /// identifiers are exact strings, never a substring search.
    @MainActor
    private static func firstHittableElement(in app: XCUIApplication, identifier: String) -> XCUIElement? {
        let predicate = NSPredicate(format: "identifier == %@", identifier)
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

    /// Plan 44-03 Task 1b / checkpoint resolution item D: the interactive
    /// `prepareInterface(for: ASGeneratePasswordsRequest)` path is, per the SDK header, reachable
    /// ONLY via the system's own user-initiated "Suggest Strong Password" affordance -- never
    /// manufacturable by typing (`performWithoutUserInteraction(generatePasswordsRequest:)` above
    /// cannot trigger it; the header states this explicitly). This test's own job, mirroring
    /// `AutoFillFillUITests.swift`'s established "Passwords" keyboard-accessory-driving precedent
    /// (phases 41/43): tap into the new-password field WITHOUT typing anything first (typing
    /// replaces the QuickType strong-password suggestion with the user's own draft), then poll for
    /// whatever system chrome offers a strong-password suggestion, across the harness's own window
    /// AND the springboard/keyboard-owning process, and tap it if found. A negative result here is
    /// recorded plainly as NOT YET PROVEN in this run -- never silently treated as equivalent proof
    /// to a fired `PVDIAG|` line (this test's own PASS/FAIL is not the load-bearing evidence;
    /// `scripts/ios-autofill-e44.sh probe`'s own log grep is, exactly as the header comment above
    /// states for the save/generate-silent paths).
    @MainActor
    func testDriveGeneratePasswordAffordance() throws {
        let harness = XCUIApplication(bundleIdentifier: Self.harnessBundleId)
        harness.terminate()
        harness.activate()

        let passwordField = harness.secureTextFields["savePasswordForm.password"]
        guard passwordField.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.password never appeared (generate-affordance run).")
            return
        }
        attachDiagnostics(app: harness, label: "generate-before-tap")

        passwordField.tap()
        attachDiagnostics(app: harness, label: "generate-after-tap-no-typing")

        // Best-effort poll across the harness's own window AND springboard (the keyboard/QuickType
        // bar's owning process for system suggestions) -- unknown wording ahead of time, exactly
        // Open Question 1/2's own uncertainty for this specific path. Restricted to `.button`
        // (never `.any`), same false-positive discipline `firstHittableButton` above already
        // established against this harness's own instructional StaticText.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [harness, springboard]
        let candidateLabels = ["Strong Password", "Suggest Strong Password", "Automatic Strong Password", "Passwords"]
        let deadline = Date().addingTimeInterval(10)
        var foundLabel: String?
        var foundElement: XCUIElement?
        while Date() < deadline && foundElement == nil {
            for app in candidateApps {
                for label in candidateLabels {
                    if let element = Self.firstHittableButton(in: app, labelContains: label) {
                        foundElement = element
                        foundLabel = label
                        break
                    }
                }
                if foundElement != nil { break }
            }
            if foundElement == nil {
                usleep(500_000)
            }
        }

        if let element = foundElement, let label = foundLabel {
            attachDiagnostics(app: harness, label: "generate-affordance-found-\(label.replacingOccurrences(of: " ", with: "-"))")
            element.tap()
            attachDiagnostics(app: harness, label: "generate-affordance-after-tap")
            // Give the system time to route (or not) into the extension before this test tears
            // down -- `scripts/ios-autofill-e44.sh probe`'s own log grep, not this assertion, is
            // the real verdict.
            usleep(1_500_000)
        } else {
            // Honest negative: no strong-password affordance was found and driveable from this
            // harness in this run. Recorded plainly, never treated as a substitute proof.
            attachDiagnostics(app: harness, label: "generate-affordance-NOT-FOUND")
        }
    }

    /// Plan 44-05, Task 2 (`sc-generate`). Extends `testDriveGeneratePasswordAffordance`'s own
    /// driving mechanism (configuration X, 44-03-SUMMARY.md) one step further: after tapping the
    /// system's own "Strong Password" QuickType affordance -- which reliably invokes the SILENT
    /// entry point (`performWithoutUserInteraction(generatePasswordsRequest:)`, live evidence) --
    /// this method ALSO polls for the INTERACTIVE offer screen
    /// (`GeneratePasswordOfferView`'s own `generatePassword.use`/`generatePassword.candidate`
    /// accessibility identifiers), across the SAME `[harness, springboard]` candidate-app set
    /// `PasskeyRegistrationConfirmView`'s own live proof already established as the right place to
    /// look for this extension's OWN presented UI. This is the live experiment that settles
    /// 44-03-SUMMARY.md's own open question (whether returning a real candidate from the silent
    /// handler causes the system to ALSO invoke the interactive variant) -- reported honestly
    /// either way via a named, distinctly-attached screenshot (`generate-offer-found-*` if the
    /// screen appeared, `generate-offer-NOT-FOUND-*` if it did not), never silently treated as
    /// equivalent to the other outcome.
    @MainActor
    func testDriveGeneratePasswordOffer() throws {
        let harness = XCUIApplication(bundleIdentifier: Self.harnessBundleId)
        harness.terminate()
        harness.activate()

        let passwordField = harness.secureTextFields["savePasswordForm.password"]
        guard passwordField.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.password never appeared (sc-generate run).")
            return
        }
        passwordField.tap()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [harness, springboard]
        // "Passwords" LAST, deliberately -- the QuickType "Strong Password" chip (proven live,
        // 44-03-SUMMARY.md configuration X) is the PRIMARY driving mechanism; "Passwords" (the
        // keyboard accessory bar button, `AutoFillFillUITests.swift`'s own established precedent
        // for the FILL side) is a SECOND, independent trigger this test also explores for the
        // GENERATE side, since it opens an action sheet offering "PasskeyVault" as an explicit
        // provider choice -- a plausible route to the INTERACTIVE variant this plan's own open
        // question needs settled.
        let affordanceLabels = ["Strong Password", "Suggest Strong Password", "Automatic Strong Password", "Passwords"]
        let affordanceDeadline = Date().addingTimeInterval(10)
        var affordanceElement: XCUIElement?
        var affordanceLabelMatched: String?
        while Date() < affordanceDeadline && affordanceElement == nil {
            for app in candidateApps {
                for label in affordanceLabels {
                    if let element = Self.firstHittableButton(in: app, labelContains: label) {
                        affordanceElement = element
                        affordanceLabelMatched = label
                        break
                    }
                }
                if affordanceElement != nil { break }
            }
            if affordanceElement == nil {
                usleep(500_000)
            }
        }
        guard let affordanceElement else {
            attachDiagnostics(app: harness, label: "sc-generate-affordance-NOT-FOUND")
            return
        }
        affordanceElement.tap()
        attachDiagnostics(app: harness, label: "sc-generate-affordance-tapped-\(affordanceLabelMatched ?? "?")")

        // If the "Passwords" accessory (never the direct "Strong Password" chip) was what fired,
        // it opens an action sheet -- follow it to a "PasskeyVault" provider row if one appears,
        // mirroring `AutoFillFillUITests.swift`'s own established follow-up chain for the FILL
        // side, applied here to see whether the SAME chain leads anywhere different for GENERATE.
        if affordanceLabelMatched == "Passwords" {
            let providerRowDeadline = Date().addingTimeInterval(5)
            var providerRow: XCUIElement?
            while Date() < providerRowDeadline && providerRow == nil {
                for app in candidateApps {
                    if let element = Self.firstHittableButton(in: app, labelContains: "PasskeyVault") {
                        providerRow = element
                        break
                    }
                }
                if providerRow == nil { usleep(300_000) }
            }
            if let providerRow {
                attachDiagnostics(app: harness, label: "sc-generate-provider-row-found")
                providerRow.tap()
                attachDiagnostics(app: harness, label: "sc-generate-provider-row-tapped")
            } else {
                attachDiagnostics(app: harness, label: "sc-generate-provider-row-NOT-FOUND")
            }
        }

        // Poll for the interactive offer screen's own accessibility identifiers -- 15s, generous
        // relative to the affordance poll above, since this is exactly the routing question this
        // test exists to settle live, not to assume.
        let offerDeadline = Date().addingTimeInterval(15)
        var offerUseButton: XCUIElement?
        while Date() < offerDeadline && offerUseButton == nil {
            for app in candidateApps {
                let candidate = Self.firstHittableElement(in: app, identifier: "generatePassword.use")
                if let candidate, candidate.exists {
                    offerUseButton = candidate
                    break
                }
            }
            if offerUseButton == nil {
                usleep(500_000)
            }
        }

        guard let offerUseButton else {
            // Honest negative: the interactive offer screen did not appear in this run. This is a
            // valid, informative result (44-03-SUMMARY.md's own "still does not fire" outcome) --
            // never treated as a substitute for a positive finding.
            attachDiagnostics(app: harness, label: "generate-offer-NOT-FOUND")
            return
        }

        // Found -- capture the candidate BEFORE tapping Use (SAVE-04's own pixel evidence). The
        // candidate's own plaintext IS readable via its accessibility label
        // (`generatePassword.candidate` is a plain, non-secure Text view, and this same text is
        // already visibly rendered on screen for the user) -- but this test never writes the raw
        // value to `os_log` (T-44-06's inherited discipline, applied even to a value the screen
        // itself already displays): only the closed-vocabulary rule-compliance BOOLEANS the
        // harness's own descriptor (`minlength: 10; maxlength: 20; required: lower; required:
        // upper; required: digit;`) demands are logged, so `scripts/ios-autofill-e44.sh
        // sc-generate` can grep a pass/fail verdict without the candidate ever leaving this
        // process in plaintext.
        for app in candidateApps {
            let candidateLabel = Self.firstHittableElement(in: app, identifier: "generatePassword.candidate")
            if let candidateLabel, candidateLabel.exists {
                let value = candidateLabel.label
                let lengthOk = value.count >= 10 && value.count <= 20
                let hasLower = value.contains { $0.isLowercase }
                let hasUpper = value.contains { $0.isUppercase }
                let hasDigit = value.contains { $0.isNumber }
                Self.harnessLogger.log(
                    "PVHARNESS|stage=candidate-observed lengthOk=\(lengthOk, privacy: .public) hasLower=\(hasLower, privacy: .public) hasUpper=\(hasUpper, privacy: .public) hasDigit=\(hasDigit, privacy: .public)"
                )
                break
            }
        }
        attachDiagnostics(app: harness, label: "generate-offer-found")
        offerUseButton.tap()
        attachDiagnostics(app: harness, label: "generate-offer-after-use-tap")
    }

    /// Plan 44-04, Task 3 (`sc-save`'s own live drive). The <live_findings> configuration X:
    /// "tap the new-password field with NO typing -> tap the system's own `GenerateStrongPasswordButton`
    /// (label 'Strong Password') -> let the generated password be filled -> THEN submit / remove
    /// the form, and watch for all three event kinds" -- the save chain is normally SEEDED by a
    /// completed generate (`ASSavePasswordRequestEventGeneratedPasswordFilled`'s own header doc),
    /// so this is the driving mechanism this task's own `sc-save` subcommand needs, extending
    /// `testDriveGeneratePasswordOffer`'s own proven affordance-tapping mechanism one step further
    /// into an actual form submission.
    ///
    /// Unlike `testDriveGeneratePasswordOffer`, this method types a REAL username FIRST (the
    /// receiver-side proof needs a real, non-empty username to look the saved item up by) --
    /// `savePasswordForm.username` accepts free text same as `testDriveSavePasswordForm`.
    @MainActor
    func testDriveSaveViaGeneratedPassword() throws {
        let harness = XCUIApplication(bundleIdentifier: Self.harnessBundleId)
        harness.terminate()
        harness.activate()

        let usernameField = harness.textFields["savePasswordForm.username"]
        guard usernameField.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.username never appeared (sc-save run).")
            return
        }
        let username = ProcessInfo.processInfo.environment["PV_E44_04_SC_SAVE_USERNAME"] ?? "pv-e44-04-sc-save-user"
        usernameField.tap()
        usernameField.typeText(username)
        attachDiagnostics(app: harness, label: "sc-save-after-username-type")

        let passwordField = harness.secureTextFields["savePasswordForm.password"]
        guard passwordField.waitForExistence(timeout: 5) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.password never appeared (sc-save run).")
            return
        }
        // NO typing -- configuration X's own precondition (typing replaces the QuickType
        // strong-password suggestion with the user's own draft).
        passwordField.tap()
        attachDiagnostics(app: harness, label: "sc-save-after-password-tap-no-typing")

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [harness, springboard]
        let affordanceLabels = ["Strong Password", "Suggest Strong Password", "Automatic Strong Password"]
        let affordanceDeadline = Date().addingTimeInterval(10)
        var affordanceElement: XCUIElement?
        while Date() < affordanceDeadline && affordanceElement == nil {
            for app in candidateApps {
                for label in affordanceLabels {
                    if let element = Self.firstHittableButton(in: app, labelContains: label) {
                        affordanceElement = element
                        break
                    }
                }
                if affordanceElement != nil { break }
            }
            if affordanceElement == nil {
                usleep(500_000)
            }
        }
        guard let affordanceElement else {
            attachDiagnostics(app: harness, label: "sc-save-affordance-NOT-FOUND")
            return
        }
        affordanceElement.tap()
        attachDiagnostics(app: harness, label: "sc-save-affordance-tapped")

        // Give the silent generate handler time to answer and the system time to fill the field
        // (this is the SAME entry point 44-05's own `sc-generate` already proved fires and fills
        // reliably under this exact configuration) -- generous settle margin before the next step,
        // since `ASSavePasswordRequestEventGeneratedPasswordFilled` (if it fires at all) is a
        // SEPARATE, asynchronous save-request delivery, not a synchronous side effect of this tap.
        usleep(2_000_000)
        attachDiagnostics(app: harness, label: "sc-save-after-fill-settle")

        // LIVE FINDING, this session (unlike `testDriveSavePasswordForm`'s own typed-Submit path):
        // once the system's own "Strong Password" QuickType affordance fills the field, the
        // keyboard/QuickType bar is ALREADY dismissed and the field no longer holds first
        // responder -- `passwordField.typeText("\n")` here fails outright ("Neither element nor
        // any descendant has keyboard focus"), unlike the typed-password path where Return is the
        // only available dismiss action. No keyboard-dismiss step is needed; `savePasswordForm
        // .submit` is already reachable.
        attachDiagnostics(app: harness, label: "sc-save-after-keyboard-dismiss")

        let submitButton = harness.buttons["savePasswordForm.submit"]
        guard submitButton.waitForExistence(timeout: 5) else {
            recordFailureWithDiagnostics(app: harness, message: "savePasswordForm.submit never appeared (sc-save run).")
            return
        }
        submitButton.tap()
        attachDiagnostics(app: harness, label: "sc-save-after-submit-tap")

        // Poll for OUR OWN confirmation screen (`SavePasswordConfirmView`, `savePassword.confirm`)
        // across [harness, springboard] -- the SAME route `AutoFillPasskeyRegistrationUITests
        // .swift`'s own live-proven pattern already established for a system-presented sheet
        // hosting this extension's own view controller (a `.userInitiated`/`.formDidDisappear`
        // event, per `<behavior>`, presents this screen; `.generatedPasswordFilled` alone would
        // not -- Submit's own resign+removal above is what supplies the
        // `.userInitiated`/`.formDidDisappear` half of the pair, per the header's own documented
        // "will generally be followed by" relationship).
        let deadline = Date().addingTimeInterval(20)
        var confirmTapped = false
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            var actedThisPoll = false
            for app in candidateApps {
                let confirmButton = app.buttons["savePassword.confirm"]
                if confirmButton.exists, confirmButton.isHittable {
                    // LIVE FINDING, this session: `attachDiagnostics(label:)` ALWAYS appends its
                    // own `-screenshot`/`-hierarchy` suffix (see that helper's own body below) --
                    // passing "save-confirm-found-screenshot" here produced the DOUBLED attachment
                    // name "save-confirm-found-screenshot-screenshot", which `sc-save`'s own
                    // `xcresulttool export attachments` lookup (searching for the un-doubled name)
                    // could not find. Mirrors `testDriveGeneratePasswordOffer`'s own correct
                    // precedent (`attachDiagnostics(app: harness, label: "generate-offer-found")`)
                    // -- the label passed here must NOT itself already end in `-screenshot`.
                    attachDiagnostics(app: app, label: "save-confirm-found")
                    confirmButton.tap()
                    confirmTapped = true
                    actedThisPoll = true
                    break
                }
            }
            if pollCount <= 5 || actedThisPoll {
                attachDiagnostics(app: harness, label: "sc-save-poll-\(pollCount)")
            }
            if confirmTapped {
                break
            }
            if !actedThisPoll {
                usleep(500_000)
            }
        }

        if !confirmTapped {
            // Honest negative -- recorded plainly, never treated as a substitute for a positive
            // finding. `scripts/ios-autofill-e44.sh sc-save`'s own receiver-side check (not this
            // test's PASS/FAIL) is the load-bearing evidence either way.
            attachDiagnostics(app: harness, label: "sc-save-confirm-NOT-FOUND")
        }

        // Settle margin: the extension's own encrypt/network/identity-store pipeline all need a
        // moment after the last tap, mirroring `AutoFillPasskeyRegistrationUITests`'s own
        // established pattern.
        sleep(3)
        attachDiagnostics(app: harness, label: "sc-save-final-state-confirmTapped=\(confirmTapped)")
    }

    private static let harnessLogger = Logger(subsystem: "cloud.blonie.PasskeyVaultHarness", category: "sc-generate")

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
