// Families API client for pv-server's /api/families/* routes
// (crates/pv-server/src/routes/families.rs, Phase 22). Thin apiJson
// wrappers, field names matching families.rs's request/response structs
// exactly. Added by Plan 24-07 (Rule 3 auto-fix — FamilyTab.tsx needs to
// detect "no family yet" via GET /api/families/members returning 404 and
// needs to create the family on first use, but no client function for
// either endpoint existed anywhere in web/src before this plan, despite
// both endpoints being live since Phase 22's migration 0014).
import { apiJson, ApiClientError } from "@/lib/auth/api";

export interface FamilyRecord {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

export interface FamilyMemberRecord {
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
  public_key: string | null;
  fingerprint: string | null;
  verified_at: string | null;
}

/** `POST /api/families` — creates the (singleton, v0.4) family and makes the
 * caller its owner. A second call (family already exists) throws an
 * `ApiClientError` with `status === 409` — never a silent duplicate, never a
 * second success (families.rs's own doc comment: this also covers the
 * client-retry-after-a-dropped-response edge). */
export function createFamily(name: string): Promise<FamilyRecord> {
  return apiJson("/api/families", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** `GET /api/families/members` — returns `null` for a 404 (the caller isn't
 * a family member yet — the exact bootstrap-mode signal `FamilyTab` needs),
 * mirroring `lib/identity/api.ts`'s `getIdentityKeypair` 404-as-null
 * convention: wraps the shared `apiJson` (WR-11's ONE non-ok-status parsing
 * implementation) with a catch, rather than duplicating `apiFetch`'s own
 * body-parsing inline. */
export async function getFamilyMembers(): Promise<FamilyMemberRecord[] | null> {
  try {
    return await apiJson<FamilyMemberRecord[]>("/api/families/members", { method: "GET" });
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      return null;
    }
    throw err;
  }
}
