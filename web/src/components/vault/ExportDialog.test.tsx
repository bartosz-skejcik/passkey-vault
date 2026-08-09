import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VaultItem } from "@/lib/vault/types";

const {
  mockGetItems,
  mockGetFolders,
  mockUseItemsHydrated,
  mockBuildJsonExport,
  mockBuildCsvExport,
  mockDownloadFile,
} = vi.hoisted(() => ({
  mockGetItems: vi.fn((): VaultItem[] => []),
  mockGetFolders: vi.fn(() => []),
  // 29-02: defaults to `true` so the 4 pre-existing tests (none of which
  // exercise hydration) see the same "confirm always enabled" behavior they
  // did before this plan, without needing their own mock setup.
  mockUseItemsHydrated: vi.fn(() => true),
  mockBuildJsonExport: vi.fn(() => '{"items":[]}'),
  mockBuildCsvExport: vi.fn(() => "name,type\n"),
  mockDownloadFile: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  getItems: mockGetItems,
  getFolders: mockGetFolders,
  useItemsHydrated: mockUseItemsHydrated,
}));

vi.mock("@/lib/vault/exporters/toJson", () => ({
  buildJsonExport: mockBuildJsonExport,
}));

vi.mock("@/lib/vault/exporters/toCsv", () => ({
  buildCsvExport: mockBuildCsvExport,
}));

vi.mock("@/lib/vault/exporters/download", () => ({
  downloadFile: mockDownloadFile,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ExportDialog from "./ExportDialog";

function makeHiddenPasswordItem(id: string): VaultItem {
  return {
    id,
    revision: 1,
    accessLevel: "hidden_password",
    fields: {
      type: "login",
      name: `Shared item ${id}`,
      username: "user",
      password: "secret",
      urls: [],
      notes: "",
      folderId: null,
      tags: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetItems.mockReturnValue([]);
  mockGetFolders.mockReturnValue([]);
  mockUseItemsHydrated.mockReturnValue(true);
});

describe("ExportDialog", () => {
  it("always shows the plaintext-warning banner before the confirm button can be clicked", () => {
    render(<ExportDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("export-warning-banner")).toBeInTheDocument();
    expect(screen.getByTestId("export-confirm")).toBeInTheDocument();
  });

  it("clicking confirm builds the JSON export (default format) then downloads then closes", () => {
    const onClose = vi.fn();
    render(<ExportDialog onClose={onClose} />);

    fireEvent.click(screen.getByTestId("export-confirm"));

    expect(mockBuildJsonExport).toHaveBeenCalledTimes(1);
    expect(mockBuildCsvExport).not.toHaveBeenCalled();
    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
    expect(mockDownloadFile.mock.calls[0][2]).toBe("application/json");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the CSV toggle then confirm builds the CSV export instead", () => {
    render(<ExportDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("export-format-csv"));
    fireEvent.click(screen.getByTestId("export-confirm"));

    expect(mockBuildCsvExport).toHaveBeenCalledTimes(1);
    expect(mockBuildJsonExport).not.toHaveBeenCalled();
    expect(mockDownloadFile.mock.calls[0][2]).toBe("text/csv");
  });

  it("clicking cancel or the backdrop calls onClose without ever calling downloadFile", () => {
    const onClose = vi.fn();
    render(<ExportDialog onClose={onClose} />);

    fireEvent.click(screen.getByTestId("export-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockDownloadFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("export-dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});

// DEBT-02 (Plan 29-02): disclose, never mask. The disclosure sentence must
// (a) never render at n=0, even when hydrated, (b) render the exact
// interpolated count at n>=1, and (c) never be presented as a confirmed
// zero-count against an unhydrated/partial store -- the falsification test
// below is what actually defends against reopening the honesty defect.
describe("ExportDialog — DEBT-02 hidden-password disclosure", () => {
  it("n===0 (hydrated, zero hidden_password items): the disclosure is absent from the DOM entirely, never a rendered '0'", () => {
    mockUseItemsHydrated.mockReturnValue(true);
    mockGetItems.mockReturnValue([]);
    render(<ExportDialog onClose={vi.fn()} />);
    expect(screen.queryByTestId("export-hidden-password-disclosure")).not.toBeInTheDocument();
  });

  it("n===1 (hydrated): the disclosure renders the exact interpolated string for n=1", () => {
    mockUseItemsHydrated.mockReturnValue(true);
    mockGetItems.mockReturnValue([makeHiddenPasswordItem("item-1")]);
    render(<ExportDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("export-hidden-password-disclosure")).toHaveTextContent(
      "export.hiddenPasswordDisclosure 1",
    );
  });

  it("n===3 (hydrated): the disclosure renders with n=3", () => {
    mockUseItemsHydrated.mockReturnValue(true);
    mockGetItems.mockReturnValue([
      makeHiddenPasswordItem("item-1"),
      makeHiddenPasswordItem("item-2"),
      makeHiddenPasswordItem("item-3"),
    ]);
    render(<ExportDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("export-hidden-password-disclosure")).toHaveTextContent(
      "export.hiddenPasswordDisclosure 3",
    );
  });

  // Falsification test: opening the export dialog against a
  // mid-hydration/unknown store must never silently present an absent
  // (zero-count) disclosure as if it were a confirmed zero. An absent
  // disclosure ALONE is indistinguishable from the n=0 case -- the disabled
  // confirm button is what actually proves this is "unknown", not
  // "confirmed zero".
  it("falsification: while useItemsHydrated() is false (mid-hydration), export-confirm is disabled AND the disclosure is absent -- never presents an unconfirmed count as a confirmed zero", () => {
    mockUseItemsHydrated.mockReturnValue(false);
    // Even if getItems() happens to return hidden-password items mid-refresh,
    // the component must not read them while hydrated is false.
    mockGetItems.mockReturnValue([makeHiddenPasswordItem("item-1")]);
    render(<ExportDialog onClose={vi.fn()} />);

    expect(screen.getByTestId("export-confirm")).toBeDisabled();
    expect(screen.queryByTestId("export-hidden-password-disclosure")).not.toBeInTheDocument();
  });
});
