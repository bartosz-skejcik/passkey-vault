// Invitation API client for pv-server's /api/invitations/* routes (Plan
// 24-02, `crates/pv-server/src/routes/invitations.rs`). Thin apiJson
// wrappers only — field names match invitations.rs's request/response
// structs exactly, including Amendment 2's `proof_hash` (create) and
// `invite_proof` (fetch_metadata AND accept). `fetchInvitePublicMetadata` is
// a POST, not a GET (Amendment 2 — the request now carries a credential,
// which belongs in a body, never a path/query string an access log could
// capture).
import { apiJson } from "@/lib/auth/api";

export interface InvitePublicMetadata {
  inviter_email: string;
  family_name: string;
  inviter_fingerprint: string | null;
  collection_id: string | null;
  wrapped_collection_key: string | null;
}

/** `POST /api/invitations` — owner-only (server-side `FamilyMembership<RequireEdit>`). */
export function createInvite(body: {
  id: string;
  collection_id: string | null;
  access_level: string | null;
  wrapped_collection_key: string | null;
  proof_hash: string;
  expires_in: string;
}): Promise<{ id: string; expires_at: string }> {
  return apiJson("/api/invitations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `POST /api/invitations/{id}` — pre-redemption metadata fetch, proof-gated
 * (Amendment 2), no session required. */
export function fetchInvitePublicMetadata(
  inviteId: string,
  inviteProof: string,
): Promise<InvitePublicMetadata> {
  return apiJson(`/api/invitations/${inviteId}`, {
    method: "POST",
    body: JSON.stringify({ invite_proof: inviteProof }),
  });
}

/** `POST /api/invitations/{id}/accept` — the milestone's one deliberately
 * low-trust write surface (optional session, proof-gated). */
export function redeemInvite(
  inviteId: string,
  body: { invite_proof: string; sealed_for_self?: string },
): Promise<{ already_member: boolean }> {
  return apiJson(`/api/invitations/${inviteId}/accept`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** `DELETE /api/invitations/{id}` — owner-only revoke of a still-pending invite. */
export function revokeInvite(inviteId: string): Promise<void> {
  return apiJson(`/api/invitations/${inviteId}`, { method: "DELETE" });
}
