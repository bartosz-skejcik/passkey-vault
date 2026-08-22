// PasskeyVaultHarnessApp.swift -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan 43-08,
// Task 1.
//
// TEST-ONLY. `PasskeyVaultHarness` is NEVER distributed -- not to TestFlight, not to the App
// Store, not archived for Release (it inherits this project's Debug-only mandate the same way
// every other Phase 43 harness does, and carries no Release configuration of its own). Its ONE
// job is to prove ROADMAP SC2: that a real, native, third-party-shaped app (the "GitHub app"
// case, named first and by name by the product owner), using the system's OWN
// `ASAuthorizationController` sign-in flow -- never Safari, never this project's own shipping
// app -- offers Passkey Vault's passkey and completes the ceremony, verified independently by
// `crates/rp-fixture`'s own real `webauthn-rs` check. Mirrors `crates/rp-fixture`'s own
// "test-only, not shipped" header discipline (see `crates/rp-fixture/src/main.rs`'s module doc).
//
// Bundle id `cloud.blonie.PasskeyVaultHarness` -- a genuinely distinct, separately-registered
// bundle id, never a rename or reconfiguration of the shipping `cloud.blonie.PasskeyVault`
// (43-08-PLAN.md's own prohibition). Carries ONLY the `com.apple.developer.associated-domains`
// entitlement (`webcredentials:vault.blonie.cloud`, see `PasskeyVaultHarness.entitlements`) --
// no `autofill-credential-provider` entitlement (this app REQUESTS a passkey, it does not
// PROVIDE one), no App Group (shares no storage with the shipping app by design).

import SwiftUI

@main
struct PasskeyVaultHarnessApp: App {
    init() {
        // Unbuffered stdout: `scripts/ios-autofill-e43.sh native-app` polls THIS process's own
        // stdout (captured via `xcrun simctl launch --stdout=<path>`) for `PVHARNESS|` markers.
        // C stdio fully-buffers a non-tty stream by default -- without this, `print()` output
        // could sit in a libc buffer indefinitely (this app never exits on its own, so there is
        // no natural flush-on-exit point the polling script can wait for).
        setvbuf(stdout, nil, _IONBF, 0)
    }

    var body: some Scene {
        WindowGroup {
            // `.planning/debug/passkey-reg-blank-sheet-discord.md` diagnostic, 2026-08-22: both the
            // ORIGINAL sign-in (ASSERTION, SC2) and the NEW create (REGISTRATION) surfaces live on
            // the SAME screen -- `NativeSignInView`'s own accessibility identifiers
            // (`nativeSignIn.button`/`nativeSignIn.status`) are unchanged, so
            // `NativeAppSignInUITests` keeps working unmodified.
            VStack(spacing: 32) {
                NativeSignInView()
                Divider()
                NativeCreateView()
            }
        }
    }
}
