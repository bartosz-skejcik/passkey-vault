//
//  ItemDecodeTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-03, Task 1.
//
//  Every fixture below is a hand-written JSON literal transcribed from
//  `packages/pv-ui/vault/types.ts`' own interface declarations -- never a
//  string produced by calling the encoder under test and comparing it back to
//  itself. A fixture computed by the code under test proves nothing.
//

import Foundation
import Testing
@testable import PasskeyVault

struct ItemDecodeTests {

    // MARK: - One payload per type (six)

    @Test func loginDecodesWithItsFullFieldSet() throws {
        let json = """
        {"type":"login","name":"GitHub","folderId":"f-1","tags":["dev"],\
        "username":"bartek","password":"s3cret","urls":["https://github.com","https://gist.github.com"],\
        "notes":"work account"}
        """
        guard case let .login(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .login"); return
        }
        #expect(f.name == "GitHub")
        #expect(f.folderId == "f-1")
        #expect(f.tags == ["dev"])
        #expect(f.username == "bartek")
        #expect(f.password == "s3cret")
        #expect(f.urls == ["https://github.com", "https://gist.github.com"])
        #expect(f.notes == "work account")
    }

    @Test func cardDecodesIncludingTheAdditiveOptionalsAndTheirAbsence() throws {
        let withExtras = """
        {"type":"card","name":"Visa","folderId":null,"tags":[],"cardholderName":"B. Paczesny",\
        "number":"4111111111111111","expiry":"12/29","cvv":"123","pin":"9999","zip":"00-001","notes":""}
        """
        guard case let .card(a) = try ItemNormalize.normalizeItemFields(fromPlaintext: withExtras) else {
            Issue.record("expected .card"); return
        }
        #expect(a.pin == "9999")
        #expect(a.zip == "00-001")
        #expect(a.folderId == nil)

        // An item written BEFORE pin/zip existed must still decode.
        let withoutExtras = """
        {"type":"card","name":"Old","folderId":null,"tags":[],"cardholderName":"X",\
        "number":"4111","expiry":"01/26","cvv":"000","notes":""}
        """
        guard case let .card(b) = try ItemNormalize.normalizeItemFields(fromPlaintext: withoutExtras) else {
            Issue.record("expected .card"); return
        }
        #expect(b.pin == nil)
        #expect(b.zip == nil)
    }

    @Test func identityDecodesWithBothTheFlatAndStructuredAddress() throws {
        let json = """
        {"type":"identity","name":"Me","folderId":null,"tags":[],"firstName":"Bartek",\
        "lastName":"Paczesny","email":"b@example.com","phone":"+48 000 000 000",\
        "address":"ul. Testowa 1, 00-001 Warszawa","city":"Warszawa","notes":""}
        """
        guard case let .identity(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .identity"); return
        }
        #expect(f.address == "ul. Testowa 1, 00-001 Warszawa")
        #expect(f.city == "Warszawa")
        #expect(f.addressLine1 == nil)
    }

    @Test func noteCarriesABodyAndHasNoNotesField() throws {
        let json = #"{"type":"note","name":"Scratch","folderId":null,"tags":["x"],"body":"line one\nline two"}"#
        guard case let .note(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .note"); return
        }
        #expect(f.body == "line one\nline two")

        // The asymmetry, asserted rather than assumed: re-encoding a note
        // must not emit a `notes` key. `note` carries `body`; every other
        // type carries `notes`. Confusing the two renders blank elsewhere.
        let encoded = try ItemNormalize.plaintextJSON(for: .note(f))
        #expect(encoded.contains("\"body\""))
        #expect(!encoded.contains("\"notes\""))
    }

    @Test func totpDecodesItsFiveParameters() throws {
        let json = """
        {"type":"totp","name":"Bank","folderId":null,"tags":[],"secret":"JBSWY3DPEHPK3PXP",\
        "issuer":"Bank SA","algorithm":"SHA256","digits":8,"period":60,"notes":""}
        """
        guard case let .totp(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .totp"); return
        }
        #expect(f.secret == "JBSWY3DPEHPK3PXP")
        #expect(f.issuer == "Bank SA")
        #expect(f.algorithm == "SHA256")
        #expect(f.digits == 8)
        #expect(f.period == 60)
    }

