// TextToInsertPreviewHostUITests.swift -- Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-06,
// Task 2 (`sc-insert`'s own direct-invocation receiver-correctness proof).
//
// Drives a REAL tap on `TextToInsertListPreviewHost.swift`'s own fixture row (`PasskeyVault` app
// target, `PV_PROBE_E44_06_INSERT`-gated) -- exercising the SAME `TextToInsertDispatch.freshCode`
// call `CredentialProviderViewController.completeTextToInsert` makes, just from the host app's own
// direct-invocation route rather than a live system-routed extension call. `scripts/ios-autofill-e44
// .sh sc-insert`'s own driving script reads the resulting `UserDefaults`-persisted observed
// code/time back and compares it against an independent RFC 6238 oracle
// (`scripts/totp-oracle.py`) -- this test's own job is only to perform the real tap and leave
// behind that ground truth, mirroring `SavePasswordFormHarnessUITests.swift`'s own established
// "this test's PASS/FAIL is not the load-bearing evidence" discipline.

import XCTest

final class TextToInsertPreviewHostUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private static let hostBundleId = "cloud.blonie.PasskeyVault"

    @MainActor
    func testTapPreviewRow() throws {
        let host = XCUIApplication(bundleIdentifier: Self.hostBundleId)
        host.activate()

        // `.any`, not `.buttons` -- the accessibility identifier is applied to the `List` row's
        // own container (outside the inner `Button`), whose queryable element type XCUITest may
        // report as `.cell`/`.other` rather than `.button`, mirroring
        // `SavePasswordFormHarnessUITests.swift`'s own `textToInsert.row.` prefix-query precedent.
        let row = host.descendants(matching: .any).matching(identifier: "textToInsert.row.pv-e44-06-preview-item").firstMatch
        guard row.waitForExistence(timeout: 10) else {
            let screenshot = XCTAttachment(screenshot: host.screenshot())
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let hierarchy = XCTAttachment(string: host.debugDescription)
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            XCTFail("textToInsert.row.pv-e44-06-preview-item never appeared under PV_PROBE_E44_06_INSERT.")
            return
        }

        let beforeScreenshot = XCTAttachment(screenshot: host.screenshot())
        beforeScreenshot.name = "insert-preview-before-tap-screenshot"
        beforeScreenshot.lifetime = .keepAlways
        add(beforeScreenshot)

        row.tap()

        let afterScreenshot = XCTAttachment(screenshot: host.screenshot())
        afterScreenshot.name = "insert-preview-after-tap-screenshot"
        afterScreenshot.lifetime = .keepAlways
        add(afterScreenshot)
    }
}
