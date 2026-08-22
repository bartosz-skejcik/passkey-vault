//
//  SavePasswordConfirmPreviewHost.swift
//  PasskeyVault
//
//  Plan 44-04, Task 3 (SAVE-04 direct-invocation route). Serves TWO roles, mirroring
//  `GeneratePasswordOfferPreviewHost.swift`'s own established shape exactly:
//
//  1. The mandatory RED-control leg (44-PLAN-CHECK.md W4) -- a cheap, standalone render this
//     task's own `sc-save` subcommand can rebuild/screenshot/revert WITHOUT re-running the entire
//     live save flow (real server, real seeded session, real "Strong Password" affordance drive)
//     a second time just to capture a deliberately-broken render.
//  2. The plan's own pre-authorized `did-not-fire` GREEN fallback, if live system routing into
//     `prepareInterface(for: ASSavePasswordRequest)` is never observed on this toolchain (the exact
//     shape 44-05-SUMMARY.md already recorded for the sibling generate-offer screen) -- renders the
//     EXACT production `SavePasswordConfirmView` (`Shared/SavePasswordConfirmView.swift`, moved
//     there for exactly this reason) so SAVE-04's pixel proof can still be captured, with the
//     explicit disclosure that system routing is UNPROVEN for this screen -- never claimed as if
//     the live system path had been exercised.
//
//  Compiled in only under `PV_PROBE_E44_04_CONFIRM` -- inert for every other build, same convention
//  as every other `PV_PROBE_*` seeder in `PasskeyVaultApp.swift`.
//

import SwiftUI

#if DEBUG || PV_PROBE_E44_04_CONFIRM
struct SavePasswordConfirmPreviewHost: View {
    var body: some View {
        SavePasswordConfirmView(
            serviceIdentifier: "sc-save-preview.invalid",
            username: "pv-e44-04-sc-save-user",
            onConfirm: {},
            onCancel: {}
        )
    }
}
#endif
