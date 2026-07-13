// Clipboard copy-with-real-auto-clear guarantee (VAULT-06, T-02-21).
// Single-active-timer discipline: only the most recent copy's clear timer
// is ever live, matching the single-system-clipboard reality — copying a
// second field cancels the first field's pending clear and starts a fresh
// one, so the clipboard is never cleared "too early" relative to what's
// actually in it right now.
export const CLIPBOARD_SECONDS_KEY = "pv-clipboard-seconds";
export const DEFAULT_CLIPBOARD_SECONDS = 40;

/** Reads the user's configured clipboard-clear duration (30-60s range,
 * default 40s per CONTEXT.md) — falls back to the default if unset or if
 * localStorage is unavailable (private browsing). */
export function readClipboardSeconds(): number {
  try {
    const stored = localStorage.getItem(CLIPBOARD_SECONDS_KEY);
    return stored !== null ? Number(stored) : DEFAULT_CLIPBOARD_SECONDS;
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
