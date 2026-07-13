import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyWithAutoClear } from "./clipboard";

const mockWriteText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  mockWriteText.mockReset();
  Object.assign(navigator, {
    clipboard: { writeText: mockWriteText },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("copyWithAutoClear", () => {
  it("writes the value to the clipboard immediately", () => {
    copyWithAutoClear("s3cret", 40_000);
    expect(mockWriteText).toHaveBeenCalledWith("s3cret");
  });

  it("clears the clipboard after durationMs elapses", () => {
    copyWithAutoClear("s3cret", 40_000);
    mockWriteText.mockClear();

    vi.advanceTimersByTime(40_000);

    expect(mockWriteText).toHaveBeenCalledWith("");
  });

  it("does not clear before durationMs elapses", () => {
    copyWithAutoClear("s3cret", 40_000);
    mockWriteText.mockClear();

    vi.advanceTimersByTime(39_000);

    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("a second call before the first duration elapses cancels the first pending clear and starts a fresh one", () => {
    copyWithAutoClear("first", 40_000);
    vi.advanceTimersByTime(30_000);

    copyWithAutoClear("second", 40_000);
    mockWriteText.mockClear();

    // The first copy's timer (10s remaining if it had survived) must NOT
    // fire — only the second copy's fresh 40s timer is live.
    vi.advanceTimersByTime(10_000);
    expect(mockWriteText).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(mockWriteText).toHaveBeenCalledWith("");
    expect(mockWriteText).toHaveBeenCalledTimes(1);
  });
});
