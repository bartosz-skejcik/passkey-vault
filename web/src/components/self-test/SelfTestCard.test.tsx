// UIR (2026-07-12 todo, "ui-review-phase1-fixes", finding 2): the fatal
// branch's "Uruchom ponownie" retry button (carried-forward Phase 1
// UI-REVIEW fix, landed in commit 076fef8) had no unit test anywhere in the
// repo -- this file existed as a component with zero coverage. Re-verifying
// the finding against current code (SelfTestCard.tsx's fatal branch already
// renders the button, wired to the same `run` the mount effect uses) showed
// the FIX itself is not missing, only the regression proof that it stays
// wired: without this test, a future refactor could silently drop the
// button (or its onClick) and nothing would fail red.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { mockRunSelfTest } = vi.hoisted(() => ({
  mockRunSelfTest: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  runSelfTest: mockRunSelfTest,
}));

// Same `t: (key) => key` shape LoginForm.test.tsx/RegisterForm.test.tsx
// already use for this exact context -- assertions below match against the
// dictionary KEY, not a rendered translation, so this file never needs to
// track dictionary.ts's copy.
vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import SelfTestCard from "./SelfTestCard";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SelfTestCard fatal branch retry", () => {
  it("renders a retry button when initCrypto/runSelfTest fails fatally", async () => {
    mockRunSelfTest.mockRejectedValueOnce(new Error("boom"));

    render(<SelfTestCard />);

    expect(await screen.findByText("self-test.fatalHeading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "self-test.retry" })).toBeInTheDocument();
  });

  it("clicking the fatal-branch retry button re-invokes the self-test and can recover into the results view", async () => {
    mockRunSelfTest.mockRejectedValueOnce(new Error("boom"));

    render(<SelfTestCard />);
    await screen.findByText("self-test.fatalHeading");
    expect(mockRunSelfTest).toHaveBeenCalledTimes(1);

    mockRunSelfTest.mockResolvedValueOnce([{ name: "step-1", ok: true }]);
    fireEvent.click(screen.getByRole("button", { name: "self-test.retry" }));

    await waitFor(() => expect(mockRunSelfTest).toHaveBeenCalledTimes(2));
    // The fatal heading is gone -- the retry actually transitioned state,
    // not merely re-called the function into another fatal result.
    await waitFor(() =>
      expect(screen.queryByText("self-test.fatalHeading")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("step-1")).toBeInTheDocument();
  });
});
