//
//  ContrastTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. The UI-SPEC's ⚠
//  contrast obligation discharged as a MEASUREMENT: parses the shipped
//  `Assets.xcassets/*.colorset/Contents.json` files (never a hard-coded hex
//  literal in this file) and computes the WCAG 2.1 relative-luminance
//  contrast ratio for `PVError` on `PVSurface` and `PVTextMuted` on
//  `PVSurface`, in BOTH the Any and Dark appearances. `#FF5861` on
//  `PVSurface` light `#FFFFFF` was demonstrated RED at its original value
//  (measured 3.08:1) before the light-appearance `PVError` was darkened to
//  `#D1323C` (4.96:1); the Dark appearance kept `#FF5861` unchanged because
//  it already measures 4.92:1 against the dark surface. See
//  `37-UI-SPEC.md`'s `## Color` section for the recorded numbers.
//

import Foundation
import Testing

struct ContrastTests {

    // MARK: - Reading the shipped asset values

    /// `#filePath` resolves to THIS file's absolute path at compile time on
    /// the machine that built the test bundle -- walking up from
    /// `PasskeyVaultTests/` to `PasskeyVault/Assets.xcassets/` reads the
    /// values that actually ship, not a copy pasted into this test.
    private static var assetsDirectory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // PasskeyVault/ (the ios/PasskeyVault/PasskeyVault.xcodeproj sibling dir)
            .appendingPathComponent("PasskeyVault")
            .appendingPathComponent("Assets.xcassets")
    }

    private struct ColorComponents: Decodable {
        let red: String
        let green: String
        let blue: String
        let alpha: String
    }

    private struct ColorEntry: Decodable {
        let appearances: [Appearance]?
        let color: ColorValue

        struct Appearance: Decodable {
            let appearance: String
            let value: String
        }

        struct ColorValue: Decodable {
            let components: ColorComponents
        }

        var isDark: Bool {
            (appearances ?? []).contains { $0.appearance == "luminosity" && $0.value == "dark" }
        }
    }

    private struct ColorSetContents: Decodable {
        let colors: [ColorEntry]
    }

    /// Reads a `.colorset/Contents.json` and returns the (any, dark) sRGB
    /// hex strings (e.g. `"D1323C"`), read from whichever entry does/doesn't
    /// carry the `luminosity: dark` appearance -- never a literal transcribed
    /// by hand into this file.
    private static func readColorSet(named name: String) throws -> (any: String, dark: String) {
        let url = assetsDirectory.appendingPathComponent("\(name).colorset/Contents.json")
        let data = try Data(contentsOf: url)
        let decoded = try JSONDecoder().decode(ColorSetContents.self, from: data)

        guard let anyEntry = decoded.colors.first(where: { !$0.isDark }),
              let darkEntry = decoded.colors.first(where: { $0.isDark })
        else {
            throw ContrastTestError.missingAppearance(name)
        }
        return (hex(from: anyEntry.color.components), hex(from: darkEntry.color.components))
    }

    private static func hex(from components: ColorComponents) -> String {
        func strip(_ s: String) -> String {
            s.hasPrefix("0x") ? String(s.dropFirst(2)) : s
        }
        return strip(components.red) + strip(components.green) + strip(components.blue)
    }

    private enum ContrastTestError: Error {
        case missingAppearance(String)
    }

    // MARK: - WCAG 2.1 relative luminance / contrast ratio

    private static func linearize(_ channel: Double) -> Double {
        channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
    }

    private static func relativeLuminance(hex: String) -> Double {
        let r = Double(Int(hex.prefix(2), radix: 16) ?? 0) / 255.0
        let g = Double(Int(hex.dropFirst(2).prefix(2), radix: 16) ?? 0) / 255.0
        let b = Double(Int(hex.dropFirst(4).prefix(2), radix: 16) ?? 0) / 255.0
        return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
    }

    private static func contrastRatio(_ hexA: String, _ hexB: String) -> Double {
        let lA = relativeLuminance(hex: hexA)
        let lB = relativeLuminance(hex: hexB)
        let lighter = max(lA, lB)
        let darker = min(lA, lB)
        return (lighter + 0.05) / (darker + 0.05)
    }

    // MARK: - The obligation, as a measurement

    @Test func errorOnSurfaceMeetsWcagAaInBothAppearances() throws {
        let error = try Self.readColorSet(named: "PVError")
        let surface = try Self.readColorSet(named: "PVSurface")

        let anyRatio = Self.contrastRatio(error.any, surface.any)
        let darkRatio = Self.contrastRatio(error.dark, surface.dark)

        #expect(anyRatio >= 4.5, "PVError on PVSurface (Any) measured \(anyRatio), below 4.5:1")
        #expect(darkRatio >= 4.5, "PVError on PVSurface (Dark) measured \(darkRatio), below 4.5:1")
    }

    @Test func textMutedOnSurfaceMeetsWcagAaInBothAppearances() throws {
        let muted = try Self.readColorSet(named: "PVTextMuted")
        let surface = try Self.readColorSet(named: "PVSurface")

        let anyRatio = Self.contrastRatio(muted.any, surface.any)
        let darkRatio = Self.contrastRatio(muted.dark, surface.dark)

        #expect(anyRatio >= 4.5, "PVTextMuted on PVSurface (Any) measured \(anyRatio), below 4.5:1")
        #expect(darkRatio >= 4.5, "PVTextMuted on PVSurface (Dark) measured \(darkRatio), below 4.5:1")
    }

    /// Sanity check on the measurement engine itself: pure black on pure
    /// white must measure the WCAG-canonical 21:1 -- if this test fails,
    /// the luminance/contrast MATH is broken, not the app's colours.
    @Test func blackOnWhiteMeasuresTheCanonicalTwentyOneToOne() {
        let ratio = Self.contrastRatio("000000", "FFFFFF")
        #expect(abs(ratio - 21.0) < 0.01)
    }

    // MARK: - The gap this file originally had
    //
    // The two tests above cover PVError and PVTextMuted. They did NOT cover
    // PVAccent -- and PVAccent was the token that failed. At its original
    // `#E16540` (identical in both appearances) it measured 3.42:1 as text on
    // white and 3.42:1 under a white button label, both below AA, and nothing
    // in this suite noticed for two phases. The tests below close that hole
    // and extend the same obligation to every semantic token added with the
    // design system.

    /// PVAccent must be readable AS TEXT on PVSurface in both appearances.
    /// This is the assertion whose absence let `#E16540` ship.
    @Test func accentOnSurfaceMeetsWcagAaInBothAppearances() throws {
        let accent = try Self.readColorSet(named: "PVAccent")
        let surface = try Self.readColorSet(named: "PVSurface")

        let anyRatio = Self.contrastRatio(accent.any, surface.any)
        let darkRatio = Self.contrastRatio(accent.dark, surface.dark)

        #expect(anyRatio >= 4.5, "PVAccent on PVSurface (Any) measured \(anyRatio), below 4.5:1")
        #expect(darkRatio >= 4.5, "PVAccent on PVSurface (Dark) measured \(darkRatio), below 4.5:1")
    }

    /// The primary button: the PVOnAccent label on a PVAccent fill. This is
    /// the most common appearance of the brand colour in the whole app, and at
    /// the original `#E16540` a white label measured 3.42:1 -- large-text-only,
    /// on a control whose label is body-sized.
    ///
    /// This test originally hardcoded `"FFFFFF"` as the label and FAILED in the
    /// Dark appearance at 3.34:1. That failure was correct and the test was
    /// wrong: PVAccent's two roles pull opposite ways in dark mode. It must be
    /// LIGHTER to stay readable as text on a dark surface, which necessarily
    /// makes a white label on top of it worse. The fix is a real design-system
    /// token rather than a threshold climbdown -- PVOnAccent knocks out in
    /// white on light and in near-black on dark. `docs/UI-DESIGN.md` defines
    /// this as a single-valued "Primary content #FFFFFF", which is correct for
    /// the web's always-dark surfaces and incomplete for iOS.
    @Test func onAccentLabelOnAccentFillMeetsWcagAaInBothAppearances() throws {
        let accent = try Self.readColorSet(named: "PVAccent")
        let onAccent = try Self.readColorSet(named: "PVOnAccent")

        let anyRatio = Self.contrastRatio(onAccent.any, accent.any)
        let darkRatio = Self.contrastRatio(onAccent.dark, accent.dark)

        #expect(anyRatio >= 4.5, "PVOnAccent on PVAccent fill (Any) measured \(anyRatio), below 4.5:1")
        #expect(darkRatio >= 4.5, "PVOnAccent on PVAccent fill (Dark) measured \(darkRatio), below 4.5:1")
    }

    /// Guards the finding above from being silently undone. If someone sets
    /// PVOnAccent back to white in both appearances -- the obvious "simplification",
    /// and what UI-DESIGN.md literally says -- this fires.
    @Test func onAccentIsModeAwareNotWhiteInBothAppearances() throws {
        let onAccent = try Self.readColorSet(named: "PVOnAccent")

        #expect(
            onAccent.any.uppercased() == "FFFFFF",
            "PVOnAccent (Any) is \(onAccent.any); the light-mode label is expected to be white."
        )
        #expect(
            onAccent.dark.uppercased() != "FFFFFF",
            """
            PVOnAccent (Dark) is white. A white label on the dark-appearance PVAccent fill \
            measures 3.34:1 and fails AA — see onAccentLabelOnAccentFillMeetsWcagAaInBothAppearances.
            """
        )
    }

    /// Every semantic token carries meaning a user must be able to READ --
    /// "this password leaked", "this is a passkey", "this one is stale". They
    /// are held to the text threshold, not the 3:1 UI-component one.
    @Test func everySemanticTokenMeetsWcagAaOnSurface() throws {
        let surface = try Self.readColorSet(named: "PVSurface")
        let tokens = ["PVPasskey", "PVSuccess", "PVWarning", "PVError", "PVInfo", "PVLink"]

        for name in tokens {
            let token = try Self.readColorSet(named: name)
            let anyRatio = Self.contrastRatio(token.any, surface.any)
            let darkRatio = Self.contrastRatio(token.dark, surface.dark)

            #expect(anyRatio >= 4.5, "\(name) on PVSurface (Any) measured \(anyRatio), below 4.5:1")
            #expect(darkRatio >= 4.5, "\(name) on PVSurface (Dark) measured \(darkRatio), below 4.5:1")
        }
    }

    /// PVAccentBold is the one token DELIBERATELY exempt from the AA text
    /// threshold: it is the literal brand colour, kept for decorative fills
    /// (and, originally, large text).
    ///
    /// Rebrand coral -> mandarynka (2026-08-18, tokens.json) moved this from
    /// `#E16540` (3.42:1 on white — cleared the 3:1 large-text/UI floor) to
    /// `#FD7235` (measured 2.751:1 on white — it no longer does). That is the
    /// same fact `docs/UI-DESIGN.md` records for the web's Primary content
    /// colour: white on the new brand hue/chroma fails 3:1, which is why web
    /// moved Primary content off white entirely. On iOS PVAccentBold has zero
    /// non-test usages (`grep -rn PVAccentBold ios/PasskeyVault --include='*.swift'`),
    /// so nothing regresses live UI -- but its licence narrows for real: it is
    /// decorative-fill-only now, not even large-text-capable. This test pins
    /// that it stays below AA (4.5) and now ALSO below the large-text floor
    /// (3.0), so a future brand tweak that quietly crosses back over 3:1
    /// doesn't go unnoticed the way the original E16540 failure did.
    @Test func accentBoldIsDeliberatelyBelowAaAndBelowTheLargeTextFloor() throws {
        let bold = try Self.readColorSet(named: "PVAccentBold")
        let surface = try Self.readColorSet(named: "PVSurface")

        let anyRatio = Self.contrastRatio(bold.any, surface.any)

        #expect(
            anyRatio < 4.5,
            """
            PVAccentBold measured \(anyRatio) on light PVSurface, at or above 4.5:1. \
            If this was intentional, PVAccentBold now duplicates PVAccent and should be \
            removed rather than kept as a second name for the same colour.
            """
        )
        #expect(
            anyRatio < 3.0,
            """
            PVAccentBold measured \(anyRatio), at or above the 3:1 large-text floor. \
            As of the mandarynka rebrand (measured 2.751:1) it is decorative-fill-only; \
            if a brand change pushed it back over 3:1, update this test's comment and \
            reconsider whether it may be used for large text again.
            """
        )
    }
}
