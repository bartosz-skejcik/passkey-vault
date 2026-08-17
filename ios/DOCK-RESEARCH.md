# iOS 26 bottom dock (the "Bevel dock") — how to build it with stock SwiftUI

**Status:** research only, no app code changed.
**Date:** 2026-08-17
**Toolchain used:** Xcode 26.6 (17F113), iPhoneOS26.5.sdk / iPhoneSimulator26.5.sdk, iOS 26.5 simulator (iPhone 17).
**Deployment target of this project:** `IPHONEOS_DEPLOYMENT_TARGET = 18.0` (`ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj`).

## TL;DR — the whole Bevel dock is stock

Every part of it is a system component. There is **no** hand-rolled bar and **no** hand-rolled glass:

| Bevel element | Stock API |
|---|---|
| 4-tab bar | `TabView` + `Tab(_:systemImage:value:)` |
| detached circular ＋ on the trailing side | `Tab(value:role:content:label:)` with `role: .search` and a **custom label** |
| full-width pill above the bar | `.tabViewBottomAccessory { … }` |
| `circle · pill · circle` when scrolled | `.tabBarMinimizeBehavior(.onScrollDown)` + reading `@Environment(\.tabViewBottomAccessoryPlacement)` |
| 3×3 round-action panel above the dock | **not stock** — `GlassEffectContainer` + `Button().buttonStyle(.glass)` in an `.overlay(alignment: .bottom)` |

I reproduced the resting state, the `circle · pill · circle` scrolled state, the ＋→✕ swap and the floating grid in the simulator with a throwaway probe (screenshots in the session scratchpad, not committed). Everything marked VERIFIED below was seen on-device-simulator, not just read.

---

## 1. `tabViewBottomAccessory(content:)` — VERIFIED

**Signature** (`SwiftUI.swiftinterface:13000`, iPhoneOS26.5.sdk):

```swift
extension SwiftUICore.View {
  @available(iOS 26.0, *)
  @available(macOS, unavailable) @available(tvOS, unavailable)
  @available(watchOS, unavailable) @available(visionOS, unavailable)
  nonisolated public func tabViewBottomAccessory<Content>(
      @ViewBuilder content: () -> Content) -> some View where Content : View

  @available(iOS 26.1, *)   // line 13007
  nonisolated public func tabViewBottomAccessory<Content>(
      isEnabled: Bool, @ViewBuilder content: () -> Content) -> some View where Content : View
}
```

**Attaches to:** the `TabView` itself (it is a `View` modifier applied to the tab view, alongside `.tabBarMinimizeBehavior`). The accessory is owned by the tab view, so it is **visible on every tab**, not per-tab.

**What it does when the bar minimizes** — Apple, verbatim:

> "On iPhone, the placement of the bottom accessory depends on the tab bar size: when the tab bar is normal size, the accessory appears above it; when the tab bar is collapsed, the accessory displays inline. Use the `tabViewBottomAccessoryPlacement` environment value to adjust the accessory's content based on its placement."
> — <https://developer.apple.com/documentation/swiftui/view/tabviewbottomaccessory(content:)>

WWDC25 session 323, *Build a SwiftUI app with the new design*:

> "Place a view above the bar with the tabViewBottomAccessory modifier. This takes advantage of the extra space provided by the tab bar's collapsing behavior."

**Size constraints — measured, VERIFIED.** The accessory content area is a **fixed-height 48 pt** box; only its width changes. On iPhone 17 (402 pt wide):

| placement | content size given to your view |
|---|---|
| `.expanded` (bar at rest) | **360 × 48 pt** (screen width − 2 × 21 pt margin) |
| `.inline` (bar minimized) | **234 × 48 pt** (flanked by the minimized tab circle and the search-role circle) |

Measured with a `GeometryReader` inside the accessory. **The accessory does not grow.** A probe that put a 3×3 grid + a pill in a `VStack` inside the accessory was hard-clipped to 48 pt — only the middle row of the grid survived. This is the single most important constraint for the implementer: **the ＋ grid cannot live inside the accessory.**

