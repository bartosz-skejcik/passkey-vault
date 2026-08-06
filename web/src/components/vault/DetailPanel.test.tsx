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
  mockTouchVaultItem,
  mockUseCollections,
  mockGetCollectionAccessList,
  mockListItemShares,
  MockRevisionConflictError,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockCreateVaultItem: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  mockDeleteVaultItem: vi.fn(),
  mockTotpNow: vi.fn(),
  mockTouchVaultItem: vi.fn(),
  mockUseCollections: vi.fn(),
  mockGetCollectionAccessList: vi.fn(),
  mockListItemShares: vi.fn(),
  // vi.mock factories are hoisted above the rest of the file — any value
  // they reference (like this error class) must be created inside
  // vi.hoisted() too, or it's a "Cannot access before initialization" ReferenceError.
  // Mirrors the real RevisionConflictError's shape (Plan 23-05): an
  // optional lastEditorEmail constructor arg stored as a public field.
  MockRevisionConflictError: class MockRevisionConflictError extends Error {
    lastEditorEmail?: string;
    constructor(lastEditorEmail?: string) {
      super("conflict");
      this.lastEditorEmail = lastEditorEmail;
    }
  },
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
  useAllTags: mockUseAllTags,
  createVaultItem: mockCreateVaultItem,
  createVaultFolder: mockCreateVaultFolder,
  updateVaultItem: mockUpdateVaultItem,
  deleteVaultItem: mockDeleteVaultItem,
  touchVaultItem: mockTouchVaultItem,
  RevisionConflictError: MockRevisionConflictError,
}));

vi.mock("@/lib/vault/collections", () => ({
  useCollections: mockUseCollections,
}));

// D-3/E5 (Plan 26-09, Task 2): AvatarStack is rendered for real (NOT
// mocked) in the header's metadata area — only its underlying
// "@/lib/vault/api" fetch is mocked, per AvatarStack.test.tsx/
// shareRecipients.test.ts's established convention.
vi.mock("@/lib/vault/api", () => ({
  getCollectionAccessList: mockGetCollectionAccessList,
  listItemShares: mockListItemShares,
}));

