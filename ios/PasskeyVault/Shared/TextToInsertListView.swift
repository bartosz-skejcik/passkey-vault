//
//  TextToInsertListView.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Plan 44-06 (SAVE-03, SAVE-04). Presented from `prepareInterfaceForUserChoosingTextToInsert()`
//  -- lists up to `TextToInsertDispatch.maxCandidates` cached TOTP-typed items with their LIVE,
//  ticking codes, recomputed every second through `TextToInsertDispatch.freshCode` (which itself
//  calls the SAME `totpNow` `pv-ffi` export `TotpCountdownView.swift` (host-only, Phase 38) already
//  calls -- never a second, hand-rolled TOTP implementation). Selecting a row hands the FULL
//  candidate back to the caller, which recomputes ONE MORE TIME at selection time (never reusing
//  this view's own last-rendered code) before calling `completeRequest(withTextToInsert:)`.
//
//  DEVIATION (Rule 1, GSD executor rules), decided proactively rather than after a move-then-fix
//  cycle: 44-06-PLAN.md's own `files_modified` names this file under `PasskeyVaultAutoFill/`
//  (extension-only). Placed in `Shared/` instead, from the start -- the SAME reasoning
//  `GeneratePasswordOfferView.swift`/`SavePasswordConfirmView.swift`'s own headers document (Plans
//  44-05/44-04, both of which needed an after-the-fact move for exactly this reason): this view has
//  zero extension-specific dependencies (no `AuthenticationServices` import, no `extensionContext`
//  access), and this plan's own SAVE-04 pixel proof needs a host-side direct-invocation route to
//  render this EXACT production view for the case this surface's own live-invocation history
//  (`ios/IOS-SPIKE-LOG.md`: never observed to fire, Plan 44-03) repeats. `Shared/` already compiles
//  into `PasskeyVaultAutoFill` (`fileSystemSynchronizedGroups`, confirmed via
//  `scripts/audit-ios-extension-asset-resolution.py` PASS in this plan's own Task 1) -- placing the
//  file here changes nothing about which target's bundle ships it; it only ALSO makes it visible to
//  `PasskeyVault`, the second target that already syncs `Shared/` too.
//
//  `PVAccent`, not `PVSuccess` (44-04's save-confirm accent) / `PVInfo` (44-05's generate-offer
//  accent) / `PVPasskey` (43-07's registration-confirm accent) -- this surface's own distinct
//  accent, per SAVE-04's own per-surface distinctness requirement (must_haves.artifacts).
//

import SwiftUI

struct TextToInsertListView: View {
    let items: [TextToInsertDispatch.Candidate]
    let onSelect: (TextToInsertDispatch.Candidate) -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            if items.isEmpty {
                emptyState
                Spacer(minLength: 0)
            } else {
                List(items) { item in
                    TotpInsertRow(item: item, onTap: { onSelect(item) })
                        .listRowBackground(Color("PVBackground"))
                        .accessibilityIdentifier("textToInsert.row.\(item.itemId)")
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color("PVBackground"))
    }

    private var header: some View {
        VStack(spacing: 8) {
            Circle()
                .fill(Color("PVAccent").opacity(0.14))
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: "textformat.abc")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color("PVAccent"))
                )
                .accessibilityHidden(true)
            Text(verbatim: "Insert a verification code")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color("PVTextPrimary"))
        }
        .padding(.top, 24)
        .padding(.bottom, 12)
    }

    /// `<behavior>` (44-06-PLAN.md): no cached TOTP-typed items -- a valid, non-crashing empty
    /// state, never a cancel-with-error. An empty but valid list is a legitimate answer to "what is
    /// there to insert".
    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "clock.badge.questionmark")
                .font(.system(size: 30))
                .foregroundStyle(Color("PVTextMuted"))
            Text(verbatim: "No verification codes saved in your vault yet.")
                .font(.subheadline)
                .foregroundStyle(Color("PVTextMuted"))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .padding(.top, 24)
        .accessibilityIdentifier("textToInsert.empty")
    }
}

/// One row's live, ticking code -- a `TimelineView` recomputed every second through
/// `TextToInsertDispatch.freshCode`, mirroring `TotpCountdownView.swift`'s own never-decrement
/// discipline (that file is host-only, `PasskeyVault/Core`-adjacent, not importable from this
/// target -- this is the `Shared/`-visible equivalent, calling through the SAME `pv-ffi` boundary
/// underneath, never a second implementation). A real `Button`, not a bare `.onTapGesture` --
/// `TotpCountdownView.swift`'s own header records the live bug a bare gesture hit under
/// `ItemListView`'s row-level tap handling; this row has no such wrapping gesture today, but the
/// same `Button`-not-gesture discipline is applied here from the start rather than risk
/// reproducing it later.
private struct TotpInsertRow: View {
    let item: TextToInsertDispatch.Candidate
    let onTap: () -> Void

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            let now = UInt64(max(0, context.date.timeIntervalSince1970))
            content(for: now)
        }
    }

    @ViewBuilder
    private func content(for unixTimeSeconds: UInt64) -> some View {
        switch TextToInsertDispatch.freshCode(for: item, at: unixTimeSeconds) {
        case let .success(result):
            Button(action: onTap) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: item.name)
                            .font(.subheadline)
                            .foregroundStyle(Color("PVTextMuted"))
                            .lineLimit(1)
                        Text(verbatim: result.code)
                            .font(.system(.title3, design: .monospaced).weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Color("PVAccent"))
                    }
                    Spacer(minLength: 0)
                    Text(verbatim: "\(result.secondsRemaining)s")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(result.secondsRemaining <= 5 ? Color("PVWarning") : Color("PVTextMuted"))
                }
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(result.code)
        case .failure:
            // A visible, non-crashing error state -- an item with out-of-range TOTP parameters
            // (CR-04-class untrusted plaintext, same discipline `TotpCountdownView.swift`'s own
            // `.failure` branch applies) reaches this path, never a crash.
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color("PVError"))
                Text(verbatim: "Can't generate a code for \(item.name).")
                    .font(.footnote)
                    .foregroundStyle(Color("PVError"))
            }
        }
    }
}

#Preview {
    TextToInsertListView(
        items: [
            .init(
                itemId: "preview-1", name: "Example Account",
                secretB32: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", algorithm: "SHA1", digits: 8, period: 30
            ),
        ],
        onSelect: { _ in }
    )
}
