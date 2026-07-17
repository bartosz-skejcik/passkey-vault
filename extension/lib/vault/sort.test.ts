import { describe, expect, it } from "vitest";
import { sortByLastUsed } from "./sort";
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
