// Split-shim — the pure comparator (SortOption/DEFAULT_SORT/sortItems) now
// lives in packages/pv-ui/vault/sort.ts (DS-01, plan 16-05: pv-ui is the
// single source of truth for the sort comparator, shared by web and
// extension). readSortPreference()/writeSortPreference() stay local: this
// web variant uses synchronous localStorage under a web-specific storage
// key, genuinely platform-specific persistence per CONTEXT.md's locked
// decision, so it is NOT re-exported from pv-ui.
export { type SortOption, DEFAULT_SORT, sortItems } from "pv-ui/vault/sort";

const STORAGE_KEY = "pv-vault-sort";

function isSortOption(value: string | null): value is import("pv-ui/vault/sort").SortOption {
  return value === "lastUsed" || value === "name";
}

/** Reads the persisted sort choice — defaults to "lastUsed" (this task's
 * locked default) for a fresh browser/no prior choice, and tolerates a
 * `window`-less environment (SSR/tests) by returning the same default. */
export function readSortPreference(): import("pv-ui/vault/sort").SortOption {
  if (typeof window === "undefined") return "lastUsed";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isSortOption(raw) ? raw : "lastUsed";
}

export function writeSortPreference(sort: import("pv-ui/vault/sort").SortOption): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, sort);
}
