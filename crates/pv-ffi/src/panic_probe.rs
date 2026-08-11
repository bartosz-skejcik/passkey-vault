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

use crate::FfiUserKey;

/// The exact byte pattern that triggers the synthetic panic. Any other
/// input returns normally — this is what makes the probe an INPUT-DRIVEN
/// adversarial test (ROADMAP SC5's "zniekształcony input"), not an
/// unconditional trap.
const PANIC_SENTINEL: &[u8] = b"FFI06-PANIC";

#[cfg(feature = "ffi06-probe")]
#[uniffi::export]
impl FfiUserKey {
    /// Panics ONLY when `sentinel` exactly equals `PANIC_SENTINEL` —
    /// otherwise returns a plain, non-panicking description of the input.
    /// SYNTHETIC, test-only — see this module's doc comment.
    pub fn ffi06_synthetic_panic_probe(&self, sentinel: Vec<u8>) -> String {
        if sentinel == PANIC_SENTINEL {
            panic!(
                "FFI-06 synthetic panic probe — deliberately test-only, never called by \
                 production code, see crates/pv-ffi/src/panic_probe.rs"
            );
        }
        format!("no panic: {} non-sentinel bytes", sentinel.len())
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
        assert_eq!(result.unwrap(), "no panic: 1 non-sentinel bytes");
    }
}
