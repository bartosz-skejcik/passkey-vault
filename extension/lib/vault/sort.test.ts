import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginFields, VaultItem } from "./types";

// Popup UI round (decision 4): sort.ts now also owns SortOption's
// storage-backed read/write preference via `browser.storage.local` (async,
// unlike web/src/lib/vault/sort.ts's synchronous localStorage version) --
// mocked with a Map-backed fake, the same convention lib/theme/
// theme-mirror.test.ts and lib/autofill/blocked-origins.test.ts already use.
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        async get(key: string) {
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) {
            store.set(k, v);
          }
        },
      },
    },
  },
}));

import { DEFAULT_SORT, readSortPreference, sortByLastUsed, sortItems, writeSortPreference } from "./sort";

function loginItem(id: string, name: string, lastUsedAt?: string): VaultItem {
  const fields: LoginFields = {
    type: "login",
    name,
    username: "bartek",
    password: "s3cret",
    urls: [],
    notes: "",
    folderId: null,
    tags: [],
  };
  return { id, revision: 1, fields, lastUsedAt };
}

beforeEach(() => {
  store.clear();
});

describe("sortByLastUsed", () => {
  it("sorts by lastUsed descending (most recent first)", () => {
    const items = [
      loginItem("1", "Old", "2026-01-01 10:00:00"),
      loginItem("2", "New", "2026-06-01 10:00:00"),
      loginItem("3", "Mid", "2026-03-01 10:00:00"),
    ];
    expect(sortByLastUsed(items).map((i) => i.id)).toEqual(["2", "3", "1"]);
  });

  it("sinks never-used items (no lastUsedAt) to the bottom, sorted by name among themselves", () => {
    const items = [
      loginItem("1", "Zebra"),
      loginItem("2", "Used", "2026-01-01 10:00:00"),
      loginItem("3", "Apple"),
    ];
    expect(sortByLastUsed(items).map((i) => i.fields.name)).toEqual(["Used", "Apple", "Zebra"]);
  });

  it("does not mutate the input array", () => {
    const items = [loginItem("1", "B"), loginItem("2", "A")];
    const result = sortByLastUsed(items);
    expect(result).not.toBe(items);
    expect(items.map((i) => i.fields.name)).toEqual(["B", "A"]);
  });

  it("treats an all-never-used list as a pure name sort", () => {
    const items = [loginItem("1", "Zebra"), loginItem("2", "Apple")];
    expect(sortByLastUsed(items).map((i) => i.fields.name)).toEqual(["Apple", "Zebra"]);
  });
});

// Popup UI round (decision 4): the compact sort control's own comparator --
// "lastUsed" mirrors sortByLastUsed exactly (kept for back-compat above);
// "name" is a pure alphabetical sort, ignoring lastUsedAt entirely, same
// shape as web/src/lib/vault/sort.ts's own sortItems().
describe("sortItems", () => {
  it('sortItems(items, "lastUsed") is equivalent to sortByLastUsed', () => {
    const items = [
      loginItem("1", "Old", "2026-01-01 10:00:00"),
      loginItem("2", "New", "2026-06-01 10:00:00"),
    ];
    expect(sortItems(items, "lastUsed").map((i) => i.id)).toEqual(
      sortByLastUsed(items).map((i) => i.id),
    );
  });

  it('sortItems(items, "name") sorts alphabetically, ignoring lastUsedAt', () => {
    const items = [
      loginItem("1", "Zebra", "2026-06-01 10:00:00"),
      loginItem("2", "Apple"),
      loginItem("3", "Mango", "2026-01-01 10:00:00"),
    ];
    expect(sortItems(items, "name").map((i) => i.fields.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("does not mutate its input", () => {
    const items = [loginItem("1", "B"), loginItem("2", "A")];
    const result = sortItems(items, "name");
    expect(result).not.toBe(items);
    expect(items.map((i) => i.fields.name)).toEqual(["B", "A"]);
  });
});

describe("readSortPreference / writeSortPreference", () => {
  it("defaults to DEFAULT_SORT (\"lastUsed\") when nothing was ever persisted", async () => {
    expect(await readSortPreference()).toBe(DEFAULT_SORT);
  });

  it("round-trips a written preference through browser.storage.local", async () => {
    await writeSortPreference("name");
    expect(await readSortPreference()).toBe("name");
    await writeSortPreference("lastUsed");
    expect(await readSortPreference()).toBe("lastUsed");
  });

  it("falls back to DEFAULT_SORT for a corrupt/unrecognized stored value", async () => {
    store.set("pv-popup-sort", "not-a-real-option");
    expect(await readSortPreference()).toBe(DEFAULT_SORT);
  });
});
