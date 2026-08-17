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
    /// and a snapshot cover is not an exception to that.
    static var color: UIColor {
        UIColor(named: "PVBackground") ?? .black
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

    func body(content: Content) -> some View {
        content.overlay {
            if scenePhase != .active {
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
