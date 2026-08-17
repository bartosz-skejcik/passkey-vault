//
//  PasswordStrength.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-08, Task 1. A direct,
//  faithful port of `packages/pv-ui/generator/strength.ts`'s
//  `scorePasswordMeter` -- CLASS-BASED, deliberately not entropy-bit
//  based (T-38-08 prohibition: "Must NOT compute strength from entropy
//  bits" -- an entropy meter would score a strong passphrase differently
//  from the web client with no cryptographic justification, a visible
//  divergence between "one product").
//
//  `tiers = 1 + hasDigit + hasSpecial` -- letters alone are ALWAYS tier 1
//  (baseline), never tier 0, so an empty-string special case is required
//  or the formula divides by zero-length meaningfully instead of
//  returning the TypeScript original's explicit `{0, error}` early return.
//
//  A hyphen (or any Diceware separator) counts as "special"
//  (`/[^a-zA-Z0-9]/` in the TS regex) -- this is WHY a hyphen-joined
//  passphrase scores 2 tiers (warning), not 1 (error), even with no
//  digit anywhere in it. See `PasswordStrengthTests.swift`'s mid-band
//  case, and this plan's SUMMARY for the Node-side parity transcript.
//

import Foundation

enum PasswordStrength {

    enum MeterColor: Equatable {
        case error
        case warning
        case success
    }

    struct MeterResult: Equatable {
        let percent: Int
        let color: MeterColor
    }

    /// Mirrors `strength.ts`'s `METER_FULL_LENGTH = 12` -- the character
    /// count at which a tier's percentage cap is fully reached. Not a
    /// generator bound (nothing in `generatorBounds()` covers this), so
    /// it is not read from the FFI bounds record -- it is a property of
    /// THIS scoring formula alone, ported byte-for-byte from the
    /// TypeScript constant of the same name.
    private static let meterFullLength = 12.0

    static func scoreMeter(_ password: String) -> MeterResult {
        if password.isEmpty {
            return MeterResult(percent: 0, color: .error)
        }

        let hasDigit = password.contains { $0.isASCII && $0.isNumber }
        let hasSpecial = password.contains { ch in
            guard ch.isASCII else { return true }
            return !(ch.isLetter || ch.isNumber)
        }

        let tiers = 1 + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0)
        let color: MeterColor = tiers == 3 ? .success : (tiers == 2 ? .warning : .error)
        let cap = Double(tiers) / 3.0 * 100.0
        let lengthFactor = min(1.0, Double(password.count) / meterFullLength)

        return MeterResult(percent: Int((cap * lengthFactor).rounded()), color: color)
    }
}
