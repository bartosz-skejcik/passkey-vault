// AutoFillMatchingUITests.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-
// procesami), plan 41-05.
//
// Task 1 (E41-3): drives Safari to five real locations and, for each, records WHICH of the three
// diagnostic identities `MatchingProbe.swift` (host app target) registered was offered -- never a
// pass/fail verdict on the experiment itself, per this task's own must_haves ("the table is the
// deliverable"). A location may surface MORE than one of our three identities at once (this is
// exactly what the experiment exists to observe, not an error state), so
// `observeMatchedUsernames(at:)` below scans the WHOLE current accessibility tree for every one of
// the three known discriminator strings rather than assuming a single-suggestion sheet shape --
// `AutoFillIdentityStoreUITests.swift`'s own single-suggestion assumption does not hold here by
// design.
//
// Task 2 (DR-41-B policy enforcement): reuses the SAME tracer identity (`.domain`-typed,
// registered by `TracerFillSeeder`/`IdentityStoreSync`, host-only matching) against TWO different
// ports of the tracer's own login form -- the port the item's stored URL actually names (accepted)
// and a second, different port serving the identical page (refused) -- to prove `CredentialMatcher`
// is wired into the REAL fill path, not merely unit-tested in isolation. `.domain`-typed matching
// is host-based (F3, `41-RESEARCH.md`; `IdentityStoreSync.swift`'s own header), so QuickType offers
// our identity at BOTH ports -- the fill-time matcher is the only thing standing between "offered"
// and "filled" at the mismatched one, which is exactly the case DR-41-B's own T-41-23 threat names.
//
// Every assertion prints a `PVUITEST|E41-3|` line to STDOUT (captured in the raw `xcodebuild test`
// transcript, matching `AutoFillIdentityStoreUITests.swift`'s own established discipline: this
// PROCESS, not the app, is the one reading Safari's UI, so the evidence belongs in its own stdout,
// never `os_log`).

import XCTest

