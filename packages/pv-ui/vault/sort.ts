// List sort comparator (quick-260717, NordPass-style last-used tracking) —
// pure comparator only. Persistence (readSortPreference/writeSortPreference)
// is genuinely platform-specific (sync localStorage on web vs async
// browser.storage.local on the extension, different storage keys) and stays
// local to each consumer's own lib/vault/sort.ts split-shim (DS-01, plan
// 16-05) -- this module is the phase's one split-shim source, not a pure
// `export *` candidate.
import type { VaultItem } from "./types";

export type SortOption = "lastUsed" | "name";

export const DEFAULT_SORT: SortOption = "lastUsed";

function byName(a: VaultItem, b: VaultItem): number {
  return a.fields.name.localeCompare(b.fields.name);
}

/** Sorts a (already filtered/searched) item array by the given option.
 * Never mutates its input — returns a new array, matching every other
 * lib/vault helper's copy-on-write convention (store.ts's own item-array
 * updates).
 *
 * "lastUsed": descending by `lastUsedAt` (most recently used first); items
 * that have NEVER been touched (`lastUsedAt` undefined) sink to the bottom,
 * sorted alphabetically by name among themselves — matching NordPass' own
 * "never used" tail-of-list convention.
 * "name": ascending alphabetical, ignoring lastUsedAt entirely. */
export function sortItems(items: VaultItem[], sortBy: SortOption): VaultItem[] {
  const copy = [...items];
  if (sortBy === "name") {
    return copy.sort(byName);
  }
  return copy.sort((a, b) => {
    if (a.lastUsedAt && b.lastUsedAt) {
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    }
    if (a.lastUsedAt && !b.lastUsedAt) return -1;
    if (!a.lastUsedAt && b.lastUsedAt) return 1;
    return byName(a, b);
  });
}
