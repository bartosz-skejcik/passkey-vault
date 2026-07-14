import { describe, expect, it } from "vitest";
import { detect, mapRow } from "./nordpassCsv";

describe("nordpassCsv.detect", () => {
  it("matches the exact 6-column NordPass header", () => {
    expect(detect(["name", "url", "username", "password", "note", "folder"])).toBe(true);
  });

  it("does not match when any one required column is missing", () => {
    expect(detect(["name", "url", "username", "password", "note"])).toBe(false);
    expect(detect(["url", "username", "password", "note", "folder"])).toBe(false);
  });

  it("does not match an empty header array", () => {
    expect(detect([])).toBe(false);
  });
});

describe("nordpassCsv.mapRow", () => {
  it("maps a populated row to a login draft", () => {
    const result = mapRow({
      name: "GitHub",
      url: "https://github.com",
      username: "bartek",
      password: "hunter2",
      note: "",
      folder: "Work",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "login",
      name: "GitHub",
      folder: "Work",
    });
  });

  it("maps an empty-credentials row with a note to a note draft", () => {
    const result = mapRow({
      name: "WiFi",
      url: "",
      username: "",
      password: "",
      note: "home network password is X",
      folder: "",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "note",
      body: "home network password is X",
    });
  });

  it("returns a missingField skip for a row with no name", () => {
    const result = mapRow({
      name: "",
      url: "",
      username: "",
      password: "",
      note: "",
      folder: "",
    });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });
});
