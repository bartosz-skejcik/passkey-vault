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
import { InvalidServerUrlError, normalizeServerUrl } from "../../lib/server-url";

// Re-exported so existing importers/tests keep working after the pure
// normalization logic moved to lib/server-url.ts (shared with the popup —
// see that file's header for the user-gesture rationale).
export { InvalidServerUrlError, normalizeServerUrl };
export class ServerUnreachableError extends Error {}
// D-11 (13-05-PLAN.md): thrown instead of ServerUnreachableError when the
// server answered (TCP/TLS connection succeeds) but rejected this
// extension's origin at the CORS layer -- distinct from a genuinely
// unreachable server so ServerConfigView can render an actionable message
// naming PV_EXTENSION_ORIGINS instead of a dead-end "can't reach that
// server" for a Firefox self-hoster who hasn't allowlisted their
// moz-extension://<uuid> origin yet.
export class ServerCorsBlockedError extends Error {}

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

export type HealthProbeResult = "ok" | "cors-blocked" | "unreachable";

/**
 * D-11 (13-05-PLAN.md): a detailed sibling of `probeServerHealth` that
 * distinguishes a CORS-blocked-but-reachable server from a genuinely
 * unreachable one. The plain `fetch(`${baseUrl}/healthz`)` above cannot
 * make this distinction on its own -- a CORS rejection surfaces as the
 * exact same opaque `TypeError` a DNS failure or connection-refused error
 * would, with no inspectable status/headers.
 *
 * The disambiguation trick: retry with `{ mode: "no-cors" }`. A no-cors
 * request still requires the browser to actually open the TCP/TLS
 * connection and get a response -- it just refuses to expose the response
 * body/headers to script, resolving with an opaque `Response` whose
 * `type === "opaque"`. So:
 *   - First fetch throws, no-cors retry resolves opaque -> the server IS
 *     up, it just didn't CORS-allowlist this origin -> "cors-blocked".
 *   - First fetch throws, no-cors retry ALSO throws -> the server truly
 *     isn't reachable (DNS/connection-refused) -> "unreachable".
 *   - First fetch resolves (whether or not it's the exact {status:"ok"}
 *     body `probeServerHealth` requires) -> not a CORS story at all;
 *     treated as "ok"/"unreachable" the same way `probeServerHealth` does.
 */
export async function probeServerHealthDetailed(baseUrl: string): Promise<HealthProbeResult> {
  try {
    const response = await fetch(`${baseUrl}/healthz`);
    if (!response.ok) {
      return "unreachable";
    }
    const body: unknown = await response.json();
    const ok =
      typeof body === "object" && body !== null && (body as { status?: unknown }).status === "ok";
    return ok ? "ok" : "unreachable";
  } catch {
    try {
      const opaque = await fetch(`${baseUrl}/healthz`, { mode: "no-cors" });
      return opaque.type === "opaque" ? "cors-blocked" : "unreachable";
    } catch {
      return "unreachable";
    }
  }
}

/**
 * Validates, probes, and persists a new pv-server base URL. Rejects with
 * `InvalidServerUrlError` (no I/O performed at all) or
 * `ServerUnreachableError` (probe failed, nothing persisted) before ever
 * touching storage.
 *
 * NOTE — the T-09-14 runtime host-permission grant deliberately does NOT
 * happen here anymore. `browser.permissions.request()` must run during a
 * user gesture, and the popup's submit click does NOT propagate through
 * the sendMessage boundary into this service worker — Chrome rejects the
 * call here with "This function must be called during a user gesture"
 * (observed in the real-browser Phase 9 UAT; the previous generic catch
 * then mislabeled every successful probe as "unreachable"). The POPUP
 * (ServerConfigView) now requests the grant inside the click handler,
 * BEFORE dispatching config.set. The probe below still works pre-grant
 * against a conforming pv-server because the server allowlists the
 * extension origin for CORS (EXT-05) — the host permission is the
 * belt-and-braces layer for proxies that strip CORS headers.
 */
export async function configureServer(rawUrl: string): Promise<ServerConfig> {
  const normalizedBaseUrl = normalizeServerUrl(rawUrl);

  const probeResult = await probeServerHealthDetailed(normalizedBaseUrl);
  if (probeResult === "cors-blocked") {
    throw new ServerCorsBlockedError(
      `pv-server at ${normalizedBaseUrl} answered but rejected this extension's origin (CORS)`,
    );
  }
  if (probeResult !== "ok") {
    throw new ServerUnreachableError(
      `No pv-server responded at ${normalizedBaseUrl}/healthz`,
    );
  }

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
