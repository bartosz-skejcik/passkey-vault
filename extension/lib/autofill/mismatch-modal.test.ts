// @vitest-environment jsdom
// lib/autofill/mismatch-modal.test.ts -- jsdom coverage for Surface 3's
// blocking origin-mismatch escalation modal (Phase 11, Plan 11-05, Task 2,
// D-06/T-11-14/T-11-15). Mocks `sendMessage` (ext-protocol.ts) -- this
// module's "Save anyway" calls save-update-toast.ts's `confirmCapture()`,
// which routes through it, never a second persistence path. Not in this
// plan's own `files_modified` list -- added to match this codebase's
// 100%-of-siblings test convention in lib/autofill/ (11-04-SUMMARY.md
// precedent).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMessageMock = vi.fn();
vi.mock("../messaging/ext-protocol", () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

import { showMismatchModal, teardownMismatchModal } from "./mismatch-modal";
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
  teardownMismatchModal();
  __resetMountForTests();
  vi.useRealTimers();
});

describe("showMismatchModal", () => {
  it("renders whenever called, showing BOTH frameOrigin and topOrigin in full, unelided", () => {
    showMismatchModal({
      action: "new",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    const panel = shadow.querySelector("[data-pv-mismatch-panel]");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("role")).toBe("alertdialog");
    const banner = shadow.querySelector("[data-pv-mismatch-banner]")!;
    expect(banner.textContent).toContain("http://localhost:8792");
    expect(banner.textContent).toContain("http://127.0.0.1:8791");
  });

  it("is NOT dismissible via Escape", () => {
    showMismatchModal({
      action: "new",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    const shadow = shadowOf();
    expect(shadow.querySelector("[data-pv-mismatch-panel]")).not.toBeNull();
  });

  it("is NOT dismissible via a scrim click", () => {
    showMismatchModal({
      action: "new",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLElement>("[data-pv-mismatch-scrim]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(shadow.querySelector("[data-pv-mismatch-panel]")).not.toBeNull();
  });

  it("Cancel closes the modal without calling capture.confirm", () => {
    showMismatchModal({
      action: "new",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-mismatch-cancel]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(shadow.querySelector("[data-pv-mismatch-panel]")).toBeNull();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("'Save anyway' (action:'new') calls the SAME capture.confirm path as the toast and shows success", async () => {
    vi.useFakeTimers();
    sendMessageMock.mockResolvedValue({ status: "ok", item: { id: "item-1", revision: 1 } });

    showMismatchModal({
      action: "new",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-mismatch-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(0);

    expect(sendMessageMock).toHaveBeenCalledWith({
      kind: "capture.confirm",
      action: "new",
      frameOrigin: "http://localhost:8792",
      username: "alice",
      password: "hunter2",
      itemId: undefined,
      currentRevision: undefined,
    });

    const banner = shadow.querySelector<HTMLElement>("[data-pv-mismatch-banner]")!;
    expect(banner.textContent).toMatch(/saved|zapisano/i);

    await vi.advanceTimersByTimeAsync(1500);
    expect(shadow.querySelector("[data-pv-mismatch-panel]")).toBeNull();
  });

  it("'Save anyway' (action:'update') carries itemId/currentRevision through to capture.confirm", async () => {
    sendMessageMock.mockResolvedValue({ status: "ok", item: { id: "item-1", revision: 4 } });

    showMismatchModal({
      action: "update",
      itemId: "item-1",
      currentRevision: 3,
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "newpass",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-mismatch-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessageMock).toHaveBeenCalledWith({
      kind: "capture.confirm",
      action: "update",
      frameOrigin: "http://localhost:8792",
      username: "alice",
      password: "newpass",
      itemId: "item-1",
      currentRevision: 3,
    });
  });

  it("'Save anyway' on an action:'no-op' mismatch just dismisses -- nothing to persist", async () => {
    showMismatchModal({
      action: "no-op",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-mismatch-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(shadow.querySelector("[data-pv-mismatch-panel]")).toBeNull();
  });

  it("{status:'conflict'} shows update.conflict copy and keeps the modal open", async () => {
    sendMessageMock.mockResolvedValue({ status: "conflict", message: "stale revision" });

    showMismatchModal({
      action: "update",
      itemId: "item-1",
      currentRevision: 3,
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "newpass",
    });

    const shadow = shadowOf();
    shadow
      .querySelector<HTMLButtonElement>("[data-pv-mismatch-confirm]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsync();

    expect(shadow.querySelector("[data-pv-mismatch-panel]")).not.toBeNull();
    const banner = shadow.querySelector<HTMLElement>("[data-pv-mismatch-banner]")!;
    expect(banner.textContent).toMatch(/another device|innym urządzeniu/i);
  });

  it("showing the modal tears down any live save/update toast (mutually exclusive surfaces)", async () => {
    const { showSaveUpdateToast } = await import("./save-update-toast");
    showSaveUpdateToast({
      action: "new",
      frameOrigin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });
    const shadow = shadowOf();
    expect(shadow.querySelector("[data-pv-toast]")).not.toBeNull();

    showMismatchModal({
      action: "new",
      frameOrigin: "http://localhost:8792",
      topOrigin: "http://127.0.0.1:8791",
      username: "alice",
      password: "hunter2",
    });

    expect(shadow.querySelector("[data-pv-toast]")).toBeNull();
    expect(shadow.querySelector("[data-pv-mismatch-panel]")).not.toBeNull();
  });
});
