// entrypoints/background/vault-api.ts — read-path-only port of
// web/src/lib/vault/api.ts, reusing auth-api.ts's apiFetch/ApiClientError
// (base-URL/auth-header/wire-encoding logic) rather than duplicating it --
// the exact same reuse relationship web/src/lib/vault/api.ts has with
// web/src/lib/auth/api.ts (see that file's own header comment). This gives
// getSyncSnapshot() the same ServerNotConfiguredError-on-null discipline
// and getSessionToken()-derived Authorization header as Plan 09-04's
// auth-api.ts, with zero duplicated fetch/base-URL logic.
//
// CONTEXT.md's locked OUT-of-scope boundary: only the read path
// (getSyncSnapshot) is ported this phase. The write-path helpers from
// web/src/lib/vault/api.ts (list/create/update/delete, for both items and
// folders) are deliberately NOT ported -- CRUD is out of scope until a
// future phase re-enables it; porting them now would be dead code an
// executor might be tempted to wire up prematurely.
import { apiFetch, ApiClientError } from "./auth-api";

/** Wire shape of a single item row as returned by GET /api/vault/items. */
export interface ItemRow {
  id: string;
  enc_key: string;
  enc_data: string;
  revision: number;
  updated_at: string;
}

/** Wire shape of a single folder row as returned by GET /api/vault/folders. */
export interface FolderRow {
  id: string;
  enc_name: string;
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

/** Wire shape of GET /api/sync?since=N -- a cheap `{revision}` body when the
 * caller is already up to date, or a full `{revision, items, folders}`
 * snapshot when stale (v0.1's revision-gated pull contract, unchanged --
 * D-07, no new server endpoints). */
export interface SyncSnapshot {
  revision: number;
  items?: ItemRow[];
  folders?: FolderRow[];
}

export function getSyncSnapshot(since: number): Promise<SyncSnapshot> {
  return apiJson(`/api/sync?since=${since}`);
}
