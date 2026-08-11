// Families API client for pv-server's /api/families/* routes
// (crates/pv-server/src/routes/families.rs, Phase 22). Thin apiJson
// wrappers, field names matching families.rs's request/response structs
// exactly. Added by Plan 24-07 (Rule 3 auto-fix — FamilyTab.tsx needs to
// detect "no family yet" via GET /api/families/members returning 404 and
// needs to create the family on first use, but no client function for
// either endpoint existed anywhere in web/src before this plan, despite
// both endpoints being live since Phase 22's migration 0014).
//
// WR-16 (code review, Phase 25): every `{...}` path segment below is wrapped
// in `encodeURIComponent`. The ids are server-generated UUIDs today, so this
// was not exploitable — but nothing in these signatures says so, and a future
// caller passing an email or any user-supplied identifier would otherwise get
// path traversal / route confusion for free. Query strings and request bodies
// are unaffected; this is strictly about the path.
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
  // Plan 25-04's server-side addition (families.rs::members) — mirrored here
  // so the client has somewhere to land the value; Plan 25-08's suspended
  // badge/banner reads this field.
  status: string;
}

/** One recipient's freshly-sealed Collection Key, wire shape for
 * `DELETE /api/families/members/{user_id}`'s request body (Plan 25-03's
 * `apply_member_removal_rekey`). */
export interface NewSealedKeyEntry {
  recipient_user_id: string;
  sealed_key: string;
}

/** One item's re-wrapped Cipher Key, same wire shape's `item_rewraps` array. */
export interface ItemRewrapEntry {
  item_id: string;
  enc_key: string;
}

/** One collection's full re-key batch — `families/rekey.ts`'s
 * `buildMemberRemovalBatch` assembles one of these per collection the
 * removed member could reach. */
export interface CollectionRekeyBatch {
  collection_id: string;
  new_sealed_keys: NewSealedKeyEntry[];
  item_rewraps: ItemRewrapEntry[];
}

/** Wire shape of `GET /api/families/members/{user_id}/access` (Phase 22,
 * `families.rs`) — the target member's full access breakdown, the exact
 * scope `buildMemberRemovalBatch` must re-key. */
export interface MemberAccessResponse {
  collections: { id: string; access_level: string }[];
  item_shares: { item_id: string; access_level: string }[];
}

/** `POST /api/families/members/{user_id}/suspend` — owner-only, reversible;
 * see `families.rs`'s `suspend_member` (Plan 25-04). */
export function suspendMember(userId: string): Promise<void> {
  return apiJson(`/api/families/members/${encodeURIComponent(userId)}/suspend`, { method: "POST" });
}

/** `POST /api/families/members/{user_id}/reinstate` — owner-only, undoes
 * `suspendMember`; see `families.rs`'s `reinstate_member` (Plan 25-04). */
export function reinstateMember(userId: string): Promise<void> {
  return apiJson(`/api/families/members/${encodeURIComponent(userId)}/reinstate`, { method: "POST" });
}

/** `DELETE /api/families/members/{user_id}` — owner-only atomic member
 * removal + re-key; `collections` is the caller-constructed batch from
 * `families/rekey.ts`'s `buildMemberRemovalBatch` (Plan 25-03's
 * `remove_member`/`apply_member_removal_rekey`). */
