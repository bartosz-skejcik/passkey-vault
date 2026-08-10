import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockListSessions, mockRevokeSession, mockUseIsUnlocked } = vi.hoisted(() => ({
  mockListSessions: vi.fn(),
  mockRevokeSession: vi.fn(),
  // Mutable, defaulting to true -- every existing test in this suite
  // exercises the already-unlocked case; T-29-13's regression test below is
  // the one that flips it false.
  mockUseIsUnlocked: vi.fn(() => true),
}));

vi.mock("@/lib/sessions/api", () => ({
  listSessions: mockListSessions,
  revokeSession: mockRevokeSession,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// T-29-13 (29-SECURITY.md): SessionsTab now gates its fetch on
// useIsUnlocked(). importOriginal so every other real crypto export stays
// untouched -- only useIsUnlocked itself is overridden.
vi.mock("@/lib/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto")>();
  return { ...actual, useIsUnlocked: mockUseIsUnlocked };
});

import SessionsTab from "./SessionsTab";
import type { SessionRow } from "@/lib/sessions/api";

const currentRow: SessionRow = {
  id: "sess-current",
  user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  created_at: "2026-07-14 08:00:00",
  last_used_at: "2026-07-14 09:00:00",
  current: true,
};

const otherRow: SessionRow = {
  id: "sess-other",
  user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)",
  created_at: "2026-07-13 08:00:00",
  last_used_at: "2026-07-13 09:00:00",
  current: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseIsUnlocked.mockReturnValue(true);
});

describe("SessionsTab", () => {
  it("shows the current-device badge and no revoke button on the current row", async () => {
    mockListSessions.mockResolvedValue([currentRow]);
    render(<SessionsTab />);

    const row = await screen.findByTestId("session-row-sess-current");
    expect(screen.getByText("sessions.currentDevice")).toBeInTheDocument();
    expect(row.querySelector('[data-testid="session-revoke-trigger-sess-current"]')).toBeNull();
  });

  it("a non-current row's revoke button opens a confirm dialog, and confirming calls revokeSession + removes the row", async () => {
    mockListSessions.mockResolvedValue([currentRow, otherRow]);
    mockRevokeSession.mockResolvedValue(undefined);
    render(<SessionsTab />);

    await screen.findByTestId("session-row-sess-other");
    fireEvent.click(screen.getByTestId("session-revoke-trigger-sess-other"));

    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(mockRevokeSession).toHaveBeenCalledWith("sess-other"));
    await waitFor(() =>
      expect(screen.queryByTestId("session-row-sess-other")).not.toBeInTheDocument(),
    );
  });

  it("'Wyloguj pozostałe' opens a confirm modal (not an inline block), and confirming revokes every non-current row", async () => {
    mockListSessions.mockResolvedValue([currentRow, otherRow]);
    mockRevokeSession.mockResolvedValue(undefined);
    render(<SessionsTab />);

    await screen.findByTestId("session-row-sess-other");
    fireEvent.click(screen.getByTestId("sessions-revoke-others-trigger"));

    const dialog = screen.getByTestId("confirm-dialog");
    expect(dialog).toBeInTheDocument();
    expect(document.querySelector('[data-testid="side-panel-scrim"]')).toBeNull();

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(mockRevokeSession).toHaveBeenCalledTimes(1));
    expect(mockRevokeSession).toHaveBeenCalledWith("sess-other");
  });

  // T-29-13 (29-SECURITY.md): regression test for the info-disclosure
  // finding -- prior to the fix, this tab fetched from a bare
  // `useEffect(..., [])` with no unlock guard, so a locked-but-authenticated
  // mount still issued GET /api/sessions and painted device/IP rows into
  // the DOM.
  it("does not fetch or render session rows while the vault is locked (T-29-13)", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockListSessions.mockResolvedValue([currentRow, otherRow]);
    const { rerender } = render(<SessionsTab />);

    // Give any (incorrectly firing) effect a turn of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockListSessions).not.toHaveBeenCalled();
    expect(screen.queryByText(otherRow.user_agent as string)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`session-row-${otherRow.id}`)).not.toBeInTheDocument();

    // Unlocking must retroactively trigger the fetch -- the gate is a
    // deferral, not a permanent block.
    mockUseIsUnlocked.mockReturnValue(true);
    rerender(<SessionsTab />);
    await waitFor(() => expect(mockListSessions).toHaveBeenCalledTimes(1));
    await screen.findByTestId(`session-row-${otherRow.id}`);
  });
});
