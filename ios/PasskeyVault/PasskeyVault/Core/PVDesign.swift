//
//  PVDesign.swift
//  PasskeyVault
//
//  The approved screens' GEOMETRY, transcribed from the published artifact
//  "Passkey Vault iOS Screens" -- one place, so no screen re-guesses it.
//
//  WHY THIS FILE EXISTS. Every screen in Phase 38 was built by reading the
//  artifact's COPY and inventing its layout. Bartek's own words, 2026-08-17:
//  "guziki w auth nie są na dole, border radius jest inny, rozmiary guzikow są
//  inne, spacing jest inny." All four were correct, and all four numbers were
//  sitting in the artifact's stylesheet the whole time. The design spec's line
//  "the tokens and the structure are the contract; the pixels are an
//  illustration" was taken as licence to not read the pixels at all. It is not:
//  it means do not fight SwiftUI to match a mockup EXACTLY -- a 50pt-tall
//  button with a 12pt radius is structure, not a pixel.
//
//  The artifact renders a 393x852 phone scaled by `--s: .63` purely to fit its
//  card grid, so every `calc(Npx * var(--s))` is N DEVICE POINTS at full size.
//  The values below are those N, unscaled, each traceable to a CSS rule named
//  in its comment. If the artifact changes, change these and every screen
//  follows.
//

import SwiftUI

enum PVMetrics {
    // `.body{padding:0 calc(20px*var(--s))}` -- horizontal only. The vertical
    // rhythm comes from the elements, not from a uniform page inset, which is
    // why `.padding()` (16 on all four sides) was wrong in both directions.
    static let screenHPadding: CGFloat = 20

    // `.lgtitle{font-size:34; font-weight:700; margin:4 0 10; line-height:1.08}`
    static let titleSize: CGFloat = 34
    static let titleTopSpace: CGFloat = 4
    static let titleBottomSpace: CGFloat = 10

    // `.sub{font-size:15; margin:0 0 16}`
    static let subtitleSize: CGFloat = 15
    static let subtitleBottomSpace: CGFloat = 16

    // `.field{border-radius:11; padding:12 14; min-height:46; font-size:16}`
    static let fieldRadius: CGFloat = 11
    static let fieldHPadding: CGFloat = 14
    static let fieldVPadding: CGFloat = 12
    static let fieldMinHeight: CGFloat = 46

    // `.btn{border-radius:12; height:50; font-size:17; font-weight:600}`
    // NOT a capsule. A capsule was the single most visible geometry error --
    // `.buttonBorderShape(.capsule)` renders a 25pt radius where the design
    // asks for 12.
    static let buttonRadius: CGFloat = 12
    static let buttonHeight: CGFloat = 50
    static let buttonFontSize: CGFloat = 17

    // `.btn.ghost{height:44; font-weight:500}`
    static let ghostHeight: CGFloat = 44

    // `.stackv{gap:9}` -- the bottom action stack's internal gap.
    static let actionStackGap: CGFloat = 9

    // `.pad-b{padding-bottom:10}`
    static let actionStackBottomSpace: CGFloat = 10

    // `.slot{border-radius:11; padding:11 13; font-size:13.5; gap:9}`
    static let slotRadius: CGFloat = 11
    static let slotHPadding: CGFloat = 13
    static let slotVPadding: CGFloat = 11
    static let slotFontSize: CGFloat = 13.5
    static let slotGap: CGFloat = 9

    // `.grp{border-radius:11}` / `.row{padding:12 14; min-height:44}`
    static let groupRadius: CGFloat = 11
    static let rowMinHeight: CGFloat = 44

    // `.foot{font-size:13; padding:7 5 0}`
    static let footnoteSize: CGFloat = 13
    static let footnoteTopSpace: CGFloat = 7
    static let footnoteHPadding: CGFloat = 5

    // `.stackv{gap:9}` -- ALSO the field-to-field gap, not just the action
    // stack's. The artifact wraps the inputs in the same `.stackv` it wraps the
    // buttons in.
    static let fieldStackGap: CGFloat = 9

    // Auth's own title override: `<p class="lgtitle" style="margin-top:26">`.
    static let authTitleTopSpace: CGFloat = 26

    // `.field .ph{color:var(--pv-mut); opacity:.75}` -- the field's label IS
    // its placeholder, inside the surface block. There is no external label in
    // the approved screens; shipping one made the label read as a heading and
    // doubled the vertical rhythm.
    static let placeholderOpacity: CGFloat = 0.75

