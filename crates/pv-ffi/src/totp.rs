//! TOTP (RFC 6238) FFI export -- UI-05, this plan's own Task 1.
//!
//! A thin wrapper around `pv_core::totp::generate_code`, mirroring
//! `crates/pv-wasm/src/lib.rs:613`'s `totpNow` export byte-for-byte in
//! behaviour. `pv_core::totp` NEVER reads the system clock (that module's
//! own header: the crate also targets `wasm32-unknown-unknown`, which has
//! none) -- the caller supplies `unix_time_seconds` every call, and this
//! file changes nothing about that contract.
//!
//! WHY THE SECRET CROSSES AS A PLAIN `String`, NOT AN OPAQUE HANDLE
//! (`lib.rs`'s own module-header rule on raw key bytes at the boundary
//! does not apply here, and this paragraph is why): the TOTP secret is not
//! top-tier key material -- it is per-item plaintext the caller already
//! holds in the clear, exactly like the `plaintext: String` argument
//! `wire.rs`'s `encrypt_item_wire` already takes. `pv-wasm`'s own doc
//! comment on `totp_now` states the identical rationale for JS; it
//! transfers here verbatim. Wrapping it in a handle would buy nothing --
//! by the time this function is reachable, the item has already been
//! decrypted and its fields (including this one) are plain Swift `String`s
//! the caller is free to read, copy, and render on screen.
//!
//! THE `usize` <-> `u32` MISMATCH: `pv_core::totp::generate_code`'s
//! `digits` parameter is `usize` (pointer-sized), and UniFFI has no
//! `usize` binding (same impedance mismatch `generator.rs`'s `length: u32`
//! already absorbs for `generate_character_password`). Taken as `u32` here
//! and cast at the call site -- `pv-core` is never modified to accommodate
//! UniFFI (P2).
//!
//! NO VALIDATION ADDED BEYOND WHAT `pv-core` ALREADY DOES. `TOTP::new`
//! (`totp-rs` 5.7.2, called from `generate_code`) already rejects a digit
//! count outside `6..=8` and a decoded secret shorter than 16 bytes, and
//! `generate_code` itself already strips whitespace/`=` padding and maps
//! any unrecognized algorithm name (including `"SHA1"` itself) to SHA1 as
//! a deliberate fail-safe default. This file adds none of that a second
//! time -- see this plan's `must_haves.prohibitions`.
//!
//! `Result` on the export (WR-01, `lib.rs`'s own module-header rule): a
//! bare (non-`Result`) return generates a non-throwing Swift wrapper that
//! force-unwraps with `try!`, turning a panic `catch_unwind` genuinely
//! caught into an uncatchable `fatalError`. `generate_code` is fallible
//! (bad base32, bad TOTP parameters), so this is not a borderline case.

use pv_core::totp::generate_code;

use crate::FfiError;

/// The live code and its remaining lifetime, mirroring `pv-wasm`'s
/// `{code, secondsRemaining}` JSON shape as a typed UniFFI record instead
/// of a JSON string -- there is no persistence path here, so there is no
/// DR-38-C-style reason to route this through `serde_json`.
#[derive(uniffi::Record, Debug, PartialEq, Eq)]
pub struct FfiTotpCode {
    pub code: String,
    pub seconds_remaining: u64,
}

