// entrypoints/popup/autofill/OnThisPageSection.test.tsx — proves the
// gesture gate (D-03: popup-open is gesture one, a Wypełnij click is
// gesture two -- nothing fills on render/open) and D-12's card/identity
// second-confirm at the COMPONENT level, not just described in prose
// (10-06-PLAN.md Task 3). Mocks only `sendMessage` -- the component tree
// under test (OnThisPageSection -> useAutofillMatches -> AutofillItemRow/
// TotpFillRow/SensitiveFillConfirm) is otherwise real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AutofillMatch } from "../../../lib/autofill/types";
import type { AutofillMatchResult } from "../../../lib/messaging/ext-protocol";

const { mockSendMessage } = vi.hoisted(() => ({ mockSendMessage: vi.fn() }));

vi.mock("../../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

import OnThisPageSection from "./OnThisPageSection";

function loginMatch(itemId: string, label: string): AutofillMatch {
  return { itemId, kind: "login", label, maskedHint: "user" };
}

function cardMatch(itemId: string, label: string): AutofillMatch {
  return { itemId, kind: "card", label, maskedHint: "••••1234" };
}

function matchResult(overrides: Partial<AutofillMatchResult> = {}): AutofillMatchResult {
  return {
    pageState: "ok",
    origin: "https://example.com",
    detected: { login: false, totp: false, card: false, identity: false },
    matches: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OnThisPageSection", () => {
  it("Test 1: shows a skeleton while autofill.match is pending, then the row list on resolve", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "autofill.match") {
        return matchResult({ matches: [loginMatch("1", "GitHub")] });
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<OnThisPageSection locale="en" />);

    // Synchronous initial render, before the pending autofill.match promise
    // resolves -- the hook's own initial state is "loading".
    expect(screen.getByTestId("autofill-skeleton")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    expect(screen.queryByTestId("autofill-skeleton")).not.toBeInTheDocument();
  });

  it("Test 2: nothing calls autofill.fill on render/open -- only after a Wypełnij click (the gesture gate)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "autofill.match") {
        return matchResult({ matches: [loginMatch("1", "GitHub")] });
      }
      if (message.kind === "autofill.fill") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<OnThisPageSection locale="en" />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "autofill.match" }));
    expect(mockSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "autofill.fill" }));

    fireEvent.click(screen.getByTestId("autofill-fill-1"));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "autofill.fill", itemId: "1", kind_: "login" }),
      );
    });
  });

  it("Test 3: a card row click opens SensitiveFillConfirm and does NOT call autofill.fill until the inline confirm is clicked (D-12)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "autofill.match") {
        return matchResult({ matches: [cardMatch("2", "Visa")] });
      }
      if (message.kind === "autofill.fill") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<OnThisPageSection locale="en" />);
    await waitFor(() => expect(screen.getByText("Visa")).toBeInTheDocument());

    expect(screen.queryByTestId("sensitive-fill-confirm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("autofill-fill-2"));

    expect(screen.getByTestId("sensitive-fill-confirm")).toBeInTheDocument();
    expect(mockSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "autofill.fill" }));

    fireEvent.click(screen.getByTestId("sensitive-fill-confirm-submit"));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "autofill.fill", itemId: "2", kind_: "card" }),
      );
    });
  });

  it("Test 4: multiple matching logins render as multiple rows (the picker), with no separate dialog element", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "autofill.match") {
        return matchResult({ matches: [loginMatch("1", "GitHub"), loginMatch("2", "GitLab")] });
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<OnThisPageSection locale="en" />);

    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    expect(screen.getByText("GitLab")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Test 5: a restricted pageState renders the plain banner, never the empty-state emoji", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "autofill.match") {
        return matchResult({ pageState: "restricted", origin: null, matches: [] });
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<OnThisPageSection locale="pl" />);

    await waitFor(() => expect(screen.getByTestId("autofill-error-banner")).toBeInTheDocument());
    expect(screen.queryByTestId("autofill-empty-state")).not.toBeInTheDocument();
    expect(screen.queryByText("🤷", { exact: false })).not.toBeInTheDocument();
  });
});
