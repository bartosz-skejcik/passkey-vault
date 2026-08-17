//
//  CardBrand.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 2. A port of
//  `packages/pv-ui/vault/cardBrand.ts` -- pure card-brand detection from a
//  (possibly partial/formatted) card number using only the public IIN/BIN
//  prefix ranges. NO network lookup, no external BIN database. This runs
//  client-side over an already-decrypted number; nothing here is ever sent
//  anywhere (design-conformance §3, hard constraint 2: "nothing about a
//  saved card ever leaves the client to render its glyph").
//
//  Added as a Task 2 dependency of `ItemIconTile.swift` -- not in this
//  plan's original `files_modified` list, tracked as a Rule 2 deviation
//  (auto-add missing critical functionality: the row anatomy the design
//  conformance doc mandates has no card-brand tile without this port).
//

import Foundation

enum CardBrand {
    case visa
    case mastercard
    case amex
    case discover
}

enum CardBrandDetector {
    static func detect(_ number: String) -> CardBrand? {
        let digits = number.filter(\.isNumber)
        if digits.isEmpty {
            return nil
        }
        if digits.hasPrefix("4") {
            return .visa
        }
        let twoDigit = Int(digits.prefix(2))
        let fourDigit = Int(digits.prefix(4))
        if let twoDigit, (51...55).contains(twoDigit) {
            return .mastercard
        }
        if let fourDigit, (2221...2720).contains(fourDigit) {
            return .mastercard
        }
        if digits.hasPrefix("34") || digits.hasPrefix("37") {
            return .amex
        }
        if digits.hasPrefix("6011") || digits.hasPrefix("65") {
            return .discover
        }
        if let threeDigit = Int(digits.prefix(3)), (644...649).contains(threeDigit) {
            return .discover
        }
        return nil
    }
}
