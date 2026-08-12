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
  /** 26-VERIFICATION.md gap 1: `collections::list` (collections.rs:235) has
   * always returned the caller's own `collection_keys.access_level`; this
   * store DROPPED it, so no collection-scoped item had an access level
   * anywhere in the client. `null` only when the server sent null (a
   * collection row with no resolvable grant for this caller). */
  accessLevel: string | null;
  /** 30-11 (FSH-01): the server's own `collections.family_wide_kind`, threaded
   * through untransformed — `null` for an ordinary collection, `'folder'` for a
   * named family-wide folder, `'item_bucket'` for a collection holding bare
   * items shared family-wide (260812-01e: a family may hold up to THREE such
   * collections, one per declared `family_wide_access_level` — no longer a
   * per-family singleton; 30-DECISION-FSH-02.md names the original contract,
   * `api.ts`'s `CollectionRow.family_wide_kind` is the wire mirror).
   *
   * Normalized to `null` here, never left `undefined`: the wire field is
   * OPTIONAL (a pre-Phase-30 response, or one served mid-rolling-restart, can
   * omit the key entirely), and this store is what every UI consumer reads, so
   * the "absent" and "explicitly null" cases must be indistinguishable by the
   * time they get here. */
  familyWideKind: string | null;
  /** CR-01 fix (30-REVIEW.md): the server's own
   * `collections.family_wide_access_level` -- the access level THIS
   * family-wide share was created at, `null` for an ordinary collection and
   * for a family-wide collection created before this column existed.
   * Normalized to `null` the same way `familyWideKind` is above. NOT the
   * same value as `accessLevel` above (that is the CALLER's own held
   * level) -- every propagation path reads THIS field, never `accessLevel`,
   * to decide what level to hand a late joiner. */
  familyWideAccessLevel: string | null;
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

// 30-05-PLAN.md Task 2 (FSH-04/FAM-10 "the sharer is told, quietly") -- a
// SEPARATE listener registry from `listeners` above (which fires on every
// refresh, changed or not). This one fires ONLY when an already-known
// collection's raw `sealed_key` blob differs from what this module last saw
// for that same id -- a sign a re-key just ran (the caller's own key was
// unwrapped and re-sealed by another keyholder, per `rekey.ts`'s rotation).
// Never fires for a collection id appearing for the first time (a brand-new
// grant is not a re-key) -- see `lastSealedKeys` below.
export type CollectionRekeyedListener = (collectionId: string) => void;
const rekeyListeners = new Set<CollectionRekeyedListener>();

export function onCollectionRekeyed(listener: CollectionRekeyedListener): () => void {
  rekeyListeners.add(listener);
  return () => {
    rekeyListeners.delete(listener);
  };
}

function notifyRekeyListeners(collectionId: string): void {
  rekeyListeners.forEach((listener) => listener(collectionId));
}

// Module-private snapshot of each collection's RAW `sealed_key` blob, as of
// the last completed refresh -- persists across refreshes (unlike `rows`,
// which is re-fetched every call), since `collections` itself (the `Collection`
// interface above) does not carry the raw sealed_key at all. This is the
// only place that value survives between two calls, which is what makes a
// diff against the PREVIOUS refresh possible.
let lastSealedKeys = new Map<string, string>();

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

/** 26-VERIFICATION.md gap 1: the caller's OWN `collection_keys.access_level`
 * for a collection, or `undefined` when this store hasn't refreshed yet /
 * the server returned no level. Consumed synchronously by
 * `store.ts::decryptItemRow`'s collection-scoped arm, right next to its
 * existing `getCollectionKey` lookup.
 *
 * The two lookups are consistent by construction, which is what keeps this
 * from failing OPEN: a collection-scoped item only ever decrypts when
 * `getCollectionKey` returns a key, and both values are written from the
 * SAME `listCollections()` row in the same `refreshCollections` pass. There
 * is no window in which an item renders decrypted while its access level is
 * still unknown. */
export function getCollectionAccessLevel(collectionId: string): string | undefined {
  return collections.find((c) => c.id === collectionId)?.accessLevel ?? undefined;
}

/** 30-11 (FSH-01): "is this collection shared with the whole family?" — the
 * SYNCHRONOUS, zero-fetch boolean behind `ItemRow`'s family badge. Deliberately
 * the same `.find()`-with-fallback shape as `getCollectionAccessLevel` above:
 * it reads only already-refreshed in-memory metadata, so it has no promise to
 * be pending and therefore no loading or error state of its own — which is what
 * makes the badge "independent of recipient resolution by construction"
 * (30-UI-SPEC.md), rather than inheriting `useShareRecipients`' async shape.
 *
 * Fails CLOSED in every unknown case — a `null`/`undefined` id, an id absent
 * from the store, and a store that has not refreshed yet all return `false`,
 * never throw. The wrong direction to fail here would be badging an ordinary
 * person-to-person share as family-wide, which would tell the owner their item
 * is more widely shared than it is. */
export function isFamilyWideCollection(collectionId: string | null | undefined): boolean {
  return collections.find((c) => c.id === collectionId)?.familyWideKind != null;
}

