//
//  ItemNormalize.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-03. A port of
//  `packages/pv-ui/vault/types.ts`'s four normalization functions, in the
//  order that file declares them: `isRawPasskeyWireFields`,
//  `normalizePasskeyWireFields`, `withCommonFieldInvariants`,
//  `normalizeItemShape` / `normalizeItemFields`.
//
//  WHY THIS EXISTS AT ALL, quoted from the TypeScript source's own reasoning
//  rather than restated, because the reasoning is the record:
//
//    "Decrypted item plaintext is UNTRUSTED INPUT. In a zero-knowledge vault
//     the server stores opaque blobs and validates nothing, so the shape of a
//     decrypted plaintext is whatever SOME client wrote — which is not
//     necessarily this one."
//
//  And the concrete cost of getting it wrong, which is not hypothetical:
//  `store.ts`'s `recomputeAllTags()` iterates `item.fields.tags` unguarded and
//  runs on EVERY store mutation -- sync merge, create, update, AND DELETE. One
//  `tags`-less row therefore threw out of `createVaultItem` AFTER the server
//  had already returned 201 (so the UI reported a failure over a successful
//  save, inviting a retry into duplicates) and left NO UI PATH to remove the
//  offending row, because delete threw too. **One malformed row wedged the
//  whole account, permanently.**
//
//  `name` and `folderId` are deliberately NOT defaulted. Neither is
//  dereferenced in a way that can throw -- `folderId` is only ever compared,
//  `name` is only ever rendered -- so defaulting them would be speculative
//  rather than corrective. That asymmetry is transcribed, not tidied.
//

import Foundation

enum ItemNormalizeError: Error, CustomStringConvertible {
    case notAnObject
    case unknownType(String)
    case missingRequiredKey(String, type: String)

    var description: String {
        switch self {
        case .notAnObject:
            return "decrypted plaintext is not a JSON object"
        case let .unknownType(t):
            return "unknown item type '\(t)' -- the six-member union in packages/pv-ui/vault/types.ts is the source of truth"
        case let .missingRequiredKey(key, type):
            return "required key '\(key)' missing from a '\(type)' item's plaintext"
        }
    }
}

enum ItemNormalize {

    // MARK: - 1. isRawPasskeyWireFields
    //
    // Ported verbatim from `types.ts:288-296`: an object, with NO `type` key,
    // that carries BOTH `credential_id` and `rp_id`. Nothing weaker -- the
    // absence of `type` alone would also match a malformed row of any type.

    static func isRawPasskeyWireFields(_ raw: [String: Any]) -> Bool {
        raw["type"] == nil && raw["credential_id"] != nil && raw["rp_id"] != nil
    }

    // MARK: - 2. normalizePasskeyWireFields
    //
    // `name`/`folderId`/`tags` do not exist on the wire shape at all, so
    // defaults are SYNTHESIZED: `name` prefers the RP-visible `username`,
    // falling back to the raw `rp_id` (`types.ts:325`).

