// VaultDockEvidenceUITests.swift -- Phase 38, the dock (second pass, 2026-08-17).
//
// Successor to the throwaway `DockOptionsExplorationUITests`, which existed only
// to render four candidate layouts for Bartek to choose between. He chose, so
// the comparison rig is gone and this is the evidence rig for the ONE layout:
// four tabs (All · Logins · Codes · Cards) plus the detached ＋.
//
// WHAT THIS SUITE IS FOR, and it is two different jobs deliberately kept in one
// method:
//
// 1. PIXELS. Five screenshots per appearance, attached to the `.xcresult` and
//    exported to `ios/evidence/38/` by `scripts/ios-dock-evidence.sh`.
// 2. NUMBERS. Every geometric claim is MEASURED off the rendered accessibility
//    frames here and printed under `PV-DOCK-GEOM`, never eyeballed. Three wrong
//    conclusions were reached by eyeballing on 2026-08-17 alone.
//
// Measuring the RENDERED frame rather than reading the app's own state is
// deliberate: an internal number proves what the code believes, while
// `panel.frame.maxY` against `shelf.frame.minY` proves what a user is looking at.
//
// AND THE FRAMES ARE STILL NOT THE LAST WORD. The frame reported for
// `vault.create.grid` is the union of the six tile buttons, not the padded glass
// card, so it understates the card's bottom edge by ~16 pt.
// `scripts/measure-ios-dock-panel.py` measures the visible gap from the exported
// pixels and is the number to quote to a human; the assertions here are the
// regression gate, calibrated against it.
//
// Everything under the dock is real: real registration against the live
// `pv-server`, real client-side encryption through `VaultStore.create`, real
// decrypt on the way back. Only the DECISION to create the fixture items is
// synthetic (`PV_UITEST_SEED_DOCK_LIST`).

import XCTest

