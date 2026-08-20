//
//  PasskeyVaultApp.swift
//  PasskeyVault
//
//  Created by Bartłomiej Paczesny on 11/08/2026.
//

import SwiftUI

@main
struct PasskeyVaultApp: App {
    // Phase 38, Plan 38-05: names AppSceneDelegate as the scene delegate so
    // sceneWillResignActive can install the app-switcher snapshot cover
    // before the OS takes its snapshot. See App/AppSceneDelegate.swift and
    // ios/IOS-SPIKE-LOG.md DR-38-D.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
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
            ContentView()
                .snapshotCoverOverlay()
        }
    }
}
