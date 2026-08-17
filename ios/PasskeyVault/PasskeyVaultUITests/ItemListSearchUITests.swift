// ItemListSearchUITests.swift -- Phase 38, plan 38-06, Task 2.
//
// Drives the REAL registration/sign-in code path and the REAL create flows
// (the tracer's marker-note field, the "+" create menu) against a live
// `pv-server` (`http://127.0.0.1:8621`) -- never a forced/faked item array
// -- so the list renders REAL decrypted rows, matching this phase's ROADMAP
// success criterion 1. `pv.server.url` is pre-seeded on the simulator's
// `UserDefaults` domain BEFORE this test runs (the same mechanism
// `SnapshotEvidenceUITests.swift` established in 38-05, for the same
// documented reason: `TEST_RUNNER_*` env vars do not reach
// `app.launchEnvironment` reliably in this harness).
//
// Not in 38-06-PLAN.md's `files_modified` list -- the plan's own acceptance
// criteria require it (Task 2's own `<verify>` names this file, and the
// "Artifacts this plan produces" table lists it) but it predates the file
// actually being written; added per Rule 2 (missing critical
// functionality the plan's own acceptance criteria already point at).

import XCTest

final class ItemListSearchUITests: XCTestCase {
    /// A throwaway account against the LOCAL `pv-server`, distinct from
    /// `SnapshotEvidenceUITests`' account so the two suites' item sets never
    /// interfere with each other's row-count assertions. Suffixed with a
    /// process-lifetime timestamp -- computed once, shared by both test
    /// methods within one `xcodebuild test` invocation (both calls in
    /// `testSharedRowHidesEdit…` sign into the SAME re-derived account) --
    /// so a re-run never inherits a PARTIAL registration state left behind
    /// by an interrupted prior run (observed empirically: a stale
    /// half-registered account produced a transient blank-screen state
    /// that made the fallback-to-registration branch fail unpredictably).
    private static let runSuffix = String(Int(Date().timeIntervalSince1970))
    private static let email = "pv-search-38-06-\(runSuffix)@example.invalid"
    private static let password = "PvSearch38-06-EvidencePassword!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()
        return app
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// The simulator's password-AutoFill heuristic offers to save a
    /// just-submitted password ("Not Now" / "Save") on essentially every
    /// text-field submission that looks like a login form, independent of
    /// whether the submission actually succeeded -- there is no app-level
    /// suppression for it (`NSCameraUsageDescription`-style Info.plist keys
    /// don't cover this), so every UI test that drives a real credential
    /// submission must dismiss it defensively. Always taps "Not Now" (never
    /// "Save") -- saving a throwaway UI-test password into the simulator's
    /// keychain would leak across test runs and pollute `AutoFillInvocation
    /// UITests`' own credential-provider surface.
    private func dismissSavePasswordPromptIfPresent(_ app: XCUIApplication) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) {
            notNow.tap()
        }
    }

    /// The save-password prompt can appear with a DELAY after the
    /// triggering submission rather than immediately -- a single upfront
    /// `dismissSavePasswordPromptIfPresent` call can miss it entirely if it
    /// shows up mid-wait, silently blocking every subsequent
    /// `waitForExistence` poll on the real target element until that
    /// target's own timeout expires with the dialog still covering the
    /// screen (observed empirically). Polls for EITHER the target element
    /// or the dialog, dismissing the dialog and continuing to wait for the
    /// target whenever it appears, for up to `timeout` seconds total.
    @discardableResult
    private func waitDismissingPromptsIfNeeded(
        for target: XCUIElement, app: XCUIApplication, timeout: TimeInterval
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if target.exists { return true }
            let notNow = app.buttons["Not Now"]
            if notNow.exists {
                notNow.tap()
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        return target.exists
    }

    /// Signs in if the account already exists (every run after the first),
    /// registers otherwise -- same idempotency discipline as
    /// `SnapshotEvidenceUITests.signInOrRegisterOrUnlock`.
    private func signInOrRegister(_ app: XCUIApplication) throws {
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 10), "AuthView never appeared")
        emailField.tap()
        emailField.typeText(Self.email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(Self.password)
        app.buttons["Log in"].tap()

        let marker = app.textFields["vault.create.marker"]
        // A real sign-in against the live server includes an actual
        // Argon2id unwrap on top of the network round trip -- 8s was too
        // tight and raced the fallback-to-registration branch below even on
        // a successful sign-in (observed empirically: the vault list was
        // already fully rendered when the timeout fired).
        if waitDismissingPromptsIfNeeded(for: marker, app: app, timeout: 20) {
            return
        }

        // First run ever against this account -- switch to Create account.
        app.buttons["No account yet? Sign up"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["Create account"].tap()

        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: marker, app: app, timeout: 20),
            "vault list never appeared after registration"
        )
    }

    private func createNote(_ app: XCUIApplication, named marker: String) {
        let field = app.textFields["vault.create.marker"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(marker)
        app.buttons["vault.create.submit"].tap()
        // The row itself is the completion signal -- waiting on it (rather
        // than a fixed sleep) is what makes the two-marker test below not
        // flaky against real network latency to the live server.
        XCTAssertTrue(
            app.buttons.containing(NSPredicate(format: "label CONTAINS %@", marker))
                .firstMatch.waitForExistence(timeout: 15),
            "note '\(marker)' was never created"
        )
    }

    // MARK: - Real rows, real search, screen bound to the predicate

    /// The decisive test: creates two REAL notes with distinguishing
    /// markers, types a query that (per `VaultSearch.searchItems`'s own
    /// documented contract -- a plain lowercased substring test against
    /// `name`) matches exactly one of them, and asserts the VISIBLE row
    /// count on screen equals that known-correct predicate result -- both
    /// that the match appears AND that the non-match does not. A genuinely
    /// out-of-process XCUITest cannot `@testable import` `VaultSearch`
    /// directly (it drives the app as a black box), so this fixture is
    /// deliberately chosen so the predicate's correct answer is knowable by
    /// construction, and the assertion is exactly that answer -- the same
    /// binding a white-box unit test would assert, expressed the only way a
    /// black-box UI test can.
    @MainActor
    func testSearchNarrowsVisibleRowsToThePredicatesOwnResult() throws {
        let app = launchApp()
        try signInOrRegister(app)

        let uniqueSuffix = String(Int(Date().timeIntervalSince1970))
        let matching = "AlphaSearchSuffix\(uniqueSuffix)"
        let nonMatching = "BetaOtherSuffix\(uniqueSuffix)"
        createNote(app, named: matching)
        createNote(app, named: nonMatching)

        // The marker text field's own keyboard is still up after the second
        // `createNote` and covers the search chrome entirely -- tapping
        // unrelated static text did NOT dismiss it (observed empirically:
        // the keyboard stayed up), so this resigns first responder the
        // reliable way, via the keyboard's own return key.
        let returnKey = app.keyboards.buttons["Return"]
        if returnKey.waitForExistence(timeout: 3) {
            returnKey.tap()
        }

        attach(app, name: "list-at-rest")

        let searchField = app.searchFields.firstMatch
        XCTAssertTrue(searchField.waitForExistence(timeout: 10), "search field never appeared")
        searchField.tap()
        searchField.typeText("alphasearchsuffix\(uniqueSuffix)")

        attach(app, name: "search-active")

        let matchingRow = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", matching)).firstMatch
        let nonMatchingRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", nonMatching)
        ).firstMatch

        XCTAssertTrue(matchingRow.waitForExistence(timeout: 10), "predicate's positive match never appeared")
        XCTAssertFalse(
            nonMatchingRow.waitForExistence(timeout: 3),
            "predicate's negative match appeared despite not matching the query -- screen has drifted from VaultSearch"
        )
    }

    // MARK: - Capability gating: shared row hides Edit, owned row shows it

    /// Uses `VaultStore`'s `PV_UITEST_VAULT_FIXTURE` DEBUG-only hook (see
    /// that file's own note): the real sync wire has no
    /// `access_level`/shared-direct discriminant to produce a genuine
    /// `sharedToMe == true` row from (that endpoint is Phase 40's job), so
    /// this is the only honest way to put both an owned and a shared row on
    /// screen at once for this screenshot. Still drives the REAL sign-in
    /// path and the REAL `ItemListView`/`ItemCapabilities.canEditItem` gate
    /// -- only the item ARRAY's origin is synthetic, not the gating logic
    /// under test.
    @MainActor
    func testSharedRowHidesEditContextMenuEntryWhileOwnedRowShowsIt() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launchEnvironment["PV_UITEST_VAULT_FIXTURE"] = "1"
        app.launch()
        try signInOrRegister(app)

        // The exact `vault.row.<id>` accessibility identifier, not a
        // `label CONTAINS` predicate match -- the predicate's `.firstMatch`
        // was found LIVE to be ambiguous about which ancestor in the view
        // tree it actually resolved to, and a `press` against the WRONG
        // ancestor's coordinate space explains a press that visibly does
        // nothing.
        let ownedRow = app.buttons["vault.row.uitest-owned-login"]
        let sharedRow = app.buttons["vault.row.uitest-shared-login"]
        XCTAssertTrue(ownedRow.waitForExistence(timeout: 10), "synthetic owned row never appeared")
        XCTAssertTrue(sharedRow.waitForExistence(timeout: 5), "synthetic shared row never appeared")
        dismissSavePasswordPromptIfPresent(app)
        // A settle delay before the press -- observed empirically to matter
        // when this test runs immediately after another UI test method in
        // the same `xcodebuild test` invocation (a fresh, isolated run of
        // this method alone did not need it): the long-press gesture that
        // reliably opens the context menu in isolation was flaky
        // immediately after a prior, heavier test method, consistent with
        // residual animation/layout settling rather than a logic bug.
        Thread.sleep(forTimeInterval: 1.5)

        // A coordinate-based press is more reliable than pressing the
        // element directly for triggering a SwiftUI `.contextMenu` inside a
        // `List` row that is ALSO wrapped in a `Button` -- pressing the
        // element directly was observed to do nothing (no menu, no
        // navigation, screenshot showed the plain list unchanged).
        ownedRow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.2)
        Thread.sleep(forTimeInterval: 0.5)
        attach(app, name: "context-menu-owned-row-has-edit")
        XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5), "owned row's context menu is missing Edit")
        app.terminate()

        // Fresh process -- PV_UITEST_SCREEN=auth forces AuthView regardless
        // of any restorable session, so the account must sign in again
        // (never re-register: it already exists from the call above).
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launchEnvironment["PV_UITEST_VAULT_FIXTURE"] = "1"
        app.launch()
        try signInOrRegister(app)

        let sharedRowAgain = app.buttons["vault.row.uitest-shared-login"]
        XCTAssertTrue(sharedRowAgain.waitForExistence(timeout: 10), "synthetic shared row never appeared (second launch)")
        dismissSavePasswordPromptIfPresent(app)
        Thread.sleep(forTimeInterval: 1.5)
        sharedRowAgain.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.2)
        Thread.sleep(forTimeInterval: 0.5)
        attach(app, name: "context-menu-shared-row-has-no-edit")
        XCTAssertFalse(
            app.buttons["Edit"].waitForExistence(timeout: 3),
            "shared row's context menu offers Edit -- ItemCapabilities.canEditItem gating did not reach the menu"
        )
    }
}
