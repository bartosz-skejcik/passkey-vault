import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockCreateVaultItem,
  mockCreateVaultFolder,
  mockUseFolders,
  mockUseAllTags,
  mockUpdateVaultItem,
  mockMoveVaultItem,
  mockGetItems,
  mockUseCollections,
  MockRevisionConflictError,
} = vi.hoisted(() => ({
  mockCreateVaultItem: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  // 32-02-PLAN.md Task 1: extends this file's existing mocked-store shape --
  // moveVaultItem/getItems (32-01's create-then-move dispatch + B-3 backstop
  // lookup) must be mockable per-test, alongside the existing
  // createVaultItem/updateVaultItem mocks.
  mockMoveVaultItem: vi.fn(),
  // No initial `() => []` factory here (unlike a naive first draft) --
  // that would lock vi.fn()'s inferred generic to `never[]`, and this
  // file's own tests below call mockReturnValue with genuinely different
  // shapes (getItems() rows, Collection objects with a real accessLevel).
  // The default `[]` is set explicitly in beforeEach below instead.
  mockGetItems: vi.fn(),
  // useCollections (the grouped destination select) -- ItemForm imports it
  // from a SEPARATE module ("@/lib/vault/collections"), mocked below.
  mockUseCollections: vi.fn(),
  // vi.mock factories are hoisted above the rest of the file -- any value
  // they reference must be created inside vi.hoisted() too. Mirrors
  // DetailPanel.test.tsx's identical MockRevisionConflictError shape:
  // ItemForm's create-mode dispatch instanceof-branches on this class, so
  // the mock must export something instanceof-compatible or that check
  // throws instead of routing to conflict copy.
  MockRevisionConflictError: class MockRevisionConflictError extends Error {
    lastEditorEmail?: string;
    constructor(lastEditorEmail?: string) {
      super("conflict");
      this.lastEditorEmail = lastEditorEmail;
    }
  },
}));

vi.mock("@/lib/vault/store", () => ({
  createVaultItem: mockCreateVaultItem,
  createVaultFolder: mockCreateVaultFolder,
  useFolders: mockUseFolders,
  useAllTags: mockUseAllTags,
  updateVaultItem: mockUpdateVaultItem,
  moveVaultItem: mockMoveVaultItem,
  getItems: mockGetItems,
  RevisionConflictError: MockRevisionConflictError,
}));

