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
    // tokens.css's OWN `:root, [data-theme="vault-dark"]` selector is
    // expected verbatim (this file injects the package's raw text
    // unmodified) -- what matters is that INPAGE_THEME_CSS's OWN
    // font-stack rule below it never relies on `:root` alone, since a
    // shadow tree's `:root` never matches. The font-stack block is scoped
    // to `[data-theme="vault-dark"], [data-theme="vault-light"]` only.
    const fontRuleMatch = INPAGE_THEME_CSS.match(/\[data-theme="vault-dark"\], \[data-theme="vault-light"\] \{[^}]*font-family/);
    expect(fontRuleMatch).not.toBeNull();
  });
});
