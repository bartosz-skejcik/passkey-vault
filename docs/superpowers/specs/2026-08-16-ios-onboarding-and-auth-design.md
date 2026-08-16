# iOS onboarding + auth — design spec

**Date:** 2026-08-16 · **Status:** approved by Bartek · **Scope:** Phase 38 (UI layer only)
**Visual reference:** `ios/brand/screens.html` (open in a browser — 12 screens, light + dark, rendered
from the real token values)

---

## 1. Direction

**Native iOS structure, our colour.** Standard `NavigationStack`, `List`/`Form`, system materials,
SF Symbols, system Dynamic Type. Brand identity is carried by the **palette and the semantic colour
language**, not by re-implementing web chrome.

Rejected explicitly, so it does not creep back: porting the web look (1px borders, background-step
elevation, hand-built rows). Those idioms exist because the web has no grouped lists or materials.
iOS has both, and fighting them costs Dynamic Type and accessibility for nothing.

**Consequence for implementers:** if a stock SwiftUI control does the job, use it and tint it. Do not
hand-draw a control to match a mockup pixel — the mockups are drawn in HTML and SwiftUI will lay the
real thing out slightly differently. **The tokens and the structure are the contract; the pixels are
an illustration.**

---

## 2. Colour — the contract

All colours come from the asset catalog, generated from `ios/brand/tokens.json`. **Never hardcode a
hex in a view.** `scripts/gen-ios-colorsets.py --check` fails on drift.

| Asset | Use |
|---|---|
| `PVBackground` | Screen background |
| `PVSurface` | Cards, list cells, fields, sheets |
| `PVSurfaceAlt` | Grouped-list section backgrounds, sunken areas |
| `PVTextPrimary` / `PVTextMuted` | Body / secondary text |
| `PVAccent` | **Primary action, tint, links.** Text AND button fill |
| `PVOnAccent` | The label **on** a `PVAccent` fill — mode-aware, see below |
| `PVAccentBold` | Brand coral. **Large text (≥18pt regular / ≥14pt bold) and decoration only** |
| `PVPasskey` | Passkey / passwordless / AutoFill-enabled |
| `PVSuccess` `PVWarning` `PVError` `PVInfo` `PVLink` | Semantic state |

### Two rules that are easy to get wrong

1. **A primary button's label is `PVOnAccent`, never `.white`.** In dark mode `PVAccent` is lightened
   so it stays readable as text on a dark surface, which makes white-on-it 3.34:1. `PVOnAccent` is
   white in light and near-black in dark. Hardcoding `.white` reintroduces the exact AA failure this
   work fixed.
2. **`PVAccentBold` must never be bound to body-size text.** It is 3.42:1 and deliberately exempt from
   the AA gate. `ContrastTests` asserts it stays below 4.5 — if you "fix" it, it duplicates `PVAccent`.

---

## 3. Onboarding — 3 paged steps

New. Presented once, on first launch, before auth. `@AppStorage("pv.onboarding.completed")` gates it.

Shared shell: `TabView(.page)` or equivalent, three dots, `PVAccent` on the active dot.

### 3.1 Welcome

- App icon (rounded ~23pt corner), title **“Passkey Vault”**, one body line:
  *“Your passwords and passkeys, on a server you control. Nothing leaves this phone unencrypted.”*
- Primary: **Get started** · Ghost: **I already have a vault**
- The only screen whose job is identity. Keep it quiet.

### 3.2 Server

- Large title **“Where your vault lives”**, subtitle *“This is already set up for you. Change it only
  if you run your own server.”*
- One inset-grouped row: `Server` → `vault.blonie.cloud`, tappable.
- Footer text carries the explanation; the row stays a **value**, not a question.
- **`Skip` in the nav bar.** Apple's onboarding guidance: *“Postpone nonessential setup flows.
  Provide reasonable default settings.”* Most users must be able to continue without touching this.
- **Editing state:** `https://` prefix shown, keyboard `.URL`, autocapitalisation off, autocorrect off.
- **Reachability is checked before `Continue` succeeds**, and the result is shown inline
  (`PVPasskey` on success, `PVError` on failure). A typo must fail here, not as a confusing sign-in
  error two screens later.

**Default:** `https://vault.blonie.cloud`

### 3.3 AutoFill