    // `.hero{padding-top:60; gap:6}` / `.mark{104x104, radius 23}`
    // / `.h1{font-size:30}` / `.p{font-size:15.5; max-width:280}`
    static let heroTopSpace: CGFloat = 60
    static let markSize: CGFloat = 104
    static let markRadius: CGFloat = 23
    static let heroTitleSize: CGFloat = 30
    static let heroBodySize: CGFloat = 15.5
    static let heroBodyMaxWidth: CGFloat = 280

    // `.dots{gap:7; padding:14 0}`
    static let dotsGap: CGFloat = 7
    static let dotsVPadding: CGFloat = 14
    static let dotSize: CGFloat = 7
}

// MARK: - Buttons

/// The filled primary. `PVAccent` fill, `PVOnAccent` label -- never `.white`,
/// which measures 3.34:1 on the dark-mode accent.
struct PVPrimaryButtonStyle: ButtonStyle {
    var isEnabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: PVMetrics.buttonFontSize, weight: .semibold))
            .foregroundStyle(Color("PVOnAccent"))
            .frame(maxWidth: .infinity)
            .frame(height: PVMetrics.buttonHeight)
            .background(
                RoundedRectangle(cornerRadius: PVMetrics.buttonRadius, style: .continuous)
                    .fill(Color("PVAccent"))
            )
            .opacity(configuration.isPressed ? 0.85 : (isEnabled ? 1.0 : 0.4))
            .contentShape(Rectangle())
    }
}

/// The ghost. Transparent, accent label, 44pt so it is still a comfortable
/// target while reading as secondary.
struct PVGhostButtonStyle: ButtonStyle {
    var isEnabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: PVMetrics.buttonFontSize, weight: .medium))
            .foregroundStyle(Color("PVAccent"))
            .frame(maxWidth: .infinity)
            .frame(height: PVMetrics.ghostHeight)
            .opacity(configuration.isPressed ? 0.6 : (isEnabled ? 1.0 : 0.4))
            .contentShape(Rectangle())
    }
}

// MARK: - Field chrome

extension View {
    /// `.field` -- a `PVSurface` block, not a bare underline.
    ///
    /// `frame(height:)`, not `minHeight`: every `.field` in the approved screens
    /// is exactly 46pt because each holds only a placeholder span. With
    /// `minHeight` the password row grew taller than the email row (its reveal
    /// button contributes a 44pt intrinsic height), so two inputs on the same
    /// form were visibly different sizes.
    func pvFieldChrome() -> some View {
        self
            .padding(.horizontal, PVMetrics.fieldHPadding)
            .frame(height: PVMetrics.fieldMinHeight)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: PVMetrics.fieldRadius, style: .continuous)
                    .fill(Color("PVSurface"))
            )
    }
}

// MARK: - Screen scaffold

/// The shape every full-screen flow in the approved artifact uses: content at
/// the top, a `flex:1` spacer, then the action stack at the bottom.
///
/// **The spacer is the whole point.** Without it the buttons sit directly under
/// the last field with a big empty gap below them, which is what shipped and is
/// the first thing Bartek named. `.body` is a flex column with `.spacer{flex:1}`
/// between the content and `.stackv`, so the actions are pinned to the bottom on
/// every screen regardless of how much content is above them.
struct PVScreenScaffold<Content: View, Actions: View>: View {
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
            // `.spacer{flex:1}`
            Spacer(minLength: PVMetrics.subtitleBottomSpace)
            // `.stackv{gap:9}` + `.pad-b{padding-bottom:10}`
            VStack(spacing: PVMetrics.actionStackGap) {
                actions
            }
            .padding(.bottom, PVMetrics.actionStackBottomSpace)
        }
        .padding(.horizontal, PVMetrics.screenHPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color("PVBackground"))
    }
}

/// The title + subtitle pair, with the artifact's own margins.
struct PVScreenTitle: View {
    let title: String
    var subtitle: String?
    /// Defaults to `.lgtitle`'s own `margin-top:4`. Auth overrides it to 26 with
    /// an inline style in the artifact, so it is a parameter rather than a
    /// constant.
    var topSpace: CGFloat = PVMetrics.titleTopSpace

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: title)
                .font(.system(size: PVMetrics.titleSize, weight: .bold))
                .foregroundStyle(Color("PVTextPrimary"))
                // `line-height:1.08` on a 34pt title.
                .lineSpacing(PVMetrics.titleSize * 0.08)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, topSpace)
                .padding(.bottom, PVMetrics.titleBottomSpace)
            if let subtitle {
                Text(verbatim: subtitle)
                    .font(.system(size: PVMetrics.subtitleSize))
                    .foregroundStyle(Color("PVTextMuted"))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, PVMetrics.subtitleBottomSpace)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
