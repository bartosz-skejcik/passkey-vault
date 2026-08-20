// AutoFillThirdPartyDomainUITests.swift -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-
// procesami), plan 41-08, Task 1 (E41-8/FILL-04).
//
// The load-bearing proof for FILL-04: a password filled on a domain this product does not
// control and for which NO `apple-app-site-association` file could EVER exist -- never the
// absence of the `com.apple.developer.associated-domains` entitlement (QA-03; that absence is
// recorded as CONTEXT ONLY by `scripts/ios-autofill-e41.sh e41-8`'s own entitlement-dump section,
// never as the proof itself, per this plan's own `<prohibitions>`).
//
// Domain choice: `127.0.0.1:8770` (loopback, a fresh port never used by any other E41
// subcommand), served by a throwaway local HTTP server this plan's own harness starts
// (`ensure_e41_8_server`, mirroring `ensure_tracer_server`'s established shape). A loopback
// address is not a registrable DNS domain at all: it can never carry a CT-logged,
// publicly-trusted TLS certificate, and Apple's own AASA fetch mechanism (an HTTPS GET to a
// real, publicly resolvable domain) could structurally never retrieve a site-association file
// for it -- "no site-association file could exist" holds by construction, not by assumption, and
// it is clearly not any domain this product controls (PV's own real deployments are real DNS
// domains). CORRECTED live, this session (first run of this test): the original domain choice, a
// fresh `.localhost` subdomain, never propagated to QuickType across 4 retried attempts --
// isolated to E41-3's own unresolved "Falsification 3" finding
// (`ios/evidence/41/e41-3-matching-matrix.md` §"What this does NOT settle"): a bare, additive,
// single-identity `saveCredentialIdentities` call (exactly what `IdentityStoreSync.republish`'s
// incremental path does for a first-time item) was found there to never reliably propagate for a
// NEW `.localhost` host. `127.0.0.1` is the SAME host `TracerFillSeeder.seed()`'s own tracer
// item already uses, registered the identical way (single-item, `IdentityStoreSync` incremental),
// and PROVEN reliable across every prior plan in this phase -- switching to it isolates exactly
// that variable rather than IdentityStoreSync's own incremental-registration propagation
// reliability for a brand-new host (unresolved, out of this task's scope; flagged for Phase 42's
// audit). DR-41-B ("the chosen domain must be one the matching policy accepts, so a refusal
// cannot be mistaken for a FILL-04 failure"): `IdentityStoreSync` registers every identity
// `.domain`-typed (`IdentityStoreSync.swift`'s own header, F3), and `CredentialMatcher`'s
// origin-equality re-check at fill time passes because THIS item's own registered identity and
// its own stored URL are self-consistent (both derive from `127.0.0.1`), matching
// `testPolicyAcceptedFillSucceeds`'s own accepted-run shape in `AutoFillMatchingUITests.swift`.
//
// Seeded by `TracerFillSeeder.seedThirdPartyDomain()` (host app target, `PV_PROBE_E41_8`-gated --
// see that function's own header for why this deviates from `41-08-PLAN.md`'s `files_modified`,
// Rule 2, same class as `TracerFillSeeder.seed()`/`MatchingProbe.swift`/`IdentityStoreSyncProbe
// .swift`'s own precedent), dispatched from `PasskeyVaultApp.swift` on host-app launch, BEFORE
// Safari/the extension is ever invoked -- the SAME ordered host-then-extension sequence every
// other E41 seeder in this phase uses.
//
// Every assertion prints a `PVUITEST|E41-8|` line to STDOUT (captured in the raw `xcodebuild test`
// transcript) -- NEVER the plaintext password itself (T-41-12/T-41-15): only a boolean equality
// flag, matching `AutoFillMatchingUITests.testPolicyAcceptedFillSucceeds`'s own established
// discipline. The XCTAssertEqual failure message DOES embed the filled value on failure, but that
// only ever reaches the local `xcodebuild test` log, never this plan's own committed evidence file
// (`scripts/ios-autofill-e41.sh e41-8` only greps `PVUITEST|E41-8|` lines into
// `ios/evidence/41/e41-8-thirdparty.log`).

import XCTest

final class AutoFillThirdPartyDomainUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// MUST match `TracerFillSeeder.swift`'s `thirdPartyUsername`/`thirdPartyPassword`/
    /// `thirdPartyHost`/`thirdPartyPort` (host app target) -- duplicated as literals, matching
    /// every other UI test file's own established precedent in this phase (a UI test target
    /// drives the app out-of-process; it does not compile against that module).
    private static let expectedUsername = "e418-thirdparty@pv.test"
    private static let expectedPassword = "E418-3rdParty-NoAD!"
    private static let thirdPartyHost = "127.0.0.1"
    private static let thirdPartyPort = 8770

    /// The positive proof (E41-8): fill on a domain this product has no relationship with,
    /// asserted by the field's OWN byte value, never by any entitlement's absence.
    @MainActor
    func testFillsPasswordOnThirdPartyDomainWithoutAssociatedDomains() throws {
        let filled = driveThirdPartyFormFillWithRetry(host: Self.thirdPartyHost, port: Self.thirdPartyPort)
        XCTAssertEqual(
            filled, Self.expectedPassword,
            "Third-party-domain run: filled password did not byte-equal the expected plaintext (a mismatch here is the correct RED signal for this task's own falsification leg)."
        )
        print("PVUITEST|E41-8|run=thirdparty-fill host=\(Self.thirdPartyHost) port=\(Self.thirdPartyPort) field-value-equal=\(filled == Self.expectedPassword)")
    }

    /// Retries the whole navigate-tap-fill sequence, relaunching Safari fresh each time, with an
    /// increasing settle delay before each attempt. FOUND LIVE, this session (first run of this
    /// exact test, `ios/evidence/41/e41-8-thirdparty.log`'s own first-attempt transcript): a
    /// `.domain` identity registered immediately before the FIRST Safari navigation is not always
    /// offered yet -- exactly `e41-3-matching-matrix.md`'s own "Note 1" finding (loc1, visited
    /// first, showed `NONE` in 2 of 3 replications; loc3 onward, visited seconds later after a
    /// fresh Safari relaunch, showed the identity in **every** replication). This retries the
    /// SAME "fresh Safari relaunch after a short wait" shape that made loc3+ reliable in that
    /// experiment, rather than a single navigation with a longer fixed sleep -- the matrix's own
    /// data is about REPEATED fresh navigations settling the system's suggestion index, not about
    /// time elapsed in the abstract.
    @MainActor
    private func driveThirdPartyFormFillWithRetry(host: String, port: Int) -> String {
        let delaysSeconds: [UInt32] = [0, 4, 8, 12]
        for (index, delay) in delaysSeconds.enumerated() {
            if delay > 0 {
                sleep(delay)
            }
            let attemptNumber = index + 1
            let result = driveThirdPartyFormFill(host: host, port: port, attempt: attemptNumber)
            if result != "-none-" {
                print("PVUITEST|E41-8|host=\(host) port=\(port) attempt=\(attemptNumber) status=filled-on-attempt")
                return result
            }
            print("PVUITEST|E41-8|host=\(host) port=\(port) attempt=\(attemptNumber) status=not-filled-yet")
        }
        return "-none-"
    }

    /// Navigates Safari fresh to the third-party login form at `host:port`, taps the username
    /// field (triggering the silent entry point automatically -- `AutoFillFillUITests.swift`'s own
    /// header documents this), attempts the "Fill Password" confirmation chain when it appears,
    /// and returns whatever the password readback `<div>` shows afterward -- `"-none-"` if nothing
    /// ever filled it. Structurally identical to
    /// `AutoFillMatchingUITests.driveTracerFormFill(host:port:expectFill:isWarmUp:)`'s own accepted
    /// path (this plan's own `<read_first>` names that method as the shape to reuse); duplicated
    /// rather than shared for the same reason every other UI test file in this phase duplicates it
    /// (a UI test target drives the app out-of-process, never compiling against a sibling test
    /// file's internals).
    @MainActor
    private func driveThirdPartyFormFill(host: String, port: Int, attempt: Int) -> String {
        // Host app FIRST, unconditionally -- `PV_PROBE_E41_8`'s seed sequence
        // (`TracerFillSeeder.seedThirdPartyDomain()`) must land BEFORE Safari/the extension is
        // ever invoked, same ordered sequence every other E41 seeder in this phase uses. Only
        // needed on the FIRST attempt -- the seed is idempotent (the SAME item/identity), and
        // re-launching the host app on every retry would needlessly re-run the whole seed
        // sequence (a fresh `FfiUserKey` each time, though harmless here since nothing depends on
        // key continuity across attempts within one test).
        if attempt == 1 {
            let hostApp = XCUIApplication(bundleIdentifier: "cloud.blonie.PasskeyVault")
            hostApp.launch()
            sleep(3)
        }

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.terminate()
        safari.launch()

        let addressBar = safari.textFields.firstMatch
        guard addressBar.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-8|host=\(host) port=\(port) attempt=\(attempt) reason=no-address-bar")
            return "-none-"
        }
        addressBar.tap()
        addressBar.typeText("http://\(host):\(port)/")
        addressBar.typeText("\n")

        let usernameField = safari.webViews.textFields.firstMatch
        guard usernameField.waitForExistence(timeout: 10) else {
            print("PVUITEST|E41-8|host=\(host) port=\(port) attempt=\(attempt) reason=no-username-field")
            return "-none-"
        }
        usernameField.tap()
        sleep(2)

        var fillPasswordButton = safari.buttons["FillPasswordButton"]
        if !fillPasswordButton.waitForExistence(timeout: 5) {
            let passwordsAccessory = safari.buttons["Passwords"]
            if passwordsAccessory.waitForExistence(timeout: 4) {
                var providerRow = safari.buttons["PasskeyVault"]
                var innerAttempt = 0
                while innerAttempt < 3 && !providerRow.exists && !safari.buttons["FillPasswordButton"].exists {
                    passwordsAccessory.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    _ = providerRow.waitForExistence(timeout: 3)
                    providerRow = safari.buttons["PasskeyVault"]
                    innerAttempt += 1
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
            print("PVUITEST|E41-8|host=\(host) port=\(port) attempt=\(attempt) reason=no-fill-suggestion-surfaced")
            return "-none-"
        }

        let passwordReadback = safari.webViews.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH %@", "PWFIELD:")
        ).firstMatch
        guard passwordReadback.waitForExistence(timeout: 20) else {
            return "-none-"
        }
        return String(passwordReadback.label.dropFirst("PWFIELD:".count))
    }
}
