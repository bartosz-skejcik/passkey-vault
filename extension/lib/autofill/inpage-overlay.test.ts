// @vitest-environment jsdom
// lib/autofill/inpage-overlay.test.ts -- jsdom coverage for the crypto-free,
// framework-free shadow-DOM overlay controller (10-10-PLAN.md Task 1). jsdom
// implements attachShadow({mode:"closed"}) faithfully -- `host.shadowRoot`
// really is `null` from outside, exactly like a real browser -- Test 1 below
// is a genuine assertion, not a mock. This suite reaches INTO the closed
// shadow root only via `__getShadowRootForTests()`, a module-internal
// WeakMap accessor exported solely for this test file (see its header
// comment in inpage-overlay.ts) -- a page script has no way to reach the
// same reference, since it never has access to this module's own closure.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOverlayController, __getShadowRootForTests, type OverlayController } from "./inpage-overlay";
import type { AutofillMatch } from "./types";

const LOGIN_MATCH: AutofillMatch = {
  itemId: "item-login-1",
  kind: "login",
  label: "Example Login",
  maskedHint: "j***@example.com",
};

const CARD_MATCH: AutofillMatch = {
  itemId: "item-card-1",
  kind: "card",
  label: "Personal Visa",
  maskedHint: "••••4242",
};

let controllers: OverlayController[] = [];

function makeController(onPick = vi.fn()) {
  const controller = createOverlayController({ onPick });
  controllers.push(controller);
  return { controller, onPick };
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.querySelectorAll("[data-pv-autofill-host]").forEach((el) => el.remove());
  controllers = [];
});

afterEach(() => {
  controllers.forEach((c) => c.destroy());
});

describe("createOverlayController", () => {
  it("Test 1: appends a host element with a CLOSED shadow root (element.shadowRoot is null from the page side)", () => {
    const { controller } = makeController();

    expect(controller.host.isConnected).toBe(true);
    expect(controller.host.parentElement).toBe(document.documentElement);
    // The page-side view: null, exactly like a real "closed" shadow root.
    expect(controller.host.shadowRoot).toBeNull();
    // This module's OWN closure still has the reference (attachShadow()
    // always returns it to its caller regardless of mode) -- proving the
    // controller can render into it even though the page cannot reach in.
    expect(__getShadowRootForTests(controller.host)).not.toBeNull();
  });
});

