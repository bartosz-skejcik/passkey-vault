//
//  PasskeyVaultApp.swift
//  PasskeyVault
//
//  Created by Bartłomiej Paczesny on 11/08/2026.
//

import SwiftUI
import os

@main
struct PasskeyVaultApp: App {
    // Phase 38, Plan 38-05: names AppSceneDelegate as the scene delegate so
    // sceneWillResignActive can install the app-switcher snapshot cover
    // before the OS takes its snapshot. See App/AppSceneDelegate.swift and
    // ios/IOS-SPIKE-LOG.md DR-38-D.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        #if DEBUG
        // Reproduction hook (`.planning/debug/faceid-unlock-loop.md`): forces `LockMarker`'s own
        // shared-container resolution to behave exactly as it does on Bartek's real device -- the
        // `application-groups` capability absent from the issued provisioning profile, so
        // `UserDefaults(suiteName:)` never resolves and `LockMarker.read()` returns `nil` on
        // EVERY call. MUST run before the very first `LockMarker.read()` two lines below, so even
        // the launch-time diagnostic log itself observes the forced-unresolvable path -- the
        // whole point is a repeatable, scriptable simulator reproduction of a symptom that
        // otherwise only reproduces on unentitled real hardware. Same `PV_UITEST_*` hook
        // convention as every other DEBUG-only test toggle in this file; a no-op unless a driving
        // script sets it.
        if ProcessInfo.processInfo.environment["PV_UITEST_FORCE_APP_GROUP_UNRESOLVABLE"] != nil {
            LockMarker.forceSharedContainerUnresolvableForTesting = true
        }
        #endif