vi.mock("@/lib/vault/collections", () => ({
  useCollections: mockUseCollections,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ItemForm from "./ItemForm";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockUseAllTags.mockReturnValue([]);
  mockUseCollections.mockReturnValue([]);
  mockGetItems.mockReturnValue([]);
  mockCreateVaultItem.mockResolvedValue({ id: "new-id", revision: 1, fields: {} });
});

describe("ItemForm", () => {
  it("shows a validation error and does not call createVaultItem when name is empty on submit", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    fireEvent.click(screen.getByTestId("item-form-submit"));

    expect(await screen.findByText("validation.required")).toBeInTheDocument();
    expect(mockCreateVaultItem).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("submits a correctly-shaped login ItemFields object", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="login" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "GitHub" } });
    fireEvent.change(screen.getByTestId("item-username"), { target: { value: "bartek" } });
    fireEvent.change(screen.getByTestId("item-password"), { target: { value: "s3cret" } });
    fireEvent.change(screen.getByTestId("item-url-0"), {
      target: { value: "https://github.com" },
    });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    expect(mockCreateVaultItem).toHaveBeenCalledWith({
      type: "login",
      name: "GitHub",
      username: "bartek",
      password: "s3cret",
      urls: ["https://github.com"],
      notes: "",
      folderId: null,
      tags: [],
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("supports adding and removing multiple URL rows on a login item", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="login" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "GitHub" } });
    fireEvent.change(screen.getByTestId("item-url-0"), {
      target: { value: "https://github.com" },
    });
    fireEvent.click(screen.getByTestId("item-add-url"));
    fireEvent.change(screen.getByTestId("item-url-1"), {
      target: { value: "https://github.com/login" },
    });
    fireEvent.click(screen.getByTestId("item-add-url"));
    fireEvent.change(screen.getByTestId("item-url-2"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("item-remove-url-2"));

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    const submitted = mockCreateVaultItem.mock.calls[0][0];
    expect(submitted.urls).toEqual(["https://github.com", "https://github.com/login"]);
  });

  it("submits a correctly-shaped note ItemFields object", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "Wifi" } });
    fireEvent.change(screen.getByTestId("item-body"), { target: { value: "hunter2" } });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    expect(mockCreateVaultItem).toHaveBeenCalledWith({
      type: "note",
      name: "Wifi",
      body: "hunter2",
      folderId: null,
      tags: [],
    });
  });

  it("renders the folder select and tag input identically across all four types, and both survive into the submitted ItemFields", async () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    const onCreated = vi.fn();
    render(<ItemForm type="card" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "Visa" } });
    fireEvent.change(screen.getByTestId("item-folder-select"), {
      target: { value: "folder-1" },
    });
    fireEvent.change(screen.getByTestId("item-tags-input"), { target: { value: "finance" } });
    fireEvent.keyDown(screen.getByTestId("item-tags-input"), { key: "Enter" });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    const submitted = mockCreateVaultItem.mock.calls[0][0];
    expect(submitted.folderId).toBe("folder-1");
    expect(submitted.tags).toEqual(["finance"]);
  });

  it("creates a new folder via the '+' affordance and immediately selects it", async () => {
    mockCreateVaultFolder.mockResolvedValue({ id: "folder-new", name: "Osobiste" });
    render(<ItemForm type="note" onCreated={vi.fn()} />);

    fireEvent.click(screen.getByTestId("new-folder-button"));
    fireEvent.change(screen.getByTestId("new-folder-name"), {
      target: { value: "Osobiste" },
    });
    fireEvent.click(screen.getByTestId("new-folder-confirm"));

    await waitFor(() => expect(mockCreateVaultFolder).toHaveBeenCalledWith("Osobiste"));
    await waitFor(() =>
      expect(screen.getByTestId("item-folder-select")).toHaveValue("folder-new"),
    );
  });

  it("edit mode pre-fills fields from initialFields and calls updateVaultItem (not createVaultItem) on submit", async () => {
    mockUpdateVaultItem.mockResolvedValue({
      id: "item-1",
      revision: 2,
      fields: {},
    });
    const onCreated = vi.fn();
    render(
      <ItemForm
        type="note"
        mode="edit"
        itemId="item-1"
        currentRevision={1}
        initialFields={{
          type: "note",
          name: "Wifi",
          body: "hunter2",
          folderId: null,
          tags: [],
        }}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByTestId("item-name")).toHaveValue("Wifi");
    expect(screen.getByTestId("item-body")).toHaveValue("hunter2");

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockUpdateVaultItem).toHaveBeenCalledTimes(1));
    expect(mockUpdateVaultItem).toHaveBeenCalledWith(
      "item-1",
      {
        type: "note",
        name: "Wifi",
        body: "hunter2",
        folderId: null,
        tags: [],
      },
      1,
    );
    expect(mockCreateVaultItem).not.toHaveBeenCalled();
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("submits a correctly-shaped totp ItemFields object with RFC 6238 defaults", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="totp" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "GitHub" } });
    fireEvent.change(screen.getByTestId("item-secret"), {
      target: { value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
    });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    expect(mockCreateVaultItem).toHaveBeenCalledWith({
      type: "totp",
      name: "GitHub",
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      issuer: "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      notes: "",
      folderId: null,
      tags: [],
    });
  });

  it("the totp Advanced collapse starts closed even before any interaction", () => {
    render(<ItemForm type="totp" onCreated={vi.fn()} />);
    const details = screen.getByTestId("totp-advanced-toggle").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("blocks submission and shows an inline error for an invalid (non-base32) totp secret", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="totp" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "GitHub" } });
    fireEvent.change(screen.getByTestId("item-secret"), {
      target: { value: "not-valid-base32!!!" },
    });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    expect(await screen.findByTestId("totp-secret-error")).toBeInTheDocument();
    expect(mockCreateVaultItem).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("auto-parses an otpauth:// URI pasted into the secret field, populating issuer/algorithm/digits/period while the Advanced collapse stays closed", () => {
    render(<ItemForm type="totp" onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId("item-secret"), {
      target: {
        value:
          "otpauth://totp/GitHub:bartek?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub&algorithm=SHA256&digits=8&period=60",
      },
    });

    expect(screen.getByTestId("item-secret")).toHaveValue("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(screen.getByTestId("item-issuer")).toHaveValue("GitHub");
    expect(screen.getByTestId("item-algorithm")).toHaveValue("SHA256");
    expect(screen.getByTestId("item-digits")).toHaveValue(8);
    expect(screen.getByTestId("item-period")).toHaveValue(60);
    const details = screen.getByTestId("totp-advanced-toggle").closest("details");
    expect(details).not.toHaveAttribute("open");
  });

  it("edit mode calls onError (not throwing) when updateVaultItem rejects", async () => {
    const err = new Error("conflict");
    mockUpdateVaultItem.mockRejectedValue(err);
    const onCreated = vi.fn();
    const onError = vi.fn();
    render(
      <ItemForm
        type="note"
        mode="edit"
        itemId="item-1"
        currentRevision={1}
        initialFields={{
          type: "note",
          name: "Wifi",
          body: "hunter2",
          folderId: null,
          tags: [],
        }}
        onCreated={onCreated}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(err));
    expect(onCreated).not.toHaveBeenCalled();
  });
});

