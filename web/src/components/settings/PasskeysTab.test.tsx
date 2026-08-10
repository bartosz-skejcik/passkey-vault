import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockListPasskeys, mockRenamePasskey, mockDeletePasskey, mockUseIsUnlocked } = vi.hoisted(
  () => ({
    mockListPasskeys: vi.fn(),
    mockRenamePasskey: vi.fn(),
    mockDeletePasskey: vi.fn(),
    // Mutable, defaulting to true -- every existing test in this suite
    // exercises the already-unlocked case; T-29-13's regression test below
    // is the one that flips it false.
    mockUseIsUnlocked: vi.fn(() => true),
  }),
);

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

// T-29-13 (29-SECURITY.md): PasskeysTab now gates its fetch on
// useIsUnlocked(). importOriginal so every other real crypto export
// (EnrollPasskeyDialog/PasskeyDeleteConfirmDialog need them when opened
// below) stays untouched -- only useIsUnlocked itself is overridden.
vi.mock("@/lib/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto")>();
  return { ...actual, useIsUnlocked: mockUseIsUnlocked };
});

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
  mockUseIsUnlocked.mockReturnValue(true);
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

  // T-29-13 (29-SECURITY.md): regression test for the info-disclosure
  // finding -- prior to the fix, this tab fetched from a bare
  // `useEffect(..., [])` with no unlock guard, so a locked-but-authenticated
  // mount still issued GET /api/passkeys and painted the row into the DOM.
  it("does not fetch or render passkey rows while the vault is locked (T-29-13)", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockListPasskeys.mockResolvedValue([prfRow]);
    const { rerender } = render(<PasskeysTab />);

    // Give any (incorrectly firing) effect a turn of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockListPasskeys).not.toHaveBeenCalled();
    expect(screen.queryByText(prfRow.name)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`passkey-row-${prfRow.id}`)).not.toBeInTheDocument();

    // Unlocking must retroactively trigger the fetch -- the gate is a
    // deferral, not a permanent block.
    mockUseIsUnlocked.mockReturnValue(true);
    rerender(<PasskeysTab />);
    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));
    await screen.findByTestId(`passkey-row-${prfRow.id}`);
  });
});
