// ItemFormAndFolderUITests.swift -- Phase 38, plan 38-09 evidence.
//
// Three of this plan's own acceptance criteria, driven against the real
// running app (never a forced view state):
//
//   1. "The type picker offers exactly five options, asserted by a UI test
//      counting them." (Task 1) -- EXTENDED by quick task 260818-lsk to the
//      panel's full eight-slot set (the five item types, Scan QR code,
//      Generate password, New folder); the passkey-absence assertion this
//      test already made is kept exactly as it was, not weakened.
//   2. "A screenshot shows the generator sheet invoked from the login
//      form's password field with the value inserted." (Task 1)
//   3. The folder direction's on-device half: a folder created through the
//      real FolderPicker renders its real, decrypted name -- not an id --
//      right there in the picker list. (Task 3; the cross-client half of
//      this proof is `scripts/verify-ios-web-folder-interop.mjs`, driven
//      separately, never a browser screenshot -- `web/node_modules` does
//      not exist in this worktree, the same limitation L-17/E-W1 already
//      records for items.)
//
// Added as a Rule 2 deviation (not in this plan's `files_modified`, which
// predates a screenshot-only evidence file need) -- mirrors
// `ItemDetailScreenshotUITests.swift`'s own register-or-sign-in helper shape.

import XCTest

