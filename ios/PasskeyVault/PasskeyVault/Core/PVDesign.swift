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

    // Lock state 1/2's own hero: `.hero{padding-top:48}` with `.h1` overridden
    // to 24pt and `.p` (15.5pt, muted, max-width 280) as the subtitle. This is a
    // DIFFERENT layout from states 3-9, which are a left-aligned title over a
    // status slot and a password field. The design spec's "nine states, one
    // layout" holds for 3-9; 1 and 2 are the biometry-ready hero.
    static let lockHeroTopSpace: CGFloat = 48
    static let lockHeroTitleSize: CGFloat = 24
    static let faceIdGlyphSize: CGFloat = 56

    // `.dots{gap:7; padding:14 0}`
    static let dotsGap: CGFloat = 7
    static let dotsVPadding: CGFloat = 14
    static let dotSize: CGFloat = 7

    // MARK: - The dock (screens-vault.html, "iOS 26 dock" block)
    //
    // These come from `ios/brand/screens-vault.html`, NOT from `screens.html`
    // which the constants above transcribe -- the vault artifact is a second
    // file with its own stylesheet, and the dock only exists there. Same
    // scaling rule: every `calc(Npx * var(--s))` is N device points.
    //
    // The three the OS owns are deliberately absent: the tab bar's own height,
    // its horizontal inset, and the gap the system leaves under it. Those are
    // stock `TabView` geometry on iOS 26 and hard-coding a guess at them is
    // exactly the "invented layout" defect this whole file exists to stop.

    // `.acc{height:46; gap:9; padding:0 17; font-size:15.5}` -- the accessory
    // shelf's pill. `tabViewBottomAccessory` sizes the shelf from its content,
    // so this height is what the content asks for, not a frame imposed on it.
    static let dockShelfHeight: CGFloat = 46
    static let dockShelfGap: CGFloat = 9
    static let dockShelfHPadding: CGFloat = 17
    static let dockShelfFontSize: CGFloat = 15.5

    // `.cap{54x54}` + `.plus{font-size:23; font-weight:300}` -- the detached
    // action capsule and its glyph.
    static let dockCapsuleSize: CGFloat = 54
    static let dockPlusGlyphSize: CGFloat = 23

    // `.grid{border-radius:26; padding:16 10; grid-template-columns:repeat(3,1fr);
    //        gap:14 4}`
    static let dockGridRadius: CGFloat = 26
    static let dockGridVPadding: CGFloat = 16
    static let dockGridHPadding: CGFloat = 10
    static let dockGridRowGap: CGFloat = 14
    static let dockGridColumnGap: CGFloat = 4

    // `.ga{gap:7; font-size:11; line-height:1.25}` / `.ga .b{52x52; radius 99}`
    // / `.ga .b svg{22x22}`
    static let dockGridActionGap: CGFloat = 7
    static let dockGridActionFontSize: CGFloat = 11
    static let dockGridBubbleSize: CGFloat = 52
    static let dockGridGlyphSize: CGFloat = 22

    // MARK: The ＋ panel's placement
    //
    // NOT from the artifact -- the artifact draws the panel but cannot say how
    // far above a LIVE iOS 26 dock it sits, because the dock's height is the
    // OS's to decide and it CHANGES when the tab bar minimizes. So the vertical
    // placement is `dockInset + dockPanelGap`, where `dockInset` is measured at
    // runtime (`ItemListView`'s `DockInsetKey`) and only the gap is a constant.
    //
    // The gap is not decoration. Liquid Glass samples what is near it and
    // CANNOT sample other glass, so a panel whose glass card overlaps the
    // dock's glass produces mush rather than two crisp layers -- the research
    // probe's `07-zorder.png`. This is the geometric distance that prevents it.
    static let dockPanelGap: CGFloat = 8
    static let dockPanelHInset: CGFloat = 16

    // The HIG's own figure for a dark dimming layer over bright content behind
    // Clear glass (developer.apple.com/design/human-interface-guidelines/
    // materials). Applied in code rather than baked into the colorset because
    // `scripts/gen-ios-colorsets.py` writes `"alpha": "1.000"` for every token
    // by construction -- the catalog has no concept of a translucent token.
    static let dockScrimOpacity: CGFloat = 0.35

    // MARK: - TOTP rows (screens-vault.html, ".trow"/".pie"/".totp")
    //
    // Quick task 260818-irw: "the code is the row" -- the Codes tab's list
    // rows render the live TOTP code AS the row, not a generic
    // icon+title+chevron. These are the LIST row's own numbers, transcribed
    // from `.trow`/`.pie` in `ios/brand/screens-vault.html`; the DETAIL
    // block's numbers (`totpDetail*`/`totpRingDiameterDetail`) follow below.

    // `.trow{padding:calc(10px*var(--s)) calc(13px*var(--s));...
    // gap:calc(10px*var(--s))}`
    static let totpRowVPadding: CGFloat = 10
    static let totpRowHPadding: CGFloat = 13
    static let totpRowGap: CGFloat = 10

    // `.trow .tl{...gap:calc(2px*var(--s))}` -- the label-over-code column's
    // own internal gap.
    static let totpRowLabelGap: CGFloat = 2

    // `.trow .lbl{font-size:calc(12.5px*var(--s));...}`
    static let totpRowLabelFontSize: CGFloat = 12.5

    // `.trow .code{font-size:calc(31px*var(--s));font-weight:400;...
    // letter-spacing:calc(1.5px*var(--s));font-variant-numeric:tabular-nums}`
    static let totpRowCodeFontSize: CGFloat = 31
    static let totpRowCodeLetterSpacing: CGFloat = 1.5

    // `.pie{width:calc(21px*var(--s));height:calc(21px*var(--s));...}` --
    // the LIST ring.
    static let totpRingDiameterList: CGFloat = 21

    // `.pie circle{...stroke-width:2.3}` -- shared by both the list and
    // detail rings (relocated from `TotpCountdownView`'s own private
    // `ringLineWidth`, already numerically correct).
    static let totpRingStrokeWidth: CGFloat = 2.3

    // MARK: - TOTP detail block (screens-vault.html, ".totp"/30px ".pie")
    //
    // Task 2's own measured divergence: the DETAIL screen's composed TOTP
    // block drew a 56pt ring and a semibold 31pt code with no letter-
    // spacing against the drawing's 30pt ring / regular-weight 30pt
    // monospaced code / 3pt tracking.

    // `.totp{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    // font-size:calc(30px*var(--s));letter-spacing:calc(3px*var(--s));
    // font-variant-numeric:tabular-nums;...}`
    static let totpDetailCodeFontSize: CGFloat = 30
    static let totpDetailCodeLetterSpacing: CGFloat = 3

    // Detail cell's own `.pie{width:calc(30px*var(--s));height:calc(30px*
    // var(--s))}` override (the base `.pie` rule above is 21px, the LIST
    // size).
    static let totpRingDiameterDetail: CGFloat = 30

    // MARK: - Phase 40 additions (screens-vault.html, "Family, sharing and
    // settings" section) -- `40-UI-SPEC.md` §2. Added by plan 40-06, the
    // first plan to need a segmented control (invite expiry); 40-07/40-08
    // reuse `segTrackRadius`/`PVSegmentedControl` rather than redefining
    // them.

    // Invite link sheet + share sheet's segmented control -- `.seg{
    // border-radius:9;padding:2} .seg i{padding:5;border-radius:7} .seg
    // i.on{font-weight:600}`. ONE component (`PVSegmentedControl`,
    // `InviteCreateView.swift`), reused for: invite expiry (1h/24h/7d),
    // share scope (Person/Whole family), and share access level (3-way).
    static let segTrackRadius: CGFloat = 9
    static let segTrackPadding: CGFloat = 2
    static let segItemRadius: CGFloat = 7
    static let segItemVPadding: CGFloat = 5
    static let segFontSize: CGFloat = 13

    // MARK: - Detail screen header + rows (screens-vault.html, ".hdr"/".d"/
    // ".grp") -- design-conformance fix, Phase 40. `ItemDetailView` had
    // never been checked against this file's own detail-screen sections; it
    // read only the COPY out of an earlier drawing and built a flat,
    // uncarded `VStack` instead of the grouped `.grp` cards with `.d` rows
    // every screen in the artifact actually uses.

    // `.hdr{padding:10px 0 16px;gap:7px}`
    static let detailHeaderTopSpace: CGFloat = 10
    static let detailHeaderBottomSpace: CGFloat = 16
    static let detailHeaderGap: CGFloat = 7
    // `.hdr .big{width:58px;height:58px;border-radius:14px}` /
    // `.hdr .big svg{28x28}`
    static let detailHeaderIconSize: CGFloat = 58
    static let detailHeaderIconRadius: CGFloat = 14
    static let detailHeaderGlyphSize: CGFloat = 28
    // `.hdr .big.key{background:color-mix(in srgb,var(--pv-key) 15%,
    // transparent)}` -- the passkey teal wash.
    static let detailHeaderKeyTintOpacity: CGFloat = 0.15
    // `.hdr b{font-size:21px;font-weight:640}`
    static let detailTitleSize: CGFloat = 21
    // `.hdr span{font-size:13.5px}`
    static let detailSubtitleSize: CGFloat = 13.5

    // NOT from the CSS -- a PLATFORM workaround, not a design value. BUG
    // FOUND LIVE (design-conformance fix, Phase 40): `ItemDetailView` is
    // pushed with `.navigationBarTitleDisplayMode(.inline)` from a tab
    // root whose OWN `NavigationStack` carries the default `.large` title
    // (`ItemListView.swift:554`, no override) -- SwiftUI/iOS 26 does not
    // reliably reserve the pushed screen's own safe-area top inset in that
    // combination. Measured live (`ios/evidence/40/detail-conformance/`):
    // with only `PVMetrics.detailHeaderTopSpace` (10pt) of clearance, the
    // `.hdr` icon+title painted UNDER the status bar and the nav bar's own
    // Edit/Lock/avatar toolbar pills, only faintly visible through their
    // translucent material -- reproduced deterministically across
    // brand-new accounts (not a one-off transition glitch), and NOT fixed
    // by `.toolbarBackground(.visible, for: .navigationBar)` or a
    // zero-height `.safeAreaInset(edge: .top)`, both tried and screenshotted
    // first. This is the SMALLEST clearance that cleared the ghosting in
    // that same measurement pass (bisected from a 200pt value that
    // over-cleared it by a wide margin). Applied as its OWN spacer ABOVE
    // `.hdr`, not folded into `detailHeaderTopSpace`, so the CSS's own
    // number stays exactly what the drawing says if a future iOS build
    // fixes the underlying safe-area bug and this constant can drop to 0.
    static let detailToolbarClearance: CGFloat = 92

    // `.grp{border-radius:11px}` / `.grp + .grp{margin-top:14px}`
    static let detailGroupRadius: CGFloat = 11
    static let detailGroupSpacing: CGFloat = 14

    // `.d{padding:9px 12px;gap:2px}` / `.d .k{font-size:12px}` /
    // `.d .v{font-size:15.5px}` / `.d .v.mono{font-size:14px}`
    static let detailRowVPadding: CGFloat = 9
    static let detailRowHPadding: CGFloat = 12
    static let detailRowGap: CGFloat = 2
    static let detailKeyFontSize: CGFloat = 12
    static let detailValueFontSize: CGFloat = 15.5
    static let detailValueMonoFontSize: CGFloat = 14
    // `.d + .d{box-shadow:inset 0 .5px 0 var(--pv-sep)}` -- rendered as a
    // 0.5pt hairline `Rectangle` between consecutive rows (never above the
    // first or below the last), tinted `PVSeparator` at this opacity: the
    // colorset generator writes alpha 1.000 for every token by
    // construction (`PVScrim`'s own header explains why), so the CSS's
    // `rgba(...,.20)` translucency lives here, in code, exactly like the
    // dock scrim's `dockScrimOpacity` above.
    static let detailSeparatorOpacity: CGFloat = 0.20
    static let detailSeparatorWidth: CGFloat = 0.5

    // `.glab{font-size:12px;text-transform:uppercase;letter-spacing:.04em;
    // padding:14px 6px 5px}` -- the "Notes"/"Details"/"Secret"/"Advanced"
    // section labels above a group that is not the first on the screen.
    static let detailSectionLabelFontSize: CGFloat = 12
    static let detailSectionLabelTracking: CGFloat = 0.04
    static let detailSectionLabelTopSpace: CGFloat = 14
    static let detailSectionLabelHPadding: CGFloat = 6
    static let detailSectionLabelBottomSpace: CGFloat = 5
}

