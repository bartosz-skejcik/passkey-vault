//
//  OtpauthParser.swift
//  PasskeyVault
//
//  Quick task 260818-lsk (the ＋ panel's 8th/9th slots + QR-scan TOTP entry).
//  Parses an `otpauth://totp/...` URI (RFC — informally, the format every
//  authenticator app already emits and reads: github.com/google/
//  google-authenticator/wiki/Key-Uri-Format) into the fields
//  `Vault/ItemFormView.swift`'s Code form already edits.
//
//  FOUNDATION-ONLY, DELIBERATELY. No `import UIKit`, no `import AVFoundation`
//  -- this file knows nothing about the camera or the app's `TotpFields`
//  model (that mapping lives in `ItemListView.swift`'s `totpFields(from:)`,
//  the one place that needs both). Keeping the parser itself dependency-free
//  is what makes `OtpauthParserTests.swift` a pure, fast, simulator-free unit
//  test -- no `XCUIApplication`, no camera permission, nothing to boot.
//
//  CRITICAL CONSTRAINT, and the reason this header calls it out before a
//  single line of code: this file NEVER computes a TOTP code. It parses a URI
//  into fields for a form to prefill, full stop. TOTP value generation is
//  `pv-ffi`-only in this codebase (`TotpCountdownView.swift` is the one real
//  call site) and `scripts/audit-generator-uses-ffi.sh` is the falsifiable
//  gate that exists to catch exactly this class of drift -- a second,
//  Swift-side TOTP implementation living quietly inside "just a parser". If
//  a future change to this file needs anything resembling HMAC or a time
//  step, that is the signal to stop and go through the FFI instead.
//

import Foundation

/// SHA1/SHA256/SHA512 -- the three algorithms `otpauth://` URIs (and
/// `Vault/ItemFormView.swift`'s own `Picker("Algorithm", ...)`) support.
/// `rawValue` matches `TotpFields.algorithm`'s wire strings exactly, so a
/// caller building a `TotpFields` from `ParsedOtpauth.algorithm.rawValue`
/// needs no translation table.
enum OtpauthAlgorithm: String {
    case sha1 = "SHA1"
    case sha256 = "SHA256"
    case sha512 = "SHA512"

    /// Case-insensitive: real-world `algorithm=` values seen in the wild
    /// include `sha1`, `SHA1` and `Sha1` depending on which generator wrote
    /// the QR code. Returns `nil` (never a silent default) for anything
    /// that is not one of the three -- the caller decides whether that is
    /// an error or a default, per `OtpauthParser.parse(_:)` below.
    init?(otpauthValue raw: String) {
        switch raw.uppercased() {
        case "SHA1": self = .sha1
        case "SHA256": self = .sha256
        case "SHA512": self = .sha512
        default: return nil
        }
    }
}

/// The fields `otpauth://totp/...` carries, resolved with RFC 6238's
/// defaults applied wherever the URI omits a param. Never carries a computed
/// TOTP code -- see this file's header.
struct ParsedOtpauth: Equatable {
    /// The path component after `totp/`, URL-decoded, VERBATIM -- e.g.
    /// `"Issuer:alice@example.com"` or bare `"alice@example.com"` when the
    /// source never prefixed a label at all. Callers that want to render or
    /// prefill a display name split the issuer prefix out themselves
    /// (`ItemListView.totpFields(from:)` does this, because `issuer` below
    /// may come from the `issuer=` PARAM and disagree with -- or simply not
    /// match the case of -- whatever prefix `label` happens to carry).
    let label: String
    /// Base32, required, validated as a PLAUSIBLE base32 string (alphabet +
    /// padding, non-empty) -- never decoded to bytes here. Decoding it is
    /// the FFI's job, not this parser's (see the header).
    let secret: String
    /// From the `issuer=` query param when present; `""` otherwise. This is
    /// the value that WINS over any issuer-looking prefix in `label` --
    /// `label` is never re-parsed to override it. Google's own Key URI
    /// Format doc gives the same instruction: "issuer parameter is
    /// recommended... procedure to prefer".
    let issuer: String
    /// Defaults to `.sha1` (RFC 6238's own default) when `algorithm=` is
    /// absent OR carries a value `OtpauthAlgorithm.init(otpauthValue:)`
    /// does not recognize -- an unrecognized algorithm is not treated as a
    /// hard parse failure, because every other field may still be usable
    /// and the user can correct it in the form before saving.
    let algorithm: OtpauthAlgorithm
    /// Defaults to `6` (RFC 6238) when `digits=` is absent or not a valid
    /// positive integer.
    let digits: Int
    /// Defaults to `30` (RFC 6238) when `period=` is absent or not a valid
    /// positive integer.
    let period: Int
}

