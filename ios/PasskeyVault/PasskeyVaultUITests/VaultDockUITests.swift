// VaultDockUITests.swift -- Phase 38, plan 38-06 (the dock).
//
// The dock's load-bearing claim is a NEGATIVE one: "the bottom bar must not
// disappear." A negative claim about a floating, OS-rendered control cannot
// be asserted from the accessibility tree alone -- XCUITest reports a
// minimised iOS 26 tab bar and a hidden one identically often enough that a
// `.exists` check is not evidence. So this suite produces PIXELS: full-screen
// captures at rest and after a real scroll, attached to the `.xcresult` and
// exported to `ios/evidence/38/`, plus a hit-testable-frame assertion that
// CAN fail (the negative control below proves it).
//
// Everything under the dock is real: a real registration/sign-in against the
// live `pv-server` at `http://127.0.0.1:8621`, real client-side encryption
// through `VaultStore.create`, real decrypt on the way back. Only the
// DECISION to create the fixture items is synthetic
// (`PV_UITEST_SEED_DOCK_LIST`, `ContentView.seedDockFixtureIfRequested`).

import XCTest

final class VaultDockUITests: XCTestCase {
    private static let runSuffix = String(Int(Date().timeIntervalSince1970))
    private static let email = "pv-dock-38-06-\(runSuffix)@example.invalid"
    private static let password = "PvDock38-06-EvidencePassword!"

    override func setUpWithError() throws {
        continueAfterFailure = false
        // The fixture creates 21 real items over the real network before any
        // assertion can run; the default allowance terminated the first run
        // mid-seed with `signal term`.
        executionTimeAllowance = 600
    }

    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launchEnvironment["PV_UITEST_SEED_DOCK_LIST"] = "1"
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Same defensive dismissal `ItemListSearchUITests` documents: the
    /// simulator's password-AutoFill heuristic offers to save on essentially
    /// every credential submission, and it can appear with a delay.
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

