//! Generowanie kodów TOTP (RFC 6238) z sekretu itemu (base32).
//!
//! Kody TOTP są wyprowadzane z sekretu przechowywanego per-item; wywołujący
//! MUSI zawsze jawnie przekazać bieżący czas (`unix_time_seconds`) — ten
//! moduł nigdy sam nie odczytuje zegara systemowego. Powód: cel
//! `wasm32-unknown-unknown`, na którym ten crate też się kompiluje, nie ma
//! zegara systemowego (patrz 06-RESEARCH.md Pitfall 1 po pełne wyjaśnienie —
//! nie powtarzane tutaj celowo, żeby żaden grep na konkretną nazwę metody
//! nie trafił przypadkiem w ten właśnie komentarz).
//!
//! Skew (tolerancja dryfu zegara) jest ustawiony na 1 okres — standardowa
//! wartość dla TOTP.

use totp_rs::{Algorithm, Secret, TOTP};

use crate::CryptoError;

/// Mapuje nazwę algorytmu na `totp_rs::Algorithm`. Wszystko poza "SHA256"/
/// "SHA512" (w tym "SHA1" i dowolna nieznana wartość) domyślnie mapuje się
/// na SHA1 — fail-safe default zgodny z domyślną wartością RFC 6238 tej
/// aplikacji.
fn parse_algorithm(algorithm: &str) -> Algorithm {
    match algorithm {
        "SHA256" => Algorithm::SHA256,
        "SHA512" => Algorithm::SHA512,
        _ => Algorithm::SHA1,
    }
}

/// Generuje kod TOTP oraz liczbę sekund do jego wygaśnięcia.
///
/// `secret_b32` — sekret zakodowany w base32; `algorithm` — "SHA1"/"SHA256"/
/// "SHA512"; `digits` — długość kodu; `period` — długość okresu w sekundach
/// (musi być niezerowa); `unix_time_seconds` — bieżący czas, zawsze
/// dostarczany jawnie przez wywołującego.
pub fn generate_code(
    secret_b32: &str,
    algorithm: &str,
    digits: usize,
    period: u64,
    unix_time_seconds: u64,
) -> Result<(String, u64), CryptoError> {
    if period == 0 {
        return Err(CryptoError::InvalidInput("TOTP period must be non-zero"));
    }

    // `totp_rs::Secret::Encoded::to_bytes()` decodes as unpadded RFC 4648
    // base32 (`padding: false`) and rejects any `=` characters outright —
    // strip them here so a secret copy-pasted/imported WITH padding (a
    // common real-world shape, e.g. some exporters emit it) is not
    // needlessly rejected; whitespace is stripped for the same reason
    // (manual paste is prone to stray spaces/newlines).
    let cleaned: String = secret_b32
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect();
    let secret_bytes = Secret::Encoded(cleaned)
        .to_bytes()
        .map_err(|_| CryptoError::InvalidInput("invalid base32 TOTP secret"))?;

    // `issuer`/`account_name` are otpauth:// URI metadata fields, unused by
    // this module (we only ever call `generate`, never `get_url`) — passed
    // as empty/None per totp-rs 5.7.2's actual constructor signature (the
    // plan's drafted interface predates this verification).
    let totp = TOTP::new(
        parse_algorithm(algorithm),
        digits,
        1,
        period,
        secret_bytes,
        None,
        String::new(),
    )
    .map_err(|_| CryptoError::InvalidInput("invalid TOTP parameters"))?;

    let code = totp.generate(unix_time_seconds);
    let seconds_remaining = period - (unix_time_seconds % period);

    Ok((code, seconds_remaining))
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 Appendix B — sekret SHA1 to base32 zakodowanego 20-bajtowego
    // ASCII "12345678901234567890".
    const SHA1_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    // RFC 6238 Appendix B — sekret SHA256 to base32 zakodowanego 32-bajtowego
    // ASCII "12345678901234567890123456789012" (`=` padding included on
    // purpose — exercises `generate_code`'s padding-stripping tolerance).
    const SHA256_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";
    // RFC 6238 Appendix B — sekret SHA512 to base32 zakodowanego 64-bajtowego
    // ASCII "1234567890123456789012345678901234567890123456789012345678901234"
    // (padding included, see SHA256_SECRET's comment above).
    const SHA512_SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=";

    #[test]
    fn rfc6238_sha1_known_answer_vectors() {
        let cases: [(u64, &str); 6] = [
            (59, "94287082"),
            (1111111109, "07081804"),
            (1111111111, "14050471"),
            (1234567890, "89005924"),
            (2000000000, "69279037"),
            (20000000000, "65353130"),
        ];
        for (t, expected) in cases {
            let (code, _) = generate_code(SHA1_SECRET, "SHA1", 8, 30, t).unwrap();
            assert_eq!(code, expected, "SHA1 mismatch at t={t}");
        }
    }

    #[test]
    fn rfc6238_sha256_known_answer_vectors() {
        let cases: [(u64, &str); 3] = [
            (59, "46119246"),
            (1111111109, "68084774"),
            (20000000000, "77737706"),
        ];
        for (t, expected) in cases {
            let (code, _) = generate_code(SHA256_SECRET, "SHA256", 8, 30, t).unwrap();
            assert_eq!(code, expected, "SHA256 mismatch at t={t}");
        }
    }

    #[test]
    fn rfc6238_sha512_known_answer_vectors() {
        let cases: [(u64, &str); 3] = [
            (59, "90693936"),
            (1234567890, "93441116"),
            (20000000000, "47863826"),
        ];
        for (t, expected) in cases {
            let (code, _) = generate_code(SHA512_SECRET, "SHA512", 8, 30, t).unwrap();
            assert_eq!(code, expected, "SHA512 mismatch at t={t}");
        }
    }

    #[test]
    fn same_period_stability() {
        let (code_a, remaining_a) = generate_code(SHA1_SECRET, "SHA1", 6, 30, 100).unwrap();
        let (code_b, remaining_b) = generate_code(SHA1_SECRET, "SHA1", 6, 30, 105).unwrap();
        assert_eq!(code_a, code_b);
        assert!(remaining_b < remaining_a);
    }

    #[test]
    fn invalid_base32_secret_rejected() {
        let result = generate_code("not-valid-base32!!!", "SHA1", 6, 30, 100);
        assert!(matches!(result, Err(CryptoError::InvalidInput(_))));
    }

    #[test]
    fn zero_period_rejected() {
        let result = generate_code(SHA1_SECRET, "SHA1", 6, 0, 100);
        assert!(matches!(result, Err(CryptoError::InvalidInput(_))));
    }
}
