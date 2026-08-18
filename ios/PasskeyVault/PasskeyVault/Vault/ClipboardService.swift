//
//  ClipboardService.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 2. Writes a secret to
//  the pasteboard with BOTH clearing mechanisms set, deliberately: the
//  pasteboard's own `expirationDate` (daemon-owned; whether it survives app
//  termination is what Task 3/E-C1 MEASURES, never asserted here) and an
//  in-app, cancellable, change-counter-guarded clear (dies with the
//  process). Neither alone is sufficient (T-38-07-01).
//
//  iOS can do one thing the web platform cannot express:
//  `UIPasteboard.changeCount`. Captured at write time, compared at fire
//  time -- the in-app clear fires ONLY if nothing has copied since (this
//  app or another app), so a later, unrelated copy the user made is never
//  destroyed (T-38-07-03, the early-clear defect the single-timer
//  discipline exists to prevent).
//
//  TWO independent injection seams, both existing SOLELY so
//  `ClipboardServiceTests.swift` can assert the guard and the single-timer
//  discipline without the real device pasteboard (Pitfall 8: simulator
//  pasteboard/host sync is exactly what a unit test must not depend on) and
//  without waiting on real `Timer` fire delays:
//    - `PasteboardWriting` -- what gets read/written.
//    - `ClipboardScheduling` -- what schedules/cancels the delayed clear.
//
//  The confirmation toast (`ClipboardConfirmation`) is DELIBERATELY
//  independent of the clear timer, mirroring `copyToast.ts`'s own header:
//  dismissing it must never cancel the real clear. There is no
//  `dismiss()` method on this type at all -- the toast's visibility lives
//  entirely in the VIEW (`ItemDetailView`'s own `@State`), which is what
//  makes "dismissing it cannot touch the timer" true by construction rather
//  than by a discipline that could be violated later.
//

import Foundation
import UIKit

// MARK: - Pasteboard seam

protocol PasteboardWriting: AnyObject {
    var changeCount: Int { get }
    func setValue(_ value: String, expirationDate: Date, localOnly: Bool)
    /// Best-effort overwrite with an empty string -- the in-app half of the
    /// two-mechanism discipline.
    func clear()
}

/// The real device/simulator pasteboard. `setObjects(_:localOnly:
/// expirationDate:)` matches `ItemListView.swift`'s own already-established
/// call shape for the same API (that file's `copySecret`, predating this
/// service).
final class UIKitPasteboard: PasteboardWriting {
    static let shared = UIKitPasteboard()
    private init() {}

    var changeCount: Int { UIPasteboard.general.changeCount }

    func setValue(_ value: String, expirationDate: Date, localOnly: Bool) {
        UIPasteboard.general.setObjects(
            [value], localOnly: localOnly, expirationDate: expirationDate
        )
    }

    func clear() {
        UIPasteboard.general.setObjects([""], localOnly: true, expirationDate: nil)
    }
}

// MARK: - Scheduler seam

/// An opaque handle to a scheduled clear. `invalidate()` is the ONLY
/// operation a caller needs -- cancelling the previous field's pending
/// clear when a second copy happens.
protocol ClipboardClearToken: AnyObject {
    func invalidate()
}

protocol ClipboardScheduling {
    /// Schedules `fire` to run after `seconds`. The real implementation uses
    /// `Timer`; the test implementation fires synchronously on command, so a
    /// test never waits on real wall-clock time.
    func scheduleClear(after seconds: TimeInterval, fire: @escaping () -> Void) -> ClipboardClearToken
}

final class RealClipboardScheduler: ClipboardScheduling {
    private final class TimerToken: ClipboardClearToken {
        let timer: Timer
        init(timer: Timer) { self.timer = timer }
        func invalidate() { timer.invalidate() }
    }

    func scheduleClear(after seconds: TimeInterval, fire: @escaping () -> Void) -> ClipboardClearToken {
        let timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { _ in fire() }
        RunLoop.main.add(timer, forMode: .common)
        return TimerToken(timer: timer)
    }
}

// MARK: - Confirmation (deliberately timer-independent -- see file header)

struct ClipboardConfirmation: Equatable {
    let fieldLabel: String
    let deadline: Date
}

// MARK: - ClipboardService

final class ClipboardService {
    static let shared = ClipboardService(pasteboard: UIKitPasteboard.shared, scheduler: RealClipboardScheduler())

    private let pasteboard: PasteboardWriting
    private let scheduler: ClipboardScheduling
    private let clock: () -> Date

    /// The SINGLE active pending clear. Never more than one at a time --
    /// `copy(_:fieldLabel:seconds:)` invalidates whatever is here BEFORE
    /// scheduling a new one.
    private var pendingToken: ClipboardClearToken?

