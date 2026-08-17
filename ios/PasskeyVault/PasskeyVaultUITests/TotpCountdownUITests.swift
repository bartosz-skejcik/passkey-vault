// TotpCountdownUITests.swift -- Phase 38, plan 38-10, Task 2 evidence.
//
// [Rule 2 deviation] Not in this plan's `files_modified` -- Task 2's own
// verify step names this exact file/test-plan
// (`-only-testing:PasskeyVaultUITests/TotpCountdownUITests`), matching the
// precedent `ItemDetailScreenshotUITests.swift`'s own header already
// records for the same class of gap.
//
// Drives the REAL "+" create affordance -> TypePicker "Code" tile (its
// draft's secret is ALREADY the RFC 6238 Appendix B SHA1 vector,
// `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` -- `TypePicker.swift`'s own
// `emptyFields()`, no typing required) -> Save -> the real detail screen,
// and reads the live code/countdown through XCUITest ACCESSIBILITY VALUES,
// never OCR on the rendered ring (38-RESEARCH.md E-T1 step 2).
//
// The error-state screenshot uses a second item, seeded by a DEBUG-only
// launch hook (`ContentView.swift`'s `PV_UITEST_SEED_BAD_TOTP`, a Rule 2
// deviation of its own -- see that file's header) carrying the 16-character
// secret (`JBSWY3DPEHPK3PXP`, a 10-byte decode) `totp-rs` rejects. That
// secret cannot reach the vault through the real create FORM at all --
// `TotpValidation.swift` refuses it before save -- so this is the only way
// to produce a real, server-persisted item exercising the error path.

import XCTest

final class TotpCountdownUITests: XCTestCase {
    private static func freshEmail() -> String {
        "pv-totp-uitest-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvTotpCountdownUITest38-10-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLiveCodeAndCountdownThenErrorState() throws {
        let app = XCUIApplication()
        // `authRegister`, not `auth` -- ContentView.swift's own comment on
        // this exact env var: reaching the register screen by tapping the
        // toggle control is a real simulator-input step that has timed out
        // in this environment often enough to lose screenshot evidence.
        // Landing directly in register mode avoids that flake.
        app.launchEnvironment["PV_UITEST_SCREEN"] = "authRegister"
        // Seeds "Bad Secret (UI test fixture)" (secret JBSWY3DPEHPK3PXP)
        // as soon as the vault list appears -- see ContentView.swift.
        app.launchEnvironment["PV_UITEST_SEED_BAD_TOTP"] = "1"
        app.launch()

        try registerFreshAccount(app, email: Self.freshEmail())

        // ---- Live code + countdown, through the real "+" -> Code flow ----
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()
        let codeOption = app.buttons["typepicker.Code"]
        XCTAssertTrue(codeOption.waitForExistence(timeout: 5), "Code type-picker tile never appeared")
        codeOption.tap()

        let saveButton = app.buttons["itemform.save"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 10), "the Code create form never appeared")
        saveButton.tap()

        // `app.descendants(matching: .any)`, not `.otherElements`/
        // `.staticTexts`: SwiftUI classifies the accessibility element
        // type by the underlying view kind (`Text` -> static text, the
        // `Circle` ring -> other), and this test must not assume which.
        let codeElement = app.descendants(matching: .any)["vault.detail.totp.code"]
        XCTAssertTrue(codeElement.waitForExistence(timeout: 10), "TOTP detail screen never appeared")
        let ringElement = app.descendants(matching: .any)["vault.detail.totp.remainingSeconds"]
        XCTAssertTrue(ringElement.waitForExistence(timeout: 5), "TOTP countdown ring never appeared")

        // Real accessibility VALUES, not label text and not OCR.
        let displayedCode = codeElement.value as? String
        XCTAssertNotNil(displayedCode, "code accessibility value must be readable")
        XCTAssertFalse(displayedCode!.isEmpty, "code accessibility value must be non-empty")
        XCTAssertTrue(
            displayedCode!.allSatisfy(\.isNumber),
            "code accessibility value must be all digits, got: \(displayedCode!)"
        )

        let displayedRemaining = ringElement.value as? String
        XCTAssertNotNil(displayedRemaining, "remaining-seconds accessibility value must be readable")
        XCTAssertNotNil(
            UInt64(displayedRemaining ?? ""),
            "remaining-seconds accessibility value must be numeric, got: \(displayedRemaining ?? "nil")"
        )

