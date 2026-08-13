# Brand assets — iOS

## Source

`pv-logo-master-1254.png` — the "PV" monogram, 1254×1254 PNG, supplied 2026-08-13.

**There is no vector source.** This is a raster master (AI-generated), so it cannot be re-cut cleanly at
arbitrary sizes or recoloured without artefacts. 1254px is enough for the 1024px App Store icon and
nothing larger. If the mark ever needs to appear on a marketing page, in a monochrome/tinted variant, or
at print size, someone has to redraw it as SVG first — the geometry is simple enough (two counters, one
parallelogram) that this is an hour of work, not a rebuild.

## Derived

`../PasskeyVault/PasskeyVault/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
— `sips -Z 1024` from the master. Verified 1024×1024 with **no alpha channel**, which the App Store
requires and which an accidental RGBA export would silently violate.

Only the default (light) slot is filled. The `dark` and `tinted` slots are declared but empty, so iOS
falls back to the default artwork for both. That is deliberate and fine for a light-background mark —
but it means the icon does **not** currently adapt on a dark home screen.

## ⚠ Unresolved: the icon does not match the app's colour tokens

Measured off the master (decoded pixels, not eyeballed):

| Element | Logo | App token | Delta |
|---|---|---|---|
| Orange | `#FD5F36` | `PVAccent` `#E16540` | logo is brighter and more saturated |
| Cream | `#FDF7EF` | `PVBackground` (light) `#FCFBFA` | logo is warmer / more yellow |
| Navy | `#1B232D` | — | no token for it yet |

This is **not** automatically a defect — icons are routinely punchier than in-app chrome, and a mark that
matches the UI exactly can read as washed out on a home screen full of saturated competitors.

But it is an open decision, and it is not mine to make silently. Three options:

1. **Keep both.** Icon stays punchy, tokens stay calm. Document that `PVAccent` is deliberately not the
   icon orange.
2. **Pull the tokens to the logo.** `PVAccent` → `#FD5F36`, `PVBackground` → `#FDF7EF`. Warmer, closer to
   the datafa.st reference in `UI-DESIGN.md`, but re-tints every accent surface in the app and needs a
   contrast re-check against `PVTextPrimary`.
3. **Pull the logo to the tokens.** Requires the SVG that does not exist yet.

Option 2 is the one with real consequences — `UI-DESIGN.md` specifies OKLCH tokens and any change has to
survive the same Dynamic Type × light/dark matrix Phase 37 ran. **Phase 38 owns this call**, since it is
the phase that builds the full vault UI and will be exercising every one of those accent surfaces anyway.

Until then the icon and the UI are knowingly a shade apart.
