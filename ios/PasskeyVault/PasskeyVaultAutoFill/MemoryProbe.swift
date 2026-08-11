// MemoryProbe.swift -- Phase 36, Plan 36-01, Task 1.
//
// In-extension footprint sampler. `task_info(mach_task_self_, TASK_VM_INFO,
// ...)` reads the caller's OWN task port -- no entitlement, no host port, no
// privilege required (36-RESEARCH.md "The in-extension footprint sampler",
// P2 INFER, high confidence). This is the E5.a check this phase's later
// plans (36-03/36-04) build the FILL-06 measurement on top of; here it only
// needs to prove the call succeeds inside a REAL extension process and that
// the reading is observable from outside via os_log.
//
// `print` does not survive out of an .appex; `os_log` does
// (36-RESEARCH.md "Getting the number out").

import Darwin.Mach
import os

/// One `task_info(TASK_VM_INFO)` sample. Field provenance (all from
/// `<SDK>/usr/include/mach/task_info.h`, 36-RESEARCH.md "Code Examples"):
/// `phys_footprint` (rev1, what jetsam caps), `ledger_phys_footprint_peak`
/// (rev3, cross-check only), `limit_bytes_remaining` (rev4, the process's
/// own view of its budget -- on the simulator a 0/nonsense value here is
/// itself enforcement evidence, never assumed).
struct FootprintSample {
    var phys: UInt64
    var peak: Int64
    var remaining: UInt64
}

enum MemoryProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// Reads the extension process's own `task_vm_info`. Returns `nil` only
    /// on a genuine `kern_return_t` failure, which is ALWAYS logged --
    /// never fails silently (36-01-PLAN.md Task 1, action 6).
    static func readVMInfo() -> FootprintSample? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) { infoPtr in
            infoPtr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), intPtr, &count)
            }
        }
        guard kr == KERN_SUCCESS else {
            logger.error("PVPROBE|readVMInfo failed kr=\(kr, privacy: .public)")
            return nil
        }
        return FootprintSample(
            phys: info.phys_footprint,
            peak: info.ledger_phys_footprint_peak,
            remaining: info.limit_bytes_remaining
        )
    }

    /// Emits exactly one `PVPROBE|` os_log line for the given lifecycle
    /// `stage`. `stage` is the fixed four-word vocabulary the
    /// CredentialProviderViewController overrides use --
    /// `list`/`silent`/`interactive`/`configure` -- nothing else may emit
    /// this marker (36-01-PLAN.md Task 1, action 5). Also crosses the
    /// pv-ffi boundary once per call so the tracer proves the FFI
    /// boundary, not merely the process boundary: constructs a real
    /// `FfiUserKey` and passes it through `exportUserKeyForSession`,
    /// logging only the returned byte COUNT (T-36-01 -- never the bytes
    /// themselves).
    static func emit(stage: String) {
        let sample = readVMInfo()
        let kr = sample == nil ? "FAILED" : "KERN_SUCCESS"
        let phys = sample?.phys ?? 0
        let peak = sample?.peak ?? -1
        let remaining = sample?.remaining ?? 0

        var ffiBytes = -1
        do {
            let userKey = try FfiUserKey.generate()
            let exported = exportUserKeyForSession(userKey: userKey)
            ffiBytes = exported.count
        } catch {
            logger.error("PVPROBE|ffi_error stage=\(stage, privacy: .public) error=\(String(describing: error), privacy: .public)")
        }

        logger.log(
            "PVPROBE|stage=\(stage, privacy: .public) kr=\(kr, privacy: .public) phys=\(phys, privacy: .public) peak=\(peak, privacy: .public) remaining=\(remaining, privacy: .public) ffi_bytes=\(ffiBytes, privacy: .public)"
        )
    }
}
