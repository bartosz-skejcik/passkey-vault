//
//  GeneratePasswordDispatch.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Plan 44-05 (SAVE-02). Pulled OUT of `CredentialProviderViewController.swift`
//  (extension-target-only, `PasskeyVaultTests` has no access to it -- same reasoning
//  `PasskeyRegistrationPreflight.swift`'s own header already documents: that target's own
//  `fileSystemSynchronizedGroups` lists only its own folder, never
//  `PasskeyVaultAutoFill`/`0B428FE9E49C0BB22AF61E01`, so `@testable import PasskeyVault` would
//  never see a type declared only in the extension folder) so a plain XCTest can exercise the
//  real, three-way dispatch this plan's own Task 1 `<behavior>` commits to (rules-honoring
//  candidate / safe generic fallback / outright refusal), live against `pv-ffi`'s actual
//  `generatePasswordFromRules(rulesText:)`, with no live extension context.
//
//  Unlike `PasskeyRegistrationPreflight`'s own strictly-pure decision function, this type DOES
//  call `pv-ffi` -- it is the DISPATCH POLICY worth testing in isolation: which of the two stable
//  error-message prefixes (`"unsupported rule shape: "` / `"unsatisfiable rule: "`,
//  44-02-SUMMARY.md's own contract) leads to the safe generic fallback vs. an outright refusal
//  (44-PLAN-CHECK.md W2, T-44-16 -- never a candidate known to violate a rule pv-core successfully
//  parsed and determined unsatisfiable).
//

import Foundation

/// Either a genuine, pv-ffi-sourced candidate, or a refusal. NEVER a candidate known to violate a
/// rule pv-core successfully parsed and determined unsatisfiable -- the whole point of this type
/// is to make "we have something to offer" and "we decided to offer nothing" mutually exclusive at
/// the type level.
enum GeneratePasswordOutcome: Equatable {
    case candidate(String)
    case refuse
}

enum GeneratePasswordDispatch {
    /// The generic, no-rules-stated fallback: `generatorBounds()`'s own default length, all four
    /// character classes -- Apple's own documented default for an unparsed/absent rules
    /// descriptor (`request.passwordFieldPasswordRules == nil`) is `allowed: ascii-printable`, so
    /// offering the widest class set here is the honest match for "no rule was stated at all".
    static func fallbackCandidate() -> GeneratePasswordOutcome {
        guard let bounds = try? generatorBounds() else { return .refuse }
        guard
            let candidate = try? generateCharacterPassword(
                length: bounds.charDefaultLength,
                options: FfiCharacterPasswordOptions(lowercase: true, uppercase: true, digits: true, symbols: true)
            )
        else { return .refuse }
        return .candidate(candidate)
    }

    /// `rulesText` is passed through to `generatePasswordFromRules` completely unparsed on the
    /// Swift side (DR-44-B) -- this function only pattern-matches the two STABLE error-message
    /// prefixes `pv-core`/`pv-ffi` commit to (44-02-SUMMARY.md), never re-derives the rule shape
    /// itself.
    static func resolve(rulesText: String?) -> GeneratePasswordOutcome {
        guard let rulesText, !rulesText.isEmpty else {
            return fallbackCandidate()
        }
        do {
            let candidate = try generatePasswordFromRules(rulesText: rulesText)
            return .candidate(candidate)
        } catch let FfiError.InvalidInput(message) where message.hasPrefix("unsupported rule shape: ") {
            // The DSL text could not even be READ -- a safe generic candidate is the honest best
            // effort (W2's FIRST case).
            return fallbackCandidate()
        } catch let FfiError.InvalidInput(message) where message.hasPrefix("unsatisfiable rule: ") {
            // Parsed fine; pv-core itself determined no compliant password exists. Offering ANY
            // candidate here would silently violate a bound the RP itself stated and pv-core
            // successfully confirmed cannot be met -- the exact Pitfall-3 shape W2 names. Refuse,
            // never fall back.
            return .refuse
        } catch {
            // Any OTHER error shape (neither stable prefix matched, or a non-InvalidInput FfiError
            // case) is a genuinely unexpected failure -- treated as the refuse branch, never the
            // fallback branch: when in doubt, refuse rather than risk a rule-violating candidate.
            return .refuse
        }
    }
}
