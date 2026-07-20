// Split-shim — the pure comparator (SortOption/DEFAULT_SORT/sortItems) now
// lives in packages/pv-ui/vault/sort.ts (DS-01, plan 16-05: pv-ui is the
// single source of truth for the sort comparator, shared by web and
// extension). readSortPreference()/writeSortPreference() stay local: this
// popup variant is persisted via `browser.storage.local` (async, no sync
// read API), genuinely platform-specific per CONTEXT.md's locked decision,
// so it is NOT re-exported from pv-ui. sortByLastUsed() also stays local
// (sort.test.ts's existing coverage), calling the now-shared sortItems().
import { browser } from "wxt/browser";
import { sortItems } from "pv-ui/vault/sort";
import type { VaultItem } from "./types";

export { type SortOption, DEFAULT_SORT, sortItems } from "pv-ui/vault/sort";

const STORAGE_KEY = "pv-popup-sort";

function isSortOption(value: unknown): value is import("pv-ui/vault/sort").SortOption {
  return value === "lastUsed" || value === "name";
}

/** Reads the persisted sort choice — defaults to "lastUsed" (the locked
 * default) for a fresh install/no prior choice, and fails open to that same
 * default on any corrupt/missing storage read. */
export async function readSortPreference(): Promise<import("pv-ui/vault/sort").SortOption> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = (result as Record<string, unknown>)[STORAGE_KEY];
  return isSortOption(stored) ? stored : "lastUsed";
}

export async function writeSortPreference(
  sort: import("pv-ui/vault/sort").SortOption,
): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: sort });
}

/** Kept for `sort.test.ts`'s existing coverage and as the pre-sort-control
 * default comparator — equivalent to `sortItems(items, "lastUsed")`. */
export function sortByLastUsed(items: VaultItem[]): VaultItem[] {
  return sortItems(items, "lastUsed");
}
