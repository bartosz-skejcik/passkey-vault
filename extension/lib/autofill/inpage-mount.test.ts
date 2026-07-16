// @vitest-environment jsdom
// lib/autofill/inpage-mount.test.ts -- jsdom coverage for the shared,
// lazy, tab/frame-scoped closed shadow-root mount (Phase 11, Plan 11-04,
// Task 1; theme-stamping added Plan 11-08, Task 1). jsdom implements
// attachShadow({mode:"closed"}) faithfully -- `host.shadowRoot` really is
// `null` from the page side -- so Test 1 below is a genuine assertion, not
// a mock (same convention as inpage-overlay.test.ts).
//
// Mocks `wxt/browser`'s storage.local + storage.onChanged with the same
// Map-backed fake theme-mirror.test.ts/blocked-origins.test.ts already
// use -- `getOrCreateShadowRoot()` now calls `resolveTheme()`/
// `watchMirroredTheme()` (both real, unmocked, from `../theme/
// theme-mirror`) at mount time, so this file's own storage fake is what
// those calls actually read/subscribe to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

const hoisted = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  changeListeners: [] as ChangeListener[],
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        async get(key: string) {
          return hoisted.store.has(key) ? { [key]: hoisted.store.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) {
            const oldValue = hoisted.store.get(k);
            hoisted.store.set(k, v);
            for (const listener of hoisted.changeListeners) {
              listener({ [k]: { oldValue, newValue: v } }, "local");
            }
          }
        },
      },
      onChanged: {
        addListener(fn: ChangeListener) {
          hoisted.changeListeners.push(fn);
        },
        removeListener(fn: ChangeListener) {
          hoisted.changeListeners = hoisted.changeListeners.filter((l) => l !== fn);
        },
      },
    },
  },
}));

import {
  getOrCreateShadowRoot,
  getMountHost,
  getPanelContainer,
  __resetMountForTests,
} from "./inpage-mount";
import { THEME_MIRROR_KEY } from "../theme/theme-mirror";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  hoisted.store.clear();
  hoisted.changeListeners = [];
});

afterEach(() => {
  __resetMountForTests();
});

describe("getOrCreateShadowRoot", () => {
  it("mounts a host with a CLOSED shadow root appended to document.documentElement", () => {
    const shadow = getOrCreateShadowRoot();
    const host = getMountHost();

    expect(host).not.toBeNull();
    expect(host!.isConnected).toBe(true);
    expect(host!.parentElement).toBe(document.documentElement);
    // Page-side view: null, exactly like a real closed shadow root.
    expect(host!.shadowRoot).toBeNull();
    // This module's own closure retains the real reference.
    expect(shadow).toBeInstanceOf(ShadowRoot);
  });

  it("returns the SAME shadow root instance across repeated calls (no second host mounted)", () => {
    const first = getOrCreateShadowRoot();
    const second = getOrCreateShadowRoot();

    expect(second).toBe(first);
    expect(document.documentElement.querySelectorAll("[data-pv-mount-host]").length).toBe(1);
  });

  it("does not mount anything until first called (lazy mount)", () => {
    expect(getMountHost()).toBeNull();
    expect(document.documentElement.querySelectorAll("[data-pv-mount-host]").length).toBe(0);

    getOrCreateShadowRoot();

    expect(document.documentElement.querySelectorAll("[data-pv-mount-host]").length).toBe(1);
  });

  it("the injected stylesheet(s) contain no @font-face rule and no third-party font URL (T-11-12)", () => {
    const shadow = getOrCreateShadowRoot();
    const styleEls = shadow.querySelectorAll("style");

    expect(styleEls.length).toBeGreaterThan(0);
    const css = Array.from(styleEls)
      .map((el) => el.textContent ?? "")
      .join("\n");
    expect(css).not.toMatch(/@font-face/i);
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
  });

  it("injects the shared INPAGE_THEME_CSS stylesheet (both vault-dark and vault-light blocks present)", () => {
    const shadow = getOrCreateShadowRoot();
    const styleEls = shadow.querySelectorAll("style");
    const css = Array.from(styleEls)
      .map((el) => el.textContent ?? "")
      .join("\n");

    expect(css).toMatch(/\[data-theme="vault-dark"\]/);
    expect(css).toMatch(/\[data-theme="vault-light"\]/);
  });

  it("mounts a theme-stamped panel container inside the shadow root", () => {
    getOrCreateShadowRoot();
    const container = getPanelContainer();

    expect(container).not.toBeNull();
    expect(container!.hasAttribute("data-pv-panel-container")).toBe(true);
  });

  it("stamps data-theme on the panel container from resolveTheme() (mirror already set to vault-light)", async () => {
    hoisted.store.set(THEME_MIRROR_KEY, "vault-light");

    getOrCreateShadowRoot();
    await flushMicrotasks();

    expect(getPanelContainer()!.getAttribute("data-theme")).toBe("vault-light");
  });

  it("falls back to vault-dark when no mirror value is set (jsdom has no matchMedia, so vault-dark is resolveTheme()'s ultimate default)", async () => {
    getOrCreateShadowRoot();
    await flushMicrotasks();

    expect(getPanelContainer()!.getAttribute("data-theme")).toBe("vault-dark");
  });

  it("re-stamps the panel container LIVE when the storage mirror changes (watchMirroredTheme)", async () => {
    getOrCreateShadowRoot();
    await flushMicrotasks();
    expect(getPanelContainer()!.getAttribute("data-theme")).toBe("vault-dark");

    for (const listener of hoisted.changeListeners) {
      listener({ [THEME_MIRROR_KEY]: { newValue: "vault-light" } }, "local");
    }

    expect(getPanelContainer()!.getAttribute("data-theme")).toBe("vault-light");
  });

  it("__resetMountForTests detaches the theme watcher (no listener leak across mounts)", async () => {
    getOrCreateShadowRoot();
    await flushMicrotasks();
    expect(hoisted.changeListeners.length).toBe(1);

    __resetMountForTests();

    expect(hoisted.changeListeners.length).toBe(0);
  });
});
