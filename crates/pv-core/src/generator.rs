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

// --- Apple Password Rules DSL (SAVE-02, DR-44-B) ---------------------------
//
// `parse_password_rules`/`generate_character_password_from_rules` are
// ADDITIVE: `generate_character_password` above is UNCHANGED, its own "no
// guaranteed inclusion" design stays exactly as documented (DR-44-B,
// `ios/IOS-SPIKE-LOG.md` §1o). This DSL is the string
// `ASGeneratePasswordsRequest`/`request.passwordFieldPasswordRules` carries:
// `key: value; key: value; ...`, semicolon-separated, `required`/`allowed`
// values themselves comma-separated. Unknown keys/tokens are ignored
// (Apple's own forward-compatibility convention); two shapes this project's
// ASCII-only `CHARSET_*` constants genuinely cannot honour -- a custom
// bracket character class and `unicode` -- are REFUSED with a named error
// rather than silently approximated.
//
// TWO STABLE ERROR-MESSAGE PREFIXES (44-PLAN-CHECK.md W2, a contract with
// Plan 44-05's own Swift caller -- do not rename either without updating
// that plan's own string-matching dispatch):
//   "unsupported rule shape: " -- the DSL text could not even be read (a
//     shape pv-core cannot express). Safe for a caller to fall back to a
//     generic ascii-printable default.
//   "unsatisfiable rule: "     -- the DSL parsed fine, but its OWN stated
//     bounds cannot be satisfied (e.g. more required classes than the
//     stated maxlength allows). NOT safe to fall back generically -- the
//     RP's own stated bounds would be violated.

/// Total input length cap for `parse_password_rules`, checked BEFORE any
/// parsing loop runs (T-44-03: DoS from a pathological RP-supplied string).
const RULES_TEXT_MAX_LEN: usize = 4096;

/// Bounded per-character retry budget for the `max_consecutive` constraint
/// (T-44-04) -- never an unbounded loop.
const MAX_CONSECUTIVE_RETRY_ATTEMPTS: usize = 200;

/// A single named character class from Apple's Password Rules DSL.
/// `AsciiPrintable` is the DSL's own documented default expansion (lower +
/// upper + digit + special); `Unicode` is refused wherever it is named --
/// this project's `CHARSET_*` constants are ASCII-only by construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordRuleClass {
    Lower,
    Upper,
    Digit,
    Special,
    AsciiPrintable,
    Unicode,
}

/// The parsed form of an RP-supplied Password Rules string. `Default` (all
/// `None`/empty) is exactly Apple's own documented "no rules specified"
/// state -- `allowed: ascii-printable`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PasswordRules {
    pub min_length: Option<usize>,
    pub max_length: Option<usize>,
    pub required: Vec<PasswordRuleClass>,
    pub allowed: Vec<PasswordRuleClass>,
    pub max_consecutive: Option<usize>,
}

fn charset_for_class(class: PasswordRuleClass) -> &'static str {
    match class {
        PasswordRuleClass::Lower => CHARSET_LOWERCASE,
        PasswordRuleClass::Upper => CHARSET_UPPERCASE,
        PasswordRuleClass::Digit => CHARSET_DIGITS,
        PasswordRuleClass::Special => CHARSET_SYMBOLS,
        // Expanded (AsciiPrintable) or refused (Unicode) before this is
        // ever reached -- both arms exist only to keep this match
        // exhaustive.
        PasswordRuleClass::AsciiPrintable | PasswordRuleClass::Unicode => "",
    }
}

