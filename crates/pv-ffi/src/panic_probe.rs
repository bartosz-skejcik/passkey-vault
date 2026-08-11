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
//! No genuine, attacker-reachable panic exists in `pv-core`'s or
//! `pv-provider`'s production (non-`#[cfg(test)]`) code today. This was
//! re-confirmed at the top of this plan's Task 1 via
//! `grep -n '\.unwrap()\|\.expect(' crates/pv-core/src/*.rs crates/pv-provider/src/*.rs`:
//! every hit falls inside a `#[cfg(test)] mod tests` block except
//! `pv-core/src/keys.rs:78`'s `.expect("32 bytes is a valid HKDF-SHA256
//! output length")`, which asserts a compile-time-fixed 32-byte HKDF-SHA256
//! output length that can never fail — not a reachable panic. So this probe
//! is a deliberate, labeled substitution, not a fabricated claim of a real
//! vector (P3, 35-RESEARCH.md Pitfall 3 / Open Question 2 — the
//! originally-proposed `ciborium`/CBOR panic vector did not survive
//! verification, see 35-05-SUMMARY.md).
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
        let uk = FfiUserKey::generate();
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
        let uk = FfiUserKey::generate();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            uk.ffi06_synthetic_panic_probe(vec![0x00])
        }));
        assert!(result.is_ok(), "non-sentinel input should not have panicked");
        assert_eq!(result.unwrap().unwrap(), "no panic: 1 non-sentinel bytes");
    }
}
