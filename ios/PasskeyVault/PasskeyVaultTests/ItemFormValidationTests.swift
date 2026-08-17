//
//  ItemFormValidationTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 1.
//
//  Covers `TotpValidation.swift` (the exact limits `crates/pv-core/src/
//  totp.rs` inherits from the vendored `totp-rs` crate -- 6...8 digits,
//  >=16 decoded secret bytes), `TypePicker.swift`'s five-case create
//  surface, and the identity address round trip through the REAL
//  `pv-ffi` crypto (no mock -- `VaultStoreRoundTripTests.swift`'s own
//  header explains why a mocked crypto test is not evidence for a crypto
//  claim).
//

import Foundation
import Testing
@testable import PasskeyVault

struct ItemFormValidationTests {

    // MARK: - TOTP digit-count validation

    @Test func totpRejectsFourDigits() {
        let error = TotpValidation.validate(secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 4)
        #expect(error == .invalidDigits(4))
    }

    @Test func totpRejectsNineDigits() {
        let error = TotpValidation.validate(secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 9)
        #expect(error == .invalidDigits(9))
    }

    @Test func totpAcceptsSixDigitsAndAnEightDigitAlike() {
        #expect(TotpValidation.validate(secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 6) == nil)
        #expect(TotpValidation.validate(secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 8) == nil)
    }

    // MARK: - TOTP secret-length validation

    /// A secret short enough to be rejected -- 16 base32 characters decode
    /// to 10 bytes (80 bits), below the 128-bit/16-byte floor. This is the
    /// EXACT string 38-06's own draft used as its TOTP placeholder before
    /// this plan's Rule 1 fix (see `TypePicker.swift`'s own note) -- proof
    /// that fix was necessary, not cosmetic.
    @Test func totpRejectsASecretShortEnoughToBeRejected() {
        let error = TotpValidation.validate(secretB32: "JBSWY3DPEHPK3PXP", digits: 6)
        #expect(error == .secretTooShort(decodedBytes: 10))
    }

    /// The positive case: a secret long enough to be ACCEPTED, so the two
    /// rejection tests above are proven to discriminate rather than reject
    /// everything. RFC 6238 Appendix B's own SHA1 test-vector secret (also
    /// `crates/pv-core/src/totp.rs`'s `SHA1_SECRET`) -- 32 base32 chars,
    /// 20 decoded bytes.
    @Test func totpAcceptsASecretLongEnoughToBeAccepted() {
        let error = TotpValidation.validate(secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 6)
        #expect(error == nil)
        #expect(TotpValidation.decodeBase32("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")?.count == 20)
    }

    /// Do NOT add validation the implementation does not have: padding and
    /// whitespace are stripped by `generate_code`'s own preprocessing, so a
    /// secret carrying either must be ACCEPTED.
    @Test func totpAcceptsASecretWrittenWithPaddingAndInternalSpaces() {
        let padded = "GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ===="
        #expect(TotpValidation.validate(secretB32: padded, digits: 6) == nil)
        #expect(TotpValidation.cleanedSecret(padded) == "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
    }

    /// The base32 alphabet this decoder mirrors (`Alphabet::Rfc4648
    /// { padding: false }`) has NO lowercase tolerance -- a lowercase
    /// secret must decode-fail, exactly as it would on the Rust side.
    @Test func base32DecodeRejectsLowercaseCharacters() {
        #expect(TotpValidation.decodeBase32("gezdgnbvgy3tqojq") == nil)
    }

    @Test func base32DecodeRejectsAnOutOfAlphabetCharacter() {
        #expect(TotpValidation.decodeBase32("GEZDGNBV!Y3TQOJQ") == nil)
    }

    // MARK: - `ItemCreationKind` (TypePicker.swift): five, not six

    @Test func typePickerOffersExactlyFiveCreatableTypes() {
        #expect(ItemCreationKind.allCases.count == 5)
        let titles = Set(ItemCreationKind.allCases.map(\.title))
        #expect(titles == ["Login", "Card", "Identity", "Note", "Code"])
    }

    /// Regression for the Rule 1 fix `TypePicker.swift` documents: a fresh
    /// "New Code" draft's placeholder secret must itself pass this file's
    /// own validator -- opening a blank TOTP draft must never immediately
    /// show a validation error before the user has typed anything.
    @Test func aFreshTotpDraftsPlaceholderSecretPassesValidation() {
        guard case let .totp(fields) = ItemCreationKind.totp.emptyFields() else {
            Issue.record("expected .totp")
            return
        }
        #expect(TotpValidation.validate(secretB32: fields.secret, digits: fields.digits) == nil)
    }

    // MARK: - Identity address round trip (real pv-ffi, no server)

    /// End to end through the REAL crypto: fill an identity's flat
    /// `address` (as if written by the browser extension), leave every
    /// structured field empty (as `ItemFormView`'s create draft does),
    /// apply the READ-half prefill (opening the form), leave the
    /// structured fields UNTOUCHED, apply the SAVE-half recompose, encrypt,
    /// decrypt, and assert the flat string survived byte for byte.
    /// Reproducing only one half of this round trip is the exact defect
    /// design-conformance names -- see `IdentityAddress.swift`'s header.
    @Test func identityAddressRoundTripsByteForByteThroughRealCrypto() throws {
        let originalAddress = "742 Evergreen Terrace, Springfield, OR 97403, USA"
        let extensionWritten = IdentityFields(
            name: "Homer Simpson", folderId: nil, tags: [],
            firstName: "Homer", lastName: "Simpson", email: "homer@example.com", phone: "",
            address: originalAddress,
            addressLine1: nil, addressLine2: nil, city: nil, state: nil, zip: nil, country: nil,
            notes: ""
        )

        // READ half: opening the edit form.
        let prefilled = IdentityAddress.withLegacyAddressPrefill(extensionWritten)
        #expect(prefilled.addressLine1 == originalAddress, "prefill must seed addressLine1 from the flat string")

        // The user does NOT touch the structured fields -- saves immediately.
        let toSave = IdentityAddress.withComposedLegacyAddress(prefilled)

        let userKey = try FfiUserKey.generate()
        let id = VaultStore.mintItemId()
        let plaintext = try ItemNormalize.plaintextJSON(for: .identity(toSave))
        let wire = try encryptItemWire(userKey: userKey, plaintext: plaintext, itemId: id, revision: 1)
        let recovered = try decryptItemWire(
            userKey: userKey, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson, itemId: id, revision: 1
        )
        let normalized = try ItemNormalize.normalizeItemFields(fromPlaintext: recovered)
        guard case let .identity(decoded) = normalized else {
            Issue.record("expected .identity, got \(normalized.typeName)")
            return
        }

        #expect(decoded.address == originalAddress, "the flat address string must survive byte for byte")
        #expect(decoded.address.utf8.elementsEqual(originalAddress.utf8))
    }

    /// The READ half's own guard: it must NOT prefill when a structured
    /// field is already populated -- that would mean the item was already
    /// edited under the structured form and the flat string is derived,
    /// not authoritative.
    @Test func identityPrefillDoesNotOverwriteAnAlreadyStructuredAddress() {
        let alreadyStructured = IdentityFields(
            name: "x", folderId: nil, tags: [], firstName: "", lastName: "", email: "", phone: "",
            address: "old flat string that should be ignored",
            addressLine1: "123 Real St", addressLine2: nil, city: "Realtown", state: nil, zip: nil,
            country: nil, notes: ""
        )
        let prefilled = IdentityAddress.withLegacyAddressPrefill(alreadyStructured)
        #expect(prefilled.addressLine1 == "123 Real St")
    }
}
