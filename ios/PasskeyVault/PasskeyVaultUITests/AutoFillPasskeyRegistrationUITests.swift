// AutoFillPasskeyRegistrationUITests.swift -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan
// 43-07, Task 2 (ROADMAP SC4). Drives Safari on the simulator to `crates/rp-fixture`'s own real
// `navigator.credentials.create()` page (`mode=create`) and taps through whatever system surface
// Safari shows for a passkey REGISTRATION, so the SYSTEM actually routes to this extension's new
// `prepareInterface(forPasskeyRegistration:)` override, then taps through OUR OWN confirmation
// screen (`PasskeyRegistrationConfirmView`, `passkeyRegistration.confirm`). Same discipline as
// `AutoFillPasskeyTracerUITests.swift` (Plan 43-03): the PASS/FAIL verdict is NOT this test's own
// exit status -- it is `scripts/ios-autofill-e43.sh sc4`'s own DIRECT `GET /api/vault/items`
// assertion against the live server, AFTER this test completes (RECEIVER-SIDE proof, never "our
// extension logged a registration" alone).
//
// DEVIATION (Rule 2, GSD executor rules): 43-07-PLAN.md's own `files_modified` list does not name
// this file -- the SAME gap `AutoFillPasskeyTracerUITests.swift` already documents for the
// assertion tracer applies identically here: driving a real system passkey-registration surface
// requires XCUITest, no `simctl` subcommand can synthesize a tap.
//
// This flow has NO precedent test in this codebase -- the FIRST live registration ceremony drive.
// The exact system confirmation surface's wording is not known in advance (mirrors
// `AutoFillPasskeyTracerUITests`'s own disclaimer for the assertion side); this test polls for
// several plausible candidates across a bounded window, capturing a screenshot+hierarchy at every
// step regardless of outcome, so a run that does NOT reach our own confirmation screen is still
// fully diagnosable from the xcresult bundle alone.

import Foundation
import XCTest

final class AutoFillPasskeyRegistrationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// MUST match `crates/rp-fixture`'s own pinned port (same inventory `AutoFillPasskeyTracerUITests`
    /// already reads from).
    private static let fixtureHost = "localhost"
    private static let fixturePort = 8900

    @MainActor
    func testPasskeyRegistrationAgainstRpFixture() throws {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: safari, message: "Safari address bar never appeared.")
            return
        }
        addressBar.tap()

        let userName = ProcessInfo.processInfo.environment["PV_E43_SC4_USERNAME"] ?? "ios-sc4-registration"
        let fixtureURL = "http://\(Self.fixtureHost):\(Self.fixturePort)/?rp_id=localhost&mode=create&user_name=\(userName)"
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

        // The ceremony now runs: `navigator.credentials.create()` should prompt the system's own
        // passkey-registration surface (a "Save Passkey" sheet, or -- per `AutoFillPasskeyTracerUITests`'s
        // own live finding for the SIBLING assertion flow -- an "Other accounts"/provider-choice row
        // naming this extension by name). System-presented sheets overlaid on the foreground app are
        // queryable via SpringBoard's own `XCUIApplication`, the same route the assertion tracer
        // already established.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [safari, springboard]

        var selectedProvider = false
        var tappedContinue = false
        var tappedCreatePasskey = false
        let deadline = Date().addingTimeInterval(30)
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            var actedThisPoll = false

            // Our OWN confirmation screen (`PasskeyRegistrationConfirmView`, `passkeyRegistration
            // .confirm`) -- checked FIRST every poll, since once the system has already routed to
            // our extension, this is the only remaining tap and should short-circuit the
            // provider-selection search below.
            if !tappedCreatePasskey {
                for app in candidateApps {
                    let byIdentifier = app.buttons["passkeyRegistration.confirm"]
                    if byIdentifier.exists, byIdentifier.isHittable {
                        attachDiagnostics(app: app, label: "confirm-button-found-poll\(pollCount)")
                        byIdentifier.tap()
                        tappedCreatePasskey = true
                        actedThisPoll = true
                        break
                    }
                    if let element = Self.firstHittableElement(in: app, labelContains: "Create passkey") {
                        attachDiagnostics(app: app, label: "confirm-label-found-poll\(pollCount)")
                        element.tap()
                        tappedCreatePasskey = true
                        actedThisPoll = true
                        break
                    }
                }
            }

            if !tappedCreatePasskey, !selectedProvider {
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
            // LIVE FINDING (this session, first run): the system's own "Save Passkey" sheet's
            // confirm button carries NO "Continue" label at all -- its real label is "Add Passkey"
            // (the ObjC-owned `identifier: 'ASAuthorizationControllerContinueButton'`, confirmed
            // from this test's own captured accessibility hierarchy, `provider-row-found-poll2-
            // hierarchy`). Checked by IDENTIFIER first (stable, not localization-dependent), the
            // "Continue"/"Add Passkey" label texts as a fallback -- mirrors
            // `AutoFillPasskeyTracerUITests`'s own "exact wording not known in advance" disclaimer,
            // now settled empirically for THIS surface.
            if !tappedCreatePasskey, selectedProvider, !tappedContinue {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, identifier: "ASAuthorizationControllerContinueButton")
                        ?? Self.firstHittableElement(in: app, labelContains: "Add Passkey")
                        ?? Self.firstHittableElement(in: app, labelContains: "Continue")
                    {
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
            if tappedCreatePasskey {
                break
            }
            if !actedThisPoll {
                usleep(500_000)
            }
        }

        // Settle margin: the fixture's own JS finish-fetch, our extension's own ceremony, AND the
        // network POST to the live server all need a moment after the last tap.
        sleep(3)
        attachDiagnostics(
            app: safari,
            label: "final-state-selectedProvider=\(selectedProvider)-tappedContinue=\(tappedContinue)-tappedCreatePasskey=\(tappedCreatePasskey)"
        )
    }

    /// Identifier-exact counterpart to `firstHittableElement(in:labelContains:)` below -- for
    /// system-owned surfaces whose confirm control carries a stable ObjC identifier
    /// (`ASAuthorizationControllerContinueButton`) but no reliable, localization-independent
    /// `label` (this test's own live finding: its real label is "Add Passkey", not "Continue").
    @MainActor
    private static func firstHittableElement(in app: XCUIApplication, identifier: String) -> XCUIElement? {
        let predicate = NSPredicate(format: "identifier == %@", identifier)
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

    /// Best-effort element lookup across every element TYPE (`.any`), not just `.buttons` -- mirrors
    /// `AutoFillPasskeyTracerUITests`'s own helper verbatim (duplicated, not shared -- separate UI
    /// test files, no shared framework between them, this project's established discipline).
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

    // MARK: - Helpers (duplicated from AutoFillPasskeyTracerUITests.swift's own precedent -- no
    // shared framework between separate UI test files, matching this project's established
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
