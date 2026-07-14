import { describe, expect, it } from "vitest";
import { mapItem } from "./bitwardenJson";

describe("bitwardenJson.mapItem", () => {
  it("splits a login with an embedded totp into two drafts", () => {
    const result = mapItem({
      type: 1,
      name: "GitHub",
      login: {
        username: "bartek",
        password: "hunter2",
        totp: "JBSWY3DPEHPK3PXP",
        uris: [{ uri: "https://github.com" }],
      },
    });

    expect(result.skipped).toBeUndefined();
    expect(result.items).toHaveLength(2);
    const [loginDraft, totpDraft] = result.items;
    expect(loginDraft).toMatchObject({
      type: "login",
      name: "GitHub",
      username: "bartek",
      password: "hunter2",
      urls: ["https://github.com"],
    });
    expect(totpDraft).toMatchObject({
      type: "totp",
      name: "GitHub",
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("does not split when login.totp is empty", () => {
    const result = mapItem({
      type: 1,
      name: "GitHub",
      login: { username: "bartek", password: "hunter2", totp: "", uris: [] },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("login");
  });

  it("maps a card item combining expMonth/expYear into expiry", () => {
    const result = mapItem({
      type: 3,
      name: "Visa",
      card: {
        cardholderName: "B",
        number: "4111",
        expMonth: "01",
        expYear: "30",
        code: "123",
      },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "card",
      cardholderName: "B",
      number: "4111",
      expiry: "01/30",
      cvv: "123",
    });
  });

  it("maps a secure note item", () => {
    const result = mapItem({ type: 2, name: "WiFi", notes: "home network password" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ type: "note", body: "home network password" });
  });

  it("maps an identity item", () => {
    const result = mapItem({
      type: 4,
      name: "Me",
      identity: {
        firstName: "Bartek",
        lastName: "P",
        email: "b@example.com",
        phone: "123",
        address1: "Main St",
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "identity",
      firstName: "Bartek",
      lastName: "P",
      email: "b@example.com",
      phone: "123",
      address: "Main St",
    });
  });

  it("returns a missingField skip for an item with no name", () => {
    const result = mapItem({ type: 1, name: "", login: { username: "u", password: "p" } });
    expect(result).toEqual({ items: [], skipped: "missingField" });
  });

  it("resolves folder name via folderNamesById", () => {
    const result = mapItem(
      { type: 1, name: "GitHub", folderId: "f1", login: { username: "u", password: "p" } },
      { f1: "Work" },
    );
    expect(result.items[0].folder).toBe("Work");
  });

  it("defaults folder to empty string when folderId is unknown", () => {
    const result = mapItem({
      type: 1,
      name: "GitHub",
      folderId: "unknown-id",
      login: { username: "u", password: "p" },
    });
    expect(result.items[0].folder).toBe("");
  });

  it("returns unparseableRow for an unrecognized type", () => {
    const result = mapItem({ type: 99, name: "X" });
    expect(result).toEqual({ items: [], skipped: "unparseableRow" });
  });
});
