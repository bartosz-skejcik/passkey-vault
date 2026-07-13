import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockDeleteVaultItem } = vi.hoisted(() => ({ mockDeleteVaultItem: vi.fn() }));

vi.mock("@/lib/vault/store", () => ({
  deleteVaultItem: mockDeleteVaultItem,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import DeleteConfirmDialog from "./DeleteConfirmDialog";
import type { VaultItem } from "@/lib/vault/types";

const item: VaultItem = {
  id: "item-1",
  revision: 1,
  fields: { type: "note", name: "Wifi", body: "hunter2", folderId: null, tags: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeleteConfirmDialog", () => {
  it("calls deleteVaultItem with the item's id and onDeleted on confirm", async () => {
    mockDeleteVaultItem.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(<DeleteConfirmDialog item={item} onClose={onClose} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByTestId("delete-confirm-confirm"));

    await waitFor(() => expect(mockDeleteVaultItem).toHaveBeenCalledWith("item-1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("closes without deleting when Cancel is clicked", () => {
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    render(<DeleteConfirmDialog item={item} onClose={onClose} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByTestId("delete-confirm-cancel"));

    expect(mockDeleteVaultItem).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("interpolates the item name into the delete title", () => {
    render(<DeleteConfirmDialog item={item} onClose={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.getByText(/Wifi/)).toBeInTheDocument();
  });
});
