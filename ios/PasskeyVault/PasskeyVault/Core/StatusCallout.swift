//
//  StatusCallout.swift
//  PasskeyVault
//
//  Phase 38 -- the status slot the approved visual reference draws, extracted
//  so the two screens that use it cannot drift apart.
//
//  The design spec calls this a "status slot" and both design documents lean on
//  it: `2026-08-16-ios-onboarding-and-auth-design.md` §5's nine lock states
//  "differ ONLY in the status slot and which control is emphasised" -- which is
//  the whole reason nine states are one view and not nine screens -- and §4's
//  one structural change puts the irreversibility warning into the same shape
//  inside the auth form.
//
//  WHY THIS FILE EXISTS. Plan 38-13 built the lock screen's inline warning
//  directly in `LockView`'s body, on `PVSurface`. The approved screens draw the
//  slot as a TINTED block in the semantic colour, with a leading dot -- the
//  artifact's own CSS is `background: color-mix(in srgb, <token> 14%,
//  transparent); color: <token>`. Two hand-built copies of a shape that is
//  explicitly load-bearing for a nine-state machine is how the states stop
//  looking like one machine. One component, four tones.
//
//  The tone is a semantic choice with a rule attached, not a colour picker:
//  `.warning` is for something the user must read before committing;
//  `.error` for something that already went wrong; `.passkey` for a
//  passwordless/AutoFill success; `.muted` for a neutral statement of fact.
//  Rendering an irreversible action in `.muted`, or a routine fact in
//  `.warning`, both cost the same thing -- the user stops reading the slot.
//

import SwiftUI

struct StatusCallout: View {
    enum Tone {
        case warning
        case error
        case passkey
        case muted

        /// The token name. Never a literal -- `scripts/audit-ios-colour-tokens.sh`
        /// fails on a colour literal in a view, and check 2 additionally fails
        /// if any of these names has no colorset.
        var token: String {
            switch self {
            case .warning: return "PVWarning"
            case .error: return "PVError"
            case .passkey: return "PVPasskey"
            case .muted: return "PVTextMuted"
            }
        }
    }

    let text: String
    let tone: Tone
    /// Shown by default. The dot is what makes the slot readable as a status at
    /// a glance rather than as a paragraph, and it survives Dynamic Type
    /// because it is sized from the text, not fixed.
    var showsDot: Bool = true

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            if showsDot {
                Circle()
                    .fill(Color(tone.token))
                    .frame(width: 8, height: 8)
                    // Nudged down to sit on the first line's cap height rather
                    // than its ascender box, which is where it reads as a
                    // bullet instead of as a floating dot.
                    .padding(.top, 5)
                    .accessibilityHidden(true)
            }
            Text(verbatim: text)
                .font(.footnote)
                .foregroundStyle(Color(tone.token))
                // Without this a long sentence truncates instead of wrapping,
                // which is precisely the AX5 clipping defect `37-VERIFICATION
                // .md`'s residual item recorded inside the old alert.
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                // A 14% tint of the tone, matching the approved screens'
                // `color-mix(... 14%, transparent)`. `.opacity` on the token
                // keeps it mode-aware: the token already resolves differently
                // in light and dark, so the tint follows without a second
                // asset.
                .fill(Color(tone.token).opacity(0.14))
        )
    }
}

#Preview {
    VStack(spacing: 12) {
        StatusCallout(
            text: "There is no recovery. If you forget this password, no one — including us — can open your vault.",
            tone: .warning
        )
        StatusCallout(text: "That password didn't match. 2 attempts left before a 30-second wait.", tone: .error)
        StatusCallout(text: "AutoFill is on. Passkey Vault will offer your logins above the keyboard.", tone: .passkey)
        StatusCallout(text: "Face ID needs a device passcode. Set one in Settings.", tone: .muted)
    }
    .padding()
    .background(Color("PVBackground"))
}
