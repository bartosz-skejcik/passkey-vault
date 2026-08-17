// DockOptionsExplorationUITests.swift -- THROWAWAY (Phase 38, 2026-08-17).
//
// This suite asserts almost nothing. Its job is to DRIVE the app into three
// states per dock layout option and hold each one still long enough for an
// external `xcrun simctl io screenshot` loop to catch it. Bartek is choosing
// between four dock layouts from pictures; this is the rig that makes the
// pictures.
//
// WHY AN EXTERNAL CAPTURE LOOP AND NOT `XCTAttachment`. The state that matters
// most -- the tab bar MINIMISED mid-scroll -- is transient. iOS 26 minimises
// the bar while content is scrolling and RESTORES it a moment after scrolling
// settles (found the hard way in plan 38-06; a scroll-then-screenshot captured
// the restored bar every time and looked like nothing had happened). XCTest's
// gesture APIs are synchronous, so a screenshot taken on the test thread can
// only ever land AFTER the gesture completed and the bar came back.
//
// The fix is `press(forDuration:thenDragTo:withVelocity:thenHoldForDuration:)`:
// it drags and then LEAVES THE FINGER DOWN. The scroll view stays in its
// dragging state for the whole hold, so the bar stays minimised and the frame
// is static -- long enough for an out-of-process capture to grab it, and static
// enough that consecutive captures are byte-identical, which is what lets the
// harness find the window automatically instead of by timing luck.
//
// Each phase below therefore ends in a DELIBERATE STILLNESS. The stillness is
// the signal. Do not "tidy up" the sleeps.

import XCTest

final class DockOptionsExplorationUITests: XCTestCase {
    // A FRESH account per invocation, deliberately, even though it costs a
    // re-registration and a re-seed of 21 real items each time (~75 s).
    //
    // A shared fixed account was tried first and is WRONG: the seeder's
    // idempotence check reads `store.items`, and on a sign-in that check runs
    // before the first `GET /api/sync` has populated the array, so it re-seeds
    // and the account accumulates 21 more items per run. The visible symptom was
    // a "Logins (20)" header where the test waited for "Logins (10)". Worse for
    // this task specifically: the four screenshots Bartek compares would carry
    // DIFFERENT list contents, so a difference between two options could be the
    // fixture rather than the layout. Fresh account per run = identical rows
    // under all four docks.
    private static let runSuffix = String(Int(Date().timeIntervalSince1970))
    private static let email = "pv-dock-opt-\(runSuffix)@example.invalid"
    private static let password = "PvDockOptions38-ExplorePassword!"

