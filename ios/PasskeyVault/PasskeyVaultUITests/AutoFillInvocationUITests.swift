// AutoFillInvocationUITests.swift -- Phase 36, Plan 36-01, Task 1.
//
// Drives a REAL system UI surface (Settings.app) until
// PasskeyVaultAutoFill.appex is actually launched by the OS, so the
// "backstop" truth ("The extension process is reachable by an automated,
// repeatable trigger ... rather than by a hand-tap") is discharged, and so
// every later experiment in this phase (36-02..36-04) can be re-run without
// a human.
//
// Primary route (default), the REAL navigation on iOS 26.5 (established by
// live exploration this session -- not guessed from documentation, which
// still describes the pre-iOS-18 "Password Options" location):
//   Settings -> Apps -> Passwords -> "View AutoFill Settings" ->
//   AutoFill & Passwords -> toggle the "PasskeyVault" switch under
//   "AutoFill from:" ON.
// "Passwords" moved out of Settings' own top-level list into a standalone
// app (com.apple.Passwords) in iOS 18+; Settings' own in-app search index
// does NOT cover the Apps-hosted per-app settings page ("No Results for
// \"Passwords\"" was observed live), so this route navigates the real
// Settings -> Apps -> Passwords hierarchy directly rather than relying on
// search. Toggling the switch is exactly the transition that invokes
// `prepareInterfaceForExtensionConfiguration()` on our extension (first-run
// setup before a provider is armed) -- this is what stage=configure's
// PVPROBE| line proves.
//
// Secondary route (env-var selected fallback, NOT exercised by default):
// drive Safari to a local login form and take the AutoFill QuickType row.
// Left as a documented, compiled-in fallback per 36-01-PLAN.md Task 1
// action 7 -- it targets `provideCredentialWithoutUserInteraction`/
// `prepareInterfaceToProvideCredential`, which require the provider to
// already be ELECTED (Task 3's layer b), so it is not the tracer's
// baseline path.
//
// Never pass on an un-invoked extension: if the real navigation path
// cannot be driven, the test FAILS with the exact manual steps named,
// rather than silently succeeding.

import XCTest

