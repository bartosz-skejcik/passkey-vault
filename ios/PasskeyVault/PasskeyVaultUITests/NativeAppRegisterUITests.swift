// NativeAppRegisterUITests.swift -- `.planning/debug/passkey-reg-blank-sheet-discord.md`
// diagnostic, 2026-08-22. The REGISTRATION counterpart to `NativeAppSignInUITests.swift`
// (Plan 43-08's SC2 ASSERTION proof) -- drives the ALREADY-RUNNING `PasskeyVaultHarness` process's
// NEW "Create Passkey" button (`NativeCreateView.swift`), then taps through whatever system
// credential-picker/confirm surface the OS shows for a REQUESTING-side
// `ASAuthorizationController` passkey REGISTRATION ceremony from a genuine native app.
//
// Structure and every landmine-avoidance duplicated VERBATIM from `NativeAppSignInUITests.swift`
// (this project's own established discipline: no shared framework between separate UI test
// files) -- `.activate()` never `.launch()`, "More from" never bare "PasskeyVault", the
// `!actedThisPoll` settle gate, and the identifier-first/"Continue"/"Add Passkey" fallback chain
// for the confirm control (43-07's own live finding: a REGISTRATION confirm's real label is "Add
// Passkey", not "Continue").
//
// UNLIKE the sign-in sibling, THIS test does not assert PASS/FAIL by grepping a fixture's own
// `/assert/finish` line -- no `crates/rp-fixture` round trip exists for this diagnostic (see
// `NativeCreateView.swift`'s own header). The verdict is entirely: (a) the harness's own
// `nativeCreate.status` terminal state, and (b) `scripts/ios-autofill-e43.sh
// native-app-register`'s own OS-log capture of `PVFILL|passkey-reg|`/`PVDIAG|` lines from the
// EXTENSION process's log (subsystem `cloud.blonie.PasskeyVault`) -- the actual question this
// whole diagnostic exists to answer.
//
// DEVIATION (Rule 2, GSD executor rules): no existing plan names this file -- same class of gap
// `NativeAppSignInUITests.swift`'s own header already documents for its own sibling.

import Foundation
import XCTest