// ShareDialog is a heavy, fully-covered-elsewhere component (Plan 26-08's
// own ShareDialog.test.tsx/.real-wasm.test.ts) — mocked here so this file
// tests ONLY the entry-point wiring, not ShareDialog's own internal
// behavior (mirrors ItemContextMenu.test.tsx's identical mocking rationale).
vi.mock("./ShareDialog", () => ({
  default: (props: { scope: unknown; onClose: () => void; onShared: () => void }) => (
    <div data-testid="mock-share-dialog">
      <span data-testid="mock-share-dialog-scope">{JSON.stringify(props.scope)}</span>
      <button type="button" data-testid="mock-share-dialog-close" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
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
  mockUseCollections.mockReturnValue([]);
  mockTotpNow.mockReturnValue({ code: "654321", secondsRemaining: 15 });
  // jsdom has no real Clipboard API — copyWithAutoClear (lib/clipboard.ts)
  // calls navigator.clipboard.writeText unconditionally, which is
  // `undefined` here without this stub. Needed for the copy-button touch
  // tests below, which are the first tests in this file to actually click
  // a copy button (prior tests only exercised reveal toggles).
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn() },
    configurable: true,
  });
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
    // No lastEditorEmail (personal-item conflict) — the banner shows the
    // exact existing generic copy, zero wording change.
    mockUpdateVaultItem.mockRejectedValue(new MockRevisionConflictError());
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
    expect(screen.getByTestId("revision-conflict-banner")).toHaveTextContent(
      "error.revisionConflict",
    );
  });

  // Plan 23-05 (SYNC-06 client half): the reactive 409 conflict banner
  // attributes to the current last editor's email when RevisionConflictError
  // carries one (a shared item's conflict) — never for a personal item's.
  it("shows the attributed revision-conflict banner copy when RevisionConflictError carries a lastEditorEmail", async () => {
    mockUpdateVaultItem.mockRejectedValue(
      new MockRevisionConflictError("anna@example.com"),
    );
    render(<DetailPanel item={item} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("detail-panel-edit"));

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("revision-conflict-banner")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("revision-conflict-banner")).toHaveTextContent("anna@example.com");
  });

  // WR-02 (code review iteration 2): before this fix, ItemForm's edit-mode
  // catch routed EVERY error (not just RevisionConflictError) to onError,
  // and this component's onError only ever branched on RevisionConflictError
  // — any other error (a plain network failure, or CR-03's
  // UndecryptableItemError) was silently swallowed: the spinner stopped,
  // nothing saved, nothing said. This asserts the exhaustive fallback.
  it("shows a generic save-error banner (never swallows) when updateVaultItem rejects with a non-conflict error", async () => {
    mockUpdateVaultItem.mockRejectedValue(new Error("network error"));
    render(<DetailPanel item={item} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("detail-panel-edit"));

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("item-save-error-banner")).toBeInTheDocument(),
    );
    // Never the conflict banner — this is a DIFFERENT error class.
    expect(screen.queryByTestId("revision-conflict-banner")).not.toBeInTheDocument();
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

  // NordPass-style last-used tracking (quick-260717): revealing fires a
  // touch, re-hiding does not (never re-touch on a "hide" click) — single
  // choke-point through touchVaultItem, fire-and-forget.
  it("touches the item when a masked field is revealed, but not when it is re-hidden", () => {
    render(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("reveal-password"));
    expect(mockTouchVaultItem).toHaveBeenCalledTimes(1);
    expect(mockTouchVaultItem).toHaveBeenCalledWith(loginItem.id);

    fireEvent.click(screen.getByTestId("reveal-password"));
    expect(mockTouchVaultItem).toHaveBeenCalledTimes(1);
  });

  // Copy is the other touch-point — every copy affordance in this panel
  // routes through the same handleCopy choke-point.
  it("touches the item when a field's copy button is clicked", () => {
    render(<DetailPanel item={loginItem} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("copy-username"));

    expect(mockTouchVaultItem).toHaveBeenCalledTimes(1);
    expect(mockTouchVaultItem).toHaveBeenCalledWith(loginItem.id);
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

  // Bartek live-review round 4 (TASK 4): card PIN/ZIP detail rows —
  // omitted entirely when empty, shown (PIN masked+revealable, ZIP plain)
  // when present.
  describe("card pin/zip detail rows (round 4)", () => {
    it("omits the PIN and ZIP rows entirely for a card item without them", () => {
      render(<DetailPanel item={cardItem} onClose={vi.fn()} />);
      expect(screen.queryByText("field.pin")).not.toBeInTheDocument();
      expect(screen.queryByText("field.zip")).not.toBeInTheDocument();
    });

    it("shows a masked, revealable PIN row and a plain ZIP row when present", () => {
      const cardWithPinZip: VaultItem = {
        id: "item-card-pin-zip",
        revision: 1,
        fields: {
          type: "card",
          name: "Visa",
          cardholderName: "Jane Doe",
          number: "4111111111111111",
          expiry: "12/28",
          cvv: "123",
          pin: "1234",
          zip: "00-001",
          notes: "",
          folderId: null,
          tags: [],
        },
      };
      render(<DetailPanel item={cardWithPinZip} onClose={vi.fn()} />);
      expect(screen.getByText("field.pin")).toBeInTheDocument();
      expect(screen.queryByText("1234")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("reveal-pin"));
      expect(screen.getByText("1234")).toBeInTheDocument();

      expect(screen.getByText("field.zip")).toBeInTheDocument();
      expect(screen.getByText("00-001")).toBeInTheDocument();
    });
  });

  // Bartek live-review round 4 (TASK 5): identity composed detail layout —
  // a single "Full Name" row (not separate firstName/lastName rows), Email,
  // Phone, then a stacked-line Address block.
  describe("identity composed detail layout (round 4)", () => {
    const identityItem: VaultItem = {
      id: "item-identity",
      revision: 1,
      fields: {
        type: "identity",
        name: "Bartek",
        firstName: "Bartek",
        lastName: "Paczesny",
        email: "bartek@example.com",
        phone: "+48 000 000 000",
        address: "",
        addressLine1: "ul. Prosta 1",
        addressLine2: "m. 4",
        city: "Warszawa",
        state: "",
        zip: "00-001",
        country: "Polska",
        notes: "",
        folderId: null,
        tags: [],
      },
    };

    it("shows a single combined Full Name row instead of separate First/Last name rows", () => {
      render(<DetailPanel item={identityItem} onClose={vi.fn()} />);
      expect(screen.getByText("field.fullName")).toBeInTheDocument();
      expect(screen.getByText("Bartek Paczesny")).toBeInTheDocument();
      expect(screen.queryByText("field.firstName")).not.toBeInTheDocument();
      expect(screen.queryByText("field.lastName")).not.toBeInTheDocument();
    });

    it("shows Email and Phone rows with copy affordances", () => {
      render(<DetailPanel item={identityItem} onClose={vi.fn()} />);
      expect(screen.getByText("bartek@example.com")).toBeInTheDocument();
      expect(screen.getByTestId("copy-email")).toBeInTheDocument();
      expect(screen.getByText("+48 000 000 000")).toBeInTheDocument();
      expect(screen.getByTestId("copy-phone")).toBeInTheDocument();
    });

    it("renders the structured address as stacked lines, omitting the empty state field", () => {
      render(<DetailPanel item={identityItem} onClose={vi.fn()} />);
      expect(screen.getByText("ul. Prosta 1")).toBeInTheDocument();
      expect(screen.getByText("m. 4")).toBeInTheDocument();
      expect(screen.getByText("Warszawa")).toBeInTheDocument();
      expect(screen.getByText("00-001")).toBeInTheDocument();
      expect(screen.getByText("Polska")).toBeInTheDocument();
    });

    it("falls back to the legacy flat address string as-is when no structured fields are present", () => {
      const legacyOnlyItem: VaultItem = {
        id: "item-identity-legacy",
        revision: 1,
        fields: {
          type: "identity",
          name: "Bartek",
          firstName: "Bartek",
          lastName: "Paczesny",
          email: "",
          phone: "",
          address: "ul. Stara 5, Kraków",
          notes: "",
          folderId: null,
          tags: [],
        },
      };
      render(<DetailPanel item={legacyOnlyItem} onClose={vi.fn()} />);
      expect(screen.getByText("ul. Stara 5, Kraków")).toBeInTheDocument();
    });

    it("keeps the Edit button available for identity items (unlike passkey)", () => {
      render(<DetailPanel item={identityItem} onClose={vi.fn()} />);
      expect(screen.getByTestId("detail-panel-edit")).toBeInTheDocument();
    });
  });
});

