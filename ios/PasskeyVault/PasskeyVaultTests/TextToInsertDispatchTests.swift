//
//  TextToInsertDispatchTests.swift
//  PasskeyVaultTests
//
//  Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-06 (SAVE-03). Live-run proof of
//  `TextToInsertDispatch` (`Shared/TextToInsertDispatch.swift`), against REAL `pv-ffi` -- never a
//  mock -- with no live extension context required (same reasoning `GeneratePasswordDispatchTests
//  .swift`'s own header documents: `CredentialProviderViewController.swift` compiles only into the
//  extension target, which this test target's `@testable import PasskeyVault` -- the HOST app
//  module -- cannot see).
//
//  Every expected code below is a LITERAL, independently transcribed from RFC 6238 Appendix B --
//  the SAME oracle-comparison discipline Phase 38's own E-T1 already established (`ios/IOS-SPIKE-LOG.md`
//  section E-T1, `TotpFfiTests.swift`'s own header) -- never computed by calling `totpNow`/
//  `freshCode` and comparing it back to itself. Reusing THAT pattern, not inventing a second one,
//  is this plan's own `<read_first>` instruction.
//
//  Covers Task 1's own acceptance criteria:
//    - `buildCandidates` filters to genuine `type == "totp"` items only (a login/passkey-shaped row
//      in the SAME snapshot is correctly skipped, never mistaken for a TOTP item).
//    - `buildCandidates` bounds the result to `maxCandidates` (5) even when more exist, and sorts
//      by name for a stable order.
//    - `freshCode(for:at:)` matches all six published RFC 6238 SHA1 vectors -- the identical
//      literal fixtures `TotpFfiTests.swift`/`crates/pv-ffi/src/totp.rs`'s own test module already
//      use, proving this dispatch layer's OWN call-through is byte-correct, not merely "compiles".
//    - Selecting the SAME candidate at two different timestamps straddling a period boundary
//      produces two DIFFERENT codes -- the live behavioural proof that `completeTextToInsert`
//      recomputing at selection time (rather than reusing a list-build-time value) is meaningful,
//      not a no-op.
//

import Foundation
import Testing
@testable import PasskeyVault

@Suite
struct TextToInsertDispatchTests {
    // MARK: - Literal fixtures (RFC 6238 Appendix B, transcribed independently -- see header)

    private static let sha1Secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    private static func totpCandidate(itemId: String = "totp-1", name: String = "Example") -> TextToInsertDispatch.Candidate {
        TextToInsertDispatch.Candidate(
            itemId: itemId, name: name, secretB32: sha1Secret, algorithm: "SHA1", digits: 8, period: 30
        )
    }

    // MARK: - freshCode -- independent RFC 6238 vectors

    @Test("freshCode matches all six published RFC 6238 SHA1 vectors")
    func freshCodeMatchesRfc6238Vectors() throws {
        let cases: [(UInt64, String)] = [
            (59, "94287082"),
            (1_111_111_109, "07081804"),
            (1_111_111_111, "14050471"),
            (1_234_567_890, "89005924"),
            (2_000_000_000, "69279037"),
            (20_000_000_000, "65353130"),
        ]
        let candidate = Self.totpCandidate()
        for (t, expected) in cases {
            let outcome = TextToInsertDispatch.freshCode(for: candidate, at: t)
            guard case let .success(result) = outcome else {
                Issue.record("expected success at t=\(t), got \(outcome)")
                continue
            }
            #expect(result.code == expected, "mismatch at t=\(t)")
        }
    }

