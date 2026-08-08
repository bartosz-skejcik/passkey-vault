// entrypoints/background/collections-store.ts — background-only Collection
// Key cache (27-03-PLAN.md Task 2), ported from web/src/lib/vault/
// collections.ts's Collection interface, module-private
// collections/collectionKeys state, getCollections()/getCollectionKey()/
// getCollectionAccessLevel() synchronous getters, refreshCollections()'s
// full body (WR-15 identity-not-nullity check, one-identity-key-resolution-
// per-refresh, the WR-02 stale-key eviction loop), and freeAllCollectionKeys().
//
// Two deliberate divergences from the web analog, both required by 27-
// CONTEXT.md's EXT-11/lock-path-ordering constraints and 27-PATTERNS.md's
// Pitfall 4:
//
//  1. No React: `useSyncExternalStore`/`useCollections()` are dropped
//     entirely -- there is no React consumer of this module in the
//     background context. `notifyListeners()` instead mirrors
//     vault-store.ts's own shape: a local `Set<() => void>` PLUS a
//     `browser.runtime.sendMessage({kind:"vault.updated"})` broadcast so an
//     open popup reacts to a collection-key-cache change (a "no receiver"
//     rejection when no popup is open is expected, not an error, same as
//     vault-store.ts's own broadcast).
//
//  2. No module-level `subscribeSessionLockState` side effect. Web's
//     collections.ts registers its OWN lock-state listener (a SECOND
//     listener, separate from store.ts's) -- 27-PATTERNS.md's Pitfall 4
//     explicitly forbids copying that shape here, because MV3
//     service-worker module re-evaluation order after an idle-kill wake is
//     less predictable than a single long-lived browser tab. Both
//     `refreshCollectionsNow()` and `freeAllCollectionKeys()` are exported
//     as plain functions with a documented "caller must invoke" contract;
//     27-04 owns wiring them into vault-store.ts's EXISTING
//     `subscribeSessionLockState` handler (AFTER `stopSync()`, same
//     position as every other new key cache this phase adds), never a
//     second listener registered by this module.
import {
  decryptItemForCollection,
  unsealCollectionKey,
  type WasmCollectionKey,
} from "../../lib/crypto/wasm-loader";
import { getUnlockedUserKey } from "./vault-session";
import { ensureOwnIdentityKeypair } from "./identity-store";
import { listCollections } from "./vault-api";
import { browser } from "wxt/browser";
import type { Message } from "../../lib/messaging/ext-protocol";

export interface Collection {
  id: string;
  name: string;
  /** `collections.rs::list` always returns the caller's own
   * `collection_keys.access_level`; `null` only when the server sent null
   * (a collection row with no resolvable grant for this caller). Ported
   * verbatim from web's own field (26-VERIFICATION.md gap 1). */
  accessLevel: string | null;
}

// Collections carry no revision column of their own -- a collection's own
// enc_name is always encrypted/decrypted at revision 1, matching web's own
// COLLECTION_NAME_REVISION precedent.
const COLLECTION_NAME_REVISION = 1;

let collections: Collection[] = [];
const listeners = new Set<() => void>();

// Module-private cache of unwrapped Collection Key handles, keyed by
// collection id -- LONG-LIVED (freed on lock via freeAllCollectionKeys(),
// called by 27-04's wiring, or on replacement inside refreshCollections()
// below, never freed per-call). Task 2's own real-WASM test proves the
// round trip; the read-side dispatch that consumes this synchronously
// lands in 27-04's vault-store.ts port.
const collectionKeys = new Map<string, WasmCollectionKey>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
  void browser.runtime.sendMessage({ kind: "vault.updated" } satisfies Message).catch(() => {});
}

export function getCollections(): Collection[] {
  return collections;
}