Also note the availability asymmetry: the *modifier* is iOS-only (macOS/tvOS/watchOS/visionOS explicitly `unavailable`), while the *environment value* is declared for all platforms at 26.0.

---

## 2. `TabViewBottomAccessoryPlacement` — VERIFIED. This is the key to `circle · pill · circle`

**Declaration** (`SwiftUI.swiftinterface:5306–5336`):

```swift
@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *)
extension SwiftUICore.EnvironmentValues {
  public var tabViewBottomAccessoryPlacement: SwiftUI.TabViewBottomAccessoryPlacement? { get }
}

@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *)
public enum TabViewBottomAccessoryPlacement : Hashable, Sendable {
  case inline
  case expanded
}
```

**Cases**, Apple's own abstracts (<https://developer.apple.com/documentation/swiftui/tabviewbottomaccessoryplacement>):

- `.expanded` — "The bar is expanded on top of the bottom tab bar, if there is a bottom tab bar, or at the bottom of the tab's content view."
- `.inline` — "The view is displayed in line with the bottom tab bar."
- `nil` — "A nil value corresponds to an undefined placement." Treat `nil` as "not in a tab accessory" and fall back to the expanded layout.

**How you read it** — from the environment, **inside the accessory view** (not on the TabView):

```swift
struct DockAccessory: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    var body: some View {
        switch placement {
        case .inline:  CompactPill()      // 234 × 48
        default:       FullPill()         // 360 × 48
        }
    }
}
```

WWDC25 session 323, verbatim:

> "Inside your accessory view, read the tabViewBottomAccessoryPlacement from the environment. Then, adjust the content of your accessory when it collapses into the tab bar area."

**Why this gives `circle · pill · circle`:** you do not build that row. The system does. When the bar minimizes it collapses to one circle showing the current tab's icon (leading), the search-role tab stays as its own circle (trailing), and the accessory is laid inline **between them** — that's the 234 pt width. Your only job is to make the accessory's content readable at 234 pt instead of 360 pt.

UIKit mirrors this exactly and documents it more explicitly (`UITabAccessory.h`, iPhoneOS26.5.sdk):

```
UITabAccessoryEnvironmentRegular,  // above the bottom tab bar when it is visible; or,
                                   // at the bottom of the UITabBarController's view
UITabAccessoryEnvironmentInline,   // laid out inline with the collapsed bottom tab bar
```

---

## 3. `tabBarMinimizeBehavior(_:)` — VERIFIED. **`.onScrollDown` MINIMIZES. It does not hide.**

This settles the earlier bad guidance. The bar stays on screen, collapsed to a single capsule showing the current tab's icon.

**Declaration** (`SwiftUI.swiftinterface:8538–8568`):

```swift
extension SwiftUICore.View {
  @available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *)
  nonisolated public func tabBarMinimizeBehavior(_ behavior: TabBarMinimizeBehavior) -> some View
}

@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *)
public struct TabBarMinimizeBehavior : Hashable, Sendable {
  public static let automatic: TabBarMinimizeBehavior
  @available(iOS 26.0, *) @available(macOS, unavailable) @available(tvOS, unavailable)
  @available(watchOS, unavailable) @available(visionOS, unavailable)
  public static let onScrollDown: TabBarMinimizeBehavior
  … onScrollUp …
  … never …
}
```

Note `.onScrollDown` / `.onScrollUp` / `.never` are **iPhone-only** (`macOS/tvOS/watchOS/visionOS unavailable`); only `.automatic` is cross-platform.

**Every case**, Apple's abstracts (<https://developer.apple.com/documentation/swiftui/tabbarminimizebehavior>):

