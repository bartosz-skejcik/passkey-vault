// AutoFillFillUITests.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-03, Task 1 (the tracer).
//
// Drives Safari on the simulator to a real login form, invokes AutoFill, selects OUR provider's
// QuickType suggestion, and asserts on the VALUE the password field actually holds --
// byte-for-byte against the literal plaintext `TracerFillSeeder` (host app target) encrypted into
// the Phase-39 cache. The assertion is on the field's value, never on "no error was thrown" and
// never on a screenshot alone (QA-03).
//
// The password field's filled value is read through a JS-mirrored readback element
// (`<div id=rp>`, updated by the form's own `oninput`/`onchange` handlers) rather than through the
// `<input type=password>` element's own accessibility value directly -- WebKit's accessibility
// bridge's masking behaviour for `type=password` fields under XCUITest is not something this
// project has previously measured, and the mirror sidesteps that ambiguity: whatever value lands
// in the DOM field, cause it to render as PLAIN, readable static text elsewhere on the page.
//
// `TracerFillSeeder.tracerPassword`/`tracerUsername` (host app target,
// `ios/PasskeyVault/PasskeyVault/TracerFillSeeder.swift`) are DUPLICATED here as literals, not
// imported -- UI test targets drive the app out-of-process via the Accessibility API and do not
// compile against the app module (unlike `PasskeyVaultTests`' `import PasskeyVault`, a UNIT test
// target hosted IN-process). A change to either literal in ONE file without the other is exactly
// what this task's own first falsification (mutate the expected constant, observe the test fail)
// is built to catch.

import Foundation
import XCTest

