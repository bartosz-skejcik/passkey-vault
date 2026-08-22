// NativeAppSignInUITests.swift -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan 43-08,
// Task 3 (ROADMAP SC2). Drives the ALREADY-RUNNING `PasskeyVaultHarness` process --
// `scripts/ios-autofill-e43.sh native-app` launches it externally via `xcrun simctl launch
// --stdout=<path> --stderr=<path> [-PVCorruptSignature] <udid> cloud.blonie.PasskeyVaultHarness`,
// NEVER this test's own `.launch()`. XCUITest's `.launch()` starts a FRESH process with its own
// (empty) launch arguments, which would silently drop the `-PVCorruptSignature` trailing argv the
// falsification leg depends on (`NativeSignInView.swift`'s own `CommandLine.arguments` read, at
// process start) -- `.activate()` instead attaches to the already-foregrounded process `simctl
// launch` started, the SAME "NOT a fresh launch()" discipline `OnboardingAutoFillStepUITests.swift`
// already established for a different cross-app case in this codebase.
//
// Taps the harness app's own "Sign In" button (`nativeSignIn.button`), then taps through whatever
// system credential-picker surface the OS shows for a REQUESTING-side `ASAuthorizationController`
// ceremony -- the SAME "Other accounts" / "More from PasskeyVault..." row + "Continue"
// (`ASAuthorizationControllerContinueButton`) pattern `AutoFillPasskeyTracerUITests.swift`'s own
// live finding already established for Safari's assertion flow. 43-RESEARCH.md's own investigation
// (this plan's own `<read_first>` note, §11): Safari/system passkey routing does NOT use
// `provideCredentialWithoutUserInteraction`/`prepareInterfaceToProvideCredential` directly -- the
// system shows its own sheet first, then calls `prepareCredentialList(for:requestParameters:)`;
// `performPasskeyAssertion` (`CredentialProviderViewController.swift`) is the SAME shared,
// corrected code path regardless of which app is the REQUESTING side (Safari or a native app like
// this harness) -- so this test expects the identical system-sheet shape.
//
// PASS/FAIL verdict is NOT this test's own exit status (L-30's own caution: a test that always
// reports pass regardless of what happened is a vacuous gate) -- it is BOTH `crates/rp-fixture`'s
// own `/assert/finish` log line AND `PasskeyVaultHarness`'s own `PVHARNESS|stage=complete` stdout
// marker, grepped by `scripts/ios-autofill-e43.sh native-app`'s own `assert_native_app` AFTER this
// test completes (RECEIVER-SIDE + the app's own UI state, per 43-08-PLAN.md's own
// `must_haves.prohibitions` -- BOTH acceptable proof forms required to agree, never either alone).
//
// DEVIATION (Rule 2, GSD executor rules): 43-08-PLAN.md's own `files_modified` list (scoped to
// `scripts/ios-autofill-e43.sh` only) does not name this file -- the SAME class of gap
// `AutoFillPasskeyTracerUITests.swift`/`AutoFillPasskeyRegistrationUITests.swift` (43-03/43-07)
// already document: driving a real system credential-picker surface requires XCUITest, no
// `simctl` subcommand can synthesize a tap.

import Foundation
import XCTest

