// lib/autofill/inpage-theme.ts -- D-12/D-13's shared shadow-DOM stylesheet
// (Phase 11, Plan 11-08, Task 1). The SINGLE style source every in-page
// surface (generate-popover.ts, save-update-toast.ts, mismatch-modal.ts via
// inpage-mount.ts's shared shadow root, and inpage-overlay.ts's own
// separate shadow root) injects, so no surface ever hand-declares a literal
// OKLCH/hex color value again -- swap the token, every surface follows.
//
// `packages/pv-ui/tokens.css` is imported as RAW CSS TEXT via Vite's
// built-in `?inline` query suffix (no build step needed beyond what WXT's
// own Vite pipeline already runs for every `.ts` file in this bundle --
// `?inline` tells Vite to return the fully processed CSS as a plain string
// instead of injecting a `<style>` tag into the page itself, which is
// exactly the "give me the text so I can inject it into MY OWN shadow
// root" shape this file needs). Verified against the packaged
// `wxt build`/`wxt build -b firefox` output, not just vitest -- see
// inpage-theme.test.ts's own header comment for the fallback this file
// would need if `?inline` ever stopped resolving through a content-script
// bundle (it does not, as of WXT 0.20.27 / Vite 7.3.6, confirmed at
// execution time).
//
// IMPORTANT shadow-DOM gotcha this file's shape exists to work around:
// `tokens.css`'s default (dark) theme block is `:root, [data-theme=
// "vault-dark"] { ... }` -- but `:root` NEVER matches anything inside a
// shadow tree (it always resolves to the top-level document's own root
// element, never a ShadowRoot). Injecting tokens.css verbatim into a shadow
// root therefore only ever activates the `[data-theme="vault-dark"]`/
// `[data-theme="vault-light"]` halves of each rule -- inpage-mount.ts
// (Task 1) and inpage-overlay.ts (Task 2) MUST stamp a `data-theme`
// attribute on an element inside the shadow tree (the shared panel
// container / the overlay's own panel elements) for ANY of these tokens to
// resolve at all. There is no implicit `:root`-driven default the way
// web/'s and the popup's own light-DOM `<html>`/`<body>` get one for free.
import tokensCss from "pv-ui/tokens.css?inline";

// T-11-12 (also enforced by inpage-mount.ts's own MOUNT_CSS and every
// individual surface's own literal font-family declaration prior to this
// plan): NO `@font-face` rule, NO web-accessible-resource font file, NO
// third-party font URL of any kind. The system-ui fallback is the only
// source of "DM Sans" a shadow-DOM surface can ever legitimately get (the
// host page's own `@font-face`, even if it happens to declare DM Sans,
// never reaches a shadow tree's inherited font stack the way this
// `font-family` declaration below does for descendants of whatever element
// this stylesheet's `:host`/container rule targets).
const FONT_STACK = `"DM Sans", system-ui, -apple-system, sans-serif`;

/**
 * The single stylesheet text every Phase 11 in-page surface injects into
 * its own shadow root's `<style>` element: `tokens.css`'s raw OKLCH custom
 * properties (both `vault-dark`/`vault-light` `[data-theme]` blocks)
 * followed by the shared font-stack declaration, scoped to `[data-theme]`
 * itself so it travels with the same stamped element the color tokens key
 * off of -- no separate `:host` rule needed, and no risk of the font stack
 * applying before a theme has even been stamped.
 */
export const INPAGE_THEME_CSS = `${tokensCss}
[data-theme="vault-dark"], [data-theme="vault-light"] {
  font-family: ${FONT_STACK};
}
`;
