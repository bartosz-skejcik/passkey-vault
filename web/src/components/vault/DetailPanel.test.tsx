import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockUseFolders,
  mockUseAllTags,
  mockCreateVaultItem,
  mockCreateVaultFolder,
  mockUpdateVaultItem,
  mockDeleteVaultItem,
  MockRevisionConflictError,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockCreateVaultItem: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  mockDeleteVaultItem: vi.fn(),
  // vi.mock factories are hoisted above the rest of the file — any value
  // they reference (like this error class) must be created inside
  // vi.hoisted() too, or it's a "Cannot access before initialization" ReferenceError.
  MockRevisionConflictError: class MockRevisionConflictError extends Error {},
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
  useAllTags: mockUseAllTags,
  createVaultItem: mockCreateVaultItem,
  createVaultFolder: mockCreateVaultFolder,
  updateVaultItem: mockUpdateVaultItem,
  deleteVaultItem: mockDeleteVaultItem,
  RevisionConflictError: MockRevisionConflictError,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import DetailPanel from "./DetailPanel";
import type { VaultItem } from "@/lib/vault/types";

const item: VaultItem = {
  id: "item-1",
  revision: 1,
  fields: {
    type: "note",
    name: "Wifi",
    body: "hunter2",
    folderId: null,
    tags: [],
  },
};

const loginItem: VaultItem = {
  id: "item-login",
  revision: 1,
  fields: {
    type: "login",
    name: "GitHub",
    username: "octocat",
    password: "hunter2",
    urls: ["https://github.com"],
    notes: "",
    folderId: null,
    tags: [],
  },
};

const cardItem: VaultItem = {
  id: "item-card",
  revision: 1,
  fields: {
    type: "card",
    name: "Visa",
    cardholderName: "Jane Doe",
    number: "4111111111111111",
    expiry: "12/28",
    cvv: "123",
    notes: "",
    folderId: null,
    tags: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockUseAllTags.mockReturnValue([]);
});

