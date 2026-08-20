//
//  IdentityStoreSyncProbe.swift
//  PasskeyVault
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-04, Task 2 (E41-2).
//  Host-side evidence probe: exercises the REAL `IdentityStoreSync.republish` entry point (never
//  a mock) for the positive round trip and both mandatory negative controls, logging every result
//  via `os_log` (`PVFILL|E41-2|...`) so `scripts/ios-autofill-e41.sh e41-2` can capture and
//  parse it -- the SAME "driving script places a marker file into the App Group container BEFORE
//  launch" discipline `TracerFillSeeder.swift` already established (an env var forwarded through
//  `XCUIApplication.launchEnvironment` was observed live NOT to reach this process, per that
//  file's own header).
//
//  landmine L-34 (`ios/IOS-SPIKE-LOG.md` §3): `credentialIdentities(forService:credentialIdentityTypes:)`
//  -- the receiver-side READ API this task's own must_haves specify as the primary proof -- was
//  found LIVE, this session, to return an EMPTY set on this simulator/toolchain, unconditionally,
//  regardless of a confirmed-successful, confirmed-DURABLE prior `saveCredentialIdentities` call
//  (proven durable via a REAL system QuickType sheet, screenshotted, showing the exact registered
//  username). The read failure reproduces from the host process, the extension process, with
//  `.password`/`[]` (all-types) filters, with an explicit or `nil` service identifier, and after
//  up to 15 seconds of polling. This is a SIMULATOR-SPECIFIC limitation of the read API, not a
//  bug in `IdentityStoreSync`'s write path (see L-34's own entry for the full isolation sequence,
//  including the raw, `IdentityStoreSync`-bypassing minimal reproduction). Consequence for this
//  file: the receiver-side proof for runs 1 and 3 is the REAL QuickType sheet's own text,
//  captured by `AutoFillIdentityStoreUITests` (a DIFFERENT process, reading Safari's accessibility
//  tree -- this probe cannot see that UI at all), never this API. The API is still attempted here,
//  best-effort, logged for forward-compatibility with a real device (where it may well work), but
//  NEVER gates pass/fail.
//
//  DEVIATION (Rule 2, GSD executor rules): 41-04-PLAN.md's own `files_modified` list does not
//  name this file. Without a host-side probe, Task 2's own runs have nowhere to execute from --
//  `AutoFillIdentityStoreUITests` can only DRIVE the host app/Safari, it cannot itself call
//  `IdentityStoreSync` (a different process, no App Group entitlement on the test runner).
//  Documented here and in 41-04-SUMMARY.md, matching `TracerFillSeeder.swift`'s own precedent for
//  the identical class of deviation.
//
//  Compiled in only under `PV_PROBE_IDENTITYSTORE` -- inert for every other build.
//

import AuthenticationServices
import Foundation
import os

enum IdentityStoreSyncProbe {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")
    private static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    /// A username string that exists NOWHERE else on the simulator (Pitfall 6,
    /// `41-RESEARCH.md`) -- the discriminator that makes a QuickType suggestion attributable to
    /// OUR provider, matching `TracerFillSeeder.tracerUsername`'s own discipline but a DISTINCT
    /// string so the two probes' identities never collide.
    static let username = "e412-probe-83f1@pv.test"
    static let mutatedUsername = "e412-probe-83f1-MUTATED@pv.test"
    static let itemId = "e41-2-probe-item"
    /// The tracer's own local login-form server (`scripts/ios-autofill-e41.sh`'s `ensure_tracer_server`,
    /// 127.0.0.1:8765) -- reused rather than a second server, so QuickType has a REAL, reachable
    /// page to match against (F3, `41-RESEARCH.md`: `.domain` matching is host-based; a page with
    /// no host, e.g. `data:`, can never match).
    static let serviceURL = "http://127.0.0.1:8765"

    private static let markerPositive = "e41-2-run-positive.marker"
    private static let markerNegative1 = "e41-2-run-negative1.marker"
    private static let markerNegative2Mutate = "e41-2-run-negative2-mutate.marker"
    private static let markerNegative2Fix = "e41-2-run-negative2-fix.marker"

