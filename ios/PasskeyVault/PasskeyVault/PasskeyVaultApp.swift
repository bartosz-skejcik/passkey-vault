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
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .snapshotCoverOverlay()
        }
    }
}