    @Test("freshCode recomputed at two timestamps straddling a period boundary yields two different codes")
    func freshCodeChangesAcrossPeriodBoundary() throws {
        // t=59 (94287082) and t=1_111_111_109 (07081804) straddle many period boundaries --
        // reusing the SAME two RFC 6238 vectors above proves the "never a list-build-time value"
        // requirement behaviourally: two calls to freshCode at genuinely different times produce
        // genuinely different codes for the SAME candidate, exactly what `completeTextToInsert`'s
        // own selection-time recompute depends on being true.
        let candidate = Self.totpCandidate()
        guard
            case let .success(first) = TextToInsertDispatch.freshCode(for: candidate, at: 59),
            case let .success(second) = TextToInsertDispatch.freshCode(for: candidate, at: 1_111_111_109)
        else {
            Issue.record("expected both calls to succeed")
            return
        }
        #expect(first.code != second.code)
    }

    // MARK: - buildCandidates -- filtering, bounding, sorting

    private static func encryptedRow(id: String, plaintext: String, userKey: FfiUserKey, revision: UInt32 = 1) throws -> CachedSnapshot.Item {
        let encrypted = try encryptItem(userKey: userKey, plaintext: plaintext, itemId: id, revision: revision)
        let encKeyJson = try Self.jsonString(nonce: encrypted.encKey.nonce, ciphertext: encrypted.encKey.ciphertext)
        let encDataJson = try Self.jsonString(nonce: encrypted.encData.nonce, ciphertext: encrypted.encData.ciphertext)
        return CachedSnapshot.Item(
            id: id, encKey: encKeyJson, encData: encDataJson, revision: Int(revision),
            updatedAt: "2026-01-01T00:00:00Z", lastUsedAt: nil, isShared: false, collectionId: nil,
            lastEditorEmail: nil
        )
    }

    private static func jsonString(nonce: Data, ciphertext: Data) throws -> String {
        let payload: [String: [UInt8]] = ["nonce": Array(nonce), "ciphertext": Array(ciphertext)]
        let data = try JSONSerialization.data(withJSONObject: payload)
        return String(data: data, encoding: .utf8)!
    }

    private static func totpPlaintext(name: String, secret: String = sha1Secret) -> String {
        """
        {"type":"totp","name":"\(name)","folderId":null,"tags":[],"secret":"\(secret)","issuer":"","algorithm":"SHA1","digits":8,"period":30,"notes":""}
        """
    }

    private static func loginPlaintext(name: String) -> String {
        """
        {"type":"login","name":"\(name)","folderId":null,"tags":[],"username":"u","password":"p","urls":[],"notes":""}
        """
    }

    @Test("buildCandidates skips a genuine login-shaped row and keeps only type==totp rows")
    func buildCandidatesFiltersByType() throws {
        let userKey = try FfiUserKey.generate()
        let loginRow = try Self.encryptedRow(id: "login-1", plaintext: Self.loginPlaintext(name: "Not TOTP"), userKey: userKey)
        let totpRow = try Self.encryptedRow(id: "totp-1", plaintext: Self.totpPlaintext(name: "Real TOTP"), userKey: userKey)
        let snapshot = CachedSnapshot(
            revision: 1, 0, accountId: "acct", serverBaseURL: "https://example.invalid",
            items: [loginRow, totpRow], folders: []
        )

        let candidates = TextToInsertDispatch.buildCandidates(snapshot: snapshot, userKey: userKey)
        #expect(candidates.count == 1)
        #expect(candidates.first?.itemId == "totp-1")
        #expect(candidates.first?.name == "Real TOTP")
    }

    @Test("buildCandidates bounds the result to maxCandidates and sorts by name")
    func buildCandidatesBoundsAndSorts() throws {
        let userKey = try FfiUserKey.generate()
        // 7 TOTP rows, named so alphabetical order != insertion order -- proves both the cap
        // (5, TextToInsertDispatch.maxCandidates) and the sort are real, not incidental.
        let names = ["Gamma", "Alpha", "Zeta", "Beta", "Echo", "Delta", "Foxtrot"]
        let rows = try names.enumerated().map { index, name in
            try Self.encryptedRow(id: "totp-\(index)", plaintext: Self.totpPlaintext(name: name), userKey: userKey)
        }
        let snapshot = CachedSnapshot(
            revision: 1, 0, accountId: "acct", serverBaseURL: "https://example.invalid",
            items: rows, folders: []
        )

        let candidates = TextToInsertDispatch.buildCandidates(snapshot: snapshot, userKey: userKey)
        #expect(candidates.count == TextToInsertDispatch.maxCandidates)
        #expect(candidates.map(\.name) == ["Alpha", "Beta", "Delta", "Echo", "Foxtrot"])
    }