final class AutoFillFillUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// DUPLICATED from `TracerFillSeeder.swift` (host app target) -- see this file's header for
    /// why a shared import is not available here. Mutating this ONE literal by a single character
    /// and re-running is this task's own first recorded falsification.
    private static let expectedUsername = "tracer41-03@pv.test"
    private static let expectedPassword = "Tr4c3r-Fill-41-03!"

    /// MUST match `TracerFillSeeder.tracerServiceIdentifier` (host app target) and
    /// `scripts/ios-autofill-e41.sh`'s own local server port for the `tracer` subcommand.
    private static let loginFormHost = "127.0.0.1"
    private static let loginFormPort = 8765

    @MainActor
    func testAutoFillFillsRealPasswordIntoSafariFormField() throws {
        // Host app FIRST, unconditionally -- PV_PROBE_FILLTRACER's seed sequence
        // (TracerFillSeeder.seed()) must land before the extension is ever invoked, same ordered
        // sequence every other Phase 36/41 probe in this project already establishes
        // (AutoFillInvocationUITests.swift's own header). The acceptance-criteria falsification
        // leg for the cache decoder's AAD binding (revision altered by one) is introduced AT SEED
        // TIME, by `TracerFillSeeder` itself checking for a marker FILE in the App Group
        // container (`scripts/ios-autofill-e41.sh tracer --assert-revision-mutation` writes it
        // directly from the host Mac before this run, since the container is a real directory on
        // disk this driving script already has access to) -- an environment variable set via
        // xcodebuild's `TEST_RUNNER_`/`launchEnvironment` mechanisms was observed live NOT to
        // reach this process at all (`ProcessInfo.processInfo.environment` came back empty for
        // the forwarded key), so a file-based signal is the reliable channel here.
        let host = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
        host.launch()
        // The seed sequence is local-only (Keychain + UserDefaults + one file write, no network)
        // -- a generous fixed margin rather than polling a sandboxed container this test-runner
        // process cannot read directly (AutoFillInvocationUITests.swift's own precedent for this
        // exact class of wait).
        sleep(3)

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(
                app: safari,
                message: "Safari address bar never appeared."
            )
            return
        }
        addressBar.tap()

        // A REAL host, not a `data:` URL: `ASCredentialServiceIdentifier(type: .domain)` matching
        // is host-based (F3, `41-RESEARCH.md`) -- a `data:` URL page carries no host at all, so a
        // `.domain`-typed identity can never be offered for it (discovered empirically running
        // this exact test live, first attempt). `scripts/ios-autofill-e41.sh tracer` starts a
        // local static-file server on `127.0.0.1:8765` serving this exact login form BEFORE
        // driving this test -- `TracerFillSeeder.tracerServiceIdentifier` ("127.0.0.1") is the
        // SAME host, registered `.domain`-typed, so the port is irrelevant to the match (F3's own
        // finding: "`.domain` identity ... offered on ... example.com:8443" -- port-independent).
        let loginFormURL = "http://\(Self.loginFormHost):\(Self.loginFormPort)/"
        addressBar.typeText(loginFormURL)
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(
                app: safari,
                message: "Login form's username field never appeared in Safari's WebView."
            )
            return
        }
        usernameField.tap()
        attachDiagnostics(app: safari, label: "username-field-tapped")

        // Discovered empirically running this exact test live, across repeated runs: on this
        // iOS/Safari version, which of TWO system surfaces appears after tapping the username
        // field is NOT deterministic run-to-run (same build, same identity, same host) --
        //   (a) the system's own `SFAutoFillInputView` sheet directly, worded "Sign in to
        //       \"<host>\" with your password for \"<user>\" saved in \"PasskeyVault\"?" with a
        //       `FillPasswordButton` ("Fill Password"); or
        //   (b) the plain software keyboard with a "Passwords" accessory bar button, which opens
        //       an action sheet ("PasskeyVault" / "Passwords" / "Cancel") -- tapping "PasskeyVault"
        //       then surfaces the SAME `FillPasswordButton` sheet as (a).
        // Both paths converge on `FillPasswordButton`; tapping it is what actually invokes our
        // provider's `provideCredentialWithoutUserInteraction`/`prepareInterfaceToProvideCredential`.
        // The sheet's own wording is ITSELF a receiver-side confirmation that the system resolved
        // our identity correctly (host, user, AND provider name all attributable to us -- Pitfall 6).
        var fillPasswordButton = safari.buttons["FillPasswordButton"]
        if !fillPasswordButton.waitForExistence(timeout: 5) {
            attachDiagnostics(app: safari, label: "no-direct-sheet-trying-passwords-accessory")
            let passwordsAccessory = safari.buttons["Passwords"]
            guard passwordsAccessory.waitForExistence(timeout: 5) else {
                recordFailureWithDiagnostics(
                    app: safari,
                    message: "Neither the direct \"Fill Password\" sheet nor a \"Passwords\" " +
                        "keyboard accessory button appeared after tapping the username field -- " +
                        "our identity was not offered for this page."
                )
                return
            }
            // The "Passwords" accessory button was observed live, more than once, to accept a
            // `.tap()` without opening its action sheet (no hit-testing error, no exception --
            // just no effect) -- retried up to 3 times, re-checking for either the action sheet's
            // "PasskeyVault" row OR (some runs skip the picker and go straight there) the
            // `FillPasswordButton` sheet itself, before giving up.
            var providerRow = safari.buttons["PasskeyVault"]
            var attempt = 0
            while attempt < 3 && !providerRow.exists && !safari.buttons["FillPasswordButton"].exists {
                Self.forceTap(passwordsAccessory)
                attachDiagnostics(app: safari, label: "after-passwords-accessory-tap-attempt\(attempt + 1)")
                _ = providerRow.waitForExistence(timeout: 3)
                providerRow = safari.buttons["PasskeyVault"]
                attempt += 1
            }

            if safari.buttons["FillPasswordButton"].exists {
                fillPasswordButton = safari.buttons["FillPasswordButton"]
            } else {
                guard providerRow.exists else {
                    recordFailureWithDiagnostics(
                        app: safari,
                        message: "\"Passwords\" accessory opened but no \"PasskeyVault\" provider " +
                            "row was found in the resulting action sheet after \(attempt) attempt(s)."
                    )
                    return
                }
                Self.forceTap(providerRow)
                attachDiagnostics(app: safari, label: "after-provider-row-tap")

                fillPasswordButton = safari.buttons["FillPasswordButton"]
                guard fillPasswordButton.waitForExistence(timeout: 5) else {
                    recordFailureWithDiagnostics(
                        app: safari,
                        message: "Selected \"PasskeyVault\" from the action sheet, but the " +
                            "\"Fill Password\" sheet never appeared afterward."
                    )
                    return
                }
            }
        }
        attachDiagnostics(app: safari, label: "before-fill-password-tap")
        Self.forceTap(fillPasswordButton)
        attachDiagnostics(app: safari, label: "after-suggestion-tap")

        // Discovered empirically running this exact test live: tapping "Fill Password" triggers a
        // SEPARATE, SYSTEM-LEVEL LocalAuthentication evaluation (Face ID or device passcode)
        // BEFORE Safari will actually write the credential into the DOM -- this is Safari's OWN
        // confirmation gate for injecting a password into a web page, orthogonal to and
        // independent of our own provider's `provideCredentialWithoutUserInteraction` (which the
        // system already invoked silently in the background the moment the field gained focus --
        // `os_log`'s own `PVFILL|entry=silent stage=fill status=ok` line proves this, receiver-side,
        // regardless of whether this system gate ever clears). `Process`/`NSTask` is unavailable in
        // this target's SDK (iOS, even though the test RUNS on the host Mac) -- the match is
        // therefore posted by `scripts/ios-autofill-e41.sh tracer`'s own EXTERNAL, PARALLEL loop
        // (`com.apple.BiometricKit_Sim.pearl.match`, this project's own established technique,
        // `scripts/run-ios-biometry-experiments.sh`'s `pearl_match`), running for this whole test's
        // duration -- a settle margin here gives it time to land.
        sleep(2)

        // Face ID / passcode confirmation dialog, if the system still shows one as a SEPARATE
        // springboard-owned sheet rather than resolving in place.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.firstMatch.waitForExistence(timeout: 3) {
            attachDiagnostics(app: springboard, label: "springboard-alert-after-suggestion-tap")
            let continueButton = springboard.buttons["Continue"]
            if continueButton.exists {
                continueButton.tap()
            } else {
                springboard.alerts.firstMatch.buttons.element(
                    boundBy: springboard.alerts.firstMatch.buttons.count - 1
                ).tap()
            }
        }

        // Settle margin for the fill to land and the mirrored readback `<div>`s to update. This
        // window was observed live to need MUCH longer than a typical UI settle: the external,
        // parallel `pearl.match` loop this test's own driving script runs does not know exactly
        // when the LocalAuthentication evaluation window opens, so several seconds can pass
        // before a posted match actually lands and Safari finishes injecting the credential.
        attachDiagnostics(app: safari, label: "final-state")

        // Discovered empirically running this exact test live: WKWebView's accessibility bridge
        // does NOT expose the `<div id="rp">` HTML `id` attribute as the element's AX
        // `identifier` -- `safari.webViews.staticTexts["rp"]` (an identifier lookup) never
        // matched even when the readback div was VISIBLY rendering the correct plaintext in a
        // screenshot taken moments later. Locating the element by a STABLE, secret-INDEPENDENT
        // label prefix (`"PWFIELD:"`, written by the login form's own `oninput`/`onchange`
        // handlers, `scripts/ios-autofill-e41.sh tracer`'s own served HTML) -- never by matching
        // the expected plaintext itself, which would make the assertion below trivially
        // true-by-construction (this task's own WR-12-style discipline: comparing code output
        // against a value the SAME code produced proves nothing).
        let passwordReadback = safari.webViews.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "PWFIELD:")
        ).firstMatch
        guard passwordReadback.waitForExistence(timeout: 25) else {
            recordFailureWithDiagnostics(
                app: safari,
                message: "The password readback element (label prefix \"PWFIELD:\") never appeared " +
                    "-- the fill did not reach the form field, or the mirrored readback did not fire."
            )
            return
        }

        let filledValue = String(passwordReadback.label.dropFirst("PWFIELD:".count))
        XCTAssertEqual(
            filledValue,
            Self.expectedPassword,
            "Filled password field value (\"\(filledValue)\") did not byte-equal the expected " +
                "tracer plaintext (\"\(Self.expectedPassword)\")."
        )
    }

    // MARK: - Tap reliability

    /// A coordinate-based tap (`.coordinate(withNormalizedOffset:).tap()`), not the plain
    /// `.tap()` convenience -- observed live, more than once, that SYSTEM-owned elements in this
    /// exact keyboard-accessory/action-sheet chain (`"Passwords"`, `"PasskeyVault"`) sometimes
    /// accept a plain `.tap()` with no error AND no effect (no state change, no new element),
    /// while a coordinate tap on the SAME element reliably registers. `.tap()` remains the right
    /// choice for ordinary app-owned elements (`usernameField`, `addressBar`) -- this helper is
    /// reserved for the specific system-chain elements this task's own falsification runs showed
    /// to be flaky.
    @MainActor
    private static func forceTap(_ element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    // MARK: - Helpers (duplicated from AutoFillInvocationUITests.swift's own precedent)

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
