//
//  SnapshotCoverFlagTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-05, Task 2.
//
//  The negative-control and discriminating-arm flags exist SOLELY for 38-05
//  Task 3's E-S1 measurements (see App/AppSceneDelegate.swift). This test
//  asserts their default, in a normal build with neither
//  -DPV_SNAPSHOT_COVER_DISABLED nor -DPV_SNAPSHOT_COVER_TRIGGER_BACKGROUND
//  set: the cover is ON, and the trigger is resign-active. A flag that
//  silently defaulted the other way would ship a vault with an uncovered
//  app-switcher snapshot.
//

@testable import PasskeyVault
import Testing

struct SnapshotCoverFlagTests {
    @Test func coverDefaultsEnabled() {
        #expect(AppSceneDelegate.isCoverEnabled == true)
    }

    @Test func triggerDefaultsToResignActiveNotBackground() {
        #expect(AppSceneDelegate.triggerOnBackgroundInsteadOfResignActive == false)
    }
}
