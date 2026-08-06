// Collections client store — module-level singleton mirroring store.ts's own
// items/folders shape (module-private array + Set of listeners +
// useSyncExternalStore-based useCollections() hook, same shape as
// useFolders()). Holds the ONE in-memory copy of every collection the caller
// currently holds a collection_keys row for, plus a cache of each
// collection's UNWRAPPED WasmCollectionKey — the cache Task 2's
// store.ts::decryptItemRow dispatch reads synchronously to decrypt a
// collection-scoped item (26-05-PLAN.md). Unlocking the vault (re-)fetches
// and decrypts every collection; locking frees every cached key handle
// immediately (T-26-10), so no unwrapped Collection Key material survives a
// lock event, mirroring store.ts's own items/folders clear-on-lock
// discipline and lib/crypto/index.ts's own free-on-lock singleton pattern.
import { useSyncExternalStore } from "react";
import {
  decryptItemForCollection,
  getUnlockedUserKey,
  isUnlocked,
  subscribeLockState,
  unsealCollectionKey,
  type WasmCollectionKey,
} from "@/lib/crypto";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import { listCollections } from "./api";

export interface Collection {
  id: string;
  name: string;
}

// Collections carry no revision column of their own — a collection's own
// enc_name is always encrypted/decrypted at revision 1, matching
// RemoveMemberDialog.tsx's own COLLECTION_NAME_REVISION precedent (that
// file's resolveFolder is the exact decrypt shape this module mirrors).
const COLLECTION_NAME_REVISION = 1;

let collections: Collection[] = [];
const listeners = new Set<() => void>();

// Module-private cache of unwrapped Collection Key handles, keyed by
// collection id — LONG-LIVED (freed on lock or on replacement, never freed
// per-call), mirroring lib/crypto/index.ts's own currentUserKey lock-state-
// singleton free-on-replace/free-on-lock pattern. Task 2's
// store.ts::decryptItemRow dispatch consumes this synchronously via
// getCollectionKey() — never awaited, so a not-yet-cached collection falls
// through to the existing undecryptable retained-last-known-good path.
const collectionKeys = new Map<string, WasmCollectionKey>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
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

/** Synchronous lookup for a cached, already-unwrapped Collection Key —
 * `undefined` when this store hasn't refreshed yet, or when a collection's
 * `sealed_key` failed to unseal. Consumed by store.ts::decryptItemRow's
 * scope dispatch (Task 2, 26-05-PLAN.md). */
export function getCollectionKey(collectionId: string): WasmCollectionKey | undefined {
  return collectionKeys.get(collectionId);
}

/** Frees every cached Collection Key handle and clears the map — called on
 * lock (T-26-10: never leave WASM-held key material to a non-deterministic
 * FinalizationRegistry across a long-lived session). */
function freeAllCollectionKeys(): void {
  collectionKeys.forEach((ck) => {
    ck.free?.();
  });
  collectionKeys.clear();
}

/** Re-fetches and re-decrypts every collection the caller currently holds a
 * collection_keys row for. Triggered by the lock-state subscriber below on
 * every unlock — never exported, mirroring store.ts's own private
 * loadAndDecryptAll(). A race with an intervening lock is checked both
 * before AND after each awaited step, and is a silent no-op — this must
 * never decrypt with a stale/freed key handle or repopulate state after the
 * user has since locked (mirrors store.ts::applySyncSnapshot's own
 * re-check). */