/** Frees every cached Collection Key handle and clears the map — called on
 * lock (T-26-10: never leave WASM-held key material to a non-deterministic
 * FinalizationRegistry across a long-lived session).
 *
 * 28-03 (Task 4): exported (was module-private) so store.ts's own
 * `purgeSharedStateOnRemoval` can reuse it via `clearCollectionsOnRemoval`
 * below, mirroring the extension's `collections-store.ts::freeAllCollectionKeys`,
 * which was already exported for the identical reason. */
export function freeAllCollectionKeys(): void {
  collectionKeys.forEach((ck) => {
    ck.free?.();
  });
  collectionKeys.clear();
}

/** 28-03 (Task 4): the removal/suspension purge's own collections-side
 * counterpart — runs the IDENTICAL `freeAllCollectionKeys(); collections =
 * []; notifyListeners();` sequence the lock branch below already runs,
 * wrapped in its own named function so `store.ts`'s new purge routine calls
 * this instead of inlining the sequence a second time. Never touches
 * `personalItems`/`folders` (this module owns none of those) — KEY-06
 * adjacency by construction, since this module's own state IS the shared
 * scope.
 *
 * WR-05 fix (30-REVIEW.md): `lastSealedKeys` — the module-level snapshot
 * `notifyRekeyListeners` diffs against — used to be cleared by NOTHING, so a
 * same-tab account switch (this function's own caller, `store.ts`'s removal
 * purge) left the PREVIOUS account's sealed_key values sitting in the map.
 * Two members of the same family hold the SAME collection id with
 * DIFFERENT `sealed_key` blobs, so the next refresh under the NEW account
 * diffed its own fresh sealed_key against the OLD account's stale one and
 * fired a false "your share was re-encrypted" notice for every collection
 * they both hold. Resetting it here — alongside `collections`, which this
 * function already clears — closes that gap the same way the lock branch's
 * own full reload implicitly always did (a fresh module instance has no
 * stale entries to diff against). */
export function clearCollectionsOnRemoval(): void {
  freeAllCollectionKeys();
  collections = [];
  lastSealedKeys = new Map();
  notifyListeners();
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
  // WR-15 (code review, Phase 26): identity, not mere nullity -- a
  // lock-then-unlock cycle mid-flight installs a BRAND NEW WasmUserKey and
  // frees this one, so a `=== null` guard passes while `uk` is stale.
  if (getUnlockedUserKey() !== uk) {
    return;
  }

  // One identity-key resolution per refresh (not per row) — cached for the
  // duration of this call, freed in the `finally` below regardless of
  // outcome.
  const identityKey = await ensureOwnIdentityKeypair(uk);
  try {
    if (getUnlockedUserKey() !== uk) {
      return; // WR-15: see the identity check above
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
      nextCollections.push({
        id: row.id,
        name,
        accessLevel: row.access_level,
        // 30-11 Task 1: straight through, no transform — `?? null` only
        // collapses the OPTIONAL wire field's `undefined` (key absent) into
        // this store's declared `string | null`, so consumers never have to
        // distinguish "server omitted it" from "server said null".
        familyWideKind: row.family_wide_kind ?? null,
        familyWideAccessLevel: row.family_wide_access_level ?? null,
      });
    }
    // WR-02 (code review, Phase 26): evict every cached key whose collection
    // the server no longer returns. `refreshCollections` rebuilt
    // `collections` wholesale but only ever wrote INTO `collectionKeys`, so
    // after a revocation (which `store.ts::handleSharedRevisions` explicitly
    // purges `collectionSharedItems` for) the unwrapped `WasmCollectionKey`
    // for that collection stayed in the map until lock. That is both an
    // unfreed WASM handle holding live key material -- the exact hazard
    // class this module's own header claims to guard, T-26-10 -- and a stale
    // capability: `getCollectionKey(id)` kept handing out a usable key for a
    // collection this caller no longer has access to.
    const liveIds = new Set(rows.map((row) => row.id));
    for (const [id, ck] of Array.from(collectionKeys.entries())) {
      if (!liveIds.has(id)) {
        ck.free?.();
        collectionKeys.delete(id);
      }
    }

    // 30-05-PLAN.md Task 2: diff the PREVIOUS `sealed_key` snapshot against
    // the freshly-fetched `rows`, BEFORE reassigning `collections` below.
    // Fires the rekey-notice callback only for an id that was ALREADY in
    // `lastSealedKeys` (an already-known collection) whose sealed_key value
    // genuinely differs -- never for an id absent from the old map (a
    // brand-new grant is not a re-key).
    const previousSealedKeys = lastSealedKeys;
    const nextSealedKeys = new Map<string, string>();
    for (const row of rows) {
      if (row.sealed_key !== null) {
        nextSealedKeys.set(row.id, row.sealed_key);
        const prior = previousSealedKeys.get(row.id);
        if (prior !== undefined && prior !== row.sealed_key) {
          notifyRekeyListeners(row.id);
        }
      }
    }
    lastSealedKeys = nextSealedKeys;

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
    // 28-03 (Task 4): now routed through the named clearCollectionsOnRemoval()
    // helper — identical sequence, single implementation for both the lock
    // path and store.ts's own removal purge.
    clearCollectionsOnRemoval();
  }
});
