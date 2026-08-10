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
import { getCollection, getCollectionItems, getCollectionAccessList, listCollections } from "@/lib/vault/api";
import {
  getMemberAccess,
  getFamilyMembers,
  removeMember,
  type CollectionRekeyBatch,
  type NewSealedKeyEntry,
  type ItemRewrapEntry,
} from "./api";

/**
 * Resolves the ids of every collection `targetUserId` currently holds a
 * `collection_keys` row for. Two callers, two paths, per T-30-XX (found
 * live, 30-17-PLAN.md's own Task 2 case 1 -- see 30-17-SUMMARY.md's
 * Deviations for the full write-up). `isSelf` is passed EXPLICITLY by the
 * caller (never inferred via an extra `me()` round trip -- both call sites
 * already structurally know which case they are: `RemoveMemberDialog` never
 * targets the caller's own id, `DeleteAccountDialog`'s member branch always
 * does) so the ordinary owner-removes-someone-else path stays byte-identical
 * to before, including in the mocked unit-test lane that never stubs `me()`:
 *
 *   - **Someone else, `isSelf = false`** (`RemoveMemberDialog`, the owner
 *     removing a different member): `GET /api/families/members/{user_id}/access`
 *     (`getMemberAccess`), UNCHANGED. This route is deliberately
 *     `FamilyMembership<RequireEdit>` (owner-only) -- `family.rs::
 *     owner_sees_per_member_access_breakdown` explicitly asserts a plain
 *     member querying THEIR OWN id via this same endpoint gets `403`, never
 *     `200`. That is a locked FAM-03 decision, not a gap to close.
 *   - **The caller's own id, `isSelf = true`** (`DeleteAccountDialog`'s
 *     plain-member self-deletion branch calls
 *     `buildMemberRemovalBatch(selfUserId, uk, true)`): calling
 *     `getMemberAccess` here would ALWAYS 403, unconditionally, regardless
 *     of what the caller actually shares -- the extractor rejects any
 *     non-owner caller before the handler body even runs. No prior test
 *     caught this: every existing removal/deletion test either drives the
 *     OWNER'S OWN removal of someone else through the UI, or builds the
 *     batch server-side/Node-side directly; none drove a PLAIN MEMBER's own
 *     self-deletion through the real UI with real collection access until
 *     30-17's live suite did. `GET /api/vault/collections`
 *     (`listCollections()`) is `FamilyMembership<RequireRead>`-gated and
 *     ALWAYS scoped to the caller's OWN `collection_keys` rows by
 *     construction (never parameterized by a target id) -- it returns the
 *     exact same collection-id set `getMemberAccess(self).collections`
 *     would, without needing owner privilege. This fix is entirely
 *     client-side and touches no authorization model on either path.
 */
async function resolveTargetCollectionIds(targetUserId: string, isSelf: boolean): Promise<string[]> {
  if (isSelf) {
    const rows = await listCollections();
    return rows.map((row) => row.id);
  }
  const access = await getMemberAccess(targetUserId);
  return access.collections.map((entry) => entry.id);
}

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
 *
 * `isSelf` (default `false`, preserving every existing call site's exact
 * prior behavior) -- see `resolveTargetCollectionIds`'s own doc comment for
 * why this must be an explicit caller-supplied flag, not inferred.
 */
export async function buildMemberRemovalBatch(
  targetUserId: string,
  ownUk: WasmUserKey,
  isSelf = false,
): Promise<CollectionRekeyBatch[]> {
  await initCrypto();
  const identityKey = await ensureOwnIdentityKeypair(ownUk);
  try {
    const collectionIds = await resolveTargetCollectionIds(targetUserId, isSelf);
    const roster = (await getFamilyMembers()) ?? [];

    const batches: CollectionRekeyBatch[] = [];

    for (const collectionId of collectionIds) {
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
