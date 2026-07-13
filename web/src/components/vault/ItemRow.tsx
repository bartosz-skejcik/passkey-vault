"use client";

import { CreditCard, IdCard, StickyNote, Vault } from "lucide-react";
import type { ItemType, VaultItem } from "@/lib/vault/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { DICTIONARY } from "@/lib/i18n/dictionary";

// Documented decision (T-02-18): no per-domain favicon fetch of any kind
// exists anywhere in this directory — the neutral type-icon alone satisfies
// UI-03's baseline visual-differentiator requirement, per RESEARCH.md's
// finding that third-party favicon services leak visited-site metadata.
// Favicon fetching is scoped out of Phase 2, not an oversight.
const TYPE_ICON: Record<ItemType, typeof Vault> = {
  login: Vault,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
};

const TYPE_LABEL_KEY: Record<ItemType, keyof typeof DICTIONARY> = {
  login: "itemType.login",
  card: "itemType.card",
  identity: "itemType.identity",
  note: "itemType.note",
};

export default function ItemRow({
  item,
  selected,
  onClick,
}: {
  item: VaultItem;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  const Icon = TYPE_ICON[item.fields.type];
  const typeLabel = t(TYPE_LABEL_KEY[item.fields.type]);
  const subtitle = item.fields.type === "login" ? item.fields.username : typeLabel;

  return (
    <button
      type="button"
      data-testid={`item-row-${item.id}`}
      onClick={onClick}
      className={`flex h-16 w-full items-center gap-2 px-4 text-left transition-colors ${
        selected
          ? "border-l-2 border-primary bg-primary/[0.08]"
          : "border-l-2 border-transparent hover:bg-base-content/[0.06]"
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-base-200 text-base-content/70">
        <Icon size={18} aria-hidden="true" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="truncate text-base">{item.fields.name}</span>
        <span className="truncate text-sm text-base-content/60">{subtitle}</span>
      </span>

      <span className="badge badge-sm gap-1 whitespace-nowrap bg-base-200 text-base-content/70">
        <Icon size={12} aria-hidden="true" />
        {typeLabel}
      </span>

      <span
        className="h-2 w-2 shrink-0 rounded-full bg-base-content/20"
        aria-hidden="true"
        title="Password Health — wkrótce"
      />
    </button>
  );
}
