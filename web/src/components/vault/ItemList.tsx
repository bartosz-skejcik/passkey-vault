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
  // WR-03 fix (30-REVIEW.md): a synthetic `pendingFamilyKey` placeholder row
  // (`store.ts::pendingFamilyKeyRows`) is built with a real, concrete
  // `fields.type: "note"` purely to satisfy `VaultItem`'s shape — it is
  // never rendered as a note (`ItemRow`/`DetailPanel`/`ExportDialog` all
  // branch on `pendingFamilyKey` before reading `fields`). `filterItems`
  // matches on `fields.type`, so without this exclusion a `{kind:"itemType",
  // itemType:"note"}` sidebar filter rendered the placeholder inside the
  // Notes list — asserting a type this member cannot actually read. Excluded
  // from every SCOPED view (any filter other than "all", under which a
  // pending row still belongs — that is the whole point of 30-15's honesty
  // feature); `filter.kind === "all"` is the one case where none of
  // `filterItems`'s type/tag/folder predicates could misrepresent it.
  const base = filter.kind === "all" ? items : items.filter((i) => i.pendingFamilyKey !== true);
  // Sidebar's folder/tag filter ANDs with the search query — both are
  // purely client-side over the same in-memory decrypted array. Sort is
  // applied LAST, after filtering/searching narrows the set.
  const results = sortItems(searchItems(filterItems(base, filter), searchQuery), sortBy);

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
