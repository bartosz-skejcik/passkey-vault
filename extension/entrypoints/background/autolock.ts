// entrypoints/background/autolock.ts — chrome.alarms-driven auto-lock
// (EXT-03). chrome.alarms (never setTimeout/setInterval) is the only
// sanctioned auto-lock timer mechanism: an MV3 service worker can be
// idle-killed and woken at any time, and only chrome.alarms survives that
// (09-RESEARCH.md D-03/Pitfall 3's Anti-Pattern) -- a setTimeout/
// setInterval handle is simply gone after an idle-kill, silently disabling
// the security control.
import { browser } from "wxt/browser";
import { lockVaultSession } from "./vault-session";

// Whitelist/default-value shape copied verbatim from
// web/src/lib/idle/autolock.ts, matching 09-UI-SPEC.md's popup control and
// its "Default idle timeout: 15 minutes" exactly. The timer MECHANISM
// (chrome.alarms, not setTimeout/setInterval) is the only thing that
// changed versus the v0.1 web app's version.
export const AUTOLOCK_OPTIONS = [5, 15, 30, 60] as const;
export const DEFAULT_AUTOLOCK_MINUTES = 15;

const ALARM_NAME = "pv-auto-lock";

/**
 * T-09-08: a corrupted/tampered/out-of-whitelist idle-minutes value falls
 * back to DEFAULT_AUTOLOCK_MINUTES wherever it is READ for arming --
 * matching v0.1's readAutolockMinutes() precedent. Applied here (not at
 * write time) so every caller of armAutoLock() is protected uniformly.
 */
function validateIdleMinutes(idleMinutes: number): number {
  return (AUTOLOCK_OPTIONS as readonly number[]).includes(idleMinutes)
    ? idleMinutes
    : DEFAULT_AUTOLOCK_MINUTES;
}

/**
 * Re-creating an alarm with the same name replaces the previous one
 * (Chrome's documented behavior) -- callers (noteActivity(),
 * router.ts's session.setAutoLockMinutes handler) never need to
 * browser.alarms.clear() first.
 */
export async function armAutoLock(idleMinutes: number): Promise<void> {
  await browser.alarms.create(ALARM_NAME, {
    delayInMinutes: validateIdleMinutes(idleMinutes),
  });
}

export function registerAutoLockAlarmListener(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      // wasAutoLocked=true, so session.status/09-05's popup can show the
      // "session locked after being idle" notice.
      void lockVaultSession(true);
    }
  });
}
