"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { useFolders } from "@/lib/vault/store";
import { interpolate } from "@/lib/i18n/dictionary";
import { ITEM_TYPE_LABEL_KEY } from "@/lib/vault/itemTypeLabels";
import { DEFAULT_SORT, type SortOption } from "@/lib/vault/sort";
import type { VaultFilter } from "@/lib/vault/types";

/** Bartek live-review round 3 (TASK 1): the heading above the item list
 * now names the ACTIVE filter instead of always reading the static "Vault".
 * "all" and "itemType" reuse the exact same sidebar / itemType dictionary
 * keys the Sidebar's own nav buttons use (so the two copies never drift);
 * "folder" looks the live folder name up by id (falling back to
 * "item.noFolder" if a stale filter ever points at a deleted folder); "tag"
 * interpolates the raw tag string into a dedicated template key. */
function headingFor(
  filter: VaultFilter,
  folders: ReturnType<typeof useFolders>,
  t: ReturnType<typeof useLocale>["t"],
): string {
  switch (filter.kind) {
    case "all":
      return t("sidebar.all");
    case "itemType":
      return t(ITEM_TYPE_LABEL_KEY[filter.itemType]);
    case "folder": {
      const folder = folders.find((f) => f.id === filter.id);
      return folder ? folder.name : t("item.noFolder");
    }
    case "tag":
      return interpolate(t("vault.tagFilterHeading"), { tag: filter.tag });
  }
}

export default function MainColumn({
  children,
  showEmptyState = true,
  filter = { kind: "all" },
  sortBy = DEFAULT_SORT,
  onSortChange,
}: {
  children: ReactNode;
  // Zero-items-ever-created Fuzzy-Bubbles empty state — distinct from
  // ItemList's own "zero search matches" state. Defaults to true so any
  // pre-existing call site (there were none touching real data before
  // this plan) keeps its prior always-shown behavior.
  showEmptyState?: boolean;
  // Sidebar's active filter (VaultFilter) — drives the dynamic heading
  // above. Defaults to "all" so any caller that hasn't wired filter state
  // through yet still renders the correct "Wszystkie"/"All" heading.
  filter?: VaultFilter;
  // NordPass-style last-used sort control (quick-260717), rendered next to
  // the dynamic heading — page.tsx owns/persists the actual selection
  // (lib/vault/sort.ts). Omitted entirely (no control rendered) when
  // `onSortChange` isn't provided, so any caller that hasn't wired sort
  // state through yet keeps its prior heading-only layout.
  sortBy?: SortOption;
  onSortChange?: (next: SortOption) => void;
}) {
  const { t } = useLocale();
  const folders = useFolders();
  const heading = headingFor(filter, folders, t);
  return (
    <main className="flex-1 overflow-y-auto bg-base-300 p-4 md:p-8">
      <div className="mx-auto flex max-w-[720px] flex-col">
        <div className="flex items-center justify-between gap-2">
          <h1 data-testid="main-column-heading" className="text-[28px] font-bold leading-[1.15]">
            {heading}
          </h1>
          {onSortChange ? (
            <label className="flex shrink-0 items-center gap-2 text-sm text-base-content/70">
              <span className="hidden sm:inline">{t("sort.label")}</span>
              <select
                data-testid="sort-select"
                aria-label={t("sort.label")}
                className="select select-bordered select-sm"
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value as SortOption)}
              >
                <option value="lastUsed">{t("sort.lastUsed")}</option>
                <option value="name">{t("sort.name")}</option>
              </select>
            </label>
          ) : null}
        </div>

        {showEmptyState ? (
          <div className="mt-4 flex flex-col gap-1">
            <h2 className="text-[20px] font-bold leading-[1.2]">{t("vault.emptyHeading")}</h2>
            <p className="font-[family-name:var(--font-hand)] text-base leading-[1.5]">
              {t("vault.emptyBody")}
            </p>
          </div>
        ) : null}

        <div className={showEmptyState ? "mt-12" : "mt-4"}>{children}</div>
      </div>
    </main>
  );
}
