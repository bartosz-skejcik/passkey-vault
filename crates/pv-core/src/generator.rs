//! Password/passphrase generator -- port-for-port of
//! `packages/pv-ui/generator/password.ts` (TypeScript canonical), added to
//! `pv-core` per UI-06 and DR-38-A (`ios/IOS-SPIKE-LOG.md` §1a): the
//! generator must be shared across every client and must remain reachable
//! with the vault locked, so it belongs in the crypto core rather than only
//! in `pv-ffi` -- a generator living only in `pv-ffi` would be unavailable
//! to any future `pv-wasm` convergence. `web`/`extension` still run the
//! TypeScript original; DR-38-A records the two-implementations state and
//! this module's own parity tests (below) as the mitigation, not a
//! behavioural sample.
//!
//! Every random draw goes through `uniform_random_index`, rejection
//! sampling over the operating-system RNG already imported by
//! `crate::keys` (`OsRng`) -- never `raw % max`, which biases toward the
//! low end of the range whenever `max` does not evenly divide `2**32`. This
//! module's own `distribution_over_all_classes_does_not_reject_uniformity`
//! test (Task 2) is written against per-character counts specifically so
//! that bias is visible, plus a falsification control (temporarily
//! substituting a raw reduction and observing the test fail) recorded in
//! this plan's SUMMARY.
//!
//! The word list (`generator::wordlist::EFF_WORDLIST`) is GENERATED, never
//! hand-transcribed -- see that module's own header and
//! `scripts/gen-wordlist-rs.mjs`. `scripts/check-wordlist-parity.mjs` and
//! this module's `wordlist_digest_matches_typescript_source` test pin the
//! SAME SHA-256 literal from two independent directions, so a single
//! transposed word fails at least one side (a length check alone cannot
//! see a transposition).
//!
//! Length/word-count BOUNDS are enforced HERE, in Rust -- unlike the
//! TypeScript originals, whose own callers (`generate-handler.ts`'s header
//! comment) state plainly that bounds checking is delegated entirely to
//! them. On this port that invariant moves into the crypto core, because a
//! SwiftUI `Slider` range is one refactor away from being the only place it
//! lives.

mod wordlist;

use chacha20poly1305::aead::{rand_core::RngCore, OsRng};

use crate::CryptoError;

// --- Character classes -- byte-for-byte the same as `CHARSET` in
// packages/pv-ui/generator/password.ts. Never edited independently of that
// file; this module's own tests pin them.
pub const CHARSET_LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
pub const CHARSET_UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
pub const CHARSET_DIGITS: &str = "0123456789";
pub const CHARSET_SYMBOLS: &str = "!@#$%^&*()-_=+[]{};:,.<>?";

// --- Bounds -- the same six numbers `GeneratorDialog.tsx`
// (CHAR_MIN_LENGTH/CHAR_MAX_LENGTH/CHAR_DEFAULT_LENGTH/
// PASSPHRASE_MIN_WORDS/PASSPHRASE_MAX_WORDS/PASSPHRASE_DEFAULT_WORDS) and
// `generate-handler.ts` already use, so a slider range cannot become a
// second source of truth for what the generator itself accepts.
pub const CHAR_MIN_LENGTH: usize = 8;
pub const CHAR_MAX_LENGTH: usize = 64;
pub const CHAR_DEFAULT_LENGTH: usize = 20;
pub const PASSPHRASE_MIN_WORDS: usize = 3;
pub const PASSPHRASE_MAX_WORDS: usize = 10;
pub const PASSPHRASE_DEFAULT_WORDS: usize = 6;

/// Default passphrase separator -- matches `generatePassphrase`'s own
/// `separator = "-"` default parameter.
pub const DEFAULT_SEPARATOR: &str = "-";

/// Which character classes are included in the union a character password
/// is drawn from. Mirrors `CharacterPasswordOptions` in password.ts,
/// field for field. Deliberately NO "guarantee one character per selected
/// class" option -- the canonical generator draws uniformly over the union,
/// and an inclusion rule would change that distribution (this plan's own
/// prohibition).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CharacterPasswordOptions {
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
}

/// Uniformly-distributed index in `[0, max)`, via rejection sampling over
/// the operating-system RNG (`OsRng`, the same CSPRNG `crate::keys` already
/// imports -- no new dependency). Mirrors `uniformRandomIndex` in
/// password.ts: any 32-bit draw landing in the biased remainder region
/// (where `2**32 % max != 0`) is discarded and re-rolled, so every accepted
/// value has exactly equal probability. `max` and the rejection threshold
/// are computed in `u64` -- `2**32` itself does not fit in `u32`.
fn uniform_random_index(max: u32) -> u32 {
    debug_assert!(max > 0, "uniform_random_index: max must be positive");
    const RANGE: u64 = 1u64 << 32;
    let threshold = RANGE - (RANGE % max as u64);
    loop {
        let mut buf = [0u8; 4];
        OsRng.fill_bytes(&mut buf);
        let value = u32::from_le_bytes(buf) as u64;
        if value < threshold {
            return (value % max as u64) as u32;
        }
    }
}

