// AutoFillPasskeyTracerUITests.swift -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan
// 43-03, Task 2 (the tracer). Drives Safari on the simulator to `crates/rp-fixture`'s own real
// `navigator.credentials.get()` page and taps through whatever system confirmation surface Safari
// shows for a passkey assertion, so the SYSTEM actually routes to this extension's new
// `.passkeyAssertion` branch. The PASS/FAIL verdict is NOT this test's own exit status -- it is
// `crates/rp-fixture`'s own `/assert/finish` result, captured from the fixture PROCESS's stdout
// log by `scripts/ios-autofill-e43.sh tracer` AFTER this test completes (RECEIVER-SIDE proof, an
// independent `webauthn-rs` verifier, never "our extension logged a fill" -- this plan's own
// `must_haves.truths`). This test's job is only to drive the interaction as far as it can and
// capture diagnostics along the way -- a `SUCCEEDED` xcodebuild exit here is NOT itself evidence
// the ceremony verified (L-30's caution: a test that always reports pass regardless of what
// happened is a vacuous gate); the shell script's own log-grep is the load-bearing check.
//
// DEVIATION (Rule 2, GSD executor rules): 43-03-PLAN.md's own `files_modified` list does not name
// this file. Driving a real system passkey-confirmation surface requires XCUITest (no `simctl`
// subcommand can synthesize a tap) -- the SAME class of gap `TracerFillSeeder.swift`/
// `AutoFillFillUITests.swift` (Plan 41-03) already document for the password tracer, resolved the
// same way here: a real UI-driving test, documented as a deviation rather than silently added.
//
// This flow has NO precedent test in this codebase (Phase 41's tracer drives a PASSWORD fill via
// the AutoFill keyboard accessory; this is the FIRST live native WebAuthn ceremony against a
// third-party-shaped page). The exact system confirmation surface's wording was not known in
// advance -- this test polls for several plausible candidates (a system alert's "Continue"/
// "Allow" button, or this extension's own provider name) over a bounded window, alongside a
// PARALLEL external `notifyutil`-driven biometric-match loop the driving script runs for this
// test's whole duration (mirroring `cmd_tracer`'s own `run_pearl_match_loop`, `ios-autofill-e41.sh`
// header) -- captures a screenshot+hierarchy at every step regardless of outcome, so a run that
// does NOT reach the fixture's own verify endpoint is diagnosable from the xcresult bundle alone.

import Foundation
import XCTest

final class AutoFillPasskeyTracerUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// MUST match `crates/rp-fixture`'s own pinned port (43-03-PLAN.md Task 1's own
    /// `<read_first>` port-inventory grep) and `PasskeyTracerSeeder`'s own `rp_id=localhost`
    /// assumption.
    private static let fixtureHost = "localhost"
    private static let fixturePort = 8900

    @MainActor
    func testPasskeyAssertionAgainstRpFixture() throws {
        // Host app FIRST, unconditionally -- PV_PROBE_E43_TRACER's seed sequence
        // (`PasskeyTracerSeeder.seed()`) must land before the extension is ever invoked, same
        // ordered sequence every other Phase 36/41/43 probe in this project already establishes.
        let host = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
        host.launch()
        // The seed sequence reads one file + writes Keychain/UserDefaults/one App Group file, no
        // network -- a generous fixed margin, matching `AutoFillFillUITests`'s own precedent for
        // this exact class of wait (a sandboxed container this test-runner process cannot poll
        // directly).
        sleep(3)

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: safari, message: "Safari address bar never appeared.")
            return
        }
        addressBar.tap()

        let fixtureURL = "http://\(Self.fixtureHost):\(Self.fixturePort)/?rp_id=localhost&mode=get"
        addressBar.typeText(fixtureURL)
        addressBar.typeText("\n")

        let startButton = safari.webViews.buttons["Start"]
        guard startButton.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: safari, message: "rp-fixture's own Start button never appeared in Safari's WebView.")
            return
        }
        attachDiagnostics(app: safari, label: "before-start-tap")
        startButton.tap()
        attachDiagnostics(app: safari, label: "after-start-tap")

        // The ceremony now runs: `navigator.credentials.get()` should prompt the system's own
        // passkey-selection/confirmation surface. Candidate labels are best-effort -- this is the
        // FIRST live run of this exact flow in this codebase, so the exact wording is not known in
        // advance; each candidate is tried across a bounded polling window, and every step is
        // captured to diagnostics regardless of whether a candidate matched, so a run that never
        // finds one is still fully diagnosable from the xcresult bundle.
        // FINDING, live this session (first attempt): with NO `ASPasskeyCredentialIdentity`
        // registered for this credential (identity-store registration for passkeys is explicitly
        // NOT this plan's job -- 43-05 onward), Safari does NOT route straight to our provider's
        // `provideCredentialWithoutUserInteraction`/`prepareInterfaceToProvideCredential`. It
        // shows its own "Sign In" system sheet ("You don't have any passwords or passkeys saved
        // for this website...") listing "Scan QR Code"/"Use Security key" plus an "Other accounts"
        // section carrying an entry labeled "More from PasskeyVault..." (our extension, by name and
        // icon) -- selecting that row, then tapping "Continue", is what invokes our extension's
        // ceremony. This sheet's own accessibility elements are NOT part of Safari's own tree
        // (`safari.buttons[...]` never sees them, confirmed by an empty hierarchy dump on the FIRST
        // run of this exact test) -- they belong to a separate system-owned surface, queryable via
        // SpringBoard's own `XCUIApplication`, the standard XCUITest route to system-presented
        // sheets/alerts overlaid on the foreground app.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [safari, springboard]

        var selectedProvider = false
        var tappedContinue = false
        let deadline = Date().addingTimeInterval(25)
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            var actedThisPoll = false

            if !selectedProvider {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, labelContains: "PasskeyVault") {
                        attachDiagnostics(app: app, label: "provider-row-found-poll\(pollCount)")
                        element.tap()
                        selectedProvider = true
                        actedThisPoll = true
                        break
                    }
                }
            }
            if selectedProvider, !tappedContinue {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, labelContains: "Continue") {
                        attachDiagnostics(app: app, label: "continue-found-poll\(pollCount)")
                        element.tap()
                        tappedContinue = true
                        actedThisPoll = true
                        break
                    }
                }
            }

            if pollCount <= 5 || actedThisPoll {
                attachDiagnostics(app: safari, label: "poll-\(pollCount)")
            }
            if tappedContinue {
                break
            }
            if !actedThisPoll {
                usleep(500_000)
            }
        }

        // Settle margin: the fixture's own JS finish-fetch and the extension's own ceremony both
        // need a moment after the last tap (or after the biometric-match loop alone satisfies a
        // confirmation the polling loop above never needed to tap through).
        sleep(3)
        attachDiagnostics(app: safari, label: "final-state-selectedProvider=\(selectedProvider)-tappedContinue=\(tappedContinue)")
    }

    /// Best-effort element lookup across every element TYPE (`.any`), not just `.buttons` -- the
    /// system "Sign In" sheet's rows were found live to NOT be plain buttons in every case. Case-
    /// insensitive CONTAINS match (the provider row's real label is "More from PasskeyVault...",
    /// never the bare app name).
    @MainActor
    private static func firstHittableElement(in app: XCUIApplication, labelContains text: String) -> XCUIElement? {
        let predicate = NSPredicate(format: "label CONTAINS[cd] %@", text)
        let query = app.descendants(matching: .any).matching(predicate)
        let count = min(query.count, 5)
        guard count > 0 else { return nil }
        for i in 0..<count {
            let element = query.element(boundBy: i)
            if element.exists && element.isHittable {
                return element
            }
        }
        return nil
    }

    // MARK: - Helpers (duplicated from AutoFillFillUITests.swift's own precedent -- separate UI
    // test files, no shared framework between them, matching this project's established
    // discipline for this exact class of helper).

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
