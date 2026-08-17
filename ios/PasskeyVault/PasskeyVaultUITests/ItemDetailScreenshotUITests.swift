// ItemDetailScreenshotUITests.swift -- Phase 38, plan 38-07, Task 1 evidence.
//
// Produces the screenshot this plan's own acceptance criteria require: "A
// screenshot shows a card detail with an empty pin, and the pin row is
// absent rather than showing a placeholder." Drives the REAL "+" create
// menu (`ItemListView.swift`'s `createDraft`), which creates a genuinely
// empty card draft (`ItemCreationKind.emptyFields()`'s `pin: nil`) against
// the real `pv-server` -- never a forced view state.
//
// Added as a Rule 2 deviation (not in this plan's `files_modified`, which
// predates a screenshot-only evidence file need) -- mirrors
// `SnapshotEvidenceUITests.swift`'s own register-or-sign-in helper shape,
// duplicated rather than shared because that file is owned by plan 38-05
// and this one intentionally stays independent of it.

import XCTest

final class ItemDetailScreenshotUITests: XCTestCase {
    // SAME account `SnapshotEvidenceUITests.swift` (plan 38-05) uses --
    // this simulator already carries a restored session/keychain envelope
    // for it from a prior run, and `LockView` (not `AuthView`) is what
    // actually appears on launch here; a fresh, never-used email would hit
    // exactly that LockView with the WRONG password and never unlock.
    static let email = "pv-snap-38-05@example.invalid"
    static let password = "PvSnap38-05-EvidencePassword!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCardDetailWithEmptyPinOmitsThePinRow() throws {
        let app = XCUIApplication()
        app.launch()

        try signInOrRegisterOrUnlock(app)

        // The "+" create menu (`vault.create.plusMenu`), then "Card" --
        // `ItemListView.swift`'s real `createDraft(.card)` path, which opens
        // the created item's detail screen immediately via `selection =
        // created`.
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create menu never appeared")
        plusMenu.tap()
        let cardOption = app.buttons["Card"]
        XCTAssertTrue(cardOption.waitForExistence(timeout: 5), "Card creation option never appeared")
        cardOption.tap()

        // The detail screen's "Card number" row always renders (empty ->
        // "--"); confirms we are genuinely on the detail screen before
        // asserting the pin row's absence.
        let numberRow = app.staticTexts["Card number"]
        XCTAssertTrue(numberRow.waitForExistence(timeout: 10), "card detail screen never appeared")

        // The must-have this screenshot proves: NO "PIN" label anywhere on
        // screen -- the row is OMITTED, not rendered with a placeholder.
        XCTAssertFalse(app.staticTexts["PIN"].exists, "PIN row must be entirely absent when pin is empty")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "38-07-card-detail-empty-pin-omitted"
        attachment.lifetime = .keepAlways
        add(attachment)

        Thread.sleep(forTimeInterval: 2)
    }

    private func signInOrRegisterOrUnlock(_ app: XCUIApplication) throws {
        let unlockPasswordField = app.secureTextFields["unlock-password-field"]
        let authEmailField = app.textFields.firstMatch

        if unlockPasswordField.waitForExistence(timeout: 5) {
            unlockPasswordField.tap()
            unlockPasswordField.typeText(Self.password)
            app.buttons["Unlock"].tap()
            let listOrField = app.textFields["vault.create.marker"]
            XCTAssertTrue(listOrField.waitForExistence(timeout: 15), "vault list never appeared after unlock")
            return
        }

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

        app.buttons["No account yet? Sign up"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["Create account"].tap()

        XCTAssertTrue(listField.waitForExistence(timeout: 15), "vault list never appeared after registration")
    }
}