describe("DetailPanel", () => {
  it("switches to a pre-filled edit form when the Pencil button is clicked", () => {
    render(<DetailPanel item={item} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("detail-panel-edit"));

    expect(screen.getByTestId("item-name")).toHaveValue("Wifi");
    expect(screen.getByTestId("item-body")).toHaveValue("hunter2");
  });

  it("submitting the edit form calls updateVaultItem with the item's id and current revision", async () => {
    mockUpdateVaultItem.mockResolvedValue({ id: "item-1", revision: 2, fields: item.fields });
    render(<DetailPanel item={item} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("detail-panel-edit"));

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() =>
      expect(mockUpdateVaultItem).toHaveBeenCalledWith("item-1", expect.any(Object), 1),
    );
  });

  it("shows a revision-conflict banner and keeps the in-progress edit on RevisionConflictError", async () => {
    mockUpdateVaultItem.mockRejectedValue(new MockRevisionConflictError("conflict"));
    render(<DetailPanel item={item} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("detail-panel-edit"));

    fireEvent.change(screen.getByTestId("item-body"), {
      target: { value: "in-progress-edit" },
    });
    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("revision-conflict-banner")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("item-body")).toHaveValue("in-progress-edit");
  });

  it("opens the delete confirmation dialog when the Trash2 button is clicked", () => {
    render(<DetailPanel item={item} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("detail-panel-delete"));

    expect(screen.getByTestId("delete-confirm-dialog")).toBeInTheDocument();
  });

  it("masks a login item's password by default and reveals it after clicking the reveal toggle", () => {
    render(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-password"));

    expect(screen.getByText("hunter2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-password"));

    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
  });

  it("masks a card item's number by default and reveals it independently from other fields", () => {
    render(<DetailPanel item={cardItem} onClose={vi.fn()} />);

    expect(screen.queryByText("4111111111111111")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-number"));

    expect(screen.getByText("4111111111111111")).toBeInTheDocument();
  });

  it("always renders the cvv field masked with no reveal toggle", () => {
    render(<DetailPanel item={cardItem} onClose={vi.fn()} />);

    expect(screen.queryByText("123")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reveal-cvv")).not.toBeInTheDocument();
  });

  it("opens directly in the pre-filled edit form when initialMode='edit' is passed", () => {
    render(<DetailPanel item={item} initialMode="edit" onClose={vi.fn()} />);

    expect(screen.getByTestId("item-name")).toHaveValue("Wifi");
    expect(screen.getByTestId("item-body")).toHaveValue("hunter2");
  });

  it("re-enters edit mode when initialMode flips to 'edit' for the same item without remounting", () => {
    const { rerender } = render(
      <DetailPanel item={item} initialMode="view" onClose={vi.fn()} />,
    );
    expect(screen.queryByTestId("item-name")).not.toBeInTheDocument();

    rerender(<DetailPanel item={item} initialMode="edit" onClose={vi.fn()} />);

    expect(screen.getByTestId("item-name")).toHaveValue("Wifi");
  });

  it("resets a revealed field back to masked when the item prop changes", () => {
    const { rerender } = render(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("reveal-password"));
    expect(screen.getByText("hunter2")).toBeInTheDocument();

    rerender(<DetailPanel item={cardItem} onClose={vi.fn()} />);
    rerender(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
  });
});

describe("DetailPanel proactive live-edit-conflict banner (SYNC-03, Plan 05-04)", () => {
  it("shows the proactive live-edit-conflict banner when the live item's revision changes while editing, without discarding the currently-typed field values until Refresh is clicked", () => {
    const { rerender } = render(<DetailPanel item={item} initialMode="edit" onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId("item-body"), {
      target: { value: "in-progress-edit" },
    });

    const bumpedItem: typeof item = { ...item, revision: 2 };
    rerender(<DetailPanel item={bumpedItem} initialMode="edit" onClose={vi.fn()} />);

    expect(screen.getByTestId("live-edit-conflict-banner")).toBeInTheDocument();
    expect(screen.getByTestId("item-body")).toHaveValue("in-progress-edit");

    fireEvent.click(screen.getByTestId("live-edit-conflict-refresh"));

    expect(screen.queryByTestId("live-edit-conflict-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("item-body")).toHaveValue("hunter2");
  });

  it("does not show the proactive banner for an item that was never in edit mode", () => {
    const { rerender } = render(<DetailPanel item={item} initialMode="view" onClose={vi.fn()} />);

    const bumpedItem: typeof item = { ...item, revision: 2 };
    rerender(<DetailPanel item={bumpedItem} initialMode="view" onClose={vi.fn()} />);

    expect(screen.queryByTestId("live-edit-conflict-banner")).not.toBeInTheDocument();
  });

  // CR-01 regression (05-REVIEW.md): background sync must never make Save
  // silently overwrite a concurrent remote change. Before the fix, ItemForm
  // received the *live* item.revision as `currentRevision`, so once
  // background sync advanced item.revision in lockstep with the server, the
  // reactive 409 → RevisionConflictError path became unreachable and Save
  // would clobber the other device's edit without any conflict signal.
  it("sends the edit-session baseline revision (not the live, background-sync-advanced revision) as expected_revision on Save", async () => {
    mockUpdateVaultItem.mockResolvedValue({ id: "item-1", revision: 3, fields: item.fields });
    const { rerender } = render(<DetailPanel item={item} initialMode="edit" onClose={vi.fn()} />);

    // Background sync (WS/poll) merges a concurrent remote edit while this
    // edit session is open: item.revision advances 1 -> 2 under the hood.
    const bumpedItem: typeof item = { ...item, revision: 2 };
    rerender(<DetailPanel item={bumpedItem} initialMode="edit" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("item-form-submit"));

    // expected_revision must be the baseline (1) captured at edit-entry, not
    // the live/background-advanced revision (2) — otherwise the server's
    // `WHERE revision = ?` guard matches the now-current server revision and
    // the remote change is silently overwritten with no 409.
    await waitFor(() =>
      expect(mockUpdateVaultItem).toHaveBeenCalledWith("item-1", expect.any(Object), 1),
    );
  });
});
