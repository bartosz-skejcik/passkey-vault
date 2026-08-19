//
//  Base64Alphabets.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06, Task 1.
//  Ported from `web/src/lib/invite/crypto.ts`'s `base64UrlEncode`/
//  `base64UrlDecode` (`git show main:web/src/lib/invite/crypto.ts`) -- that
//  file's own header warns: "conflating the two encodings would silently
//  corrupt whichever one used the wrong alphabet." TWO SEPARATE helper
//  pairs below, deliberately with NO shared implementation behind a flag
//  argument -- a flag is exactly the shape that gets passed wrong (this
//  task's own <action> text).
//
//  - `UrlSafeNoPadBase64` -- the invite URL FRAGMENT alphabet: RFC 4648 §5
//    URL-safe, no padding. Used ONLY for the invite secret that travels in
//    a URL fragment (`InviteService.swift`).
//  - `StandardBase64` -- every proof value/JSON body field in this
//    codebase's existing binary-field discipline (DR-38-C/DR-40-A,
//    `crates/pv-ffi/src/sharing.rs`'s own header). Used for
//    `proof_hash`/`invite_proof` and every FFI-returned JSON string this
//    plan touches.
//
//  Divergence is not cosmetic: the two alphabets diverge exactly at
//  `+`/`/` (standard) vs. `-`/`_` (URL-safe). `StandardBase64.decode` fed a
//  URL-safe string containing either of those two characters cannot
//  succeed -- `-`/`_` are not members of the standard base64 alphabet, so
//  `Data(base64Encoded:)` returns `nil` there, never a plausible-looking
//  wrong byte sequence. Never assume one decoder can stand in for the
//  other, even for an input that happens not to exercise the divergence.
//

import Foundation

enum PvBase64Error: Error, Equatable, CustomStringConvertible {
    case invalidBase64(String)

    var description: String {
        switch self {
        case let .invalidBase64(value):
            return "not valid base64: \(value)"
        }
    }
}

/// URL-safe, no-padding base64 (RFC 4648 §5) -- for the invite URL
/// fragment ONLY. Never used for a JSON body field.
enum UrlSafeNoPadBase64 {
    // RED stub (plan 40-06, Task 1 TDD) -- deliberately unimplemented so
    // InviteTests.swift's own assertions fail before the real
    // implementation lands. Restored to the real body in the immediately
    // following GREEN commit.
    static func encode(_ bytes: Data) -> String { "" }

    static func decode(_ string: String) throws -> Data {
        throw PvBase64Error.invalidBase64(string)
    }
}

/// Standard base64 (RFC 4648 §4, WITH padding) -- for JSON body proof
/// values and every FFI-returned JSON string's binary fields ONLY. Never
/// used for the URL fragment.
enum StandardBase64 {
    // RED stub -- see `UrlSafeNoPadBase64`'s identical note above.
    static func encode(_ bytes: Data) -> String { "" }

    static func decode(_ string: String) throws -> Data {
        throw PvBase64Error.invalidBase64(string)
    }
}
