//
//  TotpCountdownView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-10, Task 2. The detail
//  screen's TOTP composed section -- design-conformance §"38-10" replaces
//  this plan's originally drafted row design entirely ("the code is the
//  row", after Google Authenticator): a ring, not a pie, beside an
//  enlarged code, that turns `PVWarning` in its final seconds so "will
//  this expire before I finish typing" is answerable without counting.
//
//  Quick task 260818-irw ("fix iOS Codes surface: TOTP rows to match"):
//  the LIST surface never actually got this component -- `ItemListView
//  .swift`'s `row(_:)` fell through the same generic icon+title+chevron
//  branch every other item type uses, so the Codes tab showed no live
//  code and no ring at all. Refactored into a `Style`-parameterized view
//  (`.listRow`/`.detail`) so the SAME already-hardened timing/FFI engine
//  below (unchanged by this refactor) drives both surfaces -- never a
//  second, independently-written countdown implementation. `.listRow`'s
//  geometry (`PVMetrics.totpRow*`/`totpRingDiameterList`) matches
//  `ios/brand/screens-vault.html`'s `.trow`/`.pie`; `.detail`'s geometry
//  (`PVMetrics.totpDetail*`/`totpRingDiameterDetail`) matches that
//  artifact's own `.totp`/30px `.pie` cell.
//
//  THE SCHEDULED-DATE CORRECTION (Pitfall 5, `38-RESEARCH.md` "Code
//  Examples"): `TimelineView`'s `context.date` is the SCHEDULE's date, not
//  the real clock -- a late run loop hands back a stale date, a marginally
//  early fire hands back one just before the period boundary. Every tick
//  below takes `max(context.date, Date())` and recomputes through
//  `totpNow` FRESH -- never decrementing a locally-held countdown. The
//  local binding that carries the remaining-seconds value on every tick is
//  named `remainingSeconds` EXACTLY (see `content(for:)` below) so this
//  rule is a grep target, not a reviewer's eye (this plan's own acceptance
//  criteria greps this file for `remainingSeconds -=`/self-referential
//  subtraction and requires zero hits).
//
//  `pv_core::totp::generate_code` never reads the clock (that module's own
//  header: the crate also targets `wasm32-unknown-unknown`, which has
//  none) -- `unix_time_seconds` is supplied fresh, every tick, from this
//  view.
//
//  ACCESSIBILITY (must_haves.truths, backstop): the code and the
//  remaining-seconds count are both exposed as `accessibilityValue`s with
//  stable identifiers, so `TotpCountdownUITests.swift` reads real values
//  through the accessibility tree rather than recognising characters in
//  the rendered ring image -- OCR on a countdown ring is a needless
//  failure source (`38-RESEARCH.md` E-T1, step 2). `.listRow` callers
//  supply their OWN per-item identifiers (`codeAccessibilityId`/
//  `ringAccessibilityId`) since one screen can render many rows; `.detail`
//  keeps the original fixed `vault.detail.totp.*` identifiers unchanged --
//  load-bearing for existing UI tests (see `ItemListView.swift`'s call
//  site header).
//

import SwiftUI
import UIKit

struct TotpCountdownView: View {
    enum Style {
        case listRow
        case detail
    }

