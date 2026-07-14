import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockDeletePasskey } = vi.hoisted(() => ({ mockDeletePasskey: vi.fn() }));

vi.mock("@/lib/passkeys/api", () => ({
  deletePasskey: mockDeletePasskey,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import PasskeyDeleteConfirmDialog from "./PasskeyDeleteConfirmDialog";
import { ApiClientError } from "@/lib/auth/api";
import type { PasskeyRow } from "@/lib/passkeys/api";

const passkey: PasskeyRow = {
  id: "pk-1",
  name: "YubiKey",
  prf_capable: true,
  created_at: "2026-07-14 09:00:00",
  last_used_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PasskeyDeleteConfirmDialog", () => {
  it("calls deletePasskey and onDeleted on the normal-path confirm", async () => {
    mockDeletePasskey.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<PasskeyDeleteConfirmDialog passkey={passkey} onClose={vi.fn()} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByTestId("passkey-delete-confirm"));

    await waitFor(() => expect(mockDeletePasskey).toHaveBeenCalledWith("pk-1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("a 409 rejection renders the blocked-delete alert instead of closing (AUTH-05's UI-visible guarantee)", async () => {
    mockDeletePasskey.mockRejectedValue(new ApiClientError(409, "would strand vault"));
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(<PasskeyDeleteConfirmDialog passkey={passkey} onClose={onClose} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByTestId("passkey-delete-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("passkey-delete-blocked-alert")).toBeInTheDocument(),
    );
    expect(screen.getByText("passkeys.deleteBlockedError")).toBeInTheDocument();
    // Still mounted/visible — did NOT silently close.
    expect(screen.getByTestId("passkey-delete-confirm-dialog")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a non-409 rejection shows a generic error and leaves Confirm/Cancel available for retry", async () => {
    mockDeletePasskey.mockRejectedValue(new ApiClientError(500, "internal error"));
    render(<PasskeyDeleteConfirmDialog passkey={passkey} onClose={vi.fn()} onDeleted={vi.fn()} />);

    fireEvent.click(screen.getByTestId("passkey-delete-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("passkey-delete-generic-error")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("passkey-delete-blocked-alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("passkey-delete-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("passkey-delete-cancel")).toBeInTheDocument();
  });
});
