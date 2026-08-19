// FamilyWiringLiveUITests.swift -- 40-REVIEW.md (iteration 2) fix pass.
//
// THE live proof CR-04(b)'s fix is not believed without (per the fix
// instructions this file was written to satisfy): drives the REAL app UI,
// against a REAL live `pv-server`, through the ENTIRE wired family flow
// that iteration 1's own fix report claimed but never actually ran end to
// end:
//
//   create family -> generate an invite link -> paste-redeem it on a
//   SECOND, independently-registered account -> the roster shows both
//   members -> the first account shares an item with the second -> the
//   second account sees it in their own list with the "Shared with you"
//   pill.
//
// Two accounts, ONE continuous XCUITest method, `app.terminate()` +
// relaunch between account contexts (mirrors `ItemListSearchUITests`' own
// two-launch precedent within a single test method) -- never two separate
// `xcodebuild test` invocations, so both halves share the exact same
// server-seeded `pv.server.url` UserDefaults write and the exact same
// simulator install.
//
// Every screen this test drives was, per 40-REVIEW.md's own iteration-2
// finding CR-04(b), either freshly wired by this fix pass (the no-family
// empty state's "Załóż rodzinę"/"Mam link zaproszenia" buttons) or
// previously wired but never live-proven end to end (invite creation,
// roster, direct share, the received-share pill).

import XCTest

