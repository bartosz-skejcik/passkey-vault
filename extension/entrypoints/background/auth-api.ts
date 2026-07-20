// entrypoints/background/auth-api.ts — server-config-aware, session-token-aware
// port of web/src/lib/auth/api.ts + web/src/lib/passkeys/api.ts's SessionUser-
// gated unlock pair AND unauthenticated passkey-login pair. `register` is the
// only thing NOT ported (account creation stays web-app-only per
// 09-CONTEXT.md's boundary) -- `login`/`passkeyLoginStart`/`passkeyLoginFinish`
// ARE needed: they are the extension's only way to mint a session token, since
// `unlockStart`/`unlockFinish` are `SessionUser`-gated in
// `crates/pv-server/src/routes/passkeys.rs` and reject an unauthenticated
// caller outright.
//
// Two required changes from the web version (wire contract itself is
// byte-identical, only where the base URL/auth header come from differs):
//   1. Base URL comes from readServerConfig() (Plan 09-03), not a compiled-in
//      env var. A caller invoked before the user has configured a server is a
//      programmer error, not a network failure -- it throws
//      ServerNotConfiguredError distinctly rather than fetching `undefined/...`.
//   2. The Authorization header reads getSessionToken() (Plan 09-02's
//      session-storage.ts, async) instead of a synchronous localStorage read.
//      `login`/`passkeyLoginStart`/`passkeyLoginFinish` are called BEFORE any
//      token exists, so their requests naturally carry no Authorization header
//      (same `token !== null` guard as the web version -- no special-casing
//      needed).
// Plan 09-05 reuses apiFetch/ApiClientError/ServerNotConfiguredError below
// for vault-api.ts's read-path sync-snapshot fetch -- same "export the base
// helpers so a sibling API client doesn't duplicate the base-URL/auth-
// header logic" relationship web/src/lib/auth/api.ts has with
// web/src/lib/vault/api.ts (see that file's own header comment).
import { readServerConfig } from "./server-config";
import { getSessionToken } from "./session-storage";

/** Thrown when no pv-server has been configured yet (Plan 09-03) -- a caller bug, not a network failure. */
export class ServerNotConfiguredError extends Error {}

export class ApiClientError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

/** Encodes raw bytes to a base64 string (browser btoa, no Buffer dependency). */
export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decodes a base64 string back to raw bytes (browser atob, no Buffer dependency). */
export function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Prefixes the configured server's base URL, sets Content-Type when a body
 * is present, and adds a Bearer Authorization header when a session token
 * is stored. Exported (not just this file's own wrappers below) so Plan
 * 09-05's vault-api.ts can reuse this exact base-URL/auth-header logic.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = await readServerConfig();
  if (config === null) {
    throw new ServerNotConfiguredError(
      "No pv-server has been configured yet -- call configureServer() first",
    );
  }

  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const token = await getSessionToken();
  if (token !== null) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${config.baseUrl}${path}`, { ...init, headers });
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      // response body wasn't JSON (or was empty) -- fall back to statusText
    }
    throw new ApiClientError(response.status, message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export type KdfParams = {
  m_cost_kib: number;
  t_cost: number;
  p_cost: number;
};

export function prelogin(email: string): Promise<{ kdf: KdfParams; salt: string }> {
  return apiJson("/api/auth/prelogin", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function me(): Promise<{ user_id: string; email: string; pw_wrapped_uk: string }> {
  return apiJson("/api/auth/me", { method: "GET" });
}

// AUTH-04: the first client code path to ever call this pre-existing,
// previously-unused server route (crates/pv-server/src/routes/auth.rs's
// `logout` handler, SessionUser-gated, deletes the session row by
// token_hash, returns 204). `apiJson`'s existing 204-handling (above)
// already resolves this to `undefined` with no changes needed here.
// Called by signOutVaultSession() (./vault-session.ts) as a best-effort
// step BEFORE local state is cleared -- see that function's own comment
// for the full ordering rationale.
export function logout(): Promise<void> {
  return apiJson("/api/auth/logout", { method: "POST" });
}

// UNAUTHENTICATED -- the only thing that mints a bearer token; register() is
// NOT ported (account creation stays web-app-only per CONTEXT.md).
export function login(body: {
  email: string;
  auth_hash: string;
}): Promise<{ session_token: string; pw_wrapped_uk: string }> {
  return apiJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// WR-08 (09-REVIEW.md): the web-RP PRF transport (passkeyLoginStart/Finish,
// unlockStart/Finish + their response types) is DELETED along with the
// handlers that were its only callers -- a chrome-extension:// popup cannot
// run a web-RP WebAuthn ceremony at all (SecurityError), so this transport
// was unreachable by construction. See lib/messaging/ext-protocol.ts's
// header for the full rationale. The extension-scoped PRF recipient's own
// transport is below.

// --- Extension-scoped PRF passkey blob CRUD (Plan 09-08, 09-CONTEXT
// AMENDMENT 2026-07-15). SessionUser-gated server-side
// (crates/pv-server/src/routes/extension_passkeys.rs) -- requires an
// existing valid token, consistent with UNLOCK-ONLY: no unauthenticated
// variant exists or is needed. `credential_id`/`prf_salt` are already
// base64url/base64-encoded strings on the wire; this file never decodes
// them -- it is a thin transport layer, same as every other export in
// this file.

export interface ExtensionPasskeyRow {
  /** base64url (URL_SAFE_NO_PAD). */
  credential_id: string;
  /** base64 (STANDARD) — public PRF salt, not secret. */
  prf_salt: string;
  /** Opaque `WrappedKey`-shaped JSON — never parsed here or server-side. */
  prf_wrapped_uk: string;
  created_at: string;
}

export function createExtensionPasskey(body: {
  credential_id: string;
  prf_salt: string;
  prf_wrapped_uk: string;
}): Promise<{ id: string }> {
  return apiJson("/api/extension-passkeys", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listExtensionPasskeys(): Promise<ExtensionPasskeyRow[]> {
  return apiJson("/api/extension-passkeys", { method: "GET" });
}
