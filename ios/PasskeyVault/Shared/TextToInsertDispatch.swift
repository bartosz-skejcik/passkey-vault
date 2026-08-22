//
//  TextToInsertDispatch.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Plan 44-06 (SAVE-03). The pure, testable half of `prepareInterfaceForUserChoosingTextToInsert()`
//  -- scans an already-fetched `CachedSnapshot` for genuine `type == "totp"` items (decoded per
//  `packages/pv-ui/vault/types.ts`'s `TotpFields` shape) and recomputes a fresh code for any one of
//  them, on demand. Pulled into `Shared/` for the SAME reason `GeneratePasswordDispatch.swift`
//  (Plan 44-05) documents: `CredentialProviderViewController.swift` compiles only into the
//  extension target, which `PasskeyVaultTests`'s `@testable import PasskeyVault` (the HOST app
//  module) cannot see -- this plan's own live-run acceptance criteria (an independent RFC 6238
//  match) needs this logic reachable from a plain XCTest/Swift Testing target with no live
//  extension context.
//
//  `SessionKeyReader`/`AppGroupCiphertextCacheStore.currentAccountMarker()`/`readCurrentSnapshot`
//  stay OUTSIDE this file, at the real override's own call site
//  (`CredentialProviderViewController.prepareInterfaceForUserChoosingTextToInsert()`) --
//  `SessionKeyReader` lives in `PasskeyVaultAutoFill/` only (extension-only, per that file's own
//  header: "separate build targets, no shared framework between them"), so this file takes an
//  ALREADY-obtained `FfiUserKey` and an ALREADY-read `CachedSnapshot` as plain parameters instead,
//  keeping every dependency here target-agnostic (`pv-ffi` bindings + `PvShared`'s `CachedSnapshot`
//  only).
//
//  NEVER a hand-rolled Swift TOTP implementation (must_haves.truths) -- `freshCode(for:at:)` is the
//  ONLY place this surface computes a code, and it does so by calling the SAME `totpNow` `pv-ffi`
//  export `TotpCountdownView.swift` (host-only, Phase 38) already calls. The live picker row
//  (`TextToInsertListView.swift`) and the final selection-time recompute
//  (`CredentialProviderViewController.completeTextToInsert`) both route through this ONE function --
//  never a second, divergent computation.
//

import Foundation

enum TextToInsertDispatch {
    /// One cached TOTP-typed item's minimal, insertable-code-relevant plaintext -- carries the
    /// secret in the clear because the caller has ALREADY decrypted it (same rationale
    /// `crates/pv-ffi/src/totp.rs`'s own module header gives for `totp_now`'s plain-`String`
    /// secret parameter: this is per-item plaintext the caller already holds, not top-tier key
    /// material crossing a trust boundary for the first time).
    struct Candidate: Identifiable, Equatable {
        let itemId: String
        let name: String
        let secretB32: String
        let algorithm: String
        let digits: Int
        let period: Int

        var id: String { itemId }
    }

    /// Bounded default (`<behavior>`, 44-06-PLAN.md): a runaway vault must not produce an
    /// unbounded picker.
    static let maxCandidates = 5

    /// Raw plaintext shape this surface cares about -- a strict subset of
    /// `packages/pv-ui/vault/types.ts`'s `TotpFields`. `JSONDecoder` ignores every other key by
    /// default (the SAME discipline `CredentialProviderViewController.RebuildLoginPayload` already
    /// establishes for the login-item rebuild path), so this decodes the SAME real production
    /// plaintext without needing the host target's full `ItemFields` model.
    private struct TotpPayload: Decodable {
        let type: String?
        let name: String?
        let secret: String?
        let algorithm: String?
        let digits: Int?
        let period: Int?
    }

    /// Mirrors `CredentialProviderViewController.RebuildWireWrappedKey`/`decodeRebuildWireKey` --
    /// duplicated rather than shared for the same "separate build targets, no shared framework"
    /// reason that file's own header gives; this copy lives here so `buildCandidates` below needs
    /// no dependency back into the extension-only file.
    private struct WireWrappedKey: Decodable {
        let nonce: [UInt8]
        let ciphertext: [UInt8]
    }

    private static func decodeWireKey(_ json: String) -> FfiWrappedKey? {
        guard let wire = try? JSONDecoder().decode(WireWrappedKey.self, from: Data(json.utf8)) else {
            return nil
        }
        return FfiWrappedKey(nonce: Data(wire.nonce), ciphertext: Data(wire.ciphertext))
    }

    /// Scans every row in `snapshot`, decrypts each with `userKey`, and keeps only genuine
    /// `type == "totp"` items carrying a non-empty secret -- the SAME decrypt-every-row pattern
    /// `CredentialProviderViewController.performPasskeyAssertion`/`runIdentityRebuildIfPending`
    /// already establish (not a second scanning mechanism, just this surface's own filter
    /// predicate), bounded to `maxCandidates` and sorted by name for a stable presentation order.
    /// A decrypt/parse failure on any one row is skipped, never fatal to the whole list (mirrors
    /// every other cache-scanning loop in this codebase).
    static func buildCandidates(snapshot: CachedSnapshot, userKey: FfiUserKey) -> [Candidate] {
        var candidates: [Candidate] = []
        for row in snapshot.items {
            guard
                let encKey = decodeWireKey(row.encKey),
                let encData = decodeWireKey(row.encData),
                let revision32 = UInt32(exactly: row.revision)
            else {
                continue
            }
            let item = FfiEncryptedItem(encKey: encKey, encData: encData)
            guard let plaintext = try? decryptItem(userKey: userKey, item: item, itemId: row.id, revision: revision32) else {
                continue
            }
            guard
                let payload = try? JSONDecoder().decode(TotpPayload.self, from: Data(plaintext.utf8)),
                payload.type == "totp",
                let secret = payload.secret, !secret.isEmpty,
                let algorithm = payload.algorithm,
                let digits = payload.digits,
                let period = payload.period
            else {
                continue
            }
            candidates.append(Candidate(
                itemId: row.id,
                name: (payload.name?.isEmpty == false) ? payload.name! : "Verification code",
                secretB32: secret,
                algorithm: algorithm,
                digits: digits,
                period: period
            ))
        }
        candidates.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        if candidates.count > maxCandidates {
            candidates = Array(candidates.prefix(maxCandidates))
        }
        return candidates
    }

    enum DispatchError: Error {
        case outOfRangeParameters
    }

    /// Recomputes `candidate`'s code FRESH at `unixTimeSeconds` -- never a cached, list-build-time
    /// value. The picker row (`TextToInsertListView.TotpInsertRow`) calls this every tick; the real
    /// override's own final selection (`CredentialProviderViewController.completeTextToInsert`)
    /// calls it ONE MORE TIME at the instant of selection, never reusing the row's last-rendered
    /// value -- a 30s+ delay between list presentation and selection must observably re-derive a
    /// different code once the window has genuinely rolled (44-06-PLAN.md's own acceptance
    /// criterion).
    static func freshCode(for candidate: Candidate, at unixTimeSeconds: UInt64) -> Result<FfiTotpCode, Error> {
        Result {
            guard
                let digits32 = UInt32(exactly: candidate.digits),
                let period64 = UInt64(exactly: candidate.period)
            else {
                throw DispatchError.outOfRangeParameters
            }
            return try totpNow(
                secretB32: candidate.secretB32,
                algorithm: candidate.algorithm,
                digits: digits32,
                period: period64,
                unixTimeSeconds: unixTimeSeconds
            )
        }
    }
}