final class AutoFillInvocationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Bundle id our app is built with (cloud.blonie.PasskeyVault,
    /// project.pbxproj `PRODUCT_BUNDLE_IDENTIFIER`). The provider row in
    /// the AutoFill & Passwords list shows the containing APP's display
    /// name -- PRODUCT_NAME "PasskeyVault", no custom CFBundleDisplayName
    /// set on the host app target -- so we match on "PasskeyVault", not
    /// the extension's own "Passkey Vault AutoFill" display name. Observed
    /// live: the switch's accessibility label is exactly
    /// "PasskeyVault, Passwords".
    private static let providerSwitchLabel = "PasskeyVault, Passwords"

    @MainActor
    func testInvokeExtensionConfigurationViaSettingsAutoFillToggle() throws {
        // Phase 36, Plan 36-02, Task 2 (E3) sequencing: launch the host app
        // FIRST, unconditionally, so PasskeyVaultApp's PV_PROBE_KEYCHAIN-gated
        // ProbeSeeder.seed() call (a no-op under every other probe condition)
        // always lands before the extension is invoked -- one ordered run,
        // not two hopeful ones. Harmless for every other probe: launching
        // the host app costs a few hundred ms and nothing else observes it.
        let host = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
        host.launch()

        if ProcessInfo.processInfo.environment["PV_AUTOFILL_UITEST_ROUTE"] == "safari-quicktype" {
            try runSecondaryRoute()
            return
        }
        try runPrimaryRoute()
    }

    // MARK: - Primary route

    @MainActor
    private func runPrimaryRoute() throws {
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.launch()

        // Settings -> Apps (below the fold on first launch -- scroll to
        // reveal it; do not assume a fixed row position).
        let apps = settings.cells.containing(NSPredicate(format: "label == %@", "Apps")).firstMatch
        if !scrollUntilExists(apps, in: settings, maxSwipes: 8) {
            recordFailureWithDiagnostics(
                app: settings,
                message: "Settings \"Apps\" row not found after scrolling. Manual steps: open " +
                    "Settings -> Apps -> Passwords -> View AutoFill Settings -> toggle " +
                    "\"PasskeyVault\" on."
            )
            return
        }
        apps.tap()

        // Apps -> Passwords (the per-app settings page for the standalone
        // com.apple.Passwords app).
        let passwordsRow = settings.cells.containing(
            NSPredicate(format: "label CONTAINS[c] %@", "Passwords")
        ).firstMatch
        if !scrollUntilExists(passwordsRow, in: settings, maxSwipes: 8) {
            recordFailureWithDiagnostics(
                app: settings,
                message: "Settings \"Apps\" -> \"Passwords\" row not found after scrolling. Manual " +
                    "steps: open Settings -> Apps -> Passwords -> View AutoFill Settings -> toggle " +
                    "\"PasskeyVault\" on."
            )
            return
        }
        passwordsRow.tap()

        // Passwords -> "View AutoFill Settings" button.
        let viewAutoFillSettings = settings.buttons["View AutoFill Settings"]
        if !scrollUntilExists(viewAutoFillSettings, in: settings, maxSwipes: 6) {
            recordFailureWithDiagnostics(
                app: settings,
                message: "\"View AutoFill Settings\" button not found on the Passwords app-settings " +
                    "page after scrolling. Manual steps: open Settings -> Apps -> Passwords -> View " +
                    "AutoFill Settings -> toggle \"PasskeyVault\" on."
            )
            return
        }
        viewAutoFillSettings.tap()
        attachDiagnostics(app: settings, label: "autofill-and-passwords-screen")

        // AutoFill & Passwords -> our provider's switch, under "AutoFill
        // from:". Observed live at this label, un-scrolled, but scroll
        // defensively in case the "AutoFill from:" list grows.
        let providerSwitch = settings.switches[Self.providerSwitchLabel]
        if !scrollUntilExists(providerSwitch, in: settings, maxSwipes: 6) {
            recordFailureWithDiagnostics(
                app: settings,
                message: "Provider switch \"\(Self.providerSwitchLabel)\" not found on the AutoFill " +
                    "& Passwords screen after scrolling. Manual steps: open Settings -> Apps -> " +
                    "Passwords -> View AutoFill Settings, scroll to \"PasskeyVault\" under " +
                    "\"AutoFill from:\", and toggle it on."
            )
            return
        }
        // The label-matched Switch above is the OUTER, row-level
        // accessibility-merged element (SwiftUI List row); the ACTUAL
        // interactive toggle pill is a smaller, unlabeled Switch nested
        // inside it, positioned at the row's trailing edge (observed live:
        // outer row spans the full row width, inner pill is ~63x28pt at
        // the right). Tapping the outer element's center lands over the
        // row's text labels, not the pill, and produces no state change --
        // confirmed live: value stayed 0 across multiple tap attempts on
        // the outer element. Tap the nested inner switch instead.
        let innerToggle = providerSwitch.switches.firstMatch
        if innerToggle.exists {
            innerToggle.tap()
        } else {
            providerSwitch.tap()
        }
        attachDiagnostics(app: settings, label: "immediately-after-toggle-tap")

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.alerts.firstMatch.waitForExistence(timeout: 3) {
            attachDiagnostics(app: springboard, label: "springboard-alert-after-toggle")
            let turnOn = springboard.buttons["Turn On"]
            if turnOn.exists {
                turnOn.tap()
            } else {
                springboard.alerts.firstMatch.buttons.element(boundBy: springboard.alerts.firstMatch.buttons.count - 1).tap()
            }
        }
        if settings.sheets.firstMatch.waitForExistence(timeout: 2) {
            attachDiagnostics(app: settings, label: "settings-sheet-after-toggle")
        }

        // Give the system a moment to spin up the extension process and
        // present its configuration UI (which itself may cover this
        // screen) before the test ends -- ios-probe-run.sh's log capture
        // runs after this test completes.
        sleep(2)
        attachDiagnostics(app: settings, label: "after-provider-switch-toggle")
    }

    // MARK: - Secondary route (documented fallback, env-var selected)

    @MainActor
    private func runSecondaryRoute() throws {
        // Deliberately minimal: this route targets Phase 41's real-fill
        // overloads, which additionally require our provider to already be
        // ELECTED (36-01-PLAN.md Task 3, layer b) -- out of this tracer
        // task's scope to make green by default. Compiled in so a later
        // phase can select it via PV_AUTOFILL_UITEST_ROUTE=safari-quicktype
        // without writing new navigation code from scratch.
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(
                app: safari,
                message: "Safari address bar never appeared. Manual steps: open Safari, navigate " +
                    "to a page with a login form, tap the username field, and select the " +
                    "\"PasskeyVault\" row from the QuickType AutoFill bar."
            )
            return
        }
        addressBar.tap()
        // A self-contained data: URL login form -- no network dependency,
        // no local server to stand up for this fallback.
        let loginFormURL =
            "data:text/html,<form><input id=u type=text name=username " +
            "autocomplete=username><input id=p type=password " +
            "name=password autocomplete=current-password></form>"
        addressBar.typeText(loginFormURL)
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(
                app: safari,
                message: "Login form's username field never appeared in Safari's WebView. Manual " +
                    "steps: open the login form manually, tap the username field, and select the " +
                    "\"PasskeyVault\" QuickType AutoFill row."
            )
            return
        }
        usernameField.tap()
        sleep(2)
    }

    // MARK: - Helpers

    /// Swipes `app` up until `element` exists (or `maxSwipes` is reached),
    /// re-checking existence after each swipe. Returns whether the element
    /// was found.
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

    /// Unconditional (pass or fail) screenshot + hierarchy attachment at a
    /// named checkpoint -- used to make each navigation step's real state
    /// inspectable from the xcresult bundle without needing a failure.
    @MainActor
    private func attachDiagnostics(app: XCUIApplication, label: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(label)-screenshot"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(label)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    /// Attaches a screenshot AND the full accessibility hierarchy dump to
    /// the test result before failing -- so a real FAIL here always carries
    /// enough evidence to fix the navigation, rather than a bare assertion
    /// message (this project's own QA-02/QA-04 evidence discipline applied
    /// to test failures, not only to product assertions).
    @MainActor
    private func recordFailureWithDiagnostics(app: XCUIApplication, message: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.lifetime = .keepAlways
        add(hierarchy)

        XCTFail(message)
    }
}