    private static func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupIdentifier)
    }

    private static func markerExists(_ name: String) -> Bool {
        guard let url = containerURL()?.appendingPathComponent(name) else { return false }
        return FileManager.default.fileExists(atPath: url.path)
    }

    /// Checked on every launch under `PV_PROBE_IDENTITYSTORE` -- a no-op (cheap file-exists
    /// checks) unless the driving script placed a marker BEFORE this launch. Exactly one marker
    /// is expected per launch (the driving script's own discipline); if more than one is present
    /// they run in this fixed order.
    static func runIfMarked() async {
        if markerExists(markerPositive) {
            await runPositive()
        }
        if markerExists(markerNegative1) {
            await runNegative1()
        }
        if markerExists(markerNegative2Mutate) {
            await runNegative2Mutate()
        }
        if markerExists(markerNegative2Fix) {
            await runNegative2Fix()
        }
    }

    // MARK: - Run 1: the positive round trip

    private static func runPositive() async {
        // Clears any identity left over from a PRIOR session/build (this project's identity
        // store is durable across reinstalls, L-34's own finding) -- so the QuickType sheet
        // Safari shows afterward is unambiguously attributable to THIS run's write, never a
        // stale entry from an earlier evidence session (Pitfall 6).
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()

        // Pre-check (this task's own acceptance criteria: "confirmed absent from the simulator's
        // own saved-passwords store before the run"). Best-effort via the same read API L-34
        // documents as unreliable on this simulator -- logged, never gating.
        let precheck = await bestEffortReadback(recordIdentifier: itemId)
        logger.log("PVFILL|E41-2|run=positive stage=precheck status=\(precheck == nil ? "absent" : "already-present", privacy: .public)")

        let source = VaultIdentitySource(itemId: itemId, username: username, urls: [serviceURL])
        let writeResult = await IdentityStoreSync.republish(sources: [source])
        guard case .success = writeResult else {
            logger.log("PVFILL|E41-2|run=positive stage=write status=fail")
            return
        }
        logger.log("PVFILL|E41-2|run=positive stage=write status=ok")

        // Best-effort API readback -- L-34: expected to report absent on THIS simulator even
        // though the write is real and durable (proven by `AutoFillIdentityStoreUITests`' own
        // Safari-driven QuickType check, a DIFFERENT process). Logged for forward-compatibility
        // with a real device; never the pass/fail gate.
        let match = await bestEffortReadback(recordIdentifier: itemId)
        if let match, match.user == username, match.recordIdentifier == itemId {
            logger.log("PVFILL|E41-2|run=positive stage=api-readback status=ok (informational, not the gate -- see L-34)")
        } else {
            logger.log("PVFILL|E41-2|run=positive stage=api-readback status=empty (expected on this simulator -- L-34; QuickType is the real proof)")
        }
    }

    // MARK: - Run 2: the first negative control (disabled store)

    private static func runNegative1() async {
        let source = VaultIdentitySource(itemId: itemId, username: username, urls: [serviceURL])
        let writeResult = await IdentityStoreSync.republish(sources: [source])
        switch writeResult {
        case .success:
            // Falsifiable by construction (this task's own acceptance criteria): re-running this
            // SAME probe with the provider left ENABLED lands here, not in `.storeDisabled` below
            // -- the harness's own assertion (`assert_e41_2`) requires the disabled-status line,
            // so this branch alone makes the harness FAIL, proving the control is not a rubber
            // stamp.
            logger.log("PVFILL|E41-2|run=negative1 stage=write status=unexpected-success")
        case .failure(.storeDisabled):
            logger.log("PVFILL|E41-2|run=negative1 stage=write status=store-disabled")
        case let .failure(other):
            logger.log("PVFILL|E41-2|run=negative1 stage=write status=other-failure detail=\(other.description, privacy: .public)")
        }
    }

    // MARK: - Run 3: the second negative control (a mutation that skips the choke point)
    //
    // Split into two marker-gated stages, each its own process launch, because the RECEIVER-SIDE
    // proof (L-34) is Safari's own QuickType sheet, captured by a DIFFERENT process
    // (`AutoFillIdentityStoreUITests`) that must run BETWEEN the two stages -- the driving script
    // (`scripts/ios-autofill-e41.sh e41-2`) sequences: mutate-stage launch -> Safari check
    // (asserts the OLD username) -> fix-stage launch -> Safari check again (asserts the NEW
    // username).

    /// Establishes the "before" state: a clean store (no leftover identity from a prior session)
    /// carrying ONLY the ORIGINAL `username` -- i.e., the state as it would be immediately after
    /// the REAL choke point ran once. Then logs the "skip the choke point" event -- deliberately
    /// does NOT call `IdentityStoreSync.republish` with `mutatedUsername` here; nothing routes a
    /// vault mutation to the choke point at this point, which is precisely the trap (T-41-17).
    private static func runNegative2Mutate() async {
        try? await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
        let baseline = VaultIdentitySource(itemId: itemId, username: username, urls: [serviceURL])
        _ = await IdentityStoreSync.republish(sources: [baseline])
        logger.log(
            "PVFILL|E41-2|run=negative2 stage=bypass-mutate status=ok skippedChokePoint=true newUsername=\(mutatedUsername, privacy: .public)"
        )
    }

    /// The follow-up choke-point invocation -- "restore consistency" (this task's own action
    /// text). Both halves are required: the mutate stage above (plus the driving script's OWN
    /// Safari check in between) shows the trap is real; this shows the fix reaches the
    /// user-visible surface.
    private static func runNegative2Fix() async {
        let fixSource = VaultIdentitySource(itemId: itemId, username: mutatedUsername, urls: [serviceURL])
        let result = await IdentityStoreSync.republish(sources: [fixSource])
        switch result {
        case .success:
            logger.log("PVFILL|E41-2|run=negative2 stage=fix status=ok")
        case let .failure(error):
            logger.log("PVFILL|E41-2|run=negative2 stage=fix status=fail detail=\(error.description, privacy: .public)")
        }
    }

    // MARK: - Best-effort API readback (L-34: informational only, never the pass/fail gate)

    private static func bestEffortReadback(recordIdentifier: String) async -> ASPasswordCredentialIdentity? {
        let identities = await ASCredentialIdentityStore.shared.credentialIdentities(
            forService: nil, credentialIdentityTypes: .password
        )
        return identities.first {
            ($0 as? ASPasswordCredentialIdentity)?.recordIdentifier == recordIdentifier
        } as? ASPasswordCredentialIdentity
    }
}
