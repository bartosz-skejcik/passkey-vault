// 26-VERIFICATION.md gaps 1 and 3. These two predicates are the single
// source of truth both item surfaces read, so this file is where the
// server's own rules are pinned — DetailPanel.test.tsx/ItemContextMenu.test.tsx
// assert the WIRING, this file asserts the RULE.
import { describe, expect, it } from "vitest";
import { canEditItem, isPasswordHidden } from "./itemCapabilities";
import type { VaultItem } from "./types";

function item(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "item-1",
    revision: 1,
    fields: { type: "note", name: "n", body: "b", folderId: null, tags: [] },
    ...overrides,
  };
}

describe("isPasswordHidden (SHARE-03)", () => {
  it("is true only for the exact `hidden_password` level", () => {
    expect(isPasswordHidden(item({ accessLevel: "hidden_password" }))).toBe(true);
    expect(isPasswordHidden(item({ accessLevel: "read" }))).toBe(false);
    expect(isPasswordHidden(item({ accessLevel: "edit" }))).toBe(false);
  });

  it("is false for an item the caller owns outright (no level on the wire)", () => {
    expect(isPasswordHidden(item())).toBe(false);
  });

  it("is false for an unrecognized level — it must never be inferred from a rank", () => {
    // A future/garbage level is NOT hidden-password. Masking on anything
    // other than the exact string would claim a protection the owner never
    // chose; `accessLevelKey` fails that value closed to `access.unknown`
    // separately.
    expect(isPasswordHidden(item({ accessLevel: "some_future_level" }))).toBe(false);
  });
});

describe("canEditItem", () => {
  it("allows editing an item the caller owns outright", () => {
    expect(canEditItem(item())).toBe(true);
    // Including one the caller is SHARING OUT — outbound sharing never
    // costs the owner their own edit rights.
    expect(canEditItem(item({ isShared: true }))).toBe(true);
  });

  it("refuses a directly-shared item at EVERY level, including edit", () => {
    // No encrypt-as-shared-key-recipient primitive exists yet; the store
    // throws DirectShareNotEditableError rather than corrupt the item under
    // the recipient's own key. Live probe P5 found the UI offering it anyway.
    expect(canEditItem(item({ sharedToMe: true, accessLevel: "edit" }))).toBe(false);
    expect(canEditItem(item({ sharedToMe: true, accessLevel: "read" }))).toBe(false);
    expect(canEditItem(item({ sharedToMe: true, accessLevel: "hidden_password" }))).toBe(false);
  });

  it("allows a collection-scoped item only at the exact `edit` level", () => {
    expect(canEditItem(item({ collectionId: "col-1", accessLevel: "edit" }))).toBe(true);
    expect(canEditItem(item({ collectionId: "col-1", accessLevel: "read" }))).toBe(false);
  });

  it("refuses `hidden_password` — never treats its middle RANK as good enough for edit", () => {
    // `combine_access` ranks hidden_password BETWEEN read and edit for the
    // max-of-two-grants purpose only. `RequireEdit::satisfied_by` is an
    // EXACT match precisely so that rank can never leak into an edit
    // decision (the Vaultwarden #6269 / SHARE-04 bug class). This mirrors
    // that discipline client-side, and is also what stops an edit form from
    // showing the very password the mask exists to hide.
    expect(canEditItem(item({ collectionId: "col-1", accessLevel: "hidden_password" }))).toBe(false);
  });

  it("fails closed for an unrecognized level", () => {
    expect(canEditItem(item({ collectionId: "col-1", accessLevel: "some_future_level" }))).toBe(
      false,
    );
  });
});
