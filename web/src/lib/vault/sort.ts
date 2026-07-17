// List sort control (quick-260717, NordPass-style last-used tracking) —
// pure comparator + localStorage persistence, mirrors search.ts's own
// "pure client-side over the in-memory decrypted array" shape. Called by
// ItemList after filterItems()/searchItems() so the sidebar filter and the
// search query still narrow the set BEFORE ordering is applied.
import type { VaultItem } from "./types";

export type SortOption = "lastUsed" | "name";

export const DEFAULT_SORT: SortOption = "lastUsed";

const STORAGE_KEY = "pv-vault-sort";

function isSortOption(value: string | null): value is SortOption {
  return value === "lastUsed" || value === "name";
}

/** Reads the persisted sort choice — defaults to "lastUsed" (this task's
 * locked default) for a fresh browser/no prior choice, and tolerates a
 * `window`-less environment (SSR/tests) by returning the same default. */
export function readSortPreference(): SortOption {
  if (typeof window === "undefined") return DEFAULT_SORT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isSortOption(raw) ? raw : DEFAULT_SORT;
}

export function writeSortPreference(sort: SortOption): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, sort);
}

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