fn build_alphabet(opts: &CharacterPasswordOptions) -> String {
    let mut alphabet = String::new();
    if opts.lowercase {
        alphabet.push_str(CHARSET_LOWERCASE);
    }
    if opts.uppercase {
        alphabet.push_str(CHARSET_UPPERCASE);
    }
    if opts.digits {
        alphabet.push_str(CHARSET_DIGITS);
    }
    if opts.symbols {
        alphabet.push_str(CHARSET_SYMBOLS);
    }
    alphabet
}

/// Generates a `length`-character password drawn uniformly over the union
/// of the requested classes, via CSPRNG rejection sampling. Port of
/// `generateCharacterPassword` (password.ts): the empty-alphabet check
/// below is the TypeScript original's own behavior; the length bounds
/// check is this port's Rust-only addition (see module header).
pub fn generate_character_password(
    length: usize,
    opts: &CharacterPasswordOptions,
) -> Result<String, CryptoError> {
    if !(CHAR_MIN_LENGTH..=CHAR_MAX_LENGTH).contains(&length) {
        return Err(CryptoError::InvalidInput(
            "generate_character_password: length out of range",
        ));
    }
    let alphabet = build_alphabet(opts);
    if alphabet.is_empty() {
        return Err(CryptoError::InvalidInput(
            "generate_character_password: at least one character class must be selected",
        ));
    }
    let chars: Vec<char> = alphabet.chars().collect();
    let n = chars.len() as u32;
    let mut result = String::with_capacity(length);
    for _ in 0..length {
        let idx = uniform_random_index(n);
        result.push(chars[idx as usize]);
    }
    Ok(result)
}

/// Generates a `word_count`-word Diceware-style passphrase, every word
/// drawn uniformly and independently (repeats allowed) from
/// `wordlist::EFF_WORDLIST`, joined by `separator`. Port of
/// `generatePassphrase` (password.ts); the word-count bounds check is this
/// port's Rust-only addition (see module header).
pub fn generate_passphrase(word_count: usize, separator: &str) -> Result<String, CryptoError> {
    if !(PASSPHRASE_MIN_WORDS..=PASSPHRASE_MAX_WORDS).contains(&word_count) {
        return Err(CryptoError::InvalidInput(
            "generate_passphrase: word count out of range",
        ));
    }
    let n = wordlist::EFF_WORDLIST.len() as u32;
    let mut words: Vec<&str> = Vec::with_capacity(word_count);
    for _ in 0..word_count {
        let idx = uniform_random_index(n);
        words.push(wordlist::EFF_WORDLIST[idx as usize]);
    }
    Ok(words.join(separator))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_WORDLIST_SHA256: &str =
        "abae49761b88f3f1ba31ef944bea1f61b795a3cd7e1cfb7d276ed45bf77967ba";

    #[test]
    fn wordlist_has_7776_entries() {
        assert_eq!(wordlist::EFF_WORDLIST.len(), 7776);
    }

    #[test]
    fn wordlist_first_and_last_entries() {
        assert_eq!(wordlist::EFF_WORDLIST[0], "abacus");
        assert_eq!(wordlist::EFF_WORDLIST[7775], "zoom");
    }

    #[test]
    fn wordlist_digest_matches_typescript_source() {
        use sha2::{Digest, Sha256};
        let joined = wordlist::EFF_WORDLIST.join("\n");
        let digest = Sha256::digest(joined.as_bytes());
        let hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex, EXPECTED_WORDLIST_SHA256,
            "wordlist digest moved -- re-run `node scripts/gen-wordlist-rs.mjs` and re-pin this \
             literal, or a word was transposed"
        );
    }

    #[test]
    fn symbol_class_has_25_characters() {
        assert_eq!(CHARSET_SYMBOLS.chars().count(), 25);
    }

    #[test]
    fn symbol_class_matches_typescript_literal() {
        assert_eq!(CHARSET_SYMBOLS, "!@#$%^&*()-_=+[]{};:,.<>?");
    }

    #[test]
    fn union_of_all_classes_is_87_characters() {
        let union = format!(
            "{}{}{}{}",
            CHARSET_LOWERCASE, CHARSET_UPPERCASE, CHARSET_DIGITS, CHARSET_SYMBOLS
        );
        assert_eq!(union.chars().count(), 87);
    }
}
