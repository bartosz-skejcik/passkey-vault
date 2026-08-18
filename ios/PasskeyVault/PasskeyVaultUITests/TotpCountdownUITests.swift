// TotpCountdownUITests.swift -- Phase 38, plan 38-10, Task 2 evidence.
//
// [Rule 2 deviation] Not in this plan's `files_modified` -- Task 2's own
// verify step names this exact file/test-plan
// (`-only-testing:PasskeyVaultUITests/TotpCountdownUITests`), matching the
// precedent `ItemDetailScreenshotUITests.swift`'s own header already
// records for the same class of gap.
//
// Drives the REAL "+" create affordance -> the dock panel's "Code" tile (its
// draft's secret is ALREADY the RFC 6238 Appendix B SHA1 vector,
// `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` -- `ItemCreationKind.emptyFields()`, no
// typing required) -> Save -> the real detail screen, and reads the live
// code/countdown through XCUITest ACCESSIBILITY VALUES, never OCR on the
// rendered ring (38-RESEARCH.md E-T1 step 2).
//
// Plan 38-11 (addendum A2): the intermediate `TypePicker` sheet the panel
// used to hand off to is retired -- `vault.create.action.code` routes
// straight into `ItemFormView` now.
//
// The error-state screenshot uses a second item, seeded by a DEBUG-only
// launch hook (`ContentView.swift`'s `PV_UITEST_SEED_BAD_TOTP`, a Rule 2
// deviation of its own -- see that file's header) carrying the 16-character
// secret (`JBSWY3DPEHPK3PXP`, a 10-byte decode) `totp-rs` rejects. That
// secret cannot reach the vault through the real create FORM at all --
// `TotpValidation.swift` refuses it before save -- so this is the only way
// to produce a real, server-persisted item exercising the error path.
//
// WR-10 (38-REVIEW.md) fix. The live-code assertions below were
// "non-empty", "all digits", "parses as UInt64" -- a frozen code, a code
// for the wrong secret, a countdown stuck at a constant, or a
// `remainingSeconds` decremented LOCALLY rather than recomputed all
// satisfied every one of those. The fix samples the code + remaining value
// TWICE, ~2s apart, and cross-checks each sample against a SECOND,
// INDEPENDENT RFC 6238 implementation.
//
// `scripts/totp-oracle.py` (Python stdlib) is the project's existing
// second implementation, but `Process`/`NSTask` does not exist on iOS --
// an XCUITest bundle for an iOS scheme is compiled against the iOS SDK and
// runs as a `-Runner.app` INSIDE the simulator, not as a plain macOS
// process on the host, so it cannot shell out to `python3`. `totpOracle`
// below is a from-scratch, INDEPENDENT-OF-`totp-rs`-AND-CryptoKit-being-
// the-app's-own-crypto Swift implementation (HOTP/TOTP built directly on
// `CryptoKit.HMAC<Insecure.SHA1>` and a hand-written base32 decoder, no
// code shared with `crates/pv-core/src/totp.rs` or `pv-ffi`'s wrapper of
// it) -- validated against the SAME RFC 6238 Appendix B vectors
// `totp-oracle.py`'s own `--selftest` reproduces, run as this file's own
// `testTotpOracleSelfTestReproducesRfc6238AppendixBVectors` FIRST ("step
// zero" from that script's own header: an unvalidated oracle proves
// nothing).

import CryptoKit
import Foundation
import XCTest

