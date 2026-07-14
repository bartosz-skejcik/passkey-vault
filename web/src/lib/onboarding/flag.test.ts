import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ONBOARDING_COMPLETE_KEY, isOnboardingComplete, markOnboardingComplete } from "./flag";

describe("onboarding flag", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isOnboardingComplete() returns false when the key is unset", () => {
    expect(isOnboardingComplete()).toBe(false);
  });

  it("isOnboardingComplete() returns true after markOnboardingComplete() has been called", () => {
    markOnboardingComplete();
    expect(isOnboardingComplete()).toBe(true);
    expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBe("true");
  });

  it("isOnboardingComplete() fails safe to true when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(isOnboardingComplete()).toBe(true);
  });

  it("markOnboardingComplete() is a no-op (does not throw) when localStorage.setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => markOnboardingComplete()).not.toThrow();
  });
});