// Plan 23-05 (SYNC-06 client half): the proactive live-edit-conflict banner
// attributes to the currently-viewed item's OWN isShared/lastEditorEmail
// fields (populated by the personal sync/list endpoints an item's own owner
// already receives) — never a separate shared-item fetch.
describe("DetailPanel proactive live-edit-conflict banner attribution (Plan 23-05, SYNC-06)", () => {
  it("shows the attributed copy (containing the editor's email) when the live item is shared and carries a lastEditorEmail", () => {
    const sharedItem: typeof item = { ...item, isShared: true, lastEditorEmail: "anna@example.com" };
    const { rerender } = render(
      <DetailPanel item={sharedItem} initialMode="edit" onClose={vi.fn()} />,
    );

    const bumpedItem: typeof sharedItem = { ...sharedItem, revision: 2 };
    rerender(<DetailPanel item={bumpedItem} initialMode="edit" onClose={vi.fn()} />);

    expect(screen.getByTestId("live-edit-conflict-banner")).toHaveTextContent(
      "anna@example.com",
    );
  });

  it("shows the exact existing generic copy, unchanged, when the live item is not shared (isShared: false)", () => {
    const personalItem: typeof item = { ...item, isShared: false, lastEditorEmail: undefined };
    const { rerender } = render(
      <DetailPanel item={personalItem} initialMode="edit" onClose={vi.fn()} />,
    );

    const bumpedItem: typeof personalItem = { ...personalItem, revision: 2 };
    rerender(<DetailPanel item={bumpedItem} initialMode="edit" onClose={vi.fn()} />);

    const banner = screen.getByTestId("live-edit-conflict-banner");
    expect(banner).toHaveTextContent("sync.itemChangedElsewhere");
    expect(banner).not.toHaveTextContent("anna@example.com");
  });
});

