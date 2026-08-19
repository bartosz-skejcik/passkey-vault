// RevealStateCarryoverUITests.swift -- Phase 38 code-review fix, CR-01.
//
// [Rule 2 deviation] Regression coverage for CR-01 (38-REVIEW.md): a field
// revealed on one item's detail screen must never carry over to the next
// item opened. `DetailFieldTablesTests.swift` calls `DetailRevealState
// .setItem` directly and so cannot observe whether the real navigation path
// (`ItemDetailView`'s `.onAppear`/`.onChange`) ever calls it -- this file
// drives the real create/reveal/back/create/open flow against the live app,
// mirroring `ItemDetailScreenshotUITests.swift`'s own register-then-drive
// shape.
//
// Reproduction this test pins RED-before-fix (verified by stashing the
// `.onAppear` fix and re-running): create login A, reveal its password,
// go back to the list, create login B -- B's password field rendered A's
// plaintext value the instant the detail screen appeared, because
// `.onChange(of: item.id)` never fires on first appearance and `setItem`
// was therefore never called for the newly-pushed item.
//
// WR-09 (40-REVIEW.md): this test registers a real account and creates
// real items -- unlike the E-F* live-server runs elsewhere in this repo,
// it previously had no documented `scripts/ios-live-server.sh`
// precondition. It needs a real `pv-server` reachable at the app's
// resolved base URL, or `createLogin`'s save will fail and this test will
// report a misleading downstream symptom instead of the real cause.

import XCTest

final class RevealStateCarryoverUITests: XCTestCase {
    private static func freshEmail() -> String {
        "pv-revealcarryover-uitest-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvRevealCarryoverUITest38Review-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testRevealedPasswordDoesNotCarryOverToTheNextItemOpened() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()
        try registerFreshAccount(app, email: Self.freshEmail())

        let passwordA = "PlaintextSecretA-1234!"
        let passwordB = "PlaintextSecretB-5678!"

        try createLogin(app, name: "CR01 Login A", username: "user-a", password: passwordA)

        // Lands directly on A's detail screen (`ItemFormView.onSaved` sets
        // `root.selection = created`).
        XCTAssertTrue(
            app.navigationBars["CR01 Login A"].waitForExistence(timeout: 10),
            "login A's detail screen never appeared"
        )
        let revealButtonA = app.buttons["vault.detail.reveal.password"]
        XCTAssertTrue(revealButtonA.waitForExistence(timeout: 10), "reveal toggle never appeared on login A's detail screen")
        revealButtonA.tap()

        let fieldA = app.staticTexts["vault.detail.field.password"]
        XCTAssertTrue(fieldA.waitForExistence(timeout: 5))
        XCTAssertEqual(fieldA.label, passwordA, "password A must render in the clear after an explicit reveal")

        // Back to the list, then create + open login B.
        app.navigationBars.buttons.element(boundBy: 0).tap()

        try createLogin(app, name: "CR01 Login B", username: "user-b", password: passwordB)

        XCTAssertTrue(
            app.navigationBars["CR01 Login B"].waitForExistence(timeout: 10),
            "login B's detail screen never appeared"
        )
        let fieldB = app.staticTexts["vault.detail.field.password"]
        XCTAssertTrue(fieldB.waitForExistence(timeout: 5))

        // The must-have this test proves: B's password field is MASKED by
        // default -- never A's carried-over plaintext, and never B's own
        // plaintext before an explicit reveal on THIS item.
        XCTAssertNotEqual(fieldB.label, passwordA, "login A's password carried over to login B's detail screen (CR-01)")
        XCTAssertNotEqual(fieldB.label, passwordB, "login B's password must start masked, not pre-revealed")
        XCTAssertEqual(
            fieldB.label, String(repeating: "\u{2022}", count: 10),
            "login B's password field must show the fixed-length mask, got: \(fieldB.label)"
        )

        let revealButtonB = app.buttons["vault.detail.reveal.password"]
        XCTAssertTrue(revealButtonB.waitForExistence(timeout: 5))
        revealButtonB.tap()
        XCTAssertEqual(
            app.staticTexts["vault.detail.field.password"].label, passwordB,
            "login B must reveal its OWN password, not login A's"
        )

        Thread.sleep(forTimeInterval: 1)
    }

    private func createLogin(_ app: XCUIApplication, name: String, username: String, password: String) throws {
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()
        let loginTile = app.buttons["vault.create.action.login"]
        XCTAssertTrue(loginTile.waitForExistence(timeout: 5), "Login create-panel tile never appeared")
        loginTile.tap()

        let nameField = app.textFields["itemform.name"]
        XCTAssertTrue(nameField.waitForExistence(timeout: 10), "the login form never appeared")
        nameField.tap()
        nameField.typeText(name)

        let usernameField = app.textFields["itemform.login.username"]
        XCTAssertTrue(usernameField.waitForExistence(timeout: 5))
        usernameField.tap()
        usernameField.typeText(username)

        let passwordField = app.secureTextFields["itemform.login.password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        passwordField.tap()
        passwordField.typeText(password)

        // WR-09 (40-REVIEW.md): this used to be a bare `.tap()` with no
        // existence check and no post-condition -- if the save failed (no
        // live server on the resolved base URL, a 4xx, a validation
        // error), the sheet stayed up with itemform's own error text
        // visible, and the FAILURE the caller actually saw was a
        // misleading "login A's detail screen never appeared" ten seconds
        // later on an unrelated assertion. Fail here, at the real failure
        // point, with the real error text if there is one.
        let save = app.buttons["itemform.save"]
        XCTAssertTrue(save.waitForExistence(timeout: 5), "the save button never appeared")
        save.tap()
        XCTAssertTrue(
            nameField.waitForNonExistence(timeout: 10),
            "the item form never dismissed -- save failed: \(app.staticTexts["itemform.error"].label)"
        )
    }

    /// `PV_UITEST_SCREEN=auth` (set by the caller above) forces `AuthView`
    /// regardless of any session currently persisted in the Keychain --
    /// same helper shape as `ItemDetailScreenshotUITests.swift`'s own
    /// `registerFreshAccount`, duplicated rather than shared for the same
    /// reason that file's header gives (independent ownership).
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

        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }
}
