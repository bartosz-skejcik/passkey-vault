import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockTotpNow } = vi.hoisted(() => ({
  mockTotpNow: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  totpNow: mockTotpNow,
}));

import TotpCountdownRing from "./TotpCountdownRing";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
  mockTotpNow.mockReturnValue({ code: "123456", secondsRemaining: 30 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TotpCountdownRing", () => {
  it("renders a coral radial-progress ring plus a mono code string, sourced from totpNow", async () => {
    render(
      <TotpCountdownRing
        secretB32={SECRET}
        algorithm="SHA1"
        digits={6}
        period={30}
        size={24}
      />,
    );

    expect(mockTotpNow).toHaveBeenCalled();
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveClass("text-primary");
  });

  it("calls totpNow on mount with the four TOTP params and the current time", async () => {
    render(
      <TotpCountdownRing
        secretB32={SECRET}
        algorithm="SHA1"
        digits={6}
        period={30}
        size={24}
      />,
    );

    expect(mockTotpNow).toHaveBeenCalledWith(
      SECRET,
      "SHA1",
      6,
      30,
      Math.floor(Date.now() / 1000),
    );
  });

  it("re-renders the code as time advances via a ~1s interval, changing when the period boundary is crossed", async () => {
    mockTotpNow.mockReturnValueOnce({ code: "111111", secondsRemaining: 1 });
    render(
      <TotpCountdownRing
        secretB32={SECRET}
        algorithm="SHA1"
        digits={6}
        period={30}
        size={24}
      />,
    );
    expect(screen.getByText("111111")).toBeInTheDocument();

    mockTotpNow.mockReturnValue({ code: "222222", secondsRemaining: 30 });
    await vi.advanceTimersByTimeAsync(30000);

    expect(screen.getByText("222222")).toBeInTheDocument();
  });

  it("clears its interval on unmount — no further totpNow calls after unmount", async () => {
    const { unmount } = render(
      <TotpCountdownRing
        secretB32={SECRET}
        algorithm="SHA1"
        digits={6}
        period={30}
        size={24}
      />,
    );
    expect(mockTotpNow).toHaveBeenCalled();
    const callCountBeforeUnmount = mockTotpNow.mock.calls.length;

    unmount();
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockTotpNow.mock.calls.length).toBe(callCountBeforeUnmount);
  });

  it("renders a non-crashing error state when totpNow throws for an invalid secret", () => {
    mockTotpNow.mockImplementation(() => {
      throw new Error("invalid base32 TOTP secret");
    });

    render(
      <TotpCountdownRing
        secretB32="not-valid-base32!!!"
        algorithm="SHA1"
        digits={6}
        period={30}
        size={24}
      />,
    );

    expect(screen.getByTestId("totp-ring-error")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});
