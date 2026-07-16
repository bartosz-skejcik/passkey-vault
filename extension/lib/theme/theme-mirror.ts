// lib/theme/theme-mirror.ts — D-12's theme-mirror pipeline (plan 11-07,
// Task 2). "Extension looks like MY frontend" is made mechanically true by
// having the extension MIRROR the user's own web app's theme, rather than
// hardcoding one:
//
//   captureThemeFromWebApp(doc) — content-relay.content.ts calls this ONLY
//   on the user's own configured pv-server web app (the SAME
//   isConfiguredServerOrigin() gate that already suppresses the autofill
//   overlay there, per D-12's "capture is the one job the content script
//   keeps on the vault app" directive). Reads `html[data-theme]`,
//   enum-validates it (T-11-30 -- the mirror carries one of two constant
//   strings, never markup/CSS), persists to chrome.storage.local, and
//   keeps the mirror live via a MutationObserver on that attribute (the
//   web app flips it in place on a theme toggle -- no page reload -- see
//   web/src/app/layout.tsx's themeInitScript).
//
//   resolveTheme() — the SAME fallback order as that themeInitScript:
//   mirror -> matchMedia('prefers-color-scheme: light') -> 'vault-dark'.
//   Consumed by the popup (main.tsx) and, in plan 11-08, the in-page
//   shadow-DOM surfaces.
//
//   watchMirroredTheme(cb) — a chrome.storage.onChanged subscription
//   (with detach) so a mounted surface re-stamps its own theme live, the
//   instant the mirror changes, without a popup reopen/reload.
//
// Deliberately storage-only, no new message-passing protocol: a content
// script can already write chrome.storage.local directly (the SAME
// choke-point-free convention lib/autofill/blocked-origins.ts and this
// file's own isConfiguredServerOrigin() already use), so no new message
// kind is needed in lib/messaging/ext-protocol.ts for this feature.
import { browser } from "wxt/browser";

export type Theme = "vault-dark" | "vault-light";

export const THEME_MIRROR_KEY = "pv-theme-mirror";

const VALID_THEMES: readonly Theme[] = ["vault-dark", "vault-light"];

function isValidTheme(value: unknown): value is Theme {
  return typeof value === "string" && (VALID_THEMES as readonly string[]).includes(value);
}

async function persistMirroredTheme(theme: Theme): Promise<void> {
  await browser.storage.local.set({ [THEME_MIRROR_KEY]: theme });
}

/**
 * Reads `doc.documentElement`'s current `data-theme` and, if (and only if)
 * it enum-validates (T-11-30), persists it to the mirror. An invalid or
 * missing attribute is simply NOT written -- the mirror stays at its
 * last-known-good value (or unset, falling through resolveTheme()'s own
 * chain) rather than ever writing a bad value.
 */
function captureOnce(doc: Document): void {
  const current = doc.documentElement.getAttribute("data-theme");
  if (isValidTheme(current)) {
    void persistMirroredTheme(current);
  }
}

/**
 * Captures the CURRENT theme immediately, then keeps the mirror live via a
 * MutationObserver on `<html data-theme>` -- a one-shot read alone would go
 * stale for the rest of the tab's session the moment the user toggles
 * theme in-app. Returns a detach function; content-relay.content.ts's own
 * usage never needs to call it (the observer's lifetime is the content
 * script instance's own lifetime), but every "start watching something"
 * function in this codebase returns a symmetrical detach handle (see
 * watchMirroredTheme() below) so this stays testable and consistent.
 */
export function captureThemeFromWebApp(doc: Document): () => void {
  captureOnce(doc);

  const observer = new MutationObserver(() => {
    captureOnce(doc);
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  return () => observer.disconnect();
}

/**
 * Resolves the theme to actually render, in the SAME fallback order as
 * web/src/app/layout.tsx's own themeInitScript: mirror -> matchMedia
 * ('prefers-color-scheme: light') -> 'vault-dark'. An invalid/corrupt
 * mirror value (T-11-30) falls through exactly like a missing one -- the
 * mirror is data, never code, so a bad value can only ever pick the wrong
 * (but still enum-bounded, cosmetic-only) theme, never anything worse.
 */
export async function resolveTheme(): Promise<Theme> {
  const result = await browser.storage.local.get(THEME_MIRROR_KEY);
  const mirrored = result[THEME_MIRROR_KEY];
  if (isValidTheme(mirrored)) {
    return mirrored;
  }

  if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches) {
    return "vault-light";
  }

  return "vault-dark";
}

/**
 * Subscribes to chrome.storage.onChanged for the mirror key ONLY (ignores
 * every other storage key and every non-"local" storage area) and invokes
 * `cb` with the new theme whenever it changes to a valid value -- an
 * invalid new value (T-11-30) is dropped, never forwarded. Returns a
 * detach function so a consumer (main.tsx) can unsubscribe on unmount.
 */
export function watchMirroredTheme(cb: (theme: Theme) => void): () => void {
  function handleChange(
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ): void {
    if (areaName !== "local") {
      return;
    }
    const change = changes[THEME_MIRROR_KEY];
    if (!change || !isValidTheme(change.newValue)) {
      return;
    }
    cb(change.newValue);
  }

  browser.storage.onChanged.addListener(handleChange);
  return () => browser.storage.onChanged.removeListener(handleChange);
}