| case | Apple's text |
|---|---|
| `.automatic` | "Determine the behavior automatically based on the surrounding context." |
| `.never` | "Never minimize the tab bar." |
| `.onScrollDown` | "**Minimize** the tab bar when downwards scrolling starts. Minimizing is supported for tab bars on only iPhone." |
| `.onScrollUp` | "**Minimize** the tab bar when upwards scrolling starts. Minimizing is supported for tab bars on only iPhone." |

The UIKit header is even more explicit and is the citation to hand the implementer — `UITabBarController.h`, iPhoneOS26.5.sdk, lines 32–46:

```objc
typedef NS_ENUM(NSInteger, UITabBarMinimizeBehavior) {
    /// Resolves to the system default minimize behavior.
    UITabBarMinimizeBehaviorAutomatic = 0,
    /// The tab bar does not minimize.
    UITabBarMinimizeBehaviorNever,
    /// The tab bar minimizes when scrolling down, and expands when scrolling back up.
    UITabBarMinimizeBehaviorOnScrollDown,
    /// The tab bar minimizes when scrolling up, and expands when scrolling back down.
    /// Recommended if the scroll view content is aligned to the bottom.
    UITabBarMinimizeBehaviorOnScrollUp,
};
```

**Hiding is a completely separate API.** Same header, line 112–120: `tabBarMinimizeBehavior` and `-[UITabBarController setTabBarHidden:animated:]` are different properties. Minimize ≠ hide.

WWDC25 session 323:

> "With the new design, the tab bar on iPhone floats above the content, and can be configured to minimize on scroll." … "With this configuration, the tab bar re-expands when scrolling in the opposite direction."

**Empirically confirmed:** in the probe, scrolling down collapsed the 4-tab bar to a single circle with the house glyph, the ＋ circle stayed, the accessory went inline between them, and nothing disappeared. Scrolling back up re-expanded it.

Use `.onScrollDown` (content aligned to the top). `.onScrollUp` is for bottom-aligned scroll content, e.g. a chat transcript.

### Known bug to plan around

`.tabBarMinimizeBehavior(.onScrollDown)` reportedly does not trigger for tabs whose root is a `NavigationStack(path:)` — Apple Developer Forums thread 799604. My probe used a plain `NavigationStack { }` (no path binding) and minimizing worked. If we adopt `NavigationStack(path:)` in a tab, re-test minimizing before shipping. UNVERIFIED whether this was fixed in 26.5.

---

## 4. `Tab(role: .search)` — VERIFIED, and it is the answer to the detached ＋

**`TabRole` is iOS 18.0** (`SwiftUI.swiftinterface:12982`):

```swift
@available(iOS 18.0, macOS 15.0, tvOS 18.0, watchOS 11.0, visionOS 2.0, *)
public struct TabRole : Hashable, Sendable { public static var search: TabRole { get } }
```

**What it renders as in the iOS 26 dock:** a **separate, detached circular glass capsule at the trailing edge of the tab bar**, outside the capsule that holds the other tabs — exactly the shape of Bevel's ＋. It survives minimization: in the collapsed state it is the right-hand circle of `circle · pill · circle`.

Donny Wals, *Exploring tab bars on iOS 26 with Liquid Glass*: a tab with the search role is "separated from your other tabs", positioned bottom-right. (<https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/>)

**Interaction with the accessory:** none, they coexist. The accessory occupies the full width above the bar when expanded, and the space *between* the minimized tab circle and the search circle when inline. That's why the inline content box is 234 pt and not 360 pt.

**Search behaviour is opt-in, not automatic.** WWDC25 session 323:

> "To do this in your app, set a search role on one of your tabs **and place a searchable modifier on your TabView**." … "When someone selects this tab, a search field takes the place of the tab bar, and the content of the tab is shown."

Apple's `TabRole.search` discussion: "Searchable tab views will prefer to have the first tab with this role implement search."

So: **if you do not put `.searchable` on the `TabView`, selecting the search-role tab does not produce a search field.** Verified — in the probe (no `.searchable`) tapping the ＋ simply selected that tab and showed its content, tab bar re-expanded, no search field.

