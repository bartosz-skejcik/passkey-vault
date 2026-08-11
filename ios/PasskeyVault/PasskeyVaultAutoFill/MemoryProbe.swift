// MemoryProbe.swift -- Phase 36, Plan 36-01 Task 1 / Plan 36-03 Task 1 (E5.a/E5.b).
//
// In-extension footprint sampler. `task_info(mach_task_self_, TASK_VM_INFO,
// ...)` reads the caller's OWN task port -- no entitlement, no host port, no
// privilege required (36-RESEARCH.md "The in-extension footprint sampler",
// P2 INFER, high confidence). Plan 36-01 proved a single readVMInfo() call
// succeeds inside a real extension process; Plan 36-03 (this file's E5.a/
// E5.b addition) proves the SAMPLER can run on its own thread and that
// os_proc_available_memory()'s ambiguous zero is recorded but never
// branched on (D-13).
//
// `print` does not survive out of an .appex; `os_log` does
// (36-RESEARCH.md "Getting the number out").

import Darwin.Mach
import Foundation
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

/// The final result of a completed sampling window (Plan 36-03, E5.a/E5.c).
/// `sampleCount` is logged explicitly so a sampler that never actually ran
/// is visible as `samples=0` rather than as a plausible-looking `0`
/// maximum (36-RESEARCH.md "The in-extension footprint sampler" /
/// 36-03-PLAN.md Task 1 action). `kr` mirrors `emit(stage:)`'s own
/// KERN_SUCCESS/FAILED vocabulary: `KERN_SUCCESS` only if at least one
/// `readVMInfo()` call inside the sampling window actually succeeded.
struct SamplerResult {
    var maxSampled: UInt64
    var sampleCount: Int
    var ledgerPeak: Int64
    var kr: String
}

/// A dedicated sampler thread polling `readVMInfo()` at a fixed interval and
/// keeping the running maximum `phys_footprint`. A SEPARATE THREAD IS
/// MANDATORY: the UniFFI KDF call this sampler wraps (`KdfProbe.swift`) is
/// blocking, so an inline sampler would observe nothing while it runs
/// (36-RESEARCH.md E6 step 2). `NSLock`-guarded mutable state because the
/// caller thread (the extension's own dispatch) reads the result via
/// `stop()` while the sampler thread is still writing `maxPhys`/
/// `sampleCount` up until the moment `running` flips false.
private final class FootprintSampler {
    private let lock = NSLock()
    private var running = false
    private var maxPhys: UInt64 = 0
    private var sampleCount = 0
    private var ledgerPeak: Int64 = -1

    func start(intervalMs: Int) {
        lock.lock()
        running = true
        maxPhys = 0
        sampleCount = 0
        ledgerPeak = -1
        lock.unlock()

        let thread = Thread { [self] in
            while true {
                lock.lock()
                let stillRunning = running
                lock.unlock()
                if !stillRunning { break }

                if let sample = MemoryProbe.readVMInfo() {
                    lock.lock()
                    if sample.phys > maxPhys { maxPhys = sample.phys }
                    ledgerPeak = sample.peak
                    sampleCount += 1
                    lock.unlock()
                }
                Thread.sleep(forTimeInterval: Double(intervalMs) / 1000.0)
            }
        }
        thread.name = "cloud.blonie.PasskeyVault.memprobe.sampler"
        thread.stackSize = 256 * 1024
        thread.start()
    }

    /// Stops the sampler loop and returns whatever it accumulated. Does NOT
    /// block waiting for the sampler thread to actually notice `running`
    /// flip false and exit -- the returned snapshot is already final under
    /// the lock at the moment this is called, and the thread's own next
    /// iteration (at most one `intervalMs` later) simply sees `running ==
    /// false` and returns.
    func stop() -> SamplerResult {
        lock.lock()
        running = false
        let result = SamplerResult(
            maxSampled: maxPhys,
            sampleCount: sampleCount,
            ledgerPeak: ledgerPeak,
            kr: sampleCount > 0 ? "KERN_SUCCESS" : "FAILED"
        )
        lock.unlock()
        return result
    }
}

enum MemoryProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")
    private static let sampler = FootprintSampler()

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

    /// E5.a (Plan 36-03, Task 1) -- starts the sampler thread. MUST be
    /// paired with `stopSampling()`; `readVMInfo()`'s own `kr` logging
    /// already proves a single call works (Plan 36-01) -- this proves the
    /// SAMPLING LOOP works, on its own thread, without blocking whatever
    /// the caller does next.
    static func startSampling(intervalMs: Int) {
        sampler.start(intervalMs: intervalMs)
    }

    /// Stops the sampler and returns its result. Deliberately does NOT log
    /// anything itself -- callers own their own `PVPROBE|` stage (E5.a's
    /// direct dispatch logs `stage=sampler` via `emitSamplerResult(_:)`
    /// below; `KdfProbe.run` folds the same fields into its own
    /// `stage=kdf` line instead, per KeychainProbe/AppGroupProbe's own
    /// precedent of each probe owning its stage prefix).
    @discardableResult
    static func stopSampling() -> SamplerResult {
        sampler.stop()
    }

    /// E5.a's own direct dispatch (`PV_PROBE_INSTRUMENT`) logs the sampler
    /// result under this fixed `stage=sampler` marker. `kr`/`samples`/
    /// `peak_sampled` are exactly the three fields
    /// `scripts/ios-memory-gate.sh instrument` asserts on.
    static func emitSamplerResult(_ result: SamplerResult) {
        logger.log(
            "PVPROBE|stage=sampler kr=\(result.kr, privacy: .public) samples=\(result.sampleCount, privacy: .public) peak_sampled=\(result.maxSampled, privacy: .public) ledger_peak=\(result.ledgerPeak, privacy: .public)"
        )
    }

    /// E5.b (Plan 36-03, Task 1) -- ONE-SHOT, NEVER a gate (D-13):
    /// `os_proc_available_memory()`'s `0` return means EITHER "not an app"
    /// OR "already over the memory limit" (`os/proc.h:78-87`), so it can
    /// never distinguish success from catastrophe. This function's only
    /// job is recording the number as a finding; it appears in no `if`, no
    /// threshold, and no early return anywhere in this phase.
    static func emitAvailableMemory() {
        let available = os_proc_available_memory()
        logger.log("PVPROBE|stage=availmem available_bytes=\(available, privacy: .public)")
    }
}
