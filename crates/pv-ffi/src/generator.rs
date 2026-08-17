//! Password/passphrase generator FFI exports -- UI-06 and DR-38-A
//! (`ios/IOS-SPIKE-LOG.md` §1a). Free functions, deliberately taking NO
//! User Key handle -- DR-38-A's rationale: `extension/entrypoints/
//! background/generate-handler.ts`'s own header states the handler must
//! never hold an unlocked User Key, and the generator must remain
//! reachable with the vault locked (the lock screen) and inside a future
//! extension process that has no key at all. A function taking a key
//! handle cannot satisfy either constraint. (T-38-04-03: this module's own
//! grep-checked invariant is zero references to that handle type BY NAME
//! anywhere in this file.)
//!
//! Every export returns `Result<_, FfiError>` (WR-01, `lib.rs`'s own
//! module-header rule) -- including `generator_bounds`, which cannot fail
//! today, for the same reason `lib.rs`'s function-audit table gives for
//! every OTHER fallible-shaped export: a bare (non-`Result`) return
//! generates a non-throwing Swift wrapper that force-unwraps with `try!`,
//! turning a panic `catch_unwind` genuinely caught into an uncatchable
//! `fatalError`.
//!
//! `pv-core` is never modified to accommodate UniFFI (P2) -- this file
//! absorbs the impedance mismatch, mirroring `wire.rs`'s own shape.
//!
//! Binary-size question this module settles (DR-38-A): see this plan's
//! SUMMARY for the measured before/after `pv-wasm` release `.wasm` sizes.
//! The delta was +545 bytes (well under the 50 KB threshold that record
//! commits to), so `pv-core::generator` stays UNCONDITIONAL -- no cargo
//! feature gate. `cargo test --workspace` therefore already covers
//! `generator::` with no separate command required.

use pv_core::generator::{
    self as core_generator, CharacterPasswordOptions as CoreCharacterPasswordOptions,
};

use crate::FfiError;

/// Mirrors `pv_core::generator::CharacterPasswordOptions`, field for field.
#[derive(uniffi::Record)]
pub struct FfiCharacterPasswordOptions {
    pub lowercase: bool,
    pub uppercase: bool,
    pub digits: bool,
    pub symbols: bool,
}

impl From<FfiCharacterPasswordOptions> for CoreCharacterPasswordOptions {
    fn from(o: FfiCharacterPasswordOptions) -> Self {
        CoreCharacterPasswordOptions {
            lowercase: o.lowercase,
            uppercase: o.uppercase,
            digits: o.digits,
            symbols: o.symbols,
        }
    }
}

/// The six bound numbers and the default separator `pv_core::generator`
/// enforces, exposed so a SwiftUI slider's range comes from HERE rather
/// than becoming a second, independently-maintained source of truth
/// (DR-38-A).
#[derive(uniffi::Record)]
pub struct FfiGeneratorBounds {
    pub char_min_length: u32,
    pub char_max_length: u32,
    pub char_default_length: u32,
    pub passphrase_min_words: u32,
    pub passphrase_max_words: u32,
    pub passphrase_default_words: u32,
    pub default_separator: String,
}

/// Generates a `length`-character password over the union of the selected
/// classes. See `pv_core::generator::generate_character_password` for the
/// full contract (rejection sampling, bounds enforcement, empty-class
/// rejection).
#[uniffi::export]
pub fn generate_character_password(
    length: u32,
    options: FfiCharacterPasswordOptions,
) -> Result<String, FfiError> {
    let opts: CoreCharacterPasswordOptions = options.into();
    core_generator::generate_character_password(length as usize, &opts).map_err(FfiError::from)
}

/// Generates a `word_count`-word Diceware-style passphrase joined by
/// `separator`. See `pv_core::generator::generate_passphrase` for the full
/// contract.
#[uniffi::export]
pub fn generate_passphrase(word_count: u32, separator: String) -> Result<String, FfiError> {
    core_generator::generate_passphrase(word_count as usize, &separator).map_err(FfiError::from)
}

/// The generator's own bounds and default separator, as a typed record --
/// never re-declared as a Swift-side literal.
#[uniffi::export]
pub fn generator_bounds() -> Result<FfiGeneratorBounds, FfiError> {
    Ok(FfiGeneratorBounds {
        char_min_length: core_generator::CHAR_MIN_LENGTH as u32,
        char_max_length: core_generator::CHAR_MAX_LENGTH as u32,
        char_default_length: core_generator::CHAR_DEFAULT_LENGTH as u32,
        passphrase_min_words: core_generator::PASSPHRASE_MIN_WORDS as u32,
        passphrase_max_words: core_generator::PASSPHRASE_MAX_WORDS as u32,
        passphrase_default_words: core_generator::PASSPHRASE_DEFAULT_WORDS as u32,
        default_separator: core_generator::DEFAULT_SEPARATOR.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_classes() -> FfiCharacterPasswordOptions {
        FfiCharacterPasswordOptions {
            lowercase: true,
            uppercase: true,
            digits: true,
            symbols: true,
        }
    }

    #[test]
    fn generate_character_password_round_trip() {
        let password = generate_character_password(20, all_classes())
            .expect("20 is within bounds and a class is selected");
        assert_eq!(password.chars().count(), 20);
    }

    /// 38-04 Task 3 acceptance criterion (round-trip test): a generated
    /// six-word passphrase contains exactly five separators. `|`, not `-`:
    /// four EFF wordlist entries ("drop-down", "felt-tip", "t-shirt",
    /// "yo-yo") contain a literal hyphen, which makes counting `-`
    /// occurrences in a hyphen-joined phrase flaky whenever one of those
    /// words is drawn (an observed flake, not a hypothetical one -- see
    /// `crates/pv-core/src/generator.rs`'s own bounds test comment and this
    /// plan's SUMMARY). `|` appears in no wordlist entry.
    #[test]
    fn generate_passphrase_six_words_has_five_separators() {
        let phrase = generate_passphrase(6, "|".to_string()).expect("6 words is within bounds");
        assert_eq!(phrase.matches('|').count(), 5);
    }

    /// 38-04 Task 3 acceptance criterion: a zero-class request returns an
    /// error, never a password.
    #[test]
    fn generate_character_password_rejects_zero_classes() {
        let no_classes = FfiCharacterPasswordOptions {
            lowercase: false,
            uppercase: false,
            digits: false,
            symbols: false,
        };
        let result = generate_character_password(20, no_classes);
        assert!(result.is_err(), "a zero-class request must return an error, not a password");
    }

    #[test]
    fn generator_bounds_reports_the_same_six_numbers_pv_core_enforces() {
        let bounds = generator_bounds().expect("generator_bounds is infallible today");
        assert_eq!(bounds.char_min_length, core_generator::CHAR_MIN_LENGTH as u32);
        assert_eq!(bounds.char_max_length, core_generator::CHAR_MAX_LENGTH as u32);
        assert_eq!(bounds.char_default_length, core_generator::CHAR_DEFAULT_LENGTH as u32);
        assert_eq!(bounds.passphrase_min_words, core_generator::PASSPHRASE_MIN_WORDS as u32);
        assert_eq!(bounds.passphrase_max_words, core_generator::PASSPHRASE_MAX_WORDS as u32);
        assert_eq!(
            bounds.passphrase_default_words,
            core_generator::PASSPHRASE_DEFAULT_WORDS as u32
        );
        assert_eq!(bounds.default_separator, core_generator::DEFAULT_SEPARATOR);
    }
}
