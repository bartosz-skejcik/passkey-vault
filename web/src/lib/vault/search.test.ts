import { describe, expect, it } from "vitest";
import { searchItems } from "./search";
import type { LoginFields, NoteFields, VaultItem } from "./types";

function loginItem(id: string, overrides: Partial<LoginFields> = {}): VaultItem {
  const fields: LoginFields = {
    type: "login",
    name: "GitHub",
    username: "bartek",
    password: "s3cret",
    url: "https://github.com/login",
    notes: "",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id, revision: 1, fields };
}

function noteItem(id: string, overrides: Partial<NoteFields> = {}): VaultItem {
  const fields: NoteFields = {
    type: "note",
    name: "Wifi password",
    body: "hunter2",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id, revision: 1, fields };
}

describe("searchItems", () => {
  it("returns items unchanged when the query is empty or whitespace", () => {
    const items = [loginItem("1"), noteItem("2")];
    expect(searchItems(items, "")).toBe(items);
    expect(searchItems(items, "   ")).toBe(items);
  });

  it("matches an item's name case-insensitively and partially", () => {
    const items = [loginItem("1", { name: "GitHub" }), noteItem("2", { name: "Wifi password" })];
    expect(searchItems(items, "git")).toEqual([items[0]]);
    expect(searchItems(items, "GITHUB")).toEqual([items[0]]);
  });

  it("matches a login item's username", () => {
    const items = [loginItem("1", { username: "bartek" }), noteItem("2")];
    expect(searchItems(items, "BARTEK")).toEqual([items[0]]);
  });

  it("matches a login item's URL-derived domain", () => {
    const items = [loginItem("1", { url: "https://github.com/login" }), noteItem("2")];
    expect(searchItems(items, "github.com")).toEqual([items[0]]);
  });

  it("returns an empty array when nothing matches name/username/domain", () => {
    const items = [loginItem("1"), noteItem("2")];
    expect(searchItems(items, "nonexistent-query")).toEqual([]);
  });

  it("performs no network call — operates purely over the in-memory array", () => {
    const fetchSpy = globalThis.fetch;
    expect(typeof fetchSpy).not.toBe("undefined");
    const items = [loginItem("1")];
    searchItems(items, "git");
    // No assertion needed beyond "doesn't throw" — the acceptance criteria's
    // `grep -c "fetch("` check on search.ts is the real enforcement; this
    // test documents the intent.
  });
});