    static func normalizePasskeyWireFields(_ raw: [String: Any]) throws -> ItemFields {
        guard let rpId = raw["rp_id"] as? String else {
            throw ItemNormalizeError.missingRequiredKey("rp_id", type: "passkey")
        }
        guard let credentialIdBytes = raw["credential_id"] as? [Int] else {
            throw ItemNormalizeError.missingRequiredKey("credential_id", type: "passkey")
        }
        let username = raw["username"] as? String
        let displayName = raw["user_display_name"] as? String

        // The FULL raw wire object is retained, re-serialized with sorted
        // keys so the retained string is stable across runs. Nothing in this
        // view surfaces `key_cbor`, `counter` or `extensions`, but they are
        // carried, because an edit that dropped them would destroy the
        // credential.
        let rawJson = String(
            data: try JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys]),
            encoding: .utf8
        ) ?? "{}"

        return .passkey(
            PasskeyFields(
                name: username ?? rpId,
                folderId: nil,
                tags: [],
                rpId: rpId,
                credentialId: bytesToBase64URLNoPadding(credentialIdBytes),
                username: username,
                userDisplayName: displayName,
                rawPasskeyJson: rawJson
            )
        )
    }

    /// base64**url**, no padding -- matching `passkey-types`' own WebAuthn
    /// JSON `id`/`rawId` encoding, so this string byte-matches what a
    /// WebAuthn response (and the extension's own display) shows.
    ///
    /// Deliberately NOT routed through Foundation's `base64EncodedString()`
    /// alone: that produces STANDARD base64 (`+`, `/`, `=`), which would
    /// silently differ from the extension's value in exactly the characters a
    /// casual comparison overlooks. The three substitutions are applied
    /// explicitly, mirroring `types.ts:305-312`.
    static func bytesToBase64URLNoPadding(_ bytes: [Int]) -> String {
        Data(bytes.map { UInt8(truncatingIfNeeded: $0) })
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - 3. withCommonFieldInvariants
    //
    // The ONE invariant the rest of the client DEREFERENCES rather than
    // merely reads. Applied at the point of use as well as here -- see
    // `VaultStore.recomputeTags`. The web client learned twice that a single
    // choke point ASSUMED complete is what fails.

    static func withCommonFieldInvariants(_ fields: ItemFields) -> ItemFields {
        // In Swift the coalescing already happened at decode time (`tags` is
        // decoded as an optional and defaulted). This function is retained as
        // the named counterpart of the TypeScript one so the port is
        // checkable line for line, and because it is the right place for any
        // FUTURE invariant that cannot be expressed in the decoder.
        fields
    }

    // MARK: - 4. normalizeItemShape / normalizeItemFields
    //
    // Called ONCE, right after JSON parsing, before a decrypted item is ever
    // held in the store or rendered. No other code path re-reads either raw
    // wire shape, which is what makes this the single complete trust boundary
    // for untrusted plaintext.

    static func normalizeItemFields(fromPlaintext plaintext: String) throws -> ItemFields {
        guard
            let object = try JSONSerialization.jsonObject(with: Data(plaintext.utf8))
                as? [String: Any]
        else {
            throw ItemNormalizeError.notAnObject
        }
        return withCommonFieldInvariants(try normalizeItemShape(object))
    }

    static func normalizeItemShape(_ raw: [String: Any]) throws -> ItemFields {
        if isRawPasskeyWireFields(raw) {
            return try normalizePasskeyWireFields(raw)
        }
        guard let type = raw["type"] as? String else {
            throw ItemNormalizeError.missingRequiredKey("type", type: "<unknown>")
        }

        // Re-serialize and decode through `Codable` for the discriminated
        // shapes: one decoder, one place the per-type key names live.
        let data = try JSONSerialization.data(withJSONObject: withDefaultedTags(raw, type: type))
        let decoder = JSONDecoder()

        switch type {
        case "login":
            return .login(try decoder.decode(LoginFields.self, from: try migratedLoginData(raw)))
        case "card":
            return .card(try decoder.decode(CardFields.self, from: data))
        case "identity":
            return .identity(try decoder.decode(IdentityFields.self, from: data))
        case "note":
            return .note(try decoder.decode(NoteFields.self, from: data))
        case "totp":
            return .totp(try decoder.decode(TotpFields.self, from: data))
        case "passkey":
            return .passkey(try decoder.decode(PasskeyFields.self, from: data))
        default:
            throw ItemNormalizeError.unknownType(type)
        }
    }

    /// THE tolerance. `tags` absent (or present but not an array of strings)
    /// becomes `[]`. `name` and `folderId` are untouched, so a payload
    /// missing `name` still throws -- see this file's header for why that
    /// asymmetry is deliberate.
    private static func withDefaultedTags(_ raw: [String: Any], type: String) -> [String: Any] {
        // RED was demonstrated by temporarily returning `raw` unchanged, which
        // made `aPayloadWithNoTagsKeyDecodesWithAnEmptyTagArray` fail with a
        // `keyNotFound` for `tags` on every one of the six types. That
        // mutation is reverted here; the test is GREEN again, and it has been
        // shown able to fail rather than assumed able to.
        //
        // The coalescing is deliberately NOT `decodeIfPresent` on each struct:
        // `tags` is non-optional in all six field types precisely so nothing
        // downstream has to unwrap it, and doing it here keeps that guarantee
        // in ONE place instead of six. `type` is accepted but unused — every
        // type carries `tags` via `CommonFields`, and the parameter documents
        // that the tolerance is type-independent by design.
        var out = raw
        if out["tags"] as? [String] == nil {
            // Covers both "key absent" and "present but not an array of
            // strings" — a row whose `tags` is `null`, a string, or an array
            // of numbers is corrected rather than thrown on, matching
            // `store.ts`'s own tolerance (see this file's header).
            out["tags"] = [String]()
        }
        return out
    }

    /// The legacy single-URL login migration (`types.ts:404-409`): an item
    /// whose plaintext carries `url: String` instead of `urls: [String]`
    /// becomes a one-element array. Missing or empty becomes `[]`.
    private static func migratedLoginData(_ raw: [String: Any]) throws -> Data {
        var out = withDefaultedTags(raw, type: "login")
        if out["urls"] as? [String] == nil {
            let legacy = out["url"] as? String
            out["urls"] = (legacy?.isEmpty == false) ? [legacy!] : [String]()
        }
        out.removeValue(forKey: "url")
        return try JSONSerialization.data(withJSONObject: out)
    }

    // MARK: - Encoding back to plaintext
    //
    // The inverse, used by the save path. The `type` discriminant is written
    // from the union case rather than carried through from the decoded
    // struct, so a struct can never be encoded under the wrong discriminant.

    static func plaintextJSON(for fields: ItemFields) throws -> String {
        let encoder = JSONEncoder()
        // Sorted keys so a decode/encode round trip is byte-stable and
        // therefore comparable in a test.
        encoder.outputFormatting = [.sortedKeys]
        let body: Data
        switch fields {
        case let .login(f): body = try encoder.encode(f)
        case let .card(f): body = try encoder.encode(f)
        case let .identity(f): body = try encoder.encode(f)
        case let .note(f): body = try encoder.encode(f)
        case let .totp(f): body = try encoder.encode(f)
        case let .passkey(f): body = try encoder.encode(f)
        }
        guard var object = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw ItemNormalizeError.notAnObject
        }
        object["type"] = fields.typeName
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard let json = String(data: data, encoding: .utf8) else {
            throw ItemNormalizeError.notAnObject
        }
        return json
    }
}
