// KdfProbe.swift -- Phase 36, Plan 36-03, Task 2 (E5.c, the mandatory
// sensitivity control every later number in this phase depends on).
//
// Runs the real `pv-ffi` KDF entry point at two fixed `m_cost_kib` values
// (8 MiB / 256 MiB, both t_cost=1 p_cost=1 -- this control is about the
// memory parameter alone, so the cheap time/parallelism values keep the
// run fast) and logs the sampled peak for each. `scripts/ios-memory-gate.sh
// sensitivity` asserts the two peaks differ by ~248 MiB (+-10%); if they do
// not, the instrument is not measuring the allocation and the run is
// aborted before any number from it is believed (Pitfall 4, D-11).
//
// A RECORDED DEVIATION, found running this task, not assumed: the plan's
// own read_first pointed at `FfiWrappingKey.fromPassword(password:salt:
// kdfParamsJson:)` -- the PRODUCTION constructor. That constructor's
// `validate_kdf_params` guard (WR-11, `crates/pv-ffi/src/lib.rs`,
// `MAX_M_COST_KIB = 96 * 1024`) REJECTS `m_cost_kib = 256 * 1024` outright,
// before Argon2id ever allocates -- 262144 KiB is nearly 3x the 98304 KiB
// ceiling. That guard exists to bound an UNTRUSTED, server-supplied
// parameter (WR-11's own doc comment); this probe's 256 MiB value is a
// fixed, author-chosen literal, never server-supplied, so the threat the
// guard defends against does not apply here. Rather than raise the
// production ceiling (which WOULD reopen that hole for every real caller,
// permanently, to serve one diagnostic run) or lower this control's target
// value (which would abandon the ROADMAP-pinned 248 MiB delta this whole
// task exists to prove), `crates/pv-ffi/src/kdf_probe.rs` adds a SEPARATE,
// feature-gated (`kdf-probe`, default-off) diagnostic constructor,
// `FfiWrappingKey.fromPasswordProbeUnchecked`, that skips ONLY that bound
// -- mirroring `panic_probe.rs`'s established `ffi06-probe` precedent
// exactly (module-level `#[cfg]` gate, never called by production Swift,
// only linked when `scripts/build-ios.sh --with-kdf-probe` is passed, which
// only `scripts/ios-probe-run.sh sensitivity` does). Recorded in full in
// `ios/AUTOFILL-FEASIBILITY.md`'s `## E5.c` section and 36-03-SUMMARY.md.
//
// COMPILE-TIME COUPLING, load-bearing: `fromPasswordProbeUnchecked` only
// EXISTS in the generated Swift bindings when pv-ffi was built
// `--with-kdf-probe`. Every OTHER probe run (`instrument`, `enforcement`)
// builds pv-ffi PLAIN, so this file's reference to that symbol is wrapped
// in the SAME `#if PV_PROBE_SENSITIVITY` condition `ios-probe-run.sh`
// derives from the `sensitivity` probe name -- without that guard, the
// PasskeyVaultAutoFill target (which always compiles this file) would fail
// to build for `instrument`/`enforcement` runs with an unresolved symbol.
//
// T-36-12: the probe password/salt are fixed, non-secret, author-chosen
// literals -- never a real password, never logged. The Swift-side password
// buffer is wiped immediately after the call returns, per the pv-ffi
// module header's caller-side mitigation (UniFFI has no `&mut [u8]`
// argument type -- CP-4; Rust zeroizes only its OWN copy).

import Foundation
import os

enum KdfProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// Fixed, non-secret probe fixtures -- author-chosen literals, never
    /// produced by any code under test, never real credentials (mirrors
    /// FfiRoundTripTests.swift's own literal-fixture discipline).
    private static let probePasswordString =
        "pv-phase36-kdf-probe-fixture (never a real password, never logged)"
    private static let probeSalt: [UInt8] = [
        0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
        0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F,
    ]

    /// Runs one KDF sensitivity data point: baseline -> sampler start ->
    /// the real FFI call -> sampler stop -> settle -> residual. Logs
    /// exactly one `PVPROBE|stage=kdf` line carrying the label, the three
    /// KDF parameters, the baseline/peak/residual footprints, the kernel
    /// peak-ledger cross-check, the sample count, and elapsed time. NEVER
    /// logs the password, the salt, or any returned handle's contents.
    static func run(mCostKiB: UInt32, tCost: UInt32, pCost: UInt32, label: String) {
        #if PV_PROBE_SENSITIVITY
        let baseline = MemoryProbe.readVMInfo()?.phys ?? 0
        MemoryProbe.startSampling(intervalMs: 10)

        var passwordBytes = Data(probePasswordString.utf8)
        let salt = Data(probeSalt)
        let paramsJson =
            "{\"m_cost_kib\":\(mCostKiB),\"t_cost\":\(tCost),\"p_cost\":\(pCost)}"

        let startedAt = DispatchTime.now()
        var callOk = true
        do {
            _ = try FfiWrappingKey.fromPasswordProbeUnchecked(
                password: passwordBytes, salt: salt, kdfParamsJson: paramsJson)
        } catch {
            callOk = false
            logger.error(
                "PVPROBE|kdf_error label=\(label, privacy: .public) error=\(String(describing: error), privacy: .public)"
            )
        }
        let elapsedMs =
            Double(DispatchTime.now().uptimeNanoseconds - startedAt.uptimeNanoseconds) / 1_000_000.0

        // Wipe the Swift-side password buffer immediately after the call
        // returns (pv-ffi module header's caller-side mitigation, CP-4).
        passwordBytes.resetBytes(in: 0..<passwordBytes.count)

        let sampled = MemoryProbe.stopSampling()
        Thread.sleep(forTimeInterval: 0.1)  // fixed settle interval
        let residual = MemoryProbe.readVMInfo()?.phys ?? 0

        logger.log(
            "PVPROBE|stage=kdf label=\(label, privacy: .public) m_cost_kib=\(mCostKiB, privacy: .public) t_cost=\(tCost, privacy: .public) p_cost=\(pCost, privacy: .public) call_ok=\(callOk, privacy: .public) baseline=\(baseline, privacy: .public) peak_sampled=\(sampled.maxSampled, privacy: .public) samples=\(sampled.sampleCount, privacy: .public) ledger_peak=\(sampled.ledgerPeak, privacy: .public) residual=\(residual, privacy: .public) elapsed_ms=\(elapsedMs, privacy: .public)"
        )
        #endif
    }
}