export function removeMember(userId: string, collections: CollectionRekeyBatch[]): Promise<void> {
  return apiJson(`/api/families/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    body: JSON.stringify({ collections }),
  });
}

/** `GET /api/families/members/{user_id}/access` — the target member's full
 * access breakdown (Phase 22), consumed by both the Remove-member dialog's
 * honesty disclosure (Plan 25-08) and `buildMemberRemovalBatch`. */
export function getMemberAccess(userId: string): Promise<MemberAccessResponse> {
  return apiJson(`/api/families/members/${encodeURIComponent(userId)}/access`);
}

/** `GET /api/families` — the caller's own family record (Phase 22's
 * `families.rs::get`); the existing `FamilyRecord` interface above already
 * matches this response shape field-for-field. */
export function getFamily(): Promise<FamilyRecord> {
  return apiJson("/api/families");
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

/** Wire shape of `GET /api/families/family-wide-pending`'s `missing` array
 * entries -- a family-wide collection the caller lacks a `collection_keys`
 * row for. Mirrors `families.rs`'s `PendingGrant` field-for-field (30-02):
 * ids/kind only, no field capable of carrying `enc_name`/`sealed_key`. */
export interface PendingGrant {
  collection_id: string;
  kind: string;
}

/** Wire shape of the same response's `resealable` array entries -- an
 * (already-keyholder caller, active member lacking a key) pairing the
 * caller could reseal. Mirrors `families.rs`'s `ResealableGrant`
 * field-for-field (30-02): ids only. */
export interface ResealableGrant {
  collection_id: string;
  recipient_user_id: string;
}

/** Mirrors `families.rs`'s `FamilyWidePendingResponse` field-for-field. */
export interface FamilyWidePendingResponse {
  missing: PendingGrant[];
  resealable: ResealableGrant[];
}

/** `GET /api/families/family-wide-pending` -- FSH-02/FSH-05's narrow,
 * additive discovery endpoint (30-02, 30-DECISION-FSH-02.md). Fail-safe by
 * design: this is background sync data (30-06-PLAN.md's own behavior
 * contract, consumed from `sync.ts`'s pull cycle), so ANY thrown error --
 * network failure, 403 for a suspended member, 404 for a no-family account
 * -- resolves to the empty-arrays shape instead of rejecting, matching this
 * codebase's fail-safe-never-crash discipline for background sync data
 * (mirrors how a single-user vault's `getSharedRevisions()` 404 is handled
 * one layer up, in `sync.ts`, rather than swallowed here -- this function's
 * OWN contract is simply "never throw", independent of that latch).
 *
 * WR-06 fix (30-REVIEW.md): the fail-safe return value stays -- callers
 * (`familyWidePending.ts`'s `refreshFamilyWidePending`) still never need a
 * try/catch of their own -- but the catch used to discard EVERY error class
 * identically, so a persistently broken endpoint (a 500, a schema mismatch,
 * an expired token, a total network partition) was indistinguishable from
 * "genuinely nothing pending". Two shipped guarantees then failed silently:
 * the pending-newcomer row (FSH-05's honesty feature) never rendered, and
 * `runFamilyWideResealTrigger` early-returns on an empty `resealable` and
 * never fires -- FSH-02's lazy-reseal fallback quietly stopped existing,
 * with no signal anywhere. Only the two EXPECTED statuses (403 for a
 * suspended member, 404 for a no-family/solo account) stay silent; every
 * other cause is logged, mirroring `resealTrigger.ts`'s own
 * `console.warn`-and-continue discipline. */
export async function getFamilyWidePending(): Promise<FamilyWidePendingResponse> {
  try {
    return await apiJson<FamilyWidePendingResponse>("/api/families/family-wide-pending", {
      method: "GET",
    });
  } catch (err) {
    const status = err instanceof ApiClientError ? err.status : undefined;
    if (status !== 403 && status !== 404) {
      console.warn(
        "pv: family-wide-pending discovery failed -- pending rows and lazy reseal are paused",
        err,
      );
    }
    return { missing: [], resealable: [] };
  }
}

/** `DELETE /api/auth/account` (Plan 25-06's `account::delete_account`) —
 * SessionUser-gated account deletion. `collections` is the caller-
 * constructed re-key batch from `families/rekey.ts`'s
 * `buildMemberRemovalBatch` for the plain-member self-deletion branch (an
 * empty array for the owner/no-family branches, which the server ignores —
 * see Plan 25-06's `DeleteAccountRequest`). Used by Plan 25-09's
 * `DeleteAccountDialog`. */
export function deleteAccount(collections: CollectionRekeyBatch[]): Promise<void> {
  return apiJson("/api/auth/account", {
    method: "DELETE",
    body: JSON.stringify({ collections }),
  });
}
