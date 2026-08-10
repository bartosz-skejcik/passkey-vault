// Family-wide-pending discovery store — module-singleton mirroring
// `vault/collections.ts`'s own module-private value + `Set<() => void>`
// listener registry + synchronous-getter shape (`subscribeCollections`/
// `getCollections`), so this store's readers (30-12's reseal-trigger, 30-13's
// pending-row UI) follow the SAME established pattern.
//
// `refreshFamilyWidePending()` is the ONLY caller of `getFamilyWidePending()`
// (30-06-PLAN.md's own key_link) -- `sync.ts`'s pullOnce() calls it once per
// pull cycle, and every other consumer reads the synchronous getter below
// instead of hitting the network a second time.
import { getFamilyWidePending, type FamilyWidePendingResponse } from "./api";

const EMPTY_SNAPSHOT: FamilyWidePendingResponse = { missing: [], resealable: [] };

let snapshot: FamilyWidePendingResponse = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

/** Registers a listener fired on every completed `refreshFamilyWidePending()`
 * call (whether or not the result actually changed) — mirrors
 * `collections.ts`'s own `subscribeCollections`. Returns an unsubscribe
 * function. */
export function subscribeFamilyWidePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Synchronous read of the last-stored discovery result — no network call.
 * Returns the empty-arrays default when no refresh has ever run, never
 * `undefined`. */
export function getFamilyWidePendingSnapshot(): FamilyWidePendingResponse {
  return snapshot;
}

/** Calls `getFamilyWidePending()` exactly once, stores the result, and
 * notifies subscribers. `sync.ts`'s `pullOnce()` is this function's ONLY
 * caller — 30-12/30-13 read `getFamilyWidePendingSnapshot()` above, never
 * call `getFamilyWidePending()` directly, so there is exactly one fetch per
 * pull cycle regardless of how many consumers exist. `getFamilyWidePending()`
 * itself never throws (fail-safe by construction, see `families/api.ts`), so
 * this function has no error path of its own to guard. */
export async function refreshFamilyWidePending(): Promise<void> {
  snapshot = await getFamilyWidePending();
  notifyListeners();
}
