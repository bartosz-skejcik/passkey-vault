import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  mockUseFolders,
  mockCreateVaultFolder,
  mockCreateVaultItem,
  mockPapaParse,
  mockDetectFormat,
  mockBitwardenJsonMapItem,
  mockBitwardenCsvDetect,
  mockBitwardenCsvMapRow,
  mockNordpassCsvDetect,
  mockNordpassCsvMapRow,
  mockOnePasswordCsvDetect,
  mockOnePasswordCsvMapRow,
  mockLastpassCsvDetect,
  mockLastpassCsvMapRow,
  mockKeepassCsvDetect,
  mockKeepassCsvMapRow,
  mockMapRowGeneric,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockCreateVaultItem: vi.fn(),
  mockPapaParse: vi.fn(),
  mockDetectFormat: vi.fn(),
  mockBitwardenJsonMapItem: vi.fn(),
  mockBitwardenCsvDetect: vi.fn(),
  mockBitwardenCsvMapRow: vi.fn(),
  mockNordpassCsvDetect: vi.fn(),
  mockNordpassCsvMapRow: vi.fn(),
  mockOnePasswordCsvDetect: vi.fn(),
  mockOnePasswordCsvMapRow: vi.fn(),
  mockLastpassCsvDetect: vi.fn(),
  mockLastpassCsvMapRow: vi.fn(),
  mockKeepassCsvDetect: vi.fn(),
  mockKeepassCsvMapRow: vi.fn(),
  mockMapRowGeneric: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
  createVaultFolder: mockCreateVaultFolder,
  createVaultItem: mockCreateVaultItem,
}));

vi.mock("papaparse", () => ({
  default: { parse: mockPapaParse },
}));

vi.mock("@/lib/vault/importers/detect", () => ({
  detectFormat: mockDetectFormat,
}));

vi.mock("@/lib/vault/importers/bitwardenJson", () => ({
  mapItem: mockBitwardenJsonMapItem,
}));

vi.mock("@/lib/vault/importers/bitwardenCsv", () => ({
  detect: mockBitwardenCsvDetect,
  mapRow: mockBitwardenCsvMapRow,
}));

vi.mock("@/lib/vault/importers/nordpassCsv", () => ({
  detect: mockNordpassCsvDetect,
  mapRow: mockNordpassCsvMapRow,
}));

vi.mock("@/lib/vault/importers/onePasswordCsv", () => ({
  detect: mockOnePasswordCsvDetect,
  mapRow: mockOnePasswordCsvMapRow,
}));

vi.mock("@/lib/vault/importers/lastpassCsv", () => ({
  detect: mockLastpassCsvDetect,
  mapRow: mockLastpassCsvMapRow,
}));

vi.mock("@/lib/vault/importers/keepassCsv", () => ({
  detect: mockKeepassCsvDetect,
  mapRow: mockKeepassCsvMapRow,
}));

vi.mock("@/lib/vault/importers/genericMapping", () => ({
  GENERIC_TARGET_FIELDS: ["name", "username", "password", "urls", "notes", "secret", "folder", "tags"],
  mapRowGeneric: mockMapRowGeneric,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ImportWizard from "./ImportWizard";

function makeFile(name: string, content: string, sizeOverride?: number): File {
  const file = new File([content], name);
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", { value: sizeOverride });
  }
  return file;
}

function loginDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "login" as const,
    name: "Item",
    username: "user",
    password: "pw",
    urls: [],
    notes: "",
    folder: "",
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockCreateVaultFolder.mockImplementation((name: string) =>
    Promise.resolve({ id: `folder-${name}`, name }),
  );
  mockCreateVaultItem.mockResolvedValue({ id: "x", revision: 1, fields: {} });
});