// Bartek live-review round 4 (TASK 4): card PIN/ZIP + CVV reveal toggle.
describe("ItemForm card fields (round 4)", () => {
  it("submits pin and zip as part of a card ItemFields object", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="card" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "Visa" } });
    fireEvent.change(screen.getByTestId("item-number"), {
      target: { value: "4111111111111111" },
    });
    fireEvent.change(screen.getByTestId("item-pin"), { target: { value: "1234" } });
    fireEvent.change(screen.getByTestId("item-zip"), { target: { value: "00-001" } });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    const submitted = mockCreateVaultItem.mock.calls[0][0];
    expect(submitted.pin).toBe("1234");
    expect(submitted.zip).toBe("00-001");
  });

  it("submits an old card item without pin/zip fine (additive-only schema)", async () => {
    mockUpdateVaultItem.mockResolvedValue({ id: "card-1", revision: 2, fields: {} });
    const onCreated = vi.fn();
    render(
      <ItemForm
        type="card"
        mode="edit"
        itemId="card-1"
        currentRevision={1}
        initialFields={{
          type: "card",
          name: "Visa",
          cardholderName: "Bartek",
          number: "4111111111111111",
          expiry: "12/30",
          cvv: "123",
          notes: "",
          folderId: null,
          tags: [],
        }}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByTestId("item-pin")).toHaveValue("");
    expect(screen.getByTestId("item-zip")).toHaveValue("");

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockUpdateVaultItem).toHaveBeenCalledTimes(1));
  });

  it("masks the CVV input by default and reveals it via its own toggle", () => {
    render(<ItemForm type="card" onCreated={vi.fn()} />);

    const cvvInput = screen.getByTestId("item-cvv");
    expect(cvvInput).toHaveAttribute("type", "password");

    const toggleButton = cvvInput.closest("div")?.querySelector("button");
    expect(toggleButton).not.toBeUndefined();
    fireEvent.click(toggleButton as HTMLButtonElement);

    expect(screen.getByTestId("item-cvv")).toHaveAttribute("type", "text");
  });

  it("masks the PIN input by default and reveals it via its own toggle", () => {
    render(<ItemForm type="card" onCreated={vi.fn()} />);

    const pinInput = screen.getByTestId("item-pin");
    expect(pinInput).toHaveAttribute("type", "password");

    const toggleButton = pinInput.closest("div")?.querySelector("button");
    fireEvent.click(toggleButton as HTMLButtonElement);

    expect(screen.getByTestId("item-pin")).toHaveAttribute("type", "text");
  });
});

