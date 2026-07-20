// lib/autofill/blocked-origins.ts — persisted "user blocked the in-page
// autofill prompt on this origin" store, consumed by Group B's in-page
// dismiss-permanently affordance (content-relay.content.ts's overlay).
//
// This module runs in the ISOLATED content-script world (same context as
// content-relay.content.ts, lib/autofill/inpage-overlay.ts), NOT the
// background service worker -- so it imports `browser` from `wxt/browser`
// directly (the same choke-point-free storage access content-relay.
// content.ts and inpage-overlay.ts already use) rather than routing
// through a background message. `storage.local` is already declared in
// the manifest -- no new permission needed.
//
// Storage shape: one storage.local key holding a plain string[] (Sets
// aren't structured-cloneable through chrome.storage), rehydrated into a
// Set on read for O(1) membership checks.
//
// Deliberately crypto-free: an origin string is not key material and never
// touches pv-wasm or any decrypt/derive path.
import { browser } from "wxt/browser";

export const BLOCKED_ORIGINS_KEY = "pv:autofill:blocked-origins";

async function readBlockedOriginsArray(): Promise<string[]> {
  const result = await browser.storage.local.get(BLOCKED_ORIGINS_KEY);
  const stored = result[BLOCKED_ORIGINS_KEY];
  return Array.isArray(stored) ? (stored as string[]) : [];
}

/** Reads the full blocked-origins set. Missing/corrupt storage reads as
 * empty -- fails open to "not blocked" rather than throwing, matching this
 * module's read-heavy call site (every content-relay focus/mount check). */
export async function readBlockedOrigins(): Promise<Set<string>> {
  return new Set(await readBlockedOriginsArray());
}

/** Idempotent -- adding an already-blocked origin is a no-op write. */
export async function addBlockedOrigin(origin: string): Promise<void> {
  const current = await readBlockedOriginsArray();
  if (current.includes(origin)) {
    return;
  }
  await browser.storage.local.set({ [BLOCKED_ORIGINS_KEY]: [...current, origin] });
}

export async function isOriginBlocked(origin: string): Promise<boolean> {
  const blocked = await readBlockedOrigins();
  return blocked.has(origin);
}
