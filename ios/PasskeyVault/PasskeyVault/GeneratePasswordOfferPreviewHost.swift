//
//  GeneratePasswordOfferPreviewHost.swift
//  PasskeyVault
//
//  Plan 44-05, Task 2 (SAVE-04 direct-invocation fallback). Live evidence
//  (44-05-SUMMARY.md): `prepareInterface(for: ASGeneratePasswordsRequest)` -- the interactive
//  generate-password entry point -- does NOT fire under the one driveable trigger this toolchain
//  offers (the QuickType "Strong Password" affordance always routes to the SILENT
//  `performWithoutUserInteraction(generatePasswordsRequest:)` entry point instead, which completes
//  directly with no UI). This is the plan's own pre-authorized "direct invocation from a host-side
//  test target" fallback (mirrors 44-04 Task 3's equivalent `did-not-fire` branch) -- this host
//  renders the EXACT production `GeneratePasswordOfferView` (`Shared/GeneratePasswordOfferView.swift`,
//  moved there for exactly this reason) so `scripts/ios-autofill-e44.sh sc-generate`'s own SAVE-04
//  pixel proof can still be captured, with the explicit disclosure that system routing into the
//  real extension override is UNPROVEN for this specific screen -- never claimed as if the live
//  system path had been exercised.
//
//  Compiled in only under `PV_PROBE_E44_05_OFFER` -- inert for every other build, same convention
//  as every other `PV_PROBE_*` seeder in `PasskeyVaultApp.swift`.
//

import SwiftUI

#if DEBUG || PV_PROBE_E44_05_OFFER
struct GeneratePasswordOfferPreviewHost: View {
    /// A fixed candidate matching `SavePasswordFormView`'s own rules descriptor
    /// (`minlength: 10; maxlength: 20; required: lower; required: upper; required: digit;`) --
    /// this host does NOT call `pv-ffi` itself (Task 1's `GeneratePasswordDispatchTests` already
    /// proves the dispatch logic live, against real `pv-ffi`); this screen exists ONLY to prove
    /// the VIEW renders real PV tokens, not to re-prove generation.
    private static let previewCandidate = "Tr4c3rGener8ted"

    var body: some View {
        GeneratePasswordOfferView(
            candidate: Self.previewCandidate,
            onUse: {},
            onCancel: {}
        )
    }
}
#endif