// Bartek live-review round 4 (TASK 6): identity structured address —
// compose-on-save and legacy-prefill-on-edit.
describe("ItemForm identity address (round 4)", () => {
  it("submits an identity ItemFields object with structured address fields and a composed legacy address", async () => {
    const onCreated = vi.fn();
    render(<ItemForm type="identity" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "Bartek" } });
    fireEvent.change(screen.getByTestId("item-firstName"), { target: { value: "Bartek" } });
    fireEvent.change(screen.getByTestId("item-lastName"), { target: { value: "Paczesny" } });
    fireEvent.change(screen.getByTestId("item-addressLine1"), {
      target: { value: "ul. Prosta 1" },
    });
    fireEvent.change(screen.getByTestId("item-city"), { target: { value: "Warszawa" } });
    fireEvent.change(screen.getByTestId("item-zip"), { target: { value: "00-001" } });
    fireEvent.change(screen.getByTestId("item-country"), { target: { value: "Polska" } });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockCreateVaultItem).toHaveBeenCalledTimes(1));
    const submitted = mockCreateVaultItem.mock.calls[0][0];
    expect(submitted.addressLine1).toBe("ul. Prosta 1");
    expect(submitted.city).toBe("Warszawa");
    // Legacy flat `address` is composed from the structured parts so the
    // extension's single-input autofill still fills sanely.
    expect(submitted.address).toBe("ul. Prosta 1, Warszawa, 00-001, Polska");
  });

  it("prefills Address Line 1 from an old item's legacy flat address when it has no structured fields yet", () => {
    render(
      <ItemForm
        type="identity"
        mode="edit"
        itemId="identity-1"
        currentRevision={1}
        initialFields={{
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
        }}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByTestId("item-addressLine1")).toHaveValue("ul. Stara 5, Kraków");
    expect(screen.getByTestId("item-addressLine2")).toHaveValue("");
  });

  it("round-trips an untouched legacy address byte-for-byte on save (prefill + compose-on-save)", async () => {
    mockUpdateVaultItem.mockResolvedValue({ id: "identity-1", revision: 2, fields: {} });
    const onCreated = vi.fn();
    render(
      <ItemForm
        type="identity"
        mode="edit"
        itemId="identity-1"
        currentRevision={1}
        initialFields={{
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
        }}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockUpdateVaultItem).toHaveBeenCalledTimes(1));
    const submitted = mockUpdateVaultItem.mock.calls[0][1];
    expect(submitted.address).toBe("ul. Stara 5, Kraków");
  });

  it("does NOT prefill Address Line 1 when structured fields are already present", () => {
    render(
      <ItemForm
        type="identity"
        mode="edit"
        itemId="identity-1"
        currentRevision={1}
        initialFields={{
          type: "identity",
          name: "Bartek",
          firstName: "Bartek",
          lastName: "Paczesny",
          email: "",
          phone: "",
          address: "ul. Nowa 2",
          addressLine1: "ul. Nowa 2",
          city: "Gdańsk",
          notes: "",
          folderId: null,
          tags: [],
        }}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByTestId("item-addressLine1")).toHaveValue("ul. Nowa 2");
    expect(screen.getByTestId("item-city")).toHaveValue("Gdańsk");
  });
});

