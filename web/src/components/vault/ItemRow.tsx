"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Share2, Users } from "lucide-react";
import type { ItemType, VaultItem } from "@/lib/vault/types";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate, type DICTIONARY } from "@/lib/i18n/dictionary";
import { formatRelativeTime } from "@/lib/format/relativeTime";
import ItemContextMenu from "./ItemContextMenu";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import TotpCountdownRing from "./TotpCountdownRing";
import ItemIconTile from "./ItemIconTile";
import AvatarStack from "./AvatarStack";
import { isFamilyWideCollection, useCollections } from "@/lib/vault/collections";

const TYPE_LABEL_KEY: Record<ItemType, keyof typeof DICTIONARY> = {
  login: "itemType.login",
  card: "itemType.card",
  identity: "itemType.identity",
  note: "itemType.note",
  totp: "itemType.totp",
  passkey: "itemType.passkey",
};

/** Masks a card number down to its last 4 digits for the list row (Proton
 * Pass-inspired subtitle), e.g. "4111 1111 1111 1111" -> "•••• 1111". The
 * full number must NEVER render in the list — only DetailPanel's explicit
 * reveal toggle shows it. `null` (no subtitle rendered) when the number is
 * empty/absent, per Bartek's live-review spec — never a fake/empty mask. */
function maskedCardLast4(number: string): string | null {
  const digits = number.replace(/[\s-]/g, "");
  if (!digits) return null;
  return `•••• ${digits.slice(-4)}`;
}

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
  // 30-11 (FSH-01): subscribes this row to the collections store WITHOUT
  // reading its value — `isFamilyWideCollection` below reads the same store
  // synchronously, so the array itself is never needed here. The subscription
  // is what keeps the badge from being merely "correct once": `collections`
  // is populated by an async refresh that can land AFTER the item list has
  // already painted (items and collections are two independent unlock-time
  // fetches with no ordering between them), and a plain module-function read
  // in the render body does not re-run on its own. Without this, a family-wide
  // item could render badge-less until some unrelated state change forced a
  // re-render — true in a test that renders after the store is primed, false
  // in the running app.
  useCollections();
  const typeLabel = t(TYPE_LABEL_KEY[item.fields.type]);
  // Proton Pass-inspired passkey row (Bartek live-review): the site (rpId)
  // is the primary text, the account (username, falling back to the
  // provider-supplied display name) is the subtitle — NOT the synthesized
  // `fields.name` (that stays the identity/search-stable value normalized
  // in lib/vault/types.ts; this is display-only).
  const primaryText = item.fields.type === "passkey" ? item.fields.rpId : item.fields.name;
  const subtitle: string | null =
    item.fields.type === "login"
      ? item.fields.username
      : item.fields.type === "totp"
        ? item.fields.issuer || typeLabel
        : item.fields.type === "passkey"
          ? (item.fields.username ?? item.fields.userDisplayName ?? null)
          : item.fields.type === "card"
            ? maskedCardLast4(item.fields.number)
            : typeLabel;
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
      // Bottom edge (bug: Bartek live-review, screenshot-verified): the
      // gray line under a selected row previously came ENTIRELY from the
      // *next* row's divide-y top border (ItemList's `divide-y`), so a
      // selected row with no following sibling — the sole item in a
      // 1-item list, or the last row of any longer list — rendered with
      // no bottom edge at all. `last:border-b last:border-base-300` makes
      // the row own its bottom edge whenever it IS the last child, using
      // the exact color/width divide-y already uses for every other
      // boundary. It only ever applies on `:last-child`, so a selected
      // row with a following sibling still gets its sole bottom line from
      // that sibling's divide-y top border — no double-border artifact.
      className={`group flex h-16 w-full items-center gap-2 px-4 transition-colors ${
        selected
          ? "border-l-2 border-primary bg-primary/[0.08] last:border-b last:border-base-300"
          : "border-l-2 border-transparent hover:bg-base-content/[0.06]"
      }`}
    >
      <button
        type="button"
        data-testid={`item-row-select-${item.id}`}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <ItemIconTile item={item} />

        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="truncate text-base">{primaryText}</span>
          {subtitle !== null ? (
            <span className="truncate text-sm text-base-content/60">{subtitle}</span>
          ) : null}
        </span>
      </button>

      {/* D-3/E5 (26-UI-SPEC.md): the shared-item marker, rendered inline with
          this row's existing metadata slot (near the relative-time/TOTP-ring
          area). Consumes the shared AvatarStack.tsx/useShareRecipients data
          source built in Plan 26-06 — never a re-implementation. `isShared`
          alone covers both a collection-scoped item and a direct
          item_shares grant (server's own is_shared column mirrors both);
          AvatarStack's own useShareRecipients hook dispatches on
          collectionId vs isShared internally and renders NOTHING (not a
          skeleton) while its data hasn't resolved yet — never blocks this
          row on a per-item fetch.

          CR-02 (code review, Phase 26): an item shared TO this caller
          (`sharedToMe`) is NOT an outgoing share and must not render the
          recipient stack — doing so told the user "you are sharing this
          with X" about an item a third party owns, and additionally fired a
          `listItemShares` fetch whose results were then attributed to the
          caller. It gets a direction-naming marker instead.

          30-11 (FSH-01): a THIRD branch sits between those two — an item in a
          family-wide collection gets a single `Users` badge INSTEAD OF
          AvatarStack, never alongside it. The locked decision (30-CONTEXT.md):
          "a five-person family rendered as five avatars is indistinguishable
          from five separate per-person shares," so the family case must be one
          marker with its own shape, not N circles. Placed AFTER the
          `sharedToMe` branch on purpose — that recipient-side marker is
          untouched by this phase (VIS-02 leaves the recipient view to Phase
          34), so a family-wide item shared TO this caller still renders exactly
          today's `item-shared-with-you` marker; being inside this chain's
          `else` is itself the "owner side only" guard. Its input is a
          synchronous store lookup, never `useShareRecipients` — the badge has
          no fetch of its own and so no loading or error state to get wrong. */}
      {item.sharedToMe === true ? (
        <span
          data-testid="item-shared-with-you"
          role="img"
          aria-label={t("sharing.sharedWithYouLabel")}
          title={t("sharing.sharedWithYouLabel")}
          className="inline-flex shrink-0 items-center text-secondary"
        >
          <Share2 size={14} aria-hidden="true" />
        </span>
      ) : isFamilyWideCollection(item.collectionId) ? (
        <span
          data-testid="item-row-family-badge"
          role="img"
          aria-label={t("vault.familyBadgeAria")}
          title={t("vault.familyBadgeAria")}
          className="inline-flex shrink-0 items-center text-secondary"
        >
          <Users size={14} aria-hidden="true" />
        </span>
      ) : item.isShared === true ? (
        <span className="shrink-0">
          <AvatarStack item={item} />
        </span>
      ) : null}

      {item.fields.type === "totp" ? (
        <TotpCountdownRing
          secretB32={item.fields.secret}
          algorithm={item.fields.algorithm}
          digits={item.fields.digits}
          period={item.fields.period}
          size={24}
        />
      ) : relativeTime !== null ? (
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
