//! panic_probe — a single, clearly-labeled SYNTHETIC panic vector.
//!
//! This module exists SOLELY to prove FFI-06/CP-3: that a Rust panic
//! crossing the `pv-ffi` boundary is caught by UniFFI's generated
//! `catch_unwind` scaffolding (`mozilla/uniffi-rs`
//! docs/manual/src/internals/rust_calls.md — "UniFFI employs
//! `std::panic::catch_unwind` to intercept panics originating from Rust
//! code"), not propagated as a process crash / undefined behavior.
//!
//! It is NEVER called by production Swift code — the only caller is
//! `ios/PasskeyVault/PasskeyVaultTests/FfiPanicSafetyTests.swift`.
//!
//! SCOPE OF THE "no genuine panic" CLAIM — narrowed after the Faza 35 code
//! review (WR-01). What is actually proven is this, and only this:
//!
//!   No `.unwrap()`/`.expect()` exists in FIRST-PARTY production
//!   (non-`#[cfg(test)]`) source, i.e. `crates/pv-core/src/*.rs` and
//!   `crates/pv-provider/src/*.rs`.
//!
//! That was re-confirmed via
//! `grep -n '\.unwrap()\|\.expect(' crates/pv-core/src/*.rs crates/pv-provider/src/*.rs`:
//! every hit falls inside a `#[cfg(test)] mod tests` block except
//! `pv-core/src/keys.rs:78`'s `.expect("32 bytes is a valid HKDF-SHA256
//! output length")`, which asserts a compile-time-fixed 32-byte HKDF-SHA256
//! output length that can never fail — not a reachable panic.
//!
//! That grep CANNOT see into dependencies, and the review found a real panic
//! it therefore missed: `rand_core-0.6.4/src/os.rs:61-65`'s
//! `OsRng::fill_bytes` is `if let Err(e) = self.try_fill_bytes(dest) {
//! panic!("Error: {}", e) }`, reachable from `UserKey::generate()`. It is
//! remote on iOS (the OS RNG failing), but it is a genuine unwind path, and
//! it is why `FfiUserKey::generate` now returns `Result` (see
//! `crates/pv-ffi/src/lib.rs`'s module header for the full per-export
//! audit). Panics inside `argon2`/`chacha20poly1305`/`hkdf` are likewise out
//! of the grep's reach and have not been exhaustively enumerated.
//!
//! So the honest statement is: this probe is a deliberate, labeled
//! substitution for a first-party panic vector that does not exist — NOT a
//! claim that the boundary has no reachable panic at all (P3,
//! 35-RESEARCH.md Pitfall 3 / Open Question 2 — the originally-proposed
//! `ciborium`/CBOR panic vector did not survive verification, see
//! 35-05-SUMMARY.md). The defence against dependency panics is structural,
//! not enumerative: every export that can unwind returns `Result`, so
//! UniFFI's `catch_unwind` result reaches Swift as a `throws` rather than a
//! `try!`-induced `fatalError`.
//!
//! Feature-gated behind `ffi06-probe` (default-on — see
//! `crates/pv-ffi/Cargo.toml`'s `[features]` table comment for the
//! `#[cfg(debug_assertions)]`-would-break-`--release` rationale, and the
//! Phase 38 debt this default-on posture leaves behind).
//!
//! P2: lives ONLY in `pv-ffi`. `pv-core`/`pv-provider` are never touched by
//! this module.

use crate::{FfiError, FfiUserKey};

/// The exact byte pattern that triggers the synthetic panic. Any other
/// input returns normally — this is what makes the probe an INPUT-DRIVEN
/// adversarial test (ROADMAP SC5's "zniekształcony input"), not an
/// unconditional trap.
const PANIC_SENTINEL: &[u8] = b"FFI06-PANIC";

#[cfg(feature = "ffi06-probe")]
#[uniffi::export]
impl FfiUserKey {
    /// Panics ONLY when `sentinel` exactly equals `PANIC_SENTINEL` —
    /// otherwise returns `Ok` with a plain, non-panicking description of the
    /// input. SYNTHETIC, test-only — see this module's doc comment.
    ///
    /// DELIBERATELY returns `Result<String, FfiError>` rather than a bare
    /// `String`, even though the non-panic path is infallible and never
    /// produces `Err`: this is load-bearing, not cosmetic. UniFFI only
    /// generates a Swift `throws` wrapper (using `rustCallWithError`, whose
    /// caller writes an ordinary `do { try ... } catch { ... }`) for
    /// functions whose Rust signature returns `Result<T, E: uniffi::Error>`.
    /// A bare `-> String` return generates a NON-throwing Swift wrapper that
    /// force-unwraps the underlying FFI call with `try!` — so a caught panic
    /// (UniFFI's `CALL_UNEXPECTED_ERROR` -> `UniffiInternalError.rustPanic`)
    /// would still be intercepted by `catch_unwind` at the Rust/C boundary
    /// (never raw UB), but the generated Swift codegen's own `try!` would
    /// then immediately trigger an uncatchable `fatalError` — a real Swift
    /// runtime trap, NOT the "catchable error (throws/Result)" SC5 requires.
    /// Verified empirically this session by inspecting the generated
    /// `ios/PasskeyVault/build/swift-bindings/pv_ffi.swift` for both
    /// signature shapes (see 35-05-SUMMARY.md for the transcript) — a real,
    /// load-bearing discovery, not an assumption.
    pub fn ffi06_synthetic_panic_probe(&self, sentinel: Vec<u8>) -> Result<String, FfiError> {
        if sentinel == PANIC_SENTINEL {
            panic!(
                "FFI-06 synthetic panic probe — deliberately test-only, never called by \
                 production code, see crates/pv-ffi/src/panic_probe.rs"
            );
        }
        Ok(format!("no panic: {} non-sentinel bytes", sentinel.len()))
    }
}

#[cfg(all(test, feature = "ffi06-probe"))]
mod tests {
    use super::*;

    /// Test 1 (RED first): the sentinel byte pattern reaches a real,
    /// in-process `panic!()` — proving the panic is reachable at all,
    /// before Task 2 proves UniFFI's boundary catches it on the Swift side.
    #[test]
    fn sentinel_input_panics() {
        let uk = FfiUserKey::generate().expect("generate is infallible today");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            uk.ffi06_synthetic_panic_probe(PANIC_SENTINEL.to_vec())
        }));
        assert!(result.is_err(), "sentinel input should have panicked");
    }

    /// Test 2: the SAME unmodified method, called with a non-sentinel byte
    /// input, returns normally — proving the panic is genuinely
    /// data-driven, not unconditional.
    #[test]
    fn non_sentinel_input_returns_normally() {
        let uk = FfiUserKey::generate().expect("generate is infallible today");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            uk.ffi06_synthetic_panic_probe(vec![0x00])
        }));
        assert!(result.is_ok(), "non-sentinel input should not have panicked");
        assert_eq!(result.unwrap().unwrap(), "no panic: 1 non-sentinel bytes");
    }
}
