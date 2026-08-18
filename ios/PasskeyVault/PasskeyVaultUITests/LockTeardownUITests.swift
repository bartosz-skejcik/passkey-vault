// LockTeardownUITests.swift -- Phase 38, plan 38-11, Task 1 evidence.
//
// Drives the REAL app: register -> create a real note -> open its real
// detail screen -> tap the REAL "Lock now" -> unlock with the REAL
// password path. Asserts POSITIVELY what SHOULD be on screen at each step
// (QA-03's own standard), never merely the absence of something -- the
// lock surface's own element after a lock, the list root's own element
// after unlocking, and the previously-viewed detail element's ABSENCE at
// both points (checked alongside a positive assertion, never alone).
//
// Also captures the Offline lock state (addendum A3) via the SAME
// `PV_UITEST_LOCK_STATE` forced-route hook the existing nine-state matrix
// already uses (`ios/evidence/38/lock-states-v3/`), into a v4 directory --
// this is the state that gap table left unclosed.

import XCTest

final class LockTeardownUITests: XCTestCase {
    private static func freshEmail() -> String {
        "pv-lockteardown-uitest-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvLockTeardownUITest38-11-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// The full teardown proof, in one flow: everything a lock must reach,
    /// asserted positively, on the real app.
    @MainActor
    func testLockTearsDownDetailAndUnlockReturnsToListRootNotTheDetailScreen() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()

        let email = Self.freshEmail()
        try registerFreshAccount(app, email: email)

        // ---- Create a real item and open its real detail screen ----
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 20), "plus create affordance never appeared")
        plusMenu.tap()

        let noteTile = app.buttons["vault.create.action.note"]
        XCTAssertTrue(noteTile.waitForExistence(timeout: 15), "note create-panel tile never appeared")
        noteTile.tap()

        // [Rule 1 - Bug, found live] `ItemFormView.swift`'s note body row is a
        // `TextField(..., axis: .vertical)`, not a `TextEditor` -- it maps to
        // `XCUIElementTypeTextField` in the accessibility tree, never
        // `XCUIElementTypeTextView`. A screen recording captured on an
        // earlier failed run showed the form fully, correctly rendered
        // on-screen the whole time; the ORIGINAL `app.textViews[...]` query
        // here was querying the wrong element type and could never have
        // matched, load or no load.
        let bodyField = app.textFields["itemform.note.body"].firstMatch
        XCTAssertTrue(bodyField.waitForExistence(timeout: 20), "the note create form never appeared")
        bodyField.tap()
        bodyField.typeText("lock-teardown-marker-body")

        app.buttons["itemform.save"].tap()

        // `ItemFormView`'s `onSaved` sets `root.selection = created`, pushing
        // the real detail screen -- confirm we are genuinely there before
        // trusting anything downstream.
        let detailBodyField = app.staticTexts["vault.detail.field.body"]
        XCTAssertTrue(detailBodyField.waitForExistence(timeout: 20), "never reached the real item detail screen")

        // ---- Lock ----
        // `vault.lockNow` is reachable HERE, on the detail screen -- see
        // `vaultLockToolbarContent`'s own header for why that took a Rule 2
        // fix (`ItemDetailView` previously had no toolbar of its own at all).
        let lockNow = app.buttons["vault.lockNow"]
        XCTAssertTrue(lockNow.waitForExistence(timeout: 20), "the real Lock now affordance never appeared")
        lockNow.tap()

        // POSITIVE assertion: the lock surface's own element is present.
        let lockTitle = app.staticTexts["lock-title"]
        XCTAssertTrue(lockTitle.waitForExistence(timeout: 20), "the lock screen never appeared after locking")

        // Alongside the positive assertion above (QA-03): neither the list
        // nor the detail screen's own elements survive the lock.
        XCTAssertFalse(app.buttons["vault.create.plusMenu"].exists, "the list's create affordance must not survive a lock")
        XCTAssertFalse(app.staticTexts["vault.detail.field.body"].exists, "the detail screen must not survive a lock")

        // ---- Unlock, with the SAME account's real password ----
        let unlockPasswordField = app.secureTextFields["unlock-password-field"]
        XCTAssertTrue(unlockPasswordField.waitForExistence(timeout: 20), "the password field never appeared on the lock screen")
        unlockPasswordField.tap()
        unlockPasswordField.typeText(Self.password)
        app.buttons["lock-password-submit"].tap()

        // POSITIVE assertion: the list root's own element is present again.
        let plusMenuAfterUnlock = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenuAfterUnlock.waitForExistence(timeout: 20), "the list root never reappeared after unlocking")

        // The must-have this test exists to prove: unlocking returns to the
        // LIST ROOT, not to the item detail screen that was open when the
        // lock happened -- the navigation path was genuinely truncated, not
        // merely covered and restored.
        XCTAssertFalse(
            app.staticTexts["vault.detail.field.body"].exists,
            "unlocking must not return to the previously viewed detail screen"
        )

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "38-11-unlock-returns-to-list-root-not-detail"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Addendum A3: the Offline lock state (design's state 8), driven
    /// through the SAME `PV_UITEST_LOCK_STATE` hook the existing matrix
    /// uses, into a fresh evidence directory -- the gap
    /// `38-DESIGN-CONFORMANCE.md`/`ios/IOS-SPIKE-LOG.md` §3a both named as
    /// still open going into this plan.
    @MainActor
    func testOfflineLockStateRendersItsOwnMutedSlot() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = "offline"
        app.launch()

        let statusSlot = app.otherElements["lock-status-slot"]
        // `StatusCallout` may render as `.otherElements` or `.staticTexts`
        // depending on its internal composition -- matching this project's
        // own established discipline (`TotpCountdownUITests.swift`'s note on
        // `app.descendants(matching: .any)`) rather than assuming one.
        let statusSlotAny = app.descendants(matching: .any)["lock-status-slot"]
        XCTAssertTrue(
            statusSlot.waitForExistence(timeout: 10) || statusSlotAny.waitForExistence(timeout: 2),
            "the offline status slot never appeared"
        )

        // Unlock must still be OFFERED while offline (design's own text:
        // "the vault still opens, the server is just not reachable yet").
        XCTAssertTrue(app.buttons["lock-password-submit"].exists, "Unlock must remain offered while offline")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "38-11-lock-state-8-offline"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// `PV_UITEST_SCREEN=auth` forces `AuthView` regardless of any session
    /// currently persisted in the Keychain -- this file always registers a
    /// brand-new account, matching the L-20 discipline every other plan-38
    /// UI test file established (never a shared, persisted-session fixture
    /// once any live XCTest in the suite might have hijacked it).
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

        // The list root's own, always-present element -- never the
        // DEBUG-gated tracer create bar (`vault.create.marker`), which is
        // opt-in behind `PV_UITEST_TRACER_CREATE_BAR` and would time out
        // here silently.
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }
}