/// Parses Apple's Password Rules DSL. See the module note above for the two
/// refusal shapes and their stable error-message prefixes.
pub fn parse_password_rules(rules_text: &str) -> Result<PasswordRules, CryptoError> {
    if rules_text.len() > RULES_TEXT_MAX_LEN {
        return Err(CryptoError::InvalidInput(
            "unsupported rule shape: rules text exceeds the maximum accepted length",
        ));
    }

    let trimmed = rules_text.trim();
    if trimmed.is_empty() {
        return Ok(PasswordRules::default());
    }

    let mut rules = PasswordRules::default();
    for clause in trimmed.split(';') {
        let clause = clause.trim();
        if clause.is_empty() {
            continue;
        }
        let mut parts = clause.splitn(2, ':');
        let key = parts.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = parts.next().unwrap_or("").trim();

        match key.as_str() {
            "minlength" => {
                if let Ok(n) = value.parse::<usize>() {
                    rules.min_length = Some(n);
                }
            }
            "maxlength" => {
                if let Ok(n) = value.parse::<usize>() {
                    rules.max_length = Some(n);
                }
            }
            "max-consecutive" => {
                if let Ok(n) = value.parse::<usize>() {
                    rules.max_consecutive = Some(n);
                }
            }
            "required" | "allowed" => {
                for token in value.split(',') {
                    let token = token.trim();
                    if token.is_empty() {
                        continue;
                    }
                    if token.starts_with('[') {
                        return Err(CryptoError::InvalidInput(
                            "unsupported rule shape: custom character class",
                        ));
                    }
                    let class = match token.to_ascii_lowercase().as_str() {
                        "lower" => PasswordRuleClass::Lower,
                        "upper" => PasswordRuleClass::Upper,
                        "digit" => PasswordRuleClass::Digit,
                        "special" => PasswordRuleClass::Special,
                        "ascii-printable" => PasswordRuleClass::AsciiPrintable,
                        "unicode" => {
                            return Err(CryptoError::InvalidInput(
                                "unsupported rule shape: unicode class",
                            ));
                        }
                        // Unrecognized token -- ignored (Apple's own
                        // forward-compatibility convention: unknown is
                        // never an error).
                        _ => continue,
                    };
                    let target =
                        if key == "required" { &mut rules.required } else { &mut rules.allowed };
                    if !target.contains(&class) {
                        target.push(class);
                    }
                }
            }
            // Unrecognized key -- ignored, never an error.
            _ => {}
        }
    }

    Ok(rules)
}

/// Expands `AsciiPrintable` into its four constituent classes and dedupes.
/// `Unicode` must already have been refused by the caller before this runs.
fn expand_classes(classes: &[PasswordRuleClass]) -> Vec<PasswordRuleClass> {
    let mut expanded = Vec::new();
    for &class in classes {
        if class == PasswordRuleClass::AsciiPrintable {
            for c in [
                PasswordRuleClass::Lower,
                PasswordRuleClass::Upper,
                PasswordRuleClass::Digit,
                PasswordRuleClass::Special,
            ] {
                if !expanded.contains(&c) {
                    expanded.push(c);
                }
            }
        } else if !expanded.contains(&class) {
            expanded.push(class);
        }
    }
    expanded
}

/// If the trailing run at the end of `chars` has already reached
/// `max_run`, returns the run's character (the ONE value the next
/// character must not be, or the run would exceed `max_run`). `None` means
/// no restriction applies yet.
fn trailing_run_char_at_limit(chars: &[char], max_run: usize) -> Option<char> {
    let last = *chars.last()?;
    let run = chars.iter().rev().take_while(|&&c| c == last).count();
    if run >= max_run {
        Some(last)
    } else {
        None
    }
}

/// Draws one CSPRNG-uniform character from `charset`, respecting
/// `max_run` against the characters already placed in `chars` -- retrying
/// (bounded, T-44-04) whenever the draw would extend a run past the limit.
/// `max_run = None` is a single unrestricted uniform draw.
fn draw_char_respecting_max_run(
    chars: &[char],
    charset: &[char],
    max_run: Option<usize>,
) -> Result<char, CryptoError> {
    if charset.is_empty() {
        // Defensive: no caller should ever reach this with an empty
        // charset (CR-01, 44-REVIEW.md -- the un-expanded `AsciiPrintable`
        // class used to reach here directly via `charset_for_class`,
        // producing `uniform_random_index(0)` -> `RANGE % 0`, a panic on
        // fully RP-controlled input). Refuse rather than divide by zero,
        // even if some future caller reintroduces an un-expanded class.
        return Err(CryptoError::InvalidInput(
            "unsatisfiable rule: required class has an empty character set",
        ));
    }
    let n = charset.len() as u32;
    let Some(max_run) = max_run else {
        let idx = uniform_random_index(n);
        return Ok(charset[idx as usize]);
    };

    let forbidden = trailing_run_char_at_limit(chars, max_run);
    for _ in 0..MAX_CONSECUTIVE_RETRY_ATTEMPTS {
        let idx = uniform_random_index(n);
        let candidate = charset[idx as usize];
        if forbidden != Some(candidate) {
            return Ok(candidate);
        }
    }
    Err(CryptoError::InvalidInput(
        "unsatisfiable rule: max-consecutive not achievable within retry budget",
    ))
}

/// One position in the password being constructed: either a guaranteed
/// slot for a specific required class, or a general slot drawn from the
/// full effective alphabet.
#[derive(Clone, Copy)]
enum Slot {
    Required(PasswordRuleClass),
    General,
}

