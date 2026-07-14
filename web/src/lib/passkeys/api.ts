// Passkey enrollment API client for pv-server's /api/passkeys/* routes
// (Plan 03-01). Reuses `apiFetch`'s base-URL/auth-header/wire-encoding
// logic from lib/auth/api rather than duplicating it — see that file's
// module comment.
//
// `challenge`/`credential`/`prf_challenge` are typed `unknown` here on
// purpose: this module is a thin wire client, not the place that
// interprets WebAuthn JSON shapes. `lib/passkeys/enroll.ts` is the one
// place that calls the native `PublicKeyCredential.parse*FromJSON`
// methods to turn these `unknown` payloads into real WebAuthn options —
// this module never touches base64url-vs-standard-base64 conversion.
import { apiFetch, ApiClientError } from "@/lib/auth/api";

export interface RegisterStartResponse {
  state_id: string;
  challenge: unknown;
  prf_salt: string;
}

export interface RegisterFinishResponse {
  passkey_id: string;
  name: string;
  prf_challenge: unknown;
  prf_state_id: string;
  prf_salt: string;
}

export interface PrfWrapResponse {
  prf_capable: true;
}

// Settings surface (AUTH-06, Plan 03-04) — list/rename/delete of already-
// enrolled passkeys. Same `apiJson<T>` wrapper as the enrollment functions
// above, reused rather than duplicated.
export interface PasskeyRow {
  id: string;
  name: string;
  prf_capable: boolean;
  created_at: string;
  last_used_at: string | null;
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

export function registerStart(body: {
  display_name: string;
}): Promise<RegisterStartResponse> {
  return apiJson("/api/passkeys/register/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function registerFinish(body: {
  state_id: string;
  credential: unknown;
}): Promise<RegisterFinishResponse> {
  return apiJson("/api/passkeys/register/finish", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function prfWrap(
  id: string,
  body: { state_id: string; credential: unknown; prf_wrapped_uk: string },
): Promise<PrfWrapResponse> {
  return apiJson(`/api/passkeys/${id}/prf-wrap`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPasskeys(): Promise<PasskeyRow[]> {
  return apiJson("/api/passkeys");
}

export function renamePasskey(id: string, name: string): Promise<void> {
  return apiJson(`/api/passkeys/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deletePasskey(id: string): Promise<void> {
  return apiJson(`/api/passkeys/${id}`, { method: "DELETE" });
}
