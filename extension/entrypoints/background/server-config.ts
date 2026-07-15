// EXT-05: the extension ships as ONE public build with no pv-server origin
// baked in at compile time -- every user points it at THEIR OWN
// self-hosted server. This module is the SOLE place extension/ reads or
// writes that base URL. Every later call site (Plan 09-04's auth-api.ts,
// Plan 09-05's vault-api.ts/sync-client.ts, Plan 09-06's "open full vault"
// tabs.create) must import readServerConfig()/wsUrlFromBase() from here --
// never re-derive, cache, or hard-code a server URL anywhere else. The
// standing grep-based test in server-config.test.ts
// (no_other_extension_file_hard_codes_a_server_url) fails loudly the
// instant a future file violates this.
import { browser } from "wxt/browser";

export class InvalidServerUrlError extends Error {}
export class ServerUnreachableError extends Error {}

export interface ServerConfig {
  /** Normalized: lowercased scheme+host, no trailing slash, http(s) only. */
  baseUrl: string;
}

// chrome.storage.LOCAL -- deliberately NOT the extension's other, SESSION-
// scoped storage area (Plan 09-02's session-storage.ts, wiped on browser
// restart). This is user-facing configuration (a server origin), not
// vault-secret material (D-01/D-02 from 09-CONTEXT.md apply to the KEY
// ENVELOPE only): it must survive a browser restart, unlike that other
// area which is deliberately wiped on restart. Do NOT "simplify" this
// later by merging the two -- that would force reconfiguration on every
// browser restart and defeats EXT-05's "persisted" requirement.
const STORAGE_KEY = "pv-server-config";

/**
 * Normalizes and validates a user-typed pv-server base URL. Only `http:`
 * and `https:` schemes are ever accepted -- this value is later handed
 * unchanged to `browser.tabs.create` by Plan 09-06/EXT-06, and an
 * unvalidated scheme there (`javascript:`, `file:`, `chrome-extension:`,
 * etc.) is a genuine injection vector (T-09-09).
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

/**
 * Probes `<baseUrl>/healthz` and resolves `true` only when a genuine
 * pv-server answered: HTTP ok AND an exact `{"status":"ok"}` JSON body
 * (T-09-10) -- a captive portal, misdirected DNS entry, or unrelated web
 * server returning 200 with a different body is rejected. Never throws --
 * any network-level failure (DNS failure, connection refused, non-JSON
 * body) resolves `false`.
 */
export async function probeServerHealth(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/healthz`);
    if (!response.ok) {
      return false;
    }
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && (body as { status?: unknown }).status === "ok";
  } catch {
    return false;
  }
}

/**
 * Validates, probes, requests the scoped runtime permission, and persists
 * a new pv-server base URL. Rejects with `InvalidServerUrlError` (no I/O
 * performed at all) or `ServerUnreachableError` (probe failed, nothing
 * persisted) before ever touching storage.
 */
export async function configureServer(rawUrl: string): Promise<ServerConfig> {
  const normalizedBaseUrl = normalizeServerUrl(rawUrl);

  const healthy = await probeServerHealth(normalizedBaseUrl);
  if (!healthy) {
    throw new ServerUnreachableError(
      `No pv-server responded at ${normalizedBaseUrl}/healthz`,
    );
  }

  // T-09-14: request exactly the single newly-configured origin, never a
  // standing <all_urls> grant. Backed by wxt.config.ts's
  // optional_host_permissions declaration (Task 2).
  await browser.permissions.request({ origins: [`${normalizedBaseUrl}/*`] });

  const config: ServerConfig = { baseUrl: normalizedBaseUrl };
  await browser.storage.local.set({ [STORAGE_KEY]: config });
  return config;
}

/** Resolves the persisted server config, or `null` if never configured. */
export async function readServerConfig(): Promise<ServerConfig | null> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  if (!value || typeof value !== "object" || typeof (value as ServerConfig).baseUrl !== "string") {
    return null;
  }
  return value as ServerConfig;
}

/**
 * Same single-leading-scheme-replace `web/src/lib/vault/sync.ts`'s
 * `wsUrl()` already uses, extracted here so Plan 09-05's sync-client.ts
 * never re-implements it.
 */
export function wsUrlFromBase(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}