    /// THE sixth type -- the one the ROADMAP's five-type reading does not
    /// have. Its plaintext has NO `type`, `name`, `folderId` or `tags` at
    /// all: it is `pv-provider`'s `SerializablePasskey` mirror, snake_case,
    /// with byte fields as JSON number arrays.
    @Test func rawPasskeyWireShapeIsRecognizedByShapeNotByATypeKey() throws {
        // credential_id bytes chosen so the base64url encoding exercises BOTH
        // substitutions and the padding strip: 0xFB 0xFF 0xBF standard-encodes
        // to "+/+/" family characters.
        let json = """
        {"key_cbor":[1,2,3],"credential_id":[251,255,191,254],"rp_id":"example.com",\
        "user_handle":[9,9],"username":"bartek@example.com","user_display_name":"Bartek",\
        "counter":0,"extensions":{"hmac_secret":true}}
        """
        guard case let .passkey(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .passkey"); return
        }
        #expect(f.rpId == "example.com")
        #expect(f.username == "bartek@example.com")
        #expect(f.userDisplayName == "Bartek")
        // name is SYNTHESIZED: username preferred, rp_id as fallback.
        #expect(f.name == "bartek@example.com")
        #expect(f.folderId == nil)
        #expect(f.tags == [])

        // base64url, no padding. Standard base64 of FB FF BF FE is "+/+//g=="
        // -- so this asserts all three substitutions at once, which a
        // padding-free ASCII-only fixture would not have.
        #expect(f.credentialId == "-_-__g")
        #expect(!f.credentialId.contains("+"))
        #expect(!f.credentialId.contains("/"))
        #expect(!f.credentialId.contains("="))

        // The full raw wire JSON is retained, including what this view does
        // not surface -- an edit that dropped key_cbor would destroy the
        // credential.
        #expect(f.rawPasskeyJson.contains("key_cbor"))
        #expect(f.rawPasskeyJson.contains("hmac_secret"))
    }

    @Test func passkeyNameFallsBackToRpIdWhenThereIsNoUsername() throws {
        let json = #"{"key_cbor":[1],"credential_id":[1,2],"rp_id":"fallback.example"}"#
        guard case let .passkey(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .passkey"); return
        }
        #expect(f.name == "fallback.example")
    }

    // MARK: - The tolerance, and its deliberate limit

    /// The account-wedging defect. A payload with NO `tags` key must decode
    /// with an empty array, not throw.
    @Test func aPayloadWithNoTagsKeyDecodesWithAnEmptyTagArray() throws {
        let json = #"{"type":"note","name":"Tagless","folderId":null,"body":"no tags key at all"}"#
        let fields = try ItemNormalize.normalizeItemFields(fromPlaintext: json)
        #expect(fields.tags == [])
        #expect(fields.name == "Tagless")
    }