/// Generates the current TOTP code for `secret_b32` at `unix_time_seconds`.
/// See this module's own header for the full contract and the boundary
/// decisions (secret-as-plain-string, the `usize`/`u32` cast, no added
/// validation). `pv_core::totp::generate_code`'s own contract governs
/// everything else: whitespace/padding stripping, the unrecognized-
/// algorithm fallback, the `6..=8` digit range, and the 16-byte secret
/// floor.
#[uniffi::export]
pub fn totp_now(
    secret_b32: String,
    algorithm: String,
    digits: u32,
    period: u64,
    unix_time_seconds: u64,
) -> Result<FfiTotpCode, FfiError> {
    let (code, seconds_remaining) = generate_code(
        &secret_b32,
        &algorithm,
        digits as usize,
        period,
        unix_time_seconds,
    )
    .map_err(FfiError::from)?;
    Ok(FfiTotpCode { code, seconds_remaining })
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 Appendix B -- identical literal fixtures to
    // `crates/pv-core/src/totp.rs`'s own test module (transcribed here
    // independently, not imported, so a typo in one file cannot silently
    // pass because the other file made the same typo). 8 digits, because
    // the published vectors themselves are 8-digit codes.
    const SHA1_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const SHA256_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";
    const SHA512_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=";

    /// The 16-character secret `extension/entrypoints/background/
    /// autofill-match.test.ts:295` uses under a mocked `totpNow` -- a
    /// 10-byte decode, below `totp-rs`'s 16-byte floor. MUST NOT be used
    /// as evidence of a passing TOTP code anywhere in this plan
    /// (must_haves.prohibitions) -- used ONLY in the below-minimum-length
    /// rejection test, where the expected outcome is an error.
    const TOO_SHORT_SECRET: &str = "JBSWY3DPEHPK3PXP";

    #[test]
    fn totp_now_matches_rfc6238_sha1_vectors() {
        let cases: [(u64, &str); 6] = [
            (59, "94287082"),
            (1111111109, "07081804"),
            (1111111111, "14050471"),
            (1234567890, "89005924"),
            (2000000000, "69279037"),
            (20000000000, "65353130"),
        ];
        for (t, expected) in cases {
            let result =
                totp_now(SHA1_SECRET.to_string(), "SHA1".to_string(), 8, 30, t).unwrap();
            assert_eq!(result.code, expected, "SHA1 mismatch at t={t}");
        }
    }

    #[test]
    fn totp_now_matches_rfc6238_sha256_vectors() {
        let cases: [(u64, &str); 3] =
            [(59, "46119246"), (1111111109, "68084774"), (20000000000, "77737706")];
        for (t, expected) in cases {
            let result =
                totp_now(SHA256_SECRET.to_string(), "SHA256".to_string(), 8, 30, t).unwrap();
            assert_eq!(result.code, expected, "SHA256 mismatch at t={t}");
        }
    }

    #[test]
    fn totp_now_matches_rfc6238_sha512_vectors() {
        let cases: [(u64, &str); 3] =
            [(59, "90693936"), (1234567890, "93441116"), (20000000000, "47863826")];
        for (t, expected) in cases {
            let result =
                totp_now(SHA512_SECRET.to_string(), "SHA512".to_string(), 8, 30, t).unwrap();
            assert_eq!(result.code, expected, "SHA512 mismatch at t={t}");
        }
    }

    /// The first published time (`t=59`) with a 30-second period: `59 % 30
    /// == 29`, so `30 - 29 == 1` remaining second -- NOT zero. This is the
    /// exact arithmetic the countdown view (Task 2) must reproduce every
    /// tick rather than decrementing locally.
    #[test]
    fn remaining_seconds_for_first_sha1_vector_is_one() {
        let result = totp_now(SHA1_SECRET.to_string(), "SHA1".to_string(), 8, 30, 59).unwrap();
        assert_eq!(result.seconds_remaining, 1);
    }

    /// An unrecognized algorithm name must produce the SAME code as the
    /// default (SHA1) algorithm -- `pv_core::totp::parse_algorithm`'s
    /// deliberate fail-safe. If this boundary returned an error instead,
    /// it would mean `pv-ffi` added validation the crypto layer
    /// deliberately does not have (must_haves.prohibitions).
    #[test]
    fn unrecognized_algorithm_falls_back_to_sha1_default() {
        let default_result =
            totp_now(SHA1_SECRET.to_string(), "SHA1".to_string(), 6, 30, 100).unwrap();
        let unknown_result =
            totp_now(SHA1_SECRET.to_string(), "SHA999-not-a-real-algorithm".to_string(), 6, 30, 100)
                .unwrap();
        assert_eq!(unknown_result, default_result);
    }

    /// A secret whose decoded length is below `totp-rs`'s 16-byte floor
    /// returns an error, never a code -- Pitfall 4's exact trap, and the
    /// secret this test deliberately does NOT offer as passing evidence
    /// for SC3 (must_haves.prohibitions).
    #[test]
    fn secret_below_minimum_length_returns_error() {
        let result = totp_now(TOO_SHORT_SECRET.to_string(), "SHA1".to_string(), 6, 30, 100);
        assert!(result.is_err(), "a 10-byte secret must be rejected, not silently accepted");
    }

    /// `assert_digits` (`totp-rs-5.7.2/src/rfc.rs:41`) restricts `digits`
    /// to `6..=8` inclusive -- an imported item with `digits=4` errors out
    /// rather than returning a code.
    #[test]
    fn digit_count_outside_accepted_range_returns_error() {
        let result = totp_now(SHA1_SECRET.to_string(), "SHA1".to_string(), 4, 30, 100);
        assert!(result.is_err(), "digits=4 is outside RFC 6238's 6..=8 range and must be rejected");
    }
}
