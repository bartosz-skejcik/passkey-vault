// AutoFillColdOfflineUITests.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
// Plan 41-06, Task 2 (E41-6, FILL-05).
//
// Drives Safari on the simulator to a real login form and invokes AutoFill -- WITHOUT EVER
// launching the host app (`cloud.blonie.PasskeyVault`) from this process. This is the load-bearing
// difference from `AutoFillFillUITests.swift` (41-03's own tracer, which launches the host app
// FIRST, unconditionally, to seed): that seed step must already have happened, in a SEPARATE
// process, BEFORE `scripts/ios-autofill-e41.sh e41-6` shuts the simulator down and boots it again.
// This test method is the "cold" half only -- it asserts on the SAME cached item
// `TracerFillSeeder.seed()` (host app target) wrote in that earlier, now-dead process, proving the
// fill comes from cache alone: no host app process exists in THIS boot at all until (if ever) this
// test's own runner needs one for XCUITest's own plumbing, and this test never asks for one.
//
// `TracerFillSeeder.tracerUsername`/`tracerPassword` (host app target,
// `ios/PasskeyVault/PasskeyVault/TracerFillSeeder.swift`) are DUPLICATED here as literals -- same
// "separate build targets, no in-process import" discipline `AutoFillFillUITests.swift`'s own
// header already established. Reusing the SAME tracer item id/credentials as 41-03's own tracer is
// deliberate: `scripts/ios-autofill-e41.sh e41-6` seeds this exact item (via `xcrun simctl launch`,
// never an XCUITest launch) in the PRE-shutdown phase, so this test's expectation must match that
// seeder's own literals exactly.

import Foundation
import XCTest

final class AutoFillColdOfflineUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// DUPLICATED from `TracerFillSeeder.swift` (host app target) -- see this file's own header.
    private static let expectedUsername = "tracer41-03@pv.test"
    private static let expectedPassword = "Tr4c3r-Fill-41-03!"

    /// MUST match `TracerFillSeeder.tracerServiceIdentifier` (host app target) and
    /// `scripts/ios-autofill-e41.sh`'s own local server port -- the SAME local, static-file login
    /// form `AutoFillFillUITests.swift`'s own tracer drive already uses (never `pv-server` itself
    /// -- this whole test is about the extension's cache-only fill path, which never touches
    /// `pv-server` in this milestone at all, per `41-RESEARCH.md`'s own "Explicitly NOT in the
    /// stack" table).
    private static let loginFormHost = "127.0.0.1"
    private static let loginFormPort = 8765

    @MainActor
    func testColdOfflineFillFromCacheOnly() throws {
        // NO `host.launch()` HERE, deliberately -- see this file's own header. The seed
        // (`TracerFillSeeder.seed()`, via `xcrun simctl launch`) already happened, in a process
        // this boot never saw, BEFORE `scripts/ios-autofill-e41.sh e41-6` shut the simulator down.
        // If this test method is ever edited to add a host-app launch, the cold claim is void by
        // this task's own prohibition ("The host app is not launched at any point after the boot.
        // If it is launched for any reason, the run is void and is re-run, not reinterpreted.").
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: safari, message: "Safari address bar never appeared.")
            return
        }
        addressBar.tap()

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

        // Same non-determinism `AutoFillFillUITests.swift`'s own header documents (direct sheet vs
        // keyboard-accessory chain) -- duplicated here rather than shared (separate test methods,
        // same discipline this whole file's header already explains).
        var fillPasswordButton = safari.buttons["FillPasswordButton"]
        if !fillPasswordButton.waitForExistence(timeout: 5) {
            attachDiagnostics(app: safari, label: "no-direct-sheet-trying-passwords-accessory")
            let passwordsAccessory = safari.buttons["Passwords"]
            guard passwordsAccessory.waitForExistence(timeout: 5) else {
                print("PVUITEST|E41-6|status=fail reason=no-suggestion-offered identity-survived=false")
                recordFailureWithDiagnostics(
                    app: safari,
                    message: "Neither the direct \"Fill Password\" sheet nor a \"Passwords\" " +
                        "keyboard accessory button appeared -- our identity was not offered, or the " +
                        "identity store did not survive the cold boot."
                )
                return
            }
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
                            "row was found after \(attempt) attempt(s) -- nothing to fill."
                    )
                    return
                }
                Self.forceTap(providerRow)
                attachDiagnostics(app: safari, label: "after-provider-row-tap")

                fillPasswordButton = safari.buttons["FillPasswordButton"]
                guard fillPasswordButton.waitForExistence(timeout: 5) else {
                    recordFailureWithDiagnostics(
                        app: safari,
                        message: "Selected \"PasskeyVault\" but the \"Fill Password\" sheet never " +
                            "appeared -- nothing to fill."
                    )
                    return
                }
            }
        }
        attachDiagnostics(app: safari, label: "before-fill-password-tap")
        Self.forceTap(fillPasswordButton)
        attachDiagnostics(app: safari, label: "after-suggestion-tap")

        // Same external, parallel `pearl.match` posting loop
        // (`scripts/ios-autofill-e41.sh`'s `run_pearl_match_loop`) required here, running for this
        // whole test's duration -- Safari's own LocalAuthentication confirmation gate, independent
        // of our own provider's silent read.
        sleep(2)

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

        attachDiagnostics(app: safari, label: "final-state")

        let passwordReadback = safari.webViews.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "PWFIELD:")
        ).firstMatch
        guard passwordReadback.waitForExistence(timeout: 25) else {
            // The suggestion WAS offered (we got this far) -- so the identity store survived the
            // cold boot. The fill itself failed (cache row missing/undecodable, or the
            // LockMarker's lazy check reads the pre-shutdown state as expired) -- distinguished
            // from the identity-store failure mode above by THIS line's own "identity-survived"
            // value, per this task's own required distinction.
            print("PVUITEST|E41-6|status=fail reason=nothing-filled identity-survived=true")
            recordFailureWithDiagnostics(
                app: safari,
                message: "The password readback element (label prefix \"PWFIELD:\") never appeared " +
                    "-- nothing was filled. Under DR-41-C, this is expected if either the cache row " +
                    "or the identity store did not survive the cold boot, or if the LockMarker's " +
                    "lazy check reads the pre-shutdown state as expired."
            )
            return
        }

        let filledValue = String(passwordReadback.label.dropFirst("PWFIELD:".count))
        let fieldValueEqual = filledValue == Self.expectedPassword
        print("PVUITEST|E41-6|status=ok identity-survived=true field-value-equal=\(fieldValueEqual) filled-length=\(filledValue.count)")
        XCTAssertEqual(
            filledValue,
            Self.expectedPassword,
            "Filled password field value (\"\(filledValue)\") did not byte-equal the plaintext " +
                "captured BEFORE the shutdown (\"\(Self.expectedPassword)\")."
        )
    }

    // MARK: - Tap reliability (duplicated from AutoFillFillUITests.swift's own precedent)

    @MainActor
    private static func forceTap(_ element: XCUIElement) {
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    // MARK: - Helpers (duplicated from AutoFillFillUITests.swift's own precedent)

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
