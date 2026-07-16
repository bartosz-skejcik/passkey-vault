// @vitest-environment jsdom
// lib/theme/theme-mirror.test.ts — D-12's theme-mirror pipeline (plan
// 11-07, Task 2). Mocks wxt/browser's storage.local + storage.onChanged
// with a Map-backed fake (blocked-origins.test.ts's established
// convention) and jsdom's own `matchMedia` (unimplemented by default) via
// vi.stubGlobal. Pins: T-11-30 enum validation on read AND write, the
// mirror -> prefers-color-scheme -> vault-dark fallback order (matching
// web/src/app/layout.tsx's own themeInitScript), the MutationObserver
// keeping the mirror live on a `data-theme` attribute flip, and
// watchMirroredTheme()'s live-update subscription (detach included).
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
            // Fires registered listeners synchronously -- close enough to
            // chrome.storage's real same-process firing timing for this
            // suite's purposes (no cross-context IPC to model here).
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

import { browser } from "wxt/browser";
import {
  captureThemeFromWebApp,
  resolveTheme,
  watchMirroredTheme,
  THEME_MIRROR_KEY,
} from "./theme-mirror";

function stubMatchMedia(prefersLight: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("light") ? prefersLight : !prefersLight,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
}

// jsdom's `document` is shared across every `it` block in this file (no
// per-test environment reset), so a MutationObserver created via
// captureThemeFromWebApp() in one test would otherwise leak into and
// silently corrupt a LATER test's assertions (most notably the dedicated
// detach() test below). Every test that creates one registers its own
// detach here; afterEach sweeps whatever is left.
let pendingDetaches: Array<() => void> = [];

function trackedCaptureThemeFromWebApp(doc: Document): () => void {
  const detach = captureThemeFromWebApp(doc);
  pendingDetaches.push(detach);
  return detach;
}

beforeEach(() => {
  hoisted.store.clear();
  hoisted.changeListeners.length = 0;
  document.documentElement.removeAttribute("data-theme");
  pendingDetaches = [];
});

afterEach(() => {
  for (const detach of pendingDetaches) {
    detach();
  }
  vi.unstubAllGlobals();
});

describe("captureThemeFromWebApp", () => {
  it("persists a valid data-theme value from the document immediately", () => {
    document.documentElement.setAttribute("data-theme", "vault-light");
    trackedCaptureThemeFromWebApp(document);
    expect(hoisted.store.get(THEME_MIRROR_KEY)).toBe("vault-light");
  });

  it("does NOT persist an invalid/garbage data-theme value (T-11-30 enum validation)", () => {
    document.documentElement.setAttribute("data-theme", "<script>alert(1)</script>");
    trackedCaptureThemeFromWebApp(document);
    expect(hoisted.store.has(THEME_MIRROR_KEY)).toBe(false);
  });

  it("does NOT persist anything when data-theme is absent", () => {
    trackedCaptureThemeFromWebApp(document);
    expect(hoisted.store.has(THEME_MIRROR_KEY)).toBe(false);
  });

  it("keeps the mirror live via a MutationObserver on attribute flip", async () => {
    document.documentElement.setAttribute("data-theme", "vault-dark");
    trackedCaptureThemeFromWebApp(document);
    expect(hoisted.store.get(THEME_MIRROR_KEY)).toBe("vault-dark");

    document.documentElement.setAttribute("data-theme", "vault-light");
    await flushMicrotasks();
    expect(hoisted.store.get(THEME_MIRROR_KEY)).toBe("vault-light");
  });

  it("detach() stops the observer from reacting to further flips", async () => {
    document.documentElement.setAttribute("data-theme", "vault-dark");
    // NOT tracked -- this test detaches immediately itself; tracking it
    // too would just make the afterEach sweep call an already-detached
    // (idempotent, harmless) detach a second time, but leaving it
    // untracked keeps this test's intent legible on its own.
    const detach = captureThemeFromWebApp(document);
    detach();

    document.documentElement.setAttribute("data-theme", "vault-light");
    await flushMicrotasks();
    expect(hoisted.store.get(THEME_MIRROR_KEY)).toBe("vault-dark");
  });
});

describe("resolveTheme", () => {
  it("returns the mirrored theme when a valid one is persisted", async () => {
    hoisted.store.set(THEME_MIRROR_KEY, "vault-light");
    stubMatchMedia(false);
    await expect(resolveTheme()).resolves.toBe("vault-light");
  });

  it("falls through to prefers-color-scheme (light) when no mirror is persisted", async () => {
    stubMatchMedia(true);
    await expect(resolveTheme()).resolves.toBe("vault-light");
  });

  it("falls through to prefers-color-scheme (dark) when no mirror is persisted", async () => {
    stubMatchMedia(false);
    await expect(resolveTheme()).resolves.toBe("vault-dark");
  });

  it("falls through past an invalid mirror value to prefers-color-scheme (T-11-30, same as a missing mirror)", async () => {
    hoisted.store.set(THEME_MIRROR_KEY, "<img src=x>");
    stubMatchMedia(true);
    await expect(resolveTheme()).resolves.toBe("vault-light");
  });

  it("defaults to vault-dark when there is no mirror and matchMedia is unavailable", async () => {
    vi.stubGlobal("matchMedia", undefined);
    await expect(resolveTheme()).resolves.toBe("vault-dark");
  });
});

describe("watchMirroredTheme", () => {
  it("invokes the callback with the new theme when the mirror key changes", async () => {
    const cb = vi.fn();
    watchMirroredTheme(cb);

    await browser.storage.local.set({ [THEME_MIRROR_KEY]: "vault-light" });

    expect(cb).toHaveBeenCalledWith("vault-light");
  });

  it("ignores changes to unrelated storage keys", async () => {
    const cb = vi.fn();
    watchMirroredTheme(cb);

    await browser.storage.local.set({ "some-other-key": "vault-light" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores an invalid new value (T-11-30) rather than forwarding it to the callback", async () => {
    const cb = vi.fn();
    watchMirroredTheme(cb);

    await browser.storage.local.set({ [THEME_MIRROR_KEY]: "not-a-real-theme" });

    expect(cb).not.toHaveBeenCalled();
  });

  it("detach() stops further callback invocations", async () => {
    const cb = vi.fn();
    const detach = watchMirroredTheme(cb);
    detach();

    await browser.storage.local.set({ [THEME_MIRROR_KEY]: "vault-light" });

    expect(cb).not.toHaveBeenCalled();
  });
});
