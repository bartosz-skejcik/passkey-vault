// Auth API client for pv-server's /api/auth/* routes (Plan 02-02). Also
// exports the base apiFetch/base64 helpers so Plan 02-05's lib/vault/api.ts
// can reuse the same base-URL/auth-header/wire-encoding logic rather than
// duplicating it.
import { getSessionToken } from "./session";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

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

export class ApiClientError extends Error {
  status: number;
  // Full parsed JSON error body (Plan 23-05), when the non-ok response's
  // body actually parsed as JSON — `undefined` when omitted (every existing
  // `new ApiClientError(status, message)` two-arg call site keeps
  // compiling unchanged) or when the body wasn't JSON/was empty. Lets
  // callers (lib/vault/store.ts) read fields beyond the extracted `message`
  // string, e.g. a 409 body's `last_editor_email`.
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Prefixes API_BASE, sets Content-Type when a body is present, and adds a
 * Bearer Authorization header when a session token is stored. Exported
 * (not just the auth-specific wrappers below) for reuse by other API
 * clients.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const token = getSessionToken();
  if (token !== null) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
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
      // response body wasn't JSON (or was empty) — fall back to statusText
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

export function register(body: {
  email: string;
  kdf: KdfParams;
  salt: string;
  auth_hash: string;
  pw_wrapped_uk: string;
}): Promise<{ user_id: string }> {
  return apiJson("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function login(body: {
  email: string;
  auth_hash: string;
}): Promise<{ session_token: string; pw_wrapped_uk: string }> {
  return apiJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function logout(): Promise<void> {
  return apiJson("/api/auth/logout", { method: "POST" });
}

export function me(): Promise<{ user_id: string; email: string; pw_wrapped_uk: string }> {
  return apiJson("/api/auth/me", { method: "GET" });
}
