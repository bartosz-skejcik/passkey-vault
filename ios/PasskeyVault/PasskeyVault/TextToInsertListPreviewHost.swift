//
//  TextToInsertListPreviewHost.swift
//  PasskeyVault
//
//  Plan 44-06, Task 2 (SAVE-04 direct-invocation route). Serves TWO roles, mirroring
//  `GeneratePasswordOfferPreviewHost.swift`/`SavePasswordConfirmPreviewHost.swift`'s own
//  established shape exactly:
//
//  1. The mandatory RED-control leg (44-PLAN-CHECK.md W4) -- a cheap, standalone render this
//     task's own `sc-insert` subcommand can rebuild/screenshot/revert without re-running the
//     entire live drive a second time just to capture a deliberately-broken render.
//  2. The plan's own pre-authorized `did-not-fire` GREEN fallback, since this surface's own
//     history (`ios/IOS-SPIKE-LOG.md`: never observed to fire, Plan 44-03) repeats in this plan's
//     own live attempt -- renders the EXACT production `TextToInsertListView`
//     (`Shared/TextToInsertListView.swift`, placed there from the start for exactly this reason)
//     so SAVE-04's pixel proof can still be captured, with the explicit disclosure that system
//     routing is UNPROVEN for this screen -- never claimed as if the live system path had been
//     exercised.
//
//  The fixture candidate below uses the SAME RFC 6238 SHA1 literal secret
//  (`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`) `TotpFfiTests.swift`/`TextToInsertDispatchTests.swift`
//  already trust -- this host does NOT prove generation correctness a second time (Task 1's own
//  `TextToInsertDispatchTests.swift` already does, against real `pv-ffi`); it exists ONLY to prove
//  the VIEW renders real PV tokens and that a genuine on-screen tap drives a genuine,
//  freshly-recomputed `completeTextToInsert`-equivalent call -- captured via the SAME
//  `UserDefaults`-persisted ground-truth convention `SavePasswordFormView.swift`'s own
//  `.onChange(of:)` capture already establishes (T-44-06: never a public `os_log` line for the
//  live code).
//
//  Compiled in only under `PV_PROBE_E44_06_INSERT` -- inert for every other build, same convention
//  as every other `PV_PROBE_*` seeder/preview host in `PasskeyVaultApp.swift`.
//

import SwiftUI

#if DEBUG || PV_PROBE_E44_06_INSERT
struct TextToInsertListPreviewHost: View {
    private static let previewCandidate = TextToInsertDispatch.Candidate(
        itemId: "pv-e44-06-preview-item",
        name: "PV Preview TOTP",
        secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA1",
        digits: 8,
        period: 30
    )

    var body: some View {
        TextToInsertListView(
            items: [Self.previewCandidate],
            onSelect: { candidate in
                // Mirrors `completeTextToInsert`'s own selection-time recompute exactly (the SAME
                // `TextToInsertDispatch.freshCode` call) -- captured to `UserDefaults` (never a
                // public log line, T-44-06) so `scripts/ios-autofill-e44.sh sc-insert` can read it
                // back and compare against an independent RFC 6238 oracle for the SAME timestamp.
                let now = UInt64(max(0, Date().timeIntervalSince1970))
                if case let .success(result) = TextToInsertDispatch.freshCode(for: candidate, at: now) {
                    UserDefaults.standard.set(result.code, forKey: "pv-e44-06-sc-insert-observed-code")
                    UserDefaults.standard.set(Int(now), forKey: "pv-e44-06-sc-insert-observed-time")
                    // `SavePasswordFormView.swift`'s own established precedent (T-44-06's ground-
                    // truth-capture convention) explicitly synchronizes rather than relying on
                    // `UserDefaults`' own opportunistic background flush -- the driving script
                    // reads this plist back within milliseconds of the tap completing.
                    UserDefaults.standard.synchronize()
                }
            }
        )
    }
}
#endif
