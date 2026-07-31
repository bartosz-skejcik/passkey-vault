// ensureOwnIdentityKeypair — this phase's first real caller of `PUT
// /api/identity/keypair` (Phase 22 built the endpoint; nothing called it
// until now, per 24-05-PLAN.md's objective). Idempotent: two devices of the
// same account racing to generate a keypair resolve deterministically — the
// race loser always adopts the server's canonical published key rather than
// trusting its own locally-generated one (T-24-14, matching `identity.rs`'s
// own documented idempotent-upsert contract).
import {
  WasmIdentityKey,
  wrapIdentitySecretKey,
  unwrapIdentitySecretKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { base64Encode } from "@/lib/auth/api";
import { getIdentityKeypair, putIdentityKeypair } from "./api";

/**
 * On an account with no published keypair: generates one, publishes it, and
 * returns a usable `WasmIdentityKey`. On an account that already has a
 * published keypair: unwraps and returns THAT one, never generating a
 * second. A concurrent race (two callers, one delayed) leaves exactly one
 * canonical keypair published — the loser's locally-generated handle is
 * freed and discarded, and it instead unwraps the winner's published blob.
 */
export async function ensureOwnIdentityKeypair(uk: WasmUserKey): Promise<WasmIdentityKey> {
  const existing = await getIdentityKeypair();
  if (existing !== null) {
    return unwrapIdentitySecretKey(uk, existing.wrapped_secret_key);
  }

  const isk = WasmIdentityKey.generate();
  const wrapped = wrapIdentitySecretKey(uk, isk);
  const publicKeyB64 = base64Encode(isk.publicKeyBytes());

  const response = await putIdentityKeypair({
    public_key: publicKeyB64,
    wrapped_secret_key: wrapped,
  });

  if (response.adopted_existing) {
    // A concurrent caller won the race — discard the locally-generated
    // handle and adopt the server's canonical one instead.
    isk.free?.();
    return unwrapIdentitySecretKey(uk, response.wrapped_secret_key);
  }

  return isk;
}
