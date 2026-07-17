// NordPass-style last-used tracking (quick-260717) + the popup UI round's
// visible sort control (Bartek-decided, FINAL): mirrors web/src/lib/vault/
// sort.ts's own SortOption/sortItems shape and PL/EN option labels exactly,
// so the two never drift. Unlike the web version (synchronous
// localStorage), this popup-local preference is persisted via
// `browser.storage.local` (async, chrome.storage has no sync read API) —
// same choke-point-free storage convention lib/autofill/blocked-origins.ts
// and lib/theme/theme-mirror.ts already use.
import { browser } from "wxt/browser";
import type { VaultItem } from "./types";

export type SortOption = "lastUsed" | "name";

export const DEFAULT_SORT: SortOption = "lastUsed";

const STORAGE_KEY = "pv-popup-sort";

function isSortOption(value: unknown): value is SortOption {
  return value === "lastUsed" || value === "name";
}

/** Reads the persisted sort choice — defaults to "lastUsed" (the locked
 * default) for a fresh install/no prior choice, and fails open to that same
 * default on any corrupt/missing storage read. */
export async function readSortPreference(): Promise<SortOption> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = (result as Record<string, unknown>)[STORAGE_KEY];
  return isSortOption(stored) ? stored : DEFAULT_SORT;
}

export async function writeSortPreference(sort: SortOption): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: sort });
}

function byName(a: VaultItem, b: VaultItem): number {
  return a.fields.name.localeCompare(b.fields.name);
}

/** Sorts a (already filtered/searched/deduplicated) item array by the given
 * option. Never mutates its input — returns a new array.
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

/** Kept for `sort.test.ts`'s existing coverage and as the pre-sort-control
 * default comparator — equivalent to `sortItems(items, "lastUsed")`. */
export function sortByLastUsed(items: VaultItem[]): VaultItem[] {
  return sortItems(items, "lastUsed");
}