**The icon is NOT locked to the magnifying glass.** Several blog posts claim it is ("the magnifying glass is locked in — no customization"). That is **wrong for SwiftUI's `Tab`**. The overload at `SwiftUI.swiftinterface:13667` takes a label view builder:

```swift
nonisolated public init(value: Value, role: TabRole?,
                        @ViewBuilder content: () -> Content,
                        @ViewBuilder label: () -> Label)
```

and the label **is honoured**. Verified in the simulator: `Label("Add", systemImage: "plus")` on a `role: .search` tab rendered a detached circular **＋**, and swapping the system image to `xmark` from `@State` live-swapped it to **✕** with the system's own animation. UIKit has the same escape hatch — `UISearchTab` inherits `UITab.image`, which is `readwrite` (`UITab.h:55`), though whether UIKit honours it for a search tab is UNVERIFIED.

### Caveat, flag this to Bartek

Repurposing the semantic *search* slot as an *add* button is what makes the layout free, but it is semantically off: VoiceOver and any future system affordance will treat that slot as search. There is no `TabRole.add`. This is the trade-off — take the stock look, or hand-roll the trailing circle. My recommendation is to take it, and set an explicit accessibility label ("Add item") on the tab's label view.

---

## 5. The detached ＋ capsule — is there a stock API for a trailing detached control? **No, other than the search role.**

I grepped both modules for every `tab*` view modifier in the SDK. The complete list in `SwiftUI.swiftinterface` is:

```
tabBarMinimizeBehavior(      8540
tabViewSearchActivation(    10835
tabPlacement(               20977
tabViewCustomization(       21445
tabViewBottomAccessory(     13000, 13007
```

`SwiftUICore.swiftinterface` has **zero** `tab*` modifiers. There is no `tabViewTrailingAccessory`, no `tabBarAccessory(placement:)`, no detached-control API. UIKit likewise offers exactly one accessory slot: `UITabBarController.bottomAccessory` (a single `UITabAccessory`, `UITabBarController.h:128`). A related forum request for trailing accessories on tab items got a DTS reply of "file a feedback" — i.e. no API (forums thread 815864; that thread is about sidebar rows, so it is adjacent evidence, not a direct citation).

**Therefore:** the trailing detached circle is only obtainable, stock, via `Tab(role: .search)` — and that is almost certainly what Bevel does, because the shape, the gap, the glass, the collapse behaviour and the survival into the minimized state all match byte-for-byte and no other API produces that slot.

**Closest non-stock fallback** if we reject the search-role hack: `.overlay(alignment: .bottomTrailing)` on the `TabView` with

```swift
Button { … } label: { Image(systemName: "plus").frame(width: 56, height: 56) }
    .buttonStyle(.glass)          // SwiftUI.GlassButtonStyle, iOS 26
```

It uses the system glass button style so it looks right, but you own the position, the safe-area maths, and it will not track the tab bar's minimize animation. Not recommended.

---

## 6. The 3×3 expanding grid — **no stock presentation does this.** Overlay + glass is the answer.

Requirements: a panel anchored above the dock, dock stays fully visible and interactive, ＋ morphs to ✕.

What I ruled out, with reasons:

- **Inside the accessory** — ruled out empirically. The accessory content box is a fixed 48 pt tall and clips (see §1). This was my first hypothesis and it is wrong.
- **`.sheet` + `.presentationDetents`** — a sheet is a modal presentation; it dims and blocks interaction with what's beneath, and on iPhone it takes over the bottom of the screen where the dock lives. Wrong shape, wrong semantics.
- **`.popover`** — on iPhone a popover adapts to a sheet unless you force `.presentationCompactAdaptation(.popover)`; forced, you get an arrow-anchored chrome that does not match Bevel's chrome-less floating grid.
- **`Menu`** — the system menu morphs beautifully out of a glass button, but it renders a list, not a 3×3 grid of round icons.

