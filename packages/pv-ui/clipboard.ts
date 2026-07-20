// Clipboard copy-with-real-auto-clear guarantee (VAULT-06, T-02-21).
// Single-active-timer discipline: only the most recent copy's clear timer
// is ever live, matching the single-system-clipboard reality — copying a
// second field cancels the first field's pending clear and starts a fresh
// one, so the clipboard is never cleared "too early" relative to what's
// actually in it right now.
export const CLIPBOARD_SECONDS_KEY = "pv-clipboard-seconds";
export const DEFAULT_CLIPBOARD_SECONDS = 40;
export const MIN_CLIPBOARD_SECONDS = 30;
export const MAX_CLIPBOARD_SECONDS = 60;

/** Clamps an arbitrary value into the documented 30-60s clipboard-clear
 * range, falling back to the default for missing/`NaN`/non-numeric input.
 * Shared by `readClipboardSeconds()` and any UI that seeds its displayed
 * value from the same localStorage key (e.g. Sidebar's slider) — both must
 * agree, otherwise a tampered/corrupted value could silently produce an
 * unbounded auto-clear timeout in one call site while the other still
 * displays a safe value. */
export function clampClipboardSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CLIPBOARD_SECONDS;
  }
  return Math.min(MAX_CLIPBOARD_SECONDS, Math.max(MIN_CLIPBOARD_SECONDS, value));
}

/** Reads the user's configured clipboard-clear duration (30-60s range,
 * default 40s per CONTEXT.md) — falls back to the default if unset or if
 * localStorage is unavailable (private browsing), and clamps any
 * corrupted/tampered/out-of-range stored value into the documented range
 * (T-02-21). */
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
 * already provides.
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