    let secretB32: String
    let algorithm: String
    let digits: Int
    let period: Int
    let style: Style
    /// The fully-formatted text to show above/beside the code -- callers
    /// compute the formatting (issuer/name composition differs per
    /// surface), this view only renders it. Replaces the old `issuer:
    /// String` parameter, which formatted internally and could only ever
    /// serve one caller.
    let label: String
    /// Reuses the caller's existing copy choke-point (`ItemDetailView
    /// .copySecret` for `.detail`, `ItemListView.copySecret` for
    /// `.listRow`) -- routes through `ClipboardService` and records the
    /// last-used touch, exactly like every other copy affordance on that
    /// screen. Copies the LIVE CODE (not the raw secret) -- a deliberate
    /// divergence from `web/.../DetailPanel.tsx`, which copies
    /// `item.fields.secret` under a button labelled "copy TOTP code" (an
    /// apparent bug there, not reproduced here: see `ios/IOS-SPIKE-LOG.md`
    /// §1f for the recorded reasoning).
    ///
    /// Quick fix 40-UX-02: `.listRow` now WIRES this too (previously always
    /// `nil` there) -- see `listRowContent`'s own note on how it is invoked
    /// without adding a copy BUTTON, which `.trow`'s own two-element layout
    /// (label+code, then the ring, nothing else) has no room for. `nil`
    /// disables the tap-to-copy gesture entirely (e.g. a preview/test
    /// caller that supplies none), matching `.detail`'s existing
    /// no-button-when-nil behavior.
    var onCopy: ((String) -> Void)?
    /// Per-item accessibility identifiers for `.listRow`, since a List can
    /// render many rows and a single fixed identifier (as `.detail` uses)
    /// would collide across rows. `nil` for `.detail`, which keeps its own
    /// fixed `vault.detail.totp.*` identifiers applied directly below.
    var codeAccessibilityId: String?
    var ringAccessibilityId: String?

    /// The ring turns `PVWarning` at this many seconds or fewer remaining.
    /// Design-conformance's own wording ("in its final seconds") does not
    /// name a number -- 5 is an author-chosen threshold, matching the
    /// convention Google Authenticator itself uses (the same reference
    /// point design-conformance names for this row).
    private static let warningThresholdSeconds: UInt64 = 5

    private var ringDiameter: CGFloat {
        switch style {
        case .listRow: return PVMetrics.totpRingDiameterList
        case .detail: return PVMetrics.totpRingDiameterDetail
        }
    }

    var body: some View {
        TimelineView(.periodic(from: Date(timeIntervalSince1970: Self.anchor(for: period)), by: 1)) { context in
            // Take the LATER of the scheduled date and the real clock --
            // never trust the schedule alone (Pitfall 5).
            //
            // WR-07 (38-REVIEW.md, iteration 2): clamped to 0 -- the SAME
            // CR-04-class trap the `UInt32(exactly: digits)` conversion
            // eleven lines below was fixed for. `UInt64(_:)` on a `Double`
            // TRAPS (uncatchable `fatalError`) on a negative value, and a
            // clock set before 1970-01-01 (reachable from Settings ->
            // General -> Date & Time with automatic time off) produces
            // exactly that. A pre-epoch clock has no meaningful TOTP answer
            // anyway, so clamping to 0 rather than routing through a
            // failable initializer (which would need an error row here)
            // is the simpler fix for a value that was already nonsensical.
            let now = max(0, max(context.date.timeIntervalSince1970, Date().timeIntervalSince1970))
            content(for: UInt64(now))
        }
    }