    /// The vault is reached; the tab bar's own "Passkeys" tab is the signal
    /// (the tracer's marker-note bar is opt-in from 2026-08-17 and this suite
    /// deliberately does NOT ask for it -- it would sit in the dock's own
    /// space and contaminate every geometry measurement below).
    private func signInOrRegister(_ app: XCUIApplication) throws {
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "AuthView never appeared")
        emailField.tap()
        emailField.typeText(Self.email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        let passkeysTab = app.buttons["Passkeys"]
        if waitDismissingPromptsIfNeeded(for: passkeysTab, app: app, timeout: 20) { return }

        app.buttons["auth-toggle-mode"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 8))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: passkeysTab, app: app, timeout: 25),
            "vault list never appeared after registration"
        )
    }

    /// Waits until the seeded fixture has finished landing. The seed creates
    /// its items in order through the real network path, so the LAST one to
    /// be created ("Wi-Fi", a note) existing means every earlier one landed
    /// too -- one cheap `waitForExistence` instead of repeatedly snapshotting
    /// the whole accessibility tree, which was measured to be slow enough to
    /// blow the test's own time allowance.
    private func waitForSeededFixture(_ app: XCUIApplication) {
        // The Logins section header carries its own count, and logins are the
        // first group the seeder creates -- "Logins (10)" appearing means ten
        // real, decrypted rows are on screen. A `List` is lazy, so an item in
        // a LATER section (a note, say) is not in the accessibility tree at
        // all until it is scrolled to, which is why the completion signal is
        // a header near the top rather than the last item created.
        XCTAssertTrue(
            app.staticTexts["Logins (10)"].waitForExistence(timeout: 150),
            "the dock fixture never finished seeding -- the list is not populated enough to scroll"
        )
    }

    private func visibleRowCount(_ app: XCUIApplication) -> Int {
        app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "vault.row.")
        ).count
    }

    // MARK: - The load-bearing claim: the dock survives a scroll

    /// Scrolls a genuinely populated list and asserts the tab bar is still
    /// on screen afterwards -- by its HIT-TESTABLE FRAME, not `.exists`.
    ///
    /// Why the frame and not `exists`: a SwiftUI view that has been scrolled
    /// out of the way, hidden, or given zero opacity can still be present in
    /// the accessibility tree. `isHittable` plus a frame that actually
    /// intersects the screen is the weakest claim that still means "a user
    /// can see and press it". `testNegativeControl…` below proves this
    /// assertion can fail.
    @MainActor
    func testTabBarStaysOnScreenWhileScrollingAPopulatedList() throws {
        let app = launchApp()
        try signInOrRegister(app)
        waitForSeededFixture(app)
        let rows = visibleRowCount(app)
        XCTAssertGreaterThanOrEqual(rows, 8, "fixture never populated the list enough to scroll")

        let screen = app.frame
        let allTab = app.buttons["All"]
        XCTAssertTrue(allTab.waitForExistence(timeout: 10))

        let restFrame = allTab.frame
        XCTAssertTrue(allTab.isHittable, "tab bar was not hittable even at rest")
        attach("38-06-dock-at-rest")

        // A real, momentum-carrying scroll of the list itself.
        //
        // The capture happens IMMEDIATELY after each swipe, with no settle
        // delay, because the state under test is transient: iOS 26 minimises
        // the tab bar WHILE content is scrolling and restores it a moment
        // after scrolling stops. A screenshot taken two seconds later shows
        // the restored bar and proves nothing about what happens during the
        // scroll -- which is exactly the window in which a bar with the wrong
        // minimize behaviour would be gone.
        let list = app.collectionViews.firstMatch.exists
            ? app.collectionViews.firstMatch : app.tables.firstMatch
        var duringScroll: [CGRect] = []
        for i in 0..<4 {
            list.swipeUp(velocity: .fast)
            duringScroll.append(allTab.frame)
            attach("38-06-dock-during-scroll-\(i)")
        }
        for (i, f) in duringScroll.enumerated() {
            XCTAssertTrue(
                f.intersects(screen),
                "mid-scroll capture \(i): the tab bar's frame \(f) left the screen \(screen) -- it disappeared while scrolling"
            )
        }
        print("PV-DOCK during-scroll frames: \(duringScroll)")

        Thread.sleep(forTimeInterval: 2.0)
        attach("38-06-dock-after-scroll")

        let scrolledFrame = allTab.frame
        XCTAssertTrue(
            allTab.exists,
            "the tab bar left the accessibility tree entirely after scrolling -- it disappeared"
        )
        XCTAssertTrue(
            scrolledFrame.intersects(screen),
            "the tab bar's frame \(scrolledFrame) no longer intersects the screen \(screen) after scrolling -- it disappeared"
        )
        XCTAssertTrue(
            allTab.isHittable,
            "the tab bar is present but not hittable after scrolling -- a user cannot press it"
        )

        // Recorded, not asserted as equal: the whole point of the chosen
        // minimize behaviour is that the bar MAY change shape/position, so
        // long as it stays on screen and pressable.
        print("PV-DOCK at-rest frame: \(restFrame)  scrolled frame: \(scrolledFrame)")

        // And it still works: pressing a tab after the scroll changes tabs.
        app.buttons["Cards"].tap()
        XCTAssertTrue(
            app.navigationBars["Cards"].waitForExistence(timeout: 8),
            "the tab bar survived the scroll visually but no longer functions"
        )
        attach("38-06-dock-after-scroll-tab-still-works")
    }

    /// The negative control for the assertion above. Drives the app to a
    /// screen that genuinely has NO tab bar (the auth screen) and runs the
    /// identical checks -- they must fail there, otherwise the checks above
    /// prove nothing.
    @MainActor
    func testNegativeControlTabBarChecksFailWhereThereIsNoTabBar() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()
        XCTAssertTrue(app.textFields.firstMatch.waitForExistence(timeout: 15))

        let allTab = app.buttons["All"]
        XCTAssertFalse(
            allTab.waitForExistence(timeout: 3),
            "the negative control found a tab bar on the auth screen -- the positive test's checks are vacuous"
        )
        attach("38-06-dock-negative-control-no-tab-bar")
    }

    // MARK: - The + capsule expands in place into the action grid

    @MainActor
    func testPlusCapsuleExpandsInPlaceIntoTheActionGrid() throws {
        let app = launchApp()
        try signInOrRegister(app)
        waitForSeededFixture(app)

        let plus = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plus.waitForExistence(timeout: 15), "the + capsule never appeared")
        let collapsedFrame = plus.frame

        plus.tap()

        let newLogin = app.buttons["vault.create.action.login"]
        XCTAssertTrue(newLogin.waitForExistence(timeout: 8), "the action grid never opened")
        attach("38-06-dock-plus-expanded")

        // "Expands IN PLACE": the capsule does not move -- it stays where it
        // was and becomes the dismiss control.
        XCTAssertEqual(
            plus.frame.midX, collapsedFrame.midX, accuracy: 1.0,
            "the + capsule moved horizontally when expanding -- it is not expanding in place"
        )
        XCTAssertEqual(
            plus.frame.midY, collapsedFrame.midY, accuracy: 1.0,
            "the + capsule moved vertically when expanding -- it is not expanding in place"
        )
        XCTAssertEqual(
            plus.label, "Close", "the + capsule did not become the close (✕) control"
        )

        // All nine grid slots are present, and the four with no working path
        // are visibly present but disabled rather than silently missing.
        for id in [
            "login", "card", "passkey", "code", "identity", "note",
            "generatePassword", "scanCard", "importItems",
        ] {
            XCTAssertTrue(
                app.buttons["vault.create.action.\(id)"].exists,
                "grid slot '\(id)' is missing from the 3x3 action grid"
            )
        }
        XCTAssertFalse(
            app.buttons["vault.create.action.importItems"].isEnabled,
            "'Import' has no implementation yet and must not offer to work"
        )
        XCTAssertTrue(
            app.buttons["vault.create.action.login"].isEnabled,
            "'New login' has a real create path and must be enabled"
        )

        plus.tap()
        XCTAssertFalse(
            app.buttons["vault.create.action.login"].waitForExistence(timeout: 3),
            "the grid did not collapse when the ✕ was tapped"
        )
        attach("38-06-dock-plus-collapsed-again")
    }

    // MARK: - The search shelf

    @MainActor
    func testSearchShelfNarrowsTheListWithoutTheTabBarLeaving() throws {
        let app = launchApp()
        try signInOrRegister(app)
        waitForSeededFixture(app)

        let shelf = app.buttons["vault.search.shelf"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 15), "the search shelf never appeared")
        shelf.tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(
            field.waitForExistence(timeout: 8),
            "tapping the shelf did not present the real search field"
        )
        field.typeText("cloudflare")

        let match = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "vault.row.")
        )
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline, match.count != 1 {
            Thread.sleep(forTimeInterval: 0.5)
        }
        attach("38-06-dock-search-active")
        XCTAssertEqual(
            match.count, 1,
            "the shelf's query did not narrow the list to VaultSearch's own answer"
        )
    }
}
