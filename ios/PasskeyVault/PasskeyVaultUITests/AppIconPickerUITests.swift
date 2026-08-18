// AppIconPickerUITests.swift -- quick task 260818-fnt
//
// Task 1's tracer test proves the entire switchable-app-icon mechanism
// end-to-end (SVG -> asset catalog -> pbxproj build setting -> SwiftUI ->
// real OS `setAlternateIconName(_:)` -> visually confirmed on the pinned
// simulator) for ONE variant (orange). Task 4's sweep test exercises the
// real 4-row `SettingsView` from Task 3, including reverting to the default.
//
// Drives `ContentView`'s `PV_UITEST_SCREEN=lock` router hook plus
// `LockView`'s new `PV_UITEST_LOCK_STATE=settingsSheet` hook (mirrors
// `GeneratorSheetScreenshotUITests.swift`'s own precedent exactly). Both
// hooks are DEBUG-only.
//
// Checkmark-existence wait is the falsifiable proof point: it only appears
// after the real OS completion handler reports success, not merely because
// the button was tapped.

import XCTest

final class AppIconPickerUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testTracerOrangeSwitchesHomeScreenIcon() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = "settingsSheet"
        app.launch()

        let tryOrange = app.buttons["settings.appIcon.orange"]
        XCTAssertTrue(tryOrange.waitForExistence(timeout: 10), "SettingsView's Try Orange row never appeared")
        tryOrange.tap()

        // Apple presents a system confirmation alert ("You have changed the
        // icon for ...") for setAlternateIconName -- spec-known, not a bug.
        // Verified live (screen recording, this task) that this alert is
        // owned by SpringBoard, NOT by our own app's process -- `app.alerts`
        // (scoped to `cloud.blonie.PasskeyVault`) never observes it, so it
        // must be queried through a SEPARATE `XCUIApplication` handle for
        // `com.apple.springboard`. Acknowledge it if it shows; do not build
        // elaborate handling beyond that.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = springboard.alerts.element
        if alert.waitForExistence(timeout: 5) {
            let lastButton = alert.buttons.element(boundBy: alert.buttons.count - 1)
            if lastButton.exists {
                lastButton.tap()
            }
        }

        let checkmark = app.images["settings.appIcon.orange.checkmark"]
        XCTAssertTrue(checkmark.waitForExistence(timeout: 15), "orange checkmark never appeared -- setAlternateIconName did not report success")

        let attachment1 = XCTAttachment(screenshot: app.screenshot())
        attachment1.name = "tracer-orange-picker-ui"
        attachment1.lifetime = .keepAlways
        add(attachment1)

        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)

        let attachment2 = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment2.name = "tracer-orange-home-screen"
        attachment2.lifetime = .keepAlways
        add(attachment2)
    }

    /// Task 4: the falsifiable, non-optimistic proof over the REAL 4-row
    /// `SettingsView` from Task 3 -- each selection's on-screen checkmark
    /// only appears after the real `setAlternateIconName` completion
    /// handler reports success, and each Home-Screen screenshot is taken
    /// via `XCUIScreen.main.screenshot()` (device-level, captures
    /// SpringBoard) immediately after `XCUIDevice.shared.press(.home)`.
    /// Ends by selecting "White (Default)" -- the explicit proof that
    /// reverting to default is not a special, less-tested code path.
    @MainActor
    func testEveryOptionSwitchesTheHomeScreenIconIncludingRevertToDefault() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = "settingsSheet"
        app.launch()

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        func acknowledgeSystemAlertIfPresent() {
            let alert = springboard.alerts.element
            if alert.waitForExistence(timeout: 5) {
                let lastButton = alert.buttons.element(boundBy: alert.buttons.count - 1)
                if lastButton.exists {
                    lastButton.tap()
                }
            }
        }

        func select(_ name: String) {
            let row = app.buttons["settings.appIcon.\(name)"]
            XCTAssertTrue(row.waitForExistence(timeout: 10), "\(name) row never appeared")
            row.tap()
            acknowledgeSystemAlertIfPresent()
            let checkmark = app.images["settings.appIcon.\(name).checkmark"]
            XCTAssertTrue(checkmark.waitForExistence(timeout: 15), "\(name) checkmark never appeared -- setAlternateIconName did not report success")
        }

        func captureHomeScreen(named name: String) {
            XCUIDevice.shared.press(.home)
            Thread.sleep(forTimeInterval: 1)
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = "home-screen-\(name)"
            attachment.lifetime = .keepAlways
            add(attachment)
            app.activate()
        }

        // The picker at rest.
        let firstRow = app.buttons["settings.appIcon.white"]
        XCTAssertTrue(firstRow.waitForExistence(timeout: 10), "SettingsView never appeared")
        let atRest = XCTAttachment(screenshot: app.screenshot())
        atRest.name = "picker-ui-at-rest"
        atRest.lifetime = .keepAlways
        add(atRest)

        for name in ["beige", "dark", "orange"] {
            select(name)
            captureHomeScreen(named: name)
        }

        // Explicit proof: reverting to White (Default) is the SAME
        // success-gated path as every other option, not a special case.
        select("white")
        captureHomeScreen(named: "white-default-restored")
    }
}