// 32-02-PLAN.md Task 1: dedicated unit-test coverage for the destination
// optgroup 32-01 shipped (mocked useCollections()/moveVaultItem/getItems --
// a legitimate control-flow/rendering-structure claim, NOT a crypto claim;
// SC2's real-key claim is already proven with real WASM by
// moveVaultItem.real-wasm.test.ts and live by sharing.spec.ts's own
// two-session test, neither re-derived here).
describe("ItemForm destination optgroup (32-02)", () => {
  it("renders no 'Udostępnione foldery' optgroup at all when there are zero shared collections (32-PLAN-CHECK.md W-3 -- absent, never empty)", () => {
    mockUseCollections.mockReturnValue([]);
    render(<ItemForm type="note" onCreated={vi.fn()} />);

    const select = screen.getByTestId("item-folder-select");
    expect(select.querySelectorAll("optgroup")).toHaveLength(1);
    expect(select.querySelector('optgroup[label="item.sharedFoldersGroup"]')).toBeNull();
  });

  it("renders a writable shared collection as a plain enabled option and non-edit ones as DISABLED (DOM property, not a class) with the read-only reason visible in the text", () => {
    mockUseCollections.mockReturnValue([
      { id: "col-edit", name: "Edit Folder", accessLevel: "edit", familyWideKind: null },
      { id: "col-read", name: "Read Folder", accessLevel: "read", familyWideKind: null },
      { id: "col-hidden", name: "Hidden Folder", accessLevel: "hidden_password", familyWideKind: null },
    ]);
    render(<ItemForm type="note" onCreated={vi.fn()} />);

    const select = screen.getByTestId("item-folder-select");
    expect(select.querySelector('optgroup[label="item.sharedFoldersGroup"]')).not.toBeNull();

    const editOption = select.querySelector(
      'option[value="collection:col-edit"]',
    ) as HTMLOptionElement;
    expect(editOption).not.toBeNull();
    expect(editOption.disabled).toBe(false);
    expect(editOption.textContent).toBe("Edit Folder");

    const readOption = select.querySelector(
      'option[value="collection:col-read"]',
    ) as HTMLOptionElement;
    expect(readOption).not.toBeNull();
    expect(readOption.disabled).toBe(true);
    expect(readOption.textContent).toContain("item.folderReadOnlyOption");
    expect(readOption.textContent).toContain("Read Folder");

    const hiddenOption = select.querySelector(
      'option[value="collection:col-hidden"]',
    ) as HTMLOptionElement;
    expect(hiddenOption).not.toBeNull();
    expect(hiddenOption.disabled).toBe(true);
    expect(hiddenOption.textContent).toContain("item.folderReadOnlyOption");
    expect(hiddenOption.textContent).toContain("Hidden Folder");
  });

  it("never renders an item_bucket collection as any destination option, writable or disabled", () => {
    mockUseCollections.mockReturnValue([
      { id: "bucket-1", name: "Family Bucket", accessLevel: "edit", familyWideKind: "item_bucket" },
      { id: "col-edit", name: "Edit Folder", accessLevel: "edit", familyWideKind: null },
    ]);
    render(<ItemForm type="note" onCreated={vi.fn()} />);

    const select = screen.getByTestId("item-folder-select");
    expect(select.querySelector('option[value="collection:bucket-1"]')).toBeNull();
    expect(select.querySelector('option[value="collection:col-edit"]')).not.toBeNull();
  });

  it("B-2: an item currently in a family-wide item_bucket renders a DISABLED select naming its real scope (never the enabled 'Bez folderu' fallback), and a save from that state never mis-files it under a personal folder", async () => {
    mockUseCollections.mockReturnValue([
      { id: "bucket-1", name: "Family Bucket", accessLevel: "edit", familyWideKind: "item_bucket" },
    ]);
    mockUpdateVaultItem.mockResolvedValue({ id: "item-1", revision: 2, fields: {} });
    const onCreated = vi.fn();
    render(
      <ItemForm
        type="note"
        mode="edit"
        itemId="item-1"
        currentRevision={1}
        currentCollectionId="bucket-1"
        initialFields={{
          type: "note",
          name: "Wifi",
          body: "hunter2",
          folderId: null,
          tags: [],
        }}
        onCreated={onCreated}
      />,
    );

    const select = screen.getByTestId("item-folder-select") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe("item.folderLockedByFamilyShare");
    expect(select.options[0].textContent).not.toContain("item.noFolder");

    // Firing a change event is a no-op on a genuinely disabled control --
    // assert no destination-state side effect regardless of what the DOM
    // does with it.
    fireEvent.change(select, { target: { value: "some-personal-folder" } });

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockUpdateVaultItem).toHaveBeenCalledTimes(1));
    expect(mockMoveVaultItem).not.toHaveBeenCalled();
    const [, submittedFields] = mockUpdateVaultItem.mock.calls[0];
    expect(submittedFields.folderId).toBeNull();
  });

  it("selecting a shared-folder option then submitting calls createVaultItem, then (only once createVaultItem's own promise has resolved) moveVaultItem with that collection id -- never reversed, never simultaneous via Promise.all", async () => {
    mockUseCollections.mockReturnValue([
      { id: "col-edit", name: "Edit Folder", accessLevel: "edit", familyWideKind: null },
    ]);
    let resolveCreate!: (v: { id: string; revision: number; fields: unknown }) => void;
    mockCreateVaultItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    mockMoveVaultItem.mockResolvedValue({ id: "new-id", revision: 2, fields: {} });
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId("item-name"), { target: { value: "Wifi" } });
    fireEvent.change(screen.getByTestId("item-folder-select"), {
      target: { value: "collection:col-edit" },
    });
    fireEvent.click(screen.getByTestId("item-form-submit"));

    // createVaultItem is pending (never resolved yet) -- moveVaultItem must
    // not have been invoked at all, proving the dispatch awaits create's own
    // result rather than firing both concurrently.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(1);
    expect(mockMoveVaultItem).not.toHaveBeenCalled();

    resolveCreate({ id: "new-id", revision: 1, fields: {} });

    await waitFor(() => expect(mockMoveVaultItem).toHaveBeenCalledTimes(1));
    expect(mockMoveVaultItem).toHaveBeenCalledWith("new-id", expect.any(Object), 1, "col-edit");
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });
});

