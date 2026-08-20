//
//  BiometricAutoPromptGuard.swift
//  PasskeyVault
//
//  REQUIRED FIX #2 (`.planning/debug/faceid-unlock-loop.md`), independent of REQUIRED FIX #1
//  (`SessionLifecycle.LockState`/`ContentView`'s routing fix, immediately above this file's own
//  commit): a structural stop to the infinite Face-ID-relock loop that holds even if a FUTURE
//  routing decision this codebase trusts turns out to be wrong for a reason nobody anticipated.
//
//  `LockView.swift`'s own `didAutoPromptBiometrics` is a per-view `@State` -- it stops a SECOND
//  auto-prompt from firing on the SAME `LockView` identity, but SwiftUI gives a BRAND NEW
//  identity (and therefore brand-new `@State` storage, reset to its declared default) every time
//  `ContentView` re-enters `.lock(RestoredAccount)` (`ContentView.performLock()` ->
//  `routeToLockOrAuth()`). A wrong relock -- ANY wrong relock, for ANY reason -- therefore gets a
//  free auto-prompt every single time, with nothing in the per-view flag able to remember that
//  this already happened moments ago. This is the second half of the mechanism this record's own
//  root cause names: the routing bug produces the wrong relock, and the per-view flag's amnesia
//  is what turns one wrong relock into an INFINITE one.
//
//  This guard is `static`, not `@State` -- process-lifetime, surviving every `LockView` remount
//  for as long as the app itself is running. A fresh app launch gets a fresh guard (starting
//  state: no prior prompt, so the very first auto-prompt of a session is never suppressed) --
//  correct, since nothing here should outlive the process.
//

import Foundation

enum BiometricAutoPromptGuard {
    /// Structural, not tuned to any user-visible timing. The loop this guard exists to break
    /// re-fires within the SAME run-loop turn family: `LockView.setUpOnAppear`'s own
    /// `DispatchQueue.main.async` posts the auto-prompt call to the very NEXT turn, and a
    /// wrong-relock cycle (remount -> auto-prompt -> real Face ID round trip -> unlock -> wrong
    /// relock -> remount again) still completes in well under a second on real hardware -- a
    /// Face ID system-sheet round trip alone is on the order of a second, and the wrong-relock
    /// mechanism this guard defends against adds no meaningful additional delay. 3 seconds is
    /// comfortably longer than any such loop iteration could take, and comfortably shorter than
    /// any GENUINE reappearance a real user would produce (backgrounding and returning after
    /// actually doing something else, or a real idle-window relock minutes later) -- so a real,
    /// wanted auto-prompt is never suppressed by this guard; only a mechanical, sub-second re-fire
    /// is.
    static let minimumIntervalSeconds: TimeInterval = 3

    private static var lastAutoPromptMonotonic: TimeInterval?

    /// `true` (and records `now` as the new last-auto-prompt instant) only when enough time has
    /// elapsed since the PREVIOUS auto-prompt this guard allowed. Gates ONLY the AUTO path
    /// (`LockView.setUpOnAppear`'s own `onAppear`-driven `attemptBiometricUnlock` call) -- the
    /// user's own manual "Unlock with Face ID" button (`LockView.biometricPrimaryButton`'s
    /// action) calls `attemptBiometricUnlock` directly and never consults this type at all, so a
    /// user who taps Face ID themselves is NEVER throttled by this guard, however many times they
    /// tap.
    ///
    /// `now` defaults to `LockMarker.monotonicNow()` -- the SAME sleep-inclusive monotonic clock
    /// `SessionLifecycle`/`LockMarker` already use for every other lock-lifetime decision in this
    /// codebase (never `Date()`, never `ProcessInfo.processInfo.systemUptime` -- see
    /// `LockMarker.monotonicNow()`'s own header) -- explicit here so `LockView` never needs to
    /// import or reason about a second clock, and so tests can inject a synthetic timeline without
    /// depending on real wall-clock time passing.
    static func shouldAutoPrompt(now: TimeInterval = LockMarker.monotonicNow()) -> Bool {
        if let last = lastAutoPromptMonotonic, now - last < minimumIntervalSeconds {
            return false
        }
        lastAutoPromptMonotonic = now
        return true
    }

    /// TEST-ONLY: `PasskeyVaultTests` runs every test in one process, and this guard's own state
    /// is deliberately PROCESS-lifetime `static` storage (that is the entire point -- surviving a
    /// `LockView` remount) -- without an explicit reset, a real timestamp left behind by an
    /// EARLIER test would make a LATER test's own "the very first prompt after a fresh session is
    /// always allowed" assumption false, depending on test run order. Never called from production
    /// code; compiled out of Release entirely.
    #if DEBUG
    static func resetForTesting() {
        lastAutoPromptMonotonic = nil
    }
    #endif
}