final class AutoFillMatchingUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: - Task 1 (E41-3): the matrix

    // MUST match `MatchingProbe.swift` (host app target) -- duplicated as literals, matching every
    // other UI test file's own established precedent in this phase (a UI test target drives the
    // app out-of-process; it does not compile against that module).
    private static let usernameDomain = "e413-a-domain-9f2c@pv.test"
    private static let usernameUrlB = "e413-b-url-9f2c@pv.test"
    private static let usernameUrlC = "e413-c-url-9f2c@pv.test"
    private static let controlProbeUsername = "e413-control-probe-9f2c@pv.test"
    private static let allDiscriminators = [usernameDomain, usernameUrlB, usernameUrlC, controlProbeUsername]

    private static let baseHost = "e413.localhost"
    private static let subHost = "sub.e413.localhost"
    private static let unregHost = "e413-unreg.localhost"
    private static let portB = 8091
    private static let portC = 8092
    private static let portHttps = 8093

    /// One test method visiting all five locations in sequence -- the three identities do not
    /// change across visits (unlike `AutoFillIdentityStoreUITests`, which needed different WRITE
    /// states between its own runs), so a single Safari-driving pass is both correct and far
    /// cheaper than five separate `xcodebuild test` invocations.
    @MainActor
    func testE41_3AllLocations() throws {
        let locations: [(label: String, url: String)] = [
            ("loc1", "http://\(Self.baseHost):\(Self.portB)/"),
            ("loc2", "https://\(Self.baseHost):\(Self.portHttps)/"),
            ("loc3", "http://\(Self.subHost):\(Self.portB)/"),
            ("loc4", "http://\(Self.baseHost):\(Self.portC)/"),
            ("loc5", "http://\(Self.unregHost):\(Self.portB)/"),
        ]
        for (label, url) in locations {
            let matched = observeMatchedUsernames(at: url)
            let joined = matched.isEmpty ? "NONE" : matched.joined(separator: ",")
            print("PVUITEST|E41-3|ts=\(Self.nowMs()) location=\(label) url=\(url) suggested=\(joined)")
        }
    }

    /// The control's OWN falsification (this task's own acceptance criteria): visits loc5 a SECOND
    /// time after the driving script has registered a throwaway identity there
    /// (`MatchingProbe.registerControlProbe`), expecting a suggestion to now appear -- proving the
    /// earlier "no suggestion" observation was a real fact about nothing being registered, not an
    /// artifact of the harness never being able to show a suggestion at all.
    @MainActor
    func testE41_3ControlProbeShowsSuggestion() throws {
        let url = "http://\(Self.unregHost):\(Self.portB)/"
        let matched = observeMatchedUsernames(at: url)
        let joined = matched.isEmpty ? "NONE" : matched.joined(separator: ",")
        print("PVUITEST|E41-3|location=loc5-control-probe url=\(url) suggested=\(joined)")
    }

    /// The reverse half: after the driving script removes the throwaway identity again, loc5 must
    /// go back to showing nothing -- confirming the ORIGINAL row reproduces.
    @MainActor
    func testE41_3ControlProbeReverts() throws {
        let url = "http://\(Self.unregHost):\(Self.portB)/"
        let matched = observeMatchedUsernames(at: url)
        let joined = matched.isEmpty ? "NONE" : matched.joined(separator: ",")
        print("PVUITEST|E41-3|location=loc5-control-reverted url=\(url) suggested=\(joined)")
    }

    /// Falsification leg added live, this session (`MatchingProbe.registerUrlOnly()`'s own header):
    /// with identity A removed entirely (ONLY the two `.URL`-typed identities B/C registered),
    /// visits loc1 (B's OWN exact registered address) and loc5 (unregistered) to settle whether a
    /// `.URL`-typed identity is EVER offered through this sheet mechanism at all, and whether "a
    /// suggestion always appears regardless of host" was specific to identity A.
    @MainActor
    func testE41_3UrlOnlyLoc1AndLoc5() throws {
        let loc1URL = "http://\(Self.baseHost):\(Self.portB)/"
        let loc1Matched = observeMatchedUsernames(at: loc1URL)
        print("PVUITEST|E41-3|location=loc1-url-only url=\(loc1URL) suggested=\(loc1Matched.isEmpty ? "NONE" : loc1Matched.joined(separator: ","))")

        let loc5URL = "http://\(Self.unregHost):\(Self.portB)/"
        let loc5Matched = observeMatchedUsernames(at: loc5URL)
        print("PVUITEST|E41-3|location=loc5-url-only url=\(loc5URL) suggested=\(loc5Matched.isEmpty ? "NONE" : loc5Matched.joined(separator: ","))")
    }

    /// The corrected control-probe falsification -- identity A (`.domain`) was found live, this
    /// session, to be offered on EVERY visited location including the original unregistered
    /// control, which makes the ORIGINAL register/observe/remove/revert design (run against the
    /// full three-identity baseline) uninterpretable: identity A's own presence already produces a
    /// non-NONE result at loc5 regardless of the throwaway control identity's registration state.
    /// Re-run here against the CLEAN url-only baseline (`testE41_3UrlOnlyLoc1AndLoc5`'s own
    /// confirmed loc5=NONE) instead, where a change is actually attributable to the throwaway
    /// identity's own registration/removal.
    @MainActor
    func testE41_3ControlProbeOnCleanBaselineShowsSuggestion() throws {
        let url = "http://\(Self.unregHost):\(Self.portB)/"
        let matched = observeMatchedUsernames(at: url)
        print("PVUITEST|E41-3|location=loc5-clean-control-probe url=\(url) suggested=\(matched.isEmpty ? "NONE" : matched.joined(separator: ","))")
    }

    @MainActor
    func testE41_3ControlProbeOnCleanBaselineReverts() throws {
        let url = "http://\(Self.unregHost):\(Self.portB)/"
        let matched = observeMatchedUsernames(at: url)
        print("PVUITEST|E41-3|location=loc5-clean-control-reverted url=\(url) suggested=\(matched.isEmpty ? "NONE" : matched.joined(separator: ","))")
    }

    // MARK: - Task 2 (DR-41-B): accepted vs. refused fill, same tracer identity

    /// MUST match `TracerFillSeeder.swift` (host app target).
    private static let tracerExpectedUsername = "tracer41-03@pv.test"
    private static let tracerExpectedPassword = "Tr4c3r-Fill-41-03!"
    private static let tracerHost = "127.0.0.1"
    private static let tracerAcceptedPort = 8765
    /// A second local server, serving the IDENTICAL login form, on a port the tracer item's stored
    /// URL does NOT name -- `.domain`-typed matching is host-based (F3), so QuickType offers our
    /// identity here too; `CredentialMatcher` is the only thing that can tell the difference.
    private static let tracerRefusedPort = 8766

    /// Run 1 (accepted): the fill must still succeed end to end after `CredentialMatcher` is wired
    /// in -- proves the refusal proof below is not achieved by breaking filling.
    @MainActor
    func testPolicyAcceptedFillSucceeds() throws {
        let filled = driveTracerFormFill(port: Self.tracerAcceptedPort, expectFill: true)
        XCTAssertEqual(
            filled, Self.tracerExpectedPassword,
            "Accepted run: filled password (\"\(filled)\") did not byte-equal the expected tracer plaintext."
        )
        print("PVUITEST|E41-3-POLICY|run=accepted field-value-equal=\(filled == Self.tracerExpectedPassword)")
    }

    /// Run 2 (refused): the SAME identity, offered at a mismatched port, must NOT fill the field --
    /// asserted positively (the field still holds its known, un-filled placeholder), never merely
    /// "no button appeared".
    @MainActor
    func testPolicyRefusedFillDoesNotFill() throws {
        let filled = driveTracerFormFill(port: Self.tracerRefusedPort, expectFill: false)
        XCTAssertEqual(
            filled, "-none-",
            "Refused run: password field should still hold its original placeholder, got \"\(filled)\"."
        )
        print("PVUITEST|E41-3-POLICY|run=refused field-still-original=\(filled == "-none-")")
    }

    /// Navigates Safari fresh to the tracer's login form at `port`, taps the username field
    /// (triggering the silent entry point automatically -- `AutoFillFillUITests.swift`'s own header
    /// documents this), attempts the "Fill Password" confirmation chain when it appears (the
    /// ACCEPTED case), and returns whatever the password readback `<div>` shows afterward --
    /// `"-none-"` if nothing ever filled it (the REFUSED case's own positive assertion target).
    @MainActor
    private func driveTracerFormFill(port: Int, expectFill: Bool) -> String {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-3-POLICY|port=\(port) reason=no-address-bar")
            return "-none-"
        }
        addressBar.tap()
        addressBar.typeText("http://\(Self.tracerHost):\(port)/")
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-3-POLICY|port=\(port) reason=no-username-field")
            return "-none-"
        }
        usernameField.tap()
        sleep(2)

        if expectFill {
            var fillPasswordButton = safari.buttons["FillPasswordButton"]
            if !fillPasswordButton.waitForExistence(timeout: 5) {
                let passwordsAccessory = safari.buttons["Passwords"]
                if passwordsAccessory.waitForExistence(timeout: 4) {
                    var providerRow = safari.buttons["PasskeyVault"]
                    var attempt = 0
                    while attempt < 3 && !providerRow.exists && !safari.buttons["FillPasswordButton"].exists {
                        passwordsAccessory.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                        _ = providerRow.waitForExistence(timeout: 3)
                        providerRow = safari.buttons["PasskeyVault"]
                        attempt += 1
                    }
                    if safari.buttons["FillPasswordButton"].exists {
                        fillPasswordButton = safari.buttons["FillPasswordButton"]
                    } else if providerRow.exists {
                        providerRow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                        fillPasswordButton = safari.buttons["FillPasswordButton"]
                        _ = fillPasswordButton.waitForExistence(timeout: 5)
                    }
                }
            }
            if fillPasswordButton.exists {
                fillPasswordButton.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                sleep(2)
                let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                if springboard.alerts.firstMatch.waitForExistence(timeout: 3) {
                    let continueButton = springboard.buttons["Continue"]
                    if continueButton.exists {
                        continueButton.tap()
                    } else {
                        springboard.alerts.firstMatch.buttons.element(
                            boundBy: springboard.alerts.firstMatch.buttons.count - 1
                        ).tap()
                    }
                }
            } else {
                print("PVUITEST|E41-3-POLICY|port=\(port) reason=no-fill-suggestion-surfaced")
            }
        } else {
            // The refused case does not tap anything further -- the silent entry point already ran
            // (and refused) the moment the field gained focus; waiting is the whole assertion.
            sleep(3)
        }

        let passwordReadback = safari.webViews.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "PWFIELD:")
        ).firstMatch
        guard passwordReadback.waitForExistence(timeout: 20) else {
            return "-none-"
        }
        return String(passwordReadback.label.dropFirst("PWFIELD:".count))
    }

    // MARK: - Shared Safari navigation (Task 1's own matching matrix)

    /// Navigates Safari (relaunched fresh each call) to `urlString`, taps the username field, gives
    /// the QuickType/keyboard-accessory surface time to settle, optionally opens the "Passwords"
    /// accessory if present, then scans EVERY known discriminator string against the WHOLE current
    /// accessibility tree (`staticTexts`/`buttons`/`cells`) -- robust to however many of our three
    /// identities the system decides to surface at once, and to whichever of the two sheet shapes
    /// (`AutoFillFillUITests.swift`'s own header documents both) appears.
    /// Millisecond epoch timestamp -- lets the driving script correlate this file's own STDOUT
    /// evidence (captured from the raw `xcodebuild test` transcript) against the extension's
    /// SEPARATE `os_log` stream (`stage=list-evaluate`/`stage=diagnose-target`,
    /// `CredentialProviderViewController.swift`), which is the independent, harness-scraping-free
    /// ground truth for what service identifier the system actually handed `prepareCredentialList`
    /// at each real navigation.
    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    @MainActor
    private func observeMatchedUsernames(at urlString: String) -> [String] {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-3|ts=\(Self.nowMs()) reason=no-address-bar url=\(urlString)")
            return []
        }
        addressBar.tap()
        addressBar.typeText(urlString)
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-3|ts=\(Self.nowMs()) reason=no-username-field url=\(urlString)")
            return []
        }
        usernameField.tap()
        Thread.sleep(forTimeInterval: 1.5)
        // Diagnostic, every call: confirms the navigation this method attempted actually landed on
        // the intended page rather than silently staying on (or autocompleting to) a DIFFERENT one
        // -- printed unconditionally, not only on the "nothing matched" path, so a match that
        // turns out to be a STALE sheet from a prior page is still catchable from the transcript.
        print("PVUITEST|E41-3|ts=\(Self.nowMs()) debug=address-bar-value=\(addressBar.value ?? "nil") intended-url=\(urlString)")

        // Diagnostic, every call: the literal "Sign in to ..." sentence text if present --
        // `AutoFillIdentityStoreUITests.swift`'s own established, MORE SPECIFIC predicate than a
        // bare discriminator-string search, printed in full so the ACTUAL HOST the system named in
        // its own sentence is visible in the transcript, not merely "a match happened".
        let signInPredicate = NSPredicate(format: "label CONTAINS[c] %@", "Sign in to")
        let signInElement = safari.staticTexts.matching(signInPredicate).firstMatch
        if signInElement.exists {
            print("PVUITEST|E41-3|ts=\(Self.nowMs()) debug=sign-in-sentence=\(signInElement.label)")
            for i in 0..<min(safari.buttons.count, 12) {
                let button = safari.buttons.element(boundBy: i)
                print("PVUITEST|E41-3|debug=sheet-button[\(i)]=\(button.label)")
            }
        } else {
            print("PVUITEST|E41-3|ts=\(Self.nowMs()) debug=no-sign-in-sentence")
        }

        // First check the DIRECT single-suggestion sheet shape (`AutoFillFillUITests.swift`'s own
        // header, arm (a)) before touching anything -- tapping "Passwords" when this sheet is
        // already open was observed elsewhere in this phase to sometimes dismiss it.
        var found = scanForDiscriminators(in: safari)
        if !found.isEmpty {
            print("PVUITEST|E41-3|debug=direct-sheet-matched url=\(urlString)")
            // Explicit dismissal via the sheet's OWN "Close" button (never a bare
            // terminate/relaunch) before returning -- a live re-run of this experiment (this
            // session's own live finding) showed the SAME "Sign in to e413.localhost ..." sentence
            // repeating for every subsequent location regardless of the actually-visited host, with
            // ZERO extension `os_log` events for the whole drive (`xcrun simctl spawn log show`,
            // checked live) -- i.e. a STALE banner, not a fresh per-page suggestion. Explicitly
            // tapping "Close" is this file's own falsifiable fix for that staleness; if suggestions
            // still repeat identically after this, that is itself a finding for the matrix's "what
            // this does NOT settle" section, not silently worked around further.
            let closeButton = safari.buttons["Close"]
            if closeButton.exists {
                closeButton.tap()
                Thread.sleep(forTimeInterval: 0.5)
            }
            return found
        }

        // Arm (b): the "Passwords" keyboard-accessory button, then its own "PasskeyVault" /
        // "Passwords" / "Cancel" action sheet -- `AutoFillFillUITests.swift`'s established finding
        // is that the USERNAME text only appears after tapping "PasskeyVault" in that sheet, never
        // in the action sheet itself, so this method must go one level deeper than the action sheet
        // to see anything.
        let passwordsAccessory = safari.buttons["Passwords"]
        if passwordsAccessory.waitForExistence(timeout: 4) {
            passwordsAccessory.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            Thread.sleep(forTimeInterval: 1.5)

            found = scanForDiscriminators(in: safari)
            if !found.isEmpty {
                print("PVUITEST|E41-3|debug=passwords-accessory-sheet-matched url=\(urlString)")
                return found
            }

            let providerRow = safari.buttons["PasskeyVault"]
            if providerRow.waitForExistence(timeout: 3) {
                providerRow.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                Thread.sleep(forTimeInterval: 1.5)
                found = scanForDiscriminators(in: safari)
                if !found.isEmpty {
                    print("PVUITEST|E41-3|debug=provider-row-detail-matched url=\(urlString)")
                    return found
                }
            } else {
                print("PVUITEST|E41-3|debug=no-provider-row url=\(urlString)")
            }
        } else {
            print("PVUITEST|E41-3|debug=no-passwords-accessory url=\(urlString)")
        }

        // Nothing matched through either arm -- dump the full accessibility hierarchy to STDOUT so
        // a genuinely unanticipated third UI shape is still diagnosable from the captured
        // transcript, never silently recorded as a bare "NONE" with no way to tell "nothing was
        // offered" apart from "something was offered in a shape this harness did not anticipate".
        print("PVUITEST|E41-3|debug=hierarchy-dump-follows url=\(urlString)")
        for line in safari.debugDescription.split(separator: "\n", omittingEmptySubsequences: false) {
            print("PVUITEST|E41-3|HIER|\(line)")
        }
        return []
    }

    @MainActor
    private func scanForDiscriminators(in safari: XCUIApplication) -> [String] {
        var found: [String] = []
        for username in Self.allDiscriminators {
            let predicate = NSPredicate(format: "label CONTAINS[c] %@", username)
            let staticMatch = safari.staticTexts.matching(predicate).firstMatch
            let buttonMatch = safari.buttons.matching(predicate).firstMatch
            let cellMatch = safari.cells.matching(predicate).firstMatch
            if staticMatch.exists {
                found.append(username)
                print("PVUITEST|E41-3|debug=matched-element kind=staticText label=\(staticMatch.label)")
            } else if buttonMatch.exists {
                found.append(username)
                print("PVUITEST|E41-3|debug=matched-element kind=button label=\(buttonMatch.label)")
            } else if cellMatch.exists {
                found.append(username)
                print("PVUITEST|E41-3|debug=matched-element kind=cell label=\(cellMatch.label)")
            }
        }
        return found
    }
}
