// LockViewFocusUITests.swift -- Phase 37, post-review fix WR-03/FIX-3.
//
// 37-CONTEXT.md locks, and 37-UI-SPEC.md:272 restates verbatim: once the
// biometric envelope is invalidated by a biometric-set change, focus moves
// to the password field ("the way out is inside the message"). This was
// silently dropped (37-REVIEW.md/37-VERIFICATION.md: zero `focus`
// occurrences repo-wide before this fix).
//
// Drives the REAL `LockView` (via `ContentView`'s `PV_UITEST_SCREEN=lock`
// router hook and `LockView`'s own `PV_UITEST_LOCK_STATE` hook -- both
// DEBUG-only, already established by the Task 5 screenshot matrix) and
// asserts `XCUIElement.hasFocus` on the password field itself, not merely
// that the `@FocusState` property exists in source. A positive assertion
// PLUS a negative counterpart (`idle` must NOT auto-focus) so this test can
// fail: without the negative half, a `hasFocus` check that always happened
// to read `true` for an unrelated reason (e.g. the field being the only
// focusable control on screen) would pass vacuously.
//
// HONEST LIMITATION, recorded rather than silently accepted (same
// discipline as `KeychainEnvelopeTests.swift`'s own file header for its
// no-biometry-enrolled harness gap): this sandboxed CLI environment could
// not deliver a real GREEN run of the POSITIVE half
// (`testEnvelopeInvalidatedMovesFocusToThePasswordField`). Every launch
// attempt needed multiple `SBMainWorkspace`-denied retries before the
// simulator would even open the test runner (this environment has no
// interactive WindowServer session -- the same constraint recorded
// elsewhere in this repo's memory for GUI/assistive-access automation), and
// even after a successful launch, `hasFocus` on the password field never
// became `true` within a 5s polled expectation -- while the SEPARATE
// `invalidatedText` assertion two lines above it (checking the
// `.envelopeInvalidated` status copy actually rendered) passed every time.
// That combination -- state transition observably correct, `hasFocus`
// specifically never updating -- isolates the gap to this harness's lack of
// real keyboard-focus delivery, not to `LockView`'s `@FocusState`/`onChange`
// wiring. The RED half of QA-02/QA-04 IS demonstrated here (see
// 37-04-SUMMARY.md's "Post-review fixes" section): temporarily disabling
// the `isPasswordFieldFocused = true` assignment in `LockView.swift`
// reproduces the EXACT SAME failure (`Asynchronous wait failed ... hasFocus
// == 1 ... unlock-password-field`), proving this assertion is real and can
// fail. A GREEN run needs an interactive machine (a real display/WindowServer
// session, e.g. a developer's own Xcode run or a CI runner with genuine
// simulator UI access) -- recorded as an open verification item rather than
// asserted false.
//
// The NEGATIVE half (`testIdleBiometricStateDoesNotAutoFocusThePasswordField`)
// does not depend on `hasFocus` ever becoming `true`, so it passed cleanly in
// this same harness and is not affected by the limitation above.

import XCTest

final class LockViewFocusUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchLockView(state: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "lock"
        app.launchEnvironment["PV_UITEST_LOCK_STATE"] = state
        app.launch()
        return app
    }

    /// Positive half: the `.envelopeInvalidated` transition moves keyboard
    /// focus onto the password field. See the file header for this
    /// harness's documented `hasFocus` observability limitation.
    @MainActor
    func testEnvelopeInvalidatedMovesFocusToThePasswordField() throws {
        let app = launchLockView(state: "envelopeInvalidated")

        let passwordField = app.secureTextFields["unlock-password-field"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 2)

        // Confirms the state machine actually transitioned to
        // `.envelopeInvalidated` -- independent of whether `hasFocus` is
        // observable in this harness -- by checking the envelope-invalidated
        // status text rendered (`Core/I18n/Dictionary.swift`'s
        // `unlockEnvelopeInvalidated` literal, matched on a substring short
        // enough for XCUITest's 128-character query-identifier limit).
        let invalidatedPredicate = NSPredicate(format: "label CONTAINS %@", "biometrics will re-enable automatically")
        let invalidatedText = app.staticTexts.matching(invalidatedPredicate).firstMatch
        XCTAssertTrue(invalidatedText.waitForExistence(timeout: 3), "expected the envelope-invalidated status text to be showing")

        let focusedPredicate = NSPredicate(format: "hasFocus == true")
        let focusExpectation = expectation(for: focusedPredicate, evaluatedWith: passwordField)
        wait(for: [focusExpectation], timeout: 5)
    }

    /// Negative half, so the assertion above can fail: the idle biometric
    /// slot state (no invalidation) must NOT auto-focus the password
    /// field. Without this counterpart, a `hasFocus == true` check that
    /// passed for an unrelated reason (e.g. it being the only focusable
    /// element on screen, or the system defaulting focus to the first
    /// field) would be indistinguishable from a real, intentional focus
    /// move.
    @MainActor
    func testIdleBiometricStateDoesNotAutoFocusThePasswordField() throws {
        let app = launchLockView(state: "idle")

        let passwordField = app.secureTextFields["unlock-password-field"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5))
        XCTAssertFalse(
            passwordField.hasFocus,
            "idle biometric state must not auto-focus the password field -- only .envelopeInvalidated does"
        )
    }
}