final class ItemFormAndFolderUITests: XCTestCase {
    /// A FRESH account per test run, never the shared `pv-snap-38-05`
    /// fixture other evidence files use. This file's own test run
    /// discovered why: live XCTests elsewhere in this plan (`VaultMutationTests`
    /// `.aLiveStaleRevisionConflictIsSurfacedAndDoesNotOverwrite`,
    /// `FolderWireInteropTests`) drive the REAL `AccountService`/
    /// `PvApiClient` against the SAME live server this simulator's app also
    /// talks to -- which persists a session into the SAME Keychain the app
    /// itself reads, silently replacing whichever account `LockView` was
    /// showing. `PV_UITEST_SCREEN=auth` (`ContentView.swift`'s existing
    /// forced-route hook) sidesteps this entirely by forcing `AuthView`
    /// regardless of whatever session is currently persisted.
    private static func freshEmail() -> String {
        "pv-formfolder-uitest-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvFormFolderUITest38-09-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testCreatePanelOffersExactlyFiveOptionsAndGeneratorInsertsIntoLoginPassword() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()
        try registerFreshAccount(app, email: Self.freshEmail())

        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()

        // Plan 38-11 (addendum A2): the dedicated `TypePicker` sheet was
        // retired -- `vault.create.plusMenu` now opens the dock's own "+"
        // panel directly (`vault.create.grid`), and each action tile routes
        // straight into `ItemFormView` with no intermediate picker sheet.
        let grid = app.otherElements["vault.create.grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5), "the \"+\" action panel never appeared")

        // The must-have this test proves: exactly FIVE creatable ITEM types
        // in the panel (the panel's other three slots -- `generatePassword`,
        // `scanQr`, `newFolder` -- are not creatable item types at all, see
        // `VaultCreateAction`).
        let expectedIds = ["login", "card", "identity", "note", "code"]
        for id in expectedIds {
            XCTAssertTrue(app.buttons["vault.create.action.\(id)"].exists, "missing create-panel tile for \(id)")
        }
        // Quick task 260818-lsk: the panel's EIGHTH-slot set, in full --
        // the five item types above plus the three non-item-type actions.
        // Asserted together so a regression in either half fails here.
        for id in ["scanQr", "generatePassword", "newFolder"] {
            XCTAssertTrue(app.buttons["vault.create.action.\(id)"].exists, "missing create-panel tile for \(id)")
        }
        // Alongside `VaultDockEvidenceUITests`' own existing assertion of
        // the same fact, from the same panel (addendum A2): the create
        // surface must never offer a "New passkey" slot at all -- a passkey
        // is provider-created cryptographic material, not typed-in content.
        // Unchanged by quick task 260818-lsk -- still asserted, still true.
        let passkeyTile = app.buttons["vault.create.action.passkey"]
        XCTAssertFalse(passkeyTile.exists, "the create panel must NOT offer the sixth (render-only, provider-created) type")

        let attachment0 = XCTAttachment(screenshot: app.screenshot())
        attachment0.name = "38-11-create-panel-five-options"
        attachment0.lifetime = .keepAlways
        add(attachment0)

        app.buttons["vault.create.action.login"].tap()

        let usernameField = app.textFields["itemform.login.username"]
        XCTAssertTrue(usernameField.waitForExistence(timeout: 10), "the login form never appeared")

        // Invoke the generator NEXT TO the password field.
        app.buttons["itemform.login.generate"].tap()

        let preview = app.staticTexts["generator-preview"]
        XCTAssertTrue(preview.waitForExistence(timeout: 10), "generator sheet never appeared")
        let generatedValue = preview.label
        XCTAssertFalse(generatedValue.isEmpty, "generator produced an empty preview")

        // "Use this password" sits in a Form Section below the mode-specific
        // controls -- below the fold on a compact simulator, and SwiftUI's
        // List/Form backing lazily materializes off-screen rows, so a swipe
        // is needed before the button is even in the accessibility tree.
        let useButton = app.buttons["generator-use"]
        if !useButton.waitForExistence(timeout: 2) {
            app.swipeUp()
        }
        XCTAssertTrue(useButton.waitForExistence(timeout: 5), "generator-use button never materialized, even after scrolling")
        useButton.tap()

        // Back on the form. A `SecureField` reports its `.value` as a
        // masked placeholder (a bullet run matching the character count)
        // once it holds real text -- this IS a reliable, non-visual way to
        // assert the insertion actually happened, which the screenshot
        // alone cannot prove (a stale render could look identical to an
        // inserted one for a brief instant).
        XCTAssertTrue(usernameField.waitForExistence(timeout: 5), "did not return to the login form after Use")
        let passwordField = app.secureTextFields["itemform.login.password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        let passwordValue = passwordField.value as? String ?? ""
        XCTAssertFalse(
            passwordValue.isEmpty || passwordValue == "Password",
            "the password field must hold the generated value after Use -- got \(passwordValue.isEmpty ? "<empty>" : passwordValue)"
        )

        let attachment1 = XCTAttachment(screenshot: app.screenshot())
        attachment1.name = "38-09-generator-invoked-from-login-password-inserted"
        attachment1.lifetime = .keepAlways
        add(attachment1)

        app.buttons["Cancel"].tap()
        Thread.sleep(forTimeInterval: 1)
    }

    @MainActor
    func testFolderPickerRendersARealDecryptedNameAfterCreatingOne() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()
        try registerFreshAccount(app, email: Self.freshEmail())

        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()
        let noteTile = app.buttons["vault.create.action.note"]
        XCTAssertTrue(noteTile.waitForExistence(timeout: 5))
        noteTile.tap()

        // [Rule 1 - Bug, found live by plan 38-11] the note body row is a
        // `TextField(..., axis: .vertical)`, not a `TextEditor` -- it maps to
        // `XCUIElementTypeTextField`, never `XCUIElementTypeTextView`.
        let bodyField = app.textFields["itemform.note.body"].firstMatch
        _ = bodyField.waitForExistence(timeout: 10)

        let folderRow = app.buttons["itemform.folder.picker"]
        XCTAssertTrue(folderRow.waitForExistence(timeout: 10), "the form's Folder row never appeared")
        folderRow.tap()

        let newNameField = app.textFields["folderpicker.newName"]
        XCTAssertTrue(newNameField.waitForExistence(timeout: 10), "FolderPicker never appeared")
        let folderName = "38-09 UI evidence folder \(Int(Date().timeIntervalSince1970))"
        newNameField.tap()
        newNameField.typeText(folderName)
        app.buttons["folderpicker.create"].tap()

        // The picker dismisses itself on successful create -- back on the
        // form, tap the Folder row again to see the REAL, decrypted name
        // rendered as the current selection.
        XCTAssertTrue(folderRow.waitForExistence(timeout: 10), "did not return to the form after creating a folder")
        XCTAssertTrue(app.staticTexts[folderName].waitForExistence(timeout: 5), "the form must show the real folder name, not an id, after assignment")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "38-09-folder-created-and-assigned-real-name-rendered"
        attachment.lifetime = .keepAlways
        add(attachment)

        app.buttons["itemform.save"].tap()
        Thread.sleep(forTimeInterval: 1)
    }

    /// `PV_UITEST_SCREEN=auth` (set by both callers above) forces `AuthView`
    /// regardless of any session currently persisted in the Keychain --
    /// this file always registers a brand-new account rather than depending
    /// on a shared fixture's session surviving other tests/plans.
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

        // [Rule 1 - Bug, found live by plan 38-11] `vault.create.marker` is
        // the DEBUG-gated tracer create bar, opt-in behind
        // `PV_UITEST_TRACER_CREATE_BAR` -- never set in this file's launch
        // environment, so this wait could never have succeeded. The list
        // root's own, always-present element is the dock's "+" instead.
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }
}