        // Phase 41, Plan 41-07, Task 3 (E41-7's ACC-07 leg): PRODUCTION diagnostic, unconditional
        // and cheap (one UserDefaults read, no Keychain, no side effect) -- logs whichever
        // process most recently wrote the lock marker, on EVERY host-app launch. This is the
        // "host app's next launch reads a marker value the EXTENSION wrote" receiver-side
        // assertion target: the extension's own `SessionLifecycle.refreshActivity(writer:)` logs
        // `PVLOCK|stage=activity-refresh writer=extension` when IT writes; this line is the
        // matching read-side half, letting `scripts/ios-autofill-e41.sh e41-7` compare the two
        // WITHOUT the host needing to run a full re-unlock/routing cycle to observe it. Never
        // logs the marker's own numeric fields (T-41-38) -- only `writer` and whether the boot
        // session still matches.
        if let marker = LockMarker.read() {
            // `.planning/debug/faceid-relock-loop-bootsession.md`: `bootSessionId` is now
            // `Optional` -- a missing value on either side is NOT a match (a stricter reading
            // than plain `Optional` equality, which would treat two "unavailable"s as equal;
            // this diagnostic line specifically means "boot continuity is CONFIRMED", not
            // "neither side could tell either way").
            let bootMatches = marker.bootSessionId != nil && marker.bootSessionId == LockMarker.currentBootSessionId()
            Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill").log(
                "PVLOCK|stage=host-launch-read writer=\(marker.writer, privacy: .public) bootMatch=\(bootMatches, privacy: .public)"
            )
        } else {
            Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill").log("PVLOCK|stage=host-launch-read writer=none")
        }

        #if DEBUG
        // Phase 41, Plan 41-07, Task 3 (E41-7's own precondition: "the idle window can be
        // configured to a short value for the test run"). Same `PV_UITEST_*` hook convention as
        // every other DEBUG-only test toggle in this file. A no-op unless the driving script sets
        // it; writes through the REAL `AutoLockPolicy.write` (its own whitelist validation still
        // applies -- an out-of-whitelist value here is silently ignored, never persisted).
        if let raw = ProcessInfo.processInfo.environment["PV_UITEST_E41_7_IDLE_MINUTES"], let minutes = Int(raw) {
            AutoLockPolicy.write(minutes)
        }

        // Phase 42-era correction: `LaunchOfflineLockUITests`' own seed -- see
        // `OfflineLockUITestSeeder.swift`'s own header for why this MUST run here (before
        // `ContentView` is ever constructed) rather than from `ContentView`'s own DEBUG block.
        // Same `PV_UITEST_*` hook convention; this one's value IS the payload (the unreachable
        // server address), not just a presence flag -- same shape as
        // `PV_UITEST_E41_7_IDLE_MINUTES` immediately above.
        if let serverURLString = ProcessInfo.processInfo.environment["PV_UITEST_OFFLINE_LOCK_SEED"] {
            OfflineLockUITestSeeder.seed(serverURLString: serverURLString)
        }
        #endif

        // Phase 36, Plan 36-02, Task 2 (E3): seed the shared keychain item
        // BEFORE the extension is ever invoked, so a launch of this app is
        // always the first half of the ordered host-then-extension sequence
        // AutoFillInvocationUITests drives for the keychain probe. Compiled
        // in only under PV_PROBE_KEYCHAIN -- inert for every other probe.
        #if PV_PROBE_KEYCHAIN
        ProbeSeeder.seed()
        #endif

        // Phase 41, Plan 41-01, Task 2 (E41-1): seed the REAL Phase-37 User
        // Key envelope, through UkEnvelopeStore.store(_:) itself, BEFORE the
        // extension is ever invoked -- same ordered host-then-extension
        // sequence PV_PROBE_KEYCHAIN's own seed above already established.
        // Compiled in only under PV_PROBE_SESSIONKEY -- inert for every
        // other probe. See SessionKeyProbeSeeder.swift's own header for why
        // this deviates from files_modified (Rule 2, deviation documented in
        // 41-01-SUMMARY.md).
        #if PV_PROBE_SESSIONKEY
        SessionKeyProbeSeeder.seed()
        #endif

        // Phase 41, Plan 41-03, Task 1 (the tracer): seed Secret C, a real host-app unlock
        // marker, ONE real encrypted login item in the Phase-39 cache, and ONE registered
        // identity -- BEFORE the extension is ever invoked, same ordered host-then-extension
        // sequence PV_PROBE_KEYCHAIN/PV_PROBE_SESSIONKEY's own seeds already established.
        // Compiled in only under PV_PROBE_FILLTRACER -- inert for every other probe. See
        // TracerFillSeeder.swift's own header for why this deviates from files_modified (Rule 2,
        // deviation documented in 41-03-SUMMARY.md).
        #if PV_PROBE_FILLTRACER
        Task {
            await TracerFillSeeder.seed()
            // Phase 41, Plan 41-06, Task 1 (F5's fourth boundary): the host-side half of the
            // encoding proof, dispatched INSIDE this same Task, after seed()'s own await --
            // never a separately-scheduled Task, which would race the cache write this probe
            // reads back. See CacheEncodingProbe.swift's own header for why this deviates from
            // files_modified (Rule 2, documented in 41-06-SUMMARY.md). Compiled in only under
            // PV_PROBE_CACHE_ENCODING -- inert for every other probe.
            #if PV_PROBE_CACHE_ENCODING
            CacheEncodingProbe.run()
            #endif
        }
        #endif

        // Phase 41, Plan 41-04, Task 2 (E41-2): the receiver-side round trip plus both mandatory
        // negative controls -- see `IdentityStoreSyncProbe.swift`'s own header for why this
        // deviates from files_modified (Rule 2, documented in 41-04-SUMMARY.md). Compiled in only
        // under `PV_PROBE_IDENTITYSTORE` -- inert for every other probe.
        #if PV_PROBE_IDENTITYSTORE
        Task {
            await IdentityStoreSyncProbe.runIfMarked()
        }
        #endif

        // Phase 41, Plan 41-07, Tasks 2/3 (E41-4/E41-7): seeds Secret A + one real cache item +
        // one identity -- see `LockE41Seeder.swift`'s own header for why Secret C/the lock
        // marker are deliberately NOT seeded here (Task 2/3's own point is proving the REAL
        // unlock path produces them). Compiled in only under `PV_PROBE_E41_LOCK` -- but gated a
        // SECOND time behind a RUNTIME env var, `PV_UITEST_E41_LOCK_SEED`: this compile flag is
        // baked into the binary for the WHOLE test run, so without a runtime toggle the seed
        // would re-run (with a FRESH `FfiUserKey`, invalidating Secret A/the cache) on EVERY
        // launch, including the second, "real unlock" launch this task's own tests deliberately
        // keep separate from the seeding launch -- the exact race this env-var gate exists to
        // prevent.
        #if PV_PROBE_E41_LOCK
        if ProcessInfo.processInfo.environment["PV_UITEST_E41_LOCK_SEED"] != nil {
            Task {
                await LockE41Seeder.seed()
            }
        }
        #endif

        // Phase 41, Plan 41-05, Task 1 (E41-3): registers three diagnostic identities (one
        // `.domain`, two `.URL` differing only by port) directly through `ASCredentialIdentityStore`,
        // bypassing `IdentityStoreSync` (see `MatchingProbe.swift`'s own header for why). Compiled
        // in only under `PV_PROBE_E41_3` -- inert for every other probe. Rule 2 deviation
        // (`MatchingProbe.swift` is not in 41-05-PLAN.md's `files_modified`), same class as
        // `IdentityStoreSyncProbe.swift`/`TracerFillSeeder.swift`'s own precedent -- documented in
        // 41-05-SUMMARY.md.
        #if PV_PROBE_E41_3
        Task {
            await MatchingProbe.runIfMarked()
        }
        #endif

        // Phase 41, Plan 41-08, Task 1 (E41-8/FILL-04): seeds a SECOND, independent item/identity
        // at a domain this product does not control at all -- BEFORE the extension is ever
        // invoked, same ordered host-then-extension sequence every other E41 seeder in this file
        // already establishes. Compiled in only under `PV_PROBE_E41_8` -- inert for every other
        // probe. See `TracerFillSeeder.seedThirdPartyDomain()`'s own header for why this deviates
        // from files_modified (Rule 2, documented in 41-08-SUMMARY.md).
        #if PV_PROBE_E41_8
        Task {
            await TracerFillSeeder.seedThirdPartyDomain()
        }
        #endif

        // Phase 43, Plan 43-03 (OPT-03): seeds Secret C + a real host-app unlock marker + ONE
        // real, genuinely fixture-registered passkey item into the Phase-39 cache -- BEFORE the
        // extension is ever invoked, same ordered host-then-extension sequence every other seeder
        // in this file already establishes. Compiled in only under `PV_PROBE_E43_TRACER` -- inert
        // for every other probe. See `PasskeyTracerSeeder.swift`'s own header for why this
        // deviates from files_modified (Rule 2, documented in 43-03-SUMMARY.md).
        #if PV_PROBE_E43_TRACER
        Task {
            await PasskeyTracerSeeder.seed()
        }
        #endif

        // Phase 43, Plan 43-07 (ROADMAP SC4): seeds a REAL, throwaway account against a LIVE
        // `pv-server` -- BEFORE the extension is ever invoked, same ordered host-then-extension
        // sequence every other seeder in this file already establishes. Compiled in only under
        // `PV_PROBE_E43_SC4` -- inert for every other probe. See
        // `PasskeyRegistrationSc4Seeder.swift`'s own header for why this deviates from
        // files_modified (Rule 2, documented in 43-07-SUMMARY.md).
        #if PV_PROBE_E43_SC4
        Task {
            await PasskeyRegistrationSc4Seeder.seed()
        }
        #endif

        // Phase 43, Plan 43-09 (ROADMAP SC5, direction 2 -- "extension creates -> iOS asserts"):
        // signs IN (never registers) to an account interop's Node-side create step already
        // populated with one real, server-visible passkey item, then drives the SAME production
        // VaultStore.refresh() ContentView itself calls -- a REAL sync pull, not a hand-staged
        // single-item cache write. BEFORE the extension is ever invoked, same ordered
        // host-then-extension sequence every other seeder in this file already establishes.
        // Compiled in only under `PV_PROBE_E43_INTEROP` -- inert for every other probe. See
        // `PasskeyInteropSeeder.swift`'s own header for why this deviates from files_modified
        // (Rule 2, documented in 43-09-SUMMARY.md).
        #if PV_PROBE_E43_INTEROP
        Task {
            await PasskeyInteropSeeder.seed()
        }
        #endif

        // Phase 38, Plan 38-07, Task 3 (E-C1): writes a marker through the
        // REAL `ClipboardService.shared.copy` path -- the exact production
        // call `ItemDetailView`'s copy handlers make -- as the FIRST thing
        // this process does, so an external driver can `simctl terminate`
        // it moments later (arm C) without racing any other app startup
        // work. Compiled into DEBUG builds only; inert unless this exact
        // env var is set, matching this repo's established
        // `PV_UITEST_*`/`PV_PROBE_*` hook convention (`ContentView.swift`'s
        // `PV_UITEST_SCREEN`, `ProbeSeeder`'s own gate).
        #if DEBUG
        if let marker = ProcessInfo.processInfo.environment["PV_UITEST_CLIPBOARD_COPY_MARKER"] {
            let seconds = ProcessInfo.processInfo.environment["PV_UITEST_CLIPBOARD_SECONDS"]
                .flatMap(Int.init) ?? ClipboardSettings.minSeconds
            if ProcessInfo.processInfo.environment["PV_UITEST_CLIPBOARD_DISABLE_BOTH_MECHANISMS"] != nil {
                // Arm E (falsification), mandatory: a write with NEITHER
                // mechanism set -- no `expirationDate`, no in-app timer at
                // all. If arms B/C still show the marker gone after this
                // path, the observer is not watching what E-C1 thinks it
                // is, and every other arm's green is void.
                UIPasteboard.general.setObjects([marker], localOnly: true, expirationDate: nil)
            } else {
                ClipboardService.shared.copy(marker, fieldLabel: "E-C1", seconds: seconds)
            }
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            // Plan 44-05, Task 2 (SAVE-04 direct-invocation fallback, `GeneratePasswordOfferPreviewHost
            // .swift`'s own header): swaps the ENTIRE root view for a direct render of the real
            // `GeneratePasswordOfferView` -- compiled in only under `PV_PROBE_E44_05_OFFER`, inert
            // for every other build (never reachable in a real user session).
            #if PV_PROBE_E44_05_OFFER
            GeneratePasswordOfferPreviewHost()
            #elseif PV_PROBE_E44_04_CONFIRM
            // Plan 44-04, Task 3 (SAVE-04 direct-invocation route, `SavePasswordConfirmPreviewHost
            // .swift`'s own header): swaps the ENTIRE root view for a direct render of the real
            // `SavePasswordConfirmView` -- compiled in only under `PV_PROBE_E44_04_CONFIRM`, inert
            // for every other build (never reachable in a real user session).
            SavePasswordConfirmPreviewHost()
            #else
            ContentView()
                .snapshotCoverOverlay()
            #endif
        }
    }
}
