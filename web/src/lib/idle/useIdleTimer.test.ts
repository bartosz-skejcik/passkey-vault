import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIdleTimer } from "./useIdleTimer";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useIdleTimer", () => {
  it("calls onIdle once after timeoutMs of no simulated DOM activity", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer(1000, onIdle));

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);

    // Doesn't fire again on its own — a fresh activity event is required
    // to re-arm the timer.
    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("resets the timer on a simulated activity event without calling onIdle early", () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimer(1000, onIdle));

    vi.advanceTimersByTime(700);
    window.dispatchEvent(new Event("mousemove"));
    vi.advanceTimersByTime(700);

    // 1400ms of elapsed time have passed since mount, but only 700ms since
    // the reset — onIdle must not have fired yet.
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("cleans up its listeners and pending timeout on unmount", () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useIdleTimer(1000, onIdle));

    unmount();
    vi.advanceTimersByTime(5000);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
