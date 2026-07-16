// @vitest-environment jsdom
// lib/autofill/submit-capture.test.ts — jsdom fixtures for
// attachSubmitWatcher()/captureFrameOrigin() (Phase 11, Plan 11-02, Task 2).
// Written FIRST (TDD RED) against a submit-capture.ts that does not exist
// yet -- these four fixtures MUST fail before the source file is created.
// Uses vi.useFakeTimers() per the plan's explicit instruction so the
// 3000ms give-up window and the URL-change poll are deterministic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSubmitWatcher, captureFrameOrigin } from "./submit-capture";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

// Flushes the microtask queue -- MutationObserver callbacks are scheduled
// as microtasks by jsdom, independent of vi.useFakeTimers()'s macrotask
// (setTimeout/setInterval) control, so a real await is needed for the
// observer's callback to run after a synchronous DOM mutation.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  setBody("");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachSubmitWatcher", () => {
  it("Test 1: container removed + no error -> onSuccess called once with correct username/password", async () => {
    setBody(`
      <div id="container">
        <input type="text" name="email" id="user" autocomplete="username" value="alice@example.com" />
        <input type="password" name="password" id="pw" autocomplete="current-password" value="hunter2" />
        <button type="submit" id="go">Log in</button>
      </div>
    `);
    const container = document.getElementById("container") as HTMLElement;
    const onSuccess = vi.fn();
    attachSubmitWatcher(container, onSuccess);

    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    container.remove();
    await flushMicrotasks();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("alice@example.com", "hunter2");
  });

  it("Test 2: history.pushState URL change + no error -> onSuccess called", async () => {
    setBody(`
      <div id="container">
        <input type="text" name="email" id="user" autocomplete="username" value="bob@example.com" />
        <input type="password" name="password" id="pw" autocomplete="current-password" value="s3cret!" />
        <button type="submit" id="go">Log in</button>
      </div>
    `);
    const container = document.getElementById("container") as HTMLElement;
    const onSuccess = vi.fn();
    attachSubmitWatcher(container, onSuccess);

    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    history.pushState({}, "", "/dashboard");

    await vi.advanceTimersByTimeAsync(500);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("bob@example.com", "s3cret!");
  });

  it("Test 3: container removed BUT [role=alert] present -> onSuccess never called", async () => {
    setBody(`
      <div id="container">
        <input type="text" name="email" id="user" autocomplete="username" value="carol@example.com" />
        <input type="password" name="password" id="pw" autocomplete="current-password" value="wrongpass" />
        <button type="submit" id="go">Log in</button>
      </div>
    `);
    const container = document.getElementById("container") as HTMLElement;
    const onSuccess = vi.fn();
    attachSubmitWatcher(container, onSuccess);

    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.textContent = "Invalid credentials";
    document.body.appendChild(alert);

    container.remove();
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(3000);

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("Test 4: neither signal within the window -> onSuccess never called, no leaked timer/observer", async () => {
    setBody(`
      <div id="container">
        <input type="text" name="email" id="user" autocomplete="username" value="dave@example.com" />
        <input type="password" name="password" id="pw" autocomplete="current-password" value="anotherpass" />
        <button type="submit" id="go">Log in</button>
      </div>
    `);
    const container = document.getElementById("container") as HTMLElement;
    const onSuccess = vi.fn();
    attachSubmitWatcher(container, onSuccess);

    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(3100);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("captureFrameOrigin", () => {
  it("returns location.origin and never reads window.top/window.parent", () => {
    const topSpy = vi.spyOn(window, "top", "get");
    const parentSpy = vi.spyOn(window, "parent", "get");

    const origin = captureFrameOrigin();

    expect(origin).toBe(location.origin);
    expect(topSpy).not.toHaveBeenCalled();
    expect(parentSpy).not.toHaveBeenCalled();

    topSpy.mockRestore();
    parentSpy.mockRestore();
  });
});
