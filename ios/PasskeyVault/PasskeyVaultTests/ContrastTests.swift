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
}