    /// Held still at rest before the scroll.
    private static let restHold: TimeInterval = 7
    /// Finger-down hold after the drag -- the minimised window.
    private static let minimizedHold: TimeInterval = 12
    /// Held still with the ＋ grid open.
    private static let expandedHold: TimeInterval = 9

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = 600
    }

    // MARK: - The four options

    @MainActor func testCaptureOptionA() throws { try capture(option: "A") }
    @MainActor func testCaptureOptionB() throws { try capture(option: "B") }
    @MainActor func testCaptureOptionC() throws { try capture(option: "C") }
    @MainActor func testCaptureOptionD() throws { try capture(option: "D") }

    // MARK: - The rig

    @MainActor
    private func capture(option: String) throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launchEnvironment["PV_UITEST_SEED_DOCK_LIST"] = "1"
        app.launchEnvironment["PV_UITEST_DOCK_OPTION"] = option
        app.launch()

        try signInOrRegister(app)
        waitForSeededFixture(app)

        // Record what the bar actually CONTAINS, so the overflow question is
        // answered by the accessibility tree as well as by the pixels.
        let tabLabels = ["All", "Logins", "Cards", "Codes", "Passkeys", "More", "Add item"]
            .filter { app.buttons[$0].exists }
        print("PV-DOCK-OPTION \(option): tab-bar buttons present = \(tabLabels)")

        // ---- PHASE 1: at rest ----------------------------------------------
        Thread.sleep(forTimeInterval: Self.restHold)

        // ---- PHASE 2: minimised, finger still down -------------------------
        // Swipe UP (content scrolls DOWN) -- that is the direction
        // `.tabBarMinimizeBehavior(.onScrollDown)` keys off.
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
        start.press(
            // A SHORT initial press on purpose: the rows carry context menus,
            // and a long press before the drag would open one instead.
            forDuration: 0.05,
            thenDragTo: end,
            withVelocity: .default,
            thenHoldForDuration: Self.minimizedHold
        )

        // ---- restore the bar before phase 3 --------------------------------
        // FINDING, and it corrects plan 38-06's note that "the bar restores
        // once scrolling settles": it does NOT. Nine seconds after the finger
        // lifted, the bar was still minimised (`frames/A/0048.png`). That is
        // `.onScrollDown`'s documented contract read properly -- "minimizes
        // when scrolling down, and expands when scrolling back up" -- so the
        // restore trigger is a scroll in the OPPOSITE direction, not the mere
        // absence of scrolling. It also explains why `app.buttons["More"]`
        // came back non-existent here on the first attempt: while minimised
        // the individual tab buttons are not in the accessibility tree at all,
        // only the collapsed circle. So: scroll back up, THEN reach for ＋.
        let restoreEnd = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
        end.press(
            forDuration: 0.05,
            thenDragTo: restoreEnd,
            withVelocity: .default,
            thenHoldForDuration: 0.05
        )
        // Deliberately shorter than any phase hold, so the harness's
        // "longest still runs" detection cannot mistake it for a phase.
        Thread.sleep(forTimeInterval: 2)

        // ---- PHASE 3: the ＋ grid open --------------------------------------
        if let plus = plusControl(app) {
            plus.tap()
        } else if app.buttons["More"].exists {
            // Option A's expected outcome, and the third picture is worth more
            // than a log line: open the overflow so Bartek can SEE what got
            // swallowed. "the ＋ is missing" and "the ＋ is one tap deeper
            // inside More" are very different costs, and only the pixels say
            // which one happened.
            print("PV-DOCK-OPTION \(option): NO ＋ in the bar -- opening More to show where it went")
            app.buttons["More"].tap()
        } else {
            print("PV-DOCK-OPTION \(option): NO ＋ control and NO More tab -- nothing to expand")
        }
        Thread.sleep(forTimeInterval: Self.expandedHold)

        app.terminate()
    }

    /// The ＋ answers to a different name in each layout: options A/B/C give it
    /// a `Tab(role: .search)` whose label is "Add item"/"Close", option D keeps
    /// the accessory-shelf button with its own identifier.
    private func plusControl(_ app: XCUIApplication) -> XCUIElement? {
        for name in ["vault.create.plusMenu", "Add item", "Create"] {
            let candidate = app.buttons[name]
            if candidate.exists && candidate.isHittable { return candidate }
        }
        return nil
    }

    // MARK: - Getting to the vault (lifted from VaultDockUITests)

    /// The simulator's password-AutoFill heuristic offers to save on nearly
    /// every credential submission, and can appear with a delay.
    @discardableResult
    private func waitDismissingPromptsIfNeeded(
        for target: XCUIElement, app: XCUIApplication, timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if target.exists { return true }
            let notNow = app.buttons["Not Now"]
            if notNow.exists { notNow.tap() }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return target.exists
    }

    /// "Logins" is the arrival signal, NOT "Passkeys": option B has no Passkeys
    /// tab at all, and a signal that only exists in three of four layouts would
    /// hang the fourth for its full timeout before failing for the wrong reason.
    private func signInOrRegister(_ app: XCUIApplication) throws {
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "AuthView never appeared")
        emailField.tap()
        emailField.typeText(Self.email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        let arrived = app.buttons["Logins"]
        if waitDismissingPromptsIfNeeded(for: arrived, app: app, timeout: 20) { return }

        app.buttons["auth-toggle-mode"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 8))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: arrived, app: app, timeout: 25),
            "vault list never appeared after registration"
        )
    }

    /// Waits on the Logins section header by PREFIX, not by exact count: an
    /// exact "Logins (10)" is a hostage to how many items the account already
    /// holds, and that is a property of the fixture's history, not of the thing
    /// under observation.
    private func waitForSeededFixture(_ app: XCUIApplication) {
        let header = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Logins (")
        ).firstMatch
        XCTAssertTrue(
            header.waitForExistence(timeout: 180),
            "the dock fixture never finished seeding -- the list is not long enough to scroll"
        )
    }
}