// 32-02-PLAN.md Task 1: create-then-move retry safety, including B-3's
// lost-response recovery and the C-2 revision conjunct (32-PLAN-CHECK.md
// iteration 2) -- a destination-only recovery check is UNSOUND on a retry
// (it recovers a PRIOR attempt's commit and reports success over content
// that attempt never wrote); every test below that reaches the recovery
// branch is built so a destination-only implementation would get it wrong.
describe("ItemForm create-then-move retry safety and lost-response recovery (32-02)", () => {
  function selectSharedDestinationAndFillName(name = "Wifi") {
    fireEvent.change(screen.getByTestId("item-name"), { target: { value: name } });
    fireEvent.change(screen.getByTestId("item-folder-select"), {
      target: { value: "collection:dest-1" },
    });
  }

  beforeEach(() => {
    mockUseCollections.mockReturnValue([
      { id: "dest-1", name: "Dest", accessLevel: "edit", familyWideKind: null },
    ]);
  });

  it("a genuine move failure that never lands (item still not at the destination) never calls onCreated, shows the honest error, and never double-creates", async () => {
    mockCreateVaultItem.mockResolvedValue({ id: "new-id", revision: 1, fields: {} });
    mockMoveVaultItem.mockRejectedValue(new Error("network fail"));
    // getItems()'s recovery lookup shows the item still not at the
    // destination -- a genuine, unrecovered failure.
    mockGetItems.mockReturnValue([{ id: "new-id", revision: 1, collectionId: null }]);
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    selectSharedDestinationAndFillName();
    fireEvent.click(screen.getByTestId("item-form-submit"));

    expect(await screen.findByTestId("item-form-submit-error")).toHaveTextContent(
      "error.itemCreatedButMoveFailed",
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(1);
    expect(mockMoveVaultItem).toHaveBeenCalledTimes(1);
  });

  it("B-3: a lost move response whose item is ALREADY at the destination at THIS attempt's own revision (created.revision + 1) is recognized as recovered success, with no redundant second move call", async () => {
    mockCreateVaultItem.mockResolvedValue({ id: "new-id", revision: 1, fields: {} });
    mockMoveVaultItem.mockRejectedValue(new Error("aborted"));
    // The server actually committed the move (revision bumped to
    // created.revision + 1 = 2, collection_id already the destination) but
    // the client observed a failed/dropped request.
    mockGetItems.mockReturnValue([{ id: "new-id", revision: 2, collectionId: "dest-1" }]);
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    selectSharedDestinationAndFillName();
    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(1);
    expect(mockMoveVaultItem).toHaveBeenCalledTimes(1);
  });

  it("C-2: an item AT the destination but at an EARLIER attempt's revision (not this attempt's own commit) must NOT be recognized as recovered -- a destination-only check would wrongly report success here and silently eat this attempt's own content", async () => {
    mockCreateVaultItem.mockResolvedValue({ id: "new-id", revision: 1, fields: {} });
    mockMoveVaultItem.mockRejectedValue(new Error("some failure"));
    // collection_id already equals the destination (left there by an
    // EARLIER attempt/save), but the revision (5) is NOT created.revision +
    // 1 (2) -- this is NOT this attempt's own commit. A destination-only
    // recovery check sees collection_id === destination and would wrongly
    // call onCreated here, reporting success over content this save never
    // actually wrote.
    mockGetItems.mockReturnValue([{ id: "new-id", revision: 5, collectionId: "dest-1" }]);
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    selectSharedDestinationAndFillName();
    fireEvent.click(screen.getByTestId("item-form-submit"));

    expect(await screen.findByTestId("item-form-submit-error")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(mockMoveVaultItem).toHaveBeenCalledTimes(1);
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(1);
  });

  it("a genuine retry (item still not at the destination after the first failure) resends the SECOND moveVaultItem call with the refreshed revision, never the original stale one, and never double-creates", async () => {
    mockCreateVaultItem.mockResolvedValue({ id: "new-id", revision: 1, fields: {} });
    mockMoveVaultItem
      .mockRejectedValueOnce(new Error("first attempt lost"))
      .mockResolvedValueOnce({ id: "new-id", revision: 6, fields: {} });
    // First getItems() call (the first failure's recovery check): the item
    // is NOT at the destination, but an unrelated concurrent write bumped
    // its revision to 5 (newer than created.revision = 1) -- the refreshed
    // revision the retry must send.
    mockGetItems.mockReturnValue([{ id: "new-id", revision: 5, collectionId: null }]);
    const onCreated = vi.fn();
    render(<ItemForm type="note" onCreated={onCreated} />);

    selectSharedDestinationAndFillName();
    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockMoveVaultItem).toHaveBeenCalledTimes(1));
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("item-form-submit"));

    await waitFor(() => expect(mockMoveVaultItem).toHaveBeenCalledTimes(2));
    expect(mockMoveVaultItem).toHaveBeenNthCalledWith(2, "new-id", expect.any(Object), 5, "dest-1");
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });
});