final class NativeAppSignInUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private static let harnessBundleId = "cloud.blonie.PasskeyVaultHarness"

    @MainActor
    func testNativeSignIn() throws {
        let harness = XCUIApplication(bundleIdentifier: Self.harnessBundleId)
        // `.activate()`, never `.launch()` -- see this file's own header. The process is already
        // running (and foreground) courtesy of `scripts/ios-autofill-e43.sh native-app`'s own
        // `xcrun simctl launch` call, which is what carries `-PVCorruptSignature` when armed.
        harness.activate()

        let signInButton = harness.buttons["nativeSignIn.button"]
        guard signInButton.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: harness, message: "PasskeyVaultHarness's own 'Sign In' button never appeared.")
            return
        }
        attachDiagnostics(app: harness, label: "before-signin-tap")
        signInButton.tap()
        attachDiagnostics(app: harness, label: "after-signin-tap")

        // The system's OWN credential-picker surface -- not part of the requesting app's own
        // accessibility tree (confirmed live for the Safari-driven sibling flow,
        // `AutoFillPasskeyTracerUITests.swift`'s own finding) -- queryable via SpringBoard's own
        // `XCUIApplication`, the standard XCUITest route to system-presented sheets/alerts
        // overlaid on the foreground app.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [harness, springboard]

        var selectedProvider = false
        var tappedContinue = false
        // 45s, not 25s -- LIVE FINDING this session: a first run that broke the poll loop
        // immediately on `tappedContinue` (mirroring `AutoFillPasskeyTracerUITests.swift`'s own
        // `break` there verbatim) then only `sleep(3)`'d before reading the status label caught
        // the harness app's own status FROZEN at "Requesting passkey..." -- the system's
        // biometric-confirmation sheet had not yet resolved in that ~3.8s window (tap-to-final-
        // check), even with the calling script's own parallel `notifyutil` pearl-match loop
        // running throughout. This loop now keeps polling BOTH the harness's own status label
        // (for a terminal "Signed in"/"Failed" state) AND the system surface (in case a SECOND
        // confirmation element appears) all the way to the deadline, rather than a short fixed
        // sleep after the first tap -- gives the biometric loop genuinely enough time to land.
        let deadline = Date().addingTimeInterval(45)
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            var actedThisPoll = false

            // "More from" -- NOT the bare substring "PasskeyVault" (LIVE FINDING this session,
            // root cause of an earlier hung run): the harness app's OWN home screen carries the
            // static title text "PasskeyVaultHarness", visible from the moment the app launches,
            // well before the system's "Sign In" sheet ever appears. A bare "PasskeyVault"
            // substring search matched THAT title text first (a harmless-looking no-op tap on
            // plain text), which prematurely set `selectedProvider = true` before the REAL system
            // sheet's row had even appeared -- the poll loop then went straight to hunting for
            // "Continue" and tapped it while the sheet's OWN default selection ("Scan QR Code")
            // was still active, routing into a QR-code cross-device flow that can never complete
            // on a simulator and hangs forever. The system sheet's own row text is observed live
            // as "More from PasskeyVault..." (truncated) -- "More from" is unique to that row.
            if !selectedProvider {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, labelContains: "More from") {
                        attachDiagnostics(app: app, label: "provider-row-found-poll\(pollCount)")
                        element.tap()
                        // Explicit settle margin -- belt-and-braces alongside the `!actedThisPoll`
                        // gate below: gives the row-selection checkmark state a real, unconditional
                        // moment to update before this SAME poll iteration's own diagnostic calls
                        // (which take some real time regardless) could otherwise mask a genuinely
                        // too-fast follow-up.
                        usleep(750_000)
                        selectedProvider = true
                        actedThisPoll = true
                        break
                    }
                }
            }
            // Checked by IDENTIFIER first (stable, not localization-dependent -- the SAME live
            // finding `AutoFillPasskeyRegistrationUITests.swift` already established: this
            // control's real label is "Add Passkey" for a REGISTRATION confirm, but for an
            // ASSERTION confirm this project's own sibling test
            // (`AutoFillPasskeyTracerUITests.swift`) found "Continue" -- both checked here, since
            // this is the FIRST run of this exact flow from a REQUESTING native app rather than
            // Safari and the exact wording is not known in advance for this specific surface).
            // Kept active for the WHOLE loop (never gated on `!tappedContinue`) -- a second,
            // distinct confirmation control (e.g. a biometric-fallback "Continue") could appear
            // after the first tap; tapping an already-dismissed element is a harmless no-op since
            // `firstHittableElement` only matches elements that currently exist and are hittable.
            //
            // `!actedThisPoll` -- LIVE FINDING this session (root cause of a run that hung forever
            // at "Requesting passkey..."): the system's own "Sign In" sheet defaults to "Scan QR
            // Code" CHECKED. Tapping the "More from PasskeyVault..." row selects it, but a
            // screenshot taken in the SAME poll iteration (immediately after that tap, before this
            // gate existed) still showed the checkmark on "Scan QR Code" -- the row-selection had
            // not visibly settled yet. Tapping "Continue" in that SAME iteration proceeded with the
            // WRONG option still selected, routing into a QR-code cross-device flow that can never
            // complete on a simulator with no second device -- the ceremony then hangs forever,
            // never reaching `ASAuthorizationController`'s own delegate callback (confirmed: no
            // `PVHARNESS|stage=ceremony` line ever appears). Requiring a poll with NO action taken
            // (i.e. the NEXT ~0.5s tick) before checking for Continue gives the row-selection state
            // a real chance to settle before advancing.
            if selectedProvider, !actedThisPoll {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, identifier: "ASAuthorizationControllerContinueButton")
                        ?? Self.firstHittableElement(in: app, labelContains: "Continue")
                        ?? Self.firstHittableElement(in: app, labelContains: "Add Passkey")
                    {
                        attachDiagnostics(app: app, label: "continue-found-poll\(pollCount)")
                        element.tap()
                        tappedContinue = true
                        actedThisPoll = true
                        break
                    }
                }
            }

            if pollCount <= 5 || actedThisPoll {
                attachDiagnostics(app: harness, label: "poll-\(pollCount)")
            }

            // Terminal-state check: the harness's own status label, per this file's own PASS/FAIL
            // contract (BOTH the fixture's independent verify AND the app's own UI state must
            // agree -- checking here lets this loop exit EARLY once the app itself has reached a
            // terminal state, rather than always spinning to the full deadline).
            let statusLabel = harness.staticTexts["nativeSignIn.status"]
            if statusLabel.exists {
                let currentStatus = statusLabel.label
                if currentStatus == "Signed in" || currentStatus.hasPrefix("Failed") {
                    attachDiagnostics(app: harness, label: "terminal-status-poll\(pollCount)-status=\(currentStatus)")
                    break
                }
            }
            if !actedThisPoll {
                usleep(500_000)
            }
        }

        // Settle margin: the harness app's own URLSession POST to the fixture's `/assert/finish`
        // needs a moment after the system ceremony completes, even once the status label reads a
        // terminal value (mirrors every sibling tracer's own precedent).
        sleep(3)
        let statusLabel = harness.staticTexts["nativeSignIn.status"]
        let statusText = statusLabel.exists ? statusLabel.label : "<status label not found>"
        attachDiagnostics(
            app: harness,
            label: "final-state-selectedProvider=\(selectedProvider)-tappedContinue=\(tappedContinue)-status=\(statusText)"
        )
    }

    /// Identifier-exact counterpart to `firstHittableElement(in:labelContains:)` below -- for
    /// system-owned surfaces whose confirm control carries a stable ObjC identifier but no
    /// reliable, localization-independent `label`. Duplicated (not shared) from
    /// `AutoFillPasskeyRegistrationUITests.swift`'s own identical helper -- this project's
    /// established discipline: no shared framework between separate UI test files.
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

    /// Best-effort element lookup across every element TYPE (`.any`), not just `.buttons` --
    /// duplicated from `AutoFillPasskeyTracerUITests.swift`'s own helper verbatim (separate UI
    /// test files, no shared framework between them, this project's established discipline).
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

    // MARK: - Helpers (duplicated from AutoFillPasskeyTracerUITests.swift's own precedent -- no
    // shared framework between separate UI test files, matching this project's established
    // discipline for this exact class of helper).

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
