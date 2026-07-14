import { describe, expect, it } from "vitest";
import { wasRemotelyDeleted } from "./remoteDelete";
import type { VaultItem } from "./types";

const someItem: VaultItem = {
  id: "item-1",
  revision: 1,
  fields: {
    type: "note",
    name: "Wifi",
    body: "hunter2",
    folderId: null,
    tags: [],
  },
};

describe("wasRemotelyDeleted", () => {
  it("returns true only when selectedItemId is non-null AND selectedItem is null", () => {
    expect(wasRemotelyDeleted("item-1", null)).toBe(true);
  });

  it("returns false when both selectedItemId and selectedItem are null", () => {
    expect(wasRemotelyDeleted(null, null)).toBe(false);
  });

  it("returns false when selectedItemId is null but selectedItem is non-null", () => {
    expect(wasRemotelyDeleted(null, someItem)).toBe(false);
  });
});
