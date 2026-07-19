// lib/window-geometry.test.ts — pure unit tests for centeredWindowPosition().
// No mocks needed -- this module has no I/O.
import { describe, expect, it } from "vitest";
import { centeredWindowPosition } from "./window-geometry";

describe("centeredWindowPosition", () => {
  it("centers a 380x420 window over a full-geometry current window", () => {
    expect(
      centeredWindowPosition({ left: 100, top: 50, width: 1200, height: 800 }, 380, 420),
    ).toEqual({ left: 510, top: 240 });
  });

  it("centers a 480x640 window over a full-geometry current window (ceremony-window-sized case)", () => {
    expect(
      centeredWindowPosition({ left: 100, top: 50, width: 1200, height: 800 }, 480, 640),
    ).toEqual({ left: 460, top: 130 });
  });

  it("returns {} when current is undefined (no getLastFocused result at all)", () => {
    expect(centeredWindowPosition(undefined, 380, 420)).toEqual({});
  });

  it("returns {} when current is null", () => {
    expect(centeredWindowPosition(null, 380, 420)).toEqual({});
  });

  it("returns {} when current is an empty Window object (no geometry reported)", () => {
    expect(centeredWindowPosition({}, 380, 420)).toEqual({});
  });

  it("returns {} when height is missing (every one of left/top/width/height must be present)", () => {
    expect(centeredWindowPosition({ left: 100, top: 50, width: 1200 }, 380, 420)).toEqual({});
  });

  it("rounds fractional geometry to integers", () => {
    const result = centeredWindowPosition({ left: 100, top: 50, width: 1200, height: 800.6 }, 381, 421);
    expect(Number.isInteger(result.left)).toBe(true);
    expect(Number.isInteger(result.top)).toBe(true);
  });
});
