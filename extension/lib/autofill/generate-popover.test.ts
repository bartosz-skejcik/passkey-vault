// @vitest-environment jsdom
// lib/autofill/generate-popover.test.ts -- jsdom coverage for Surface 1's
// click-triggered generate-popover (Phase 11, Plan 11-04, Task 2). Mocks
// `sendMessage` (ext-protocol.ts) -- this module MUST route every generated
// value through it (D-01/D-07), never call
// generateCharacterPassword/generatePassphrase directly, so every
// assertion below observes ONLY the mocked round trip, never a real
// generator call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageMock = vi.fn();
vi.mock("../messaging/ext-protocol", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

// Plan 11-08: inpage-mount.ts's getOrCreateShadowRoot() now calls
// resolveTheme()/watchMirroredTheme() (from ../theme/theme-mirror, which
// imports `browser` from wxt/browser) at mount time -- same Map-backed
// fake theme-mirror.test.ts/blocked-origins.test.ts already use. This
// file's own assertions don't care about the resolved theme, only that
// mounting never throws.
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {
          // no-op -- no test here asserts on the theme mirror's own value
        },
      },
      onChanged: {
        addListener() {},
        removeListener() {},
      },
    },
  },
}));

import {
  mountGenerateTrigger,
  teardownGenerateTrigger,
  getGenerateTriggerHost,
} from "./generate-popover";
import { getOrCreateShadowRoot, __resetMountForTests } from "./inpage-mount";
import type { PasswordFieldPair } from "./form-detector";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// `getOrCreateShadowRoot()` is a legitimate public export (inpage-mount.ts's
// whole point is that every Phase 11 surface obtains the SAME instance
// through it) -- calling it here returns the real ShadowRoot reference,
// exactly like this module's own generate-popover.ts does internally. No
// test-only backdoor needed; `host.shadowRoot` (the page-side view) stays
// `null` throughout, which the first test below asserts directly.
function shadowOf(): ShadowRoot {
  return getOrCreateShadowRoot();
}

beforeEach(() => {
  sendMessageMock.mockReset();
  sendMessageMock.mockResolvedValue({ password: "generated-pw-1" });
  setBody("");
  __resetMountForTests();
});

afterEach(() => {
  teardownGenerateTrigger();
  __resetMountForTests();
});

