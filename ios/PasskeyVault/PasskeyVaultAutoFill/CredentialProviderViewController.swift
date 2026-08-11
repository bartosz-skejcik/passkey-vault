// CredentialProviderViewController.swift -- Phase 36, Plan 36-01, Task 1.
//
// Tracer skeleton ONLY -- no credential-list logic, no fetching, no storage
// (36-01-PLAN.md Task 1 action). Overrides ONLY the current, non-deprecated
// overloads (`for: any ASCredentialRequest`), never the
// `ASPasswordCredentialIdentity`-typed pair the shipped Xcode 26.6 template
// walks straight into (Pitfall 7, 36-RESEARCH.md): that pair compiles,
// appears in the UI, and silently never fills.
//
// Every override calls MemoryProbe.emit(stage:) with a FIXED stage string --
// this four-word vocabulary (`list`/`silent`/`interactive`/`configure`) is
// the whole vocabulary this phase emits; nothing else may use the PVPROBE|
// marker. Every override except the configuration entry point then
// completes via cancelRequest(withError:) carrying
// ASExtensionErrorCode.userInteractionRequired -- this phase deliberately
// fills nothing.

import AuthenticationServices

final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        MemoryProbe.emit(stage: "list")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "silent")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "interactive")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
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
    }
}
