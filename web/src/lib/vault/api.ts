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
  // NordPass-style last-used tracking (quick-260717) — `null` until the
  // item's secret has been used at least once (server column is nullable),
  // set via POST /api/vault/items/{id}/touch below.
  last_used_at: string | null;
  // Phase 23 (Plan 23-01/23-05): server-sourced sharing metadata, never
  // client-computed — is_shared true for a collection-scoped item or one
  // with an item_shares grant; last_editor_email is the current
  // last_editor_user_id's email, null when never edited since Migration
  // 0015 or when the item isn't shared at all.
  is_shared: boolean;
  last_editor_email: string | null;
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
    // The FULL parsed body (not just the extracted `message` string) is
    // carried as `details` (Plan 23-05) — this is what lets store.ts read
    // `last_editor_email` back out of a 409 response.
    let details: unknown;
    try {
      const body: unknown = await response.json();
      details = body;
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
    throw new ApiClientError(response.status, message, details);
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

/** Wire shape of GET /api/sync/shared — the per-collection revision map plus
 * a synthetic "direct" bucket (Plan 23-02's `pull_shared_revisions`). Never a
 * MAX/SUM fold across collections — one entry per collection the caller is
 * a member of. */
export interface SharedRevisions {
  collections: { id: string; revision: number }[];
  direct: { revision: number };
}

export function getSharedRevisions(): Promise<SharedRevisions> {
  return apiJson("/api/sync/shared");
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

/** `POST /api/vault/items/{id}/touch` — records "this item's secret was
 * just used" (NordPass-style last-used tracking, quick-260717). Deliberately
 * NEVER bumps revision server-side — see crates/pv-server/src/routes/
 * vault.rs's `touch()` doc comment. Callers must go through
 * `lib/vault/store.ts`'s `touchVaultItem()` fire-and-forget wrapper, never
 * call this directly from a component (single choke-point, matches every
 * other mutation in this file already going through store.ts). */
export function touchItem(id: string): Promise<{ last_used_at: string }> {
  return apiJson(`/api/vault/items/${id}/touch`, { method: "POST" });
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
