"use client";

import { useVaultItems } from "@/lib/vault/store";
import { filterItems, searchItems } from "@/lib/vault/search";
import { DEFAULT_SORT, sortItems, type SortOption } from "@/lib/vault/sort";
import type { VaultFilter, VaultItem } from "@/lib/vault/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import ItemRow from "./ItemRow";

export default function ItemList({
  searchQuery,
  filter = { kind: "all" },
  sortBy = DEFAULT_SORT,
  selectedItemId,
  onSelect,
  onEditRequest,
}: {
  searchQuery: string;
  filter?: VaultFilter;
  // Header-area sort control's chosen option (page.tsx owns/persists the
  // state; see lib/vault/sort.ts) — defaults to the locked "lastUsed"
  // default so any caller that hasn't wired it through yet keeps working.
  sortBy?: SortOption;
  selectedItemId: string | null;
  onSelect: (item: VaultItem) => void;
  onEditRequest?: (item: VaultItem) => void;
}) {
  const { t } = useLocale();
  const items = useVaultItems();
  // Sidebar's folder/tag filter ANDs with the search query — both are
  // purely client-side over the same in-memory decrypted array. Sort is
  // applied LAST, after filtering/searching narrows the set.
  const results = sortItems(searchItems(filterItems(items, filter), searchQuery), sortBy);

  // Distinct from the zero-items-ever-created Fuzzy-Bubbles empty state
  // (MainColumn owns that one) — this is "zero matches for a live query".
  if (searchQuery.trim() !== "" && results.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-base text-base-content/60">
        {t("search.emptyResults").replace("{query}", searchQuery)}
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-base-300">
      {results.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          selected={item.id === selectedItemId}
          onClick={() => onSelect(item)}
          onEditRequest={onEditRequest}
        />
      ))}
    </div>
  );
}
