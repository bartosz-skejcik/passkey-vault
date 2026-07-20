// The canonical test for pv-ui/i18n/engine.ts (D-13/DS-02, plan 16-04) —
// SAME test content as web/src/lib/i18n/engine.test.ts and
// extension/lib/i18n/engine.test.ts (each of THOSE two import the shared
// engine directly from `pv-ui/i18n/engine`, since no local shim file
// exists this phase; this canonical copy imports it via a plain relative
// `./engine`, being in the same directory as the module under test),
// mirroring the packages/pv-ui/generator/password.test.ts x3 precedent.
// This pv-ui-located copy stays orphan-but-kept (not wired into any
// script), same as that precedent.
//
// `vi.stubGlobal("navigator", ...)` (not `Object.defineProperty`) is used
// throughout so this SAME file behaves identically whether it runs under
// jsdom (web's single vitest project, `navigator` defined by default) or
// node (extension's "background" vitest project, `navigator` undefined by
// default) — see extension/lib/theme/theme-mirror.test.ts's own
// `vi.stubGlobal("matchMedia", ...)` precedent for this convention.
import { afterEach, describe, expect, it, vi } from "vitest";
import { interpolate, resolveLocale, t } from "./engine";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("t", () => {
  it("is genuinely locale-parameterized, not a hardcoded branch", () => {
    const dict = { greeting: { pl: "Czesc", en: "Hi" } };
    expect(t(dict, "pl", "greeting")).toBe("Czesc");
    expect(t(dict, "en", "greeting")).toBe("Hi");
  });
});

describe("interpolate", () => {
  it("substitutes a {token} placeholder with the given value", () => {
    expect(interpolate("Hello {name}", { name: "Bartek" })).toBe("Hello Bartek");
  });

  it("appends values (space-joined) when no {token} placeholder is found", () => {
    expect(interpolate("no tokens here", { extra: "x" })).toBe("no tokens here x");
  });
});

describe("resolveLocale", () => {
  it("returns \"en\" when navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined);
    expect(resolveLocale()).toBe("en");
  });

  it("returns \"pl\" when navigator.language starts with \"pl\"", () => {
    vi.stubGlobal("navigator", { language: "pl-PL" });
    expect(resolveLocale()).toBe("pl");
  });

  it("returns \"en\" for any other navigator.language", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(resolveLocale()).toBe("en");

    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(resolveLocale()).toBe("en");
  });
});
