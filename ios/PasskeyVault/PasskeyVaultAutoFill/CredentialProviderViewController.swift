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
import Foundation
import UIKit
import os

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
        // Phase 39, Plan 39-07, Task 2 (SYNC-04): the AutoFill surface's own
        // last-synced line -- UNCONDITIONAL, never behind a `PV_PROBE_*`
        // flag, because a real user's config screen must say this every
        // time, not only during an evidence run. See `renderFreshnessSurface()`'s
        // own header for why this is production behaviour, not a probe.
        renderFreshnessSurface()
        // Phase 39, Plan 39-07, Task 1/2 (SYNC-02/SYNC-04): the cold-read
        // proof sequence -- gated, diagnostic-only, driven exclusively by
        // `scripts/ios-cold-read-proof.sh`.
        #if PV_PROBE_COLDREAD
        runColdReadEvidenceSequence()
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

    // MARK: - Phase 39, Plan 39-07, Task 2 -- the AutoFill surface's own
    // last-synced line (SYNC-04)

    /// PRODUCTION behaviour, not a probe: renders `PvShared/SyncFreshness`'s
    /// own string -- the SAME formatter `SyncStatusView` (host app) uses,
    /// never a second implementation -- sourced from the snapshot's own
    /// `syncedAtMs` via `CacheColdReadProbe.currentSyncedAtMs()`, never from
    /// a value computed in the extension and never from a connection state
    /// (this extension holds no connection at all in this milestone,
    /// `39-RESEARCH.md` "Freshness (SYNC-04)"). `reference: Date()` -- "now"
    /// -- exactly like the host's own production call site
    /// (`SyncStatusView.body`'s default), because a real user's config
    /// screen has no reason to pin anything.
    ///
    /// The copy is intentionally IDENTICAL to the host's: `SyncFreshness
    /// .neverSyncedText`/the "Last synced …" phrase never imply the
    /// extension refreshed anything -- it renders whatever the HOST last
    /// wrote, which is the honest, and only, thing it can say (SYNC-05).
    /// WR-06 (39-REVIEW.md): a stored reference, installed AT MOST once --
    /// `prepareInterfaceForExtensionConfiguration()` can be called more than
    /// once on a reused view controller instance, and the pre-fix version
    /// created, added and constrained a brand-new `UILabel` on every call,
    /// leaving every previous one in place (overlapping text, an
    /// ever-growing constraint set).
    private lazy var lastSyncedLabel: UILabel = {
        let label = UILabel()
        label.font = .preferredFont(forTextStyle: .body)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.accessibilityIdentifier = "autofill.lastSynced"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private func renderFreshnessSurface() {
        let syncedAtMs = CacheColdReadProbe.currentSyncedAtMs()
        let rendered = SyncFreshness.describe(syncedAtMs: syncedAtMs, reference: Date())

        if lastSyncedLabel.superview == nil {
            view.backgroundColor = .systemBackground
            view.addSubview(lastSyncedLabel)
            NSLayoutConstraint.activate([
                lastSyncedLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                lastSyncedLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                lastSyncedLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
                lastSyncedLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16),
            ])
        }
        lastSyncedLabel.text = rendered

        Self.probeLogger.log("PVPROBE|stage=freshness rendered=\(rendered, privacy: .public)")
    }

    private static let probeLogger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    #if PV_PROBE_COLDREAD
    /// Driven exclusively by `scripts/ios-cold-read-proof.sh`. ONE real
    /// extension invocation, sequential holds, the driving script mutating
    /// the App Group container DURING each hold (the SAME "external
    /// inspection races an in-process sleep" shape `EnforcementProbe`/
    /// `KdfProbe` already established, 36-03/36-04) -- never a second
    /// `xcodebuild test` invocation per control, which the provider-switch
    /// toggle's own ON/OFF election-state flip (`ios-probe-run.sh`'s own
    /// header) would make expensive and order-fragile.
    ///
    /// Order matters: the SAME-snapshot freshness comparison (Task 2's
    /// primary claim) MUST run BEFORE the deleted-cache control below
    /// disturbs the file the host actually wrote.
    private func runColdReadEvidenceSequence() {
        let logger = Self.probeLogger
        let pinnedReference = Self.pinnedEvidenceReference()

        // Task 1 primary (E-C1/E-C3): positive read + wrong-identifier
        // negative control, against whatever the host wrote before this
        // invocation. Marker file is the driving script's own coordination
        // signal (`ColdReadOutcome`'s own header) -- polled for EXISTENCE,
        // never raced against `log stream`'s attach latency.
        let outcome1 = CacheColdReadProbe.runPositiveAndNegativeControl()
        CacheColdReadProbe.writeMarker(outcome1, name: "coldread-evidence-1.json")

        // Task 2 primary: the freshness comparison, against the SAME
        // snapshot the positive read above just proved reachable -- a
        // PINNED, externally-supplied reference (never `Date()` here),
        // because two independent process captures separated by however
        // long a real cold-read proof takes cannot be compared through two
        // independent "now" reads without a wall-clock race (unlike
        // `renderFreshnessSurface()`'s own production call, which has no
        // second process to stay in lockstep with).
        Self.logFreshness(logger: logger, reference: pinnedReference, markerName: "freshness-evidence-1.txt")

        // HOLD 1: the driving script deletes the cache file DURING this
        // window, triggered by `coldread-evidence-1.json`/
        // `freshness-evidence-1.txt` appearing -- never a blind race.
        Thread.sleep(forTimeInterval: 6.0)
        let outcome2 = CacheColdReadProbe.runPositiveAndNegativeControl() // Task 1's deleted-cache control: expect status=absent
        CacheColdReadProbe.writeMarker(outcome2, name: "coldread-evidence-2.json")

        // HOLD 2: the driving script overwrites the cache with a DIFFERENT
        // `syncedAtMs` DURING this window -- the control that makes "SAME"
        // above mean something (D-06/D-08).
        Thread.sleep(forTimeInterval: 6.0)
        Self.logFreshness(logger: logger, reference: pinnedReference, markerName: "freshness-evidence-2.txt") // Task 2's control: expect DIFFERENT

        // Settle margin for the driving script's own final marker/log read.
        Thread.sleep(forTimeInterval: 3.0)
    }

    private static func logFreshness(logger: Logger, reference: Date, markerName: String) {
        let syncedAtMs = CacheColdReadProbe.currentSyncedAtMs()
        let rendered = SyncFreshness.describe(syncedAtMs: syncedAtMs, reference: reference)
        logger.log("PVPROBE|stage=\(markerName, privacy: .public) rendered=\(rendered, privacy: .public)")
        CacheColdReadProbe.writeMarker(text: rendered, name: markerName)
    }

    /// Reads the epoch-ms literal the driving script wrote into the App
    /// Group container BEFORE this invocation -- the coordination channel
    /// that makes a byte-for-byte cross-process string comparison
    /// meaningful without racing two independent `Date()` reads taken
    /// however many minutes apart a real cold-read proof needs (this
    /// method's own caller's header). Falls back to `Date()` only if the
    /// file is absent -- a normal, non-evidence launch never has it, and
    /// this whole method only runs under `PV_PROBE_COLDREAD` regardless.
    private static func pinnedEvidenceReference() -> Date {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
            ),
            let raw = try? String(
                contentsOf: containerURL.appendingPathComponent("freshness-reference.txt"), encoding: .utf8
            ),
            let ms = Int64(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        else {
            return Date()
        }
        return Date(timeIntervalSince1970: Double(ms) / 1000)
    }
    #endif
}
