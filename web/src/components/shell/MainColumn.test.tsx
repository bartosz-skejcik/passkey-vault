import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockUseFolders } = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    // Every key is echoed back as-is EXCEPT the one this file actually
    // exercises interpolate() against — real template text is needed there
    // so the `{tag}` token substitution has something to replace.
    t: (key: string) => (key === "vault.tagFilterHeading" ? "Tag: {tag}" : key),
  }),
}));

import MainColumn from "./MainColumn";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
});

// Bartek live-review round 3 (TASK 1): the heading above the item list
// names the active VaultFilter instead of a static "Vault" string.
describe("MainColumn heading", () => {
  it("defaults to sidebar.all when no filter is passed", () => {
    render(<MainColumn showEmptyState={false}>content</MainColumn>);
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("sidebar.all");
  });

  it("shows sidebar.all for kind:\"all\"", () => {
    render(
      <MainColumn showEmptyState={false} filter={{ kind: "all" }}>
        content
      </MainColumn>,
    );
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("sidebar.all");
  });

  it("shows the category label for kind:\"itemType\"", () => {
    render(
      <MainColumn showEmptyState={false} filter={{ kind: "itemType", itemType: "card" }}>
        content
      </MainColumn>,
    );
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("sidebar.catCards");
  });

  it("shows the passkey category label (reusing sidebar.passkeys) for kind:\"itemType\"/passkey", () => {
    render(
      <MainColumn showEmptyState={false} filter={{ kind: "itemType", itemType: "passkey" }}>
        content
      </MainColumn>,
    );
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("sidebar.passkeys");
  });

  it("shows the folder's name for kind:\"folder\"", () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    render(
      <MainColumn showEmptyState={false} filter={{ kind: "folder", id: "folder-1" }}>
        content
      </MainColumn>,
    );
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("Praca");
  });

  it("falls back to item.noFolder for kind:\"folder\" pointing at a deleted/unknown folder id", () => {
    mockUseFolders.mockReturnValue([]);
    render(
      <MainColumn showEmptyState={false} filter={{ kind: "folder", id: "gone" }}>
        content
      </MainColumn>,
    );
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("item.noFolder");
  });

  it("shows an interpolated tag label for kind:\"tag\"", () => {
    render(
      <MainColumn showEmptyState={false} filter={{ kind: "tag", tag: "praca" }}>
        content
      </MainColumn>,
    );
    expect(screen.getByTestId("main-column-heading")).toHaveTextContent("Tag: praca");
  });
});
