import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockListSessions, mockRevokeSession } = vi.hoisted(() => ({
  mockListSessions: vi.fn(),
  mockRevokeSession: vi.fn(),
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
});
