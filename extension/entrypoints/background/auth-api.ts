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

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
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

export interface PasskeyLoginStartResponse {
  state_id: string;
  challenge: unknown;
  /** KEY = URL_SAFE_NO_PAD-encoded credential id, VALUE = STANDARD-encoded PRF salt. */
  prf_salts: Record<string, string>;
}

export interface PasskeyLoginFinishResponse {
  session_token: string;
  pw_wrapped_uk: string;
  /** `null` when the matched credential isn't prf_capable. */
  prf_wrapped_uk: string | null;
}

export interface UnlockStartResponse {
  state_id: string;
  challenge: unknown;
  prf_salts: Record<string, string>;
}

export interface UnlockFinishResponse {
  prf_wrapped_uk: string | null;
}

// UNAUTHENTICATED -- the fresh-install PRF sign-in path (mints a
// session_token regardless of PRF availability, exactly like login() above).
export function passkeyLoginStart(body: { email: string }): Promise<PasskeyLoginStartResponse> {
  return apiJson("/api/auth/passkey-login/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function passkeyLoginFinish(body: {
  state_id: string;
  credential: unknown;
}): Promise<PasskeyLoginFinishResponse> {
  return apiJson("/api/auth/passkey-login/finish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// SessionUser-gated (crates/pv-server/src/routes/passkeys.rs) -- requires an
// existing valid token.
export function unlockStart(): Promise<UnlockStartResponse> {
  return apiJson("/api/passkeys/unlock/start", { method: "POST" });
}

export function unlockFinish(body: {
  state_id: string;
  credential: unknown;
}): Promise<UnlockFinishResponse> {
  return apiJson("/api/passkeys/unlock/finish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
