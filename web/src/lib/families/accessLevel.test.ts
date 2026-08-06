// Direct unit coverage for accessLevel.ts's own contract (Phase 26, Plan
// 06) -- distinct from RemoveMemberDialog.test.tsx, which tests the
// DIALOG's behavior through this module, not the module's contract itself.
import { describe, expect, it } from "vitest";
import { accessLevelKey, accessRank, higherAccess } from "./accessLevel";

describe("accessLevelKey", () => {
  it("maps the three known wire values to their dictionary keys", () => {
    expect(accessLevelKey("read")).toBe("access.readOnly");
    expect(accessLevelKey("edit")).toBe("access.fullEdit");
    expect(accessLevelKey("hidden_password")).toBe("access.hiddenPassword");
  });

  it("WR-13: fails closed to access.unknown for an unrecognized value, never the most reassuring label", () => {
    expect(accessLevelKey("some-future-level")).toBe("access.unknown");
    expect(accessLevelKey("")).toBe("access.unknown");
    // Specifically never falls back to access.readOnly (the least-alarming
    // label) for a value it doesn't recognize.
    expect(accessLevelKey("bogus")).not.toBe("access.readOnly");
  });
});

describe("accessRank / higherAccess", () => {
  it("orders read < hidden_password < edit, matching membership.rs::combine_access", () => {
    expect(accessRank("read")).toBeLessThan(accessRank("hidden_password"));
    expect(accessRank("hidden_password")).toBeLessThan(accessRank("edit"));
  });

  it("higherAccess returns the higher-ranked of two levels", () => {
    expect(higherAccess("read", "edit")).toBe("edit");
    expect(higherAccess("edit", "read")).toBe("edit");
    expect(higherAccess("read", "hidden_password")).toBe("hidden_password");
    expect(higherAccess("hidden_password", "hidden_password")).toBe("hidden_password");
  });
});
