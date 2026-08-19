// FreshnessEvidenceUITests.swift -- Phase 39, plan 39-06, Tasks 1 & 3 (SC4/E-F2).
//
// Drives the REAL registration flow through the REAL UI, never a forced view
// state (`PV_UITEST_SCREEN`) -- SYNC-04's own standard is what a user
// actually sees, and Task 1's screenshot requirement is explicit that the
// string must be "rendered on the vault list screen without interaction".
//
// Registers a FRESH, timestamped throwaway account every run (so the
// sign-in-first branch other evidence tests use is unnecessary here -- an
// unknown email always routes straight to registration).
//
// Driven by `scripts/ios-freshness-e-f2-proof.sh`, which owns the server
// lifecycle and the "web client" mutation (a REAL `pv-wasm`-authored second
// item, created via a second, independent client session while THIS app's
// session sits idle -- the same `mutate.mjs` technique
// `scripts/ios-ws-push-proof.sh` already established for 39-04). This ONE
// continuous test method spans that whole window (recent screenshot ->
// generous sleep for the host's mutation+kill -> background/foreground ->
// stale screenshot) because the app must stay in the SAME process across
// the server-stop: a cold relaunch would hit `AccountService
// .restoreSession()`'s own live network call and land back on `AuthView`
// instead of the vault (`ContentView.reroute()`'s own `catch` branch),
// which cannot demonstrate a STALE cache at all.
//
// TRIGGER FOR THE SECOND (POST-KILL) PULL: pull-to-refresh, not a Home-
// button background/foreground cycle -- discovered live, not assumed.
// `XCUIDevice.shared.press(.home)` followed by `app.activate()` was tried
// first (the more literal reading of "a foreground transition"), and it
// does NOT merely suspend-and-resume the SAME process under this
// Simulator/XCUITest-automation combination: the app is torn down while
// backgrounded, so `app.activate()` performs a full COLD RELAUNCH --
// visible directly in the xcodebuild log ("Open cloud.blonie.PasskeyVault
// / Launch cloud.blonie.PasskeyVault", the SAME sequence as the test's own
// initial `app.launch()`). With the server already stopped by that point,
// the relaunch's own `AccountService.restoreSession()` (a live network
// call, `ContentView.reroute()`'s own `catch` branch) fails and lands back
// on `AuthView` ("Sign in / to 127.0.0.1", captured live) -- exactly the
// state this file's own header used to warn a cold relaunch would produce,
// now confirmed as what backgrounding itself does here, not just a
// hypothetical relaunch. `.refreshable { await refresh() }` triggers the
// SAME `VaultStore.refresh()` Task 2's own proof already exercises,
// through a gesture that keeps this process alive throughout -- the real
// transport break (server stop) and the real, failed pull are unchanged;
// only the UI gesture that asks for the second pull differs from a literal
// scene-phase transition. Recorded plainly here and in the evidence file,
// per this phase's own standard for a substituted proof mechanism.
//
// THE REAL BUG BEHIND SEVERAL EARLIER "the app hangs mid-test" SYMPTOMS,
// recorded so it is not rediscovered: `scripts/ios-freshness-e-f2-proof.sh`
// used to resolve the server's PID via a bare `lsof -ti :$PORT`. That
// matches EVERY process with a socket touching that port -- not only the
// server's own LISTEN socket, but ALSO this app's own ESTABLISHED
// connection to it (the app's outgoing socket's REMOTE port is also
// `$PORT`, which `lsof -i` matches from that side too). The unfiltered
// kill was sending SIGTERM DIRECTLY TO THIS APP whenever it held an open
// connection to the server at kill time -- not a hang, not flakiness, a
// self-inflicted termination. Fixed in that script by filtering PIDs to
// the actual `pv-server` binary by command name before killing anything.
// The `PV_UITEST_DISABLE_REPEATING_PULL` hook and the tracer-create-bar
// (rather than the "+" panel/`ItemFormView`) choice below both predate
// that fix and were reasonable hardening independent of it -- kept, with
// their own reasoning corrected to not imply they were the load-bearing
// fix.