/// Generates a password honouring `rules`: guarantees one character per
/// `required` class (drawn from that class's OWN charset), fills the
/// remainder uniformly over the effective alphabet, places every character
/// at a CSPRNG-shuffled POSITION (required characters are never
/// front-loaded), and -- if `max_consecutive` is set -- enforces the run
/// limit during construction with a bounded per-character retry rather
/// than an unbounded loop. Reuses `uniform_random_index`, the SAME CSPRNG
/// primitive `generate_character_password` already uses -- no second RNG
/// mechanism.
pub fn generate_character_password_from_rules(
    rules: &PasswordRules,
) -> Result<String, CryptoError> {
    // Effective allowed-class union: prefer `allowed`, else `required`,
    // else the DSL's own documented default (all four ASCII classes).
    let effective_classes: &[PasswordRuleClass] = if !rules.allowed.is_empty() {
        &rules.allowed
    } else if !rules.required.is_empty() {
        &rules.required
    } else {
        &[
            PasswordRuleClass::Lower,
            PasswordRuleClass::Upper,
            PasswordRuleClass::Digit,
            PasswordRuleClass::Special,
        ]
    };

    if effective_classes.contains(&PasswordRuleClass::Unicode)
        || rules.required.contains(&PasswordRuleClass::Unicode)
    {
        return Err(CryptoError::InvalidInput(
            "unsupported rule shape: unicode class",
        ));
    }

    let expanded_classes = expand_classes(effective_classes);
    let alphabet: Vec<char> =
        expanded_classes.iter().flat_map(|&c| charset_for_class(c).chars()).collect();
    if alphabet.is_empty() {
        return Err(CryptoError::InvalidInput(
            "unsatisfiable rule: no character classes available",
        ));
    }

    // `rules.required` may itself contain `AsciiPrintable` (an umbrella
    // class whose OWN `charset_for_class` is deliberately empty -- it is
    // meant to be expanded, never drawn from directly). Expand it here,
    // the same way `effective_classes` was expanded into `alphabet` above,
    // BEFORE it is used for any bound check or for building `slots` below,
    // so no un-expanded umbrella class ever reaches `charset_for_class`
    // (CR-01, 44-REVIEW.md).
    let required_expanded = expand_classes(&rules.required);
    let required_len = required_expanded.len();
    let min_bound = CHAR_MIN_LENGTH.max(required_len);
    let effective_max = rules.max_length.unwrap_or(CHAR_MAX_LENGTH).min(CHAR_MAX_LENGTH);

    if required_len > effective_max {
        return Err(CryptoError::InvalidInput(
            "unsatisfiable rule: required classes exceed available length",
        ));
    }

    let requested_min = rules.min_length.unwrap_or(min_bound).max(min_bound);
    if requested_min > effective_max {
        return Err(CryptoError::InvalidInput(
            "unsatisfiable rule: minlength exceeds maxlength",
        ));
    }

    // CR-03 (44-REVIEW.md): `minlength` is a FLOOR, not a target -- the
    // generator must draw as long a password as the rules permit, capped
    // by the app's own default policy, not collapse to the shortest legal
    // length whenever a site states a minimum. Preferring
    // `CHAR_DEFAULT_LENGTH` (20) over the stated `min_length` (when it is
    // smaller) and only THEN clamping down to `effective_max` is what
    // makes `minlength: 10; maxlength: 20;` produce 20, not 10.
    let preferred_length =
        CHAR_DEFAULT_LENGTH.max(min_bound).max(rules.min_length.unwrap_or(0));
    let length = preferred_length.min(effective_max);

    // Slot assignment: one Required(class) slot per required class, the
    // rest General -- then CSPRNG-shuffle the ASSIGNMENT (Fisher-Yates,
    // uniform_random_index-driven swaps -- never `.shuffle()`/any
    // non-CSPRNG source), so required characters are not always
    // front-loaded. The actual CHARACTERS are drawn afterwards, in final
    // left-to-right order, so max_consecutive can be enforced against
    // characters that are already genuinely placed.
    let mut slots: Vec<Slot> = Vec::with_capacity(length);
    for &class in &required_expanded {
        slots.push(Slot::Required(class));
    }
    while slots.len() < length {
        slots.push(Slot::General);
    }
    for i in (1..slots.len()).rev() {
        let j = uniform_random_index((i + 1) as u32) as usize;
        slots.swap(i, j);
    }

    let mut chars: Vec<char> = Vec::with_capacity(length);
    for slot in slots {
        let slot_charset: Vec<char> = match slot {
            Slot::Required(class) => charset_for_class(class).chars().collect(),
            Slot::General => alphabet.clone(),
        };
        let ch = draw_char_respecting_max_run(&chars, &slot_charset, rules.max_consecutive)?;
        chars.push(ch);
    }

    Ok(chars.into_iter().collect())
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

    // --- Task 2: rejection-sampling bias, bounds, boundary success ---

    const ALL_CLASSES: CharacterPasswordOptions = CharacterPasswordOptions {
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
    };

    const NO_CLASSES: CharacterPasswordOptions = CharacterPasswordOptions {
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
    };

    /// Chi-square critical value for 86 degrees of freedom (87 characters -
    /// 1) at p = 0.001, computed independently via the regularized
    /// incomplete gamma function (binary search against the CDF, not a
    /// rounded table entry) -- derivation recorded in this plan's SUMMARY.
    /// A statistic at or above this value rejects the null hypothesis of
    /// uniformity at p < 0.001.
    const CHI_SQUARE_CRITICAL_86_DF_P001: f64 = 132.277;

    /// Runs `draws` draws directly through `uniform_random_index` over an
    /// 87-wide range (the union's own size) and returns the per-character
    /// counts. Calls `uniform_random_index` directly, NOT through
    /// `generate_character_password` -- that public function enforces
    /// `CHAR_MIN_LENGTH` (8), so a single-character draw would be below its
    /// own bounds. This measurement's target is the rejection-sampling
    /// primitive itself, independent of the length bound layered on top of
    /// it. Factored out so the falsification control (see this plan's
    /// SUMMARY) can call the exact same measurement with only
    /// `uniform_random_index`'s body swapped.
    fn draw_counts_over_all_classes(draws: usize) -> Vec<u64> {
        let n = 87usize;
        let mut counts = vec![0u64; n];
        for _ in 0..draws {
            let idx = uniform_random_index(n as u32) as usize;
            counts[idx] += 1;
        }
        counts
    }

    fn chi_square_statistic(counts: &[u64], draws: usize) -> f64 {
        let expected = draws as f64 / counts.len() as f64;
        counts
            .iter()
            .map(|&c| {
                let diff = c as f64 - expected;
                diff * diff / expected
            })
            .sum()
    }

    /// Research E-G2, steps 4-5: 200,000 single-character draws over all 87
    /// characters must hit every character AND the per-character counts
    /// must not reject uniformity at p < 0.001 -- asserted on the actual
    /// per-character COUNTS, not merely "every character appeared at least
    /// once". A `% 87` reduction bias over-represents the low end of the
    /// union while still hitting every character at least once; a
    /// presence-only assertion cannot see that, which is why this test
    /// computes a chi-square statistic instead. The union itself (87
    /// characters, matching `union_of_all_classes_is_87_characters` above)
    /// is what `draw_counts_over_all_classes` samples an index into.
    #[test]
    fn distribution_over_all_classes_does_not_reject_uniformity_at_p_001() {
        const DRAWS: usize = 200_000;
        let union: Vec<char> = format!(
            "{}{}{}{}",
            CHARSET_LOWERCASE, CHARSET_UPPERCASE, CHARSET_DIGITS, CHARSET_SYMBOLS
        )
        .chars()
        .collect();
        assert_eq!(union.len(), 87);

        let counts = draw_counts_over_all_classes(DRAWS);
        let seen = counts.iter().filter(|&&c| c > 0).count();
        assert_eq!(
            seen,
            87,
            "not every one of the 87 characters was drawn in {DRAWS} draws"
        );

        let chi_square = chi_square_statistic(&counts, DRAWS);
        assert!(
            chi_square < CHI_SQUARE_CRITICAL_86_DF_P001,
            "chi-square statistic {chi_square} rejects uniformity at p < 0.001 (critical value \
             {CHI_SQUARE_CRITICAL_86_DF_P001}) -- see this module's uniform_random_index"
        );
    }

    /// Research E-G2, step 6: the six error cases and four exact boundary
    /// successes. Named with a `bounds` prefix so
    /// `cargo test -p pv-core generator::tests::bounds` selects it.
    #[test]
    fn bounds_reject_out_of_range_and_accept_exact_boundaries() {
        // --- six error cases ---
        assert!(
            generate_character_password(CHAR_MIN_LENGTH - 1, &ALL_CLASSES).is_err(),
            "length one below CHAR_MIN_LENGTH must be rejected"
        );
        assert!(
            generate_character_password(CHAR_MAX_LENGTH + 1, &ALL_CLASSES).is_err(),
            "length one above CHAR_MAX_LENGTH must be rejected"
        );
        assert!(
            generate_character_password(0, &ALL_CLASSES).is_err(),
            "length zero must be rejected"
        );
        assert!(
            generate_character_password(CHAR_DEFAULT_LENGTH, &NO_CLASSES).is_err(),
            "no character class selected must be rejected"
        );
        assert!(
            generate_passphrase(PASSPHRASE_MIN_WORDS - 1, DEFAULT_SEPARATOR).is_err(),
            "word count one below PASSPHRASE_MIN_WORDS must be rejected"
        );
        assert!(
            generate_passphrase(PASSPHRASE_MAX_WORDS + 1, DEFAULT_SEPARATOR).is_err(),
            "word count one above PASSPHRASE_MAX_WORDS must be rejected"
        );

        // --- four exact boundary successes ---
        let at_min_len = generate_character_password(CHAR_MIN_LENGTH, &ALL_CLASSES)
            .expect("CHAR_MIN_LENGTH itself must be accepted");
        assert_eq!(at_min_len.chars().count(), CHAR_MIN_LENGTH);

        let at_max_len = generate_character_password(CHAR_MAX_LENGTH, &ALL_CLASSES)
            .expect("CHAR_MAX_LENGTH itself must be accepted");
        assert_eq!(at_max_len.chars().count(), CHAR_MAX_LENGTH);

        let at_min_words = generate_passphrase(PASSPHRASE_MIN_WORDS, DEFAULT_SEPARATOR)
            .expect("PASSPHRASE_MIN_WORDS itself must be accepted");
        assert!(!at_min_words.is_empty());

        let at_max_words = generate_passphrase(PASSPHRASE_MAX_WORDS, DEFAULT_SEPARATOR)
            .expect("PASSPHRASE_MAX_WORDS itself must be accepted");
        assert!(!at_max_words.is_empty());

        // Behavior 5: "a passphrase of n words joined by a one-character
        // separator contains exactly n minus one separators." Asserted with
        // a separator that CANNOT collide with word content -- four EFF
        // wordlist entries themselves contain a literal hyphen
        // ("drop-down", "felt-tip", "t-shirt", "yo-yo"), so counting `-`
        // occurrences in a hyphen-joined phrase is unreliable whenever one
        // of those words happens to be drawn (an observed flake, not a
        // hypothetical one). `|` appears in no wordlist entry -- verified by
        // this module's own `wordlist_has_7776_entries`/digest tests never
        // seeing a non-alphabetic, non-hyphen character; see this plan's
        // SUMMARY for the character-set audit.
        let min_words_pipe_joined =
            generate_passphrase(PASSPHRASE_MIN_WORDS, "|").expect("PASSPHRASE_MIN_WORDS accepted");
        assert_eq!(
            min_words_pipe_joined.matches('|').count(),
            PASSPHRASE_MIN_WORDS - 1,
            "a passphrase of n words joined by a one-character separator must contain n-1 separators"
        );

        let max_words_pipe_joined =
            generate_passphrase(PASSPHRASE_MAX_WORDS, "|").expect("PASSPHRASE_MAX_WORDS accepted");
        assert_eq!(
            max_words_pipe_joined.matches('|').count(),
            PASSPHRASE_MAX_WORDS - 1,
            "a passphrase of n words joined by a one-character separator must contain n-1 separators"
        );
    }

    // --- Task 1 (44-02): Apple Password Rules DSL parser + rule-aware
    // generator (DR-44-B) ---

    #[test]
    fn parse_password_rules_empty_or_whitespace_input_is_default() {
        assert_eq!(
            parse_password_rules("").expect("empty input must be accepted"),
            PasswordRules::default()
        );
        assert_eq!(
            parse_password_rules("   \n\t  ").expect("whitespace-only input must be accepted"),
            PasswordRules::default()
        );
    }

    #[test]
    fn parse_password_rules_parses_minlength_maxlength_and_required_classes() {
        let rules = parse_password_rules(
            "minlength: 10; maxlength: 14; required: lower; required: upper; required: digit;",
        )
        .expect("well-formed rules text must parse");
        assert_eq!(rules.min_length, Some(10));
        assert_eq!(rules.max_length, Some(14));
        assert_eq!(rules.required.len(), 3, "required must have exactly 3 classes: {:?}", rules.required);
        assert!(rules.required.contains(&PasswordRuleClass::Lower));
        assert!(rules.required.contains(&PasswordRuleClass::Upper));
        assert!(rules.required.contains(&PasswordRuleClass::Digit));
    }

    #[test]
    fn parse_password_rules_parses_max_consecutive() {
        let rules = parse_password_rules("max-consecutive: 3;").expect("must parse");
        assert_eq!(rules.max_consecutive, Some(3));
    }

    #[test]
    fn parse_password_rules_refuses_custom_bracket_class() {
        let err = parse_password_rules("required: [ABCDEFGH];").unwrap_err();
        match err {
            CryptoError::InvalidInput(msg) => assert!(
                msg.starts_with("unsupported rule shape: "),
                "expected the stable 'unsupported rule shape: ' prefix, got: {msg}"
            ),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn parse_password_rules_refuses_unicode_class() {
        let err = parse_password_rules("allowed: unicode;").unwrap_err();
        match err {
            CryptoError::InvalidInput(msg) => assert!(
                msg.starts_with("unsupported rule shape: "),
                "expected the stable 'unsupported rule shape: ' prefix, got: {msg}"
            ),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn parse_password_rules_ignores_unrecognized_keys() {
        assert_eq!(
            parse_password_rules("foo: bar;").expect("unrecognized keys must be ignored, not error"),
            PasswordRules::default()
        );
    }

    #[test]
    fn parse_password_rules_rejects_input_over_the_length_cap_before_parsing() {
        let oversized = "a".repeat(RULES_TEXT_MAX_LEN + 1);
        let err = parse_password_rules(&oversized).unwrap_err();
        match err {
            CryptoError::InvalidInput(msg) => assert!(
                msg.starts_with("unsupported rule shape: "),
                "expected the stable 'unsupported rule shape: ' prefix, got: {msg}"
            ),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn generate_from_default_rules_succeeds_at_default_length() {
        let password = generate_character_password_from_rules(&PasswordRules::default())
            .expect("default rules must succeed");
        assert_eq!(password.chars().count(), CHAR_DEFAULT_LENGTH);
    }

    #[test]
    fn generate_from_default_rules_draws_from_all_four_classes_over_many_runs() {
        // Statistical, not per-string: the default's effective alphabet
        // spans all four ASCII classes (ascii-printable's own documented
        // expansion) -- generate_character_password_from_rules has no
        // per-string inclusion guarantee absent an explicit `required`.
        let mut saw_lower = false;
        let mut saw_upper = false;
        let mut saw_digit = false;
        let mut saw_special = false;
        for _ in 0..200 {
            let password = generate_character_password_from_rules(&PasswordRules::default())
                .expect("default rules must succeed");
            for ch in password.chars() {
                saw_lower |= CHARSET_LOWERCASE.contains(ch);
                saw_upper |= CHARSET_UPPERCASE.contains(ch);
                saw_digit |= CHARSET_DIGITS.contains(ch);
                saw_special |= CHARSET_SYMBOLS.contains(ch);
            }
        }
        assert!(
            saw_lower && saw_upper && saw_digit && saw_special,
            "default rules' effective alphabet must span all four ASCII classes over 200 runs \
             (lower={saw_lower} upper={saw_upper} digit={saw_digit} special={saw_special})"
        );
    }

    /// Research E-G2-style guaranteed-inclusion test, run 200 times so the
    /// GUARANTEE is visible, not luck. A falsification control for this
    /// exact test (temporarily routing `Slot::Required` draws through the
    /// general alphabet instead of the required class's own charset,
    /// confirming this test then FAILS) is recorded in this plan's
    /// SUMMARY, then reverted -- this test's own load-bearing-ness is
    /// therefore demonstrated, not merely asserted.
    /// CR-03 (44-REVIEW.md): with `maxlength` unset, `minlength: 12` is a
    /// FLOOR permitting up to `CHAR_DEFAULT_LENGTH` (20) -- the generated
    /// password is 20 characters, not 12; this test's length assertion is
    /// updated to the corrected semantics (the class-inclusion guarantee
    /// this test exists for is unaffected by exactly which length wins).
    #[test]
    fn generate_with_all_four_required_classes_and_min_length_12_guarantees_inclusion() {
        let rules = PasswordRules {
            required: vec![
                PasswordRuleClass::Lower,
                PasswordRuleClass::Upper,
                PasswordRuleClass::Digit,
                PasswordRuleClass::Special,
            ],
            min_length: Some(12),
            ..Default::default()
        };
        for _ in 0..200 {
            let password = generate_character_password_from_rules(&rules)
                .expect("required classes fitting within min_length must succeed");
            assert_eq!(
                password.chars().count(),
                CHAR_DEFAULT_LENGTH,
                "length must be the app's own default, minlength is a floor not a target: {password}"
            );
            assert!(
                password.chars().any(|c| CHARSET_LOWERCASE.contains(c)),
                "missing a lowercase character: {password}"
            );
            assert!(
                password.chars().any(|c| CHARSET_UPPERCASE.contains(c)),
                "missing an uppercase character: {password}"
            );
            assert!(
                password.chars().any(|c| CHARSET_DIGITS.contains(c)),
                "missing a digit character: {password}"
            );
            assert!(
                password.chars().any(|c| CHARSET_SYMBOLS.contains(c)),
                "missing a special character: {password}"
            );
        }
    }

    #[test]
    fn generate_with_max_consecutive_one_and_two_class_alphabet_never_repeats() {
        let rules = PasswordRules {
            allowed: vec![PasswordRuleClass::Lower, PasswordRuleClass::Digit],
            max_consecutive: Some(1),
            ..Default::default()
        };
        for _ in 0..200 {
            let password = generate_character_password_from_rules(&rules)
                .expect("max_consecutive=1 over a two-class alphabet must be achievable");
            let chars: Vec<char> = password.chars().collect();
            for window in chars.windows(2) {
                assert_ne!(
                    window[0], window[1],
                    "found two identical consecutive characters in {password}"
                );
            }
        }
    }

    /// CR-03 (44-REVIEW.md): `minlength` is a FLOOR, never the generator's
    /// target length. A `min_length` below `CHAR_DEFAULT_LENGTH` (20), with
    /// no `maxlength` stated, must produce the app's own default length --
    /// NOT `CHAR_MIN_LENGTH` (8), which is this test's pre-CR-03 name and
    /// assertion; both are updated to the corrected semantics.
    #[test]
    fn generate_with_a_too_small_min_length_produces_the_default_length() {
        let rules = PasswordRules { min_length: Some(3), ..Default::default() };
        let password = generate_character_password_from_rules(&rules)
            .expect("a too-small min_length must be clamped up, not rejected");
        assert_eq!(password.chars().count(), CHAR_DEFAULT_LENGTH);
    }

    #[test]
    fn generate_rejects_required_classes_exceeding_max_length() {
        let rules = PasswordRules {
            required: vec![
                PasswordRuleClass::Lower,
                PasswordRuleClass::Upper,
                PasswordRuleClass::Digit,
                PasswordRuleClass::Special,
            ],
            max_length: Some(2),
            ..Default::default()
        };
        let err = generate_character_password_from_rules(&rules).unwrap_err();
        match err {
            CryptoError::InvalidInput(msg) => assert!(
                msg.starts_with("unsatisfiable rule: "),
                "expected the stable 'unsatisfiable rule: ' prefix, got: {msg}"
            ),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn generate_rejects_maxlength_below_char_min_length() {
        let rules = PasswordRules { max_length: Some(6), ..Default::default() };
        let err = generate_character_password_from_rules(&rules).unwrap_err();
        match err {
            CryptoError::InvalidInput(msg) => assert!(
                msg.starts_with("unsatisfiable rule: "),
                "expected the stable 'unsatisfiable rule: ' prefix, got: {msg}"
            ),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn generate_rejects_unicode_class_named_directly() {
        let rules = PasswordRules {
            allowed: vec![PasswordRuleClass::Unicode],
            ..Default::default()
        };
        let err = generate_character_password_from_rules(&rules).unwrap_err();
        match err {
            CryptoError::InvalidInput(msg) => assert!(
                msg.starts_with("unsupported rule shape: "),
                "expected the stable 'unsupported rule shape: ' prefix, got: {msg}"
            ),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    /// 44-PLAN-CHECK.md W2: Plan 44-05's Swift caller pattern-matches on
    /// these two EXACT prefixes -- this test pins the literals themselves,
    /// not merely "an error happened", and proves the two cases are
    /// genuinely DIFFERENT strings.
    #[test]
    fn refusal_error_prefixes_are_exactly_the_two_stable_literals_and_differ() {
        let unsupported = parse_password_rules("required: [X];").unwrap_err();
        let CryptoError::InvalidInput(unsupported_msg) = unsupported else {
            panic!("expected InvalidInput");
        };
        assert!(unsupported_msg.starts_with("unsupported rule shape: "));

        let unsatisfiable_rules = PasswordRules { max_length: Some(1), ..Default::default() };
        let unsatisfiable =
            generate_character_password_from_rules(&unsatisfiable_rules).unwrap_err();
        let CryptoError::InvalidInput(unsatisfiable_msg) = unsatisfiable else {
            panic!("expected InvalidInput");
        };
        assert!(unsatisfiable_msg.starts_with("unsatisfiable rule: "));

        assert_ne!(
            unsupported_msg, unsatisfiable_msg,
            "the two refusal shapes must produce genuinely different prefixes"
        );
    }

    /// CR-01 (44-REVIEW.md): `required: ascii-printable` is a syntactically
    /// valid, RP-supplied rules string. Before the fix, the un-expanded
    /// `AsciiPrintable` entry in `rules.required` reached
    /// `charset_for_class` directly in the slot-drawing loop, which returns
    /// `""` for that class, which fed an empty charset into
    /// `uniform_random_index(0)` -- `RANGE % 0`, a panic (divide by zero)
    /// on fully attacker-controlled input. This must return `Ok`, never
    /// panic.
    #[test]
    fn generate_with_required_ascii_printable_does_not_panic() {
        let rules =
            PasswordRules { required: vec![PasswordRuleClass::AsciiPrintable], ..Default::default() };
        let password = generate_character_password_from_rules(&rules)
            .expect("required: ascii-printable must expand into its four classes, not panic");
        assert!(password.chars().count() >= CHAR_MIN_LENGTH);
    }

    #[test]
    fn generate_with_required_ascii_printable_and_lower_does_not_panic() {
        let rules = PasswordRules {
            required: vec![PasswordRuleClass::AsciiPrintable, PasswordRuleClass::Lower],
            ..Default::default()
        };
        generate_character_password_from_rules(&rules)
            .expect("required: ascii-printable,lower must not panic");
    }

    #[test]
    fn generate_with_allowed_and_required_ascii_printable_does_not_panic() {
        let rules = PasswordRules {
            allowed: vec![PasswordRuleClass::AsciiPrintable],
            required: vec![PasswordRuleClass::AsciiPrintable],
            ..Default::default()
        };
        generate_character_password_from_rules(&rules)
            .expect("allowed: ascii-printable; required: ascii-printable; must not panic");
    }

    /// Bounded corpus over the DSL grammar's own named classes (both
    /// `required` and `allowed`, alone and pairwise), the shape the
    /// reviewer's ~13,000-string sweep used to find 424 panicking inputs,
    /// all of the `required: ascii-printable` shape. Not exhaustive, but
    /// asserts the property the sweep was built to check: no input in this
    /// corpus may panic `parse_password_rules` or
    /// `generate_character_password_from_rules`.
    #[test]
    fn generate_from_rules_never_panics_across_a_dsl_corpus() {
        let classes = ["lower", "upper", "digit", "special", "ascii-printable", "unicode"];
        let mut corpus: Vec<String> = Vec::new();
        for key in ["required", "allowed"] {
            for class in classes {
                corpus.push(format!("{key}: {class};"));
                for class2 in classes {
                    corpus.push(format!("{key}: {class},{class2};"));
                }
            }
        }
        corpus.push("minlength: 10; maxlength: 20; required: ascii-printable;".to_string());
        corpus.push("allowed: ascii-printable; required: ascii-printable;".to_string());

        for rules_text in &corpus {
            let result = std::panic::catch_unwind(|| {
                if let Ok(rules) = parse_password_rules(rules_text) {
                    let _ = generate_character_password_from_rules(&rules);
                }
            });
            assert!(result.is_ok(), "rules text panicked: {rules_text:?}");
        }
    }

    /// CR-03 (44-REVIEW.md): stating `minlength` used to become the TARGET
    /// length, not a floor -- discarding the app's own `CHAR_DEFAULT_LENGTH`
    /// (20) even when `maxlength` permitted it. The phase's own committed
    /// live evidence showed `minlength: 10; maxlength: 20; ...` producing a
    /// 10-character password. It must produce 20.
    #[test]
    fn generate_with_minlength_10_and_maxlength_20_produces_the_default_20_not_the_minimum() {
        let rules = PasswordRules {
            min_length: Some(10),
            max_length: Some(20),
            ..Default::default()
        };
        let password = generate_character_password_from_rules(&rules)
            .expect("minlength: 10; maxlength: 20; must be satisfiable");
        assert_eq!(
            password.chars().count(),
            20,
            "minlength must be a floor, not the target -- maxlength permits the app's own default"
        );
    }

    /// A stated `minlength` with no `maxlength` at all must still produce
    /// the app's own default length, not collapse to the minimum.
    #[test]
    fn generate_with_minlength_8_and_no_maxlength_produces_more_than_8() {
        let rules = PasswordRules { min_length: Some(8), ..Default::default() };
        let password = generate_character_password_from_rules(&rules)
            .expect("minlength: 8; with no maxlength must be satisfiable");
        assert_eq!(
            password.chars().count(),
            CHAR_DEFAULT_LENGTH,
            "with no maxlength constraint, the default length must be used, not the stated minimum"
        );
    }

    /// A `maxlength` below the app's own default must clamp DOWN to
    /// `maxlength`, never up past it.
    #[test]
    fn generate_with_maxlength_below_default_clamps_down_to_maxlength() {
        let rules = PasswordRules {
            min_length: Some(8),
            max_length: Some(15),
            ..Default::default()
        };
        let password = generate_character_password_from_rules(&rules)
            .expect("minlength: 8; maxlength: 15; must be satisfiable");
        assert_eq!(password.chars().count(), 15);
    }
}