export function subscribeCollections(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Synchronous lookup for a cached, already-unwrapped Collection Key --
 * `undefined` when this store hasn't refreshed yet, or when a collection's
 * `sealed_key` failed to unseal. Consumed by 27-04's vault-store.ts port
 * of `decryptItemRow`'s scope dispatch. */
export function getCollectionKey(collectionId: string): WasmCollectionKey | undefined {
  return collectionKeys.get(collectionId);
}

/** The caller's OWN `collection_keys.access_level` for a collection, or
 * `undefined` when this store hasn't refreshed yet / the server returned no
 * level. The two lookups (`getCollectionKey`/`getCollectionAccessLevel`)
 * are consistent by construction -- both are written from the SAME
 * `listCollections()` row in the same `refreshCollections` pass, so there
 * is no window in which an item's key resolves while its access level is
 * still unknown. */
export function getCollectionAccessLevel(collectionId: string): string | undefined {
  return collections.find((c) => c.id === collectionId)?.accessLevel ?? undefined;
}

/** Frees every cached Collection Key handle and clears the map. Exported
 * for 27-04's lock-path wiring to call from vault-store.ts's EXISTING
 * `subscribeSessionLockState` handler (see this file's header comment) --
 * this module registers no lock listener of its own. T-27-05: no cached
 * key is ever written to `chrome.storage.*`; this is the module-memory-only
 * free discipline that closes it. */
export function freeAllCollectionKeys(): void {
  collectionKeys.forEach((ck) => {
    ck.free?.();
  });
  collectionKeys.clear();
}

/** Re-fetches and re-decrypts every collection the caller currently holds a
 * collection_keys row for. A race with an intervening lock is checked both
 * BEFORE and AFTER each awaited step, and is a silent no-op -- this must
 * never decrypt with a stale/freed key handle or repopulate state after the
 * user has since locked (mirrors vault-store.ts's own applySyncSnapshot
 * re-check discipline). EXT-11's "zero collections is a no-op" truth: an
 * empty `listCollections()` response completes with no thrown error and
 * `getCollections()` returns `[]`. */
async function refreshCollections(): Promise<void> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    return;
  }

  const rows = await listCollections();
  // WR-15 (ported from web's collections.ts): identity, not mere nullity --
  // a lock-then-unlock cycle mid-flight installs a BRAND NEW WasmUserKey and
  // frees this one, so a `=== null` guard passes while `uk` is stale.
  if (getUnlockedUserKey() !== uk) {
    return;
  }

  // One identity-key resolution per refresh (not per row) -- cached for the
  // duration of this call, freed in the `finally` below regardless of
  // outcome.
  const identityKey = await ensureOwnIdentityKeypair(uk);
  try {
    if (getUnlockedUserKey() !== uk) {
      return; // WR-15: see the identity check above
    }

    const nextCollections: Collection[] = [];
    for (const row of rows) {
      // Honest fallback shape (matches web's own): a name that fails to
      // decrypt -- or a sealed_key that fails to unseal -- never blocks the
      // rest of the list, and never fabricates a name. The raw id is shown
      // instead.
      let name = row.id;
      if (row.sealed_key !== null) {
        try {
          const ck = unsealCollectionKey(identityKey, row.sealed_key);
          // Replace (never leak) any previously-cached handle for this id --
          // this IS the "freed... on replacement" half of this module's own
          // free discipline (the other half is freeAllCollectionKeys() on
          // lock, wired by 27-04).
          collectionKeys.get(row.id)?.free?.();
          collectionKeys.set(row.id, ck);
          try {
            const plaintext = decryptItemForCollection(
              ck,
              row.enc_name,
              row.id,
              row.id,
              COLLECTION_NAME_REVISION,
            );
            const parsed = JSON.parse(plaintext) as { name?: string };
            if (typeof parsed.name === "string" && parsed.name.length > 0) {
              name = parsed.name;
            }
          } catch {
            // Falls back to the raw collection id -- the key itself is
            // still cached and usable for item decryption even when the
            // NAME fails to decrypt.
          }
        } catch {
          // sealed_key failed to unseal (e.g. sealed to a different
          // identity key) -- this collection's key stays unresolved;
          // getCollectionKey() returns undefined for it, and any item in
          // it falls through to the undecryptable path.
        }
      }
      nextCollections.push({ id: row.id, name, accessLevel: row.access_level });
    }
    // WR-02 (ported from web's code review, Phase 26): evict every cached
    // key whose collection the server no longer returns -- the mechanism
    // that closes T-27-06's post-revocation-staleness threat once 27-04
    // wires `refreshCollectionsNow()` into the periodic shared-revisions
    // tick.
    const liveIds = new Set(rows.map((row) => row.id));
    for (const [id, ck] of Array.from(collectionKeys.entries())) {
      if (!liveIds.has(id)) {
        ck.free?.();
        collectionKeys.delete(id);
      }
    }
    collections = nextCollections;
    notifyListeners();
  } finally {
    identityKey.free?.();
  }
}

/** Manually triggers the SAME re-fetch/re-decrypt `refreshCollections()`
 * performs. Exported for 27-04's sync-client wiring to call on every
 * `onSharedRevisions` tick, not only on unlock -- this is the
 * periodic-refresh hook T-27-06's post-revocation-staleness threat
 * mitigation depends on.
 *
 * Caller-must-invoke-on-unlock contract (this plan's deliberate scope
 * boundary): this module registers NO module-level
 * `subscribeSessionLockState` side effect (see this file's header
 * comment) -- 27-04 owns the composed wake/unlock sequence and calls this
 * from vault-store.ts's existing handler.
 *
 * Shares `refreshCollections()`'s own lock-race safety (re-checked before
 * AND after its internal `await` steps) -- a no-op if the vault has since
 * locked. Can reject (e.g. a transient network failure, or a 404 for a
 * single-user vault with no `family_members` row); callers that want this
 * to be best-effort must catch at the call site -- this function itself
 * does not swallow errors. */
export function refreshCollectionsNow(): Promise<void> {
  return refreshCollections();
}
