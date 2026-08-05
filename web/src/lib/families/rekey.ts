// Member-removal re-key orchestration (Plan 25-07) — the client-side glue
// between the server's re-key wire contract (Plan 25-03's
// `apply_member_removal_rekey`) and the crypto primitives (Plan 25-02's
// `rewrap_item_key_for_collection`). `buildMemberRemovalBatch` is the SAME
// module both Plan 25-08's `RemoveMemberDialog` (target = someone else) and
// Plan 25-09's `DeleteAccountDialog` (target = caller's own user id) import —
// per the orchestrator's resolved decision, one client orchestration module,
// never two parallel implementations.
//
// Mirrors `lib/invite/crypto.ts`'s exact shape: `initCrypto()` first,
// `ensureOwnIdentityKeypair`, try/finally `.free?.()` discipline on every
// WASM handle.
import {
  initCrypto,
  WasmCollectionKey,
  WasmIdentityPublicKey,
  sealCollectionKey,
  unsealCollectionKey,
  rewrapItemKeyForCollection,
  type WasmUserKey,
} from "@/lib/crypto";
import { base64Decode } from "@/lib/auth/api";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import { getCollection, getCollectionItems, getCollectionAccessList } from "@/lib/vault/api";
import {
  getMemberAccess,
  getFamilyMembers,
  removeMember,
  type CollectionRekeyBatch,
  type NewSealedKeyEntry,
  type ItemRewrapEntry,
} from "./api";

/**
 * Builds a real, wire-shaped re-key batch for every collection `targetUserId`
 * could reach: a fresh Collection Key is generated, sealed to every
 * REMAINING recipient's real published public key, and every real item's
 * `enc_key` is rewrapped from the old key to the new one. Never a placeholder
 * or synthetic value — every field is fetched from live server data and
 * produced by a real WASM call.
 *
 * T-25-16: a remaining recipient with no published public key causes this
 * function to THROW, never to silently proceed with a smaller recipient
 * set — a silently-shrunk recipient set would strand that member's future
 * decryption ability.
 */
export async function buildMemberRemovalBatch(
  targetUserId: string,
  ownUk: WasmUserKey,
): Promise<CollectionRekeyBatch[]> {
  await initCrypto();
  const identityKey = await ensureOwnIdentityKeypair(ownUk);
  try {
    const access = await getMemberAccess(targetUserId);
    const roster = (await getFamilyMembers()) ?? [];

    const batches: CollectionRekeyBatch[] = [];

    for (const { id: collectionId } of access.collections) {
      let oldCk: WasmCollectionKey | undefined;
      let newCk: WasmCollectionKey | undefined;
      const recipientPublicKeys: WasmIdentityPublicKey[] = [];
      try {
        const collectionRecord = await getCollection(collectionId);
        if (collectionRecord.sealed_key === null) {
          throw new Error(
            `cannot re-key collection ${collectionId} — caller has no sealed_key for it`,
          );
        }
        oldCk = unsealCollectionKey(identityKey, collectionRecord.sealed_key);

        const accessList = await getCollectionAccessList(collectionId);
        const remaining = accessList.filter((entry) => entry.user_id !== targetUserId);

        newCk = WasmCollectionKey.generate();

        const newSealedKeys: NewSealedKeyEntry[] = remaining.map((recipient) => {
          const member = roster.find((m) => m.user_id === recipient.user_id);
          if (member?.public_key === undefined || member.public_key === null) {
            // Never silently drop a recipient with no published public key —
            // a silently-shrunk recipient set would strand their future
            // decryption ability (T-25-16).
            throw new Error(
              `cannot re-key collection ${collectionId} — remaining recipient ${recipient.user_id} has no published public key`,
            );
          }
          const recipientPublicKey = WasmIdentityPublicKey.fromBytes(
            base64Decode(member.public_key),
          );
          recipientPublicKeys.push(recipientPublicKey);
          return {
            recipient_user_id: recipient.user_id,
            // `newCk` is assigned above and non-null at this point.
            sealed_key: sealCollectionKey(recipientPublicKey, newCk as WasmCollectionKey),
          };
        });

        const items = await getCollectionItems(collectionId);
        const itemRewraps: ItemRewrapEntry[] = items.map((item) => ({
          item_id: item.id,
          enc_key: rewrapItemKeyForCollection(
            oldCk as WasmCollectionKey,
            newCk as WasmCollectionKey,
            item.enc_key,
            collectionId,
            item.id,
          ),
        }));

        batches.push({
          collection_id: collectionId,
          new_sealed_keys: newSealedKeys,
          item_rewraps: itemRewraps,
        });
      } finally {
        recipientPublicKeys.forEach((pk) => pk.free?.());
        newCk?.free?.();
        oldCk?.free?.();
      }
    }

    return batches;
  } finally {
    identityKey.free?.();
  }
}

/**
 * Builds the removal batch and submits it via `families/api.ts`'s
 * `removeMember`. Plan 25-09's `DeleteAccountDialog` calls
 * `buildMemberRemovalBatch` directly (target = caller's own user id) rather
 * than this wrapper, since its own submit call is a different endpoint
 * (account deletion, not `removeMember`) — one shared batch-BUILDING
 * function, two different SUBMIT call sites, per the orchestrator's resolved
 * decision.
 */
export async function removeFamilyMember(targetUserId: string, ownUk: WasmUserKey): Promise<void> {
  const collections = await buildMemberRemovalBatch(targetUserId, ownUk);
  await removeMember(targetUserId, collections);
}