        let liveAttachment = XCTAttachment(screenshot: app.screenshot())
        liveAttachment.name = "38-10-totp-live-code-and-countdown"
        liveAttachment.lifetime = .keepAlways
        add(liveAttachment)

        // ---- Back to the list, then the pre-seeded too-short-secret item ----
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let badSecretRow = app.staticTexts["Bad Secret (UI test fixture)"]
        XCTAssertTrue(badSecretRow.waitForExistence(timeout: 15), "seeded bad-secret item never appeared in the list")
        badSecretRow.tap()

        let errorElement = app.descendants(matching: .any)["vault.detail.totp.error"]
        XCTAssertTrue(errorElement.waitForExistence(timeout: 10), "TOTP error state never appeared")
        // The must-have this screenshot proves: no code element anywhere
        // on screen when the secret is rejected -- error state, not a
        // silently-wrong code and not a blank.
        XCTAssertFalse(
            app.descendants(matching: .any)["vault.detail.totp.code"].exists,
            "a code element must not exist alongside the error state"
        )

        let errorAttachment = XCTAttachment(screenshot: app.screenshot())
        errorAttachment.name = "38-10-totp-error-state-too-short-secret"
        errorAttachment.lifetime = .keepAlways
        add(errorAttachment)

        Thread.sleep(forTimeInterval: 2)
    }

    /// `PV_UITEST_SCREEN=authRegister` (set by the caller above) forces
    /// `AuthView` straight into register mode, regardless of any session
    /// currently persisted in the Keychain (L-20, `ios/IOS-SPIKE-LOG.md`).
    /// Button label is the CURRENT localized English string
    /// (`Core/I18n/Dictionary.swift`'s `authRegisterSubmit`). [Rule 1 -
    /// Bug, this plan] `ItemDetailScreenshotUITests.swift`'s own
    /// `registerFreshAccount` (copied as a starting point) uses stale
    /// wording ("No account yet? Sign up" / "Create account") that no
    /// longer matches this screen -- not fixed there (out of this plan's
    /// files), fixed here.
    private func registerFreshAccount(_ app: XCUIApplication, email: String) throws {
        let authEmailField = app.textFields.firstMatch
        XCTAssertTrue(authEmailField.waitForExistence(timeout: 5), "email field never appeared")
        authEmailField.tap()
        authEmailField.typeText(email)

        // [Rule 1 - Bug, this plan] Typing directly into the two masked
        // `SecureField`s (this repo's established pattern elsewhere --
        // `ItemDetailScreenshotUITests.swift` et al.) produced a real,
        // repeatable, non-transient "Passwords don't match" banner in THIS
        // harness even though the identical literal was typed into both --
        // clearing first (`XCUIKeyboardKey.delete` x80) did not change the
        // outcome, so this is not stale-autofill content. `AuthView.swift`'s
        // `isPasswordRevealed` is a SINGLE `@State` shared by both fields
        // (`passwordField(text:)` is called for both with the same toggle):
        // tapping the reveal ("eye") button once switches BOTH fields from
        // `SecureField` to a plain, autocorrection-disabled `TextField`
        // simultaneously, sidestepping whatever `SecureField`-specific
        // quirk this simulator/OS build has. Landmine recorded in
        // `ios/IOS-SPIKE-LOG.md`.
        let revealButton = app.buttons["Show password"].firstMatch
        XCTAssertTrue(revealButton.waitForExistence(timeout: 5), "password reveal toggle never appeared")
        revealButton.tap()

        // Field order top-to-bottom: email (0), master password (1),
        // confirm password (2) -- all plain `TextField`s once revealed.
        let passwordField = app.textFields.element(boundBy: 1)
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "revealed master-password field never appeared")
        passwordField.tap()
        passwordField.typeText(Self.password)

        let confirmField = app.textFields.element(boundBy: 2)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5), "revealed confirm-password field never appeared")
        confirmField.tap()
        confirmField.typeText(Self.password)

        app.buttons["Create vault"].tap()

        let listField = app.textFields["vault.create.marker"]
        XCTAssertTrue(listField.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }
}
