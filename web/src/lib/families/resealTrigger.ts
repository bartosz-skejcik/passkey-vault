// FSH-02's lazy-reseal TRIGGER (Plan 30-13) -- the fallback half of
// 30-DECISION-FSH-02.md's hybrid mechanism, and the thing that actually
// delivers a family-wide key to a newcomer whose invite was generated BEFORE
// the share existed (the invite-time wrap of 30-07/30-08 covers the other
// half, and cannot cover this one: an `invitations` row's payload is fixed at
// INSERT time and never re-computed).
//
// Cadence mirrors `identity/ensure.ts`'s `publishOnUnlock` shape: it runs
// opportunistically off the existing unlock/sync cycle, is never awaited by
// anything on the critical path, and tolerates its own failure completely.
//
// THE TRIGGER SET DELIBERATELY INCLUDES THE SHARER. 30-DECISION-FSH-02.md's
// one refinement over the starting hypothesis is that the trigger fires on
// "any current keyholder's own session" -- with NO special-casing that
// excludes the member who created the share. The sharer always already holds
// a usable key for their own family-wide share by construction (the existing
// multi-recipient fan-out grants every current member one at creation time),
// so including them shrinks the "nobody else ever opens the app" failure case
// for free. There is deliberately no `recipient_user_id !== me` style guard
// anywhere in this file.
//
// One query, two consumers: this module reads
// `familyWidePending.ts`'s synchronous `getFamilyWidePendingSnapshot()` and
// NEVER calls `getFamilyWidePending()` itself -- `sync.ts::pullOnce` performs
// exactly one fetch per pull cycle, and 30-15's pending-row UI reads the
// `missing` half of that same snapshot.
import type { WasmUserKey } from "@/lib/crypto";
import { getCollection, type CollectionRow } from "@/lib/vault/api";
import { getFamilyWidePendingSnapshot } from "./familyWidePending";
import { reshareCollectionToNewMember, isConflictError } from "./reseal";
import type { ResealableGrant } from "./api";

/** CR-01 fix (30-REVIEW.md): used only when the collection's OWN
 * `family_wide_access_level` is `null` -- a legacy family-wide collection
 * created before that column existed (a row served before this fix
 * deployed, or mid-rolling-restart). Deliberately never falls back to the
 * caller's OWN held `access_level` -- that used to be exactly this
 * function's bug: a resealer who happens to hold `edit` (e.g. the creator,
 * whose own row is ALWAYS `'edit'` regardless of the level the share was
 * actually created at) would silently upgrade a `read`-declared share to
 * `edit` for every newcomer they resealed to. `"read"` is the safe,
 * never-over-grants default for the genuinely-unknown case. */
const FALLBACK_ACCESS_LEVEL = "read";

/** Per-SESSION set of `"${collectionId}:${recipientUserId}"` pairs this
 * session has already attempted (successfully or not). Bounds repeat work
 * within one session (T-30-21) and makes two overlapping runs in the same
 * tick impossible to double-fire, because a pair is added BEFORE the first
 * await. Cleared on every lock/unlock transition by store.ts via
 * `resetFamilyWideResealAttempts()` below -- mirroring `sync.ts`'s own
 * reset-every-unlock discipline for its latches -- so a pair whose attempt
 * failed transiently is re-attempted on the next unlock's fresh snapshot,
 * never stranded for the lifetime of the tab. */
const attemptedPairs = new Set<string>();

function attemptKey(collectionId: string, recipientUserId: string): string {
  return `${collectionId}:${recipientUserId}`;
}

/** Clears the per-session attempted-pair set. Called from store.ts's
 * `subscribeLockState` unlock branch alongside the other per-unlock latch
 * resets. */
export function resetFamilyWideResealAttempts(): void {
  attemptedPairs.clear();
}

/**
 * For every resealable pair in the current snapshot that this session has
 * not already attempted, reseals the collection's EXISTING Collection Key to
 * that recipient (`reseal.ts`, 30-04) -- no rotation, no server-visible key
 * material, no new endpoint.
 *
 * Never rejects. Each pair's attempt is its own independently-caught
 * `Promise.allSettled` entry, so one transient failure (network drop, a
 * recipient who has not published an identity key yet) can neither block nor
 * abort any other pair's reseal. Partial completion is safe and
 * self-healing: the server's own `INSERT ... ON CONFLICT DO NOTHING` against
 * `collection_keys`'s composite primary key (30-02) makes each grant
 * idempotent, so an interrupted run (a lock mid-batch, a closed tab, two
 * simultaneously-online resealers racing) leaves whatever already landed
 * intact and simply re-attempts the rest from the NEXT unlock's fresh
 * snapshot. That existing idempotency IS the contention story -- this module
 * deliberately invents no coordination scheme of its own.
 */
