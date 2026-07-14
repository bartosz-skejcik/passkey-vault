import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { mockGetItems, mockGetFolders, mockBuildJsonExport, mockBuildCsvExport, mockDownloadFile } =
  vi.hoisted(() => ({
    mockGetItems: vi.fn(() => []),
    mockGetFolders: vi.fn(() => []),
    mockBuildJsonExport: vi.fn(() => '{"items":[]}'),
    mockBuildCsvExport: vi.fn(() => "name,type\n"),
    mockDownloadFile: vi.fn(),
  }));

vi.mock("@/lib/vault/store", () => ({
  getItems: mockGetItems,
  getFolders: mockGetFolders,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetItems.mockReturnValue([]);
  mockGetFolders.mockReturnValue([]);
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