import XCTest

final class FreshnessEvidenceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Plain name first, then `TEST_RUNNER_`-prefixed -- matches this
    /// repo's established `env()` helper convention
    /// (`SyncTracerLiveProofTests.swift`, `AccountFlowLiveTests.swift`).
    private func env(_ key: String) -> String? {
        if let v = ProcessInfo.processInfo.environment[key], !v.isEmpty { return v }
        if let v = ProcessInfo.processInfo.environment["TEST_RUNNER_\(key)"], !v.isEmpty { return v }
        return nil
    }

    /// Backspace-heavy clear: works whether the field is currently a
    /// `SecureField` (masked) or a plain `TextField` (revealed) -- 80
    /// backspaces is comfortably more than any password this file ever
    /// types; a no-op on an already-empty field.
    private func clearField(_ field: XCUIElement) {
        guard field.exists else { return }
        field.tap()
        field.typeText(String(repeating: "\u{8}", count: 80))
    }

    /// Types `text` into `field` and reads it straight back via `.value` --
    /// retrying with a full clear if the read-back does not match. ONLY
    /// valid for a REVEALED (plain `TextField`) field: a masked
    /// `SecureField`'s `.value` is bullets, which cannot verify content.
    ///
    /// This exists because typing into this view's password fields was
    /// observed, live, to silently drop characters on the FIRST secure
    /// field focused after this view appears (`app.staticTexts["Passwords
    /// don't match"]` rendering even though both fields were typed with the
    /// SAME literal string) -- almost certainly iOS's own "Strong Password
    /// AutoFill" accessory swallowing early synthesized keystrokes while it
    /// animates in around a freshly focused secure field. Revealing the
    /// fields BEFORE typing (this file's own `Mode.register` flow taps the
    /// shared eye toggle first) sidesteps the masked-field code path
    /// entirely; this helper is the belt to that braces, verifying the
    /// actual landed text rather than assuming either fix alone is enough.
    private func typeAndVerify(_ field: XCUIElement, text: String) {
        for attempt in 1...4 {
            clearField(field)
            field.tap()
            Thread.sleep(forTimeInterval: attempt == 1 ? 0.4 : 1.2)
            field.typeText(text)
            Thread.sleep(forTimeInterval: 0.3)
            if (field.value as? String) == text {
                return
            }
        }
        XCTFail("'\(field.label)' never landed the expected text after 4 attempts -- read back: \(String(describing: field.value))")
    }

    @MainActor
    func testFreshSyncThenStaleAfterServerStop() throws {
        guard
            let email = env("PV_FRESHNESS_E2E_EMAIL"),
            let password = env("PV_FRESHNESS_E2E_PASSWORD")
        else {
            XCTFail("PV_FRESHNESS_E2E_EMAIL/PV_FRESHNESS_E2E_PASSWORD must be set -- see scripts/ios-freshness-e-f2-proof.sh")
            return
        }

        let app = XCUIApplication()
        // Disables ContentView's own SyncCoordinator/socket for THIS
        // session -- see `ContentView.syncCoordinatorFor(_:store:)`'s own
        // note. Not load-bearing for the fix this file's header describes,
        // but a reasonable simplification regardless: this test's OWN
        // pull-to-refresh gesture is the only pull it needs, and keeping a
        // live socket reconnecting against a server this test kills
        // partway through is complexity this proof does not need.
        app.launchEnvironment["PV_UITEST_DISABLE_REPEATING_PULL"] = "1"
        // The tracer create bar (`vault.create.marker`/`vault.create.submit`,
        // `ItemListView`'s own DEBUG-only, opt-in bar -- see that file's
        // header) creates an item WITHOUT ever navigating away from the list
        // screen -- simpler and lower-risk than the "+" panel ->
        // `ItemFormView` -> save -> back-navigation route this test tried
        // first (that route worked fine too, once this file's header's own
        // "the real bug" was fixed; staying on one screen is kept as the
        // simpler of two working options, not as a fix for anything).
        app.launchEnvironment["PV_UITEST_TRACER_CREATE_BAR"] = "1"
        app.launch()

        // --- register: a fresh email always routes to registration -------
        let authEmailField = app.textFields.firstMatch
        XCTAssertTrue(authEmailField.waitForExistence(timeout: 15), "AuthView never appeared")
        app.buttons["auth-toggle-mode"].tap()
        authEmailField.tap()
        authEmailField.typeText(email)

        // Confirm the second field exists (masked, at this point) before
        // touching the reveal toggle.
        let confirmFieldSecure = app.secureTextFields.element(boundBy: 1)
        XCTAssertTrue(confirmFieldSecure.waitForExistence(timeout: 5), "confirm password field never appeared")

        // Reveal BOTH password fields (`isPasswordRevealed` is ONE shared
        // `@State` behind both -- AuthView.swift's own `passwordField(text:
        // labelKey:)`) before typing into either. See `typeAndVerify`'s own
        // header for why this matters.
        let eyeButton = app.buttons.matching(identifier: "eye").firstMatch
        XCTAssertTrue(eyeButton.waitForExistence(timeout: 5), "no reveal (eye) button found")
        eyeButton.tap()

        let passwordField = app.textFields["Master password"]
        let confirmField = app.textFields["Confirm master password"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "revealed master-password field never appeared")
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5), "revealed confirm-password field never appeared")

        typeAndVerify(passwordField, text: password)
        typeAndVerify(confirmField, text: password)

        app.buttons["auth-submit"].tap()

        // --- wait for the REAL vault list, synced -------------------------
        let lastSynced = app.staticTexts["vault.sync.lastSynced"]
        XCTAssertTrue(lastSynced.waitForExistence(timeout: 20), "vault.sync.lastSynced never appeared -- registration or first sync failed")

        // --- create ONE real item via the tracer create bar: `.refreshable`
        // (pull-to-refresh) is attached only to the populated-list branch of
        // `ItemListView.tabContent(for:)` -- a brand-new, empty account
        // renders `emptyVaultState` instead, which has no pull-to-refresh
        // affordance at all. See this test's own header (above) for why the
        // tracer bar, not the "+" panel/`ItemFormView`, is used here. -----
        let markerField = app.textFields["vault.create.marker"]
        XCTAssertTrue(markerField.waitForExistence(timeout: 10), "tracer create bar never appeared")
        markerField.tap()
        markerField.typeText("Freshness proof marker")
        app.buttons["vault.create.submit"].tap()
        let markerRow = app.buttons.containing(
            NSPredicate(format: "label CONTAINS %@", "Freshness proof marker")
        ).firstMatch
        XCTAssertTrue(markerRow.waitForExistence(timeout: 15), "marker item was never created")
        // A never-synced label would mean the FIRST pull has not landed yet
        // -- wait briefly for it to flip from "Not synced yet" to a real
        // "Last synced ..." string before trusting it as the recent capture.
        let becameSynced = NSPredicate(format: "label BEGINSWITH 'Last synced'")
        let syncedExpectation = XCTNSPredicateExpectation(predicate: becameSynced, object: lastSynced)
        XCTAssertEqual(XCTWaiter().wait(for: [syncedExpectation], timeout: 15), .completed, "the first confirmed pull never landed")

        let recentLabel = lastSynced.label
        XCTAssertTrue(recentLabel.hasPrefix("Last synced"), "unexpected label: \(recentLabel)")

        let recentAttachment = XCTAttachment(screenshot: app.screenshot())
        recentAttachment.name = "freshness-recent"
        recentAttachment.lifetime = .keepAlways
        add(recentAttachment)

        // --- hold here while the driving script mutates server-side and
        // stops the server for real. Generous, unidirectional margin: the
        // host script's own mutation (one `mutate.mjs create` invocation)
        // and kill sequence together take low single-digit seconds in
        // practice; this sleep only needs to comfortably outlast that, it
        // is never raced against. Broken into short polls rather than one
        // bare `Thread.sleep` only so a screen recording/log has periodic
        // evidence the app was still alive and responsive throughout this
        // window, not because a single sleep was ever the problem. -------
        for _ in 0..<12 {
            _ = lastSynced.exists
            Thread.sleep(forTimeInterval: 2)
        }

        // --- pull-to-refresh: the second pull's trigger (see this file's
        // header for why this replaces a background/foreground cycle). A
        // coordinate-based drag anchored on the WINDOW, not on a specific
        // `List`/`Table`/`CollectionView` element query -- this build's
        // `List` did not resolve as either `app.tables` or
        // `app.collectionViews` (observed live, both timing out), and the
        // window itself is large enough to compute a reliable drag path
        // regardless of how the list container is classified. Not
        // `.swipeDown()` -- that gesture is fast enough to read as a
        // flick/scroll rather than a deliberate pull by `UIRefreshControl`
        // under XCUITest, a well-documented gap between synthesized and
        // real touch timing.
        let window = app.windows.firstMatch
        XCTAssertTrue(window.waitForExistence(timeout: 10), "no window found for the pull-to-refresh gesture")
        let pullStart = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        let pullEnd = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9))
        pullStart.press(forDuration: 0.1, thenDragTo: pullEnd)

        // Let the resulting (failing) pull run to completion.
        Thread.sleep(forTimeInterval: 5)

        let staleLabel = lastSynced.label
        let staleAttachment = XCTAttachment(screenshot: app.screenshot())
        staleAttachment.name = "freshness-stale"
        staleAttachment.lifetime = .keepAlways
        add(staleAttachment)

        // NOT a character-for-character comparison here -- and DELIBERATELY
        // so, corrected after a live run showed why one would be wrong. The
        // PRODUCTION `SyncStatusView` renders with `reference: Date()` (the
        // real, current instant), never a pinned one -- so its RELATIVE
        // phrase legitimately grows the longer the reader looks at it, even
        // though the underlying `syncedAtMs` value never moved: "Last
        // synced 4 seconds ago" captured before the wait, "Last synced 33
        // seconds ago" captured ~29s later after a FAILED pull, is the
        // CORRECT, honest rendering of an unchanged stored instant against
        // an advancing clock -- asserting string equality here would be
        // asserting the wrong thing, exactly what Task 2's own methodology
        // note (`FreshnessLiveProofTests.swift`) already had to correct
        // for at the file level.
        //
        // The positive assertion this file makes instead: the STALE
        // reading's elapsed seconds must be LARGER than the recent
        // reading's by roughly the real wait this test just held (D-07 is
        // still satisfied -- this is a positive comparison of two captured
        // values, not an inference from a missing error banner). A pull
        // that had falsely refreshed the timestamp would show a STALE
        // reading reset back down near zero instead -- exactly the
        // "confident lie" T-39-23 exists to catch, and exactly what this
        // assertion is shaped to fail on if it ever happens.
        func elapsedSeconds(_ label: String) -> Int? {
            guard let range = label.range(of: #"\d+(?= second)"#, options: .regularExpression) else {
                return nil
            }
            return Int(label[range])
        }
        guard let recentSeconds = elapsedSeconds(recentLabel) else {
            XCTFail("could not parse a seconds-elapsed value out of the recent label: \(recentLabel.debugDescription)")
            return
        }
        guard let staleSeconds = elapsedSeconds(staleLabel) else {
            XCTFail("could not parse a seconds-elapsed value out of the stale label: \(staleLabel.debugDescription)")
            return
        }
        XCTAssertGreaterThan(
            staleSeconds, recentSeconds + 15,
            "the stale reading (\(staleLabel.debugDescription)) must show meaningfully MORE elapsed time than the recent reading (\(recentLabel.debugDescription)) -- a smaller/reset value would mean the failed pull was falsely rendered as a success"
        )
    }
}
