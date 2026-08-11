//
//  PasskeyVaultApp.swift
//  PasskeyVault
//
//  Created by Bartłomiej Paczesny on 11/08/2026.
//

import SwiftUI

@main
struct PasskeyVaultApp: App {
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
        }
    }
}
