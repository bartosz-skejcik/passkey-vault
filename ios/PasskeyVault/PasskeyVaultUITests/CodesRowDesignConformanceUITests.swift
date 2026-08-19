// CodesRowDesignConformanceUITests.swift -- quick task 260818-irw
// ("fix iOS Codes surface: TOTP rows to match").
//
// STEP A FINDINGS (before any code change in this task, screenshots at
// `ios/evidence/38/codes-design-conformance/before-list-{light,dark}.png`,
// captured via a throwaway harness identical in shape to this file's own
// registration/create-item helpers below, run BEFORE `TotpCountdownView`/
// `ItemListView`/`ItemDetailView` changed):
//   - The Codes tab's rows rendered the EXACT same generic body every other
//     item type uses: `ItemIconTile` + title (`TotpFields.name`, e.g. "New
//     Code bartek@paczesny.pl") + subtitle (`TotpFields.issuer`, e.g.
//     "GitHub") + a trailing chevron.
//   - NO live TOTP code was shown anywhere in the row.
//   - NO countdown ring was shown anywhere in the row.
//   - Row padding was List's own default insets, not `.trow`'s own
//     `10/13` (`PVMetrics.totpRowVPadding`/`totpRowHPadding`).
//   - No 1.5pt letter-spacing (`.trow .code`'s own rule) was applied
//     anywhere, because no code text existed to apply it to.
//   - No tabular-digit numeral treatment was applied, for the same reason.
// This exact enumeration is what Task 1's Steps B-E fix; Task 2 additionally
// corrects the DETAIL screen's own measured divergences (56pt ring -> 30pt,
// semibold code with no tracking -> regular-weight monospaced with 3pt
// tracking).
//
// TASK 2 MEASUREMENTS (pixel-sampled from `after-*.png` with a Python/
// Pillow scan of the raw PNG data -- 1178x2556, this device's 3x scale
// over its 393x852 point size, confirmed via `img.size`), not eyeballed:
//   - CODE COLOR: the dominant colored pixel in the code-text region of
//     EVERY after-screenshot is an EXACT hex match --
//     `after-list-light.png`/`after-detail-light.png` -> `#CD4C00`
//     (6232/5342 matching pixels respectively), `after-list-dark.png`/
//     `after-detail-dark.png` -> `#FD7235` (6621/6435 pixels) -- the
//     precise light/dark `PVAccent` hex values, not an approximation.
//   - RING IS A RING, NOT A PIE: sampling the geometric CENTER of each
//     ring's own bounding box reads as background/surface in all four
//     screenshots (`#FFFFFF`/`#FCFBFA` light, `#1C1C1E`/`#1F1F1F` dark --
//     the page/card background, never `PVAccent`), while a RIM pixel
//     (partway around the stroked arc) reads as `PVAccent`
//     (`#CD4C00`/`#FD7235`) or, when sampled close to a period boundary
//     (observed live on the light detail capture), the warning amber
//     blend -- proving a genuine partial STROKE around the circumference,
//     never a filled sector.
//   - RING DIAMETER: the DETAIL ring's dark-mode measurement (the most
//     complete arc captured, least affected by a near-empty progress
//     fraction at capture time) measures ~97px bounding box ->
//     ~32.3pt at 3x scale, matching the 30pt target within anti-aliasing/
//     partial-arc tolerance -- corroborating the 56pt->30pt fix
//     (`PVMetrics.totpRingDiameterDetail`) was applied, not merely
//     compiled.
//
// [Rule 1 - Bug in this task's own plan text] Both Step A's and this
// file's Step F wording suggest using secret `JBSWY3DPEHPK3PXP` for the
// real create-FORM flow -- that secret decodes to only 10 bytes, below
// `TotpValidation.minSecretBytes` (16), so the real form refuses it before
// save (confirmed by reading `TotpValidation.swift` and `ItemFormView
// .swift`'s own header comment on exactly this point). Every item created
// below instead uses the form's own pre-filled RFC 6238 Appendix B SHA1
// secret (`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`, 20 decoded bytes, valid) --
// the same one `TotpCountdownUITests.swift`'s own real create-flow
// assertion already relies on.
//
// [Rule 1 - Bug, pre-existing, NOT caused by this task's diff -- verified
// against a pre-plan baseline run of `TotpCountdownUITests
// .testLiveCodeAndCountdownThenErrorState`, which fails identically]
// `app.buttons["Show password"]` never matches on this Xcode 26.6/iOS 26.5
// toolchain: an exported accessibility-hierarchy dump
// (`xcresulttool export attachments`) showed the reveal button's rendered
// `identifier` is `'eye'`/`'eye.slash'` (SwiftUI's own default identifier
// for an `Image(systemName:)`-only button with no explicit
// `.accessibilityIdentifier`) and its `label` is the FIELD's label (e.g.
// "Master password"), not "Show password" -- the button's own
// `.accessibilityLabel("Show password")` (`AuthView.swift`) is overridden
// by the enclosing `HStack`'s OWN `.accessibilityLabel(t(labelKey))`,
// applied after it. `registerFreshAccount` below matches on `identifier:
// "eye"` instead, verified live. `AuthView.swift` is out of this task's
// `files_modified` -- not touched.

