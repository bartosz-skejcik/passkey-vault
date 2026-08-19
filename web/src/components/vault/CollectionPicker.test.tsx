import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/LocaleContext";
import type { Collection } from "@/lib/vault/collections";

const { mockUseCollections } = vi.hoisted(() => ({
  mockUseCollections: vi.fn<() => Collection[]>(),
}));

vi.mock("@/lib/vault/collections", () => ({
  useCollections: mockUseCollections,
}));

import CollectionPicker from "./CollectionPicker";

function renderWithLocale(ui: React.ReactElement) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CollectionPicker", () => {
  // Backstop #4 (zero-one-many, 26-UI-SPEC.md E8) -- zero collections.
  it("zero collections: renders folder.pickerEmpty, folder.pickerCreateNew trigger still present and calls onCreateNew, never a dead end", () => {
    mockUseCollections.mockReturnValue([]);
    const onCreateNew = vi.fn();
    renderWithLocale(<CollectionPicker value={null} onSelect={vi.fn()} onCreateNew={onCreateNew} />);

    // LocaleProvider defaults to "pl" in a fresh jsdom render (no
    // document.documentElement lang set) -- assert the PL copy, matching
    // this codebase's other locale-provider-wrapped tests.
    expect(screen.getByTestId("collection-picker-empty")).toHaveTextContent(
      "Nie masz jeszcze udostępnionych folderów.",
    );
    expect(screen.queryByTestId("collection-picker-select")).toBeNull();

    const trigger = screen.getByTestId("collection-picker-create-new");
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  // Backstop #4 -- exactly one collection: same <select>, no special-casing.
  it("exactly one collection: renders the same native select, no special-casing", () => {
    mockUseCollections.mockReturnValue([{ id: "col-1", name: "Family", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null }]);
    renderWithLocale(<CollectionPicker value={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />);

    const select = screen.getByTestId("collection-picker-select");
    expect(select.tagName).toBe("SELECT");
    expect(select.className).toContain("select-bordered");
    const options = screen.getAllByRole("option");
    // One collection option + the disabled placeholder (value === null).
    expect(options.filter((o) => (o as HTMLOptionElement).value === "col-1")).toHaveLength(1);
    // The create-new trigger is still present alongside the populated select
    // (sibling-trigger pattern, matching invite-scope-select).
    expect(screen.getByTestId("collection-picker-create-new")).toBeInTheDocument();
  });

  // Backstop #4 -- many collections: every one renders as an <option>.
  it("many collections: every collection renders as its own option", () => {
    const collections: Collection[] = [
      { id: "col-1", name: "Family", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null },
      { id: "col-2", name: "Work", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null },
      { id: "col-3", name: "Travel", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null },
    ];
    mockUseCollections.mockReturnValue(collections);
    renderWithLocale(<CollectionPicker value={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />);

    for (const collection of collections) {
      const option = screen.getByRole("option", { name: collection.name }) as HTMLOptionElement;
      expect(option.value).toBe(collection.id);
    }
  });

  // Backstop #5 -- long folder-name option truncation.
  it("#5: an option for a >=40-char collection name carries a title attribute equal to its full visible text", () => {
    const longName = "A".repeat(40) + " very long shared folder name";
    expect(longName.length).toBeGreaterThanOrEqual(40);
    mockUseCollections.mockReturnValue([{ id: "col-long", name: longName, accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null }]);
    renderWithLocale(<CollectionPicker value={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />);

    const option = screen.getByRole("option", { name: longName });
    expect(option).toHaveAttribute("title", longName);
  });

  // Backstop #6 -- CLASS-LEVEL ONLY. jsdom performs no layout, so
  // scrollWidth/clientWidth are always 0 there -- `0 <= 0` would pass
  // unconditionally regardless of markup and silently discharge nothing.
  // This asserts the honestly-scoped structural contract instead: the
  // container and the <select> both carry w-full, and neither carries a
  // fixed/max-width class shorter than a realistic long name. The CLOSED
  // native <select> value's own ellipsis handling is browser-rendered and
  // genuinely out of this component's control (see file header + SUMMARY).
  it("#6 (class-level only): container and select carry w-full, no fixed/max-width class shorter than a realistic long name", () => {
    const longName = "A very long shared folder name that could overflow a narrow container";
    mockUseCollections.mockReturnValue([{ id: "col-long", name: longName, accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null }]);
    renderWithLocale(<CollectionPicker value="col-long" onSelect={vi.fn()} onCreateNew={vi.fn()} />);

    const container = screen.getByTestId("collection-picker");
    const select = screen.getByTestId("collection-picker-select");

    expect(container.className).toContain("w-full");
    expect(select.className).toContain("w-full");

    const fixedOrMaxWidth = /(^|\s)(w-\[|max-w-(?!full)|w-\d)/;
    expect(container.className).not.toMatch(fixedOrMaxWidth);
    expect(select.className).not.toMatch(fixedOrMaxWidth);
  });

  // 260812-01e REVIEW.md HI-04: an item_bucket must never render as a
  // pickable "folder" here -- picking it would silently perform a
  // family-wide share plus a permanent self-escalation, with ShareDialog's
  // honest disclosure copy never rendered.
  it("HI-04: an item_bucket collection is excluded from the picker entirely", () => {
    const collections: Collection[] = [
      { id: "col-1", name: "Family", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null },
      { id: "bucket-1", name: "family-wide-items", accessLevel: "edit", familyWideKind: "item_bucket", familyWideAccessLevel: "read" },
    ];
    mockUseCollections.mockReturnValue(collections);
    renderWithLocale(<CollectionPicker value={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />);

    expect(screen.queryByRole("option", { name: "family-wide-items" })).toBeNull();
    expect(screen.getByRole("option", { name: "Family" })).toBeInTheDocument();
  });

  // Sibling of the above: if the item_bucket is the ONLY collection, the
  // picker must render its zero-collections empty state, not a populated
  // select carrying the excluded bucket alone.
  it("HI-04: a single item_bucket collection renders the zero-collections empty state", () => {
    mockUseCollections.mockReturnValue([
      { id: "bucket-1", name: "family-wide-items", accessLevel: "edit", familyWideKind: "item_bucket", familyWideAccessLevel: "edit" },
    ]);
    renderWithLocale(<CollectionPicker value={null} onSelect={vi.fn()} onCreateNew={vi.fn()} />);

    expect(screen.getByTestId("collection-picker-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-picker-select")).toBeNull();
  });

  it("selecting an option calls onSelect(collectionId)", () => {
    const collections: Collection[] = [
      { id: "col-1", name: "Family", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null },
      { id: "col-2", name: "Work", accessLevel: "edit", familyWideKind: null, familyWideAccessLevel: null },
    ];
    mockUseCollections.mockReturnValue(collections);
    const onSelect = vi.fn();
    renderWithLocale(<CollectionPicker value={null} onSelect={onSelect} onCreateNew={vi.fn()} />);

    const select = screen.getByTestId("collection-picker-select");
    fireEvent.change(select, { target: { value: "col-2" } });

    expect(onSelect).toHaveBeenCalledWith("col-2");
  });
});
