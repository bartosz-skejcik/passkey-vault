// lib/window-geometry.ts — pure window-centering math shared by the two
// `browser.windows.create()` call sites this quick task (260720-16k)
// touches: `provider-ceremony.ts`'s `tryOpenFallbackWindow` (the Firefox
// consent-window fallback) and `server-unlock.ts`'s `startServerUnlock`
// (the server-origin PRF unlock/sign-in ceremony window). Both need the
// SAME "center a new window of a known size over the current window"
// formula -- this module owns it once, pure (no browser API calls, no I/O),
// mirroring `lib/server-url.ts`'s own pure-module convention so it stays
// trivially unit-testable and importable from either background file
// without dragging in `wxt/browser`.

/**
 * A structural subset of `@types/webextension-polyfill`'s
 * `Windows.Window` -- kept as this module's OWN type (not imported from
 * `wxt/browser`/the polyfill types) so this file has zero browser-API
 * surface. Every field is optional because `browser.windows.getLastFocused()`
 * can resolve a `Window` missing some or all of them (e.g. some Linux
 * window managers report no geometry at all, per MDN).
 */
export interface WindowGeometry {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/**
 * Computes the `{ left, top }` a new `newWidth`x`newHeight` window should
 * open at to be centered over `current`'s bounds. Returns `{}` (no
 * `left`/`top` keys at all, not `left: undefined`) unless `current` is
 * non-null/non-undefined AND all four of `current.left`/`current.top`/
 * `current.width`/`current.height` are `typeof === "number"` and
 * `Number.isFinite(...)` -- guards against `NaN`/`Infinity`, not just
 * `undefined`. Callers spread the result into their `windows.create()`
 * options object; an empty `{}` means "let the browser pick a default
 * placement" rather than crash or center on partial data.
 */
export function centeredWindowPosition(
  current: WindowGeometry | null | undefined,
  newWidth: number,
  newHeight: number,
): { left?: number; top?: number } {
  if (current === null || current === undefined) {
    return {};
  }
  const { left, top, width, height } = current;
  if (
    typeof left !== "number" ||
    !Number.isFinite(left) ||
    typeof top !== "number" ||
    !Number.isFinite(top) ||
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    typeof height !== "number" ||
    !Number.isFinite(height)
  ) {
    return {};
  }
  return {
    left: Math.round(left + (width - newWidth) / 2),
    top: Math.round(top + (height - newHeight) / 2),
  };
}
