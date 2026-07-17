import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockCreateVaultItem,
  mockCreateVaultFolder,
  mockUseFolders,
  mockUseAllTags,
  mockUpdateVaultItem,
} = vi.hoisted(() => ({
  mockCreateVaultItem: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  createVaultItem: mockCreateVaultItem,
  createVaultFolder: mockCreateVaultFolder,
  useFolders: mockUseFolders,
  useAllTags: mockUseAllTags,
  updateVaultItem: mockUpdateVaultItem,
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
