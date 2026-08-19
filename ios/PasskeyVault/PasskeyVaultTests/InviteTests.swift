//
//  InviteTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06. ONE Swift
//  Testing suite -- deliberately not split into pure/live sibling types the
//  way `FfiSharingTests`/`FfiSharingLiveProofTests` are, because this
//  plan's own `<verify>` commands target `PasskeyVaultTests/InviteTests`
//  (Tasks 1-2, no server) and
//  `PasskeyVaultTests/InviteTests/liveInviteRedeemedByWebAccount` (Task 3,
//  live) as the SAME suite, by name.
//
//  Task 1: the two base64 alphabets (`Base64Alphabets.swift`).
//  Task 2: `InviteService.generateInviteLink` -- pure, network-free via a
//  fake `URLProtocol` transport (`InviteTestsStubURLProtocol`, same shape
//  as `VaultMutationTests.swift`'s `VaultMutationStubURLProtocol`).
//  Task 3: `liveInviteRedeemedByWebAccount` -- E-F2, live, against a real
//  `pv-server` and the `scripts/invite-live-e2e.mjs` Node/pv-wasm harness
//  (the SECOND real client, per this plan's own phase-context override:
//  redemption happens through the established pv-wasm Node driver pattern,
//  not an actual browser page load of `/invite/{id}`).
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Task 1: the two base64 alphabets

extension InviteTests {

    /// Fixed 32-byte literal whose STANDARD base64 encoding contains at
    /// least one `+` and one `/` -- chosen deliberately (computed offline,
    /// never derived from the code under test) so the two alphabets
    /// visibly diverge and a swapped helper cannot pass.
    static let alphabetFixtureBytes: [UInt8] = [
        0xb4, 0xe2, 0xe3, 0x75, 0x80, 0x3c, 0xd1, 0xcc, 0x5c, 0xee, 0xdb, 0x34, 0x83, 0xe3, 0xb3, 0x6b,
        0x2c, 0xf3, 0x95, 0x34, 0x4d, 0x0f, 0xd0, 0x5a, 0x88, 0x27, 0x7f, 0xe8, 0xc5, 0xf3, 0x8c, 0x78,
    ]
    static var alphabetFixtureData: Data { Data(alphabetFixtureBytes) }
    static let expectedUrlSafeNoPad = "tOLjdYA80cxc7ts0g-OzayzzlTRND9BaiCd_6MXzjHg"
    static let expectedStandard = "tOLjdYA80cxc7ts0g+OzayzzlTRND9BaiCd/6MXzjHg="
}

struct InviteTests {

    @Test func urlSafeNoPadEncodingMatchesHardCodedLiteral() {
        let encoded = UrlSafeNoPadBase64.encode(Self.alphabetFixtureData)
        #expect(encoded == Self.expectedUrlSafeNoPad)
        #expect(!encoded.contains("="))
        #expect(encoded.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil)
    }

    @Test func urlSafeNoPadRoundTripRecoversOriginalBytes() throws {
        let encoded = UrlSafeNoPadBase64.encode(Self.alphabetFixtureData)
        let decoded = try UrlSafeNoPadBase64.decode(encoded)
        #expect(decoded == Self.alphabetFixtureData)
    }

    @Test func standardEncodingMatchesHardCodedLiteralAndContainsPlusAndSlash() {
        let encoded = StandardBase64.encode(Self.alphabetFixtureData)
        #expect(encoded == Self.expectedStandard)
        #expect(encoded.contains("+"))
        #expect(encoded.contains("/"))
        #expect(encoded != Self.expectedUrlSafeNoPad, "the two encodings of the SAME bytes must visibly differ")
    }

    @Test func standardRoundTripRecoversOriginalBytes() throws {
        let encoded = StandardBase64.encode(Self.alphabetFixtureData)
        let decoded = try StandardBase64.decode(encoded)
        #expect(decoded == Self.alphabetFixtureData)
    }

    /// `expectedUrlSafeNoPad` contains `-`/`_`, which are NOT members of
    /// the standard base64 alphabet -- `StandardBase64.decode` must throw,
    /// never silently produce different-but-plausible-looking bytes. This
    /// is the acceptance criterion's "round-tripping through the WRONG
    /// helper does not silently produce plausible-looking bytes",
    /// demonstrated as a thrown error rather than a byte mismatch.
    @Test func decodingUrlSafeStringWithStandardDecoderThrowsRatherThanRecoveringWrongBytes() {
        let urlSafeEncoded = UrlSafeNoPadBase64.encode(Self.alphabetFixtureData)
        #expect(urlSafeEncoded.contains("-") || urlSafeEncoded.contains("_"),
                "the fixture must exercise the divergence -- otherwise this test proves nothing")
        #expect(throws: (any Error).self) {
            _ = try StandardBase64.decode(urlSafeEncoded)
        }
    }
}
