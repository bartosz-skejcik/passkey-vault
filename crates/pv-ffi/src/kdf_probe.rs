//! kdf_probe — a single, clearly-labeled DIAGNOSTIC constructor.
//!
//! Exists SOLELY to serve Phase 36 Plan 36-03's E5.c mandatory sensitivity
//! control: the FILL-06 memory instrument must be proven to MOVE with the
//! KDF's own memory parameter before any number it reports is believed
//! (ROADMAP Phase 36 SC3, second binding correction; 36-RESEARCH.md
//! Pitfall 4). That control's target values are `m_cost_kib = 8*1024` and
//! `m_cost_kib = 256*1024` — the second one is deliberately outside the
//! production range, by design, because the point is to prove the
//! instrument can see a LARGE, predictable swing (≈248 MiB), not to
//! exercise a realistic parameter.
//!
//! A RECORDED DEVIATION (`ios/PasskeyVaultAutoFill/KdfProbe.swift`'s own
//! header carries the same note; `36-03-SUMMARY.md` records it in full):
//! the production constructor, `FfiWrappingKey::from_password`, calls
//! `validate_kdf_params` (WR-11, this crate's `lib.rs`), whose
//! `MAX_M_COST_KIB = 96 * 1024` REJECTS `256 * 1024` outright — that guard
//! exists to bound an UNTRUSTED, server-supplied parameter (`lib.rs`'s own
//! doc comment on the constant), and this probe's 256 MiB value is a
//! fixed, author-chosen literal that is never server-supplied, so the
//! threat the guard defends against does not apply here. Raising the
//! production ceiling to admit this one diagnostic value would reopen that
//! bound for every real caller, permanently, to serve a single throwaway
//! measurement — not done (P2 also forbids tuning `pv-core`'s own
//! parameters to serve this probe, and this module does not touch
//! `pv-core` at all). Lowering the control's target value would abandon
//! the ROADMAP-pinned 248 MiB delta the whole control exists to prove.
//! Instead, this module adds a SEPARATE constructor that skips ONLY
//! `validate_kdf_params` — every other step (JSON parse, the
//! `Zeroizing`-wrapped wipe-on-every-exit-path from CR-01, the real
//! `wrapping_key_from_password` call) is identical to `from_password`.
//!
//! Mirrors `panic_probe.rs`'s established precedent exactly: a
//! default-off, feature-gated (`kdf-probe`) module, never linked into any
//! production build. The gate lives on the `mod kdf_probe;` DECLARATION in
//! `lib.rs` (WR-04's lesson from `panic_probe.rs`: gating only the inner
//! `impl` would leave this module's `use` statements compiling under
//! `--no-default-features`, producing dead-code warnings for a
//! configuration nothing exercises).
//!
//! NEVER called by production Swift code. The only caller is
//! `ios/PasskeyVault/PasskeyVaultAutoFill/KdfProbe.swift`, itself gated
//! behind `#if PV_PROBE_SENSITIVITY`, itself only ever compiled by
//! `scripts/ios-probe-run.sh sensitivity` (which is the one caller of
//! `scripts/build-ios.sh --with-kdf-probe`). Every other probe run
//! (`instrument`, `enforcement`) builds `pv-ffi` PLAIN, so the generated
//! Swift binding for this constructor does not exist in those builds —
//! `KdfProbe.swift` wraps its own reference to it in the SAME
//! `#if PV_PROBE_SENSITIVITY` condition for exactly that reason.
//!
//! T-36-12: `password`/`salt` here are always fixed, non-secret,
//! author-chosen literals supplied by the Swift-side caller — this module
//! itself has no fixture of its own and never logs anything.
//!
//! P2: lives ONLY in `pv-ffi`. `pv-core`/`pv-provider` are never touched by
//! this module.

use std::sync::Arc;

use pv_core::kdf::{wrapping_key_from_password, KdfParams};
use zeroize::Zeroizing;

use crate::{FfiError, FfiWrappingKey};

#[uniffi::export]
impl FfiWrappingKey {
    /// DIAGNOSTIC ONLY — see this module's doc comment for the full
    /// rationale for why this constructor exists separately from
    /// `from_password` rather than as a parameter to it. Skips ONLY
    /// `validate_kdf_params`'s upper-bound check (WR-11); every other step
    /// is byte-for-byte identical to `from_password`, including the
    /// `Zeroizing`-wrapped password wipe-on-every-exit-path (CR-01).
    #[uniffi::constructor]
    pub fn from_password_probe_unchecked(
        password: Vec<u8>,
        salt: Vec<u8>,
        kdf_params_json: String,
    ) -> Result<Arc<Self>, FfiError> {
        let password = Zeroizing::new(password);
        let params: KdfParams = serde_json::from_str(&kdf_params_json)
            .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
        let wk = wrapping_key_from_password(&password, &salt, &params)?;
        Ok(Arc::new(FfiWrappingKey(*wk)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params_json(m_cost_kib: u32) -> String {
        serde_json::to_string(&KdfParams { m_cost_kib, t_cost: 1, p_cost: 1 })
            .expect("KdfParams always serializes")
    }

    /// The whole point of this constructor: a value the production
    /// constructor rejects (well above `MAX_M_COST_KIB = 96 * 1024`) must
    /// succeed here, or the sensitivity control this module exists to
    /// serve cannot run at all.
    #[test]
    fn accepts_the_256_mib_probe_value_the_production_constructor_rejects() {
        let salt = b"0123456789abcdef".to_vec();
        let result = FfiWrappingKey::from_password_probe_unchecked(
            b"probe-password".to_vec(),
            salt.clone(),
            params_json(256 * 1024),
        );
        assert!(
            result.is_ok(),
            "the probe constructor must accept 256 MiB, which from_password rejects by design"
        );

        // The bound production constructor still rejects the same value —
        // proving this probe did not accidentally weaken the real guard.
        let production_result =
            FfiWrappingKey::from_password(b"probe-password".to_vec(), salt, params_json(256 * 1024));
        assert!(
            production_result.is_err(),
            "from_password must still reject 256 MiB — this probe must not have weakened it"
        );
    }

    /// The cheap 8 MiB control point also succeeds, matching
    /// `from_password`'s own behavior for an in-range value.
    #[test]
    fn accepts_the_8_mib_probe_value_too() {
        let salt = b"0123456789abcdef".to_vec();
        let result = FfiWrappingKey::from_password_probe_unchecked(
            b"probe-password".to_vec(),
            salt,
            params_json(8 * 1024),
        );
        assert!(result.is_ok());
    }
}
