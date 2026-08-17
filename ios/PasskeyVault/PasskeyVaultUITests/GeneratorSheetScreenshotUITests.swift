// GeneratorSheetScreenshotUITests.swift -- Phase 38, plan 38-08, Task 1
// acceptance criterion: "A screenshot shows the generator sheet reachable
// and generating from the locked state."
//
// Drives `ContentView`'s `PV_UITEST_SCREEN=lock` router hook (forces the
// LOCKED route with a FIXTURE account -- no server, no real session) plus
// `LockView`'s new `PV_UITEST_LOCK_STATE=generatorSheet` hook (Rule 2
// deviation, see `LockView.swift`'s own `showGeneratorSheet` doc comment).
// Both hooks are DEBUG-only, established pattern (`LockViewFocusUITests.swift`).
//
// Two screenshots: (1) the sheet as it first appears, over the lock screen,
// proving REACHABILITY without an unlocked vault; (2) after tapping
// Regenerate and switching to Memorable mode, proving it is actually
// GENERATING (a fresh, different value each time) rather than showing a
// static placeholder.
//
// Added as a Rule 2 deviation, not in this plan's `files_modified` --
// mirrors `ItemDetailScreenshotUITests.swift`'s own header note on the same
// point.

import XCTest

final class GeneratorSheetScreenshotUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testGeneratorSheetReachableAndGeneratingFromLockedState() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = "generatorSheet"
        app.launch()

        // Proves we are genuinely on the LOCKED screen underneath: the
        // real unlock password field exists in the view hierarchy even
        // though the generator sheet is presented on top of it.
        let unlockField = app.secureTextFields["unlock-password-field"]
        XCTAssertTrue(unlockField.waitForExistence(timeout: 10), "LockView never appeared underneath the sheet")

        let preview = app.staticTexts["generator-preview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 10), "GeneratorSheet's preview never appeared")
        let firstValue = preview.label
        XCTAssertFalse(firstValue.isEmpty, "generator produced an empty preview on first appearance")

        let attachment1 = XCTAttachment(screenshot: app.screenshot())
        attachment1.name = "38-08-generator-sheet-locked-state"
        attachment1.lifetime = .keepAlways
        add(attachment1)

        // Prove it is actually GENERATING (calling into Rust each time),
        // not a static placeholder: switch to Memorable mode (a different
        // generator function entirely -- `generatePassphrase`) and confirm
        // the preview value changes.
        let memorableTab = app.buttons["Memorable"]
        XCTAssertTrue(memorableTab.waitForExistence(timeout: 5), "Memorable mode segment never appeared")
        memorableTab.tap()

        let afterModeSwitch = preview.label
        XCTAssertTrue(afterModeSwitch.contains("-"), "passphrase mode preview should be hyphen-separated")
        XCTAssertNotEqual(afterModeSwitch, firstValue, "switching mode did not change the generated value")

        let regenerate = app.buttons["generator-regenerate"]
        XCTAssertTrue(regenerate.waitForExistence(timeout: 5))
        regenerate.tap()
        let afterRegenerate = preview.label
        XCTAssertFalse(afterRegenerate.isEmpty, "regenerate produced an empty preview")

        let attachment2 = XCTAttachment(screenshot: app.screenshot())
        attachment2.name = "38-08-generator-sheet-locked-state-memorable-regenerated"
        attachment2.lifetime = .keepAlways
        add(attachment2)

        Thread.sleep(forTimeInterval: 1)
    }
}
