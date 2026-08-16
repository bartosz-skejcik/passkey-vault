//
//  IdentityAddress.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-03. A port of
//  `web/src/lib/vault/identityAddress.ts` PLUS the prefill half that lives in
//  `web/src/components/vault/ItemForm.tsx` (`withLegacyAddressPrefill`,
//  :111-116, and the compose-on-save at :351).
//
//  BOTH HALVES ARE PORTED HERE ON PURPOSE. The round trip only preserves data
//  if both run:
//
//    read  ->  if NO structured field is populated and the flat `address` is
//              non-empty, seed `addressLine1` from the flat string.
//    save  ->  recompose the flat `address` from the structured parts.
//
//  Port only the save half and every identity item whose address was written
//  by the extension loses its address the first time it is edited on iOS: the
//  structured fields are all empty, so the recomposed flat string is `""`,
//  and `""` overwrites the real one. Port only the read half and the two
//  representations drift apart instead.
//
//  Why the flat string still matters: it is the SOURCE OF TRUTH the
//  extension's autofill reads and writes. That autofill fills exactly ONE
//  `street-address`-style input, which is why the composed form is a single
//  COMMA-joined line -- not the newline-joined block the detail panel renders
//  for display. The two joins are different on purpose.
//

import Foundation

enum IdentityAddress {

    /// Non-empty structured parts, in display/compose order. Empty and
    /// whitespace-only parts are dropped entirely.
    static func addressLines(_ fields: IdentityFields) -> [String] {
        [
            fields.addressLine1,
            fields.addressLine2,
            fields.city,
            fields.state,
            fields.zip,
            fields.country,
        ]
        .map { ($0 ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    }

    /// Composes the legacy flat `address` string. A single COMMA-joined line
    /// -- see this file's header for why it is not the newline join used for
    /// display. Returns `""` when every structured part is empty.
    static func composeLegacyAddress(_ fields: IdentityFields) -> String {
        addressLines(fields).joined(separator: ", ")
    }

    /// The multi-line block for on-screen display. A DIFFERENT join from
    /// `composeLegacyAddress`, deliberately.
    static func displayAddress(_ fields: IdentityFields) -> String {
        addressLines(fields).joined(separator: "\n")
    }

    /// READ half: seed `addressLine1` from the legacy flat string, but ONLY
    /// when no structured field is populated and the flat string is not
    /// blank. Any structured content means the item has already been edited
    /// under the structured form and the flat string is derived, not
    /// authoritative.
    static func withLegacyAddressPrefill(_ fields: IdentityFields) -> IdentityFields {
        guard addressLines(fields).isEmpty else { return fields }
        guard !fields.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return fields
        }
        var out = fields
        out.addressLine1 = fields.address
        return out
    }

    /// SAVE half: recompose the flat string from the structured parts.
    ///
    /// Refuses to overwrite a non-empty legacy address with an empty
    /// recomposition. `ItemForm.tsx` gets away without that guard because its
    /// own `withLegacyAddressPrefill` has always run on the way in, so the
    /// structured fields are never all-empty for an item that had an address.
    /// This function can be called from paths where that is not guaranteed,
    /// and losing a user's address to an all-empty recompose is not a
    /// recoverable mistake.
    static func withComposedLegacyAddress(_ fields: IdentityFields) -> IdentityFields {
        let composed = composeLegacyAddress(fields)
        if composed.isEmpty && !fields.address.isEmpty {
            return fields
        }
        var out = fields
        out.address = composed
        return out
    }
}