// MARK: - Detail screen grouped card

/// `.grp` -- a rounded `PVSurface` card; a `.d + .d` inset hairline is drawn
/// between each pair of consecutive rows, never above the first or below the
/// last. Rows are supplied as a plain array rather than `@ViewBuilder`
/// because the hairline placement needs to know exactly which rows
/// RENDERED after each call site's own emptiness filtering, not how many
/// `View`s appear in source -- design-conformance fix, Phase 40.
struct PVDetailGroup: View {
    let rows: [AnyView]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 {
                    Rectangle()
                        .fill(Color("PVSeparator").opacity(PVMetrics.detailSeparatorOpacity))
                        .frame(height: PVMetrics.detailSeparatorWidth)
                }
                row
            }
        }
        .background(Color("PVSurface"))
        .clipShape(RoundedRectangle(cornerRadius: PVMetrics.detailGroupRadius, style: .continuous))
    }
}

/// `.glab` -- the uppercase section label above every `.grp` that is not the
/// screen's first (e.g. "Notes", "Details", "Secret", "Advanced").
struct PVDetailSectionLabel: View {
    let title: String

    var body: some View {
        Text(verbatim: title.uppercased())
            .font(.system(size: PVMetrics.detailSectionLabelFontSize))
            .tracking(PVMetrics.detailSectionLabelFontSize * PVMetrics.detailSectionLabelTracking)
            .foregroundStyle(Color("PVTextMuted"))
            .padding(.horizontal, PVMetrics.detailSectionLabelHPadding)
            .padding(.top, PVMetrics.detailSectionLabelTopSpace)
            .padding(.bottom, PVMetrics.detailSectionLabelBottomSpace)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// `.d` -- label (`.k`, 12pt muted) above value (`.v`, 15.5pt, or `.v.mono`
/// 14pt monospace), with an optional trailing action rendered exactly like
/// `.d.act .v` (same size as the value, `PVAccent` colour) -- design-
/// conformance fix, Phase 40. `label` may be empty (the note body / address
/// rows draw no `.k` at all in the approved screens); `key` stays `nil` to
/// skip the `.k` line entirely rather than reserve blank space for it.
struct PVDetailRow: View {
    var label: String?
    let value: String
    var isMono: Bool = false
    var accessibilityId: String?
    /// A muted line below the value -- the hidden-password recipient note
    /// is the one caller today; kept generic rather than named for that one
    /// use so a second caller does not need a second parameter.
    var footnote: String?
    var footnoteAccessibilityId: String?
    /// Deliberately NOT `@ViewBuilder` -- every call site already supplies
    /// a single `AnyView(...)`-wrapped expression (branching, when needed,
    /// is resolved to a plain `AnyView` value BEFORE the closure literal,
    /// e.g. `plainRow`'s own `trailingView` below), so this stays a bare
    /// closure rather than risk a result-builder `_ConditionalContent`
    /// that does not itself coerce to the declared `AnyView` return type.
    var trailing: () -> AnyView

    init(
        label: String? = nil, value: String, isMono: Bool = false, accessibilityId: String? = nil,
        footnote: String? = nil, footnoteAccessibilityId: String? = nil,
        trailing: @escaping () -> AnyView = { AnyView(EmptyView()) }
    ) {
        self.label = label
        self.value = value
        self.isMono = isMono
        self.accessibilityId = accessibilityId
        self.footnote = footnote
        self.footnoteAccessibilityId = footnoteAccessibilityId
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: PVMetrics.detailRowGap) {
                if let label, !label.isEmpty {
                    Text(verbatim: label)
                        .font(.system(size: PVMetrics.detailKeyFontSize))
                        .foregroundStyle(Color("PVTextMuted"))
                }
                Text(verbatim: value)
                    .font(
                        isMono
                            ? .system(size: PVMetrics.detailValueMonoFontSize).monospaced()
                            : .system(size: PVMetrics.detailValueFontSize)
                    )
                    .foregroundStyle(Color("PVTextPrimary"))
                    .textSelection(.enabled)
                    .modifier(OptionalAccessibilityIdentifier(id: accessibilityId))
                if let footnote {
                    Text(verbatim: footnote)
                        .font(.caption2)
                        .foregroundStyle(Color("PVTextMuted"))
                        .modifier(OptionalAccessibilityIdentifier(id: footnoteAccessibilityId))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .padding(.horizontal, PVMetrics.detailRowHPadding)
        .padding(.vertical, PVMetrics.detailRowVPadding)
    }
}

/// `.d.act .v` -- the trailing action text ("Copy", "Reveal", "Hide",
/// "Open", "Copy code" …), styled identically to the row's own value
/// (`.d .v`'s 15.5pt) but in `PVAccent`. A real `Button`, not a `Text` with
/// a gesture, so VoiceOver/XCUITest activation keeps working exactly like
/// the icon buttons it replaces.
struct PVDetailAction: View {
    let title: String
    let action: () -> Void
    var accessibilityId: String?
    var accessibilityLabel: String?

    var body: some View {
        Button(action: action) {
            Text(verbatim: title)
                .font(.system(size: PVMetrics.detailValueFontSize))
                .foregroundStyle(Color("PVAccent"))
        }
        .buttonStyle(.plain)
        .modifier(OptionalAccessibilityIdentifier(id: accessibilityId))
        .modifier(OptionalAccessibilityLabel(label: accessibilityLabel))
    }
}

private struct OptionalAccessibilityIdentifier: ViewModifier {
    let id: String?
    func body(content: Content) -> some View {
        if let id {
            content.accessibilityIdentifier(id)
        } else {
            content
        }
    }
}

private struct OptionalAccessibilityLabel: ViewModifier {
    let label: String?
    func body(content: Content) -> some View {
        if let label {
            content.accessibilityLabel(label)
        } else {
            content
        }
    }
}

// MARK: - Dock glass

extension View {
    /// The floating-glass ground for the two dock surfaces the OS does NOT
    /// render for us -- the detached ＋ capsule and the ＋ action grid.
    ///
    /// The tab bar and the accessory shelf are stock `TabView` chrome and get
    /// their glass free; these two do not exist as stock controls, so they
    /// need the material applied explicitly. `glassEffect(_:in:)` is the stock
    /// API for it and lives in **SwiftUICore, not SwiftUI** -- grepping
    /// `SwiftUI.swiftinterface` for it returns nothing, which reads exactly
    /// like "the API does not exist" and has already produced that wrong
    /// conclusion once in this repo (landmine L-1's shape). It is real, and it
    /// is iOS 26.0+, so the floor gets `.regularMaterial`, which is the same
    /// blur-and-tint idea expressed with an API that exists on iOS 18.
    ///
    /// This is the sanctioned way to get glass, NOT a hand-rolled one: no
    /// `.blur`, no stacked translucent fills, no `UIVisualEffectView` bridge.
    ///
    /// `interactive` selects `Glass.interactive()`, which makes the material
    /// respond to touch by scaling and brightening. Correct for a single control
    /// that IS the tap target; wrong for a container of controls, where it reads
    /// as the whole panel being one button. The ＋ panel passes `false`.
    ///
    /// **NEVER apply this to anything the system already draws glass for** --
    /// tab labels, toolbar items, or `tabViewBottomAccessory` content. That is
    /// two glass layers on one control and it is photographed failing in
    /// `ios/evidence/38/38-06-dock-glass-on-glass.png`.
    func pvDockGlass<S: Shape>(in shape: S, interactive: Bool = true) -> some View {
        modifier(PVDockGlass(shape: shape, interactive: interactive))
    }
}

private struct PVDockGlass<S: Shape>: ViewModifier {
    let shape: S
    let interactive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
        }
    }
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
