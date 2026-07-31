// Identity keypair API client for pv-server's /api/identity/keypair (Phase
// 22, `crates/pv-server/src/routes/identity.rs`). This is the FIRST caller of
// this endpoint (Phase 22 built it, nothing has called it until Phase 24 —
// see 24-05-PLAN.md's objective). Reuses `apiJson`/`ApiClientError` from
// `@/lib/auth/api` (WR-11 precedent: the one shared error-parsing
// implementation, never a second inline copy of it).
import { apiJson, ApiClientError } from "@/lib/auth/api";

/** Wire shape of `identity.rs`'s `KeypairResponse` — matches
 * `KeypairRequest`/`KeypairResponse` field-for-field. */
export interface KeypairRow {
  public_key: string;
  wrapped_secret_key: string;
  adopted_existing: boolean;
}

/**
 * `GET /api/identity/keypair` — returns `null` on a 404 (no keypair
 * published yet), which is an expected, non-error outcome here, not a
 * thrown `ApiClientError`. Calls `apiJson` (the one shared
 * error-body-parsing implementation, per WR-11) and converts its 404 throw
 * into `null` rather than duplicating `apiJson`'s own non-ok-status parsing
 * logic inline.
 */
export async function getIdentityKeypair(): Promise<{ public_key: string; wrapped_secret_key: string } | null> {
  try {
    return await apiJson<{ public_key: string; wrapped_secret_key: string }>("/api/identity/keypair");
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) {
      return null;
    }
    throw e;
  }
}

/** `PUT /api/identity/keypair` — idempotent upsert (see `identity.rs`'s own
 * doc comment for the two-devices-racing resolution this powers). */
export function putIdentityKeypair(body: {
  public_key: string;
  wrapped_secret_key: string;
}): Promise<KeypairRow> {
  return apiJson("/api/identity/keypair", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