export async function runFamilyWideResealTrigger(uk: WasmUserKey): Promise<void> {
  const { resealable } = getFamilyWidePendingSnapshot();
  if (resealable.length === 0) {
    // The overwhelmingly common case (no family, or nothing pending):
    // zero extra work on unlock, not even a round trip (T-30-21).
    return;
  }

  // Claim every fresh pair SYNCHRONOUSLY, before the first await below, so a
  // concurrent invocation within the same tick (a WS event and a poll tick
  // landing together) sees them already claimed and fires nothing.
  const fresh: ResealableGrant[] = [];
  for (const grant of resealable) {
    const key = attemptKey(grant.collection_id, grant.recipient_user_id);
    if (attemptedPairs.has(key)) {
      continue;
    }
    attemptedPairs.add(key);
    fresh.push(grant);
  }
  if (fresh.length === 0) {
    return;
  }

  // One `getCollection` per distinct collection per run, shared by every
  // recipient pending on it -- several newcomers on the same family-wide
  // folder cost one round trip, not N.
  const collectionLoads = new Map<string, Promise<CollectionRow>>();
  function loadCollection(collectionId: string): Promise<CollectionRow> {
    let pending = collectionLoads.get(collectionId);
    if (pending === undefined) {
      pending = getCollection(collectionId);
      collectionLoads.set(collectionId, pending);
    }
    return pending;
  }

  await Promise.allSettled(
    fresh.map(async (grant) => {
      try {
        const collection = await loadCollection(grant.collection_id);
        // The current session acts ONLY on keys it already holds. A
        // `sealed_key` of null means this session is on the MISSING side of
        // this collection, not the resealing side -- that case belongs to
        // 30-15's pending-row UI, never to this trigger. (The server's
        // `resealable` query already excludes it; this is the client-side
        // half of the same invariant, cheap because the row is fetched
        // anyway for its access level.)
        if (collection.sealed_key === null || collection.sealed_key === undefined) {
          return;
        }
        // CR-01 fix (30-REVIEW.md): the SHARE's own declared level
        // (`family_wide_access_level`), never `collection.access_level` —
        // the latter is the RESEALER's own `collection_keys` row, which
        // could be `'edit'` (the creator) while the share was declared
        // `'read'`, silently over-granting the newcomer. See
        // `collections::add_member`'s CR-03 fix (`crates/pv-server/src/routes/
        // collections.rs`) for the server-side bound that keeps this call
        // honest even if a caller ever sent something it shouldn't.
        await reshareCollectionToNewMember(
          grant.collection_id,
          grant.recipient_user_id,
          collection.family_wide_access_level ?? FALLBACK_ACCESS_LEVEL,
          uk,
        );
      } catch (err) {
        // CR-03 fix (31-REVIEW.md): `reshareCollectionToNewMember` no longer
        // swallows a 409 itself -- this trigger restores that behavior in
        // its OWN catch, because it is the one caller for whom it is
        // actually correct: this loop's `fresh` set is built from
        // `resealable`, whose own server-side query only ever returns a pair
        // with NO existing `collection_keys` row, so a 409 here can only be
        // a genuine race with another resealer (or a redundant trigger
        // firing twice) landing first -- exactly the state this trigger
        // wants, never a stale-level ambiguity the way a user-chosen level
        // could produce (see `ShareDialog.tsx`'s own 409 handling, which
        // does NOT get this pass).
        if (isConflictError(err)) {
          return;
        }
        // Opportunistic by construction: a failed pair is logged and left
        // for the next unlock's fresh snapshot, never surfaced to the user
        // and never allowed to reach the sync loop.
        console.warn(
          `pv: family-wide lazy reseal failed for collection ${grant.collection_id} -> ${grant.recipient_user_id} -- retrying on a later unlock`,
          err,
        );
      }
    }),
  );
}