- Large title **“Fill passwords anywhere”**.
- Three-row numbered list: Open Settings → General → AutoFill → Turn on Passkey Vault.
- Footer states the honest constraint: *“iOS only lets you do this from Settings — no app can turn it
  on for you. You can come back to this any time.”*
- Primary: **Open Settings** (`UIApplication.openSettingsURLString`) · Ghost: **Later**
- **Returning state:** when `ASCredentialIdentityStore.state` reports enabled, replace the list with a
  `PVPasskey` confirmation and change the primary to **Done**. Re-check on
  `scenePhase == .active`.

> **This step is not a permission request.** There is no API to ask for it and no `NS*UsageDescription`
> involved. Copy must not imply the app can grant it.

---

## 4. Auth — rework

Structure is unchanged. This is a colour correction plus one copy move.

- Both screens state the server under the title (**“to vault.blonie.cloud”**) — necessary now that
  self-hosting is real.
- Sign in: Email, Master password → **Sign in** · ghost **Create a vault instead**.
- Register: Email, Master password, Confirm → **Create vault** · ghost **I already have one**.

### The one structural change

The irreversibility warning **moves out of the `UIAlertController` and into the form** as an inline
`PVWarning` callout:

> **There is no recovery.** If you forget this password, no one — including us — can open your vault.

Reason, not taste: `37-VERIFICATION.md` `residual_items` carries an open item where that copy is
*visibly clipped mid-sentence* at AX5 inside the alert
(`ios/evidence/37/screens/lock-forgot-light-a11y.png`), and the scroll was never driven. Inline text
in a scrolling form **retires** the item instead of re-testing it. Note this in the phase summary as
closing that residual item.

---

## 5. Lock — 9 states, one view

One layout. States differ **only** in the status slot and which control is emphasised. Do not build
nine screens.

| # | State | Slot | Primary |
|---|---|---|---|
| 1 | Biometry ready | — | Unlock with Face ID |
| 2 | Biometry presenting | — (system sheet) | dimmed |
| 3 | Biometry unavailable | `PVTextMuted` | Unlock (password) |
| 4 | **Envelope invalidated** | `PVWarning` | Unlock (password) |
| 5 | Wrong password | `PVError` | Unlock |
| 6 | Throttled | `PVError` | disabled |
| 7 | No device passcode | `PVTextMuted` | Unlock · Open Settings |
| 8 | Offline | `PVTextMuted` | Unlock |
| 9 | Unlocking | — | spinner |

**State 4 is load-bearing and already implemented — do not regress it.** `623cf2c` added `@FocusState`
moving focus to the password field on `.envelopeInvalidated`, covering both the real path and the
DEBUG `applyForcedUITestState` hook so the two cannot drift. Its passing run was observed for the
first time on device 2026-08-16. Copy: *“Face ID changed on this device. For your safety, unlock with
your master password once — Face ID will work again straight after.”*

State 6 disables controls **visibly** rather than removing them, so the screen does not restructure
while the user waits.

---

## 6. Constraints

- **Debug builds only.** `xcodebuild -configuration Release` crashes the Swift compiler — landmine
  **L-14**, `ios/evidence/38/L14-RELEASE-BUILD-CRASH.md`. Do not attempt to work around it.
- **Do not touch** the uncommitted Phase 38 item-model work (`Vault/ItemFields.swift`,
  `ItemNormalize.swift`, `ItemCapabilities.swift`, `IdentityAddress.swift` and their tests). That is a
  paused wave and belongs to plan 38-03.
- `.planning/` is never committed from this worktree. Durable notes go in `ios/IOS-SPIKE-LOG.md`.
- The server URL is currently **hardcoded** in `PvApiClient`. Making it configurable is part of this
  work and was always Phase 38's (`ios/evidence/37/DEVICE-VERIFICATION-RESULT.md` says so explicitly).

## 7. Done means

- [ ] Onboarding shows once, is skippable at the server step, and never blocks on AutoFill.
- [ ] Server URL is user-configurable, persisted, defaulted to `https://vault.blonie.cloud`, and
      validated for reachability before it is accepted.
- [ ] No `.white` on any accent fill; no hardcoded hex in any view.
- [ ] `gen-ios-colorsets.py --check` passes.
- [ ] `ContrastTests` passes (8 tests).
- [ ] The forgot-password warning is inline, and the 37 residual item is noted as closed.
- [ ] Lock state 4 focus behaviour still works.