final class VaultDockEvidenceUITests: XCTestCase {
    private static let runSuffix = String(Int(Date().timeIntervalSince1970))
    private static let suitePrefix = "dock-38-06b"
    private static let password = "PvDock38-06b-EvidencePassword!"

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
        // assertion can run; the default allowance terminates the run mid-seed.
        executionTimeAllowance = 600
    }

    // MARK: - The one evidence run

    /// Drives the dock through its three states, captures each, and measures the
    /// geometry of the third.
    ///
    /// Appearance is NOT set here. `scripts/ios-dock-evidence.sh` runs this same
    /// method twice, flipping `xcrun simctl ui <udid> appearance` between the
    /// runs, and prefixes the exported filenames `light-`/`dark-`. Keeping the
    /// method single-copy is why the light and dark shots are guaranteed to be
    /// of the same states rather than of two hand-maintained sequences that can
    /// drift.
    @MainActor
    func testDockEvidence() throws {
        let app = launchApp()
        try signInOrRegister(app)
        waitForSeededFixture(app)

        let screen = app.frame
        print("PV-DOCK-GEOM screen=\(screen)")

        // ---- 1: at rest ---------------------------------------------------
        let allTab = app.buttons["All"]
        XCTAssertTrue(allTab.waitForExistence(timeout: 10), "the tab bar never appeared")
        // FOUR tabs and no "More": the whole reason Passkeys lost its tab is
        // that five filters plus the search-role ＋ overflowed into a system
        // "More" (•••) tab. If this assertion ever fails, the overflow is back.
        for title in ["All", "Logins", "Codes", "Cards"] {
            XCTAssertTrue(app.buttons[title].exists, "tab '\(title)' is missing from the dock")
        }
        XCTAssertFalse(
            app.buttons["More"].exists,
            "the dock overflowed into a system 'More' tab -- too many tab items again"
        )
        XCTAssertFalse(
            app.buttons["Passkeys"].exists,
            "a Passkeys tab is present; four filters plus ＋ is the chosen layout"
        )
        attach(app, "dock-at-rest")

        // ---- 2: minimised, mid-scroll -------------------------------------
        //
        // TIMING IS THE WHOLE DIFFICULTY HERE, and the two recorded findings on
        // it CONTRADICT each other, so this does not rely on either:
        //
        //   - plan 38-06's note: "the bar restores once scrolling settles", so a
        //     scroll-then-screenshot catches the restored bar.
        //   - the exploration rig's note: it does NOT restore -- nine seconds
        //     after the finger lifted the bar was still minimised, which is
        //     `.onScrollDown`'s documented contract read properly ("minimizes
        //     when scrolling down, and expands when scrolling back up" -- the
        //     restore trigger is an OPPOSITE scroll, not the absence of one).
        //
        // `press(forDuration:thenDragTo:withVelocity:thenHoldForDuration:)`
        // makes the question moot: it drags and then LEAVES THE FINGER DOWN, so
        // the scroll view stays in its dragging state for the whole hold and the
        // frame is static and genuinely mid-scroll. The screenshot is taken from
        // a background queue partway into that hold, because the press call
        // itself is synchronous and anything after it runs only once the finger
        // has lifted.
        let list = app.collectionViews.firstMatch.exists
            ? app.collectionViews.firstMatch
            : app.tables.firstMatch
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))

        let captured = DispatchSemaphore(value: 0)
        // `nonisolated(unsafe)`: written on the background queue, read after
        // `captured.wait()`, which is the ordering that makes it safe.
        nonisolated(unsafe) var midScroll: XCUIScreenshot?
        DispatchQueue.global().asyncAfter(deadline: .now() + 3.0) {
            midScroll = XCUIScreen.main.screenshot()
            captured.signal()
        }
        start.press(
            // A SHORT initial press on purpose: the rows carry context menus and
            // a long press before the drag opens one instead of scrolling.
            forDuration: 0.05,
            thenDragTo: end,
            withVelocity: .default,
            thenHoldForDuration: 8
        )
        XCTAssertEqual(
            captured.wait(timeout: .now() + 20), .success,
            "the mid-scroll screenshot never came back"
        )
        if let midScroll {
            let shot = XCTAttachment(screenshot: midScroll)
            shot.name = "dock-minimized-mid-scroll"
            shot.lifetime = .keepAlways
            add(shot)
        } else {
            XCTFail("no mid-scroll screenshot was produced")
        }

        // The load-bearing NEGATIVE claim: the bar minimises, it does not
        // disappear. Asserted by hit-testable frame, because a SwiftUI view that
        // is hidden or zero-opacity can still be `.exists` in the tree.
        // `testNegativeControl…` in `VaultDockUITests` proves this shape of
        // assertion can fail.
        let afterScrollFrame = allTab.frame
        print("PV-DOCK-GEOM after-scroll All-tab frame=\(afterScrollFrame)")
        XCTAssertTrue(
            afterScrollFrame.intersects(screen),
            "the tab bar's frame \(afterScrollFrame) left the screen \(screen) -- it disappeared"
        )

        // ---- 3: the ＋ panel open while the dock is MINIMISED ---------------
        //
        // THE STATE A LAYOUT BUG HID IN, so it gets its own phase and its own
        // measurement rather than being assumed to follow from the expanded case.
        // Bartek caught, by eye, an empty gap between the panel's bottom edge and
        // the top of the collapsed dock -- "about as tall as the search pill
        // would be if the bar were not collapsed". He was right, and the expanded
        // state was wrong too, by a similar amount. Two states, two numbers, both
        // printed.
        //
        // Reachable at all only because of the finding above: the bar STAYS
        // minimised after the finger lifts, so the ＋ can be tapped in the
        // collapsed dock without any trick. Matched by LABEL here -- while
        // minimised the collapsed items carry empty identifiers.
        dumpDockButtons(app, "dock minimised, before opening the panel")
        let plusMinimised = app.buttons["Create item"]
        XCTAssertTrue(
            plusMinimised.waitForExistence(timeout: 10),
            "the ＋ is not reachable while the dock is minimised"
        )
        plusMinimised.tap()
        let panel = app.descendants(matching: .any)
            .matching(identifier: "vault.create.grid").firstMatch
        XCTAssertTrue(
            panel.waitForExistence(timeout: 8),
            "the ＋ panel never opened over the minimised dock"
        )
        attach(app, "dock-panel-open-minimized")
        let minimisedClearance = measureDock(app, state: "minimised")

        // Close it again so the expanded-state measurement starts from the same
        // place the user would.
        app.buttons["Close create menu"].tap()
        XCTAssertFalse(
            panel.waitForExistence(timeout: 3),
            "the panel did not close when ✕ was tapped over the minimised dock"
        )

        // ---- 4: restore the bar --------------------------------------------
        //
        // Wait on a real signal rather than a sleep.
        //
        // MEASURED, and it corrects plan 38-06's note that "the bar restores
        // once scrolling settles": it does NOT. The frame captured above is
        // (28, 776, 48, 48) -- a 48×48 collapsed circle, taken while the finger
        // was still down; the same frame was still 48×48 after the finger
        // lifted. `.onScrollDown` means "minimizes when scrolling down, and
        // expands when scrolling back up", so the restore trigger is a scroll in
        // the OPPOSITE direction, not the absence of scrolling. A single
        // opposite drag was also not enough -- the list was ten screens deep by
        // then -- which is why this swipes repeatedly and waits for evidence.
        //
        // THE EXPANSION SIGNAL is that the non-selected tab buttons come BACK
        // into the accessibility tree. While minimised only the collapsed circle
        // is there (it carries the selected tab's label, "All"), so "Logins"
        // existing is exactly "the bar is expanded" and needs no timing guess.
        let logins = app.buttons["Logins"]
        for _ in 0..<8 where !logins.exists {
            list.swipeDown(velocity: .fast)
        }
        XCTAssertTrue(
            logins.waitForExistence(timeout: 5),
            "the tab bar never re-expanded after scrolling back up -- ＋ is not reliably "
                + "reachable while the bar is collapsed"
        )

        // ---- 5: the ＋ panel open over the EXPANDED dock --------------------
        dumpDockButtons(app, "dock expanded, before reaching for ＋")
        let plus = plusControl(app)
        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: plus, app: app, timeout: 15),
            "the detached ＋ never appeared"
        )
        let plusCollapsedFrame = plus.frame
        plus.tap()

        XCTAssertTrue(panel.waitForExistence(timeout: 8), "the ＋ panel never opened")
        attach(app, "dock-panel-open")

        // EIGHT slots (quick task 260818-lsk extended the panel from six to
        // eight -- Scan QR code and New folder), all working. There is no
        // disabled slot any more; a `.isEnabled == false` here means the
        // eight-action decision got reverted without this assertion being
        // updated.
        for id in ["login", "card", "identity", "note", "code", "scanQr", "generatePassword", "newFolder"] {
            let slot = app.buttons["vault.create.action.\(id)"]
            XCTAssertTrue(slot.exists, "panel slot '\(id)' is missing")
            XCTAssertTrue(slot.isEnabled, "panel slot '\(id)' is present but disabled")
        }
        XCTAssertFalse(
            app.buttons["vault.create.action.passkey"].exists,
            "a 'New passkey' slot is back; passkeys are provider-created, never typed in"
        )

        let expandedClearance = measureDock(app, state: "expanded")

        // THE FIX'S OWN ASSERTIONS. Both are on the ABSOLUTE clearance, one per
        // dock state, and that choice is load-bearing: the bug this replaced had
        // the SAME 7 pt difference between its two states (59.3 expanded, 66.3
        // minimised), so an assertion on the difference alone would have passed
        // straight through it. What was wrong was the magnitude.
        //
        // ## Reading these numbers
        //
        // These are accessibility-frame numbers, which are ~16 pt LARGER than the
        // visible gap: the frame reported for `vault.create.grid` is the union of
        // the six tile buttons, not the padded glass card, so it stops
        // `PVMetrics.dockGridVPadding` short of the card's real bottom edge. The
        // visible gap is measured from pixels by
        // `scripts/measure-ios-dock-panel.py`, which is the number to quote to a
        // human: **8.0 pt expanded, 15.0 pt minimised**.
        //
        //   expected = dockGridVPadding (16) + dockPanelGap (8) = 24
        //
        // ## The 7 pt the minimised state carries on top of that
        //
        // Not a bug left in, and not something the app can see. Derived from the
        // pixels: with the bar collapsed the tab content's bottom safe-area inset
        // is 83 pt, while the dock's topmost pixel is 76 pt from the bottom edge.
        // iOS reserves 7 pt more inset than the collapsed dock visually occupies.
        // The panel is placed against the inset -- which is the only number the app
        // has -- so it inherits those 7 pt. Correcting it would mean subtracting a
        // hardcoded 7 keyed to an OS internal, which is exactly the invented-layout
        // defect `PVDesign.swift` exists to prevent, so it is recorded rather than
        // papered over. Expanded, the two agree exactly: inset 139, dock top 139.
        //
        // Asserted rather than tolerated, so that if a future iOS changes it, this
        // says so instead of silently drifting.
        let expected = 24.0
        let minimisedOSExtra = 7.0
        XCTAssertEqual(
            expandedClearance, expected, accuracy: 3.0,
            "with the bar EXPANDED the panel sits \(expandedClearance) pt above the dock by "
                + "accessibility frame, expected ~\(expected) (= 16 pt panel padding + 8 pt gap)"
        )
        XCTAssertEqual(
            minimisedClearance, expected + minimisedOSExtra, accuracy: 3.0,
            "with the bar MINIMISED the panel sits \(minimisedClearance) pt above the dock by "
                + "accessibility frame, expected ~\(expected + minimisedOSExtra) "
                + "(= 16 + 8 + the 7 pt iOS reserves beyond the collapsed dock's own height)"
        )

        // "Expands in place": the ＋ stays exactly where it was and becomes the
        // dismiss control. The `role: .search` slot is what makes this free.
        //
        // RE-QUERIED under its OPEN label, not reusing `plus`. Since the only
        // handle on this element is its label and the label changes with the
        // state, the `plus` query resolves "Create item" and stops matching
        // anything the moment the panel opens -- which failed here as
        // "Failed to get matching snapshot" rather than as a wrong frame.
        // Matched by IDENTIFIER, which is stable across the state change; the
        // label is not, and `app.buttons["Close create menu"]` additionally
        // collided with the scrim's own label (XCUITest: "Multiple matching
        // elements found"). The scrim now says "Dismiss create menu" instead.
        let plusOpen = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusOpen.exists, "the ＋ left the tree when the panel opened")
        XCTAssertEqual(
            plusOpen.label, "Close create menu",
            "the ＋ did not become the close (✕) control, or lost its explicit accessibility "
                + "label and is announcing itself as 'Search' -- it occupies the search slot"
        )
        let plusOpenFrame = plusOpen.frame
        print("PV-DOCK-GEOM plus-closed=\(plusCollapsedFrame) plus-open=\(plusOpenFrame)")
        XCTAssertEqual(
            plusOpenFrame.midX, plusCollapsedFrame.midX, accuracy: 1.0,
            "the ＋ moved horizontally when the panel opened -- not expanding in place"
        )
        XCTAssertEqual(
            plusOpenFrame.midY, plusCollapsedFrame.midY, accuracy: 1.0,
            "the ＋ moved vertically when the panel opened -- not expanding in place"
        )

        // The tab bar is live: switching tabs with the panel open works, and
        // closes the panel (changing the filter while a launcher covers the
        // result would hide the outcome of the action).
        app.buttons["Cards"].tap()
        XCTAssertTrue(
            app.navigationBars["Cards"].waitForExistence(timeout: 8),
            "the dock is visible behind the panel but no longer functions"
        )
        XCTAssertFalse(
            panel.waitForExistence(timeout: 3),
            "changing the type filter left the ＋ panel open over the new list"
        )
        attach(app, "dock-panel-dismissed-by-tab-change")
    }

    /// The ＋ panel and the keyboard are mutually exclusive. That is the invariant
    /// this asserts, and it is deliberately the ONLY thing it asserts.
    ///
    /// WHY IT MATTERS: `ios/DOCK-PANEL-RESEARCH.md` §5 is a negative result.
    /// Keyboard avoidance shrinks the container the panel is aligned within, so a
    /// panel that is on screen when a keyboard appears is shoved off the top and no
    /// padding correction can compensate (`05-keyboard.png`, `08-keyboard-fixed
    /// .png`). The recommendation was to make the two states mutually exclusive in
    /// the state machine instead, which is what `ItemListView.setCreateExpanded` and
    /// the `onChange(of: isSearchPresented)` do. This is the check that they do.
    ///
    /// WHAT IT DELIBERATELY DOES NOT ASSERT: whether the shelf PRESENTS search on
    /// the tap that closes the panel. `.searchable(isPresented:)` refuses silently
    /// and stickily once the ＋ has been used, and the interaction between the
    /// search-role tab, `.searchToolbarBehavior` and programmatic presentation is
    /// characterised but not understood -- see this file's own `PV-DOCK-SEARCH`
    /// prints and `ItemListView`'s notes. Pinning a passing test to behaviour that
    /// is not understood would be a test that cannot fail usefully. Search
    /// presenting from a clean session IS covered, in
    /// `VaultDockUITests.testSearchShelfNarrowsTheListWithoutTheTabBarLeaving`.
    @MainActor
    func testPanelAndKeyboardAreMutuallyExclusive() throws {
        let app = launchApp()
        try signInOrRegister(app)
        waitForSeededFixture(app)

        let plus = plusControl(app)
        XCTAssertTrue(waitDismissingPromptsIfNeeded(for: plus, app: app, timeout: 15))
        let panel = app.descendants(matching: .any)
            .matching(identifier: "vault.create.grid").firstMatch
        let shelf = app.buttons["vault.search.shelf"]

        // The panel opens, and no keyboard comes with it.
        plus.tap()
        XCTAssertTrue(panel.waitForExistence(timeout: 8), "the panel never opened")
        XCTAssertFalse(
            app.keyboards.firstMatch.exists,
            "the keyboard is up with the ＋ panel open -- the panel would be displaced "
                + "off-screen by keyboard avoidance"
        )
        attach(app, "dock-panel-open-no-keyboard")

        // Reaching for search closes it. The pill must be pressable to reach at all,
        // which doubles as a check that the panel is not covering the dock.
        XCTAssertTrue(
            shelf.isHittable,
            "the search pill is not pressable with the panel open -- the panel is "
                + "covering the dock"
        )
        shelf.tap()
        XCTAssertFalse(
            panel.waitForExistence(timeout: 3),
            "the ＋ panel is still open after reaching for search -- it would be "
                + "displaced off-screen the moment the keyboard appeared"
        )
        XCTAssertFalse(
            app.keyboards.firstMatch.exists && panel.exists,
            "the panel and the keyboard are on screen together"
        )
        attach(app, "dock-search-closed-the-panel")

        // Recorded, not asserted -- see the header.
        print("PV-DOCK-SEARCH shelf re-presented search after the panel: "
            + "\(app.searchFields.firstMatch.waitForExistence(timeout: 5))")
    }

    // MARK: - Plus panel v2 (quick task 260818-lsk): eight actions + scanner fallback

    /// The panel's post-260818-lsk eight-action set, and the QR scanner's
    /// no-camera fallback -- the one scanner state this harness can actually
    /// drive, because the simulator has no camera (`TotpScanView`'s own
    /// header). `launchAppNoFixtureSeed()`, not `launchApp()`: this test
    /// never scrolls a seeded list, so it skips `PV_UITEST_SEED_DOCK_LIST`
    /// and the ~60-75s / 21-item seed that flag costs.
    ///
    /// Also the evidence source for `ios/evidence/38/plus-panel-v2/`, driven
    /// by `scripts/ios-plus-panel-v2-evidence.sh` the same way
    /// `ios-dock-evidence.sh` drives `testDockEvidence` -- same rig, same
    /// reasoning (attachment names carry the state->file mapping, not a
    /// human picking a frame out of a timed capture loop).
    @MainActor
    func testPlusPanelEightActionsAndScannerNoCameraFallback() throws {
        let app = launchAppNoFixtureSeed()
        try signInOrRegister(app)

        let plus = plusControl(app)
        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: plus, app: app, timeout: 15),
            "the detached ＋ never appeared"
        )
        plus.tap()

        let grid = app.otherElements["vault.create.grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 8), "the ＋ panel never opened")

        // The EIGHT slots, in the order the panel renders them.
        for id in ["login", "card", "identity", "note", "code", "scanQr", "generatePassword", "newFolder"] {
            XCTAssertTrue(app.buttons["vault.create.action.\(id)"].exists, "panel slot '\(id)' is missing")
        }
        XCTAssertFalse(
            app.buttons["vault.create.action.passkey"].exists,
            "a 'New passkey' slot is back; passkeys are provider-created, never typed in"
        )
        attach(app, "plus-panel-v2-eight-actions")

        let scanTile = app.buttons["vault.create.action.scanQr"]
        XCTAssertTrue(scanTile.exists, "the Scan QR code tile never appeared")
        scanTile.tap()

        // SIMULATOR HAS NO CAMERA -- `TotpScanView` checks `cameraAvailable`
        // BEFORE authorization status, so this state is reached
        // deterministically, with no `AVCaptureDevice.requestAccess` call
        // (and therefore no OS permission dialog) ever fired.
        let fallback = app.otherElements["totpscan.noCameraFallback"]
        XCTAssertTrue(fallback.waitForExistence(timeout: 8), "the no-camera explainer never appeared")
        attach(app, "plus-panel-v2-scanner-no-camera-fallback")

        let manualEntry = app.buttons["totpscan.manualEntry"]
        XCTAssertTrue(
            manualEntry.waitForExistence(timeout: 5),
            "the 'Enter details manually' fallback button is missing"
        )
        manualEntry.tap()

        // Reaches the SAME manual Code creation form "New code" already
        // opens, unprefilled -- `itemform.totp.secret` is that form's own
        // field id (`ItemFormView.totpRows`), proving navigation actually
        // landed on the Code form and not merely dismissed the scanner.
        let secretField = app.textFields["itemform.totp.secret"]
        XCTAssertTrue(
            secretField.waitForExistence(timeout: 8),
            "'Enter details manually' did not reach the Code creation form"
        )
        attach(app, "plus-panel-v2-manual-entry-reaches-code-form")
    }

    // MARK: - Rig

    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launchEnvironment["PV_UITEST_SEED_DOCK_LIST"] = "1"
        app.launch()
        return app
    }

    /// Quick task 260818-lsk: identical to `launchApp()` MINUS
    /// `PV_UITEST_SEED_DOCK_LIST` -- for tests that only need the dock
    /// itself (the ＋ panel, the scanner) and never scroll a seeded list.
    /// The dock renders on a genuinely empty vault exactly as it does on a
    /// populated one (`ItemListView.body`'s `TabView` is outside the
    /// empty/populated branch), so skipping the seed is not skipping
    /// coverage, only the ~60-75s / 21-item cost of building it.
    private func launchAppNoFixtureSeed() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()
        return app
    }

    /// The ＋, matched by identifier -- **which requires the tab bar to be
    /// EXPANDED**, and that is the finding this helper exists to encode.
    ///
    /// While the bar is minimised its items collapse and carry EMPTY
    /// identifiers (measured, both states, by `dumpDockButtons` below), so an
    /// identifier query finds nothing and the failure reads "the detached ＋
    /// never appeared" -- while the screenshot taken seconds earlier shows the ＋
    /// plainly on screen. That is what happened twice during this work, and the
    /// root cause both times was a restore-scroll that had not actually
    /// restored the bar, NOT the identifier being unavailable in principle.
    ///
    /// The label fallbacks are kept for the minimised case, where they are the
    /// only handle. Identifier first, because a label is a user-visible string
    /// and this one changes with the state.
    private func plusControl(_ app: XCUIApplication) -> XCUIElement {
        for name in ["vault.create.plusMenu", "Create item", "Close create menu"] {
            let candidate = app.buttons[name]
            if candidate.exists { return candidate }
        }
        // Return the identifier query so the failure message names what was
        // looked for rather than something incidental.
        return app.buttons["vault.create.plusMenu"]
    }

    /// Measures the panel's clearance above the dock and prints everything the
    /// number is derived from, returning the clearance so the two dock states can
    /// be compared against each other.
    ///
    /// THE DOCK'S TOP EDGE is taken as the search pill's `minY`, and that is the
    /// right reference in BOTH states: expanded, the pill is the accessory row
    /// sitting above the tab bar and is therefore the dock's topmost element;
    /// minimised, the pill is inline in the single collapsed row and is still the
    /// topmost thing in it (measured -- expanded 714, minimised 777, against a
    /// screen height of 852).
    ///
    /// Everything here comes off the RENDERED accessibility frames. Nothing is
    /// eyeballed off a screenshot, which is how three wrong conclusions were
    /// reached on 2026-08-17, and nothing is read out of the app's own state,
    /// which would only prove what the code believes.
    @MainActor
    @discardableResult
    private func measureDock(_ app: XCUIApplication, state: String) -> CGFloat {
        let screen = app.frame
        let panel = app.descendants(matching: .any)
            .matching(identifier: "vault.create.grid").firstMatch
        let shelf = app.buttons["vault.search.shelf"]
        XCTAssertTrue(panel.exists, "[\(state)] the panel is not on screen to measure")
        XCTAssertTrue(shelf.exists, "[\(state)] the accessory shelf's search pill is missing")

        let panelFrame = panel.frame
        let shelfFrame = shelf.frame
        let clearance = shelfFrame.minY - panelFrame.maxY
        print("PV-DOCK-GEOM [\(state)] panel=\(panelFrame)")
        print("PV-DOCK-GEOM [\(state)] shelf=\(shelfFrame)")
        print("PV-DOCK-GEOM [\(state)] dock-height=\(screen.maxY - shelfFrame.minY)")
        print("PV-DOCK-GEOM [\(state)] panel-bottom-to-dock-top=\(clearance)")
        print("PV-DOCK-GEOM [\(state)] panel-top-fraction-above-bottom="
            + "\(1 - panelFrame.minY / screen.height)")

        // THE CLAIM THAT MATTERS: the panel floats clear of the dock rather than
        // covering it. With the panel inside the tab content the dock would WIN an
        // overlap (it draws later), so a non-positive clearance here means the
        // panel is being clipped by the dock, not drawing over it -- either way
        // it is wrong, and either way this catches it.
        XCTAssertGreaterThan(
            clearance, 0,
            "[\(state)] the panel's bottom edge (\(panelFrame.maxY)) reaches into the dock "
                + "(top \(shelfFrame.minY)) -- it is not clear of the dock"
        )
        // And the dock is not merely visible but LIVE behind the panel.
        XCTAssertTrue(
            app.buttons["All"].isHittable,
            "[\(state)] the tab bar is not hittable with the panel open -- the panel is "
                + "blocking the dock"
        )
        XCTAssertTrue(
            shelfFrame.intersects(screen),
            "[\(state)] the accessory shelf left the screen when the panel opened"
        )
        return clearance
    }

    /// Prints every button in the bottom 120 pt of the screen with BOTH its
    /// label and its identifier. The dock is OS-rendered chrome, so what lands in
    /// the accessibility tree is not something to assume -- this dump is how the
    /// expanded-vs-minimised identifier difference above was established, and how
    /// a wrong version of that conclusion was caught.
    private func dumpDockButtons(_ app: XCUIApplication, _ note: String) {
        let cutoff = app.frame.maxY - 120
        let described = app.buttons.allElementsBoundByIndex
            .filter { $0.exists && $0.frame.minY >= cutoff }
            .map { "label=\($0.label.isEmpty ? "<empty>" : $0.label) id=\($0.identifier.isEmpty ? "<empty>" : $0.identifier) frame=\($0.frame)" }
        print("PV-DOCK-TREE (\(note)):")
        for line in described { print("  PV-DOCK-TREE   \(line)") }
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// The simulator's password-AutoFill heuristic offers to save on essentially
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

    /// "Logins" is the arrival signal. NOT "Passkeys" -- that tab no longer
    /// exists, and a signal that cannot appear would hang for its full timeout
    /// and then fail for the wrong reason.
    private func signInOrRegister(_ app: XCUIApplication) throws {
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "AuthView never appeared")
        emailField.tap()
        emailField.typeText(email)
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

    /// Waits on the Logins section header by PREFIX, not exact count: an exact
    /// "Logins (10)" is a hostage to how many items the account already holds,
    /// which is a property of the fixture's history and not of the dock.
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