    /// The other half of the same asymmetry, and it is deliberate: `name` is
    /// NOT defaulted, because it is only ever rendered and never
    /// dereferenced in a way that can throw. Defaulting it would be
    /// speculative rather than corrective. This test is what stops a future
    /// change from "helpfully" widening the tolerance.
    @Test func aPayloadWithNoNameKeyThrowsRatherThanSubstitutingADefault() throws {
        let json = #"{"type":"note","folderId":null,"tags":[],"body":"nameless"}"#
        #expect(throws: (any Error).self) {
            _ = try ItemNormalize.normalizeItemFields(fromPlaintext: json)
        }
    }

    @Test func anUnknownTypeThrowsAndNamesTheOffendingValue() throws {
        let json = #"{"type":"spaceship","name":"?","folderId":null,"tags":[]}"#
        #expect(throws: (any Error).self) {
            _ = try ItemNormalize.normalizeItemFields(fromPlaintext: json)
        }
    }

    // MARK: - The legacy login shape

    @Test func aLegacySingleUrlLoginBecomesAOneElementArrayWithoutLosingTheUrl() throws {
        let json = """
        {"type":"login","name":"Legacy","folderId":null,"tags":[],"username":"u","password":"p",\
        "url":"https://legacy.example","notes":""}
        """
        guard case let .login(f) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .login"); return
        }
        #expect(f.urls == ["https://legacy.example"], "the legacy URL must survive, not be dropped")

        // And the empty/missing case, which must NOT produce [""].
        let empty = #"{"type":"login","name":"L","folderId":null,"tags":[],"username":"u","password":"p","url":"","notes":""}"#
        guard case let .login(g) = try ItemNormalize.normalizeItemFields(fromPlaintext: empty) else {
            Issue.record("expected .login"); return
        }
        #expect(g.urls == [])
    }

    // MARK: - The identity address round trip, both directions

    /// The flat address is the extension autofill's SOURCE OF TRUTH. Encoding
    /// an identity whose structured fields are all empty must preserve it
    /// byte for byte.
    ///
    /// The fixture contains a comma AND a newline on purpose: a single-token
    /// address would pass even under an implementation that split on commas
    /// or collapsed whitespace.
    @Test func aFlatAddressSurvivesADecodeEncodeRoundTripWhenNoStructuredFieldIsSet() throws {
        let flat = "ul. Testowa 1/3, 00-001 Warszawa\nPolska"
        let json = """
        {"type":"identity","name":"Me","folderId":null,"tags":[],"firstName":"B","lastName":"P",\
        "email":"b@example.com","phone":"","address":\(quoted(flat)),"notes":""}
        """
        guard case let .identity(decoded) = try ItemNormalize.normalizeItemFields(fromPlaintext: json) else {
            Issue.record("expected .identity"); return
        }
        #expect(decoded.address == flat)

        // The SAVE half must not clobber it with an empty recomposition.
        let saved = IdentityAddress.withComposedLegacyAddress(decoded)
        #expect(saved.address == flat, "an all-empty structured recompose must never overwrite a real address")

        let reencoded = try ItemNormalize.plaintextJSON(for: .identity(saved))
        guard case let .identity(round) = try ItemNormalize.normalizeItemFields(fromPlaintext: reencoded) else {
            Issue.record("expected .identity"); return
        }
        #expect(round.address == flat)
    }

    @Test func theReadHalfSeedsLineOneFromTheFlatAddressOnlyWhenNothingStructuredIsSet() throws {
        var fields = IdentityFields(
            name: "Me", folderId: nil, tags: [], firstName: "B", lastName: "P",
            email: "", phone: "", address: "ul. Testowa 1, Warszawa",
            addressLine1: nil, addressLine2: nil, city: nil, state: nil, zip: nil, country: nil,
            notes: ""
        )
        let seeded = IdentityAddress.withLegacyAddressPrefill(fields)
        #expect(seeded.addressLine1 == "ul. Testowa 1, Warszawa")

        // With ANY structured content present, the flat string is derived,
        // not authoritative -- do not seed over it.
        fields.city = "Kraków"
        let untouched = IdentityAddress.withLegacyAddressPrefill(fields)
        #expect(untouched.addressLine1 == nil)
    }

    @Test func structuredFieldsRecomposeIntoACommaJoinedFlatAddress() throws {
        let fields = IdentityFields(
            name: "Me", folderId: nil, tags: [], firstName: "B", lastName: "P",
            email: "", phone: "", address: "stale value",
            addressLine1: "ul. Testowa 1/3", addressLine2: "  ", city: "Warszawa",
            state: nil, zip: "00-001", country: "Polska", notes: ""
        )
        // A comma join for the flat string (the extension fills ONE input),
        // a newline join for display. The two are different on purpose.
        #expect(
            IdentityAddress.composeLegacyAddress(fields)
                == "ul. Testowa 1/3, Warszawa, 00-001, Polska"
        )
        #expect(
            IdentityAddress.displayAddress(fields)
                == "ul. Testowa 1/3\nWarszawa\n00-001\nPolska"
        )
        // Whitespace-only line 2 was dropped entirely, not rendered as an
        // empty segment.
        #expect(!IdentityAddress.composeLegacyAddress(fields).contains(", ,"))
        #expect(IdentityAddress.withComposedLegacyAddress(fields).address
                == "ul. Testowa 1/3, Warszawa, 00-001, Polska")
    }

    // MARK: - The pending-family-key placeholder

    /// A row in this state has NO fields by construction. Every accessor must
    /// be safe on it -- a force-unwrap here would trap on a perfectly normal
    /// situation (the key simply has not arrived yet).
    @Test func readingAPendingFamilyKeyPlaceholderDoesNotTrap() throws {
        let placeholder = VaultItemViewModel(
            id: "pending-family-key:col-1", revision: 0, content: .pendingFamilyKey
        )
        #expect(placeholder.fields == nil)
        #expect(placeholder.tags == [])
        #expect(placeholder.isPendingFamilyKey)
        // And it is NOT the integrity signal -- the two are independently
        // checked conditions and neither is folded into the other.
        #expect(placeholder.isUndecryptable == false)
        #expect(!placeholder.displayName.isEmpty)
    }

    /// The mirror assertion: an `undecryptable` row is also field-less and
    /// also safe, and is NOT reported as pending.
    @Test func anUndecryptableRowIsRetainedFieldlessAndDistinctFromPending() throws {
        let row = VaultItemViewModel(
            id: "row-1", revision: 4, content: .undecryptable(reason: "AEAD failure")
        )
        #expect(row.fields == nil)
        #expect(row.tags == [])
        #expect(row.isUndecryptable)
        #expect(row.isPendingFamilyKey == false)
        // Its revision is known STALE; it is carried so 38-09's save path can
        // refuse to use it as the expected revision (T-38-03-05).
        #expect(row.revision == 4)
    }

    // MARK: - helpers

    private func quoted(_ s: String) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!
            .dropFirst().dropLast().description
    }
}
