// Single source of truth for the auto-lock timeout localStorage contract.
// Both Sidebar.tsx (the settings dropdown that writes/displays the value)
// and page.tsx (the useIdleTimer call site that actually arms the timer)
// must read through readAutolockMinutes() so a corrupted/tampered/future
// out-of-whitelist value can never silently produce an unbounded auto-lock
// timeout in one call site while the other still shows a safe default.
export const AUTOLOCK_MINUTES_KEY = "pv-autolock-minutes";
export const AUTOLOCK_CHANGED_EVENT = "pv-autolock-changed";
export const AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60];
export const DEFAULT_AUTOLOCK_MINUTES = "15";

/**
 * Reads `pv-autolock-minutes` from localStorage, validated against the
 * `AUTOLOCK_OPTIONS` whitelist. Any missing, corrupted, `NaN`, or
 * out-of-whitelist value falls back to `DEFAULT_AUTOLOCK_MINUTES` — this
 * mirrors the security control's own displayed options, so the real timer
 * (page.tsx) and the settings UI (Sidebar.tsx) can never disagree.
 */
export function readAutolockMinutes(): number {
  try {
    const stored = localStorage.getItem(AUTOLOCK_MINUTES_KEY);
    if (stored !== null && AUTOLOCK_OPTIONS.includes(Number(stored))) {
      return Number(stored);
    }
    return Number(DEFAULT_AUTOLOCK_MINUTES);
  } catch {
    return Number(DEFAULT_AUTOLOCK_MINUTES);
  }
}
