//
//  SnapshotCover.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-05 -- the app-switcher snapshot
//  cover. Read ios/IOS-SPIKE-LOG.md `### DR-38-D` before touching this file:
//  it names, and rejects on their merits, three mechanisms that LOOK like
//  they cover the snapshot and do not. The one that does is
//  `AppSceneDelegate.installCover`, in this same App/ directory -- this
//  file only owns the cover's colour and the SwiftUI-visible half of the
//  mirroring.
//

import SwiftUI
import UIKit

/// The cover colour and the plain UIKit view that carries it.
///
/// Flat, opaque, no logo, no text, no gradient -- that is not cosmetic. It
/// collapses 38-05 Task 3's verification to an exact-equality check on a
/// single compressed ASTC block, which is a far stronger assertion than a
/// subjective look at an image. If a logo is ever wanted here, the assertion
/// has to relax to "≥ 99.5% void-extent, every void-extent colour in a known
/// set" -- DR-38-D says so explicitly.
enum SnapshotCover {
    /// `PVBackground` rather than a hardcoded colour literal: the token
    /// system is the single source of truth for every colour this app
    /// renders (see `scripts/gen-ios-colorsets.py` / `ios/brand/tokens.json`),
    /// and a snapshot cover is not an exception to that. Force-unwrapped
    /// rather than defaulted to a hardcoded fallback colour -- a fallback
    /// value is still a literal colour, and `scripts/audit-ios-colour-tokens.sh`
    /// (correctly) refuses to distinguish "fallback" from "primary" value.
    /// The asset is a build input this app cannot run without
    /// (`ContrastTests.swift` and the audit script's own check 2 both depend
    /// on the catalog being intact), so a missing token belongs in a crash,
    /// not a silent literal.
    static var color: UIColor {
        UIColor(named: "PVBackground")!
    }

    static func makeView() -> UIView {
        let view = UIView()
        view.backgroundColor = color
        view.isOpaque = true
        view.accessibilityIdentifier = "app.snapshotCover"
        return view
    }
}

/// Mirrors the cover colour in SwiftUI through the scene-phase environment
/// value, so the VISIBLE user interface also blanks during an interruption.
///
/// This is the COSMETIC half only. Nothing here forces a render commit before
/// the OS takes its app-switcher snapshot -- SwiftUI's own commit timing is a
/// race the framework gives no way to win (research 38-RESEARCH.md
/// "Snapshot protection (UI-08)"). The actual mitigation for UI-08 is
/// `AppSceneDelegate.installCover`, which forces an explicit UIKit layout
/// pass on the resign-active callback. This modifier exists so a user who
/// glances at the screen during, say, a Control Center pull does not see a
/// half-second of raw vault content before the OS snapshot machinery even
/// gets involved -- it is a polish layer sitting on top of the real control,
/// never a substitute for it.
struct SnapshotCoverOverlay: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    /// Gated by the SAME two flags `AppSceneDelegate.installCover` reads --
    /// discovered empirically during 38-05 Task 3's negative control (see
    /// 38-05-SUMMARY.md) that leaving this unconditional made it
    /// independently cover the app-switcher snapshot even with the UIKit
    /// mitigation compiled OUT: a SwiftUI-committed frame apparently CAN win
    /// the race often enough that the "cosmetic only" half was silently
    /// doing the real mitigation's job, which would have made the negative
    /// control lie about proving anything.
    ///
    /// Mirroring `triggerOnBackgroundInsteadOfResignActive` too (not just
    /// `isCoverEnabled`) matters for the SAME reason: `scenePhase` becomes
    /// `.inactive` at resign-active, before `.background` -- so if this
    /// overlay covered on ANY non-`.active` phase regardless of which arm
    /// is under test, it would ALSO confound the discriminating arm (E-S1),
    /// making a `.background`-only UIKit trigger look like it works purely
    /// because this "cosmetic" half was covering earlier than it claimed to.
    /// Matching the SAME trigger point keeps this overlay's claim to be
    /// cosmetic-only actually true under either arm.
    private var shouldCover: Bool {
        guard AppSceneDelegate.isCoverEnabled else { return false }
        if AppSceneDelegate.triggerOnBackgroundInsteadOfResignActive {
            return scenePhase == .background
        }
        return scenePhase != .active
    }

    func body(content: Content) -> some View {
        content.overlay {
            if shouldCover {
                Color("PVBackground")
                    .ignoresSafeArea()
                    .accessibilityIdentifier("app.snapshotCoverOverlay")
            }
        }
    }
}

extension View {
    /// Attach to the app's root view. See `SnapshotCoverOverlay` doc comment
    /// for why this is the cosmetic half and not the mitigation itself.
    func snapshotCoverOverlay() -> some View {
        modifier(SnapshotCoverOverlay())
    }
}
