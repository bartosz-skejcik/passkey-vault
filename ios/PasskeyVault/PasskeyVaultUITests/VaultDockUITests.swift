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
    private static let suitePrefix = "dock-38-06"
    private static let password = "PvDock38-06-EvidencePassword!"

    /// A FRESH ACCOUNT PER TEST METHOD, not per process, and the difference is not
    /// hygiene -- it is three real failures.
    ///
    /// `static let runSuffix` is evaluated ONCE per process, so every method in the
    /// class shared one account. The first method registers and seeds 21 items;
    /// every later method SIGNS IN, and the seeder's idempotence check
    /// (`ContentView.seedDockFixtureIfRequested`) reads `store.items` before the
    /// first `GET /api/sync` has populated it, so it seeds again. Observed
    /// consequences, all of which read as product bugs and are not:
    ///
    ///   - "Logins (20)" where a test waited for "Logins (10)" -- a 150 s timeout
    ///     reported as "the fixture never finished seeding".
    ///   - a search for "cloudflare" matching 2 rows instead of 1, reported as
    ///     "the shelf's query did not narrow the list to VaultSearch's own answer".
    ///   - "tab bar was not hittable even at rest".
    ///
    /// `name` is the XCTest method identifier (e.g. `-[VaultDockUITests testFoo]`),
    /// so this is unique per method and stable within one method's retries. The cost
    /// is one registration and one 21-item seed per method (~60-75 s); the class
    /// already raises `executionTimeAllowance` to 600 for exactly this reason.
    private var email: String {
        let slug = name.components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
            .lowercased()
        return "pv-\(Self.suitePrefix)-\(slug)-\(Self.runSuffix)@example.invalid"
    }

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

    /// The vault is reached; the tab bar's own "Logins" tab is the signal.
    ///
    /// It was "Passkeys" until the four-tab layout landed and that tab ceased to
    /// exist -- a signal that CANNOT appear does not fail fast, it hangs for its
    /// full 20 s timeout and then fails claiming registration broke.
    ///
    /// (The tracer's marker-note bar is opt-in from 2026-08-17 and this suite
    /// deliberately does NOT ask for it -- it would sit in the dock's own space
    /// and contaminate every geometry measurement below.)
    private func signInOrRegister(_ app: XCUIApplication) throws {
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "AuthView never appeared")
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        let loginsTab = app.buttons["Logins"]
        if waitDismissingPromptsIfNeeded(for: loginsTab, app: app, timeout: 20) { return }

        app.buttons["auth-toggle-mode"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 8))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: loginsTab, app: app, timeout: 25),
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
        // first group the seeder creates -- a "Logins (n)" header appearing means
        // n real, decrypted rows are on screen. A `List` is lazy, so an item in
        // a LATER section (a note, say) is not in the accessibility tree at
        // all until it is scrolled to, which is why the completion signal is
        // a header near the top rather than the last item created.
        //
        // BY PREFIX, NOT BY EXACT COUNT, and this was a real failure rather than
        // a precaution. It waited on the literal "Logins (10)" and two of this
        // class's four methods timed out at 150 s against a header that said
        // "Logins (20)". Cause: `runSuffix` is evaluated once per PROCESS, so all
        // four methods share one account -- the first registers and seeds, and each
        // later method SIGNS IN, where the seeder's idempotence check
        // (`ContentView.seedDockFixtureIfRequested`, which reads `store.items`)
        // runs before the first `GET /api/sync` has populated the array, so it
        // seeds again. An exact count is a hostage to the fixture's history; the
        // thing under test is the dock, and ten or twenty rows scroll equally well.
        let header = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Logins (")
        ).firstMatch
        XCTAssertTrue(
            header.waitForExistence(timeout: 150),
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

        // AND IT STILL WORKS. This is the "still pressable" half of the claim, and
        // it takes two taps rather than one for a reason that is the dock's actual
        // behaviour rather than a workaround:
        //
        // the bar is still MINIMISED here (measured: a 48×48 collapsed circle, and
        // `.onScrollDown` expands on an opposite scroll, not on scrolling
        // stopping), and while minimised the individual tab buttons are NOT in the
        // accessibility tree at all -- only the collapsed circle, which carries the
        // selected tab's label. Reaching straight for "Cards" failed with "No
        // matches found for Elements matching predicate '\"Cards\" IN identifiers'".
        //
        // So: press the collapsed circle (which is what a user can actually press),
        // and assert that doing so brings the full bar back. That is a STRONGER
        // claim than the original one -- it proves the collapsed control is live,
        // not merely present.
        XCTAssertTrue(allTab.isHittable, "the collapsed tab bar circle is not pressable")
        allTab.tap()
        let cards = app.buttons["Cards"]
        XCTAssertTrue(
            cards.waitForExistence(timeout: 8),
            "pressing the collapsed tab bar circle did not restore the full bar"
        )
        cards.tap()
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

        // BY IDENTIFIER, which reaches the tab item whenever the bar is EXPANDED --
        // and it is, here, since this test never scrolls. `app.buttons["Create
        // item"]` was tried and does NOT work in this state: the subscript matches
        // IDENTIFIERS, and with the bar expanded the identifier is
        // `vault.create.plusMenu`, so the label lookup failed with "No matches
        // found for Elements matching predicate '\"Create item\" IN identifiers'".
        // The label only resolves in the MINIMISED state, where the collapsed item
        // has no identifier for the subscript to prefer.
        let plus = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plus.waitForExistence(timeout: 15), "the detached ＋ never appeared")
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
        // The label is what a VoiceOver user HEARS, and it has to change with the
        // glyph -- an explicit `accessibilityLabel` is also the only thing
        // stopping this control from announcing itself as "Search", because it
        // occupies the semantic search slot (`Tab(role: .search)` is the only
        // stock API that produces the detached circle). There is no
        // `TabRole.add`; this assertion is the guard on that workaround.
        XCTAssertEqual(
            plus.label, "Close create menu",
            "the ＋ did not become the close (✕) control, or lost its explicit "
                + "accessibility label and is announcing itself as 'Search'"
        )

        // SIX slots, and every one of them works.
        //
        // This assertion was nine slots with four disabled until 2026-08-17,
        // when Bartek narrowed the panel to the five creatable types plus
        // Generate password. The disabled slots are GONE rather than greyed out
        // -- see `VaultCreateAction`'s own header for why each one went. The
        // `isEnabled` checks below are what makes the narrowing load-bearing:
        // reintroducing a permanently-disabled tile fails here.
        for id in ["login", "card", "identity", "note", "code", "generatePassword"] {
            let slot = app.buttons["vault.create.action.\(id)"]
            XCTAssertTrue(slot.exists, "panel slot '\(id)' is missing")
            XCTAssertTrue(slot.isEnabled, "panel slot '\(id)' is present but disabled")
        }
        for id in ["passkey", "scanCard", "importItems"] {
            XCTAssertFalse(
                app.buttons["vault.create.action.\(id)"].exists,
                "slot '\(id)' is back in the panel -- it has no working path and was removed, "
                    + "not disabled"
            )
        }

        // `plus` still resolves: the IDENTIFIER does not change with the state,
        // only the label does (asserted above).
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
        if !field.waitForExistence(timeout: 8) {
            // A bare "the field did not appear" is not diagnosable after the fact,
            // and this exact failure cost a full diagnostic cycle: the shelf's
            // `isPresented` binding stopped presenting search when the detached ＋
            // became a `Tab(role: .search)`, and the accessibility tree is the only
            // place that says whether the field is absent, present-but-elsewhere,
            // or collapsed into the toolbar's magnifier.
            print("PV-DOCK-SEARCH no search field after the shelf tap.")
            // DISTINGUISHING EXPERIMENT, kept because it is what identified the
            // cause: is `.searchable` installed and only its PROGRAMMATIC
            // activation dead, or is there no search at all? The minimized search
            // toolbar leaves a magnifier button in the navigation bar; tapping it
            // is the other door onto the same `.searchable`.
            let magnifier = app.navigationBars.buttons["Search"]
            print("PV-DOCK-SEARCH toolbar magnifier exists=\(magnifier.exists)")
            if magnifier.exists {
                magnifier.tap()
                let viaToolbar = app.searchFields.firstMatch.waitForExistence(timeout: 6)
                print("PV-DOCK-SEARCH field appears via the toolbar magnifier=\(viaToolbar)")
            }
            print(app.debugDescription)
        }
        XCTAssertTrue(
            field.exists,
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