import XCTest

final class CodesRowDesignConformanceUITests: XCTestCase {
    private static func freshEmail() -> String {
        "pv-codes-conformance-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvCodesConformance260818-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// The tracer's own falsifiable proof AND permanent regression coverage
    /// -- not throwaway. Proves the entire "code is the row, ring
    /// countdown" mechanism end-to-end for the real Codes LIST: a genuine
    /// live 6-digit TOTP code and its countdown-ring accessibility element
    /// both exist inside the row, and the OLD generic icon+chevron content
    /// is proven ABSENT.
    @MainActor
    func testCodesListShowsLiveCodeAndRingNotIconAndChevron() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "authRegister"
        app.launch()

        try registerFreshAccount(app, email: Self.freshEmail())

        // Created from the default (All) tab -- the same "+" -> Code flow
        // `TotpCountdownUITests.swift`'s own real create-flow assertion
        // already exercises there, kept unchanged rather than run from a
        // freshly-switched tab.
        let itemId = try createTotpItem(app, issuer: "GitHub", name: "bartek@paczesny.pl")

        // [Rule 1 - Bug, this task's own tracer run, verified live via an
        // exported accessibility-hierarchy dump at the point of failure]
        // Switching TABS while an item's detail screen is still the
        // topmost pushed view can re-open THAT SAME item's detail on the
        // newly-selected tab instead of showing the tab's own list -- a
        // dump taken mid-diagnosis showed the "New Code" detail
        // `NavigationBar` still on screen, with the `Codes` tab marked
        // `Selected` underneath it. This is pre-existing `VaultRootView`/
        // `ItemListView` navigation behavior (a shared `selection` driving
        // the push across every tab), not something this task's diff
        // touches or is responsible for fixing. `createTotpItem` below
        // already returns to the list via the system back button; if a
        // stale selection still re-pushes the detail screen once the
        // Codes tab is selected, tap back once more to dismiss it rather
        // than let it mask the row assertions below.
        let codesTab = app.buttons["Codes"]
        XCTAssertTrue(codesTab.waitForExistence(timeout: 10), "Codes tab never appeared")
        codesTab.tap()
        let staleDetailBack = app.navigationBars.buttons["BackButton"]
        if staleDetailBack.waitForExistence(timeout: 2) {
            staleDetailBack.tap()
        }

        // `app.descendants(matching: .any)`, not `.otherElements`/
        // `.staticTexts`: SwiftUI classifies the accessibility element type
        // by the underlying view kind, and this test must not assume which
        // (same discipline as `TotpCountdownUITests.swift`'s own call
        // site).
        let codeElement = app.descendants(matching: .any)["vault.row.\(itemId).totp.code"]
        XCTAssertTrue(codeElement.waitForExistence(timeout: 20), "live TOTP code never appeared in the Codes list row")
        let code = codeElement.value as? String ?? ""
        let digitsOnly = code.filter(\.isNumber)
        XCTAssertEqual(digitsOnly.count, 6, "code accessibility value must carry a real 6-digit code, got: \(code)")

        let ringElement = app.descendants(matching: .any)["vault.row.\(itemId).totp.remainingSeconds"]
        XCTAssertTrue(ringElement.waitForExistence(timeout: 5), "countdown ring never appeared in the Codes list row")
        let remaining = ringElement.value as? String ?? ""
        XCTAssertTrue(UInt64(remaining) != nil, "remaining-seconds accessibility value must be numeric, got: \(remaining)")

        // The negative half: the OLD generic icon+chevron row is provably
        // gone. Scoped to THIS row's own accessibility container so a
        // chevron belonging to a different row (there is only one item
        // here, but the query stays scoped for clarity) is not what is
        // being asserted against.
        let row = app.descendants(matching: .any)["vault.row.\(itemId)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the row's own accessibility container never appeared")
        let chevronInRow = row.images.matching(identifier: "chevron.right")
        XCTAssertEqual(chevronInRow.count, 0, "a chevron.right image must not exist in the new trow layout")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "codes-list-conformance"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Task 2 evidence capture: ONE TOTP item (issuer "GitHub", the same
    /// pair Task 1's own Step A before-capture used first), screenshotted
    /// after the fix on both the Codes list and the detail screen.
    /// [Rule 3 - blocking issue] Originally created TWO items (matching
    /// Step A's before-capture exactly), but this environment's host load
    /// spiked to `Load Avg 86-243` (`top -l 1`, confirmed live) during this
    /// task's own run -- a real save (Argon2id + network + WASM FFI) that
    /// normally completes in seconds instead stalled past even a 90s
    /// `waitForExistence`, confirmed by the exported `.xcresult`'s own
    /// `Synthesized Event` timeline showing a 90+ second gap with zero
    /// events before the timeout fired. ONE item still proves everything
    /// this evidence needs (the list AND detail geometry, both surfaces)
    /// with half the exposure to that contention. Run TWICE by the driving
    /// shell (light, then `xcrun simctl ui $id appearance dark` + re-run)
    /// -- single-copy per this repo's own established pattern
    /// (`VaultDockEvidenceUITests`/`ios-dock-evidence.sh`), so light/dark
    /// are guaranteed to be of the same states rather than two hand-
    /// maintained sequences that can drift. Prints each measured
    /// `XCUIElement.frame` as `PV-TOTP-GEOM` lines the driving shell greps
    /// out, for the pixel-scale cross-check recorded at this file's own
    /// bottom.
    @MainActor
    func testAfterEvidenceScreenshots() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "authRegister"
        app.launch()

        try registerFreshAccount(app, email: Self.freshEmail())

        let firstItemId = try createTotpItem(app, issuer: "GitHub", name: "bartek@paczesny.pl")

        let codesTab = app.buttons["Codes"]
        XCTAssertTrue(codesTab.waitForExistence(timeout: 10), "Codes tab never appeared")
        codesTab.tap()
        // Same stale-selection re-push guard as the tracer test above.
        let staleDetailBack = app.navigationBars.buttons["BackButton"]
        if staleDetailBack.waitForExistence(timeout: 2) {
            staleDetailBack.tap()
        }

        let listCodeElement = app.descendants(matching: .any)["vault.row.\(firstItemId).totp.code"]
        XCTAssertTrue(listCodeElement.waitForExistence(timeout: 20), "live TOTP code never appeared in the Codes list row")
        print("PV-TOTP-GEOM list.code.frame=\(listCodeElement.frame)")
        let listRingElement = app.descendants(matching: .any)["vault.row.\(firstItemId).totp.remainingSeconds"]
        XCTAssertTrue(listRingElement.waitForExistence(timeout: 5), "countdown ring never appeared in the Codes list row")
        print("PV-TOTP-GEOM list.ring.frame=\(listRingElement.frame)")

        let listAttachment = XCTAttachment(screenshot: app.screenshot())
        listAttachment.name = "after-list"
        listAttachment.lifetime = .keepAlways
        add(listAttachment)

        let row = app.descendants(matching: .any)["vault.row.\(firstItemId)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the row's own accessibility container never appeared")
        row.tap()

        let detailCode = app.descendants(matching: .any)["vault.detail.totp.code"]
        XCTAssertTrue(detailCode.waitForExistence(timeout: 10), "detail screen's TOTP code never appeared")
        print("PV-TOTP-GEOM detail.code.frame=\(detailCode.frame)")
        let detailRing = app.descendants(matching: .any)["vault.detail.totp.remainingSeconds"]
        XCTAssertTrue(detailRing.waitForExistence(timeout: 5), "detail screen's countdown ring never appeared")
        print("PV-TOTP-GEOM detail.ring.frame=\(detailRing.frame)")

        let detailAttachment = XCTAttachment(screenshot: app.screenshot())
        detailAttachment.name = "after-detail"
        detailAttachment.lifetime = .keepAlways
        add(detailAttachment)
    }

    /// Quick fix 40-UX-02: before this, tapping ANYWHERE on a Codes-tab row
    /// -- including directly on the live code -- pushed the item's detail
    /// screen, with no way to copy the code from the list at all. Proves
    /// BOTH halves of the fix live: tapping the code copies it through the
    /// real `ClipboardService` choke point (the SAME confirmation banner
    /// mechanism `ItemDetailView`'s own copy already uses, `ClipboardWording
    /// .confirmation`'s "Copied Code ..." text), and that tap does NOT also
    /// navigate -- the negative half a passing copy alone would not prove,
    /// since a stale detail push racing the banner could look identical to
    /// a clean tap-to-copy if only the banner were asserted.
    @MainActor
    func testTappingTheCodeCopiesAndDoesNotNavigate() throws {
        let app = XCUIApplication()
        app.launchEnvironment["PV_UITEST_SCREEN"] = "authRegister"
        app.launch()

        try registerFreshAccount(app, email: Self.freshEmail())
        let itemId = try createTotpItem(app, issuer: "GitHub", name: "bartek@paczesny.pl")

        let codesTab = app.buttons["Codes"]
        XCTAssertTrue(codesTab.waitForExistence(timeout: 10), "Codes tab never appeared")
        codesTab.tap()
        let staleDetailBack = app.navigationBars.buttons["BackButton"]
        if staleDetailBack.waitForExistence(timeout: 2) {
            staleDetailBack.tap()
        }

        let codeElement = app.descendants(matching: .any)["vault.row.\(itemId).totp.code"]
        XCTAssertTrue(codeElement.waitForExistence(timeout: 20), "live TOTP code never appeared in the Codes list row")
        codeElement.tap()

        // Positive half: the SAME list-screen copy-confirmation banner
        // `ItemListView.copyConfirmationBanner` already renders for the
        // context-menu copy actions.
        let banner = app.otherElements["vault.list.copyConfirmation"]
        XCTAssertTrue(banner.waitForExistence(timeout: 5), "tapping the TOTP code never showed the copy confirmation banner")
        // `.exists` (instant, no poll timeout), not a second `waitForExistence`
        // -- design-conformance fix, Phase 40: the shared `CopyHUD` this
        // banner now renders through auto-dismisses after ~2.5s, so a
        // second multi-second wait here would race that dismiss instead of
        // reading the text that is ALREADY on screen the instant the
        // container above was found.
        let bannerText = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Copied Code")).firstMatch
        XCTAssertTrue(bannerText.exists, "the banner must read \"Copied Code ...\", not a generic/wrong field label")

        // Negative half: no navigation push happened. The Codes list root's
        // own always-present element (the "+" dock) is still on screen, and
        // the DETAIL screen's own fixed identifier (distinct from the list
        // row's per-item `vault.row.<id>.totp.code`) never appeared.
        XCTAssertTrue(app.buttons["vault.create.plusMenu"].exists, "a navigation push occurred -- the list root's own dock vanished after tapping the code")
        XCTAssertFalse(app.descendants(matching: .any)["vault.detail.totp.code"].exists, "tapping the code must not push the item detail screen")

        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "40-ux-02-totp-row-tap-copies-with-banner"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - Helpers (mirrors TotpCountdownUITests.swift's own shape)

    private func registerFreshAccount(_ app: XCUIApplication, email: String) throws {
        let authEmailField = app.textFields.firstMatch
        XCTAssertTrue(authEmailField.waitForExistence(timeout: 5), "email field never appeared")
        authEmailField.tap()
        authEmailField.typeText(email)

        let revealButton = app.buttons.matching(identifier: "eye").firstMatch
        XCTAssertTrue(revealButton.waitForExistence(timeout: 5), "password reveal toggle never appeared")
        revealButton.tap()

        let passwordField = app.textFields.element(boundBy: 1)
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "revealed master-password field never appeared")
        passwordField.tap()
        passwordField.typeText(Self.password)

        let confirmField = app.textFields.element(boundBy: 2)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5), "revealed confirm-password field never appeared")
        confirmField.tap()
        confirmField.typeText(Self.password)

        app.buttons["Create vault"].tap()

        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }

