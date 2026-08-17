# The Bevel ＋ panel — how it is built, and how we reproduce it

**Status:** research only. No app code changed by this document.
**Date:** 2026-08-17
**Follow-up to:** `ios/DOCK-RESEARCH.md` (read that first — this document assumes its §1–§5 and corrects one symbol name in its §6).
**Toolchain:** Xcode 26.6 (17F113), iPhoneOS26.5.sdk / iPhoneSimulator26.5.sdk.
**Probe device:** `PV-iPhone16` (`34992BB7-4982-4915-92C7-C7FC987802AF`), iPhone 16, **393 × 852 pt**, iOS 26.5. Debug only.
**Deployment floor of this project:** `IPHONEOS_DEPLOYMENT_TARGET = 18.0`.

## I built a probe and it renders

A throwaway single-file SwiftUI app (compiled with `xcrun swiftc -parse-as-library`, no `.xcodeproj`) reproduces the whole thing on the iPhone 16 simulator: 4-tab dock, detached ＋ that becomes ✕, accessory pill, a 3×3 glass action panel floating above the dock, content behind dimmed, dock un-dimmed, tab bar still live. Every state was selected by an env var (`SIMCTL_CHILD_PROBE_*`) so each screenshot is deterministic and re-runnable.

Probe source and screenshots live in this session's scratchpad (not committed, per instruction to commit one file):
`…/scratchpad/probe/main.swift`, `…/scratchpad/probe/shots/01-abovedock.png` … `08-keyboard-fixed.png`, `…/scratchpad/probe/filmstrip-tab.png`.

Shot index, because each one is load-bearing below:

| shot | what it proves |
|---|---|
| `01-abovedock.png` | the target result: panel above dock, content dimmed, **dock un-dimmed**, ＋→✕ |
| `02-full.png` | full-bleed scrim → the dock's Liquid Glass **samples the scrim and goes grey** |
| `03-glass2.png` | `glassEffect` around a `GlassEffectContainer` → **inner glass is destroyed** |
| `04-sheet.png` | `.sheet` + detents + `presentationBackgroundInteraction` → **sheet covers the dock** |
| `05-keyboard.png` | keyboard inflates the derived inset 139 → 335 pt, panel shoved off-screen |
| `06-plaincard-gradient.png` | **the recommended shape**: one glass card, plain circles, gradient scrim |
| `07-zorder.png` | with zero bottom padding the panel draws **over** pill and tab bar → overlay is above the dock in z-order |
| `08-keyboard-fixed.png` | the keyboard mitigation **failed**; see §5 |
| `filmstrip-tab.png` | 24 tiled video frames showing the ＋→✕ **mid-transition inside the tab bar** |

Additionally, one interaction was driven by hand rather than env var: with the panel open I tapped **Logins** in the tab bar. The tab switched, the title changed, the selection pill moved, and the panel stayed open. The tab bar is fully live behind the panel.

---

## Answers

### 1. What stock presentation puts a panel above the tab bar, tab bar interactive and un-dimmed?

**None. There is no stock *presentation* for this.** `DOCK-RESEARCH.md`'s conclusion — `.overlay(alignment: .bottom)` on the `TabView`, containing glass content — is **CONFIRMED**, and the `.sheet` alternative is **REFUTED empirically**.

**VERIFIED — the overlay works, and draws above the dock.**
`.overlay(alignment: .bottom)` applied to the `TabView` renders after the tab bar, so it is above it in z-order. Proved by removing the bottom padding: the panel then covered the accessory pill and the tab capsule (`07-zorder.png`). With the padding restored the panel sits above the dock and the dock is untouched and tappable (`01-abovedock.png`, plus the hand-driven Logins tap). Cost: **you own the geometry.** The overlay is outside the tab content, so it does *not* inherit the dock's safe-area inset — you must hoist it (§5). Nothing stops you from covering the dock, and nothing tracks the dock's minimize animation for you.

**VERIFIED — `.sheet` cannot do it.** `04-sheet.png` shows the probe with

```swift
.presentationDetents([.fraction(0.66)])
.presentationBackgroundInteraction(.enabled(upThrough: .fraction(0.66)))
```

The scrim *is* removed and the content above the sheet stays bright and live — that half works. But the sheet is anchored to the bottom of the screen, so **at any detent tall enough to hold a 3×3 grid the sheet covers the dock completely**: in the screenshot the accessory pill and the tab bar are visible only as blurred smears *behind* the sheet's own Liquid Glass. Wrong shape, and unfixable — a detent is a height from the bottom edge; there is no "inset the sheet upward by the dock height" knob. `presentationSizing(_:)` (`SwiftUI.swiftinterface:10481`, iOS 18.0) does not reposition a compact-width bottom sheet either.

Costs side by side:

| | `.overlay(alignment: .bottom)` | `.sheet` + detents + backgroundInteraction |
|---|---|---|
| dock visible | **yes** | **no — covered** |
| dock interactive | **yes** (verified) | no (obscured) |
| scrim | you build it, so you control what it covers | all-or-nothing: system scrim, or none |
| geometry | you own it, incl. dock inset and keyboard | system owns it |
| drag-to-dismiss, rubber-banding, VoiceOver modality | you build it | free |
| iOS floor | `.overlay` is ancient; the glass is 26.0 | 16.4 |

