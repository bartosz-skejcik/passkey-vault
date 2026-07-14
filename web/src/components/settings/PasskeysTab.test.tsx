import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockListPasskeys, mockRenamePasskey, mockDeletePasskey } = vi.hoisted(() => ({
  mockListPasskeys: vi.fn(),
  mockRenamePasskey: vi.fn(),
  mockDeletePasskey: vi.fn(),
}));

vi.mock("@/lib/passkeys/api", () => ({
  listPasskeys: mockListPasskeys,
  renamePasskey: mockRenamePasskey,
  deletePasskey: mockDeletePasskey,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import PasskeysTab from "./PasskeysTab";
import type { PasskeyRow } from "@/lib/passkeys/api";

const prfRow: PasskeyRow = {
  id: "pk-1",
  name: "YubiKey",
  prf_capable: true,
  created_at: "2026-07-14 09:00:00",
  last_used_at: "2026-07-14 09:30:00",
};

const noPrfRow: PasskeyRow = {
  id: "pk-2",
  name: "Old laptop",
  prf_capable: false,
  created_at: "2026-07-14 09:00:00",
  last_used_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PasskeysTab", () => {
  it("renders the empty-state copy when there are no passkeys", async () => {
    mockListPasskeys.mockResolvedValue([]);
    render(<PasskeysTab />);

    await waitFor(() => expect(screen.getByTestId("passkeys-empty-state")).toBeInTheDocument());
    expect(screen.getByText("passkeys.emptyState")).toBeInTheDocument();
  });

  it("shows the teal PRF badge text for a prf_capable row", async () => {
    mockListPasskeys.mockResolvedValue([prfRow]);
    render(<PasskeysTab />);

    await waitFor(() => expect(screen.getByTestId("passkey-row-pk-1")).toBeInTheDocument());
    expect(screen.getByText("passkeys.prfBadge")).toBeInTheDocument();
  });

  it("shows the muted no-PRF badge + explainer for a non-prf_capable row, with no alert/warning element", async () => {
    mockListPasskeys.mockResolvedValue([noPrfRow]);
    render(<PasskeysTab />);

    const row = await screen.findByTestId("passkey-row-pk-2");
    expect(screen.getByText("passkeys.noPrfBadge")).toBeInTheDocument();
    expect(screen.getByText("passkeys.noPrfExplainer")).toBeInTheDocument();
    expect(row.querySelector('[role="alert"]')).toBeNull();
    expect(row.querySelector("svg.lucide-alert-triangle")).toBeNull();
  });

  it("inline rename: clicking the trigger, changing the input, and pressing Enter calls renamePasskey", async () => {
    mockListPasskeys.mockResolvedValue([prfRow]);
    mockRenamePasskey.mockResolvedValue(undefined);
    render(<PasskeysTab />);

    await screen.findByTestId("passkey-row-pk-1");
    fireEvent.click(screen.getByTestId("passkey-rename-trigger-pk-1"));

    const input = screen.getByTestId("passkey-rename-input-pk-1");
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mockRenamePasskey).toHaveBeenCalledWith("pk-1", "New name"));
  });

  it("clicking delete opens PasskeyDeleteConfirmDialog", async () => {
    mockListPasskeys.mockResolvedValue([prfRow]);
    render(<PasskeysTab />);

    await screen.findByTestId("passkey-row-pk-1");
    fireEvent.click(screen.getByTestId("passkey-delete-trigger-pk-1"));

    expect(screen.getByTestId("passkey-delete-confirm-dialog")).toBeInTheDocument();
  });
});