// E1 (26-UI-SPEC.md): SHARE-02's item-level entry point, mirrored from
// ItemContextMenu.test.tsx's equivalent coverage for this same wiring.
describe("DetailPanel Share entry point (E1, 26-09-PLAN.md)", () => {
  it("renders a Share2 icon button before Edit, opening ShareDialog with scope: {kind: 'item', item}", () => {
    render(<DetailPanel item={item} onClose={vi.fn()} />);

    const shareButton = screen.getByTestId("detail-panel-share");
    const editButton = screen.getByTestId("detail-panel-edit");
    expect(shareButton).toBeInTheDocument();
    // Positioned BEFORE Edit in the header's icon-button row.
    expect(
      shareButton.compareDocumentPosition(editButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.queryByTestId("mock-share-dialog")).not.toBeInTheDocument();
    fireEvent.click(shareButton);
    expect(screen.getByTestId("mock-share-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mock-share-dialog-scope")).toHaveTextContent(
      JSON.stringify({ kind: "item", item }),
    );
  });

  it("shows the Share button for a passkey item exactly like a login item — no suppression (distinct from Edit's passkey suppression)", () => {
    render(<DetailPanel item={passkeyItem} onClose={vi.fn()} />);
    expect(screen.getByTestId("detail-panel-share")).toBeInTheDocument();
    // Edit stays hidden for a passkey item — Share does not.
    expect(screen.queryByTestId("detail-panel-edit")).not.toBeInTheDocument();
  });

  it("hides the Share button for an item flagged undecryptable (mirrors Edit's guard)", () => {
    render(<DetailPanel item={{ ...item, undecryptable: true }} onClose={vi.fn()} />);
    expect(screen.queryByTestId("detail-panel-share")).not.toBeInTheDocument();
    expect(screen.queryByTestId("item-shared-on-collection-note")).not.toBeInTheDocument();
  });

  it("shows share.itemSharedOnCollectionNote instead of a Share button for a collection-scoped item", () => {
    mockUseCollections.mockReturnValue([{ id: "col-1", name: "Rodzina" }]);
    render(<DetailPanel item={{ ...item, collectionId: "col-1" }} onClose={vi.fn()} />);
    expect(screen.queryByTestId("detail-panel-share")).not.toBeInTheDocument();
    expect(screen.getByTestId("item-shared-on-collection-note")).toHaveTextContent(
      "share.itemSharedOnCollectionNote",
    );
  });
});

// D-3/E5 (26-UI-SPEC.md, Plan 26-09 Task 2): AvatarStack wiring at
// DetailPanel's real call site — reuses AvatarStack.tsx/useShareRecipients
// (Plan 26-06), never a re-implementation. Rendered for real here (not
// mocked); only its underlying "@/lib/vault/api" fetch is mocked.
describe("DetailPanel AvatarStack wiring (D-3/E5, Plan 26-09)", () => {
  it("renders AvatarStack in the header for a shared item's open detail panel", async () => {
    mockGetCollectionAccessList.mockResolvedValue([
      { user_id: "u1", email: "anna@example.com", access_level: "read", created_at: "t", suspended: false },
    ]);
    const sharedItem: VaultItem = { ...item, isShared: true, collectionId: "col-1" };
    render(<DetailPanel item={sharedItem} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("avatar-stack")).toBeInTheDocument());
  });

  it("renders no AvatarStack for a non-shared item's detail panel", () => {
    render(<DetailPanel item={item} onClose={vi.fn()} />);
    expect(screen.queryByTestId("avatar-stack")).not.toBeInTheDocument();
    expect(screen.queryByTestId("avatar-stack-icon")).not.toBeInTheDocument();
    expect(mockGetCollectionAccessList).not.toHaveBeenCalled();
    expect(mockListItemShares).not.toHaveBeenCalled();
  });
});