final class TotpCountdownUITests: XCTestCase {
    private static func freshEmail() -> String {
        "pv-totp-uitest-\(Int(Date().timeIntervalSince1970))-\(Int.random(in: 0...9999))@example.invalid"
    }
    static let password = "PvTotpCountdownUITest38-10-Password!"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testLiveCodeAndCountdownThenErrorState() throws {
        let app = XCUIApplication()
        // `authRegister`, not `auth` -- ContentView.swift's own comment on
        // this exact env var: reaching the register screen by tapping the
        // toggle control is a real simulator-input step that has timed out
        // in this environment often enough to lose screenshot evidence.
        // Landing directly in register mode avoids that flake.
        app.launchEnvironment["PV_UITEST_SCREEN"] = "authRegister"
        // Seeds "Bad Secret (UI test fixture)" (secret JBSWY3DPEHPK3PXP)
        // as soon as the vault list appears -- see ContentView.swift.
        app.launchEnvironment["PV_UITEST_SEED_BAD_TOTP"] = "1"
        app.launch()

        try registerFreshAccount(app, email: Self.freshEmail())

        // ---- Live code + countdown, through the real "+" -> Code flow ----
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 10), "plus create affordance never appeared")
        plusMenu.tap()
        let codeOption = app.buttons["vault.create.action.code"]
        XCTAssertTrue(codeOption.waitForExistence(timeout: 5), "Code create-panel tile never appeared")
        codeOption.tap()

        let saveButton = app.buttons["itemform.save"]
        XCTAssertTrue(saveButton.waitForExistence(timeout: 10), "the Code create form never appeared")
        saveButton.tap()

        // `app.descendants(matching: .any)`, not `.otherElements`/
        // `.staticTexts`: SwiftUI classifies the accessibility element
        // type by the underlying view kind (`Text` -> static text, the
        // `Circle` ring -> other), and this test must not assume which.
        let codeElement = app.descendants(matching: .any)["vault.detail.totp.code"]
        XCTAssertTrue(codeElement.waitForExistence(timeout: 10), "TOTP detail screen never appeared")
        let ringElement = app.descendants(matching: .any)["vault.detail.totp.remainingSeconds"]
        XCTAssertTrue(ringElement.waitForExistence(timeout: 5), "TOTP countdown ring never appeared")

        // WR-10 (38-REVIEW.md) fix. Sample 1/2, plus the wall-clock moment
        // it was read -- close enough to the app's own `unixTimeSeconds`
        // for the oracle cross-check below (sub-second query latency,
        // period=30s, so a boundary-crossing mismatch is a rare flake, not
        // the common case).
        let (code1, remaining1, time1) = Self.readLiveTotp(codeElement, ringElement)

        // Previously this test asserted only "non-empty", "all digits" and
        // "parses as UInt64" -- a FROZEN code, a code for the WRONG secret,
        // a countdown stuck at a constant, or a `remainingSeconds`
        // decremented LOCALLY rather than recomputed all satisfied every
        // one of those. Two things a frozen/fake implementation cannot
        // fake: (a) the remaining-seconds value actually changing over
        // real elapsed time, and (b) matching a SECOND, INDEPENDENT
        // implementation of RFC 6238 (`totp-oracle.py`) for the SAME
        // period bucket.
        Thread.sleep(forTimeInterval: 2)
        let (code2, remaining2, time2) = Self.readLiveTotp(codeElement, ringElement)

        // (a) time actually advances the countdown -- never a frozen or
        // locally-decremented value. Either it strictly decreased (still
        // inside the same period) or it wrapped UPWARD because a period
        // boundary was crossed between the two reads (the code changing is
        // the corroborating signal for a wrap).
        let wrappedAcrossPeriodBoundary = remaining2 > remaining1 && code2 != code1
        XCTAssertTrue(
            remaining2 < remaining1 || wrappedAcrossPeriodBoundary,
            "remainingSeconds did not track real elapsed time: \(remaining1) then \(remaining2), "
                + "codes \(code1) -> \(code2) (a frozen or locally-decremented countdown would not move)"
        )

        // (b) matches a SECOND, INDEPENDENT RFC 6238 implementation
        // (`Self.totpOracle`, built on `CryptoKit.HMAC<Insecure.SHA1>` and
        // a hand-written base32 decoder -- see this file's own header for
        // why this is not literally `totp-oracle.py`) for the SAME
        // secret/algorithm/digits/period this create form seeded --
        // `ItemFormView.emptyFields()`'s `.code` case, the RFC 6238
        // Appendix B SHA1 vector.
        let oracleCode1 = Self.totpOracle(unixTimeSeconds: time1, digits: 6, period: 30)
        XCTAssertEqual(
            code1, oracleCode1,
            "on-screen code did not match the independent RFC 6238 oracle at t=\(time1)"
        )
        let oracleCode2 = Self.totpOracle(unixTimeSeconds: time2, digits: 6, period: 30)
        XCTAssertEqual(
            code2, oracleCode2,
            "on-screen code did not match the independent RFC 6238 oracle at t=\(time2)"
        )

        let liveAttachment = XCTAttachment(screenshot: app.screenshot())
        liveAttachment.name = "38-10-totp-live-code-and-countdown"
        liveAttachment.lifetime = .keepAlways
        add(liveAttachment)

        // ---- Back to the list, then the pre-seeded too-short-secret item ----
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let badSecretRow = app.staticTexts["Bad Secret (UI test fixture)"]
        XCTAssertTrue(badSecretRow.waitForExistence(timeout: 15), "seeded bad-secret item never appeared in the list")
        badSecretRow.tap()

        let errorElement = app.descendants(matching: .any)["vault.detail.totp.error"]
        XCTAssertTrue(errorElement.waitForExistence(timeout: 10), "TOTP error state never appeared")
        // The must-have this screenshot proves: no code element anywhere
        // on screen when the secret is rejected -- error state, not a
        // silently-wrong code and not a blank.
        XCTAssertFalse(
            app.descendants(matching: .any)["vault.detail.totp.code"].exists,
            "a code element must not exist alongside the error state"
        )

        let errorAttachment = XCTAttachment(screenshot: app.screenshot())
        errorAttachment.name = "38-10-totp-error-state-too-short-secret"
        errorAttachment.lifetime = .keepAlways
        add(errorAttachment)

        Thread.sleep(forTimeInterval: 2)
    }

    /// `PV_UITEST_SCREEN=authRegister` (set by the caller above) forces
    /// `AuthView` straight into register mode, regardless of any session
    /// currently persisted in the Keychain (L-20, `ios/IOS-SPIKE-LOG.md`).
    /// Button label is the CURRENT localized English string
    /// (`Core/I18n/Dictionary.swift`'s `authRegisterSubmit`). [Rule 1 -
    /// Bug, this plan] `ItemDetailScreenshotUITests.swift`'s own
    /// `registerFreshAccount` (copied as a starting point) uses stale
    /// wording ("No account yet? Sign up" / "Create account") that no
    /// longer matches this screen -- not fixed there (out of this plan's
    /// files), fixed here.
    private func registerFreshAccount(_ app: XCUIApplication, email: String) throws {
        let authEmailField = app.textFields.firstMatch
        XCTAssertTrue(authEmailField.waitForExistence(timeout: 5), "email field never appeared")
        authEmailField.tap()
        authEmailField.typeText(email)

        // [Rule 1 - Bug, this plan] Typing directly into the two masked
        // `SecureField`s (this repo's established pattern elsewhere --
        // `ItemDetailScreenshotUITests.swift` et al.) produced a real,
        // repeatable, non-transient "Passwords don't match" banner in THIS
        // harness even though the identical literal was typed into both --
        // clearing first (`XCUIKeyboardKey.delete` x80) did not change the
        // outcome, so this is not stale-autofill content. `AuthView.swift`'s
        // `isPasswordRevealed` is a SINGLE `@State` shared by both fields
        // (`passwordField(text:)` is called for both with the same toggle):
        // tapping the reveal ("eye") button once switches BOTH fields from
        // `SecureField` to a plain, autocorrection-disabled `TextField`
        // simultaneously, sidestepping whatever `SecureField`-specific
        // quirk this simulator/OS build has. Landmine recorded in
        // `ios/IOS-SPIKE-LOG.md`.
        let revealButton = app.buttons["Show password"].firstMatch
        XCTAssertTrue(revealButton.waitForExistence(timeout: 5), "password reveal toggle never appeared")
        revealButton.tap()

        // Field order top-to-bottom: email (0), master password (1),
        // confirm password (2) -- all plain `TextField`s once revealed.
        let passwordField = app.textFields.element(boundBy: 1)
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "revealed master-password field never appeared")
        passwordField.tap()
        passwordField.typeText(Self.password)

        let confirmField = app.textFields.element(boundBy: 2)
        XCTAssertTrue(confirmField.waitForExistence(timeout: 5), "revealed confirm-password field never appeared")
        confirmField.tap()
        confirmField.typeText(Self.password)

        app.buttons["Create vault"].tap()

        // [Rule 1 - Bug, found live by plan 38-11] `vault.create.marker` is
        // the DEBUG-gated tracer create bar, opt-in behind
        // `PV_UITEST_TRACER_CREATE_BAR` -- never set in this file's launch
        // environment, so this wait could never have succeeded. The list
        // root's own, always-present element is the dock's "+" instead.
        let plusMenu = app.buttons["vault.create.plusMenu"]
        XCTAssertTrue(plusMenu.waitForExistence(timeout: 20), "vault list never appeared after registration")
    }

    // MARK: - WR-10 (38-REVIEW.md): real assertions, not "non-empty"/"all digits"

    /// Reads the code + remaining-seconds accessibility VALUES (never label
    /// text, never OCR -- same discipline as the call site above) alongside
    /// the wall-clock moment they were read, close enough to the app's own
    /// `unixTimeSeconds` for `oracleCode(unixTimeSeconds:)` below (a
    /// boundary-crossing mismatch from query latency is a rare flake, not
    /// the common case, at a 30s period).
    private static func readLiveTotp(
        _ codeElement: XCUIElement, _ ringElement: XCUIElement
    ) -> (code: String, remaining: UInt64, unixTimeSeconds: UInt64) {
        let code = codeElement.value as? String ?? ""
        let remainingString = ringElement.value as? String ?? ""
        let now = UInt64(Date().timeIntervalSince1970)

        XCTAssertFalse(code.isEmpty, "code accessibility value must be non-empty")
        XCTAssertTrue(code.allSatisfy(\.isNumber), "code accessibility value must be all digits, got: \(code)")
        guard let remaining = UInt64(remainingString) else {
            XCTFail("remaining-seconds accessibility value must be numeric, got: \(remainingString)")
            return (code, 0, now)
        }
        return (code, remaining, now)
    }

    // MARK: - `totpOracle`: a from-scratch, independent RFC 6238 implementation
    //
    // WHY NOT `scripts/totp-oracle.py` (this file's original plan): `Process`/
    // `NSTask` does not exist on iOS -- an XCUITest bundle for an iOS scheme
    // is compiled against the iOS SDK and runs as a `-Runner.app` INSIDE the
    // simulator, not as a plain macOS process on the host, so it cannot shell
    // out to `python3`. `totpOracle` below is independent of `totp-rs`/
    // `pv-ffi` (the thing under test) in the same SPIRIT `totp-oracle.py` is:
    // built directly on `CryptoKit.HMAC<Insecure.SHA1>` plus a hand-written
    // base32 decoder, no code shared with `crates/pv-core/src/totp.rs` or its
    // FFI wrapper. `testTotpOracleSelfTestReproducesRfc6238AppendixBVectors`
    // below is "step zero" (`totp-oracle.py`'s own header: an unvalidated
    // oracle proves nothing) -- run BEFORE trusting the live cross-check.

    /// RFC 4648 base32 decode, uppercase alphabet, tolerant of `=` padding
    /// and whitespace (a secret copy-pasted with either must decode the
    /// same way here as it does in `crates/pv-core/src/totp.rs`'s own
    /// tolerant parsing).
    private static func base32Decode(_ input: String) -> [UInt8] {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var indexOf: [Character: Int] = [:]
        for (i, ch) in alphabet.enumerated() { indexOf[ch] = i }

        var bitBuffer = 0
        var bitCount = 0
        var output: [UInt8] = []
        for rawChar in input.uppercased() where !rawChar.isWhitespace && rawChar != "=" {
            guard let value = indexOf[rawChar] else { continue }
            bitBuffer = (bitBuffer << 5) | value
            bitCount += 5
            if bitCount >= 8 {
                output.append(UInt8((bitBuffer >> (bitCount - 8)) & 0xFF))
                bitCount -= 8
            }
        }
        return output
    }

    /// RFC 4226 HOTP over SHA1: HMAC over the big-endian 8-byte counter,
    /// dynamic truncation (RFC 4226 §5.3), reduced mod `10^digits`,
    /// zero-padded -- transcribed directly from the specification, mirroring
    /// `totp-oracle.py`'s own `hotp()` (independently, not imported).
    private static func hotpSHA1(key: [UInt8], counter: UInt64, digits: Int) -> String {
        var counterBE = counter.bigEndian
        let counterData = withUnsafeBytes(of: &counterBE) { Data($0) }
        let mac = Array(HMAC<Insecure.SHA1>.authenticationCode(
            for: counterData, using: SymmetricKey(data: Data(key))
        ))
        let offset = Int(mac[mac.count - 1] & 0x0F)
        let truncated =
            (UInt32(mac[offset] & 0x7F) << 24)
            | (UInt32(mac[offset + 1]) << 16)
            | (UInt32(mac[offset + 2]) << 8)
            | UInt32(mac[offset + 3])
        var modulus: UInt32 = 1
        for _ in 0..<digits { modulus *= 10 }
        let codeInt = truncated % modulus
        return String(format: "%0\(digits)d", codeInt)
    }

    /// RFC 6238 TOTP: HOTP at counter = floor(time / period). SHA1 only --
    /// the only algorithm this test's fixture secret needs
    /// (`ItemFormView.emptyFields()`'s `.code` case is SHA1).
    private static func totpOracle(unixTimeSeconds: UInt64, digits: Int, period: UInt64) -> String {
        let key = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
        let counter = unixTimeSeconds / period
        return hotpSHA1(key: key, counter: counter, digits: digits)
    }

    /// "Step zero" (`totp-oracle.py`'s own header, reproduced here for the
    /// same reason): the six published RFC 6238 Appendix B (time, expected
    /// 8-digit code) pairs for the SHA1 test secret, transcribed
    /// independently -- an unvalidated oracle proves nothing when compared
    /// against anything else. `crates/pv-core/src/totp.rs`'s own test module
    /// carries the identical six pairs; this transcription is independent,
    /// not imported.
    func testTotpOracleSelfTestReproducesRfc6238AppendixBVectors() {
        let vectors: [(time: UInt64, expected: String)] = [
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ]
        for vector in vectors {
            let got = Self.totpOracle(unixTimeSeconds: vector.time, digits: 8, period: 30)
            XCTAssertEqual(
                got, vector.expected,
                "totpOracle self-test FAILED at t=\(vector.time): expected \(vector.expected), got \(got) "
                    + "-- an unvalidated oracle proves nothing, per totp-oracle.py's own header"
            )
        }
    }
}
