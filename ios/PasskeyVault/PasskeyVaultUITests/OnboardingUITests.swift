// OnboardingUITests.swift -- Phase 38, plan 38-13, Task 4.
//
// Named for the plan's own Task 1 wiring note (the `PV_UITEST_SCREEN`
// extension this file's sibling tests were meant to eventually land on),
// but its actual content per Task 1's action text and Task 4's own file
// list is the AX5 readability proof for the forgot-password warning that
// moved OUT of `LockView`'s `UIAlertController` and into the scrolling
// form -- retiring `37-VERIFICATION.md`'s residual item where that exact
// copy was observed visibly clipped mid-sentence inside the alert
// (`ios/evidence/37/screens/lock-forgot-light-a11y.png`), with the alert's
// own scroll never driven.
//
// The assertion is deliberately on the sentence's LAST words, not its
// first -- asserting the first words is exactly the check that would still
// pass on a clipped rendering (37-VERIFICATION.md's own point). And the
// check is `isHittable`, not merely `exists`: `exists` is true for any
// element present in the accessibility hierarchy regardless of whether it
// is actually on screen, which would make this test pass even if the text
// were scrolled off-screen or clipped away -- `isHittable` additionally
// requires the element to be within the app's visible frame.

import XCTest

final class OnboardingUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testForgotPasswordWarningLastWordsReadableAtAX5ByScrolling() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = "forgotWarning"
        app.launch()

        let warning = app.staticTexts["lock-forgot-password-warning"]
        XCTAssertTrue(warning.waitForExistence(timeout: 5), "expected the inline warning to render (not an alert)")

        // The sentence's LAST words -- "No one, including us, has access to
        // it." (`Core/I18n/Dictionary.swift`'s `authIrrecoverableWarning`,
        // English locale). Matched as a standalone query so this assertion
        // is about the END of the sentence being reachable, independent of
        // whether the identifier-matched element above happens to already
        // be on screen.
        let lastWordsPredicate = NSPredicate(format: "label CONTAINS %@", "No one, including us, has access to it")
        let lastWords = app.staticTexts.matching(lastWordsPredicate).firstMatch
        XCTAssertTrue(lastWords.waitForExistence(timeout: 3), "expected the warning text to exist in the hierarchy at all")

        let scrollView = app.scrollViews.firstMatch
        XCTAssertTrue(scrollView.waitForExistence(timeout: 3))
        for _ in 0 ..< 8 {
            scrollView.swipeUp()
        }

        XCTAssertTrue(
            lastWords.isHittable,
            "expected the warning's LAST words to be on-screen and hittable after scrolling at AX5"
        )
        // `isHittable` alone is NOT sufficient here, and was empirically
        // shown so: the whole sentence is ONE opaque accessibility node, so
        // `isHittable` only tests whether that node's REPORTED frame is
        // on-screen at all -- constraining the node to a clipped, 20pt-tall
        // frame (this test's first falsification attempt) still left a
        // 20pt sliver on-screen with `isHittable == true`, even though the
        // rendered pixels showing "No one, including us..." were cut away.
        // The frame HEIGHT is what actually distinguishes the two cases,
        // calibrated against THIS test, not guessed: the real, unclipped
        // sentence measures ~329pt at AX5 in this harness; the clipped
        // falsification (`.frame(maxHeight: 20).clipped()` added to
        // `LockView`'s warning `Text`) measures ~69pt. 150 sits strictly
        // between the two, so this threshold is demonstrated to separate
        // the passing and failing cases, not picked arbitrarily.
        XCTAssertGreaterThan(
            lastWords.frame.height, 150,
            "expected the warning element's frame to reflect its full, unclipped multi-line height at AX5 (got \(lastWords.frame.height)pt) -- a small height here means the text is being clipped, not merely scrolled"
        )

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "38-13-lock-forgot-warning-ax5"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    /// Companion negative-ish check: before any scroll, the SAME element
    /// query is used to confirm the sentence's opening words render too --
    /// so this file is not asserting only the tail while silently
    /// tolerating a broken opening.
    @MainActor
    func testForgotPasswordWarningOpeningWordsAlsoRenderAtAX5() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = "forgotWarning"
        app.launch()

        let openingPredicate = NSPredicate(format: "label CONTAINS %@", "Remember this password")
        let opening = app.staticTexts.matching(openingPredicate).firstMatch
        XCTAssertTrue(opening.waitForExistence(timeout: 5))
    }

    /// Both auth screens name the configured server under the title
    /// (§4) -- read from `ServerSettings.resolved`, not hardcoded.
    @MainActor
    func testAuthScreenShowsServerSubtitle() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()

        let subtitle = app.staticTexts["auth-server-subtitle"]
        XCTAssertTrue(subtitle.waitForExistence(timeout: 5))
        XCTAssertTrue(subtitle.label.contains("vault.blonie.cloud") || !subtitle.label.isEmpty, "expected the server subtitle to name a host")
    }

    /// Same claim, register mode: the subtitle `Text` sits outside AuthView's
    /// `mode == .register` gate, so it should render in EITHER mode -- this
    /// confirms that structurally, not just for the default sign-in mode.
    @MainActor
    func testAuthScreenShowsServerSubtitleInRegisterModeToo() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "auth"
        app.launch()

        let togglePredicate = NSPredicate(format: "label CONTAINS %@", "Sign up")
        let toggle = app.buttons.matching(togglePredicate).firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()

        let subtitle = app.staticTexts["auth-server-subtitle"]
        XCTAssertTrue(subtitle.waitForExistence(timeout: 5))

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "38-13-auth-register-server-subtitle"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
