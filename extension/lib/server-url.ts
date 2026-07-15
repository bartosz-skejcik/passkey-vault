// lib/server-url.ts — pure URL normalization/validation for the user's
// pv-server base URL (EXT-05). Extracted from
// entrypoints/background/server-config.ts so BOTH contexts can use it:
// the popup needs the normalized origin to call
// `browser.permissions.request()` INSIDE the submit click's user gesture
// (Chrome rejects that call from a service-worker message handler with
// "This function must be called during a user gesture" — found by the
// real-browser Phase 9 UAT; unit tests with a mocked `permissions` were
// blind to it), while the background still normalizes defensively before
// probing/persisting. This module is pure — no browser APIs, no crypto,
// no storage — so importing it from the popup does not violate D-05.

export class InvalidServerUrlError extends Error {}

/**
 * Normalizes and validates a user-typed pv-server base URL. Only `http:`
 * and `https:` schemes are ever accepted -- this value is later handed
 * unchanged to `browser.tabs.create` (EXT-06), and an unvalidated scheme
 * there (`javascript:`, `file:`, `chrome-extension:`, etc.) is a genuine
 * injection vector (T-09-09).
 */
export function normalizeServerUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidServerUrlError(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidServerUrlError(
      `Unsupported scheme "${url.protocol}" -- only http/https are accepted`,
    );
  }

  // Rebuild from protocol+host only -- drops any trailing slash/path/query
  // the user pasted in by accident. This extension only ever needs the
  // origin.
  return `${url.protocol}//${url.host}`;
}
