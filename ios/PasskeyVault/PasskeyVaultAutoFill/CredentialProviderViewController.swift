// CredentialProviderViewController.swift -- Phase 36, Plan 36-01 Task 1;
// extended by Plan 36-02 Tasks 1-2 and Plan 36-03 Tasks 1-3.
//
// Tracer skeleton ONLY -- no credential-list logic, no fetching, no storage
// (36-01-PLAN.md Task 1 action). Overrides ONLY the current, non-deprecated
// overloads (`for: any ASCredentialRequest`), never the
// `ASPasswordCredentialIdentity`-typed pair the shipped Xcode 26.6 template
// walks straight into (Pitfall 7, 36-RESEARCH.md): that pair compiles,
// appears in the UI, and silently never fills.
//
// Every override calls MemoryProbe.emit(stage:) with a FIXED stage string --
// `list`/`silent`/`interactive`/`configure` -- MemoryProbe's own baseline
// vocabulary from Plan 36-01. Each probe module added since (AppGroupProbe,
// KeychainProbe, and this plan's MemoryProbe sampler/KdfProbe/
// EnforcementProbe) owns and logs its OWN `PVPROBE|stage=*` marker, gated
// behind its own `PV_PROBE_*` compilation condition, dispatched from
// `prepareInterfaceForExtensionConfiguration()` below -- the one entry
// point `AutoFillInvocationUITests` reliably reaches without the provider
// already being elected. Every override except that one then completes via
// cancelRequest(withError:) carrying ASExtensionErrorCode.userInteractionRequired
// -- this phase deliberately fills nothing.

import AuthenticationServices

final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        MemoryProbe.emit(stage: "list")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "silent")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "interactive")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    /// The entry point AutoFillInvocationUITests.swift's primary route
    /// drives (Settings -> Passwords -> AutoFill -> our provider's config
    /// UI). This is the ONE override that does not cancel: it is the
    /// baseline probe run's target, and `stage=configure` is the label
    /// this task's <verify> asserts on. Every PV_PROBE_* probe added in
    /// Phase 36 is dispatched here first, alongside the existing baseline
    /// emission, because this is the one stage AutoFillInvocationUITests
    /// reliably reaches without the provider already being elected.
    override func prepareInterfaceForExtensionConfiguration() {
        MemoryProbe.emit(stage: "configure")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // Plan 36-03, Task 1 (E5.a/E5.b): sampler thread proven inside a
        // real extension process, plus the one-shot, never-a-gate
        // os_proc_available_memory() finding (D-13).
        #if PV_PROBE_INSTRUMENT
        MemoryProbe.startSampling(intervalMs: 10)
        MemoryProbe.emitAvailableMemory()
        Thread.sleep(forTimeInterval: 0.5)
        let samplerResult = MemoryProbe.stopSampling()
        MemoryProbe.emitSamplerResult(samplerResult)
        #endif
        // Plan 36-03, Task 2 (E5.c): the mandatory sensitivity control --
        // 8 MiB then 256 MiB, both cheap on time/parallelism, in one
        // extension invocation.
        #if PV_PROBE_SENSITIVITY
        KdfProbe.run(mCostKiB: 8 * 1024, tCost: 1, pCost: 1, label: "8mib")
        KdfProbe.run(mCostKiB: 256 * 1024, tCost: 1, pCost: 1, label: "256mib")
        #endif
        // Plan 36-03, Task 3 (E5.d): the enforcement control. Dispatched
        // alone -- never alongside PV_PROBE_INSTRUMENT/PV_PROBE_SENSITIVITY
        // in the same invocation (a process death here must not swallow
        // their output too). scripts/ios-probe-run.sh's single-condition-
        // per-run mechanism already guarantees this.
        #if PV_PROBE_ENFORCEMENT
        EnforcementProbe.run()
        #endif
        // Plan 36-04, Task 1 (E6): the FILL-06 measurement itself -- five
        // hot runs of the REAL production Argon2id parameters inside this
        // one extension invocation. `run=5` is the two-derivation stand-in
        // (36-RESEARCH.md "Argon2id: the allocation is exact" -- pv-ffi
        // exports only the wrapping-key entry point today, so this is a
        // faithful stand-in for the two-derivation login path, never the
        // real one). scripts/ios-probe-run.sh's cold loop re-invokes this
        // SAME dispatch five further times, each from a fresh extension
        // launch; only each invocation's `run=1` line is genuinely cold
        // (36-04-PLAN.md Task 1 action).
        #if PV_PROBE_KDF
        for run in 1...5 {
            let derivations = (run == 5) ? 2 : 1
            let label = (derivations > 1) ? "standin" : "prod"
            KdfProbe.runProduction(run: run, derivations: derivations, label: label)
        }
        // Held open for Plan 36-04 Task 2 (E7): an independent
        // out-of-process reading needs the extension process to still be
        // alive to attach to (this task's own precondition). The main
        // thread stays busy for this whole window, so the process cannot
        // be torn down mid-hold.
        Thread.sleep(forTimeInterval: 20.0)
        #endif
    }
}
