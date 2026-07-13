"use client";

import { Search } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function TopBar({
  searchQuery = "",
  onSearchChange = () => {},
  onNewItem,
}: {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  onNewItem?: () => void;
}) {
  const { t } = useLocale();
  return (
    <header className="flex h-16 items-center gap-4 border-b border-base-300 bg-base-200 px-4 md:px-6">
      <label className="input input-bordered flex flex-1 max-w-md items-center gap-2">
        <Search size={16} aria-hidden="true" className="text-base-content/50" />
        <input
          type="text"
          data-testid="search-input"
          placeholder={t("search.placeholder")}
          className="grow bg-transparent outline-none"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <kbd className="kbd kbd-sm">⌘K</kbd>
      </label>

      <div className="flex-1" />

      <button
        type="button"
        data-testid="new-item-button"
        className="btn btn-primary btn-sm"
        onClick={onNewItem}
        disabled={!onNewItem}
      >
        {t("topbar.newItem")}
      </button>
    </header>
  );
}
