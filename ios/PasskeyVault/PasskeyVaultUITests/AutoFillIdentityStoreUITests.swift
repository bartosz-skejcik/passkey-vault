// AutoFillIdentityStoreUITests.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-
// procesami), plan 41-04, Task 2 (E41-2).
//
// landmine L-34 (`ios/IOS-SPIKE-LOG.md` §3): the receiver-side proof this task's own must_haves
// specify -- `credentialIdentities(forService:credentialIdentityTypes:)` -- was found LIVE, this
// session, to return an empty set on this simulator/toolchain regardless of a confirmed-durable
// prior write (proven durable by exactly the mechanism this file uses: a REAL system QuickType
// sheet, screenshotted, showing the registered username). So the assertions in this file read
// Safari's OWN accessibility tree for the "Sign in to ..." QuickType sheet's text -- the ONLY
// receiver-side proof this harness can make honestly. `IdentityStoreSyncProbe` (host app target)
// still attempts the API read, logged best-effort, never gating.
//
// The driving script (`scripts/ios-autofill-e41.sh e41-2`) sequences: `simctl launch` the host
// app with the relevant marker present (a FAST, non-XCUITest write step -- the write itself needs
// no UI), terminate it, THEN run exactly one of this file's test methods to drive Safari and
// assert on the QuickType surface. Every assertion prints a `PVUITEST|E41-2|` line to STDOUT
// (captured in the raw `xcodebuild test` transcript, not `os_log`, since this process -- not the
// app -- is the one reading Safari's UI) so the harness can grep the CAPTURED TEST LOG for the
// pass/fail evidence, exactly mirroring how `IdentityStoreSyncProbe` logs via `os_log` for
// app-side evidence.
//
// `testNegativeControlDisabledStore` is the one exception: it drives Settings to toggle the
// provider off then back on ITSELF (self-contained, "Re-enable afterwards" per this task's own
// action text) and needs no Safari check at all -- the disabled-store proof is entirely on the
// WRITE side (`IdentityStoreSyncProbe.runNegative1`'s own `os_log` line), which does not depend
// on the broken read API at all.

import XCTest

final class AutoFillIdentityStoreUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private static let loginFormURL = "http://127.0.0.1:8765/"
    /// MUST match `IdentityStoreSyncProbe.username`/`.mutatedUsername` (host app target) --
    /// duplicated as literals for the same reason `AutoFillFillUITests.swift`'s own header gives
    /// (a UI test target drives the app out-of-process, it does not compile against that module).
    private static let expectedUsername = "e412-probe-83f1@pv.test"
    private static let expectedMutatedUsername = "e412-probe-83f1-MUTATED@pv.test"

    /// Run 1 (positive): the driving script already ran the WRITE (via `simctl launch` +
    /// `IdentityStoreSyncProbe.runPositive`, host app terminated) before invoking this test. This
    /// test ONLY drives Safari and asserts the QuickType sheet names our discriminator username,
    /// character for character (the exact-equality falsification this task's acceptance criteria
    /// requires: alter one character in `expectedUsername` above, re-run, observe failure).
    @MainActor
    func testPositiveRoundTripSuggestion() throws {
        guard let sheetText = observeQuickTypeSuggestionText() else {
            XCTFail("No QuickType suggestion surface appeared for \(Self.loginFormURL) -- our identity was not offered.")
            return
        }
        XCTAssertTrue(
            sheetText.contains(Self.expectedUsername),
            "QuickType sheet text \"\(sheetText)\" does not contain the expected discriminator \"\(Self.expectedUsername)\""
        )
    }

    /// Run 2 (first negative control): the driving script writes with the provider DISABLED
    /// (`IdentityStoreSyncProbe.runNegative1`) -- this test's own job is ONLY to toggle the
    /// provider off, then back on, bracketing that write. The disabled-store proof is entirely
    /// `os_log`-side (`IdentityStoreSyncProbe`'s own `status=store-disabled` line); no Safari
    /// check is needed or meaningful here (nothing was written to offer).
    @MainActor
    func testToggleProviderOff() throws {
        try toggleProviderSwitch()
    }

    @MainActor
    func testToggleProviderOn() throws {
        try toggleProviderSwitch()
    }

    /// Run 3, stage A (second negative control, "before"): the driving script already wrote the
    /// ORIGINAL `username` (`IdentityStoreSyncProbe.runNegative2Mutate`, which also clears any
    /// leftover identity first) and logged the "skip the choke point" event. This test asserts
    /// the QuickType sheet STILL shows the ORIGINAL username, never the (never-written) mutated
    /// one -- the observable proof that a mutation skipping the choke point leaves a stale entry.
    @MainActor
    func testNegativeControlBeforeFix() throws {
        guard let sheetText = observeQuickTypeSuggestionText() else {
            XCTFail("No QuickType suggestion surface appeared for \(Self.loginFormURL) before the fix.")
            return
        }
        XCTAssertTrue(
            sheetText.contains(Self.expectedUsername),
            "Before the fix, QuickType sheet text \"\(sheetText)\" does not contain the ORIGINAL username \"\(Self.expectedUsername)\" -- the stale-entry observation did not fire."
        )
        XCTAssertFalse(
            sheetText.contains(Self.expectedMutatedUsername),
            "Before the fix, QuickType sheet text \"\(sheetText)\" ALREADY contains the mutated username -- the choke point ran when it should not have."
        )
    }

    /// Run 3, stage B ("after"): the driving script has now run
    /// `IdentityStoreSyncProbe.runNegative2Fix` (the REAL choke point, republishing the mutated
    /// username) between stage A and this test. Asserts the QuickType sheet NOW shows the
    /// MUTATED username -- the fix reaching the user-visible surface.
    @MainActor
    func testNegativeControlAfterFix() throws {
        guard let sheetText = observeQuickTypeSuggestionText() else {
            XCTFail("No QuickType suggestion surface appeared for \(Self.loginFormURL) after the fix.")
            return
        }
        XCTAssertTrue(
            sheetText.contains(Self.expectedMutatedUsername),
            "After the fix, QuickType sheet text \"\(sheetText)\" does not contain the MUTATED username \"\(Self.expectedMutatedUsername)\" -- the correction did not reach QuickType."
        )
    }

    // MARK: - Shared Safari navigation (minimal -- reads the OFFER, never taps "Fill Password";
    // `AutoFillFillUITests.swift`'s own multi-path button-finding logic is not needed here, since
    // this file never completes a fill)

    /// Navigates Safari (relaunched fresh each call, so a PRIOR call's sheet/state never leaks
    /// into this one) to the probe's local login form, taps the username field, and returns the
    /// QuickType/AutoFill sheet's own descriptive text ("Sign in to ... with your password for
    /// ... saved in 'PasskeyVault'?") -- observed live, this session, to appear either directly or
    /// (on some runs) after tapping a "Passwords" keyboard-accessory button first
    /// (`AutoFillFillUITests.swift`'s own header documents this same non-determinism). Prints the
    /// captured text to STDOUT under a `PVUITEST|E41-2|` marker -- this file's own header explains
    /// why the assertion lives here rather than in `os_log`.
    @MainActor
    private func observeQuickTypeSuggestionText() -> String? {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-2|quicktype-sheet-text=NONE reason=no-address-bar")
            return nil
        }
        addressBar.tap()
        addressBar.typeText(Self.loginFormURL)
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-2|quicktype-sheet-text=NONE reason=no-username-field")
            return nil
        }
        usernameField.tap()

        let signInPredicate = NSPredicate(format: "label CONTAINS[c] %@", "Sign in to")
        var sheetTextElement = safari.staticTexts.matching(signInPredicate).firstMatch
        if !sheetTextElement.waitForExistence(timeout: 6) {
            let passwordsAccessory = safari.buttons["Passwords"]
            if passwordsAccessory.waitForExistence(timeout: 4) {
                passwordsAccessory.tap()
                sheetTextElement = safari.staticTexts.matching(signInPredicate).firstMatch
                _ = sheetTextElement.waitForExistence(timeout: 6)
            }
        }

        guard sheetTextElement.exists else {
            print("PVUITEST|E41-2|quicktype-sheet-text=NONE reason=sheet-never-appeared")
            return nil
        }
        let text = sheetTextElement.label
        print("PVUITEST|E41-2|quicktype-sheet-text=\(text)")
        return text
    }

    // MARK: - Settings toggle (minimal, duplicated from `AutoFillInvocationUITests`'s own primary
    // route -- see that file's own header for the navigation path's provenance)

    @MainActor
    private func toggleProviderSwitch() throws {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()

        let apps = settings.cells.containing(NSPredicate(format: "label == %@", "Apps")).firstMatch
        guard scrollUntilExists(apps, in: settings, maxSwipes: 8) else {
            XCTFail("Settings \"Apps\" row not found. Manual steps: open Settings -> Apps -> Passwords -> View AutoFill Settings -> toggle \"PasskeyVault\".")
            return
        }
        apps.tap()

        let passwordsRow = settings.cells.containing(NSPredicate(format: "label CONTAINS[c] %@", "Passwords")).firstMatch
        guard scrollUntilExists(passwordsRow, in: settings, maxSwipes: 8) else {
            XCTFail("Settings \"Apps\" -> \"Passwords\" row not found. Manual steps: open Settings -> Apps -> Passwords -> View AutoFill Settings -> toggle \"PasskeyVault\".")
            return
        }
        passwordsRow.tap()

        let viewAutoFillSettings = settings.buttons["View AutoFill Settings"]
        guard scrollUntilExists(viewAutoFillSettings, in: settings, maxSwipes: 6) else {
            XCTFail("\"View AutoFill Settings\" button not found. Manual steps: open Settings -> Apps -> Passwords -> View AutoFill Settings -> toggle \"PasskeyVault\".")
            return
        }
        viewAutoFillSettings.tap()

        let providerSwitch = settings.switches["PasskeyVault, Passwords"]
        guard scrollUntilExists(providerSwitch, in: settings, maxSwipes: 6) else {
            XCTFail("Provider switch \"PasskeyVault, Passwords\" not found. Manual steps: open Settings -> Apps -> Passwords -> View AutoFill Settings, scroll to \"PasskeyVault\" under \"AutoFill from:\", and toggle it.")
            return
        }
        // The label-matched Switch is the OUTER, row-level accessibility-merged element; the
        // ACTUAL interactive toggle pill is a nested inner Switch (`AutoFillInvocationUITests`'s
        // own established finding, this file's header).
        let innerToggle = providerSwitch.switches.firstMatch
        if innerToggle.exists {
            innerToggle.tap()
        } else {
            providerSwitch.tap()
        }

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.firstMatch.waitForExistence(timeout: 3) {
            let turnOn = springboard.buttons["Turn On"]
            if turnOn.exists {
                turnOn.tap()
            } else {
                springboard.alerts.firstMatch.buttons.element(boundBy: springboard.alerts.firstMatch.buttons.count - 1).tap()
            }
        }
        sleep(1)
    }

    @MainActor
    private func scrollUntilExists(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int) -> Bool {
        var swipes = 0
        while !element.exists && swipes < maxSwipes {
            app.swipeUp()
            swipes += 1
            _ = element.waitForExistence(timeout: 1)
        }
        return element.exists
    }
}
