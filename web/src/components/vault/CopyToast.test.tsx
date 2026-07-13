import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import CopyToast from "./CopyToast";
import { showCopyToast, dismissCopyToast } from "@/lib/vault/copyToast";

beforeEach(() => {
  vi.useFakeTimers();
  dismissCopyToast();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CopyToast", () => {
  it("renders nothing when no copy toast is active", () => {
    render(<CopyToast />);
    expect(screen.queryByTestId("copy-toast")).not.toBeInTheDocument();
  });

  it("shows the toast with a live per-second countdown after showCopyToast()", () => {
    render(<CopyToast />);

    act(() => {
      showCopyToast("Hasło", 3000);
    });

    expect(screen.getByTestId("copy-toast")).toBeInTheDocument();
    expect(screen.getByText(/toast.copied/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Countdown ticked — still showing the "copied" message, not yet cleared.
    expect(screen.getByText(/toast.copied/)).toBeInTheDocument();
  });

  it("flips to the cleared message at 0, then unmounts after ~1.5s", () => {
    render(<CopyToast />);
    act(() => {
      showCopyToast("Hasło", 2000);
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("toast.cleared")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId("copy-toast")).not.toBeInTheDocument();
  });

  it("dismissing the toast early hides it immediately", () => {
    render(<CopyToast />);
    act(() => {
      showCopyToast("Hasło", 40_000);
    });
    expect(screen.getByTestId("copy-toast")).toBeInTheDocument();

    act(() => {
      dismissCopyToast();
    });

    expect(screen.queryByTestId("copy-toast")).not.toBeInTheDocument();
  });

  it("a new copy replaces the currently-showing toast's field/timer state", () => {
    render(<CopyToast />);
    act(() => {
      showCopyToast("Hasło", 40_000);
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    act(() => {
      showCopyToast("Użytkownik", 40_000);
    });

    // Only one toast instance is ever rendered.
    expect(screen.getAllByTestId("copy-toast")).toHaveLength(1);
  });
});
