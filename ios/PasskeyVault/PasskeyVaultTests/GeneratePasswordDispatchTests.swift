//
//  GeneratePasswordDispatchTests.swift
//  PasskeyVaultTests
//
//  Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-05 (SAVE-02). Live-run proof of
//  `GeneratePasswordDispatch.resolve(rulesText:)`'s three-way split
//  (`Shared/GeneratePasswordDispatch.swift`, 44-05-PLAN.md Task 1 `<behavior>`), against REAL
//  `pv-ffi` -- never a mock -- with no live extension context required (same reasoning
//  `PasskeyRegistrationOverrideTests.swift`'s own header documents for why this decision logic was
//  pulled into `Shared/` in the first place: `CredentialProviderViewController.swift` compiles
//  only into the extension target, which this test target's `@testable import PasskeyVault` --
//  the HOST app module -- cannot see).
//
//  Covers Task 1's own acceptance criteria:
//    - A rules string requiring specific character classes/length produces a candidate genuinely
//      containing those classes (not merely "some password").
//    - A rules string carrying an UNSUPPORTED shape (`required: [ABC]`, a custom bracket class --
//      44-02-SUMMARY.md's own refusal example) falls back to the generic default and OFFERS a
//      candidate.
//    - A rules string carrying an UNSATISFIABLE bound (`maxlength: 6`, below
//      `generatorBounds().charMinLength`) NEVER offers any candidate.
//    - An empty/nil rules string falls back to the default generator without erroring.
//

import Testing
@testable import PasskeyVault

@Suite
struct GeneratePasswordDispatchTests {
    /// The SAME DSL shape `SavePasswordFormView.swift`'s own harness field declares -- so this
    /// test's own "parseable, class-honouring" case exercises the identical grammar the live
    /// simulator drive (`scripts/ios-autofill-e44.sh sc-generate`) exercises end-to-end.
    private static let parseableRules = "minlength: 10; maxlength: 20; required: lower; required: upper; required: digit;"

    @Test("A parseable rules string produces a candidate that genuinely honours it")
    func parseableRulesHonoured() throws {
        let outcome = GeneratePasswordDispatch.resolve(rulesText: Self.parseableRules)
        guard case let .candidate(value) = outcome else {
            Issue.record("expected a candidate, got \(outcome)")
            return
        }
        #expect(value.count >= 10 && value.count <= 20)
        #expect(value.contains { $0.isLowercase })
        #expect(value.contains { $0.isUppercase })
        #expect(value.contains { $0.isNumber })
    }

    @Test("An unsupported rule shape (custom bracket class) falls back to a generic candidate")
    func unsupportedShapeFallsBack() throws {
        // 44-02-SUMMARY.md: a custom bracket class is refused at parse time with the stable
        // "unsupported rule shape: " prefix -- never silently approximated.
        let outcome = GeneratePasswordDispatch.resolve(rulesText: "required: [ABCDEFGH];")
        guard case .candidate = outcome else {
            Issue.record("expected a fallback candidate, got \(outcome)")
            return
        }
    }

    @Test("An unsatisfiable bound (below pv-core's own floor) NEVER offers a candidate")
    func unsatisfiableBoundRefuses() throws {
        // generatorBounds().charMinLength is pv-core's own floor (8, per 44-02-SUMMARY.md's own
        // description of CHAR_MIN_LENGTH) -- maxlength: 6 is provably below it, parsed fine, but
        // unsatisfiable.
        let outcome = GeneratePasswordDispatch.resolve(rulesText: "maxlength: 6;")
        #expect(outcome == .refuse)
    }

    @Test("An empty rules string falls back to the default generator without erroring")
    func emptyRulesFallsBack() throws {
        let outcome = GeneratePasswordDispatch.resolve(rulesText: "")
        guard case .candidate = outcome else {
            Issue.record("expected a fallback candidate, got \(outcome)")
            return
        }
    }

    @Test("A nil rules string falls back to the default generator without erroring")
    func nilRulesFallsBack() throws {
        let outcome = GeneratePasswordDispatch.resolve(rulesText: nil)
        guard case .candidate = outcome else {
            Issue.record("expected a fallback candidate, got \(outcome)")
            return
        }
    }
}