    /// Creates one TOTP item via the real "+" -> Code flow. Returns the
    /// created item's id, read off the detail screen's own navigation title
    /// -- no, actually read off `vault.row.<id>` is not knowable before the
    /// item exists, so this reads the id from the ONLY row present on the
    /// Codes tab after creation via `firstMatch` on the row-id prefix
    /// instead (see call site).
    @discardableResult
    private func createTotpItem(_ app: XCUIApplication, issuer: String, name: String) throws -> String {
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()
        let codeOption = app.buttons["vault.create.action.code"]
        XCTAssertTrue(codeOption.waitForExistence(timeout: 5), "Code create-panel tile never appeared")
        codeOption.tap()

        let issuerField = app.textFields["Issuer (optional)"]
        XCTAssertTrue(issuerField.waitForExistence(timeout: 10), "issuer field never appeared")
        issuerField.tap()
        issuerField.typeText(issuer)

        let saveButton = app.buttons["itemform.save"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 5), "save button never appeared")
        saveButton.tap()

        // A real save round-trips through Argon2id + the network + WASM
        // FFI encryption -- generous under system load (observed live in
        // this environment: host `Load Avg` reached 86-243 during this
        // task's own run, from concurrent sessions sharing the machine,
        // and even 45s raced a save that finished shortly after).
        let detailCode = app.descendants(matching: .any)["vault.detail.totp.code"]
        XCTAssertTrue(detailCode.waitForExistence(timeout: 90), "item detail screen never appeared after save")

        // Back to the list to read the row's id off `vault.row.<id>`.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let plusMenuAfterBack = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenuAfterBack.waitForExistence(timeout: 15), "vault list never reappeared after back")

        // `identifier BEGINSWITH "vault.row."` also matches the NESTED
        // `vault.row.<id>.totp.code`/`...remainingSeconds` elements this
        // task's own `TotpCountdownView` refactor adds -- excluded via
        // `NOT (identifier CONTAINS ".totp.")` so only the ROW's own
        // outer container (`vault.row.<id>`, no further dots -- item ids
        // are UUIDs, hyphen-separated, never dotted) matches.
        let rowElement = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@ AND NOT (identifier CONTAINS %@)", "vault.row.", ".totp.")
        ).firstMatch
        XCTAssertTrue(rowElement.waitForExistence(timeout: 10), "created item's row never appeared")
        let rowId = rowElement.identifier
        XCTAssertTrue(rowId.hasPrefix("vault.row."), "unexpected row identifier: \(rowId)")
        return String(rowId.dropFirst("vault.row.".count))
    }
}