**What Bevel most plausibly uses, and what we should use — VERIFIED to work:**

`.overlay(alignment: .bottom)` on the `TabView`, containing a `GlassEffectContainer` of circular `Button`s with `.buttonStyle(.glass)`. Verified in the simulator: the overlay draws **above** the tab bar in z-order, the dock stays visible and live underneath, and the ＋ swaps to ✕.

Relevant symbols (all `SwiftUICore`, **not** `SwiftUI` — this is the module trap this project has hit twice):

```
SwiftUICore.swiftinterface:9045  GlassEffectContainer<Content>.init(spacing: CGFloat? = nil, content:)
SwiftUICore.swiftinterface:2529  func glassEffect(_ glass: Glass = .regular, in shape: some Shape = DefaultGlassEffectShape())
SwiftUICore.swiftinterface:17315 func glassEffectID(_ id: (some Hashable & Sendable)?, in: Namespace.ID)
SwiftUICore.swiftinterface:9880  func glassEffectUnion(id:in:)
SwiftUICore.swiftinterface:2861  func glassEffectTransition(_ transition: GlassEffectTransition)
SwiftUICore.swiftinterface:2847  GlassEffectTransition: .matchedGeometry / .materialize / .identity
SwiftUICore.swiftinterface:5753  Glass: .regular / .clear / .identity, .tint(_:), .interactive(_:)
```

The button style, by contrast, IS in `SwiftUI`:

```
SwiftUI.swiftinterface:1207  extension PrimitiveButtonStyle where Self == GlassButtonStyle { static var glass }
```

For the ＋ → grid morph, `.glassEffectID(_:in:)` + `.glassEffectTransition(.matchedGeometry)` inside a shared `GlassEffectContainer` is the WWDC25-blessed way to make the circles appear to grow out of the button.

**Positioning.** Measured: inside a tab's content, `GeometryProxy.safeAreaInsets.bottom` is **139 pt** with the dock expanded on iPhone 17 (accessory + tab bar + home-indicator gap). So do not hardcode a magic number — hoist the tab content's bottom safe-area inset (via a `PreferenceKey`) and use it as the overlay's bottom padding, or place the overlay inside the tab content where the inset is directly readable. Note tab content extends *under* the dock (the dock is drawn on top), so an overlay attached inside the tab content sits below the dock in z-order — fine, since the grid only needs to sit *above* it geometrically.

---

## 7. iOS version floor per API, and the 18.0 fallback

| Symbol | Floor | Platform notes |
|---|---|---|
| `TabView` + `Tab(_:systemImage:value:)` builder | **iOS 18.0** | works today |
| `TabRole` / `Tab(role: .search)` | **iOS 18.0** | the *detached circular* rendering is an iOS 26 visual; on 18 it is a normal tab item (UNVERIFIED — no iOS 18 runtime installed) |
| `Tab(value:role:content:label:)` custom label | **iOS 18.0** | |
| `tabViewBottomAccessory(content:)` | **iOS 26.0** | iOS/iPadOS/Mac Catalyst only |
| `tabViewBottomAccessory(isEnabled:content:)` | **iOS 26.1** | do not use unless we raise the floor |
| `EnvironmentValues.tabViewBottomAccessoryPlacement` | **iOS 26.0** | |
| `TabViewBottomAccessoryPlacement` | **iOS 26.0** | |
| `tabBarMinimizeBehavior(_:)` | **iOS 26.0** | `.onScrollDown/.onScrollUp/.never` are iPhone-only |
| `tabViewSearchActivation(_:)` / `TabSearchActivation` | **iOS 26.0** | |
| `glassEffect`, `GlassEffectContainer`, `glassEffectID`, `glassEffectTransition`, `Glass` | **iOS 26.0** | **SwiftUICore**, not SwiftUI |
| `.buttonStyle(.glass)` / `GlassButtonStyle` | **iOS 26.0** | SwiftUI |
| `UITabAccessory`, `UITabBarController.bottomAccessory`, `.tabBarMinimizeBehavior` | **iOS 26.0** | UIKit equivalents |

