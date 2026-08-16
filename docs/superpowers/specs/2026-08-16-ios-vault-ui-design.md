# iOS vault UI — design spec

**Date:** 2026-08-16 · **Status:** approved by Bartek ("lgtm") · **Scope:** Phases 38–40 (UI layer)
**Visual reference:** `ios/brand/screens-vault.html` — 22 screens, light + dark, real token values
**Companion spec:** `2026-08-16-ios-onboarding-and-auth-design.md` (onboarding, auth, lock)

Field models are transcribed from `packages/pv-ui/vault/types.ts`. Icon behaviour is inherited from
`packages/pv-ui/components/ItemIconTile.tsx`. Neither was invented here — **read those two files before
deviating from anything below.**

---

## 1. Navigation architecture

| Region | Contents |
|---|---|
| Nav bar, trailing | Glass pill: **Lock now** + **avatar** |
| Avatar menu | Family · Settings · Lock now · Sign out (destructive, last) |
| Dock, accessory pill | **Search** (`tabViewBottomAccessory`) |
| Dock, tab bar | Type filters: **All · Logins · Cards · Codes · Passkeys** |
| Dock, detached capsule | **＋** — expands in place into a 3×3 action grid, becomes ✕ |

Layout follows Bevel (screenshots reviewed 2026-08-16): accessory pill above, filter bar plus detached
action capsule below, collapsing to *circle · pill · circle* on scroll.

**All of it is stock. Do not hand-roll the glass.** Verified against the iOS 26.5 SDK:

| API | Available | Module |
|---|---|---|
| `Tab(role: .search)` | **iOS 18.0+** | SwiftUI |
| `glassEffect(_:in:)` | iOS 26.0+ | **SwiftUICore**, not SwiftUI |
| `tabBarMinimizeBehavior(_:)` | iOS 26.0+ | SwiftUI |
| `tabViewBottomAccessory` | iOS 26.0 / 26.1+ | SwiftUI |
| `sectionIndexLabel(_:)` | iOS 26.0+ | SwiftUI |
| `listSectionIndexVisibility(_:)` | iOS 26.0+ | SwiftUI |

Deployment target is **iOS 18.0** (IOS-03, locked by PRF). The floating glass rendering and the section
index therefore appear only on iOS 26; the identical code falls back to a standard tab bar and no index
below that. Guard only the modifiers with `#available`, not the view body.

> **Landmine, same shape as L-1:** `glassEffect` is in **SwiftUICore**. Grepping `SwiftUI.swiftinterface`
> returns nothing, which reads exactly like "the API does not exist". Do not conclude absence from the
> wrong module — and do not reach for it here anyway.

**Known departure from the HIG:** iOS tab bars are for *sections*, not content filters. This is a
deliberate departure, taken because the vault genuinely is the app once the account moves to the avatar.
Record it; do not silently "fix" it.

---

## 2. The list

`List` with `Section` per type. **All is section-headed by type**, with item counts in each header and a
section index down the right edge.

Section order and index labels — note the collision:

| Section | Index label |
|---|---|
| Logins | `L` |
| Cards | `C` |
| Codes | **`2`** |
| Passkeys | `P` |
| Identities | `I` |
| Notes | `N` |

`Codes` indexes as **2**, not C, because **Cards and Codes collide on C**. The index label is
`Text`/`String` and documented as "typically only a single character" — **SF Symbols are not possible
there.**

Below iOS 26 there is no native index. Either omit it, or supply a `ScrollViewReader.scrollTo` overlay.
Do not reach for a `UIViewRepresentable` bridge to `UITableView.sectionIndexTitles` — the overlay keeps
the list a stock `List`, which is the whole point of the direction.

**Why sections exist at all:** six types, five tab slots. `identity` and `note` have no tab, so the
grouped All screen is their route in. The ＋ grid covers *creating* them; the section index covers
*finding* them. Both are required — an earlier draft claimed the grid alone was enough, which was wrong.

### Row anatomy

Icon tile · name · subtitle · optional pill · chevron. Subtitle is the most identifying secondary field:
username, `•••• last4`, issuer, rpId, first line of body.

Pills: `Passkey` (`PVPasskey`), `Shared` (neutral `PVTextMuted` — shared is a *fact*, not a warning),
`Not synced` (`PVWarning`), `Damaged` (`PVError`).

---

## 3. Item icons — inherited rules, not new ones

Mirror `packages/pv-ui/components/ItemIconTile.tsx`.

- **Logins AND passkeys** → favicon from **the item's own domain**: `https://<domain>/favicon.ico`,
  `no-referrer`.
- **Cards** → brand tile detected locally via `detectCardBrand(fields.number)`.
- **Everything else, and any failed favicon** → monochrome glyph, `PVTextMuted` on `PVSurfaceAlt`.

### Hard constraints

1. **ZERO-KNOWLEDGE FAVICON RULE** (`17-UI-SPEC.md`, restated verbatim in spirit): every fetch is direct
   to a domain the item already legitimately belongs to. **Never** a third-party favicon proxy
   (Google/DDG/`s2`). **Never** routed through `pv-server`. A proxy hands a third party the list of every
   site in the vault; `pv-server` routing hands it to the server this product promises never sees it.
