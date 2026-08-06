// "Who is this item shared with" data source for D-3's AvatarStack (Phase
// 26, Plan 06). A module-level, two-tier cache (collection id ->
// recipients, item id -> recipients) so a vault list of hundreds of items
// never triggers an N+1 fetch: every item in the SAME collection resolves
// through one shared `getCollectionAccessList` call, fetched once and reused
// by every subsequent caller for that collection id.
//
// Resolution rule (mirrors 26-UI-SPEC.md's E5/Phase-Specific-Notes §4):
//   - item.collectionId present  -> resolve via the collection-id cache
//     (fetch getCollectionAccessList(collectionId) ONCE, share the result
//     across every item in that collection).
//   - else item.isShared === true -> resolve via the item-id cache (fetch
//     listItemShares(item.id) once, cache by item id).
//   - else (not shared, no collection) -> `[]` immediately, no fetch at all.
//
// T-26-13 (accepted, per this plan's own threat register): a cached entry
// can go stale after a revocation until the next store re-render triggered
// by onSharedRevisions/personal-snapshot re-merge -- matching this
// codebase's existing "poll/WS-driven eventual consistency, never a hard
// real-time guarantee" posture for every other list in the app. No
// invalidation API is added here; a future plan may add one if a stricter
// guarantee becomes necessary.
import { useEffect, useState } from "react";
import { me } from "@/lib/auth/api";
import { getCollectionAccessList, listItemShares } from "./api";
import type { VaultItem } from "./types";

export interface ShareRecipient {
  email: string;
  suspended: boolean;
}

// WR-03 (code review, Phase 26): the caller's own id, resolved ONCE and
// cached at module level like the two recipient caches below. Both server
// endpoints include the CALLER's own row -- the creator's `collection_keys`
// row is hard-coded `edit` server-side, and a recipient listing an item
// shared to them sees themselves -- so without this filter every shared item
// rendered the caller's own initial in its avatar stack and
// `sharing.sharedWithLabel` reported n+1. `SharingOverviewPanel` already
// filters `entry.user_id !== selfId`, proving the filter is required; the
// shared hook `ItemRow`/`DetailPanel` both use simply did not.
let selfIdPromise: Promise<string | null> | null = null;

function getSelfId(): Promise<string | null> {
  if (selfIdPromise === null) {
    selfIdPromise = me()
      .then((account) => account.user_id)
      .catch(() => {
        // Never cache a failure -- and degrade to "no filter" rather than
        // failing the whole stack: an unfilterable list is a cosmetic
        // over-count, a thrown hook is a broken row.
        selfIdPromise = null;
        return null;
      });
  }
  return selfIdPromise;
}

function toRecipients(
  entries: { user_id: string; email: string; suspended: boolean }[],
  selfId: string | null,
): ShareRecipient[] {
  return entries
    .filter((entry) => entry.user_id !== selfId)
    .map((entry) => ({ email: entry.email, suspended: entry.suspended }));
}

const collectionCache = new Map<string, Promise<ShareRecipient[]>>();
const itemCache = new Map<string, Promise<ShareRecipient[]>>();

function fetchForCollection(collectionId: string): Promise<ShareRecipient[]> {
  let cached = collectionCache.get(collectionId);
  if (cached === undefined) {
    cached = Promise.all([getCollectionAccessList(collectionId), getSelfId()])
      .then(([entries, selfId]) => toRecipients(entries, selfId))
      .catch((err: unknown) => {
        // Never cache a failure -- a transient network error should not
        // permanently poison this collection's entry for every later item.
        collectionCache.delete(collectionId);
        throw err;
      });
    collectionCache.set(collectionId, cached);
  }
  return cached;
}

function fetchForItem(itemId: string): Promise<ShareRecipient[]> {
  let cached = itemCache.get(itemId);
  if (cached === undefined) {
    cached = Promise.all([listItemShares(itemId), getSelfId()])
      .then(([entries, selfId]) => toRecipients(entries, selfId))
      .catch((err: unknown) => {
        itemCache.delete(itemId);
        throw err;
      });
    itemCache.set(itemId, cached);
  }
  return cached;
}

/** `null` = not yet resolved (E5's loading backstop -- the caller must
 * render zero circles, never a skeleton/placeholder, while this is `null`).
 * `item` may be `null` for a caller that has no VaultItem to resolve against
 * (AvatarStack's icon variant, which accepts a pre-resolved `recipients`
 * prop instead) -- in that case this hook never fetches and returns `[]`,
 * the same as the "not shared, no collection" branch below. */
export function useShareRecipients(item: VaultItem | null): ShareRecipient[] | null {
  const [recipients, setRecipients] = useState<ShareRecipient[] | null>(null);

  const collectionId = item?.collectionId ?? null;
  const isShared = item?.isShared ?? false;
  const itemId = item?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    setRecipients(null);

    if (collectionId !== null && collectionId !== undefined) {
      void fetchForCollection(collectionId)
        .then((resolved) => {
          if (!cancelled) setRecipients(resolved);
        })
        .catch(() => {
          // Fail-safe, not fail-crash: an unresolved recipient list renders
          // as "no visible avatars" rather than throwing inside a list row.
          if (!cancelled) setRecipients([]);
        });
    } else if (isShared && itemId !== null) {
      void fetchForItem(itemId)
        .then((resolved) => {
          if (!cancelled) setRecipients(resolved);
        })
        .catch(() => {
          if (!cancelled) setRecipients([]);
        });
    } else {
      setRecipients([]);
    }

    return () => {
      cancelled = true;
    };
  }, [collectionId, isShared, itemId]);

  return recipients;
}
