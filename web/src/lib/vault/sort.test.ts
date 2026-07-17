import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SORT, readSortPreference, sortItems, writeSortPreference } from "./sort";
import type { LoginFields, VaultItem } from "./types";

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

describe("sortItems", () => {
  it("sorts by name ascending, case-sensitive-safe (localeCompare)", () => {
    const items = [loginItem("1", "Zebra"), loginItem("2", "apple"), loginItem("3", "Mango")];
    const sorted = sortItems(items, "name").map((i) => i.fields.name);
    expect(sorted).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("does not mutate the input array", () => {
    const items = [loginItem("1", "B"), loginItem("2", "A")];
    const result = sortItems(items, "name");
    expect(result).not.toBe(items);
    expect(items.map((i) => i.fields.name)).toEqual(["B", "A"]);
  });

  it("sorts by lastUsed descending (most recent first)", () => {
    const items = [
      loginItem("1", "Old", "2026-01-01 10:00:00"),
      loginItem("2", "New", "2026-06-01 10:00:00"),
      loginItem("3", "Mid", "2026-03-01 10:00:00"),
    ];
    const sorted = sortItems(items, "lastUsed").map((i) => i.id);
    expect(sorted).toEqual(["2", "3", "1"]);
  });

  it("sinks never-used items (no lastUsedAt) to the bottom, sorted by name among themselves", () => {
    const items = [
      loginItem("1", "Zebra"),
      loginItem("2", "Used", "2026-01-01 10:00:00"),
      loginItem("3", "Apple"),
    ];
    const sorted = sortItems(items, "lastUsed").map((i) => i.fields.name);
    expect(sorted).toEqual(["Used", "Apple", "Zebra"]);
  });

  it("treats an all-never-used list as a pure name sort under lastUsed mode", () => {
    const items = [loginItem("1", "Zebra"), loginItem("2", "Apple")];
    const sorted = sortItems(items, "lastUsed").map((i) => i.fields.name);
    expect(sorted).toEqual(["Apple", "Zebra"]);
  });
});

describe("sort preference persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to lastUsed when nothing is persisted yet", () => {
    expect(readSortPreference()).toBe("lastUsed");
    expect(DEFAULT_SORT).toBe("lastUsed");
  });

  it("round-trips a written preference", () => {
    writeSortPreference("name");
    expect(readSortPreference()).toBe("name");
    writeSortPreference("lastUsed");
    expect(readSortPreference()).toBe("lastUsed");
  });

  it("falls back to the default for a corrupted/unrecognized stored value", () => {
    window.localStorage.setItem("pv-vault-sort", "not-a-real-option");
    expect(readSortPreference()).toBe("lastUsed");
  });
});
