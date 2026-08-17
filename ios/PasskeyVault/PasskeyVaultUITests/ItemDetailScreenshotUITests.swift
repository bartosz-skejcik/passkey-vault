// ItemDetailScreenshotUITests.swift -- Phase 38, plan 38-07, Task 1 evidence.
//
// Produces the screenshot this plan's own acceptance criteria require: "A
// screenshot shows a card detail with an empty pin, and the pin row is
// absent rather than showing a placeholder." Drives the REAL "+" create
// affordance -> `TypePicker` -> `ItemFormView`, saving a genuinely empty
// card draft against the real `pv-server` -- never a forced view state.
//
// [Rule 1 - Bug, 38-09] The "+" affordance stopped being a `Menu` whose
// items created an item immediately (38-06's own placeholder, explicit that
// a real create/edit FORM was 38-09's job) -- it now opens `TypePicker`,
// and the chosen type opens a real, empty `ItemFormView` that must be
// explicitly saved. Updated to drive that real flow rather than the
// placeholder one.
//
// Added as a Rule 2 deviation (not in this plan's `files_modified`, which
// predates a screenshot-only evidence file need) -- mirrors
// `SnapshotEvidenceUITests.swift`'s own register-or-sign-in helper shape,
// duplicated rather than shared because that file is owned by plan 38-05
// and this one intentionally stays independent of it.
//
// [Rule 1 - Bug, 38-09] Was: reuse the SAME shared `pv-snap-38-05` account
// `SnapshotEvidenceUITests.swift` also uses, relying on this simulator
// already carrying a restored session for it. Found broken by THIS plan's
// own live `VaultMutationTests`/`FolderWireInteropTests`: those tests drive
// the REAL `AccountService`/`PvApiClient` against the SAME live server
// (127.0.0.1:8621) this simulator's app also talks to, which persists a
// NEW session into the SAME Keychain the app reads on launch -- silently
// replacing whichever account `LockView` was showing with an unrelated,
// randomly-generated one. `LockView` then appears for an account this
// file's hardcoded password does not unlock, and the vault list never
// appears. `PV_UITEST_SCREEN=auth` (`ContentView.swift`'s existing
// forced-route hook, added for onboarding's own 38-13 evidence) forces
// `AuthView` regardless of any session currently persisted; this file now
// registers a brand-new, uniquely-named account every run instead.

import XCTest

final class ItemDetailScreenshotUITests: XCTestCase {
    private static func freshEmail() -> String {
        "pv-carddetail-uitest-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvCardDetailUITest38-09-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCardDetailWithEmptyPinOmitsThePinRow() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()

        try registerFreshAccount(app, email: Self.freshEmail())

        // The "+" create affordance (`vault.create.plusMenu`) -> TypePicker
        // -> "Card" tile -> the real, empty `ItemFormView` -> Save. Opens
        // the created item's detail screen via `ItemFormView`'s own
        // `onSaved` closure (`selection = created`).
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()
        let cardOption = app.buttons["typepicker.Card"]
        XCTAssertTrue(cardOption.waitForExistence(timeout: 5), "Card type-picker tile never appeared")
        cardOption.tap()

        let saveButton = app.buttons["itemform.save"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 10), "the empty card form never appeared")
        saveButton.tap()

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

    /// `PV_UITEST_SCREEN=auth` (set by the caller above) forces `AuthView`
    /// regardless of any session currently persisted in the Keychain.
    private func registerFreshAccount(_ app: XCUIApplication, email: String) throws {
        let authEmailField = app.textFields.firstMatch
        XCTAssertTrue(authEmailField.waitForExistence(timeout: 10), "AuthView never appeared")
        authEmailField.tap()
        authEmailField.typeText(email)

        app.buttons["auth-toggle-mode"].tap()
        let passwordField = app.secureTextFields.firstMatch
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        passwordField.tap()
        passwordField.typeText(Self.password)
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        let listField = app.textFields["vault.create.marker"]
        XCTAssertTrue(listField.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }
}
