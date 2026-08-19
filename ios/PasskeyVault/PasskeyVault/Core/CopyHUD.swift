//
//  CopyHUD.swift
//  PasskeyVault
//
//  The shared, compact copy confirmation -- design-conformance / UX fix,
//  Phase 40. Replaces BOTH `ItemListView` and `ItemDetailView`'s own
//  full-width `copyConfirmationBanner` (a `PVSurfaceAlt`-backed card with a
//  manual "x" dismiss, `.safeAreaInset`-reserved layout space, and a
//  multi-clause disclosure sentence painted on screen) with ONE
//  `ultraThinMaterial` capsule that reads as a native iOS HUD -- the same
//  idiom as the volume/brightness/AirPods pill (`AVSystemController`'s own
//  overlay) or `UIActivityViewController`'s own "Copied" toast, not an
//  app-drawn dialog.
//
//  Not drawn anywhere in screens-vault.html -- copy feedback has no CSS
//  rule to transcribe here, only Bartek's own spec: a single `.caption`
//  line, `checkmark.circle.fill` in `PVSuccess`, bottom safe area, ~2.5s
//  auto-dismiss, a success haptic. The full multi-clause disclosure text
//  (`ClipboardWording.confirmation`) is NOT dropped -- it still reaches
//  VoiceOver as this view's `accessibilityLabel`; only the visible capsule
//  is shortened to `ClipboardWording.hudLine`'s one line.
//
//  Both call sites (`ItemListView.swift`, `ItemDetailView.swift`) share an
//  IDENTICAL wiring pattern:
//
//      .overlay(alignment: .bottom) {
//          if let confirmation {
//              CopyHUD(confirmation: confirmation, accessibilityId: "...")
//                  .padding(.bottom, 12)
//                  .task(id: confirmation.deadline) {
//                      await CopyHUD.autoDismiss { self.confirmation = nil }
//                  }
//                  .transition(.opacity.combined(with: .move(edge: .bottom)))
//                  .animation(.default, value: confirmation.deadline)
//          }
//      }
//      .sensoryFeedback(.success, trigger: confirmation?.deadline)
//
//  The haptic is fired at the SCREEN level, not from inside this view, so
//  it triggers exactly once per NEW copy (keyed on `confirmation?.deadline`,
//  which `ClipboardService.shared.copy(...)` mints fresh on every call),
//  never on an unrelated re-render of the screen this HUD floats over.
//
//  This view touches the system pasteboard nowhere -- the copy itself
//  already happened, through `ClipboardService`, before `confirmation` was
//  ever set (`scripts/audit-clipboard-single-writer.sh`'s own invariant:
//  exactly one shipped file may write it directly, and it is not this one).
//

import SwiftUI

struct CopyHUD: View {
    let confirmation: ClipboardConfirmation
    let accessibilityId: String

    /// The HUD's own visible lifetime -- deliberately SEPARATE from
    /// `confirmation.deadline` (the REAL clipboard-clear time, which the
    /// caption's live countdown still reads seconds from, unchanged). A
    /// compact system-style acknowledgment that lingered as long as
    /// `ClipboardService`'s own multi-second clearing window would stop
    /// reading as a HUD at all; Bartek's own spec calls for ~2.5s.
    static let visibleDuration: Duration = .milliseconds(2500)

    var body: some View {
        // A live countdown DERIVED FROM THE DEADLINE on every render tick --
        // never decremented locally (the old banner's own discipline,
        // Task 2's behaviour requirement, kept identically here).
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = ClipboardService.remainingSeconds(deadline: confirmation.deadline, now: context.date)

            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color("PVSuccess"))
                Text(verbatim: ClipboardWording.hudLine(
                    fieldLabel: confirmation.fieldLabel, remainingSeconds: remaining
                ))
                .font(.caption)
                .foregroundStyle(Color("PVTextPrimary"))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial, in: Capsule())
            // `.contain`, not the default -- without it SwiftUI can flatten
            // the `HStack` away and `accessibilityId` never reaches the
            // XCUITest tree (the exact trap the old banner's own comment
            // named, and the +-panel's before it).
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(accessibilityId)
            // VoiceOver hears the FULL disclosure sentence even though the
            // visible capsule shows only the short line -- the warning is
            // relocated, not removed.
            .accessibilityLabel(ClipboardWording.confirmation(
                fieldLabel: confirmation.fieldLabel, remainingSeconds: remaining
            ))
        }
        .fixedSize()
    }

    /// Sleeps for `visibleDuration`, then calls `dismiss` -- unless the
    /// surrounding `.task(id:)` was already cancelled first, which happens
    /// exactly when a NEW copy landed (`confirmation.deadline` changed,
    /// restarting this same `.task` with a fresh id) while this one was
    /// still sleeping. Without the cancellation check, the STALE dismiss
    /// would fire after the sleep anyway and clobber the new confirmation
    /// that replaced this one, cutting its visible lifetime short.
    @MainActor
    static func autoDismiss(_ dismiss: () -> Void) async {
        try? await Task.sleep(for: visibleDuration)
        guard !Task.isCancelled else { return }
        dismiss()
    }
}
