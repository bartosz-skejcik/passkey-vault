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

// Plan 27-03 (Task 2): collections-store.ts's own listCollections() client
// -- ported verbatim from web/src/lib/vault/api.ts's CollectionRow/
// listCollections (field-for-field identical wire shape, same apiJson reuse
// relationship as every other client in this file). No client for
// GET /api/vault/collections existed anywhere in the extension before this
// plan; the module cannot function without it.
export interface CollectionRow {
  id: string;
  enc_name: string;
  created_at: string;
  access_level: string | null;
  sealed_key: string | null;
}

/** `GET /api/vault/collections` -- every collection the caller currently
 * holds a `collection_keys` row for (`collections.rs::list`). */
export function listCollections(): Promise<CollectionRow[]> {
  return apiJson("/api/vault/collections");
}

// Plan 27-03 (Task 3): identity keypair endpoints -- ported verbatim from
// web/src/lib/identity/api.ts, wire-identical to identity.rs's
// KeypairRequest/KeypairResponse, reusing this file's own apiJson (never a
// duplicated fetch wrapper).

/** Wire shape of `identity.rs`'s `KeypairResponse` -- matches
 * `KeypairRequest`/`KeypairResponse` field-for-field. */
export interface KeypairRow {
  public_key: string;
  wrapped_secret_key: string;
  adopted_existing: boolean;
}

/**
 * `GET /api/identity/keypair` -- returns `null` on a 404 (no keypair
 * published yet), which is an expected, non-error outcome here, not a
 * thrown `ApiClientError`.
 */
export async function getIdentityKeypair(): Promise<{
  public_key: string;
  wrapped_secret_key: string;
} | null> {
  try {
    return await apiJson<{ public_key: string; wrapped_secret_key: string }>(
      "/api/identity/keypair",
    );
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) {
      return null;
    }
    throw e;
  }
}

/** `PUT /api/identity/keypair` -- idempotent upsert (see `identity.rs`'s
 * own doc comment for the two-devices-racing resolution this powers). */
export function putIdentityKeypair(body: {
  public_key: string;
  wrapped_secret_key: string;
}): Promise<KeypairRow> {
  return apiJson("/api/identity/keypair", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
