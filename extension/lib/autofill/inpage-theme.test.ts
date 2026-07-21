// lib/autofill/inpage-theme.test.ts -- coverage for the shared shadow-DOM
// stylesheet (Phase 11, Plan 11-08, Task 1). Pins: `?inline` actually
// resolves `pv-ui/tokens.css` to non-empty processed CSS text under this
// project's vitest config (see vitest.config.ts's `css: true` -- vitest's
// own default (`css: false`) stubs every CSS-like import, `?inline`
// suffix included, to an empty module BEFORE Vite's real `?inline`
// transform ever runs; without `css: true` this whole file's
// `INPAGE_THEME_CSS` would silently be near-empty and every assertion
// below would be vacuous), both `[data-theme]` theme blocks are present,
// and no `@font-face`/third-party font URL sneaks in (T-11-12, same
// invariant inpage-mount.test.ts already pins for MOUNT_CSS).
import { describe, expect, it } from "vitest";
import { INPAGE_THEME_CSS } from "./inpage-theme";

describe("INPAGE_THEME_CSS", () => {
  it("resolves pv-ui/tokens.css via the ?inline import to non-trivial CSS text", () => {
    // A hand-picked token value from packages/pv-ui/tokens.css -- proves
    // this is the REAL processed file content, not an empty stub or a
    // hand-typed placeholder string.
    expect(INPAGE_THEME_CSS).toContain("--color-primary: oklch(65.31% 0.1637 37.22)");
  });

  it("contains both the vault-dark and vault-light [data-theme] blocks", () => {
    expect(INPAGE_THEME_CSS).toMatch(/\[data-theme="vault-dark"\]/);
    expect(INPAGE_THEME_CSS).toMatch(/\[data-theme="vault-light"\]/);
  });

  it("carries the shared DM Sans / system-ui font stack, scoped to a stamped [data-theme] element", () => {
    expect(INPAGE_THEME_CSS).toMatch(/font-family:\s*"DM Sans", system-ui, -apple-system, sans-serif/);
  });

  it("declares no @font-face rule and no third-party font URL (T-11-12)", () => {
    expect(INPAGE_THEME_CSS).not.toMatch(/@font-face/i);
    expect(INPAGE_THEME_CSS).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
  });

  it("never bare-declares :root as the theme selector (dead inside a shadow tree -- see this file's own header comment)", () => {
    // The font-stack rule is scoped to the stamped [data-theme] carriers,
    // never `:root` (dead inside a shadow tree).
    const fontRuleMatch = INPAGE_THEME_CSS.match(/\[data-theme="vault-dark"\], \[data-theme="vault-light"\] \{[^}]*font-family/);
    expect(fontRuleMatch).not.toBeNull();
  });

  it("rewrites tokens.css's `:root` default-block alternative to `[data-theme]` so a vault-LIGHT carrier still receives the full token set (UAT theme-parity fix)", () => {
    // tokens.css's default block is `:root, [data-theme="vault-dark"]` and
    // vault-light only overrides base-* — with `:root` dead in a shadow
    // tree, a light carrier would lose --color-primary/--color-error (the
    // Save / "Use this password" / warning-banner backgrounds). The shadow
    // copy must therefore open its default block with `[data-theme],`.
    expect(INPAGE_THEME_CSS).toMatch(/\[data-theme\]\s*,/);
    // No SELECTOR-position `:root` may remain (start of line/file or after
    // a closing brace) — comment mentions of ":root" are fine.
    expect(INPAGE_THEME_CSS).not.toMatch(/(^|\})\s*:root\s*[,{]/);
  });

  it("carries the --pv-tile-bg dark-block value (DS-04/UX-01 tile tokens)", () => {
    // A hand-picked value from the [data-theme], [data-theme="vault-dark"]
    // block -- proves the tokens survive the shadow-DOM :root -> [data-theme]
    // rewrite along with every other existing token.
    expect(INPAGE_THEME_CSS).toContain("--pv-tile-bg: oklch(96.7% 0.001 286.375)");
  });

  it("carries the --pv-tile-bg/--pv-tile-fg vault-light overrides in the vault-light block, not the dark block", () => {
    // Extract the vault-light block's own text via a regex, mirroring this
    // file's own fontRuleMatch-extraction style, rather than a bare
    // whole-string .toContain -- so a future accidental duplicate/
    // misplacement in the WRONG block is also caught.
    const vaultLightBlockMatch = INPAGE_THEME_CSS.match(/\[data-theme="vault-light"\]\s*\{([^}]*)\}/);
    expect(vaultLightBlockMatch).not.toBeNull();
    const vaultLightBlock = vaultLightBlockMatch![1];
    expect(vaultLightBlock).toContain("--pv-tile-bg: var(--color-base-200)");
    expect(vaultLightBlock).toContain(
      "--pv-tile-fg: color-mix(in oklch, var(--color-base-content) 70%, transparent)",
    );
  });
});