describe("ImportWizard", () => {
  it("renders the file-select screen with a visible skip button; clicking it calls onDone when no onSkip is supplied", () => {
    const onDone = vi.fn();
    render(<ImportWizard onDone={onDone} />);

    expect(screen.getByTestId("import-wizard-skip")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("import-wizard-skip"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onSkip, not onDone, when both are supplied and Skip is clicked", () => {
    const onDone = vi.fn();
    const onSkip = vi.fn();
    render(<ImportWizard onDone={onDone} onSkip={onSkip} />);

    fireEvent.click(screen.getByTestId("import-wizard-skip"));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("auto-advances to preview with the correct item count when the CSV header set is recognized", async () => {
    mockPapaParse.mockReturnValue({
      data: [
        { type: "login", name: "GitHub", login_username: "me", login_password: "pw" },
        { type: "login", name: "GitLab", login_username: "me2", login_password: "pw2" },
      ],
      errors: [],
      meta: { fields: ["type", "name", "login_username", "login_password"] },
    });
    mockDetectFormat.mockReturnValue("bitwarden-csv");
    mockBitwardenCsvMapRow.mockImplementation((row: Record<string, string>) => ({
      items: [loginDraft({ name: row.name, username: row.login_username })],
    }));

    render(<ImportWizard onDone={vi.fn()} />);
    const file = makeFile("export.csv", "type,name,login_username,login_password\n...");
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.queryByTestId("import-wizard-start")).toBeInTheDocument());
    expect(screen.queryByTestId("import-wizard-mapping-confirm")).not.toBeInTheDocument();
    expect(mockBitwardenCsvMapRow).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("import-wizard-start")).toHaveTextContent("2");
  });

  it("shows the manual mapping screen for an unrecognized format, then advances to preview via mapRowGeneric after confirm", async () => {
    mockPapaParse.mockReturnValue({
      data: [{ full_name: "Alice", user: "alice", pass: "secret" }],
      errors: [],
      meta: { fields: ["full_name", "user", "pass"] },
    });
    mockDetectFormat.mockReturnValue("unknown");
    mockMapRowGeneric.mockReturnValue({ items: [loginDraft({ name: "Alice", username: "alice" })] });

    render(<ImportWizard onDone={vi.fn()} />);
    const file = makeFile("weird.csv", "full_name,user,pass\nAlice,alice,secret");
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByTestId("import-wizard-mapping-confirm")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("import-wizard-mapping-name"), {
      target: { value: "full_name" },
    });
    fireEvent.click(screen.getByTestId("import-wizard-mapping-confirm"));

    await waitFor(() => expect(screen.getByTestId("import-wizard-start")).toBeInTheDocument());
    expect(mockMapRowGeneric).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("import-wizard-start")).toHaveTextContent("1");
  });

  it("writes all well-formed drafts and lands on the all-ok summary, resolving folderId (not the raw folder string)", async () => {
    mockPapaParse.mockReturnValue({
      data: [{ n: "A" }, { n: "B" }, { n: "C" }],
      errors: [],
      meta: { fields: ["n"] },
    });
    mockDetectFormat.mockReturnValue("bitwarden-csv");
    mockBitwardenCsvMapRow.mockImplementation((row: Record<string, string>) => ({
      items: [loginDraft({ name: row.n, folder: "Work" })],
    }));

    render(<ImportWizard onDone={vi.fn()} />);
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [makeFile("x.csv", "n\nA\nB\nC")] },
    });
    await waitFor(() => expect(screen.getByTestId("import-wizard-start")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("import-wizard-start"));

    await waitFor(() => expect(screen.getByTestId("import-wizard-summary")).toBeInTheDocument());
    expect(screen.getByTestId("import-wizard-summary-all-ok")).toBeInTheDocument();
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(3);
    for (const call of mockCreateVaultItem.mock.calls) {
      const fields = call[0] as { folderId: string | null; folder?: unknown };
      expect(fields.folderId).toBe("folder-Work");
      expect(fields.folder).toBeUndefined();
    }
    // Folder-cache: all 3 items share the "Work" folder name -> created once.
    expect(mockCreateVaultFolder).toHaveBeenCalledTimes(1);
    expect(mockCreateVaultFolder).toHaveBeenCalledWith("Work");
  });

  it("reports a partial summary when one of three writes fails, with the skip reason visible in the expandable toggle", async () => {
    mockPapaParse.mockReturnValue({
      data: [{ n: "A" }, { n: "B" }, { n: "C" }],
      errors: [],
      meta: { fields: ["n"] },
    });
    mockDetectFormat.mockReturnValue("bitwarden-csv");
    mockBitwardenCsvMapRow.mockImplementation((row: Record<string, string>) => ({
      items: [loginDraft({ name: row.n })],
    }));
    mockCreateVaultItem
      .mockResolvedValueOnce({ id: "1", revision: 1, fields: {} })
      .mockResolvedValueOnce({ id: "2", revision: 1, fields: {} })
      .mockRejectedValueOnce(new Error("boom"));

    render(<ImportWizard onDone={vi.fn()} />);
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [makeFile("x.csv", "n\nA\nB\nC")] },
    });
    await waitFor(() => expect(screen.getByTestId("import-wizard-start")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("import-wizard-start"));

    await waitFor(() => expect(screen.getByTestId("import-wizard-summary")).toBeInTheDocument());
    const partial = screen.getByTestId("import-wizard-summary-partial");
    expect(partial).toHaveTextContent("2");
    expect(partial).toHaveTextContent("3");
    expect(partial).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("import-wizard-skipped-toggle"));
    expect(screen.getByText(/import.reasonUnparseableRow/)).toBeInTheDocument();
  });

  it("counts an upstream row-mapping skip in the summary total without ever calling createVaultItem for that row", async () => {
    mockPapaParse.mockReturnValue({
      data: [{ n: "A" }, { n: "" }],
      errors: [],
      meta: { fields: ["n"] },
    });
    mockDetectFormat.mockReturnValue("bitwarden-csv");
    mockBitwardenCsvMapRow.mockImplementation((row: Record<string, string>) =>
      row.n ? { items: [loginDraft({ name: row.n })] } : { items: [], skipped: "missingField" as const },
    );

    render(<ImportWizard onDone={vi.fn()} />);
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [makeFile("x.csv", "n\nA\n")] },
    });
    await waitFor(() => expect(screen.getByTestId("import-wizard-start")).toBeInTheDocument());
    // Only 1 valid draft reached preview -- the "Importuj {n}" count reflects it.
    expect(screen.getByTestId("import-wizard-start")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("import-wizard-start"));

    await waitFor(() => expect(screen.getByTestId("import-wizard-summary")).toBeInTheDocument());
    expect(mockCreateVaultItem).toHaveBeenCalledTimes(1);
    const partial = screen.getByTestId("import-wizard-summary-partial");
    expect(partial).toHaveTextContent("1");
  });

  it("keeps the wizard inert (no onDone/onCancel) while the write loop is running, and dismissible again once the summary renders", async () => {
    mockPapaParse.mockReturnValue({
      data: [{ n: "A" }],
      errors: [],
      meta: { fields: ["n"] },
    });
    mockDetectFormat.mockReturnValue("bitwarden-csv");
    mockBitwardenCsvMapRow.mockReturnValue({ items: [loginDraft({ name: "A" })] });

    let resolveCreate!: (value: { id: string; revision: number; fields: unknown }) => void;
    mockCreateVaultItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(<ImportWizard onDone={onDone} onCancel={onCancel} />);
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [makeFile("x.csv", "n\nA")] },
    });
    await waitFor(() => expect(screen.getByTestId("import-wizard-start")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("import-wizard-start"));

    await waitFor(() => expect(screen.getByTestId("import-wizard-progress")).toBeInTheDocument());
    expect(screen.queryByTestId("import-wizard-close")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("import-wizard-scrim"));
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    resolveCreate({ id: "1", revision: 1, fields: {} });
    await waitFor(() => expect(screen.getByTestId("import-wizard-summary")).toBeInTheDocument());
    expect(screen.getByTestId("import-wizard-close")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("import-wizard-close"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the fixed inset-0 scrim by default (overlay variant)", () => {
    render(<ImportWizard onDone={vi.fn()} />);
    expect(screen.getByTestId("import-wizard-scrim")).toBeInTheDocument();
  });

  it("drops the fixed inset-0 scrim wrapper when variant='inline', still rendering the wizard body", () => {
    render(<ImportWizard onDone={vi.fn()} variant="inline" />);
    expect(screen.queryByTestId("import-wizard-scrim")).not.toBeInTheDocument();
    expect(screen.getByTestId("import-wizard-skip")).toBeInTheDocument();
  });

  it("rejects a file over the defensive size guard with a generic file error, without attempting to parse it", async () => {
    render(<ImportWizard onDone={vi.fn()} />);
    const bigFile = makeFile("huge.csv", "n\nA", 11 * 1024 * 1024);
    fireEvent.change(screen.getByTestId("import-wizard-file-input"), {
      target: { files: [bigFile] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("import-wizard-file-error")).toBeInTheDocument(),
    );
    expect(mockPapaParse).not.toHaveBeenCalled();
    expect(mockDetectFormat).not.toHaveBeenCalled();
  });
});
