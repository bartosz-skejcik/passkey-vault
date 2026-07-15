// lib/clipboard.ts — extension mirror of web/src/lib/clipboard.ts's
// copy-with-real-auto-clear guarantee (VAULT-06, T-02-21), ADAPTED here
// rather than cross-package-imported: the extension is its own npm
// package with its own build graph (no workspace link to web/, confirmed
// via extension/package.json -- no `workspaces` field anywhere in this
// repo), matching this codebase's established mirror-not-cross-import
// convention (e.g. extension/lib/crypto/wasm-loader.ts's totpNow()
// wrapper mirrors web/src/lib/crypto/index.ts's own wrapper rather than
// importing it directly, per 10-04-SUMMARY.md's key-decisions).
//
// Function names/signatures/behavior are IDENTICAL to the web app's file
// (10-06-PLAN.md's own instruction: "do not reinvent the auto-clear") so a
// future auto-clear bugfix made in one file is a mechanical port to the
// other, not a re-derivation. Single-active-timer discipline preserved:
// only the most recent copy's clear timer is ever live.
export const CLIPBOARD_SECONDS_KEY = "pv-clipboard-seconds";
export const DEFAULT_CLIPBOARD_SECONDS = 40;
export const MIN_CLIPBOARD_SECONDS = 30;
export const MAX_CLIPBOARD_SECONDS = 60;

/** Clamps an arbitrary value into the documented 30-60s clipboard-clear
 * range, falling back to the default for missing/`NaN`/non-numeric input. */
export function clampClipboardSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CLIPBOARD_SECONDS;
  }
  return Math.min(MAX_CLIPBOARD_SECONDS, Math.max(MIN_CLIPBOARD_SECONDS, value));
}

/** Reads the user's configured clipboard-clear duration (30-60s range,
 * default 40s) -- falls back to the default if unset or if localStorage is
 * unavailable, and clamps any corrupted/tampered/out-of-range stored value
 * into the documented range (T-02-21). */
export function readClipboardSeconds(): number {
  try {
    const stored = localStorage.getItem(CLIPBOARD_SECONDS_KEY);
    return stored !== null ? clampClipboardSeconds(Number(stored)) : DEFAULT_CLIPBOARD_SECONDS;
  } catch {
    return DEFAULT_CLIPBOARD_SECONDS;
  }
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes `value` to the clipboard immediately; after `durationMs`, best-
 * effort overwrites the clipboard with an empty string. The Clipboard API
 * write requires a user gesture, which the calling copy-button click
 * already provides (gesture-bound APIs must run in the popup click
 * handler, not in the background -- a gesture does not survive a
 * sendMessage hop).
 */
export function copyWithAutoClear(value: string, durationMs: number): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
  }
  void navigator.clipboard.writeText(value);
  clearTimer = setTimeout(() => {
    void navigator.clipboard.writeText("");
    clearTimer = null;
  }, durationMs);
}
