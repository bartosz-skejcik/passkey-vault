// @vitest-environment jsdom
// lib/autofill/inpage-mount.test.ts -- jsdom coverage for the shared,
// lazy, tab/frame-scoped closed shadow-root mount (Phase 11, Plan 11-04,
// Task 1). jsdom implements attachShadow({mode:"closed"}) faithfully --
// `host.shadowRoot` really is `null` from the page side -- so Test 1 below
// is a genuine assertion, not a mock (same convention as
// inpage-overlay.test.ts).
import { afterEach, describe, expect, it } from "vitest";
import { getOrCreateShadowRoot, getMountHost, __resetMountForTests } from "./inpage-mount";

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

  it("the injected stylesheet contains no @font-face rule and no third-party font URL (T-11-12)", () => {
    const shadow = getOrCreateShadowRoot();
    const styleEl = shadow.querySelector("style");

    expect(styleEl).not.toBeNull();
    const css = styleEl!.textContent ?? "";
    expect(css).not.toMatch(/@font-face/i);
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
  });
});
