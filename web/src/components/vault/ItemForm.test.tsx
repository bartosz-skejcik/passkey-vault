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
