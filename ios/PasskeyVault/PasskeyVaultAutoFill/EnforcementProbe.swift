// EnforcementProbe.swift -- Phase 36, Plan 36-03, Task 3 (E5.d, the
// enforcement control).
//
// Measures -- rather than assumes -- whether THIS simulator enforces a
// memory limit on the extension process at all (ios/IOS-SPIKE-LOG.md §3
// L-6; two prior research probes independently concluded "no jetsam
// machinery on the simulator", but neither one deliberately tried to kill
// the process to confirm it). Allocates and fully dirties a 200 MB buffer,
// holds it, and logs the footprint before/during/after. Whichever way it
// comes back is a recorded finding, never smoothed over:
//   - survives, footprint rises by ~200 MB -> confirms the no-enforcement
//     conclusion empirically.
//   - the process dies -> OVERTURNS both research probes' conclusion, and
//     that overturning is itself the finding (Open Question 7).
//
// Dispatched ALONE under `PV_PROBE_ENFORCEMENT` -- never sharing an
// invocation with any other probe, because a process death here would
// swallow their output too. `scripts/ios-probe-run.sh`'s single-condition-
// per-run mechanism already enforces this: only ONE `PV_PROBE_*` condition
// is ever set per build.
//
// memset (not just allocate) is deliberate: a lazy VA reservation costs no
// physical memory at all (36-RESEARCH.md "Argon2id: the allocation is
// exact" makes exactly this point about fill_blocks) -- writing every page
// is what makes the 200 MB genuinely count against phys_footprint.

import Foundation
import os

enum EnforcementProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    /// 200 MB, matching the ROADMAP/36-RESEARCH.md E5.d control exactly.
    private static let allocationBytes = 200 * 1024 * 1024

    static func run() {
        #if PV_PROBE_ENFORCEMENT
        emitReading(ordinal: 1)

        let buffer = UnsafeMutableRawPointer.allocate(byteCount: allocationBytes, alignment: 16)
        defer { buffer.deallocate() }
        // Genuinely dirty every page -- never a lazy mapping the OS could
        // satisfy without real physical cost.
        memset(buffer, 0xAB, allocationBytes)

        emitReading(ordinal: 2)
        Thread.sleep(forTimeInterval: 2.0)
        emitReading(ordinal: 3)
        #endif
    }

    /// One `PVPROBE|stage=enforce` line per reading, each carrying an
    /// explicit ordinal -- a truncated sequence (process died mid-hold) is
    /// then visible as a MISSING ordinal in the captured log, never as a
    /// clean-looking run that simply stopped early.
    private static func emitReading(ordinal: Int) {
        let sample = MemoryProbe.readVMInfo()
        let kr = sample == nil ? "FAILED" : "KERN_SUCCESS"
        let phys = sample?.phys ?? 0
        logger.log(
            "PVPROBE|stage=enforce ordinal=\(ordinal, privacy: .public) kr=\(kr, privacy: .public) phys=\(phys, privacy: .public)"
        )
    }
}