2. **Card brands never touch the network.** The component's comment: *"nothing about a saved card ever
   leaves the client to render its glyph."*
3. **The favicon tile keeps a light ground in dark mode.** Found in live review, not theory — GitHub's
   favicon is black and vanished entirely on a dark tile.
4. **Failed hosts are cached and not retried** (`FAILED_FAVICON_HOSTS`).

### iOS-only hazard the web version does not have

The rule says *uncached*. iOS's default `URLSession` writes to a persistent on-disk `URLCache`, which
would leave a favicon for every site in the vault sitting in the app container — **readable while the
vault is locked**. That is vault contents at rest, leaked through the icon layer.

**Use an ephemeral `URLSession` (or memory-only cache) for favicon loads, and load lazily so only visible
rows fetch.** Treat this as a security requirement, not an optimisation.

---

## 4. TOTP rows — the code is the row

Codes get their own row shape, after Google Authenticator:

```
Issuer: account                    ◐
418 926
```

- Label above in `PVTextMuted`, ~12.5pt.
- Code at display size (~31pt), `PVAccent`, `.monospacedDigit()`, grouped `NNN NNN`.
- **A ring**, not a pie: `Circle().trim(from: 0, to: fraction).stroke(style: .init(lineWidth: 2.3,
  lineCap: .round)).rotationEffect(.degrees(-90))`.
- The ring turns `PVWarning` in its final seconds, so "will this expire before I finish typing" is
  answerable without counting.
- **No icon tile, no chevron** — nothing to disclose; the user came to read six digits.

Applies both in the Codes filter and in the Codes section of All. The detail screen uses the same ring,
enlarged, beside the code.

---

## 5. Detail and edit

Detail: secrets masked by default, revealed per field, never wholesale. Copy is the primary row action.
Optional fields (`pin`, `zip`, structured address parts) are **omitted entirely when empty**, matching
the web.

Edit: one `Form`, rows switched by type. The type picker is editable **only on create** — changing an
existing item's type would orphan its fields.

**Passkey detail has no Edit.** The fields are cryptographic material, not user content.
`rawPasskeyJson` is not displayed — it has no reader on a phone.

### Two traps

1. **Identity address round-trip.** The flat `address` string stays authoritative for the browser
   extension's autofill. Saving must recompose it from the structured rows
   (`lib/vault/identityAddress.ts`). An iOS save that writes only the structured fields **silently breaks
   filling on desktop**, and nothing on the iOS side would catch it.
2. **`undecryptable` must be shown, never filtered.** It exists on `VaultItem` and the codebase reads it
   as a *tampering* signal. The row stays visible and tappable so it can explain itself.

---

## 6. Generator

Sheet, invoked next to the password field and from the ＋ grid — not from a toolbar; it is only ever
wanted at that exact moment. Modes: Random · Memorable · PIN. Length slider, numbers/symbols toggles,
strength in `PVSuccess`. Characters colour-coded by class to aid transcription.

**This is not a wiring task.** No generator exists in `pv-core` or `pv-wasm`; the canonical one is
TypeScript (EFF 7776-word list, 25-char symbol set, rejection sampling). **`DR-38-A` owns** whether this
becomes a first-time Rust port or Swift-side sampling over `random_bytes`. Swift-side leaves two
implementations to keep in sync.

---

## 7. Family and sharing (Phase 40)

Designed now because it changes **row anatomy**, and retrofitting a badge into a settled row is the
expensive order.

Roles map to existing model fields: `accessLevel`, `isShared`, `sharedToMe`, `lastEditorEmail`.

- **Family** (from the avatar menu): members with roles, pending invites, and a footer stating plainly
  that members only see what you share — "family" otherwise implies whole-vault access.
- **Invite**: names what happens cryptographically in one sentence — keys are re-wrapped for them, the
  server never sees anything readable.
- **Share an item**: per-item, per-person, matching the multi-recipient key wrapping the core already
  does. Copy names the revocation behaviour, because "can I take it back" is the first question sharing
  raises.
- **Shared with me**: neutral grey, Edit absent rather than disabled-on-tap.

---

## 8. Camera permission is missing

TOTP QR scanning and card scanning both need **`NSCameraUsageDescription`**, which is **not declared** in
the project today. It is the second and only other real permission this app requires (Face ID being the
first). Manual secret entry must remain, so a refused camera never blocks TOTP setup.

---

## 9. Done means

- [ ] No hardcoded hex in any view; `gen-ios-colorsets.py --check` passes.
- [ ] No `.white` on an accent fill — `PVOnAccent` only.
- [ ] Favicons: direct-to-domain, no proxy, no `pv-server`, ephemeral session, lazy, light tile in dark.
- [ ] Card brands rendered with **zero** network calls.
- [ ] `undecryptable` rows visible and tappable.
- [ ] Identity save recomposes the flat `address` string.
- [ ] Section index labels are `L C 2 P I N`; `#available(iOS 26)` guarded.
- [ ] TOTP uses a trimmed `Circle`, not a pie, and warns in its final seconds.
- [ ] `NSCameraUsageDescription` declared before any scanning UI ships.
