// FSH-02's lazy-reseal composition (Plan 30-04) — the ONE genuinely new
// client-side crypto glue this phase's decision record (30-DECISION-FSH-02.md)
// requires: unwrap a Collection Key the caller ALREADY holds and reseal the
// SAME key (never a freshly-generated one, unlike `rekey.ts`'s
// `buildMemberRemovalBatch`) to exactly one new recipient's published public
// key, then grant it via the EXISTING `collections::add_member` endpoint —
// no new server surface, no new wire shape.
//
// Mirrors `lib/invite/crypto.ts`'s exact shape: `initCrypto()` first,
// `ensureOwnIdentityKeypair`, try/finally `.free?.()` discipline on every
// WASM handle. Mirrors `families/rekey.ts::buildMemberRemovalBatch`'s T-25-16
// discipline: a recipient with no published public key throws BEFORE any
// network call, never a silently skipped grant.
import {
  initCrypto,
  WasmIdentityPublicKey,
  sealCollectionKey,
  unsealCollectionKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { base64Decode } from "@/lib/auth/api";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import { getCollection, addCollectionMember } from "@/lib/vault/api";
import { getFamilyMembers } from "./api";

/** Structural (duck-typed) 409 check — deliberately NOT an
 * `instanceof ApiClientError`, mirroring `ShareDialog.tsx`'s own
 * `isConflictError` and `store.ts`'s identical rationale (this module may be
 * re-imported under a fresh module instance by `vi.resetModules()`-style
 * tests, which would make a top-level class reference a different object
 * than the one a mock rejection was constructed with).
 *
 * CR-03 fix (31-REVIEW.md): exported, no longer used internally to swallow a
 * 409 here — see this function's own former doc comment, now moved to
 * `resealTrigger.ts`'s catch, which is the ONE caller for whom "a 409 means
 * the recipient already holds a grant, treat it as success" is actually
 * correct (its own `resealable` snapshot only ever contains a pair with no
 * existing `collection_keys` row, so a 409 there can only be a genuine race
 * with another resealer, never a stale/wrong-level assumption). A 409 for a
 * USER-CHOSEN per-row level (`ShareDialog.tsx`'s `submitRowsForExistingDestination`)
 * is a different claim entirely — it can mean the recipient already holds
 * a grant at ANY level, not necessarily the one just requested — so that
 * caller must verify the actually-persisted level itself before deciding
 * success, never trust this function's own 409 unconditionally. */
export function isConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 409
  );
}

/**
 * Reseals a collection's EXISTING Collection Key to one new recipient,
 * without rotating it — the SAME key every other current member's grant
 * already decrypts to, so no existing member's `enc_key` needs rewrapping.
 *
 * Unwrap-own-key, reseal-to-one-new-recipient composition, assembled from
 * already-proven parts: `unsealCollectionKey`'s unwrap-own-sealed-key
 * pattern (`lib/invite/crypto.ts:94-99`) and `sealCollectionKey`'s
 * seal-to-recipient pattern (`families/rekey.ts:70-96`), deliberately never
 * calling `WasmCollectionKey.generate()` — that rotation is
 * `buildMemberRemovalBatch`'s job for revocation, not this function's job
 * for adding a reader.
 *
 * T-25-16: a recipient with no published public key causes this function to
 * THROW before any network call (`getCollection`/`addCollectionMember`),
 * never a silently skipped grant.
 *
 * CR-03 fix (31-REVIEW.md): a structural 409 from `addCollectionMember` now
 * propagates to the CALLER — this function no longer decides for itself that
 * "the recipient already holds a grant" is success, because it has no way to
 * know whether that existing grant is at the level ITS OWN caller asked for.
 * `resealTrigger.ts` (whose 409s are always genuine same-pair races, per its
 * own `resealable`-snapshot invariant) restores the old swallow-it-as-success
 * behavior in its own catch; `ShareDialog.tsx`'s `submitRowsForExistingDestination`
 * (whose 409s can mean "already holds a DIFFERENT level") verifies the actual
 * persisted level before deciding.
 */
export async function reshareCollectionToNewMember(
  collectionId: string,
  newRecipientUserId: string,
  accessLevel: string,
  ownUk: WasmUserKey,
): Promise<void> {
  await initCrypto();
  const identityKey = await ensureOwnIdentityKeypair(ownUk);
  let recipientPk: WasmIdentityPublicKey | undefined;
  try {
    // Resolve the recipient's public key BEFORE any getCollection/network
    // call — T-25-16 discipline: never let a doomed grant reach the network
    // even partially. Mirrors `buildMemberRemovalBatch`'s "throw before
    // proceeding with a smaller/incomplete recipient set" rule.
    const roster = (await getFamilyMembers()) ?? [];
    const member = roster.find((m) => m.user_id === newRecipientUserId);
    if (member?.public_key === undefined || member.public_key === null) {
      throw new Error(
        `cannot reshare collection ${collectionId} — recipient ${newRecipientUserId} has no published public key`,
      );
    }
    recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(member.public_key));

    const collectionRecord = await getCollection(collectionId);
    if (collectionRecord.sealed_key === null) {
      throw new Error(
        `cannot reshare collection ${collectionId} — caller has no sealed_key for it`,
      );
    }
    const ck = unsealCollectionKey(identityKey, collectionRecord.sealed_key);
    try {
      // The SAME `ck` unwrapped above — deliberately never a freshly
      // generated key. No existing member's grant is touched.
      const sealedKey = sealCollectionKey(recipientPk, ck);

      // CR-03 fix (31-REVIEW.md): no internal 409 handling — propagates to
      // the caller, who owns the policy for what a 409 means for THEM. See
      // this function's own doc comment above.
      await addCollectionMember(collectionId, newRecipientUserId, sealedKey, accessLevel);
    } finally {
      ck.free?.();
    }
  } finally {
    recipientPk?.free?.();
    identityKey.free?.();
  }
}