**The 18.0 fallback.** Everything that makes the dock a *dock* is 26-only. Do not try to emulate it — Bartek's rule is "system components only", and a hand-rolled glass bar on iOS 18 violates that harder than a plainer bar does. Ship two shapes:

- **iOS 26+**: the full dock as described. 4 tabs + search-role ＋ + accessory + `.onScrollDown`.
- **iOS 18–25**: a plain `TabView` with `Tab`. Move the ＋ to a `ToolbarItem(placement: .topBarTrailing)` or `.bottomBar`, and put the "Ask anything" pill in a `.safeAreaInset(edge: .bottom)` with a `.regularMaterial` capsule background if it is essential; otherwise drop it. No minimize behavior, no glass, no detached circle.

Gate with a single `if #available(iOS 26.0, *)` at the shell level (one branch per shape), not with dozens of inline availability checks scattered through the view tree — the two layouts are different enough that a shared body will fight you.

---

## Recommended implementation sketch (real symbol names)

```swift
import SwiftUI

enum DockTab: Hashable { case vault, generator, family, settings, add }

@available(iOS 26.0, *)
struct Dock26: View {
    @State private var selection: DockTab = .vault
    @State private var lastReal: DockTab = .vault
    @State private var showActions = false

    var body: some View {
        TabView(selection: $selection) {
            Tab("Vault",     systemImage: "lock.fill",        value: DockTab.vault)     { VaultScreen() }
            Tab("Generator", systemImage: "wand.and.sparkles", value: DockTab.generator) { GeneratorScreen() }
            Tab("Family",    systemImage: "person.2.fill",     value: DockTab.family)    { FamilyScreen() }
            Tab("Settings",  systemImage: "gearshape.fill",    value: DockTab.settings)  { SettingsScreen() }

            // The detached trailing circle. role: .search is the ONLY stock way to get this slot.
            // No .searchable on the TabView => no search field appears; we own the interaction.
            Tab(value: DockTab.add, role: .search) {
                Color.clear
            } label: {
                Label("Add item", systemImage: showActions ? "xmark" : "plus")
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)          // MINIMIZES, never hides
        .tabViewBottomAccessory { AskPill() }
        // Intercept selection of the ＋ slot: toggle the panel, bounce selection back.
        .onChange(of: selection) { old, new in
            if new == .add {
                showActions.toggle()
                selection = (old == .add) ? lastReal : old
            } else {
                lastReal = new
            }
        }
        .overlay(alignment: .bottom) {
            if showActions {
                ActionGrid()                            // draws ABOVE the tab bar (verified)
                    .padding(.bottom, dockHeight + 8)   // derive, don't hardcode — see §6
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.snappy, value: showActions)
    }
}

@available(iOS 26.0, *)
struct AskPill: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
            if placement != .inline {                   // 360×48 expanded, 234×48 inline
                Text("Search your vault").font(.subheadline)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        // NO .glassEffect here — the system already draws the accessory's glass.
    }
}

@available(iOS 26.0, *)
struct ActionGrid: View {
    @Namespace private var glass
    let actions: [(String, String)] = [...]             // 9 items

    var body: some View {
        GlassEffectContainer(spacing: 18) {
            Grid(horizontalSpacing: 18, verticalSpacing: 18) {
                ForEach(0..<3, id: \.self) { row in
                    GridRow {
                        ForEach(0..<3, id: \.self) { col in
                            Button { /* … */ } label: {
                                Image(systemName: actions[row * 3 + col].1)
                                    .font(.title2)
                                    .frame(width: 60, height: 60)
                            }
                            .buttonStyle(.glass)                            // SwiftUI.GlassButtonStyle
                            .glassEffectID(row * 3 + col, in: glass)        // SwiftUICore
                        }
                    }
                }
            }
        }
        .glassEffectTransition(.matchedGeometry)                            // SwiftUICore
        .padding(16)
    }
}
```

