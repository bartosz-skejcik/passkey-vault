import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockUseFolders,
  mockUseAllTags,
  mockCreateVaultItem,
  mockCreateVaultFolder,
  mockUpdateVaultItem,
  mockDeleteVaultItem,
  mockTotpNow,
  MockRevisionConflictError,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockCreateVaultItem: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  mockDeleteVaultItem: vi.fn(),
  mockTotpNow: vi.fn(),
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

// DetailPanel now transitively renders TotpCountdownRing for totp items,
// which calls @/lib/crypto's totpNow — mocked per store.test.ts's
// established vi.mock("@/lib/crypto", ...) pattern.
vi.mock("@/lib/crypto", () => ({
  totpNow: mockTotpNow,
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

const passkeyItem: VaultItem = {
  id: "item-passkey",
  revision: 1,
  updatedAt: "2026-01-15 10:30:00",
  fields: {
    type: "passkey",
    name: "bartek",
    folderId: null,
    tags: [],
    rpId: "example.com",
    credentialId: "AQIDBAX6-_w",
    username: "bartek",
    userDisplayName: "Bartek Paczesny",
    rawPasskeyJson: JSON.stringify({ key_cbor: [1, 2, 3], rp_id: "example.com" }),
  },
};

const totpItem: VaultItem = {
  id: "item-totp",
  revision: 1,
  fields: {
    type: "totp",
    name: "GitHub",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    issuer: "GitHub Inc",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    notes: "",
    folderId: null,
    tags: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockUseAllTags.mockReturnValue([]);
  mockTotpNow.mockReturnValue({ code: "654321", secondsRemaining: 15 });
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

  // Scope-extension (Bartek live-review, Proton Pass-inspired card detail):
  // CVV now gets the same reveal+copy affordance as password/card
  // number/TOTP secret in VIEW mode — masked by default, but revealable
  // (unlike ItemForm's add/edit form, which still never echoes it back).
  it("masks the cvv field by default and reveals it independently via its own reveal toggle", () => {
    render(<DetailPanel item={cardItem} onClose={vi.fn()} />);

    expect(screen.queryByText("123")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reveal-cvv"));
    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.getByTestId("copy-cvv")).toBeInTheDocument();
  });

  it("renders card fields in Card Number, Expiration Date, CVV, Cardholder order", () => {
    render(<DetailPanel item={cardItem} onClose={vi.fn()} />);

    const labels = screen.getAllByText(/^field\./).map((el) => el.textContent);
    expect(labels).toEqual(["field.number", "field.expiry", "field.cvv", "field.cardholderName", "field.notes"]);
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

  it("renders the countdown ring and issuer subtitle, and masks the raw secret by default with a working reveal toggle", () => {
    render(<DetailPanel item={totpItem} onClose={vi.fn()} />);

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("654321")).toBeInTheDocument();
    expect(screen.getByText("GitHub Inc")).toBeInTheDocument();
    expect(screen.queryByText("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reveal-secret"));
    expect(screen.getByText("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).toBeInTheDocument();
  });

  it("resets a revealed field back to masked when the item prop changes", () => {
    const { rerender } = render(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("reveal-password"));
    expect(screen.getByText("hunter2")).toBeInTheDocument();

    rerender(<DetailPanel item={cardItem} onClose={vi.fn()} />);
    rerender(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    expect(screen.queryByText("hunter2")).not.toBeInTheDocument();
  });

  // Phase 12 cross-client fix (live bug): before this fix, a passkey item's
  // raw wire fields flowed unnormalized into `FIELD_ORDER[item.fields.type]`
  // (undefined for a missing key) and `TYPE_LABEL_KEY[item.fields.type]`,
  // throwing "Cannot read properties of undefined (reading 'en')".
  it("renders read-only passkey metadata (rpId/username/userDisplayName) without an edit button, and never surfaces rawPasskeyJson", () => {
    render(<DetailPanel item={passkeyItem} onClose={vi.fn()} />);

    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getAllByText("bartek").length).toBeGreaterThan(0);
    expect(screen.getByText("Bartek Paczesny")).toBeInTheDocument();
    expect(screen.queryByTestId("detail-panel-edit")).not.toBeInTheDocument();
    // Deletion stays available for a passkey item.
    expect(screen.getByTestId("detail-panel-delete")).toBeInTheDocument();
    expect(screen.queryByText(/key_cbor/)).not.toBeInTheDocument();
  });

  it("never mounts ItemForm for a passkey item even if initialMode='edit' is forced (defense-in-depth)", () => {
    render(<DetailPanel item={passkeyItem} initialMode="edit" onClose={vi.fn()} />);

    expect(screen.queryByTestId(/^item-form-/)).not.toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  // Bartek live-review, Proton Pass-inspired composed passkey layout: a
  // "Passkey" section (glyph + honestly-labeled "last updated" date — the
  // server never returns a created_at, so this must never say "Created"),
  // a muted explainer paragraph, then the non-technical field labels.
  describe("passkey composed detail layout (Bartek live-review)", () => {
    it("shows the honestly-labeled last-updated date (never a fabricated 'created' date)", () => {
      render(<DetailPanel item={passkeyItem} onClose={vi.fn()} />);

      expect(screen.getByText("detail.passkeySectionTitle")).toBeInTheDocument();
      const dateRow = screen.getByTestId("passkey-last-updated");
      expect(dateRow).toHaveTextContent("detail.passkeyLastUpdated");
      // 2026-01-15 -> some locale-formatted date string is present (not "—").
      expect(dateRow.textContent).not.toMatch(/—$/);
      expect(screen.getByText("detail.passkeyExplainer")).toBeInTheDocument();
    });

    it("shows an em-dash placeholder for last-updated when the item has no updatedAt", () => {
      const noDateItem: VaultItem = { ...passkeyItem, updatedAt: undefined };
      render(<DetailPanel item={noDateItem} onClose={vi.fn()} />);

      expect(screen.getByTestId("passkey-last-updated")).toHaveTextContent(
        "detail.passkeyLastUpdated: —",
      );
    });

    it("renders the non-technical Email/Username and Website Address labels with copy affordances", () => {
      render(<DetailPanel item={passkeyItem} onClose={vi.fn()} />);

      expect(screen.getByText("field.passkeyUsername")).toBeInTheDocument();
      expect(screen.getByText("field.passkeyWebsite")).toBeInTheDocument();
      expect(screen.getByTestId("copy-username")).toBeInTheDocument();
      expect(screen.getByTestId("copy-rpId")).toBeInTheDocument();
      expect(screen.getByText("field.userDisplayName")).toBeInTheDocument();
      expect(screen.getByTestId("copy-userDisplayName")).toBeInTheDocument();
    });

    it("omits the userDisplayName row entirely when the passkey has none", () => {
      const noDisplayName: VaultItem = {
        ...passkeyItem,
        fields: { ...passkeyItem.fields, userDisplayName: undefined } as typeof passkeyItem.fields,
      };
      render(<DetailPanel item={noDisplayName} onClose={vi.fn()} />);

      expect(screen.queryByText("field.userDisplayName")).not.toBeInTheDocument();
      expect(screen.queryByTestId("copy-userDisplayName")).not.toBeInTheDocument();
    });

    it("never renders Share/Attach/More affordances or an Edit button for a passkey item", () => {
      render(<DetailPanel item={passkeyItem} onClose={vi.fn()} />);

      expect(screen.queryByText(/share/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/attach/i)).not.toBeInTheDocument();
      expect(screen.queryByTestId("detail-panel-edit")).not.toBeInTheDocument();
    });
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
