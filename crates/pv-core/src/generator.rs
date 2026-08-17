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
//! RED-first placeholder (Task 1): the test module below references
//! constants and the generated word list that do not exist yet, so this
//! file does not compile until they are added.

mod wordlist;

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
