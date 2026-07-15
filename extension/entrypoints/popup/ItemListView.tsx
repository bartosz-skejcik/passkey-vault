// ItemListView.tsx — browse/search/pick surface (09-UI-SPEC.md's "Item
// List + Search" section) PLUS the BINDING (Bartek 2026-07-15, NordPass
// reference screenshots) "Popup header + delegated-management
// affordances": settings gear + "open full vault" in a slim header row,
// a "+" new-item FAB, and an auto-lock-only footer -- ALL THREE
// redirects are PURE tabs.create() opens of the configured server URL,
// never in-popup forms (EXT-06's doctrine).
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Search, Settings, ExternalLink, Plus, KeyRound, CreditCard, IdCard, StickyNote, Timer } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { searchItems, filterItems } from "../../lib/vault/search";
import type { VaultItem, ItemType } from "../../lib/vault/types";
import { t, interpolate, type Locale } from "../../lib/i18n/dictionary";

// Duplicated from entrypoints/background/autolock.ts's AUTOLOCK_OPTIONS
// constant -- NOT imported directly, since that file (and its
// background-only import chain, down to the generated WASM bindings) is
// background-context code; importing it here would put WASM-adjacent
// modules in the popup's bundle graph even though this particular
// constant is inert data (D-05's spirit, not just its letter). Keep the
// two arrays in sync by hand.
const AUTOLOCK_OPTIONS = [5, 15, 30, 60] as const;

// KeyRound is used for `login` items in the popup per this plan's own
// action text ("KeyRound teal/muted, CreditCard, IdCard, StickyNote") --
// a deliberate popup-specific choice, always rendered MUTED here (never
// teal): teal is reserved for actual `type: "passkey"` items with PRF
// capability, a type that doesn't exist in the data model yet (Phase 12).
// `totp` has no icon named in 09-UI-SPEC.md's enumerated four -- `Timer`
// is a Claude's-discretion addition (same icon web/ItemRow.tsx already
// uses for the same type), flagged for UI-checker review.
const TYPE_ICON: Record<ItemType, typeof KeyRound> = {
  login: KeyRound,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
  totp: Timer,
};

const TYPE_LABEL_KEY: Record<ItemType, "itemType.login" | "itemType.card" | "itemType.identity" | "itemType.note" | "itemType.totp"> = {
  login: "itemType.login",
  card: "itemType.card",
  identity: "itemType.identity",
  note: "itemType.note",
  totp: "itemType.totp",
};

export default function ItemListView({
  locale,
  onSelectItem,
}: {
  locale: Locale;
  onSelectItem: (item: VaultItem) => void;
}) {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [query, setQuery] = useState("");
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(15);

  async function refetchItems() {
    const result = await sendMessage({ kind: "vault.list" });
    setItems(result.items);
  }

  useEffect(() => {
    void refetchItems();
    void sendMessage({ kind: "session.status" }).then((status) => {
      if (status.kind === "unlocked") {
        setAutoLockMinutes(status.autoLockMinutes);
      }
    });

    function onBroadcast(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "vault.updated"
      ) {
        void refetchItems();
      }
    }
    browser.runtime.onMessage.addListener(onBroadcast);
    return () => browser.runtime.onMessage.removeListener(onBroadcast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openInNewTab(pathSuffix: string) {
    const config = await sendMessage({ kind: "config.get" });
    if (config === null) {
      return;
    }
    await browser.tabs.create({ url: `${config.baseUrl}${pathSuffix}` });
  }

  async function handleAutoLockChange(minutes: number) {
    setAutoLockMinutes(minutes);
    await sendMessage({ kind: "session.setAutoLockMinutes", minutes });
  }

  // filterItems is a no-op {kind:"all"} pass this phase (no folder/tag
  // filter UI exists in the popup yet -- CONTEXT.md's locked scope), but
  // composed here anyway, mirroring web/src/components/vault/ItemList.tsx's
  // exact `searchItems(filterItems(items, filter), query)` composition so
  // a future folder/tag filter slots in without restructuring this call.
  const results = searchItems(filterItems(items, { kind: "all" }), query);
  const trimmedQuery = query.trim();

  return (
    <div className="flex w-[380px] flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <button
          type="button"
          aria-label={t(locale, "nav.settings")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={() => void openInNewTab("/?panel=settings")}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openInNewTab("")}>
          <ExternalLink size={16} aria-hidden="true" />
          {t(locale, "vault.openFullVault")}
        </button>
      </div>

      <div className="relative px-1">
        <Search
          size={16}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base-content/50"
          aria-hidden="true"
        />
        <input
          type="text"
          className="input input-bordered w-full pl-8"
          placeholder={t(locale, "search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="relative flex min-h-[120px] flex-col divide-y divide-base-300 overflow-y-auto">
        {trimmedQuery !== "" && results.length === 0 ? (
          // Distinct from the zero-items-ever-created empty state below --
          // this is "zero matches for a live query", checked FIRST so a
          // query typed against an also-empty vault still renders the
          // search-specific line, not the generic "vault empty" one.
          <p className="px-4 py-8 text-center text-base text-base-content/60">
            {interpolate(t(locale, "search.emptyResults"), { query: trimmedQuery })}
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <p className="text-base">{t(locale, "vault.emptyHeading")}</p>
            <p className="text-sm text-base-content/60">{t(locale, "vault.emptyBody")}</p>
          </div>
        ) : (
          results.map((item) => {
            const Icon = TYPE_ICON[item.fields.type];
            const typeLabel = t(locale, TYPE_LABEL_KEY[item.fields.type]);
            const subtitle =
              item.fields.type === "login"
                ? item.fields.username
                : item.fields.type === "totp"
                  ? item.fields.issuer || typeLabel
                  : typeLabel;
            return (
              <button
                key={item.id}
                type="button"
                className="flex min-h-[48px] items-center gap-2 px-2 py-2 text-left hover:bg-base-200"
                onClick={() => onSelectItem(item)}
              >
                <Icon size={20} className="shrink-0 text-base-content/60" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base">{item.fields.name}</span>
                  <span className="truncate text-sm text-base-content/60">{subtitle}</span>
                </span>
              </button>
            );
          })
        )}

        <button
          type="button"
          aria-label={t(locale, "nav.newItem")}
          className="btn btn-primary btn-circle btn-sm absolute bottom-2 right-2"
          onClick={() => void openInNewTab("/?action=new-item")}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-base-300 px-1 pt-2">
        <label htmlFor="pv-autolock" className="text-sm text-base-content/70">
          {t(locale, "autolock.label")}
        </label>
        <select
          id="pv-autolock"
          className="select select-bordered select-sm"
          value={autoLockMinutes}
          onChange={(e) => void handleAutoLockChange(Number(e.target.value))}
        >
          {AUTOLOCK_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