    /// WR-04 (38-REVIEW.md): the change count captured at the START of the
    /// most recent `copy(...)` write -- the SAME value the scheduled
    /// clear's own closure already captures, stored again here so
    /// `clearIfStillOurs()` (an EARLY, explicit clear) can reuse the exact
    /// same change-counter guard without waiting for the timer to fire.
    private var lastWriteChangeCount: Int?

    init(
        pasteboard: PasteboardWriting,
        scheduler: ClipboardScheduling,
        clock: @escaping () -> Date = Date.init
    ) {
        self.pasteboard = pasteboard
        self.scheduler = scheduler
        self.clock = clock
    }

    /// Writes `value` with BOTH the pasteboard's own expiry AND
    /// `localOnly: true` in ONE call (T-38-07-02: the local-only option
    /// mitigates cross-device Universal Clipboard relay -- content ALREADY
    /// relayed before this write cannot be retracted, and that is stated in
    /// the confirmation wording, not only in this comment).
    ///
    /// Returns the deadline, so the caller can drive an honest countdown
    /// derived from it on every render tick rather than decrementing a
    /// locally-owned counter.
    @discardableResult
    func copy(_ value: String, fieldLabel: String, seconds: Int = ClipboardSettings.read()) -> Date {
        let clampedSeconds = ClipboardSettings.clamp(Double(seconds))
        let deadline = clock().addingTimeInterval(TimeInterval(clampedSeconds))

        pasteboard.setValue(value, expirationDate: deadline, localOnly: true)
        let stamp = pasteboard.changeCount
        lastWriteChangeCount = stamp

        // Single active timer: invalidate the PREVIOUS field's pending clear
        // before scheduling this one. Two live pending clears would mean the
        // clipboard could be cleared "too early" relative to what is
        // actually in it right now (packages/pv-ui/clipboard.ts's own
        // documented reason for this discipline).
        pendingToken?.invalidate()
        pendingToken = scheduler.scheduleClear(after: TimeInterval(clampedSeconds)) { [weak self] in
            self?.fireClear(expectingChangeCount: stamp)
        }

        return deadline
    }

    /// The change-counter guard: clears ONLY if nothing has copied (this
    /// app or another) since this exact write. A later, unrelated copy the
    /// user made in the meantime survives untouched.
    private func fireClear(expectingChangeCount stamp: Int) {
        pendingToken = nil
        guard pasteboard.changeCount == stamp else { return }
        pasteboard.clear()
    }

    /// WR-04 (38-REVIEW.md): an EARLY, explicit clear -- `lockTeardown`
    /// calls this so a copied secret does not sit in the pasteboard for the
    /// rest of the configured interval after the vault has already locked.
    /// Reuses the SAME change-counter guard `fireClear` uses (refuses to
    /// clear if anything else has copied since THIS service's own last
    /// write), so a lock can never destroy an unrelated copy the user made
    /// afterward. Also invalidates the pending scheduled clear -- nothing
    /// is left to fire against once this has run.
    func clearIfStillOurs() {
        guard let stamp = lastWriteChangeCount else { return }
        pendingToken?.invalidate()
        fireClear(expectingChangeCount: stamp)
    }

    /// COSMETIC ONLY: dismissing the confirmation banner shown in the UI
    /// after a copy. Exists so "dismissing must never cancel the real
    /// clear" (`copyToast.ts`'s own header) is directly testable rather
    /// than merely true by the absence of a wired connection --
    /// deliberately does NOTHING to `pendingToken`; there is no code path
    /// from this method to the timer at all.
    func dismissConfirmation() {}

    /// Remaining whole seconds until `deadline`, computed fresh from `now`
    /// on EVERY call -- never a locally decremented counter. `ItemDetailView`
    /// calls this on every `TimelineView` tick rather than re-deriving the
    /// same arithmetic inline.
    static func remainingSeconds(deadline: Date, now: Date) -> Int {
        max(0, Int(deadline.timeIntervalSince(now).rounded(.up)))
    }
}

// MARK: - User-facing wording

enum ClipboardWording {
    /// Written to survive EITHER outcome of Task 3/E-C1 -- it never claims
    /// the clipboard clear is an unconditional certainty (E-C1 has not run
    /// yet at the point this is written; Task 3 revises this if arms B/C
    /// show the pasteboard's own expiry does not survive what this string
    /// implies).
    /// States plainly what cannot be retracted: content already read by
    /// another app, already relayed to a paired device via Universal
    /// Clipboard (see `copy`'s own `localOnly` note), or already polled by
    /// a third-party clipboard manager -- none of that is undone by this
    /// app's own clear, on this device or any other.
    static func confirmation(fieldLabel: String, remainingSeconds: Int) -> String {
        if remainingSeconds > 0 {
            return "Copied \(fieldLabel) — cleared from this device's clipboard in \(remainingSeconds)s. "
                + "Anything already pasted elsewhere, relayed to one of your other devices, "
                + "or read by another app or a clipboard manager can't be taken back."
        }
        return "Copied \(fieldLabel)."
    }
}
