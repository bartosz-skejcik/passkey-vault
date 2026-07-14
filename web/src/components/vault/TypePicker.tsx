"use client";

import { CreditCard, IdCard, StickyNote, Timer, Vault } from "lucide-react";
import type { ItemType } from "@/lib/vault/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { DICTIONARY } from "@/lib/i18n/dictionary";

// Same neutral treatment as ItemRow's type badges — no color-coding.
const TILES: { type: ItemType; icon: typeof Vault; labelKey: keyof typeof DICTIONARY }[] = [
  { type: "login", icon: Vault, labelKey: "itemType.login" },
  { type: "card", icon: CreditCard, labelKey: "itemType.card" },
  { type: "identity", icon: IdCard, labelKey: "itemType.identity" },
  { type: "note", icon: StickyNote, labelKey: "itemType.note" },
  { type: "totp", icon: Timer, labelKey: "itemType.totp" },
];

export default function TypePicker({ onSelect }: { onSelect: (type: ItemType) => void }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[20px] font-bold leading-[1.2]">{t("item.typePicker")}</h2>
      <div className="grid grid-cols-2 gap-3">
        {TILES.map(({ type, icon: Icon, labelKey }) => (
          <button
            key={type}
            type="button"
            data-testid={`type-tile-${type}`}
            className="flex flex-col items-center gap-2 rounded-box border border-base-300 bg-base-100 p-6 hover:bg-base-content/[0.06]"
            onClick={() => onSelect(type)}
          >
            <Icon size={24} className="text-base-content/70" aria-hidden="true" />
            <span className="text-base">{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
