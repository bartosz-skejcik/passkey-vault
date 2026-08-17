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
//  failure source (`38-RESEARCH.md` E-T1, step 2).
//

import SwiftUI

struct TotpCountdownView: View {
    let secretB32: String
    let algorithm: String
    let digits: Int
    let period: Int
    let issuer: String
    /// Reuses the detail screen's existing copy choke-point
    /// (`ItemDetailView.copySecret`) -- routes through `ClipboardService`
    /// and records the last-used touch, exactly like every other copy
    /// affordance on that screen. Copies the LIVE CODE (not the raw
    /// secret) -- a deliberate divergence from `web/.../DetailPanel.tsx`,
    /// which copies `item.fields.secret` under a button labelled "copy
    /// TOTP code" (an apparent bug there, not reproduced here: see
    /// `ios/IOS-SPIKE-LOG.md` §1f for the recorded reasoning).
    let onCopy: (String) -> Void

    private static let ringDiameter: CGFloat = 56
    private static let ringLineWidth: CGFloat = 2.3

    /// The ring turns `PVWarning` at this many seconds or fewer remaining.
    /// Design-conformance's own wording ("in its final seconds") does not
    /// name a number -- 5 is an author-chosen threshold, matching the
    /// convention Google Authenticator itself uses (the same reference
    /// point design-conformance names for this row).
    private static let warningThresholdSeconds: UInt64 = 5

    var body: some View {
        TimelineView(.periodic(from: Date(timeIntervalSince1970: Self.anchor(for: period)), by: 1)) { context in
            // Take the LATER of the scheduled date and the real clock --
            // never trust the schedule alone (Pitfall 5).
            let now = max(context.date.timeIntervalSince1970, Date().timeIntervalSince1970)
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

            HStack(spacing: 12) {
                ring(fraction: fraction, isWarning: isWarning, remainingSeconds: remainingSeconds)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: issuer.isEmpty ? "Authenticator" : issuer)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color("PVTextMuted"))
                    Text(verbatim: Self.grouped(code))
                        .font(.system(size: 31, weight: .semibold, design: .default))
                        .monospacedDigit()
                        .foregroundStyle(Color("PVAccent"))
                        .accessibilityIdentifier("vault.detail.totp.code")
                        .accessibilityValue(code)
                }
                Spacer(minLength: 0)
                Button {
                    onCopy(code)
                } label: {
                    Image(systemName: "doc.on.doc")
                        .foregroundStyle(Color("PVAccent"))
                }
                .accessibilityIdentifier("vault.detail.totp.copy")
                .accessibilityLabel("Copy code")
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
            .accessibilityIdentifier("vault.detail.totp.error")
        }
    }

    @ViewBuilder
    private func ring(fraction: Double, isWarning: Bool, remainingSeconds: UInt64) -> some View {
        ZStack {
            Circle()
                .stroke(Color("PVTextMuted").opacity(0.25), lineWidth: Self.ringLineWidth)
            // A trimmed ring, not a pie (design-conformance's own
            // wording): a partial stroke around the circle's
            // circumference, never a filled sector.
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(
                    isWarning ? Color("PVWarning") : Color("PVAccent"),
                    style: StrokeStyle(lineWidth: Self.ringLineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .frame(width: Self.ringDiameter, height: Self.ringDiameter)
        .accessibilityIdentifier("vault.detail.totp.remainingSeconds")
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
            try totpNow(
                secretB32: secretB32,
                algorithm: algorithm,
                digits: UInt32(digits),
                period: UInt64(period),
                unixTimeSeconds: unixTimeSeconds
            )
        }
    }
}
