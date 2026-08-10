import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VaultItem } from "@/lib/vault/types";
// Deliberately NOT mocked in this file (only "@/lib/i18n/LocaleContext" is,
// via the `t: (key) => key` identity stub below) -- these are the real
// dictionary entry + engine functions, used by the held-out copy-pinning
// test at the bottom of this file so the actual shipped wording is what
// gets asserted, not a mocked-identity substring that would pass either way.
import { interpolate as realInterpolate, t as realT } from "@/lib/i18n/dictionary";

const {
  mockUseVaultItems,
  mockUseFolders,
  mockUseItemsHydrated,
  mockBuildJsonExport,
  mockBuildCsvExport,
  mockDownloadFile,
} = vi.hoisted(() => ({
  // CR-02 (code review, Phase 29): ExportDialog now subscribes via
  // `useVaultItems()`/`useFolders()` (reactive `useSyncExternalStore` hooks)
  // instead of reading `getItems()`/`getFolders()` as a plain, non-reactive
  // snapshot -- mocked here as plain hooks (no actual store subscription
  // needed in these component-level tests; each test just sets the return
  // value directly, same shape as the old getItems()/getFolders() mocks).
  mockUseVaultItems: vi.fn((): VaultItem[] => []),
  mockUseFolders: vi.fn(() => []),
  // 29-02: defaults to `true` so the 4 pre-existing tests (none of which
  // exercise hydration) see the same "confirm always enabled" behavior they
  // did before this plan, without needing their own mock setup.
  mockUseItemsHydrated: vi.fn(() => true),
  mockBuildJsonExport: vi.fn(() => '{"items":[]}'),
  mockBuildCsvExport: vi.fn(() => "name,type\n"),
  mockDownloadFile: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  useVaultItems: mockUseVaultItems,
  useFolders: mockUseFolders,
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
  mockUseVaultItems.mockReturnValue([]);
  mockUseFolders.mockReturnValue([]);
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
    mockUseVaultItems.mockReturnValue([]);
    render(<ExportDialog onClose={vi.fn()} />);
    expect(screen.queryByTestId("export-hidden-password-disclosure")).not.toBeInTheDocument();
  });

  it("n===1 (hydrated): the disclosure renders the exact interpolated string for n=1", () => {
    mockUseItemsHydrated.mockReturnValue(true);
    mockUseVaultItems.mockReturnValue([makeHiddenPasswordItem("item-1")]);
    render(<ExportDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("export-hidden-password-disclosure")).toHaveTextContent(
      "export.hiddenPasswordDisclosure 1",
    );
  });

  it("n===3 (hydrated): the disclosure renders with n=3", () => {
    mockUseItemsHydrated.mockReturnValue(true);
    mockUseVaultItems.mockReturnValue([
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
    mockUseVaultItems.mockReturnValue([makeHiddenPasswordItem("item-1")]);
    render(<ExportDialog onClose={vi.fn()} />);

    expect(screen.getByTestId("export-confirm")).toBeDisabled();
    expect(screen.queryByTestId("export-hidden-password-disclosure")).not.toBeInTheDocument();
  });

  // CR-02 (code review, Phase 29): the dialog used to read `getItems()` as a
  // plain, non-reactive snapshot -- a background sync merge landing while
  // the dialog was already open never updated the disclosed count.
  // `useVaultItems()`/`useFolders()` are real `useSyncExternalStore` hooks
  // in production; this component-level test proves the render OUTPUT
  // recomputes from whatever the hooks currently return on every render
  // (the actual store-triggered re-render itself is exercised by
  // `store.test.ts`'s own `useVaultItems`/`subscribeItems` coverage) --
  // together they cover both halves of "a live sync merge updates the open
  // dialog". Also proves `handleConfirm` builds the export from the SAME
  // `allItems` array the disclosure was computed from (WR-06): the JSON
  // exporter mock is asserted against post-mutation state, not the stale
  // pre-mutation snapshot.
  it("a mutation of the subscribed item set updates the disclosure count (and enables the confirm click to export the NEW set) without closing/reopening the dialog", () => {
    mockUseItemsHydrated.mockReturnValue(true);
    mockUseVaultItems.mockReturnValue([]);
    const { rerender } = render(<ExportDialog onClose={vi.fn()} />);

    expect(screen.queryByTestId("export-hidden-password-disclosure")).not.toBeInTheDocument();

    // A background sync merge lands a hidden-password item while the dialog
    // is already open -- the store's real `notifyListeners()` would trigger
    // exactly this re-render via `useSyncExternalStore`.
    mockUseVaultItems.mockReturnValue([makeHiddenPasswordItem("item-1")]);
    rerender(<ExportDialog onClose={vi.fn()} />);

    expect(screen.getByTestId("export-hidden-password-disclosure")).toHaveTextContent(
      "export.hiddenPasswordDisclosure 1",
    );

    fireEvent.click(screen.getByTestId("export-confirm"));
    expect(mockBuildJsonExport).toHaveBeenCalledTimes(1);
    expect(mockBuildJsonExport).toHaveBeenCalledWith([makeHiddenPasswordItem("item-1")], []);
  });
});

// Held-out copy-pinning test (Task 3 checkpoint resolution, 2026-08-10):
// the component-level tests above render through a mocked `t` (identity
// function returning the bare key), so they never actually exercise the
// real dictionary string -- they'd pass unchanged no matter what the real
// PL/EN copy says. This block asserts the REAL, unmocked dictionary entry
// + interpolate() output verbatim, at n=1 AND n=2, in both locales, so the
// wording can't drift silently. The original "{n} wpisów" copy was
// rejected specifically because it was grammatically wrong at n=1 ("1
// wpisów"); this test would have caught that, and now proves the reworded
// copy (count never governs the noun) is correct at every n with zero
// plural-selection machinery -- in EN as well as PL, since "{n} such
// items" would have reproduced the identical bug in English.
describe("export.hiddenPasswordDisclosure copy (held-out, real dictionary -- pins wording against silent drift)", () => {
  it("pl: grammatically correct at n=1 and n=2 with zero plural-selection logic", () => {
    const template = realT("pl", "export.hiddenPasswordDisclosure");
    expect(realInterpolate(template, { n: "1" })).toBe(
      "Ten eksport zawiera hasła wpisów udostępnionych Ci z ukrytym hasłem — liczba takich wpisów: 1. To maskowanie działa tylko w interfejsie, nigdy kryptograficznie.",
    );
    expect(realInterpolate(template, { n: "2" })).toBe(
      "Ten eksport zawiera hasła wpisów udostępnionych Ci z ukrytym hasłem — liczba takich wpisów: 2. To maskowanie działa tylko w interfejsie, nigdy kryptograficznie.",
    );
  });

  it("en: grammatically correct at n=1 and n=2 with zero plural-selection logic", () => {
    const template = realT("en", "export.hiddenPasswordDisclosure");
    expect(realInterpolate(template, { n: "1" })).toBe(
      "This export includes the passwords of items shared to you with a hidden password — 1 in total. That mask is an interface-only protection, never a cryptographic one.",
    );
    expect(realInterpolate(template, { n: "2" })).toBe(
      "This export includes the passwords of items shared to you with a hidden password — 2 in total. That mask is an interface-only protection, never a cryptographic one.",
    );
  });
});

// 30-15 (FSH-02): synthetic pending-family-key rows live in the SAME merged
// `items` array every consumer reads -- which is what makes them visible in
// the list, and exactly why this consumer has to drop them. They are
// placeholders for an item whose plaintext this member cannot read yet;
// writing one to disk would put a fabricated empty entry in a file the user
// believes is a faithful copy of their vault.
describe("ExportDialog vs synthetic pending-family-key rows (30-15)", () => {
  const pendingRow: VaultItem = {
    id: "pending-family-key:c9",
    revision: 0,
    pendingFamilyKey: true,
    fields: { type: "note", name: "", body: "", folderId: null, tags: [] },
  };
  const realItem: VaultItem = {
    id: "item-1",
    revision: 1,
    fields: { type: "note", name: "Wifi", body: "hunter2", folderId: null, tags: [] },
  };

  it("never writes a pending placeholder into the exported file", () => {
    mockUseVaultItems.mockReturnValue([realItem, pendingRow]);
    render(<ExportDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("export-confirm"));

    expect(mockBuildJsonExport).toHaveBeenCalledTimes(1);
    const [exportedItems] = mockBuildJsonExport.mock.calls[0] as unknown as [VaultItem[]];
    expect(exportedItems.map((i) => i.id)).toEqual(["item-1"]);
  });
});