final class FamilyWiringLiveUITests: XCTestCase {
    private static let runSuffix = String(Int(Date().timeIntervalSince1970))
    private static let emailA = "pv-40-review-fix-a-\(runSuffix)@example.invalid"
    private static let emailB = "pv-40-review-fix-b-\(runSuffix)@example.invalid"
    private static let password = "Pv40ReviewFix-EvidencePassword!"
    private static let itemMarker = "40-review-fix shared item \(runSuffix)"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func attach(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// Same file-scoped-copy discipline as `ItemListSearchUITests.swift`'s
    /// identical helper, `timeout` parameterized so a caller polling in a
    /// tight loop (`tapAndType`, below) is not forced into that file's own
    /// 3-second default on every iteration.
    private func dismissSavePasswordPromptIfPresent(_ app: XCUIApplication, timeout: TimeInterval = 3) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: timeout) {
            notNow.tap()
        }
    }

    /// Coordinate-tap, generous settle, then type -- mirrors
    /// `FreshnessEvidenceUITests.typeAndVerify`'s own header (a field
    /// freshly appeared after a launch/navigation transition was observed,
    /// live, to accept a `.tap()` that does not actually land keyboard
    /// focus before `.typeText()` fires -- `XCTest`'s own "Neither element
    /// nor any descendant has keyboard focus" synthesis failure) and
    /// `ItemListSearchUITests`' own note that a COORDINATE-based tap is
    /// more reliable than tapping the element directly in this harness.
    /// Deliberately NOT a retry-on-failure loop: with `continueAfterFailure
    /// = false` (this file's own `setUpWithError`), the FIRST failed
    /// `typeText` synthesis aborts the test method immediately, so a loop
    /// wrapping a failing call never gets a second iteration -- the fix is
    /// giving the ONE attempt the best chance to land, not retrying after
    /// the fact.
    private func tapAndType(_ field: XCUIElement, text: String, app: XCUIApplication) {
        XCTAssertTrue(field.waitForExistence(timeout: 10), "field never appeared")
        // The password-AutoFill "Save Password?" prompt can appear with a
        // DELAY after a submission that happened seconds earlier
        // (`ItemListSearchUITests`' own documented note) -- polled for and
        // dismissed both BEFORE and AFTER the tap below, since it was
        // observed live to arrive in the ~1-2s window between a
        // successfully-synthesized tap and the following `typeText` call,
        // stealing keyboard focus in between even though the tap itself
        // reported no interrupting element at the time it fired.
        dismissSavePasswordPromptIfPresent(app, timeout: 1)
        // A generous upfront settle -- a fresh launch/relaunch's keyboard-
        // dismissal and layout animations were observed, live, to still be
        // in flight well past the point the target field itself already
        // reports as existing in the accessibility tree.
        Thread.sleep(forTimeInterval: 2.5)
        field.tap()
        Thread.sleep(forTimeInterval: 0.5)
        field.tap()
        Thread.sleep(forTimeInterval: 1.5)
        dismissSavePasswordPromptIfPresent(app, timeout: 1)
        field.typeText(text)
        Thread.sleep(forTimeInterval: 0.3)
    }

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

    /// Launches a FRESH `XCUIApplication` process forced to `AuthView`
    /// (`PV_UITEST_SCREEN=auth`) regardless of any restorable session --
    /// every account context in this test (A's first launch, B's launch,
    /// A's second launch to author the share) starts here, so a stale
    /// `.lock` route from a PRIOR account's restorable session can never
    /// leak into the wrong context.
    private func launchForcedToAuth() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launchEnvironment["PV_UITEST_TRACER_CREATE_BAR"] = "1"
        app.launch()
        return app
    }

    /// Registers if the account does not exist yet, signs in otherwise --
    /// same idempotency discipline as `ItemListSearchUITests
    /// .signInOrRegister`, kept as its own file-scoped copy.
    private func signInOrRegister(_ app: XCUIApplication, email: String) throws {
        let emailField = app.textFields.firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 15), "AuthView never appeared")
        emailField.tap()
        emailField.typeText(email)
        let passwordField = app.secureTextFields.firstMatch
        passwordField.tap()
        passwordField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        let marker = app.textFields["vault.create.marker"]
        if waitDismissingPromptsIfNeeded(for: marker, app: app, timeout: 20) {
            return
        }

        app.buttons["auth-toggle-mode"].tap()
        let confirmField = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5))
        confirmField.tap()
        confirmField.typeText(Self.password)
        app.buttons["auth-submit"].tap()

        XCTAssertTrue(
            waitDismissingPromptsIfNeeded(for: marker, app: app, timeout: 20),
            "vault list never appeared after registration for \(email)"
        )
        dismissSavePasswordPromptIfPresent(app)
    }

    /// avatar menu -> "Family". `vault.avatarMenu` is on BOTH `ItemListView`
    /// and `ItemDetailView`'s toolbar (`vaultLockToolbarContent`'s own
    /// header); this test only ever calls it from the list.
    private func navigateToFamily(_ app: XCUIApplication) {
        let avatarMenu = app.buttons["vault.avatarMenu"]
        XCTAssertTrue(avatarMenu.waitForExistence(timeout: 10), "avatar menu never appeared")
        // A settle delay before the tap -- observed live (same class of
        // flakiness `tapAndType`'s own header documents): tapping this
        // toolbar item immediately after it reports existence can compute
        // a `{-1, -1}` hit point (the layout/safe-area settle from the
        // just-completed sign-in transition still in flight), which opens
        // no menu at all.
        Thread.sleep(forTimeInterval: 1.5)
        avatarMenu.tap()
        Thread.sleep(forTimeInterval: 0.5)
        let familyItem = app.buttons["Family"]
        if !familyItem.waitForExistence(timeout: 3) {
            // One retry -- the menu did not open on the first tap.
            avatarMenu.tap()
        }
        XCTAssertTrue(familyItem.waitForExistence(timeout: 5), "Family menu entry never appeared")
        familyItem.tap()
    }

    @MainActor
    func testCreateFamilyInviteRedeemRosterAndShareEndToEnd() throws {
        // === Account A: create the family =====================================
        let appA1 = launchForcedToAuth()
        try signInOrRegister(appA1, email: Self.emailA)

        navigateToFamily(appA1)
        let createFamilyCta = appA1.buttons["vault.family.createFamilyCta"]
        XCTAssertTrue(createFamilyCta.waitForExistence(timeout: 10), "no-family empty state never appeared for a fresh account")
        attach(appA1, name: "01-account-a-no-family-state")
        createFamilyCta.tap()

        // Once created, MemberListView renders (A's own row, as owner) --
        // and the invite CTA (gated on `!hasNoFamily`) becomes reachable.
        let inviteCta = appA1.buttons["vault.family.inviteCta"]
        XCTAssertTrue(inviteCta.waitForExistence(timeout: 15), "invite CTA never appeared after creating a family")
        attach(appA1, name: "02-account-a-roster-after-create-family")
        inviteCta.tap()

        // === Account A: generate the invite link ===============================
        let generateCta = appA1.buttons["vault.invite.generateCta"]
        XCTAssertTrue(generateCta.waitForExistence(timeout: 10), "InviteCreateView never appeared")
        generateCta.tap()

        let linkField = appA1.staticTexts["vault.invite.linkField"]
        XCTAssertTrue(linkField.waitForExistence(timeout: 15), "invite link was never generated")
        let inviteURLString = linkField.label
        XCTAssertTrue(
            inviteURLString.contains("/invite/") && inviteURLString.contains("#"),
            "generated invite link does not look like {origin}/invite/{id}#{secret}: \(inviteURLString)"
        )
        attach(appA1, name: "03-account-a-generated-invite-link")

        // === Account A: author an item to share later, while still signed in ===
        // Navigating back out of the Family sheet: terminate/relaunch is
        // simpler and more reliable than driving dismissal gestures against
        // a `NavigationStack`-wrapped `.sheet` with no explicit close
        // button (`InviteCreateView`'s own header records no such control
        // was drawn) -- the account's session is restorable regardless.
        appA1.terminate()

        let appA2 = launchForcedToAuth()
        try signInOrRegister(appA2, email: Self.emailA)
        let markerField = appA2.textFields["vault.create.marker"]
        XCTAssertTrue(markerField.waitForExistence(timeout: 15))
        tapAndType(markerField, text: Self.itemMarker, app: appA2)
        appA2.buttons["vault.create.submit"].tap()
        XCTAssertTrue(
            appA2.buttons.containing(NSPredicate(format: "label CONTAINS %@", Self.itemMarker))
                .firstMatch.waitForExistence(timeout: 15),
            "shared-item fixture was never created on account A"
        )
        appA2.terminate()

        // === Account B: redeem the invite via the MANUAL paste-link route =====
        // THE decisive step for CR-04(b): before this fix, `InviteRedeemView`
        // had exactly one presenter (`ContentView.onOpenURL`), which cannot
        // fire in this build (no `CFBundleURLTypes`/associated-domains
        // entitlement anywhere in the project) -- so this screen was
        // reachable by NEITHER a real deep link NOR any in-app control.
        // `FamilyRootView`'s new "Mam link zaproszenia" button is what this
        // fix pass added to close that gap.
        let appB1 = launchForcedToAuth()
        try signInOrRegister(appB1, email: Self.emailB)

        navigateToFamily(appB1)
        let redeemInviteCta = appB1.buttons["vault.family.redeemInviteCta"]
        XCTAssertTrue(redeemInviteCta.waitForExistence(timeout: 10), "no-family empty state (with the redeem CTA) never appeared for account B")
        attach(appB1, name: "04-account-b-no-family-state")
        redeemInviteCta.tap()

        let redeemLinkField = appB1.textFields["vault.inviteRedeem.linkField"]
        XCTAssertTrue(redeemLinkField.waitForExistence(timeout: 10), "InviteRedeemView never appeared")
        tapAndType(redeemLinkField, text: inviteURLString, app: appB1)

        let joinCta = appB1.buttons["vault.inviteRedeem.joinCta"]
        XCTAssertTrue(joinCta.waitForExistence(timeout: 5))
        joinCta.tap()

        let successNotice = appB1.staticTexts["vault.inviteRedeem.successNotice"]
        XCTAssertTrue(successNotice.waitForExistence(timeout: 20), "invite redemption never succeeded on account B")
        attach(appB1, name: "05-account-b-invite-redeemed")

        // "Przejdź do swojego vaulta" -- the SAME CTA, now driving onFinished().
        joinCta.tap()

        // === Account B: the roster now shows BOTH members =======================
        let bOwnRow = appB1.staticTexts[Self.emailB]
        XCTAssertTrue(bOwnRow.waitForExistence(timeout: 15), "account B's own roster row never appeared after joining")
        let aRowFromB = appB1.staticTexts[Self.emailA]
        XCTAssertTrue(aRowFromB.waitForExistence(timeout: 10), "account A's row never appeared in B's own roster view")
        attach(appB1, name: "06-account-b-roster-shows-both-members")
        appB1.terminate()

        // === Account A: the roster ALSO shows both members, from A's side ======
        let appA3 = launchForcedToAuth()
        try signInOrRegister(appA3, email: Self.emailA)
        navigateToFamily(appA3)
        let bRowFromA = appA3.staticTexts[Self.emailB]
        XCTAssertTrue(bRowFromA.waitForExistence(timeout: 15), "account B's row never appeared in A's own roster view")
        attach(appA3, name: "07-account-a-roster-shows-both-members")
        appA3.terminate()

        // === Account A: share the earlier item directly with B =================
        let appA4 = launchForcedToAuth()
        try signInOrRegister(appA4, email: Self.emailA)

        let sharedItemRow = appA4.buttons.containing(NSPredicate(format: "label CONTAINS %@", Self.itemMarker)).firstMatch
        XCTAssertTrue(sharedItemRow.waitForExistence(timeout: 15), "the earlier fixture item never appeared in A's list")
        dismissSavePasswordPromptIfPresent(appA4)
        Thread.sleep(forTimeInterval: 1.0)
        // Coordinate-based long-press -- same technique
        // `ItemListSearchUITests`'s own header records as the reliable one
        // for a SwiftUI `.contextMenu` inside a `List` row that is ALSO a
        // `Button`.
        sharedItemRow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.2)
        let shareButton = appA4.buttons["Share"]
        XCTAssertTrue(shareButton.waitForExistence(timeout: 5), "context menu's Share action never appeared")
        shareButton.tap()

        // Live-inspected (`xcresulttool export attachments`, this test's
        // own iteration debugging): the per-row `Button`'s OWN
        // `.accessibilityIdentifier("vault.share.person.<userId>")` (set in
        // `ShareItemView.personRow(_:)`) does NOT reach this exposed
        // accessibility tree at all -- the identifier XCUITest reports for
        // EVERY row is `vault.share.personPicker` (the enclosing `VStack`'s
        // own identifier), a SwiftUI accessibility-merging quirk, not a
        // production bug (`ShareItemView`'s own source is unambiguous, and
        // `vault.share.person.<userId>` is exercised correctly by unit
        // tests elsewhere that never go through the live accessibility
        // tree). Matching on `label CONTAINS` is therefore the reliable
        // live-UI selector here; the CTA's own live-updating label
        // ("Udostępnij N os.") is asserted below as POSITIVE proof the tap
        // actually landed a selection, rather than trusting the tap alone.
        let personRow = appA4.buttons.containing(NSPredicate(format: "label CONTAINS %@", Self.emailB)).firstMatch
        XCTAssertTrue(personRow.waitForExistence(timeout: 10), "account B never appeared in ShareItemView's person picker")
        personRow.tap()
        Thread.sleep(forTimeInterval: 0.5)

        let shareCta = appA4.buttons["vault.share.cta"]
        XCTAssertTrue(shareCta.waitForExistence(timeout: 5))
        // POSITIVE proof the tap above actually landed a selection --
        // `ctaLabel`'s own text is `"Udostępnij \(selectedMemberIds.count) os."`
        // (`ShareItemView.swift`); "0 os." would mean the tap never
        // registered as a selection, and `share()` would fail closed with
        // "Wybierz co najmniej jedną osobę" without ever reaching the
        // network.
        XCTAssertFalse(
            shareCta.label.contains("0 os."),
            "person selection tap did not register -- CTA still reads '\(shareCta.label)'"
        )
        attach(appA4, name: "08-account-a-share-sheet-before-submit")
        shareCta.tap()

        // The sheet dismisses on success (`ShareItemView.share()`'s own
        // `dismiss()` call) -- but a `.sheet`'s presenting view's elements
        // remain present (though non-hittable) in the accessibility tree
        // while the sheet is still up, so asserting on `sharedItemRow`
        // ALONE (still findable underneath an open, errored sheet) would
        // pass even on a failed share. The CTA/error-text elements are
        // owned by the sheet itself -- their ABSENCE is what actually
        // proves it closed, never their presence proving it opened.
        Thread.sleep(forTimeInterval: 1.5)
        let shareErrorText = appA4.staticTexts["vault.share.errorText"]
        XCTAssertFalse(
            shareErrorText.exists,
            "share reported a failure: \(shareErrorText.exists ? shareErrorText.label : "")"
        )
        XCTAssertFalse(shareCta.exists, "the share sheet is still presented -- share() did not report success")
        XCTAssertTrue(sharedItemRow.waitForExistence(timeout: 15), "did not return to the vault list after sharing")
        appA4.terminate()

        // === Account B: the shared item now appears, with the received pill ===
        let appB2 = launchForcedToAuth()
        try signInOrRegister(appB2, email: Self.emailB)

        let receivedRow = appB2.buttons.containing(NSPredicate(format: "label CONTAINS %@", Self.itemMarker)).firstMatch
        // A generous, prompt-dismissing wait -- `waitForExistence` alone
        // does not dismiss a late-appearing "Save Password?" system prompt
        // sitting on top of the list, which was observed live to still
        // delay/obscure the initial sync render well past a bare 20-40s
        // window. Live-diagnosed (a temporary `Self.log.error` added and
        // reverted during this test's own development, never committed):
        // `VaultStore.items` genuinely contains the shared item, correct
        // id, well within a 40s window on every run -- the DATA layer is
        // not the source of this variance. The RENDER catching up on a
        // loaded CI-like simulator (this harness also runs `xcodebuild`
        // and a live `log stream` concurrently) was observed to
        // occasionally exceed 40s; 90s absorbs that without masking a
        // genuine regression (a real one would still fail here, just
        // later).
        let receivedRowAppeared = waitDismissingPromptsIfNeeded(for: receivedRow, app: appB2, timeout: 90)
        attach(appB2, name: "09-diag-final-state-before-assert")
        XCTAssertTrue(receivedRowAppeared, "the item shared by A never appeared in B's own list")
        // CR-06/CR-07's own decisive proof, at the UI layer: exactly ONE
        // row for this item -- not two (the duplicate-id defect the
        // dedupe fix closed).
        let matchingRows = appB2.buttons.matching(NSPredicate(format: "label CONTAINS %@", Self.itemMarker))
        XCTAssertEqual(matchingRows.count, 1, "the shared item must appear exactly once, never duplicated")

        let sharedPill = appB2.staticTexts["Shared with you"]
        XCTAssertTrue(sharedPill.waitForExistence(timeout: 10), "the 'Shared with you' pill never appeared on B's received item")
        attach(appB2, name: "09-account-b-receives-shared-item-with-pill")
        appB2.terminate()
    }
}