Signatures, all verified in the SDK:
`presentationDetents(_:)` — `SwiftUI.swiftinterface:20879`, `@available(iOS 16.0, …)` at :20877.
`presentationBackgroundInteraction(_:)` — `:20888`, `@available(iOS 16.4, …)` at :20886.
`PresentationBackgroundInteraction` — `:20955`, cases `automatic` :20956, `enabled` :20959, `enabled(upThrough:)` :20962, `disabled` :20963.
`PresentationDetent` — `:20900`, `.medium` :20901, `.large` :20902, `.fraction(_:)` :20903, `.height(_:)` :20904.
Apple's own canonical pairing is `presentationDetents([.height(120), .medium, .large])` with `presentationBackgroundInteraction(.enabled(upThrough: .height(120)))` — <https://developer.apple.com/documentation/swiftui/view/presentationbackgroundinteraction(_:)>. Note the shape of that example: interaction is granted only at the *small* detent, i.e. Apple's model is "a short shelf you can reach past", not "a tall panel above a live tab bar".

**INFERRED — Apple expects a modal to cover the tab bar.** The HIG tab-bars page states the tab bar should remain visible as people navigate, with modal views as the stated exception (paraphrased; <https://developer.apple.com/design/human-interface-guidelines/tab-bars>). So keeping the tab bar live above a panel is a deliberate deviation, which is exactly why no presentation API offers it.

Also ruled out, unchanged from `DOCK-RESEARCH.md` §6: the bottom accessory (fixed 48 pt content box, clips), `.popover` (adapts to a sheet on iPhone; forced, it brings arrow chrome), `Menu` (renders a list, not a grid of round buttons).

---

### 2. How is the content dimmed without dimming the dock? Which view gets the scrim?

**VERIFIED. The scrim goes inside the tab content, and must respect that content's own bottom safe-area inset.** Not on the `TabView`.

The mechanism is one measured fact: **the tab content's bottom safe-area inset is exactly the dock — 139.0 pt on iPhone 16 with the dock expanded** (accessory + tab bar + home-indicator gap). So a scrim placed in the tab content with `.ignoresSafeArea(edges: .top)` and *nothing* on the bottom edge ends precisely at the dock's top edge. One line, no magic number:

```swift
Color.black.opacity(0.35).ignoresSafeArea(edges: .top)
```

`01-abovedock.png`: content dimmed, dock crisp white.

**The failure mode this avoids is real and photographed.** If the scrim is full-bleed (`.ignoresSafeArea()`), Liquid Glass samples what is behind it, so the dock's glass darkens *with* the content: in `02-full.png` the accessory pill and the tab capsule are visibly grey where in `01` they are white. **The dock is not immune to a scrim drawn underneath it — glass is not opaque.** This is the whole reason the scrim's bottom edge matters.

A scrim on the `TabView` (`.overlay { Color.black.opacity… }`) dims the dock outright — it draws above the tab bar. Rejected.

**Cost of the correct version, and the fix.** Stopping the scrim at the dock's top leaves an un-dimmed band across the bottom 139 pt, with a hard horizontal edge. Replacing the flat colour with a `LinearGradient` that fades to zero over the last ~20% removes the edge; `06-plaincard-gradient.png` is that version and it is the best-looking of the eight. A `Rectangle().fill(.ultraThinMaterial)` also works if you want blur-plus-dim rather than dim alone (`Material` — `SwiftUICore.swiftinterface:6305`).

**There is no stock scrim API.** `grep -in "scrim\|dimming\|dimmed"` over the whole of `SwiftUI.swiftinterface` and `SwiftUICore.swiftinterface` returns **zero hits**; the same grep over every header in `UIKit.framework/Headers/` returns only unrelated matches (`UISplitViewController.h:24`, `UIZoomTransitionOptions.h:31` `dimmingColor`, `UIScreen.h:77` `wantsSoftwareDimming`). A sheet's dimming is internal and not exposed. So hand-rolling the scrim is not a shortcut, it is the only option.

**INFERRED, and it supports this design:** WWDC25 session 356 *Get to know the new design system* describes pairing Liquid Glass with a dimming layer to signal modality, versus glass alone when a task runs in parallel without interrupting flow (paraphrased; <https://developer.apple.com/videos/play/wwdc2025/356/>). Dim the content, leave the navigation layer bright — that is Apple's own framing of this exact choice. The HIG Materials page adds a concrete number for the adjacent case: over bright content behind *Clear* glass, a dark dimming layer at **35 % opacity** (<https://developer.apple.com/design/human-interface-guidelines/materials>). Our 0.35 matches by coincidence; keep it.

---

### 3. What produces the ＋ → ✕ morph in place? Does `.contentTransition(.symbolEffect(.replace))` work inside a `Tab(role: .search)` label?

**VERIFIED — yes, and the animation genuinely renders inside the tab bar.**

Screenshots could not prove this: every still I took showed the glyph already fully swapped, because the replace effect runs on its own short timeline (a few hundred ms) and ignored both `.speed(0.06)` and an 8-second enclosing `.linear` animation. So I recorded video instead (`xcrun simctl io … recordVideo`), cropped the ＋ circle, and tiled every third frame. `filmstrip-tab.png` shows the sequence unambiguously: solid ＋ → pale ＋ → pale ✕ → solid ✕, **in the tab bar's own detached circle**, same position, same size. Mid-transition frames exist. The effect is real, not an instant swap.

The code that produced it:

```swift
Tab(value: PVTab.add, role: .search) {
    Color.clear
} label: {
    Label {
        Text("Add item")
    } icon: {
        Image(systemName: open ? "xmark" : "plus")
            .contentTransition(.symbolEffect(.replace))
    }
    .accessibilityLabel(open ? "Close actions" : "Add item")
}
```

Two implementation requirements, both load-bearing:

1. **One `Image` whose `systemName` changes** — not two `Image`s in an `if`/`else`. Replace is a *content* transition, so it needs the same view identity across the change. This is the pattern Apple demonstrates in WWDC23 session 10258 *Animate symbols in your app* (<https://developer.apple.com/videos/play/wwdc2023/10258/>).
2. **Use the `Label { } icon: { }` form**, so the modifier lands on the `Image` and not on the whole `Label`.

Availability — all comfortably below our 18.0 floor:

| symbol | SDK line | floor |
|---|---|---|
| `contentTransition(_:)` | `SwiftUICore.swiftinterface:15815` | iOS 16.0 (:15795) |
| `ContentTransition` | `SwiftUICore.swiftinterface:15800` | iOS 16.0 |
| `ContentTransition.symbolEffect(_:options:)` | `SwiftUI.swiftinterface:4358` | **iOS 17.0** (:4357) |
| `SymbolEffect.replace` / `ReplaceSymbolEffect` | `Symbols.swiftinterface:222` / `:229` | **iOS 17.0** (:220) |
| `ReplaceSymbolEffect: ContentTransitionSymbolEffect` | `Symbols.swiftinterface:573` | iOS 17.0 |
| `.replace.downUp` / `.upUp` / `.offUp` / `.byLayer` / `.wholeSymbol` (instance) | `Symbols.swiftinterface:232`–`:244` | iOS 17.0 |
| `ReplaceSymbolEffect.MagicReplace`, `.magic(fallback:)`, static `.downUp`/`.upUp`/`.offUp` | `Symbols.swiftinterface:393`, `:408`, `:410`–`:418` | **iOS 18.0** |
| `SymbolEffectOptions.speed(_:)` | `Symbols.swiftinterface:493`–`:494` | iOS 17.0 |

Since iOS 18, plain `.replace` resolves to Magic Replace where the two symbols are related, falling back otherwise (WWDC24 session 10188 *What's new in SF Symbols 6*, <https://developer.apple.com/videos/play/wwdc2024/10188/>). `plus` and `xmark` are unrelated, so what the filmstrip shows is the fallback — a cross-fade at this glyph size. If you want a directional fallback, spell it: `.symbolEffect(.replace.magic(fallback: .offUp))` (18.0+). Cosmetic, not required.

**Caveat carried over from `DOCK-RESEARCH.md` §4, unchanged:** the slot is semantically *search*. Set the accessibility label explicitly, as above.

---

### 4. `GlassEffectContainer` and `glassEffect(_:in:)` — module, availability, and how not to stack glass

**VERIFIED — the module. This is the trap, and here is why it keeps catching us.**

Both symbols are declared in **`SwiftUICore.swiftinterface`**, and `SwiftUI.swiftinterface` contains no declaration of them at all. Grepping `SwiftUI.swiftinterface` for `glassEffect` returns nothing but the button style, which reads exactly like "the API does not exist". It does exist. Three facts settle it:

- `SwiftUI.swiftinterface:17` — `@_exported import SwiftUICore`. So `import SwiftUI` gives you every SwiftUICore symbol.
- `SwiftUICore.swiftinterface:3` — the module is built with `-module-abi-name SwiftUI -module-name SwiftUICore`.
- `SwiftUICore.swiftinterface:4` — `-public-module-name SwiftUI`. That is why Apple's documentation files these under *SwiftUI* while the interface file says `SwiftUICore`.

Corroborating detail: `GlassEffectContainer`'s `Body` typealias mangles to `$s7SwiftUI20GlassEffectContainerV4bodyQrvp` (`SwiftUICore.swiftinterface:9052`) — `7SwiftUI`, not `SwiftUICore`.

**Rule for anyone auditing glass symbols in future: grep both interfaces, or grep the parent directory. Never conclude absence from `SwiftUI.swiftinterface` alone.**

**VERIFIED — exact availability.** Every glass symbol is `@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)` with `@available(visionOS, unavailable)` — note visionOS is explicitly *unavailable*, not 26.0:

| symbol | file:line |
|---|---|
| `glassEffect(_ glass: Glass = .regular, in shape: some Shape = DefaultGlassEffectShape())` | `SwiftUICore.swiftinterface:2529` (avail :2527–2528) |
| `DefaultGlassEffectShape` | `SwiftUICore.swiftinterface:2534` |
| `GlassEffectContainer<Content>` / `init(spacing: CGFloat? = nil, content:)` | `SwiftUICore.swiftinterface:9045` / `:9046` |
| `glassEffectID(_:in:)` | `SwiftUICore.swiftinterface:17315` |
| `glassEffectUnion(id:namespace:)` | `SwiftUICore.swiftinterface:9880` |
| `glassEffectTransition(_:)`, `GlassEffectTransition` (`.matchedGeometry` / `.materialize` / `.identity`) | `SwiftUICore.swiftinterface:2861` / `:2847`–`:2854` |
| `Glass` (`.regular` / `.clear` / `.identity`, `.tint(_:)`, `.interactive(_:)`) | `SwiftUICore.swiftinterface:5753`–`:5764` |
| `GlassButtonStyle` / `.buttonStyle(.glass)` | `SwiftUI.swiftinterface:1215` / `:1208` — **this one really is in SwiftUI** |

**Correction to `DOCK-RESEARCH.md` §6:** it lists `glassEffectUnion(id:in:)`. The real argument label is **`namespace:`**, not `in:` — `glassEffectUnion(id: (some (Hashable & Sendable))?, namespace: SwiftUICore.Namespace.ID)` at `SwiftUICore.swiftinterface:9880`. Only `glassEffectID` uses `in:`. Copying the old line will not compile.

**VERIFIED — what the container actually does, and what it does not fix.**

The container's job is to give sibling glass elements one shared sampling region. WWDC25 session 323 explains the reason: glass samples and reflects content from an area larger than itself, but **glass cannot sample other glass**, so separate uncontained `glassEffect()` calls near each other render inconsistently (paraphrased; <https://developer.apple.com/videos/play/wwdc2025/323/>). `spacing:` controls how close two glass shapes must be before their shapes blend; a container spacing larger than the interior stack's own spacing makes elements blend at rest (<https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views>). `glassEffectID` + `glassEffectTransition(.matchedGeometry)` is what makes them morph individually.

**A container does not license nesting.** Apple's rule, and the one quote I will reproduce here: *"always avoid glass on glass."* (WWDC25 session 219, *Meet Liquid Glass*, <https://developer.apple.com/videos/play/wwdc2025/219/>.) The surrounding guidance, paraphrased: when something sits on top of glass, do not make that thing glass too — use fills, transparency and vibrancy so the top layer reads as part of the glass below it; glass belongs to the navigation layer floating above content, not to the content layer. The HIG Materials page says the same in writing: keep Liquid Glass out of the content layer, and use it on custom controls sparingly, limited to the most important functional elements (<https://developer.apple.com/design/human-interface-guidelines/materials>).

**The two glass-on-glass failures we have actually photographed.** They are different, and both matter:

1. **`ios/evidence/38/38-06-dock-glass-on-glass.png`** (Phase 38, pre-existing). A ＋ button with its own glass, placed on/overlapping the system bottom accessory's glass. You can see the button's separate lighter capsule cutting across the pill's rounded edge. **Two glass layers on one control.** Cause: putting custom glass on a surface the system already draws glass for.
2. **`shots/03-glass2.png`** (this probe). `ActionGrid` wrapped in `.glassEffect(.regular, in: .rect(cornerRadius: 36))` *around* a `GlassEffectContainer` of `.buttonStyle(.glass)` circles. The result is not two crisp layers — **the nine inner circles lose their glass entirely** and read as flat ghost discs on a card. Nesting does not stack, it collapses.

**How to avoid it — three rules, each with the shot that backs it.**

- **Rule A. Never put glass on anything the system already draws glass for.** No `.glassEffect` and no `.buttonStyle(.glass)` on the accessory content, on tab labels, or on toolbar items. Fixes failure 1. The probe's `AskPill` carries a comment to this effect and renders correctly in all eight shots.
- **Rule B. Exactly one glass layer in your panel — pick the card *or* the circles, never both.** Bartek's observation of Bevel is a *rounded glass card*, so the card is the glass layer and the circles inside it must be plain: `Circle().fill(.quaternary)` behind a `.buttonStyle(.plain)` button. That is `06-plaincard-gradient.png` and it is the closest match to the described Bevel panel. (The inverse — nine glass circles, no card — is also correct and is `01-abovedock.png`. Both are legal; the card version matches Bevel.)
- **Rule C. Keep geometric distance between your glass and the dock's glass.** In `07-zorder.png` the panel's glass card overlaps the dock and samples it; the result is mush. The panel's bottom edge must clear the dock — which is §5's inset, doing double duty.

`GlassEffectContainer` is still worth keeping around the grid even when the circles are plain, because it is what `glassEffectID` needs for the open/close morph. On performance: the *Applying Liquid Glass to custom views* article warns that too many containers, and too many glass effects applied outside containers, degrades performance and should be limited on screen at once. Nine circles in one container is well inside that.

---

### 5. Does the panel need to avoid the keyboard and the safe area? What handles it?

**Safe area: yes, and nothing handles it for you. VERIFIED.**

The overlay is attached to the `TabView`, which is *outside* the tab content, so it does not receive the dock's 139 pt inset. Hoist it: measure `GeometryProxy.safeAreaInsets.bottom` inside the tab content, publish it up (`@State` in the probe, a `PreferenceKey` in real code), and use it as the overlay's bottom padding. Measured **139.0 pt** on iPhone 16 with the dock expanded — the same number `DOCK-RESEARCH.md` measured on iPhone 17, which is mild evidence the dock height is constant across current iPhones, but do not hardcode it: it changes when the tab bar minimizes.

`safeAreaInset(edge:alignment:spacing:content:)` — `SwiftUICore.swiftinterface:18769`. `SafeAreaRegions` — `:18249`, with `static let keyboard` at `:18253`.

**Keyboard: yes, and this is where I have a negative result rather than a fix.**

SwiftUI folds the keyboard into the same safe-area region, so the naive derivation breaks: the probe logged `safeBottom 139.0 -> 335.0` when a `TextField` took focus (keyboard = 196 pt), and the panel was pushed most of the way off the top of the screen (`05-keyboard.png`).

I tried two mitigations. **The measurement fix works; the positioning fix does not.**

- **Works:** a second, nested `GeometryReader` wrapped in `.ignoresSafeArea(.keyboard)` reports the dock-only inset. Logged side by side: `dockOnly -> 139.0` while `safeBottom 139.0 -> 335.0`. So you can obtain a keyboard-immune 139.
- **Does not work:** using that 139 as the padding, plus `.ignoresSafeArea(.keyboard, edges: .bottom)` on the overlay content, still left the panel displaced (`08-keyboard-fixed.png`). Keyboard avoidance shrinks the container the overlay is aligned within, so correcting the padding cannot compensate. Applying `.ignoresSafeArea(.keyboard)` to the whole `TabView` would fight the tab content's own keyboard avoidance and was not tried.

**Recommendation: make the panel and the keyboard mutually exclusive, in the state machine rather than in layout.** Dismiss focus when the panel opens, and close the panel when the keyboard appears. This is also the correct product behaviour — the panel is a launcher for creating items, and it has no business overlapping a keyboard. Cheap enough that the layout problem never arises. Relevant if you ever need the other direction: `scrollDismissesKeyboard(_:)` at `SwiftUI.swiftinterface:11856`.

---

### 6. iOS 18.0 fallback

**The good news, and it is better than `DOCK-RESEARCH.md` §7 assumed: the panel itself needs no fallback. Only its material and the ＋'s host do.**

Every mechanism in §1–§5 predates iOS 26. Verified floors: `.overlay(alignment:)` (13.0), `GeometryProxy.safeAreaInsets` (`SwiftUICore.swiftinterface:7909`), `Grid`/`GridRow` (16.0), `Material` (`SwiftUICore.swiftinterface:6305`, 15.0), `contentTransition(.symbolEffect(.replace))` (17.0, §3), `Color.opacity` scrim (forever). The only 26-only pieces are `glassEffect`/`GlassEffectContainer`/`.buttonStyle(.glass)` and the dock shape itself.

**Least-bad 18.0 shape — same architecture, three substitutions:**

| iOS 26 | iOS 18 |
|---|---|
| glass card via `.glassEffect(.regular, in: .rect(cornerRadius: 36))` | `.background(.regularMaterial, in: .rect(cornerRadius: 36))` — the probe's `style=card` path compiles and renders |
| `GlassEffectContainer` + `glassEffectID` + `glassEffectTransition` | drop them; use `.transition(.scale(scale: 0.8, anchor: .bottomTrailing).combined(with: .opacity))`, which the probe already uses for the whole panel |
| detached ＋ from `Tab(role: .search)` | a plain circular `Button` in `.overlay(alignment: .bottomTrailing)`, padded by the same hoisted inset, above the classic tab bar |
| `tabViewBottomAccessory` "Search your vault" pill | drop it; move search to `.searchable` on the navigation content |
| `tabBarMinimizeBehavior(.onScrollDown)` | nothing — no equivalent, and no substitute worth hand-rolling |

The scrim, the inset hoisting, the ＋→✕ morph, the 3×3 `Grid`, the panel's own transition and the whole `open`/`selection` state machine are **shared code across both branches**. So the availability gate is narrow: one `if #available(iOS 26.0, *)` at the shell level for the dock, and one small `ViewModifier` inside the panel that chooses glass-or-material. That is materially less duplication than "ship two shapes".

**UNVERIFIED and blocking a screenshot: there is no iOS 18 runtime on this machine.** `xcrun simctl list runtimes` prints exactly one line, `iOS 26.5 (26.5 - 23F77)`. Nothing in this section was rendered. It is a floor-and-signature argument, not a picture. If we commit to the 18.0 branch, install an iOS 18 runtime and re-shoot before shipping.

---

## Implementation sketch, sized for our case

Nine actions: the five creatable item types (login, card, identity, note, TOTP) plus passkey, generator, scan and import. Real symbol names throughout; this is the probe's structure with the failures already removed.

```swift
import SwiftUI

enum PVTab: Hashable { case all, logins, cards, codes, add }

struct PVAction: Identifiable {
    let id: Int; let title: String; let symbol: String
}

let pvActions: [PVAction] = [
    .init(id: 0, title: "Login",    symbol: "person.badge.key.fill"),
    .init(id: 1, title: "Card",     symbol: "creditcard.fill"),
    .init(id: 2, title: "Identity", symbol: "person.text.rectangle.fill"),
    .init(id: 3, title: "Note",     symbol: "note.text"),
    .init(id: 4, title: "TOTP",     symbol: "clock.badge.checkmark.fill"),
    .init(id: 5, title: "Passkey",  symbol: "person.badge.key"),
    .init(id: 6, title: "Generate", symbol: "wand.and.sparkles"),
    .init(id: 7, title: "Scan QR",  symbol: "qrcode.viewfinder"),
    .init(id: 8, title: "Import",   symbol: "square.and.arrow.down"),
]

// The dock inset, hoisted out of the tab content to the shell.
private struct DockInsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

@available(iOS 26.0, *)
struct VaultShell: View {
    @State private var selection: PVTab = .all
    @State private var lastReal: PVTab = .all
    @State private var panelOpen = false
    @State private var dockInset: CGFloat = 0          // measured 139 pt, iPhone 16
    @FocusState private var searchFocused: Bool

    var body: some View {
        TabView(selection: $selection) {
            Tab("All",    systemImage: "square.grid.2x2.fill", value: PVTab.all)    { screen(AllScreen()) }
            Tab("Logins", systemImage: "globe",                value: PVTab.logins) { screen(LoginsScreen()) }
            Tab("Cards",  systemImage: "creditcard.fill",      value: PVTab.cards)  { screen(CardsScreen()) }
            Tab("Codes",  systemImage: "clock",                value: PVTab.codes)  { screen(CodesScreen()) }

            // Detached trailing circle. role: .search is the only stock way to
            // get this slot; no .searchable on the TabView, so no search field.
            Tab(value: PVTab.add, role: .search) {
                Color.clear
            } label: {
                Label {
                    Text("Add item")
                } icon: {
                    // ONE Image, systemName swapped -> the replace effect fires.
                    Image(systemName: panelOpen ? "xmark" : "plus")
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel(panelOpen ? "Close actions" : "Add item")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory { AskPill() }     // NO custom glass in here
        .onPreferenceChange(DockInsetKey.self) { dockInset = $0 }

        // Selecting the ＋ slot toggles the panel and bounces selection back.
        .onChange(of: selection) { old, new in
            guard new == .add else { lastReal = new; return }
            searchFocused = false                  // §5: never coexist with a keyboard
            withAnimation(.snappy(duration: 0.3)) { panelOpen.toggle() }
            selection = (old == .add) ? lastReal : old
        }

        // The panel. Overlay on the TabView draws ABOVE the dock (verified),
        // so the bottom padding is what keeps it clear of the dock.
        .overlay(alignment: .bottom) {
            if panelOpen {
                ActionPanel { act in
                    withAnimation(.snappy) { panelOpen = false }
                    handle(act)
                }
                .padding(.bottom, dockInset + 8)
                .transition(.scale(scale: 0.8, anchor: .bottomTrailing)
                                .combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.3), value: panelOpen)
    }

    // Each tab's content publishes its own bottom safe-area inset (= the dock)
    // and owns the scrim, so the scrim can never reach under the dock.
    @ViewBuilder
    private func screen(_ content: some View) -> some View {
        NavigationStack {
            GeometryReader { geo in
                ZStack {
                    content
                    if panelOpen {
                        // Fades to nothing at the bottom so the scrim's edge does
                        // not read as a hard line above the dock.
                        LinearGradient(stops: [
                            .init(color: .black.opacity(0.35), location: 0.00),
                            .init(color: .black.opacity(0.35), location: 0.80),
                            .init(color: .black.opacity(0.00), location: 1.00),
                        ], startPoint: .top, endPoint: .bottom)
                        // Top only. The bottom edge stays inside the safe area,
                        // i.e. it stops exactly at the dock. Do NOT ignore .bottom.
                        .ignoresSafeArea(edges: .top)
                        .transition(.opacity)
                        .contentShape(Rectangle())
                        .onTapGesture { withAnimation(.snappy) { panelOpen = false } }
                    }
                }
                // Keyboard-immune measurement: reports 139 even at 335 (verified).
                .background {
                    GeometryReader { g in
                        Color.clear.preference(key: DockInsetKey.self,
                                               value: g.safeAreaInsets.bottom)
                    }
                    .ignoresSafeArea(.keyboard)
                }
            }
        }
    }

    private func handle(_ action: PVAction) { /* route to the editor */ }
}

// One glass layer: the card. The circles inside it are deliberately NOT glass.
@available(iOS 26.0, *)
struct ActionPanel: View {
    @Namespace private var glassNS
    var onPick: (PVAction) -> Void

    var body: some View {
        GlassEffectContainer(spacing: 22) {
            Grid(horizontalSpacing: 22, verticalSpacing: 16) {
                ForEach(0..<3, id: \.self) { row in
                    GridRow {
                        ForEach(0..<3, id: \.self) { col in
                            let a = pvActions[row * 3 + col]
                            VStack(spacing: 6) {
                                Button { onPick(a) } label: {
                                    Image(systemName: a.symbol)
                                        .font(.system(size: 22, weight: .medium))
                                        .frame(width: 62, height: 62)
                                        .background(Circle().fill(.quaternary))
                                }
                                .buttonStyle(.plain)            // NOT .glass — Rule B
                                .glassEffectID(a.id, in: glassNS)
                                Text(a.title)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .accessibilityLabel(a.title)
                        }
                    }
                }
            }
        }
        .glassEffectTransition(.matchedGeometry)
        .padding(.vertical, 18)
        .padding(.horizontal, 16)
        .glassEffect(.regular, in: .rect(cornerRadius: 36))     // the ONE glass layer
    }
}

@available(iOS 26.0, *)
struct AskPill: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
            if placement != .inline { Text("Search your vault").font(.subheadline) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        // NO .glassEffect — the system draws the accessory's glass. Rule A.
        // 360×48 expanded, 234×48 inline (measured on iPhone 17, DOCK-RESEARCH §1).
    }
}
```

Measured geometry from the probe, for sizing decisions:

- Content bottom safe-area inset with dock expanded, iPhone 16: **139.0 pt**. With keyboard up: 335.0 pt (keyboard 196 pt) — do not use that value.
- Panel at 62 pt circles, 22 pt horizontal spacing, 16 pt row spacing, 16/18 pt padding lands its top edge roughly **58 % of the screen height above the bottom** on a 393 × 852 pt screen. Bartek's "roughly two-thirds from the bottom" for Bevel means we are in the right band; nudge circle size or spacing if we want it taller.
- Panel width hugs its content and centres. Bevel's does too, from the screenshots as described. Do not stretch it to full width — a full-width card would collide with the accessory pill's own margins.

Five review points for whoever implements this:

1. `panelOpen` and keyboard focus are mutually exclusive. Enforce it in both directions (§5).
2. The scrim lives in the tab content and never ignores the **bottom** safe area (§2). A single stray `.ignoresSafeArea()` reintroduces `02-full.png`.
3. Exactly one glass layer inside the panel (§4, Rule B), and none anywhere the system already draws glass (Rule A).
4. `dockInset` comes from a preference, never a constant, and never from a reader that sees the keyboard (§5).
5. The ＋ tab's icon is one `Image` with a changing `systemName`, and carries an explicit accessibility label (§3).

---

## What I could NOT verify

1. **That Bevel builds its panel this way.** Nothing changed here versus `DOCK-RESEARCH.md`, and I looked harder as instructed. Bevel has published **user-facing documentation of the feature but nothing technical about it**. What exists: *How to Edit the Action Button* on their help site (<https://help.bevel.health/en/articles/10576641>) — which confirms the feature's name is the **Action Button**, that it opens on tap, and that press-and-hold enters an edit mode where actions can be added, removed and reordered; a features-by-version page putting the Action Button at app version 2.2.0+ (<https://help.bevel.health/en/articles/11194113>); and a user request plus staff reply about the ＋ menu's visual hierarchy on their feedback board (<https://feedback.bevel.health/feature-requests/p/ui-improvements>). None of them mention Liquid Glass, `GlassEffectContainer`, grid mechanics, or any API. Their App Store release notes (id6456176249) mention iOS 26 only for an unrelated background-loading fix. Their official X account discusses features, not UI construction. **Verdict: nothing technical published, after ~12 targeted searches and fetches — this is "not found", not "does not exist".** One real gap: <https://docs.bevel.health/release-notes> is JS-rendered and could not be fetched; a human with a browser should check it before we call this closed. So my identification of the mechanism remains **INFERRED** from an exact visual match plus the absence of any other API that produces this shape — now strengthened by the probe reproducing all six observed behaviours.
2. **Any third-party reproduction of this specific panel.** None found. The nearest published engineering work is `FabBar` (<https://github.com/ryanashcraft/FabBar>, writeup <https://ryanwesley.com/introducing-fabbar/>) — a recreation of the iOS 26 tab bar with a tinted floating action button, built on `UISegmentedControl` with `.glassEffect()` for the material, because the author hit frame-rate problems mixing pure-SwiftUI glass with custom UIKit controls. It is a single FAB, not an expandable grid, and does not reference Bevel. Worth reading if we ever reject the `role: .search` hack; the frame-rate note is a warning about hand-rolling the bar, and does not apply to our overlay panel.
3. **The 18.0 branch, at all.** No iOS 18 runtime installed (§6). Signature-and-floor argument only, zero pixels.
4. **Whether the overlay panel survives the dock minimizing.** The panel and `.tabBarMinimizeBehavior(.onScrollDown)` coexist in the probe, but I did not scroll with the panel open to check that `dockInset` tracks the minimize animation smoothly rather than jumping. Likely fine (the preference updates on inset change and the probe logged such changes), but untested. Also carried over unverified from `DOCK-RESEARCH.md`: the `NavigationStack(path:)` minimize bug (forums 799604).
5. **Whether Replace uses Magic Replace or the fallback for our real symbol pairs.** Verified for `plus`→`xmark` (fallback cross-fade, filmstrip). Not checked for any other pair; only cosmetic.
6. **`developer.apple.com/design/human-interface-guidelines/liquid-glass` is a 404.** Confirmed via three independent methods. The HIG content that page presumably held now lives on the **Materials** page and in the Liquid Glass technology overview. So there is no HIG-page citation for "never stack glass" — the literal instruction exists only in the WWDC25 219 transcript. The HIG's written form is the weaker "keep it out of the content layer, use sparingly".
7. **A keyboard-safe layout fix.** I have a working measurement and a *failed* positioning fix (§5). The recommendation is a state-machine workaround, not a layout solution. If a real layout fix is needed later, this is open.
8. **Accessory metrics on iPhone 16.** I re-measured only the 139 pt dock inset. The 360 × 48 / 234 × 48 accessory content box from `DOCK-RESEARCH.md` §1 was measured on iPhone 17 and not re-checked here.

---

## Sources

SDK (`/Applications/Xcode-26.6.0.app/…/iPhoneOS26.5.sdk/System/Library/Frameworks/…`):

- `SwiftUI.framework/Modules/SwiftUI.swiftmodule/arm64e-apple-ios.swiftinterface` — lines 17, 1207–1226, 4252–4254, 4357–4359, 10479–10481, 11694, 11856, 13664–13667, 20877–20894, 20900–20904, 20954–20963, 22664–22666
- `SwiftUICore.framework/Modules/SwiftUICore.swiftmodule/arm64e-apple-ios.swiftinterface` — lines 3–4, 2527–2534, 2845–2861, 5751–5764, 6305, 7909, 9043–9052, 9878–9880, 15795–15815, 17313–17315, 18249–18253, 18769
- `Symbols.framework/Modules/Symbols.swiftmodule/arm64e-apple-ios.swiftinterface` — lines 220–250, 393–420, 489–494, 570–579
- `UIKit.framework/Headers/*.h` — grepped for `scrim`/`dimming`: no relevant API

Apple:

- <https://developer.apple.com/documentation/swiftui/view/presentationbackgroundinteraction(_:)>
- <https://developer.apple.com/documentation/swiftui/presentationbackgroundinteraction>
- <https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:)> · <https://developer.apple.com/documentation/swiftui/presentationdetent>
- <https://developer.apple.com/documentation/swiftui/view/presentationbackground(_:)> · <https://developer.apple.com/documentation/swiftui/view/presentationcornerradius(_:)>
- <https://developer.apple.com/documentation/swiftui/view/contenttransition(_:)> · <https://developer.apple.com/documentation/swiftui/contenttransition/symboleffect>
- <https://developer.apple.com/documentation/symbols/replacesymboleffect> · <https://developer.apple.com/documentation/symbols/replacesymboleffect/magic(fallback:)>
- <https://developer.apple.com/documentation/swiftui/glasseffectcontainer> · <https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)> · <https://developer.apple.com/documentation/swiftui/glass>
- <https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views>
- <https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass>
- <https://developer.apple.com/documentation/swiftui/safearearegions> · <https://developer.apple.com/documentation/swiftui/view/ignoressafearea(_:edges:)> · <https://developer.apple.com/documentation/swiftui/view/safeareainset(edge:alignment:spacing:content:)>
- <https://developer.apple.com/documentation/swiftui/material> · <https://developer.apple.com/documentation/swiftui/view/scrolldismisseskeyboard(_:)>
- HIG: <https://developer.apple.com/design/human-interface-guidelines/materials> · <https://developer.apple.com/design/human-interface-guidelines/tab-bars>
- HIG (**404**): <https://developer.apple.com/design/human-interface-guidelines/liquid-glass>
- WWDC25 219 *Meet Liquid Glass* — <https://developer.apple.com/videos/play/wwdc2025/219/>
- WWDC25 323 *Build a SwiftUI app with the new design* — <https://developer.apple.com/videos/play/wwdc2025/323/>
- WWDC25 356 *Get to know the new design system* — <https://developer.apple.com/videos/play/wwdc2025/356/>
- WWDC23 10258 *Animate symbols in your app* — <https://developer.apple.com/videos/play/wwdc2023/10258/>
- WWDC23 10197 *What's new in SF Symbols 5* — <https://developer.apple.com/videos/play/wwdc2023/10197/>
- WWDC24 10188 *What's new in SF Symbols 6* — <https://developer.apple.com/videos/play/wwdc2024/10188/>

Bevel (all user-facing, none technical):

- <https://help.bevel.health/en/articles/10576641> — *How to Edit the Action Button*
- <https://help.bevel.health/en/articles/11194113> — features by app version (Action Button = 2.2.0+)
- <https://feedback.bevel.health/feature-requests/p/ui-improvements> — ＋ menu hierarchy thread
- <https://docs.bevel.health/release-notes> — **could not fetch** (JS-rendered)

Third party:

- <https://github.com/ryanashcraft/FabBar> · <https://ryanwesley.com/introducing-fabbar/> · <https://ryanwesley.com/ios-26-tab-bar-beef/>