final class NativeAppRegisterUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private static let harnessBundleId = "cloud.blonie.PasskeyVaultHarness"

    @MainActor
    func testNativeRegister() throws {
        let harness = XCUIApplication(bundleIdentifier: Self.harnessBundleId)
        // `.activate()`, never `.launch()` -- see this file's own header / the sign-in sibling's.
        harness.activate()

        let createButton = harness.buttons["nativeCreate.button"]
        guard createButton.waitForExistence(timeout: 10) else {
            recordFailureWithDiagnostics(app: harness, message: "PasskeyVaultHarness's own 'Create Passkey' button never appeared.")
            return
        }
        attachDiagnostics(app: harness, label: "before-create-tap")
        createButton.tap()
        attachDiagnostics(app: harness, label: "after-create-tap")

        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let candidateApps = [harness, springboard]

        var selectedProvider = false
        var tappedContinue = false
        let deadline = Date().addingTimeInterval(45)
        var pollCount = 0
        while Date() < deadline {
            pollCount += 1
            var actedThisPoll = false

            // LIVE FINDING this session (locked-mode run, poll screenshots): a REGISTRATION
            // request's own default system sheet ("Save a passkey?") is a COMPLETELY DIFFERENT
            // shape from the assertion sheet `NativeAppSignInUITests.swift`'s own precedent
            // established -- "PasskeyVault" is shown ALREADY CHECKED (a real "R" app-icon row,
            // "Save in PasskeyVault") with NO "More from ..." row to tap at all; the confirm
            // button reads "Add Passkey" directly. Gating the "Add Passkey" search behind a
            // `selectedProvider` flag that this shape never sets (there is no separate
            // row-selection step here) meant the FIRST run of this test never even searched for
            // it. `!selectedProvider` fallback below still handles the case where PasskeyVault is
            // NOT the pre-checked default (e.g. iCloud Keychain present) and a "More from"/row-tap
            // step really is required first, mirroring the sign-in sibling's own established
            // pattern for that shape.
            if !selectedProvider {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, labelContains: "More from") {
                        attachDiagnostics(app: app, label: "provider-row-found-poll\(pollCount)")
                        element.tap()
                        usleep(750_000)
                        selectedProvider = true
                        actedThisPoll = true
                        break
                    }
                }
            }
            // UNCONDITIONAL (never gated behind `selectedProvider`) -- see this block's own note
            // above. `!actedThisPoll` still applies, so a "More from" tap this SAME iteration gets
            // its own settle margin before this search runs (mirrors the sign-in sibling's own
            // `!actedThisPoll` discipline for the SAME reason: a row-selection checkmark needs a
            // real moment to update before the next control is searched for). "Save" is
            // DELIBERATELY excluded from the label fallback chain -- this sheet's own "Save on
            // Other Device" button also contains that substring and would derail the ceremony into
            // an unrelated cross-device QR flow.
            // LIVE FINDING this session (post-fix verification run): after the `.refuseLocked`
            // fix (cancelRequest now carries `.failed`, never `.userInteractionRequired`), the
            // system's own 'Save a passkey?' sheet DISMISSES ITSELF promptly after the FIRST tap
            // (unlike the pre-fix run, where it lingered, still-hittable, for the full poll
            // window) -- a SECOND poll's fresh element-existence check (inside `firstHittableElement`)
            // still returned a stale, about-to-vanish reference (the AX cache had not caught up),
            // and `.tap()` on it threw a hard XCTest failure ("no matches found") rather than a
            // graceful no-op. `.exists` is re-checked immediately before `.tap()` (as close to
            // atomic with the tap as XCUITest allows) to close this race; if the sheet has already
            // gone, this poll simply does nothing rather than crashing the whole test.
            if !actedThisPoll {
                for app in candidateApps {
                    if let element = Self.firstHittableElement(in: app, identifier: "ASAuthorizationControllerContinueButton")
                        ?? Self.firstHittableElement(in: app, labelContains: "Add Passkey")
                        ?? Self.firstHittableElement(in: app, labelContains: "Continue")
                    {
                        attachDiagnostics(app: app, label: "continue-found-poll\(pollCount)")
                        if element.exists {
                            element.tap()
                            tappedContinue = true
                            actedThisPoll = true
                        }
                        break
                    }
                }
            }

            // OUR OWN confirmation screen (`PasskeyRegistrationConfirmView`, accessibility
            // identifier `passkeyRegistration.confirm`) -- reached only if the vault is
            // UNLOCKED. Never expected when testing the LOCKED case (`.refuseLocked` cancels
            // before this screen is ever presented) -- harmless no-op search otherwise.
            for app in candidateApps {
                if let element = Self.firstHittableElement(in: app, identifier: "passkeyRegistration.confirm") {
                    attachDiagnostics(app: app, label: "pv-confirm-found-poll\(pollCount)")
                    element.tap()
                    actedThisPoll = true
                    break
                }
            }

            if pollCount <= 5 || actedThisPoll {
                attachDiagnostics(app: harness, label: "poll-\(pollCount)")
            }

            let statusLabel = harness.staticTexts["nativeCreate.status"]
            if statusLabel.exists {
                let currentStatus = statusLabel.label
                if currentStatus == "Created" || currentStatus.hasPrefix("Failed") {
                    attachDiagnostics(app: harness, label: "terminal-status-poll\(pollCount)-status=\(currentStatus)")
                    break
                }
            }
            if !actedThisPoll {
                usleep(500_000)
            }
        }

        sleep(3)
        let statusLabel = harness.staticTexts["nativeCreate.status"]
        let statusText = statusLabel.exists ? statusLabel.label : "<status label not found>"
        attachDiagnostics(
            app: harness,
            label: "final-state-selectedProvider=\(selectedProvider)-tappedContinue=\(tappedContinue)-status=\(statusText)"
        )
    }

    // MARK: - Helpers (duplicated from NativeAppSignInUITests.swift's own precedent -- no shared
    // framework between separate UI test files, this project's established discipline).

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