Rules baked into the sketch:

1. **Never** put `.glassEffect` on the accessory content or on tab labels — the system draws that glass. Custom glass only inside `ActionGrid`, which the system does not own.
2. Import note: `glassEffect`, `GlassEffectContainer`, `glassEffectID`, `glassEffectTransition`, `Glass`, `GlassEffectTransition` are all **`SwiftUICore`** symbols re-exported through `import SwiftUI`. Grepping `SwiftUI.swiftinterface` alone returns nothing for them and reads exactly like "the API does not exist". It does exist.
3. Set an accessibility label on the ＋ tab's `Label` — the slot is semantically "search".

---

## What I could NOT verify

1. **That Bevel actually uses these APIs.** Bevel has published nothing technical that I could find; there is no blog post, dev diary or conference talk. My conclusion that the ＋ is a `role: .search` tab is inference from an exact visual match (detached circle, trailing edge, same glass, survives minimization into `circle · pill · circle`) plus the SDK containing no other API that produces that slot. Strong, but circumstantial.
2. **iOS 18 rendering of `Tab(role: .search)`.** Only the iOS 26.5 runtime is installed on this machine; `xcrun simctl list devices available` shows no iOS 18 runtime. I could not screenshot the 18.0 fallback.
3. **Whether UIKit honours a custom `image` on `UISearchTab`.** The property is inherited and `readwrite` (`UITab.h:55`), but `UISearchTab`'s designated initializer is documented as creating "a search tab with a system localized title and image". Untested. Only matters if we go UIKit, which I do not recommend.
4. **The `NavigationStack(path:)` minimize bug** (forums 799604) — reported against beta 7. My probe used a path-less `NavigationStack` and minimizing worked. Not retested with a path binding on 26.5.
5. **Exact accessory metrics on other devices.** 360×48 / 234×48 measured on iPhone 17 only. Height is very likely constant across iPhones; widths obviously are not. Do not hardcode either.
6. **The HIG page for tab bars.** `developer.apple.com/design/human-interface-guidelines/tab-bars` is JS-rendered and its JSON endpoint 404s, so I have no HIG citation for accessory sizing guidance — only the measured numbers above.
7. **Bevel's grid mechanism specifically.** I verified that overlay + `GlassEffectContainer` reproduces the look and behaviour. I have no evidence that this is what Bevel does, only that no stock presentation (sheet/popover/menu) does and that this one works.

## Sources

- SDK: `/Applications/Xcode-26.6.0.app/…/iPhoneOS26.5.sdk/System/Library/Frameworks/SwiftUI.framework/Modules/SwiftUI.swiftmodule/arm64e-apple-ios.swiftinterface`
- SDK: `…/SwiftUICore.framework/Modules/SwiftUICore.swiftmodule/arm64e-apple-ios.swiftinterface`
- SDK: `…/UIKit.framework/Headers/UITabBarController.h`, `UITabAccessory.h`, `UISearchTab.h`, `UITab.h`
- <https://developer.apple.com/documentation/swiftui/tabbarminimizebehavior>
- <https://developer.apple.com/documentation/swiftui/tabviewbottomaccessoryplacement>
- <https://developer.apple.com/documentation/swiftui/view/tabviewbottomaccessory(content:)>
- <https://developer.apple.com/documentation/swiftui/view/tabbarminimizebehavior(_:)>
- <https://developer.apple.com/documentation/swiftui/environmentvalues/tabviewbottomaccessoryplacement>
- <https://developer.apple.com/documentation/swiftui/tabrole/search>
- WWDC25 session 323, *Build a SwiftUI app with the new design* — <https://developer.apple.com/videos/play/wwdc2025/323/>
- <https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/>
- Apple Developer Forums thread 799604 (minimize + `NavigationStack(path:)`), thread 815864 (no trailing accessory API)
