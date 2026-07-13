"use client";

import { useVaultItems } from "@/lib/vault/store";
import { searchItems } from "@/lib/vault/search";
import type { VaultItem } from "@/lib/vault/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import ItemRow from "./ItemRow";

export default function ItemList({
  searchQuery,
  selectedItemId,
  onSelect,
}: {
  searchQuery: string;
  selectedItemId: string | null;
  onSelect: (item: VaultItem) => void;
}) {
  const { t } = useLocale();
  const items = useVaultItems();
  const results = searchItems(items, searchQuery);

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
        />
      ))}
    </div>
  );
}
