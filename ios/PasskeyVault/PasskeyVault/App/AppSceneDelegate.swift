//
//  AppSceneDelegate.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-05 -- installs the app-switcher
//  snapshot cover on the one mechanism that forces its own render pass.
//
//  Read ios/IOS-SPIKE-LOG.md `### DR-38-D` before touching this file. It
//  names, and rejects on their merits, three decoy mechanisms that must
//  never reappear here -- a SwiftUI view modifier that is inert without a
//  redaction reason the system never sets for this surface, a trait that
//  only DETECTS capture rather than blocking it, and a text-field layer
//  trick that is disputed and version-dependent. This file's own 38-05
//  acceptance check greps the source tree for their exact API names and
//  requires zero hits -- so their names belong in DR-38-D's prose, not
//  here.
//

import UIKit

/// The UIKit application delegate SwiftUI adapts via
/// `@UIApplicationDelegateAdaptor` in `PasskeyVaultApp`. Its only job is to
/// name `AppSceneDelegate` as the scene delegate class -- SwiftUI's own
/// `App`/`Scene` protocols have no direct hook for a
/// `UIWindowSceneDelegate` callback, and `sceneWillResignActive` is exactly
/// such a callback.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
        config.delegateClass = AppSceneDelegate.self
        return config
    }
}

/// Installs an opaque cover over the window before the OS takes an
/// app-switcher snapshot, and forces the render pass that commits it.
final class AppSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private static let coverViewTag = 987_654_321

    /// Exists SOLELY for 38-05 Task 3's negative control (E-S1). Must never
    /// be set in a build that ships. Flip via `OTHER_SWIFT_FLAGS
    /// -DPV_SNAPSHOT_COVER_DISABLED` for a throwaway build used only to
    /// observe the assertion FAIL and the block map visibly show the item
    /// screen -- see 38-05-SUMMARY.md for the transcript.
    static var isCoverEnabled: Bool {
        #if PV_SNAPSHOT_COVER_DISABLED
        return false
        #else
        return true
        #endif
    }

    /// Exists SOLELY for 38-05 Task 3's discriminating arm (E-S1): whether
    /// the render pass commits in time when installed on scene-`.background`
    /// instead of resign-active. Flip via `OTHER_SWIFT_FLAGS
    /// -DPV_SNAPSHOT_COVER_TRIGGER_BACKGROUND` for that one measurement run.
    /// DR-38-D records the winning arm and why; this flag exists to produce
    /// the losing arm's evidence too; do not read its mere existence as
    /// meaning both arms are equally supported in the shipped build -- the
    /// shipped default is resign-active.
    static var triggerOnBackgroundInsteadOfResignActive: Bool {
        #if PV_SNAPSHOT_COVER_TRIGGER_BACKGROUND
        return true
        #else
        return false
        #endif
    }

    // MARK: - UIWindowSceneDelegate

    func sceneWillResignActive(_ scene: UIScene) {
        guard !Self.triggerOnBackgroundInsteadOfResignActive else { return }
        installCover(on: scene)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        guard Self.triggerOnBackgroundInsteadOfResignActive else { return }
        installCover(on: scene)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        removeCover(from: scene)
    }

    /// The insertion AND the forced layout pass live together in this ONE
    /// method, called from `sceneWillResignActive` (default trigger) or
    /// `sceneDidEnterBackground` (discriminating-arm trigger) and nowhere
    /// else -- that coupling is a structural fact a grep can read (38-05's
    /// acceptance criteria assert on it directly), not a reviewer's
    /// impression. A forced layout pass sitting in some OTHER method is
    /// exactly the shape that passes a code review and leaves the render
    /// uncommitted.
    ///
    /// Forcing the pass here is the whole point of choosing a UIKit
    /// scene-lifecycle callback over SwiftUI's `scenePhase`: it lets the app
    /// commit the render before the system takes its snapshot, rather than
    /// hoping the framework's own commit happens to land first (research
    /// 38-RESEARCH.md "Snapshot protection (UI-08)" -- `scenePhase` alone is
    /// a race the framework gives no way to win).
    private func installCover(on scene: UIScene) {
        guard Self.isCoverEnabled else { return }
        guard let windowScene = scene as? UIWindowScene,
              let targetWindow = windowScene.windows.first else { return }

        let cover = SnapshotCover.makeView()
        cover.tag = Self.coverViewTag
        cover.frame = targetWindow.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        targetWindow.addSubview(cover)
        targetWindow.bringSubviewToFront(cover)
        targetWindow.layoutIfNeeded()
    }

    private func removeCover(from scene: UIScene) {
        guard let windowScene = scene as? UIWindowScene,
              let targetWindow = windowScene.windows.first else { return }
        targetWindow.viewWithTag(Self.coverViewTag)?.removeFromSuperview()
    }
}