describe("renderFormPrompt", () => {
  it("Test 2: renders one row per match with label + sublabel + only the maskedHint -- no full secret, no plaintext held", () => {
    const { controller } = makeController();

    controller.renderFormPrompt([LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const rows = shadow.querySelectorAll("[data-pv-row]");
    expect(rows.length).toBe(1);

    const text = shadow.textContent ?? "";
    expect(text).toContain(LOGIN_MATCH.label);
    expect(text).toContain(LOGIN_MATCH.maskedHint);

    // The row's own DOM structure carries nothing beyond metadata --
    // label, maskedHint and structural chrome (icon glyph, chevron). There
    // is no field anywhere on the row for a live credential value to hide
    // in even by accident.
    const row = shadow.querySelector("[data-pv-row]") as HTMLElement;
    expect(row.dataset.itemId).toBe(LOGIN_MATCH.itemId);
    expect(row.dataset.kind).toBe(LOGIN_MATCH.kind);
  });

  it("Test 3: clicking a login row invokes onPick with { itemId, kind: 'login' } exactly once", () => {
    const { controller, onPick } = makeController();
    controller.renderFormPrompt([LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const row = shadow.querySelector(`[data-pv-row][data-item-id="${LOGIN_MATCH.itemId}"]`) as HTMLElement;
    row.click();

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(LOGIN_MATCH.itemId, "login");
  });

  it("Test 4: clicking a card row does NOT immediately onPick -- shows a confirm affordance; onPick fires only after the confirm click (D-12)", () => {
    const { controller, onPick } = makeController();
    controller.renderFormPrompt([CARD_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const row = shadow.querySelector(`[data-pv-row][data-item-id="${CARD_MATCH.itemId}"]`) as HTMLElement;
    row.click();

    expect(onPick).not.toHaveBeenCalled();

    const confirmSubmit = shadow.querySelector("[data-pv-confirm-submit]") as HTMLElement | null;
    expect(confirmSubmit).not.toBeNull();

    confirmSubmit!.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(CARD_MATCH.itemId, "card");
  });

  it("Test 4b: cancelling the card confirm never fires onPick and restores the row", () => {
    const { controller, onPick } = makeController();
    controller.renderFormPrompt([CARD_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const row = shadow.querySelector(`[data-pv-row][data-item-id="${CARD_MATCH.itemId}"]`) as HTMLElement;
    row.click();

    const cancelBtn = shadow.querySelector("[data-pv-confirm] .pv-btn-ghost") as HTMLElement;
    cancelBtn.click();

    expect(onPick).not.toHaveBeenCalled();
    expect((row as HTMLElement).hidden).toBe(false);
  });

  it("Test 5: dismiss() removes the prompt and a subsequent renderFormPrompt is a no-op for the page session", () => {
    const { controller } = makeController();
    controller.renderFormPrompt([LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    expect(shadow.querySelectorAll("[data-pv-row]").length).toBe(1);

    controller.dismiss();
    expect(controller.isDismissed()).toBe(true);
    expect(shadow.querySelectorAll("[data-pv-row]").length).toBe(0);

    controller.renderFormPrompt([LOGIN_MATCH]);
    expect(shadow.querySelectorAll("[data-pv-row]").length).toBe(0);
  });

  it("Test 5b: blockSite() suppresses BOTH surfaces for the page session and is reflected by isBlocked()", () => {
    const { controller } = makeController();
    controller.blockSite();
    expect(controller.isBlocked()).toBe(true);

    controller.renderFormPrompt([LOGIN_MATCH]);
    const shadow = __getShadowRootForTests(controller.host)!;
    expect(shadow.querySelectorAll('[data-pv-surface="prompt"]').length).toBe(0);

    const anchor = document.createElement("input");
    document.body.appendChild(anchor);
    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);
    expect(shadow.querySelectorAll('[data-pv-surface="dropdown"]').length).toBe(0);
  });
});

describe("renderFieldDropdown", () => {
  function anchorWithRect(): HTMLInputElement {
    const anchor = document.createElement("input");
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 50,
        right: 250,
        bottom: 130,
        width: 200,
        height: 30,
        x: 50,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    return anchor;
  }

  it("Test 6: positions the panel relative to anchorEl (mounted; exact px math not asserted)", () => {
    const anchor = anchorWithRect();
    const { controller } = makeController();

    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const panel = shadow.querySelector('[data-pv-surface="dropdown"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.querySelectorAll("[data-pv-row]").length).toBe(1);
  });

  it("Test 7: also mounts a field affordance icon that toggles the dropdown open/closed on click", () => {
    const anchor = anchorWithRect();
    const { controller } = makeController();

    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const icon = shadow.querySelector("[data-pv-field-icon]") as HTMLElement | null;
    expect(icon).not.toBeNull();

    const panel = shadow.querySelector('[data-pv-surface="dropdown"]') as HTMLElement;
    expect(panel.hidden).toBe(false);

    icon!.click();
    expect(panel.hidden).toBe(true);

    icon!.click();
    expect(panel.hidden).toBe(false);
  });

  it("Test 9: a window scroll event repositions the panel/icon from the LIVE anchorEl rect, not the rect captured at mount", () => {
    const anchor = anchorWithRect();
    const { controller } = makeController();

    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const panel = shadow.querySelector('[data-pv-surface="dropdown"]') as HTMLElement;
    const icon = shadow.querySelector("[data-pv-field-icon]") as HTMLElement;
    expect(panel.style.top).toBe("134px"); // rect.bottom (130) + 4
    expect(icon.style.left).toBe("226px"); // rect.right (250) - 24

    // The field moved (page scrolled) -- getBoundingClientRect now returns
    // a different rect for the SAME anchor element.
    anchor.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 50,
        right: 250,
        bottom: 30,
        width: 200,
        height: 30,
        x: 50,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    window.dispatchEvent(new Event("scroll"));

    expect(panel.style.top).toBe("34px"); // new rect.bottom (30) + 4
    expect(icon.style.left).toBe("226px"); // rect.right unchanged
  });

  it("Test 10: a window resize event also repositions from the live rect", () => {
    const anchor = anchorWithRect();
    const { controller } = makeController();

    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const panel = shadow.querySelector('[data-pv-surface="dropdown"]') as HTMLElement;

    anchor.getBoundingClientRect = () =>
      ({
        top: 200,
        left: 10,
        right: 210,
        bottom: 230,
        width: 200,
        height: 30,
        x: 10,
        y: 200,
        toJSON: () => ({}),
      }) as DOMRect;

    window.dispatchEvent(new Event("resize"));

    expect(panel.style.top).toBe("234px"); // new rect.bottom (230) + 4
    expect(panel.style.left).toBe("10px");
  });

  it("Test 11: when the anchored field's rect moves fully outside the viewport, the dropdown is torn down (matches clearFieldDropdown's own effect)", () => {
    const anchor = anchorWithRect();
    const { controller } = makeController();

    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    expect(shadow.querySelectorAll('[data-pv-surface="dropdown"]').length).toBe(1);
    expect(shadow.querySelectorAll("[data-pv-field-icon]").length).toBe(1);

    // Scrolled far enough that the field is entirely above the viewport.
    anchor.getBoundingClientRect = () =>
      ({
        top: -500,
        left: 50,
        right: 250,
        bottom: -470,
        width: 200,
        height: 30,
        x: 50,
        y: -500,
        toJSON: () => ({}),
      }) as DOMRect;

    window.dispatchEvent(new Event("scroll"));

    expect(shadow.querySelectorAll('[data-pv-surface="dropdown"]').length).toBe(0);
    expect(shadow.querySelectorAll("[data-pv-field-icon]").length).toBe(0);
  });

  it("Test 12: clearFieldDropdown() detaches the scroll/resize listeners -- no leak, no further repositioning after teardown", () => {
    const anchor = anchorWithRect();
    const { controller } = makeController();

    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    controller.renderFieldDropdown(anchor, [LOGIN_MATCH]);
    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), { capture: true, passive: true });
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function), { passive: true });

    controller.clearFieldDropdown();
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function), { capture: true });
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("controller does not hold or leak a live credential value", () => {
  it("Test 8: the only channel any data leaves through is onPick(itemId, kind) -- no value argument exists on that callback", () => {
    const { controller, onPick } = makeController();
    controller.renderFormPrompt([LOGIN_MATCH]);

    const shadow = __getShadowRootForTests(controller.host)!;
    const row = shadow.querySelector(`[data-pv-row][data-item-id="${LOGIN_MATCH.itemId}"]`) as HTMLElement;
    row.click();

    expect(onPick.mock.calls[0]).toEqual([LOGIN_MATCH.itemId, "login"]);
    expect(onPick.mock.calls[0]).toHaveLength(2);
  });
});
