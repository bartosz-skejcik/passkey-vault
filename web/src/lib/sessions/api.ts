// Sessions/devices API client for pv-server's /api/sessions/* routes
// (Plan 03-01/03-02). Mirrors `web/src/lib/passkeys/api.ts`'s `apiJson<T>`
// wrapper verbatim (handles non-2xx -> ApiClientError, 204 -> undefined) —
// reuses `apiFetch`/`ApiClientError` from lib/auth/api rather than
// duplicating base-URL/auth-header logic (same rule as vault/api.ts and
// passkeys/api.ts).
import { apiFetch, ApiClientError } from "@/lib/auth/api";

export interface SessionRow {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
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

export function listSessions(): Promise<SessionRow[]> {
  return apiJson("/api/sessions");
}

export function revokeSession(id: string): Promise<void> {
  return apiJson(`/api/sessions/${id}`, { method: "DELETE" });
}