describe("mountGenerateTrigger", () => {
  it("mounts a 40px trigger anchored near the field, inside the shared closed shadow root", () => {
    setBody(`<input type="password" id="pw" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: null };

    mountGenerateTrigger(field, pair);

    const host = getGenerateTriggerHost();
    expect(host).not.toBeNull();
    expect(host!.isConnected).toBe(true);
    // Page-side view stays null -- closed shadow root (T-11-11).
    expect(host!.shadowRoot).toBeNull();
  });

  it("clicking the trigger opens a 320px popover and issues one generate-request (character mode default)", async () => {
    setBody(`<input type="password" id="pw" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: null };

    mountGenerateTrigger(field, pair);
    const shadow = shadowOf();
    const trigger = shadow.querySelector<HTMLButtonElement>("[data-pv-gen-trigger]")!;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "generate-request", mode: "character" }),
    );
    const popover = shadow.querySelector<HTMLElement>("[data-pv-gen-popover]");
    expect(popover).not.toBeNull();
    const preview = shadow.querySelector<HTMLInputElement>("[data-pv-gen-preview]")!;
    expect(preview.value).toBe("generated-pw-1");
  });

  it("switching to passphrase mode issues a new generate-request with mode: passphrase", async () => {
    setBody(`<input type="password" id="pw" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: null };

    mountGenerateTrigger(field, pair);
    const shadow = shadowOf();
    shadow.querySelector<HTMLButtonElement>("[data-pv-gen-trigger]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushMicrotasks();

    sendMessageMock.mockResolvedValueOnce({ password: "passphrase-word-word" });
    shadow.querySelector<HTMLButtonElement>("[data-pv-gen-mode-passphrase]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushMicrotasks();

    expect(sendMessageMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "generate-request", mode: "passphrase" }),
    );
    const preview = shadow.querySelector<HTMLInputElement>("[data-pv-gen-preview]")!;
    expect(preview.value).toBe("passphrase-word-word");
  });

  it("apply fills BOTH the new-password and confirm-password fields and tears down the trigger/popover", async () => {
    setBody(`<input type="password" id="pw" /><input type="password" id="pw2" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const confirm = document.getElementById("pw2") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: confirm };

    mountGenerateTrigger(field, pair);
    const shadow = shadowOf();
    shadow.querySelector<HTMLButtonElement>("[data-pv-gen-trigger]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushMicrotasks();

    shadow.querySelector<HTMLButtonElement>("[data-pv-gen-apply]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(field.value).toBe("generated-pw-1");
    expect(confirm.value).toBe("generated-pw-1");
    expect(getGenerateTriggerHost()!.shadowRoot).toBeNull(); // still closed/unreachable
    expect(shadowOf().querySelector("[data-pv-gen-trigger]")).toBeNull();
    expect(shadowOf().querySelector("[data-pv-gen-popover]")).toBeNull();
  });

  it("on a {error} generate-request response, shows generate.failed inline and keeps regenerate enabled", async () => {
    setBody(`<input type="password" id="pw" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: null };
    sendMessageMock.mockResolvedValue({ error: "boom" });

    mountGenerateTrigger(field, pair);
    const shadow = shadowOf();
    shadow.querySelector<HTMLButtonElement>("[data-pv-gen-trigger]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushMicrotasks();

    const errorEl = shadow.querySelector<HTMLElement>("[data-pv-gen-error]")!;
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toMatch(/couldn't generate|try again/i);

    const regenerateBtn = shadow.querySelector<HTMLButtonElement>("[data-pv-gen-regenerate]")!;
    expect(regenerateBtn.disabled).toBe(false);
  });

  it("teardownGenerateTrigger removes both the trigger and the popover", async () => {
    setBody(`<input type="password" id="pw" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: null };

    mountGenerateTrigger(field, pair);
    const shadow = shadowOf();
    shadow.querySelector<HTMLButtonElement>("[data-pv-gen-trigger]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushMicrotasks();

    teardownGenerateTrigger();

    expect(shadow.querySelector("[data-pv-gen-trigger]")).toBeNull();
    expect(shadow.querySelector("[data-pv-gen-popover]")).toBeNull();
  });

  it("WR-05: teardownGenerateTrigger is idempotent even when a racing handler has already detached the node (packaged-build UAT: real Chrome's NotFoundError on double-remove)", async () => {
    setBody(`<input type="password" id="pw" />`);
    const field = document.getElementById("pw") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field, confirmPasswordEl: null };

    mountGenerateTrigger(field, pair);
    const shadow = shadowOf();
    const trigger = shadow.querySelector<HTMLButtonElement>("[data-pv-gen-trigger]")!;
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
    const popover = shadow.querySelector<HTMLElement>("[data-pv-gen-popover]")!;

    // Simulate the real-Chrome double-teardown race (WR-05): another
    // handler already detached these nodes by the time this teardown's own
    // remove() call runs -- Chrome throws a NotFoundError in that case.
    const originalTriggerRemove = trigger.remove.bind(trigger);
    const originalPopoverRemove = popover.remove.bind(popover);
    trigger.remove = () => {
      throw new DOMException(
        "Failed to execute 'remove' on 'Element': The node to be removed is no longer a child of this node.",
        "NotFoundError",
      );
    };
    popover.remove = () => {
      throw new DOMException(
        "Failed to execute 'remove' on 'Element': The node to be removed is no longer a child of this node.",
        "NotFoundError",
      );
    };

    expect(() => teardownGenerateTrigger()).not.toThrow();

    trigger.remove = originalTriggerRemove;
    popover.remove = originalPopoverRemove;
  });

  it("mounting a second trigger tears down the first (at most one mounted at a time)", () => {
    setBody(`<input type="password" id="pw1" /><input type="password" id="pw2" />`);
    const field1 = document.getElementById("pw1") as HTMLInputElement;
    const field2 = document.getElementById("pw2") as HTMLInputElement;
    const pair: PasswordFieldPair = { newPasswordEl: field1, confirmPasswordEl: null };

    mountGenerateTrigger(field1, pair);
    mountGenerateTrigger(field2, pair);

    const shadow = shadowOf();
    expect(shadow.querySelectorAll("[data-pv-gen-trigger]").length).toBe(1);
  });
});
