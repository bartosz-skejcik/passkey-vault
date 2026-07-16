// @vitest-environment jsdom
// lib/autofill/save-update-toast.test.ts -- jsdom coverage for Surface 2's
// save-new-login / update-existing-item toast (Phase 11, Plan 11-05, Task
// 1). Mocks `sendMessage` (ext-protocol.ts) -- confirmCapture() MUST route
// every persistence call through it, never persist directly, so every
// assertion below observes ONLY the mocked round trip. Not in this plan's
// own `files_modified` list -- added to match this codebase's 100%-of-
// siblings test convention in lib/autofill/ (11-04-SUMMARY.md precedent).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageMock = vi.fn();
vi.mock("../messaging/ext-protocol", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

import { showSaveUpdateToast, teardownSaveUpdateToast, confirmCapture } from "./save-update-toast";
import { getOrCreateShadowRoot, __resetMountForTests } from "./inpage-mount";

function shadowOf(): ShadowRoot {
  return getOrCreateShadowRoot();
}

// Flushes both the microtask queue AND one macrotask turn -- the
// confirm-click handler chains through several `await`s (confirmCapture()'s
// own async wrapper, then handleConfirm()'s await of it), more ticks than a
// couple of bare `await Promise.resolve()` calls reliably cover.
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  sendMessageMock.mockReset();
  document.body.innerHTML = "";
  __resetMountForTests();
});

afterEach(() => {
  teardownSaveUpdateToast();
  __resetMountForTests();
  vi.useRealTimers();
});

describe("showSaveUpdateToast", () => {
  it("action:'no-op' renders nothing at all (Pitfall B)", () => {
    showSaveUpdateToast({
      action: "no-op",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    expect(shadow.querySelector("[data-pv-toast]")).toBeNull();
  });

  it("action:'new' renders the save toast with origin/username and a masked password preview", () => {
    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    const toast = shadow.querySelector("[data-pv-toast]");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("example.com");
    expect(toast!.textContent).toContain("alice");
    const preview = shadow.querySelector<HTMLInputElement>("[data-pv-toast-preview]")!;
    expect(preview.type).toBe("password");
    expect(preview.value).toBe("hunter2");
    const confirmBtn = shadow.querySelector<HTMLButtonElement>("[data-pv-toast-confirm]")!;
    expect(confirmBtn.textContent).toMatch(/save|zapisz/i);
  });

  it("action:'update' renders the update toast (different title/confirm label than 'new')", () => {
    showSaveUpdateToast({
      action: "update",
      itemId: "item-1",
      currentRevision: 3,
      frameOrigin: "https://example.com",
      username: "alice",
      password: "newpass",
    });

    const shadow = shadowOf();
    const confirmBtn = shadow.querySelector<HTMLButtonElement>("[data-pv-toast-confirm]")!;
    expect(confirmBtn.textContent).toMatch(/update|zaktualizuj/i);
  });

  it("reveal toggle switches the preview input between masked and plain text", () => {
    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    const preview = shadow.querySelector<HTMLInputElement>("[data-pv-toast-preview]")!;
    const revealBtn = shadow.querySelector<HTMLButtonElement>("[data-pv-toast-reveal]")!;
    expect(preview.type).toBe("password");

    revealBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preview.type).toBe("text");

    revealBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preview.type).toBe("password");
  });

  it("confirm click re-sends the FULL field payload via capture.confirm and shows a success flash that auto-dismisses", async () => {
    vi.useFakeTimers();
    sendMessageMock.mockResolvedValue({ status: "ok", item: { id: "item-1", revision: 1 } });

    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-toast-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(0);

    expect(sendMessageMock).toHaveBeenCalledWith({
      kind: "capture.confirm",
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
      itemId: undefined,
      currentRevision: undefined,
    });

    const message = shadow.querySelector<HTMLElement>("[data-pv-toast-message]")!;
    expect(message.hidden).toBe(false);
    expect(message.textContent).toMatch(/saved|zapisano/i);

    // Post-success flash is the ONE exception to "never auto-dismisses".
    await vi.advanceTimersByTimeAsync(1500);
    expect(shadow.querySelector("[data-pv-toast]")).toBeNull();
  });

  it("{status:'conflict'} shows update.conflict copy and keeps the toast open", async () => {
    sendMessageMock.mockResolvedValue({ status: "conflict", message: "stale revision" });

    showSaveUpdateToast({
      action: "update",
      itemId: "item-1",
      currentRevision: 3,
      frameOrigin: "https://example.com",
      username: "alice",
      password: "newpass",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-toast-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsync();

    expect(shadow.querySelector("[data-pv-toast]")).not.toBeNull();
    const message = shadow.querySelector<HTMLElement>("[data-pv-toast-message]")!;
    expect(message.textContent).toMatch(/another device|innym urządzeniu/i);
  });

  it("{status:'error'} shows save.failed with a Retry button and keeps the toast open", async () => {
    sendMessageMock.mockResolvedValue({ status: "error", message: "network down" });

    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-toast-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsync();

    expect(shadow.querySelector("[data-pv-toast]")).not.toBeNull();
    const confirmBtn = shadow.querySelector<HTMLButtonElement>("[data-pv-toast-confirm]")!;
    expect(confirmBtn.disabled).toBe(false);
    expect(confirmBtn.textContent).toMatch(/retry|spróbuj ponownie/i);
  });

  it("dismiss ('Not now') and close (X) both tear down the toast", () => {
    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });
    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-toast-dismiss]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shadow.querySelector("[data-pv-toast]")).toBeNull();

    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-toast-close]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(shadow.querySelector("[data-pv-toast]")).toBeNull();
  });

  it("mounting a second toast tears down the first (at most one mounted at a time)", () => {
    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://a.example.com",
      username: "alice",
      password: "hunter2",
    });
    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://b.example.com",
      username: "bob",
      password: "hunter3",
    });

    const shadow = shadowOf();
    expect(shadow.querySelectorAll("[data-pv-toast]").length).toBe(1);
    expect(shadow.querySelector("[data-pv-toast]")!.textContent).toContain("b.example.com");
  });
});

describe("confirmCapture", () => {
  it("is a thin wrapper that sends exactly one capture.confirm message", async () => {
    sendMessageMock.mockResolvedValue({ status: "ok", item: { id: "x", revision: 1 } });

    await confirmCapture({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "capture.confirm", action: "new" }),
    );
  });
});