/// Every way `OtpauthParser.parse(_:)` refuses a string, each with copy a
/// human can actually act on -- these strings are shown directly in
/// `TotpScanView`'s error state, not logged and translated later.
enum OtpauthParseError: Error, Equatable, CustomStringConvertible {
    /// Not a valid URL at all, or missing the pieces a `totp`/`hotp` URI
    /// must have (host, a non-empty path).
    case malformed
    /// `otpauth://hotp/...` -- a real, valid otpauth format this parser
    /// deliberately does not support, not a malformed one.
    case hotpUnsupported
    /// `secret=` absent, empty, or not a plausible base32 string.
    case invalidSecret

    var description: String {
        switch self {
        case .malformed:
            return "That doesn't look like a two-factor QR code."
        case .hotpUnsupported:
            return "This is a counter-based (HOTP) code, not a time-based one — HOTP isn't supported."
        case .invalidSecret:
            return "The code's secret is missing or isn't valid — try entering it manually instead."
        }
    }
}

/// Parses `otpauth://totp/...` URIs. See this file's header for the
/// FFI-boundary constraint this type exists under.
enum OtpauthParser {
    /// Base32 (RFC 4648 §6): `A`-`Z`, `2`-`7`, optionally padded with `=`.
    /// Anchored and case-SENSITIVE on purpose -- lowercase letters are not
    /// part of the base32 alphabet, and accepting them here would accept
    /// strings the FFI's own decoder may reject later, moving the failure
    /// from "clear error at scan time" to "opaque failure at save time".
    private static let base32Pattern = "^[A-Z2-7]+=*$"

    static func parse(_ raw: String) throws -> ParsedOtpauth {
        guard
            let url = URL(string: raw),
            let scheme = url.scheme?.lowercased(), scheme == "otpauth",
            let host = url.host?.lowercased()
        else {
            throw OtpauthParseError.malformed
        }

        guard host != "hotp" else {
            throw OtpauthParseError.hotpUnsupported
        }
        guard host == "totp" else {
            throw OtpauthParseError.malformed
        }

        // `url.path` is `"/Issuer:account"` (leading slash) or `""` for
        // `otpauth://totp` with nothing after it at all -- both `path` being
        // empty and `path` being just `"/"` mean "no label", and are both
        // malformed rather than a URI with an empty label.
        let rawPath = url.path
        guard rawPath.count > 1 else {
            throw OtpauthParseError.malformed
        }
        let encodedLabel = String(rawPath.dropFirst()) // drop the leading "/"
        guard let label = encodedLabel.removingPercentEncoding, !label.isEmpty else {
            throw OtpauthParseError.malformed
        }

        // `URLComponents`, not `url.query` hand-parsed -- it owns percent-
        // decoding of each param VALUE (a secret or label could in
        // principle carry a percent-encoded character; issuer names with
        // spaces do in practice, e.g. `issuer=Google%20Inc`).
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let queryItems = components?.queryItems ?? []
        func param(_ name: String) -> String? {
            queryItems.first(where: { $0.name == name })?.value
        }

        guard
            let secret = param("secret"), !secret.isEmpty,
            secret.range(of: base32Pattern, options: .regularExpression) != nil
        else {
            throw OtpauthParseError.invalidSecret
        }

        let issuer = param("issuer") ?? ""

        let algorithm: OtpauthAlgorithm
        if let rawAlgorithm = param("algorithm"), let parsed = OtpauthAlgorithm(otpauthValue: rawAlgorithm) {
            algorithm = parsed
        } else {
            algorithm = .sha1
        }

        let digits: Int
        if let rawDigits = param("digits"), let parsed = Int(rawDigits), parsed > 0 {
            digits = parsed
        } else {
            digits = 6
        }

        let period: Int
        if let rawPeriod = param("period"), let parsed = Int(rawPeriod), parsed > 0 {
            period = parsed
        } else {
            period = 30
        }

        return ParsedOtpauth(
            label: label,
            secret: secret,
            issuer: issuer,
            algorithm: algorithm,
            digits: digits,
            period: period
        )
    }
}
