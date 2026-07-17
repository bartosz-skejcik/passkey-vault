// entrypoints/background/vault-api.ts — port of web/src/lib/vault/api.ts,
// reusing auth-api.ts's apiFetch/ApiClientError (base-URL/auth-header/
// wire-encoding logic) rather than duplicating it -- the exact same reuse
// relationship web/src/lib/vault/api.ts has with web/src/lib/auth/api.ts
// (see that file's own header comment). This gives getSyncSnapshot() the
// same ServerNotConfiguredError-on-null discipline and
// getSessionToken()-derived Authorization header as Plan 09-04's
// auth-api.ts, with zero duplicated fetch/base-URL logic.
//
// CONTEXT.md's locked OUT-of-scope boundary from Phase 9 covered only the
// read path (getSyncSnapshot). Plan 11-03 adds the write path
// (createItem/updateItem) this file was missing -- required for Generate &
// Capture's encrypt-then-persist flow (capture-handler.ts). Folder
// list/create/delete and item delete remain out of scope; only what
// capture-handler.ts's confirmNewLogin/confirmUpdateLogin actually need is
// ported here, verbatim from web/src/lib/vault/api.ts's template (same
// request/response shapes, same apiFetch/ApiClientError reuse).
import { apiFetch, ApiClientError } from "./auth-api";

/** Wire shape of a single item row as returned by GET /api/vault/items. */
export interface ItemRow {
  id: string;
  enc_key: string;
  enc_data: string;
  revision: number;
  updated_at: string;
  // NordPass-style last-used tracking (quick-260717, ported from
  // web/src/lib/vault/api.ts) -- `null` until the item's secret has been
  // used at least once (server column is nullable), set via
  // POST /api/vault/items/{id}/touch below.
  last_used_at: string | null;
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

// Plan 11-03: ported verbatim from web/src/lib/vault/api.ts's
// createItem/updateItem -- same request/response shapes, reusing this
// file's own apiFetch/ApiClientError import, not a new fetch wrapper.
export function createItem(
  id: string,
  encKey: string,
  encData: string,
): Promise<{ id: string; revision: number; updated_at: string }> {
  return apiJson("/api/vault/items", {
    method: "POST",
    body: JSON.stringify({ id, enc_key: encKey, enc_data: encData }),
  });
}

export function updateItem(
  id: string,
  encKey: string,
  encData: string,
  expectedRevision: number,
): Promise<{ revision: number; updated_at: string }> {
  return apiJson(`/api/vault/items/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      enc_key: encKey,
      enc_data: encData,
      expected_revision: expectedRevision,
    }),
  });
}

/** `POST /api/vault/items/{id}/touch` -- records "this item's secret was
 * just used" (NordPass-style last-used tracking, quick-260717). Deliberately
 * NEVER bumps revision server-side -- see crates/pv-server/src/routes/
 * vault.rs's `touch()` doc comment. Callers must go through vault-store.ts's
 * `touchVaultItem()` fire-and-forget wrapper, never call this directly from
 * a fill handler/ceremony/popup message. */
export function touchItem(id: string): Promise<{ last_used_at: string }> {
  return apiJson(`/api/vault/items/${id}/touch`, { method: "POST" });
}
