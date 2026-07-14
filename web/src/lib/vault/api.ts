// Vault items/folders API client for pv-server's /api/vault/* routes
// (Plan 02-03). Reuses `apiFetch`'s base-URL/auth-header/wire-encoding
// logic from lib/auth/api rather than duplicating it — see that file's
// module comment.
import { apiFetch, ApiClientError } from "@/lib/auth/api";

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
      // response body wasn't JSON (or was empty) — fall back to statusText
    }
    throw new ApiClientError(response.status, message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Wire shape of GET /api/sync?since=N — a cheap `{revision}` body when the
 * caller is already up to date, or a full `{revision, items, folders}`
 * snapshot when stale (Plan 05-01's revision-gated pull contract). */
export interface SyncSnapshot {
  revision: number;
  items?: ItemRow[];
  folders?: FolderRow[];
}

export function getSyncSnapshot(since: number): Promise<SyncSnapshot> {
  return apiJson(`/api/sync?since=${since}`);
}

export function listItems(): Promise<ItemRow[]> {
  return apiJson("/api/vault/items");
}

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

export function deleteItem(id: string): Promise<void> {
  return apiJson(`/api/vault/items/${id}`, { method: "DELETE" });
}

export function listFolders(): Promise<FolderRow[]> {
  return apiJson("/api/vault/folders");
}

export function createFolder(encName: string): Promise<{ id: string }> {
  return apiJson("/api/vault/folders", {
    method: "POST",
    body: JSON.stringify({ enc_name: encName }),
  });
}

export function deleteFolder(id: string): Promise<void> {
  return apiJson(`/api/vault/folders/${id}`, { method: "DELETE" });
}