    @Test("buildCandidates skips a TOTP row with an empty secret rather than crashing")
    func buildCandidatesSkipsEmptySecret() throws {
        let userKey = try FfiUserKey.generate()
        let badRow = try Self.encryptedRow(id: "totp-bad", plaintext: Self.totpPlaintext(name: "Bad", secret: ""), userKey: userKey)
        let goodRow = try Self.encryptedRow(id: "totp-good", plaintext: Self.totpPlaintext(name: "Good"), userKey: userKey)
        let snapshot = CachedSnapshot(
            revision: 1, 0, accountId: "acct", serverBaseURL: "https://example.invalid",
            items: [badRow, goodRow], folders: []
        )

        let candidates = TextToInsertDispatch.buildCandidates(snapshot: snapshot, userKey: userKey)
        #expect(candidates.count == 1)
        #expect(candidates.first?.itemId == "totp-good")
    }

    /// WR-09 (44-REVIEW.md): `buildCandidates` used to decrypt EVERY row before applying
    /// `maxCandidates`, the heaviest allocation on any of this phase's three new surfaces inside
    /// the memory-budgeted AutoFill extension. It now stops scanning once it has collected
    /// `maxCandidates * 2` genuinely-matching candidates.
    ///
    /// This is observable from the OUTSIDE, without instrumenting the scan itself: 10 rows named
    /// "K"..."T" (all alphabetically AFTER the two rows that follow) are placed FIRST in cache
    /// order, then two rows named "AAA"/"AAB" (the globally alphabetically-smallest names) are
    /// placed LAST. `maxCandidates * 2` is exactly 10 -- the scan reaches that bound processing
    /// "K"..."T" and breaks BEFORE ever reaching "AAA"/"AAB", so they never appear in the result,
    /// even though they would sort first. Before this fix, `buildCandidates` decrypted every row
    /// unconditionally, so "AAA"/"AAB" WOULD have appeared in the final 5 (confirmed RED against
    /// the pre-fix source: the result included "AAA" and "AAB", not "K"/"L"/"M"/"N"/"O").
    @Test("buildCandidates stops scanning once it has enough candidates, never reaching later rows")
    func buildCandidatesStopsScanningEarly() throws {
        let userKey = try FfiUserKey.generate()
        let earlyNames = ["K", "L", "M", "N", "O", "P", "Q", "R", "S", "T"]
        let lateNames = ["AAA", "AAB"]
        let rows = try (earlyNames + lateNames).enumerated().map { index, name in
            try Self.encryptedRow(id: "totp-\(index)", plaintext: Self.totpPlaintext(name: name), userKey: userKey)
        }
        #expect(rows.count == TextToInsertDispatch.maxCandidates * 2 + 2, "fixture must exceed the bound by exactly 2 rows")
        let snapshot = CachedSnapshot(
            revision: 1, 0, accountId: "acct", serverBaseURL: "https://example.invalid",
            items: rows, folders: []
        )

        let candidates = TextToInsertDispatch.buildCandidates(snapshot: snapshot, userKey: userKey)
        #expect(candidates.count == TextToInsertDispatch.maxCandidates)
        #expect(
            candidates.map(\.name) == ["K", "L", "M", "N", "O"],
            "the alphabetically-smallest rows placed AFTER the *2 bound must never be reached: \(candidates.map(\.name))"
        )
        #expect(!candidates.map(\.name).contains("AAA"), "a row placed after the scan's own early-stop bound must never appear")
        #expect(!candidates.map(\.name).contains("AAB"), "a row placed after the scan's own early-stop bound must never appear")
    }
}