    @ViewBuilder
    private func content(for unixTimeSeconds: UInt64) -> some View {
        switch Self.currentCode(
            secretB32: secretB32, algorithm: algorithm, digits: digits, period: period,
            unixTimeSeconds: unixTimeSeconds
        ) {
        case let .success(result):
            let code = result.code
            // Recomputed FRESH from `result` every tick -- never
            // decremented locally. This identifier's spelling is load-
            // bearing: see this file's own header and the plan's
            // acceptance criteria.
            let remainingSeconds = result.secondsRemaining
            let fraction = Self.fraction(remainingSeconds: remainingSeconds, period: period)
            let isWarning = remainingSeconds <= Self.warningThresholdSeconds

            switch style {
            case .listRow:
                listRowContent(code: code, remainingSeconds: remainingSeconds, fraction: fraction, isWarning: isWarning)
            case .detail:
                detailContent(code: code, remainingSeconds: remainingSeconds, fraction: fraction, isWarning: isWarning)
            }
        case .failure:
            // A visible, non-crashing error state -- an item imported with
            // a too-short secret or an out-of-range digit count reaches
            // this path (T-38-10-02). Neither a blank nor a crash is an
            // acceptable answer here.
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color("PVError"))
                Text(verbatim: "Can't generate a code for this item's settings.")
                    .font(.caption)
                    .foregroundStyle(Color("PVError"))
            }
            .accessibilityIdentifier(style == .detail ? "vault.detail.totp.error" : "")
        }
    }

    /// `.trow{padding:10 13;display:flex;align-items:center;
    /// justify-content:space-between;gap:10}` -- label+code leading, the
    /// ring trailing, pushed to the row's edges. No icon tile, no chevron
    /// (design-conformance's own wording: "nothing to disclose").
    ///
    /// Quick fix 40-UX-02: the whole row navigates to item details on tap
    /// (`ItemListView.rowButton`'s outer `.onTapGesture`) -- which meant
    /// tapping the live CODE, the one thing on this row someone actually
    /// wants to grab, opened a detail screen instead of copying it. Picked
    /// among the options this fix's own task named ("tapping the label/left
    /// column opens details, tapping the CODE copies" vs. a dedicated info
    /// button): the code-taps-to-copy split, because it needs NO new glyph
    /// drawn on a row design-conformance explicitly calls out as having
    /// "nothing to disclose" -- an info button would be new chrome the
    /// approved `.trow` artifact does not show. The mechanism is a REAL
    /// `Button` wrapping just the code `Text` below, styled `.plain` to
    /// stay visually identical to bare text (see that call site's own note
    /// on the two failed intermediate attempts -- a plain `.onTapGesture`,
    /// then a `.highPriorityGesture` -- and why a `Button` is what actually
    /// works): a tap landing on the code's frame is consumed by the
    /// button and never reaches the row-level gesture (no navigation
    /// push); a tap anywhere else in the row (the label, the ring, the
    /// padding) still falls through to that outer gesture and opens
    /// details, unchanged.
    /// `codeAccessibilityId` already gives VoiceOver/XCUITest a stable,
    /// per-row target for this exact frame.
    @ViewBuilder
    private func listRowContent(code: String, remainingSeconds: UInt64, fraction: Double, isWarning: Bool) -> some View {
        HStack(spacing: PVMetrics.totpRowGap) {
            VStack(alignment: .leading, spacing: PVMetrics.totpRowLabelGap) {
                Text(verbatim: label)
                    .font(.system(size: PVMetrics.totpRowLabelFontSize))
                    .foregroundStyle(Color("PVTextMuted"))
                    .lineLimit(1)
                    .truncationMode(.tail)
                // `.trow .code{font-size:31;font-weight:400;
                // letter-spacing:1.5;font-variant-numeric:tabular-nums;
                // color:var(--pv-acc)}`
                //
                // A real `Button`, NOT a bare `Text` plus `.onTapGesture`/
                // `.highPriorityGesture`. BUG FOUND LIVE (40-UX-02's own
                // UI test), in TWO stages:
                //
                // Stage 1: a plain `.onTapGesture` here was consistently
                // out-prioritized by `ItemListView.rowButton`'s own
                // `.onTapGesture { root.selection = item }`, which wraps
                // this entire row -- every tap on the code opened the
                // detail screen and `onCopy` never fired.
                //
                // Stage 2: switching to `.highPriorityGesture(TapGesture()
                // ...)` did NOT fix it either, and the failure mode changed
                // shape -- the confirmation banner still never appeared,
                // reproducibly, across repeated live runs regardless of
                // host load (ruling out a timing flake). Root cause: this
                // view also carries `.accessibilityAddTraits(.isButton)` +
                // a stable identifier, and XCUITest's `.tap()` on an
                // element with the button trait dispatches through
                // `accessibilityActivate()`, not a raw coordinate touch.
                // A bare `TapGesture`/`.onTapGesture`/`.highPriorityGesture`
                // has NO `accessibilityActivate()` wiring of its own (no
                // `.accessibilityAction` was added either), so the
                // synthesized activation had nothing to call and silently
                // did nothing -- while a real finger tap, which drives raw
                // touch-down/touch-up rather than accessibility activation,
                // may have worked all along. `detailContent` below's own
                // copy affordance was ALREADY a real `Button` and never hit
                // this failure mode, which is the tell: `Button` is a
                // genuine `UIControl`-backed SwiftUI primitive that wires
                // `accessibilityActivate()` automatically, so it responds
                // correctly to BOTH a physical tap and an accessibility-
                // driven one. `.buttonStyle(.plain)` keeps it visually
                // identical to the bare `Text` it replaces -- no new glyph,
                // matching `.trow`'s "nothing to disclose" row design --
                // and `Button` nested inside `rowButton`'s own
                // `.onTapGesture`-driven row is the same "row navigates,
                // one sub-control has its own action" pattern iOS already
                // handles reliably (mirrors a `Button` inside a `List` row
                // that also responds to selection).
                Button {
                    onCopy?(code)
                } label: {
                    Text(verbatim: Self.grouped(code))
                        .font(.system(size: PVMetrics.totpRowCodeFontSize, weight: .regular))
                        .monospacedDigit()
                        .tracking(PVMetrics.totpRowCodeLetterSpacing)
                        .foregroundStyle(Color("PVAccent"))
                }
                .buttonStyle(.plain)
                .disabled(onCopy == nil)
                .accessibilityIdentifier(codeAccessibilityId ?? "")
                .accessibilityValue(code)
                .accessibilityLabel(Text(verbatim: "Copy code"))
            }
            Spacer(minLength: 0)
            ring(fraction: fraction, isWarning: isWarning, remainingSeconds: remainingSeconds)
                .accessibilityIdentifier(ringAccessibilityId ?? "")
        }
    }

    /// Unchanged structural composition from before this refactor (ring,
    /// then label+code, then a trailing copy button) -- only the `Style`/
    /// `label` plumbing moves in Task 1; Task 2 corrects this style's own
    /// measured numeric divergences (ring diameter, code weight/font/
    /// letter-spacing).
    @ViewBuilder
    private func detailContent(code: String, remainingSeconds: UInt64, fraction: Double, isWarning: Bool) -> some View {
        HStack(spacing: 12) {
            ring(fraction: fraction, isWarning: isWarning, remainingSeconds: remainingSeconds)
                .accessibilityIdentifier("vault.detail.totp.remainingSeconds")
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color("PVTextMuted"))
                // `.totp{font-family:ui-monospace,SFMono-Regular,Menlo,
                // monospace;font-size:30;letter-spacing:3;font-variant-
                // numeric:tabular-nums}` -- regular weight (no override in
                // that CSS rule), a genuine monospace font family (`design:
                // .monospaced`, SwiftUI's equivalent), 3pt tracking.
                // `.monospacedDigit()` stays alongside `design: .monospaced`
                // -- harmless, and belt-and-suspenders with the CSS's own
                // `font-variant-numeric:tabular-nums`.
                Text(verbatim: Self.grouped(code))
                    .font(.system(size: PVMetrics.totpDetailCodeFontSize, weight: .regular, design: .monospaced))
                    .monospacedDigit()
                    .tracking(PVMetrics.totpDetailCodeLetterSpacing)
                    .foregroundStyle(Color("PVAccent"))
                    .accessibilityIdentifier("vault.detail.totp.code")
                    .accessibilityValue(code)
            }
            Spacer(minLength: 0)
            if let onCopy {
                Button {
                    onCopy(code)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .foregroundStyle(Color("PVAccent"))
                }
                .accessibilityIdentifier("vault.detail.totp.copy")
                .accessibilityLabel("Copy code")
            }
        }
    }

    @ViewBuilder
    private func ring(fraction: Double, isWarning: Bool, remainingSeconds: UInt64) -> some View {
        ZStack {
            // `--pv-fill:rgba(120,120,128,.12)` light / `.24` dark -- no
            // `PVFill`/`PVSep` colorset exists in `Assets.xcassets`
            // (confirmed during planning), so `UIColor.tertiarySystemFill`
            // (`rgba(118,118,128,.12)`/`.24`) is used instead of inventing
            // a new token for one ring's track. Replaces the previous
            // `Color("PVTextMuted").opacity(0.25)` ungrounded literal-
            // opacity hack, for BOTH styles.
            Circle()
                .stroke(Color(uiColor: .tertiarySystemFill), lineWidth: PVMetrics.totpRingStrokeWidth)
            // A trimmed ring, not a pie (design-conformance's own
            // wording): a partial stroke around the circle's
            // circumference, never a filled sector.
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(
                    isWarning ? Color("PVWarning") : Color("PVAccent"),
                    style: StrokeStyle(lineWidth: PVMetrics.totpRingStrokeWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .frame(width: ringDiameter, height: ringDiameter)
        .accessibilityValue("\(remainingSeconds)")
    }

    // MARK: - Pure helpers (no view state, unit-testable in isolation)

    /// Anchored just PAST a period boundary (`+0.05`), not at an arbitrary
    /// moment -- so the schedule's very first tick already lands inside a
    /// fresh period rather than firing right at the edge (Pitfall 5).
    private static func anchor(for period: Int) -> TimeInterval {
        let p = Double(max(period, 1))
        return (Date().timeIntervalSince1970 / p).rounded(.down) * p + 0.05
    }

    private static func fraction(remainingSeconds: UInt64, period: Int) -> Double {
        let p = Double(max(period, 1))
        return min(1, max(0, Double(remainingSeconds) / p))
    }

    /// Splits the code roughly in half with a space -- `NNN NNN` for a
    /// 6-digit code, `NNNN NNNN` for an 8-digit one (this app's `digits`
    /// picker only offers 6/7/8, matching `totp-rs`'s own `6..=8` range).
    private static func grouped(_ code: String) -> String {
        guard code.count > 1 else { return code }
        let mid = code.index(code.startIndex, offsetBy: code.count / 2)
        return "\(code[..<mid]) \(code[mid...])"
    }

    /// CR-04 (38-REVIEW.md): `digits`/`period` trace back to decrypted item
    /// PLAINTEXT -- `ItemNormalize.swift`'s own header states plaintext is
    /// UNTRUSTED INPUT, and only `TotpValidation` range-checks it, only in
    /// the create/edit FORM, never on this render path.
    private enum TotpRenderError: Error {
        case outOfRangeParameters
    }

    /// Calls the real `pv-ffi` boundary -- `totpNow` is compiled directly
    /// into this app target (see `FfiRoundTripTests.swift`'s own header),
    /// so no import is needed beyond this file's own `import SwiftUI`.
    /// Wrapped in `Result` rather than `try?` so the caller can render a
    /// real error state instead of silently treating failure as "no
    /// value" (`try?` would make that distinction unrecoverable here).
    private static func currentCode(
        secretB32: String, algorithm: String, digits: Int, period: Int, unixTimeSeconds: UInt64
    ) -> Result<FfiTotpCode, Error> {
        Result {
            // `UInt32(_:)`/`UInt64(_:)` TRAP (uncatchable `fatalError`) on a
            // negative input -- this `Result { try ... }` wrapper does NOT
            // catch a trap, only a genuine `throw`. Convert with the
            // failable initializers FIRST, throwing an ordinary error on
            // out-of-range input so the `.failure` branch below (already
            // rendered, already tested) handles it instead of crashing.
            guard let digits32 = UInt32(exactly: digits), let period64 = UInt64(exactly: period) else {
                throw TotpRenderError.outOfRangeParameters
            }
            return try totpNow(
                secretB32: secretB32,
                algorithm: algorithm,
                digits: digits32,
                period: period64,
                unixTimeSeconds: unixTimeSeconds
            )
        }
    }
}
