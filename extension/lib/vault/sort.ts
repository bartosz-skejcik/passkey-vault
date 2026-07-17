// NordPass-style last-used tracking (quick-260717): the popup's
// "Wszystkie"/"All" section (ItemListView.tsx) default-sorts by lastUsedAt
// desc, nulls (never-touched items) last by name. Unlike web/src/lib/vault/
// sort.ts, this round does NOT add a visible sort control in the popup --
// default-only (noted for a future UI round) -- so there is no "name" mode
// or localStorage persistence here, just the one comparator ItemListView
// needs.
import type { VaultItem } from "./types";

function byName(a: VaultItem, b: VaultItem): number {
  return a.fields.name.localeCompare(b.fields.name);
}

/** Sorts by `lastUsedAt` descending (most recently used first); items that
 * have NEVER been touched (`lastUsedAt` undefined) sink to the bottom,
 * sorted alphabetically by name among themselves. Never mutates its input. */
export function sortByLastUsed(items: VaultItem[]): VaultItem[] {
  const copy = [...items];
  return copy.sort((a, b) => {
    if (a.lastUsedAt && b.lastUsedAt) {
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    }
    if (a.lastUsedAt && !b.lastUsedAt) return -1;
    if (!a.lastUsedAt && b.lastUsedAt) return 1;
    return byName(a, b);
  });
}