async function refreshCollections(): Promise<void> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    return;
  }

  const rows = await listCollections();
  if (getUnlockedUserKey() === null) {
    return;
  }

  // One identity-key resolution per refresh (not per row) — cached for the
  // duration of this call, freed in the `finally` below regardless of
  // outcome.
  const identityKey = await ensureOwnIdentityKeypair(uk);
  try {
    if (getUnlockedUserKey() === null) {
      return;
    }

    const nextCollections: Collection[] = [];
    for (const row of rows) {
      // Honest fallback shape (matches RemoveMemberDialog.tsx's
      // resolveFolder): a name that fails to decrypt — or a sealed_key that
      // fails to unseal — never blocks the rest of the list, and never
      // fabricates a name. The raw id is shown instead.
      let name = row.id;
      if (row.sealed_key !== null) {
        try {
          const ck = unsealCollectionKey(identityKey, row.sealed_key);
          // Replace (never leak) any previously-cached handle for this id —
          // this IS the "freed... on replacement" half of this module's own
          // free discipline (the other half is freeAllCollectionKeys() on
          // lock).
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
            // Falls back to the raw collection id — the key itself is still
            // cached and usable for item decryption even when the NAME
            // fails to decrypt.
          }
        } catch {
          // sealed_key failed to unseal (e.g. sealed to a different
          // identity key) — this collection's key stays unresolved;
          // getCollectionKey() returns undefined for it, and any item in
          // it falls through to store.ts's undecryptable path.
        }
      }
      nextCollections.push({ id: row.id, name });
    }
    collections = nextCollections;
    notifyListeners();
  } finally {
    identityKey.free?.();
  }
}

// useSyncExternalStore requires getServerSnapshot to return the same
// reference across calls unless the underlying data actually changed —
// mirrors store.ts's own EMPTY_SNAPSHOT constant.
const EMPTY_SNAPSHOT: never[] = [];
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

export function useCollections(): Collection[] {
  return useSyncExternalStore(subscribeCollections, getCollections, getEmptySnapshot);
}

/** Manually triggers the SAME re-fetch/re-decrypt every cached collection
 * otherwise only undergoes on unlock (or A-5's `onSharedRevisions`
 * watermark tick) — exported for `ShareDialog.tsx`'s folder-create variant
 * to call immediately after a successful `createCollection`.
 *
 * 26-12a gap fix: without this, a freshly-created folder was invisible in
 * `CollectionPicker` until one of those two unrelated external triggers
 * happened to fire (declared, not silently shipped, as 26-12-SUMMARY.md's
 * own `eventual-consistency-gap` threat flag — this store was outside that
 * plan's declared `files_modified`). Shares `refreshCollections()`'s own
 * lock-race safety (re-checked before AND after its internal `await`
 * steps) — a no-op if the vault has since locked. Can reject (e.g. a
 * transient network failure); callers that want this to be best-effort
 * (never turning a successful share into a visible error) must catch at
 * the call site — this function itself does not swallow errors, so a
 * caller that DOES want to surface a refresh failure still can. */
export function refreshCollectionsNow(): Promise<void> {
  return refreshCollections();
}

// Module-level side effect (mirrors store.ts's own subscribeLockState side
// effect): unlocking the vault triggers a refresh; locking frees every
// cached key handle and clears the in-memory list immediately, so no stale
// unwrapped Collection Key survives a lock event.
subscribeLockState(() => {
  if (isUnlocked()) {
    // WR-01 (code review, Phase 26): `refreshCollections` awaits
    // `listCollections()`, which hits `collections::list` -- gated by
    // `FamilyMembership<RequireRead>`, i.e. a 404 for any user with NO
    // `family_members` row at all. That is this product's PRIMARY persona
    // (the solo self-hoster), so every one of their unlocks produced an
    // unhandled promise rejection. `refreshCollectionsNow`'s own doc comment
    // states that this function deliberately does not swallow errors and
    // that best-effort callers must catch at the call site -- this call site
    // simply missed it, unlike `store.ts::refreshSharedItemsNow`, which
    // wraps the identical "expected 404 for a single-user vault" case.
    void refreshCollections().catch(() => {
      // Expected for a single-user vault (no family_members row) and for
      // any transient failure -- the next unlock / onSharedRevisions tick
      // retries.
    });
  } else {
    freeAllCollectionKeys();
    collections = [];
    notifyListeners();
  }
});
