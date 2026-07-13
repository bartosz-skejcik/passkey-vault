"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, IdCard, MoreVertical, StickyNote, Vault } from "lucide-react";
import type { ItemType, VaultItem } from "@/lib/vault/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate, type DICTIONARY } from "@/lib/i18n/dictionary";
import { formatRelativeTime } from "@/lib/format/relativeTime";
import ItemContextMenu from "./ItemContextMenu";
import DeleteConfirmDialog from "./DeleteConfirmDialog";

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
  onEditRequest,
}: {
  item: VaultItem;
  selected: boolean;
  onClick: () => void;
  // Distinct from onClick (gap-review WR-01): a plain row click and a
  // context-menu "Edit" choice must lead to different panel modes
  // (view vs. edit), so the context menu needs its own handler instead of
  // reusing onClick. Optional + falls back to onClick so callers that only
  // care about selection (e.g. existing tests) don't need to supply it.
  onEditRequest?: (item: VaultItem) => void;
}) {
  const { t, locale } = useLocale();
  const Icon = TYPE_ICON[item.fields.type];
  const typeLabel = t(TYPE_LABEL_KEY[item.fields.type]);
  const subtitle = item.fields.type === "login" ? item.fields.username : typeLabel;
  const relativeTime = formatRelativeTime(item.updatedAt, t, locale);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement>(null);

  // This menu is explicitly state-driven (via the `dropdown-open` class)
  // rather than relying on the CSS focus-within collapse the rest of the
  // app's dropdowns use, because a right-click trigger does not reliably
  // move DOM focus the way a click does — a document-level click-outside
  // listener is required to close it.
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (menuWrapperRef.current && !menuWrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  return (
    // Plain container, deliberately NOT role="button" — the kebab trigger
    // and its ItemContextMenu below are interactive descendants, and the
    // ARIA spec forbids focusable/interactive content inside a button-roled
    // element (gap-review WR-04). Selection now activates via the native
    // <button> below instead, which is a sibling — not a descendant — of
    // the kebab, and gets Enter/Space activation + focusability for free
    // from being a real <button>, no manual key handling required.
    <div
      data-testid={`item-row-${item.id}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(true);
      }}
      className={`group flex h-16 w-full items-center gap-2 px-4 transition-colors ${
        selected
          ? "border-l-2 border-primary bg-primary/[0.08]"
          : "border-l-2 border-transparent hover:bg-base-content/[0.06]"
      }`}
    >
      <button
        type="button"
        data-testid={`item-row-select-${item.id}`}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-base-200 text-base-content/70">
          <Icon size={18} aria-hidden="true" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="truncate text-base">{item.fields.name}</span>
          <span className="truncate text-sm text-base-content/60">{subtitle}</span>
        </span>
      </button>

      {relativeTime !== null ? (
        <span className="shrink-0 whitespace-nowrap text-xs text-base-content/50">
          {relativeTime}
        </span>
      ) : null}

      <div
        ref={menuWrapperRef}
        className={`dropdown dropdown-end ${menuOpen ? "dropdown-open" : ""}`}
        // Every click inside the trigger/menu (copy/move/edit/delete-request)
        // must never bubble up into the row's selection button (they're no
        // longer nested inside it, but both are still children of this same
        // flex row) — a single stopPropagation here covers the kebab button
        // and every ItemContextMenu action without each needing its own.
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          data-testid={`item-menu-trigger-${item.id}`}
          aria-label={interpolate(t("aria.itemMenu"), { name: item.fields.name })}
          className="btn btn-ghost btn-square btn-sm shrink-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreVertical size={16} aria-hidden="true" />
        </button>

        {menuOpen ? (
          <ItemContextMenu
            item={item}
            onClose={() => setMenuOpen(false)}
            onEdit={() => (onEditRequest ? onEditRequest(item) : onClick())}
            onDeleteRequest={() => {
              setMenuOpen(false);
              setShowDeleteDialog(true);
            }}
          />
        ) : null}
      </div>

      {showDeleteDialog ? (
        // stopPropagation wrapper: DeleteConfirmDialog's own backdrop-click
        // only stops propagation for clicks inside its inner panel, so
        // without this wrapper a backdrop/cancel/confirm click would bubble
        // into the row's onClick and re-select/open the item as a side
        // effect of dismissing or confirming the delete.
        <div onClick={(e) => e.stopPropagation()}>
          <DeleteConfirmDialog
            item={item}
            onClose={() => setShowDeleteDialog(false)}
            onDeleted={() => setShowDeleteDialog(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
