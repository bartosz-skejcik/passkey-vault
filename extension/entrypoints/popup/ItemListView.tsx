// ItemListView.tsx — browse/search/pick surface (09-UI-SPEC.md's "Item
// List + Search" section) PLUS the BINDING (Bartek 2026-07-15, NordPass
// reference screenshots) "Popup header + delegated-management
// affordances": settings gear + "open full vault" in a slim header row,
// a "+" new-item FAB, and an auto-lock-only footer -- settings/full-vault
// are PURE tabs.create() opens of the configured server URL.
//
// Post-UAT (Bartek 2026-07-15, live testing): the "+" FAB does NOT redirect
// directly. Per Bartek's NordPass reference screenshots, it first expands
// an in-popup TYPE MENU (Login / TOTP / Card / Identity / Note) -- only
// choosing a type then opens the fullscreen editor via tabs.create(), with
// the chosen type passed along as `&type=<id>` so the web app's TypePicker
// step is skipped. The menu itself is a plain DaisyUI `menu` list, never a
// form -- EXT-06's doctrine ("no in-popup forms") is about FORMS, not type
// menus, and stays intact.
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { Search, Settings, ExternalLink, Plus, Vault, CreditCard, IdCard, StickyNote, Timer } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { searchItems, filterItems } from "../../lib/vault/search";
import type { VaultItem, ItemType } from "../../lib/vault/types";
import { t, interpolate, type Locale } from "../../lib/i18n/dictionary";
// Phase 10 (Plan 10-06): the "On this page" autofill section -- the ONE
// visible surface Phase 10 adds, mounted here per 10-UI-SPEC.md's Scope
// Note ("every surface is a new section inside the existing popup shell").
// Owns its own useAutofillMatches() data fetch entirely internally; this
// view only needs to render it above the existing item list below.
import OnThisPageSection from "./autofill/OnThisPageSection";

// Duplicated from entrypoints/background/autolock.ts's AUTOLOCK_OPTIONS
// constant -- NOT imported directly, since that file (and its
// background-only import chain, down to the generated WASM bindings) is
// background-context code; importing it here would put WASM-adjacent
// modules in the popup's bundle graph even though this particular
// constant is inert data (D-05's spirit, not just its letter). Keep the
// two arrays in sync by hand.
const AUTOLOCK_OPTIONS = [5, 15, 30, 60] as const;

// Vault matches web/src/components/vault/ItemRow.tsx's own TYPE_ICON
// exactly (and this popup's own AutofillItemRow.tsx) -- a design-batch
// correction: the earlier KeyRound choice diverged from the shared
// icon-per-type convention used everywhere else `login` items render.
// Always rendered MUTED here (never teal): teal is reserved for actual
// `type: "passkey"` items with PRF capability, a type that doesn't exist
// in the data model yet (Phase 12).
// `totp` has no icon named in 09-UI-SPEC.md's enumerated four -- `Timer`
// is a Claude's-discretion addition (same icon web/ItemRow.tsx already
// uses for the same type), flagged for UI-checker review.
const TYPE_ICON: Record<ItemType, typeof Vault> = {
  login: Vault,
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

// The FAB's type-menu entry order -- Bartek's NordPass reference screenshots'
// own ordering (Login, then the two "quick" types, then the rest).
const NEW_ITEM_TYPE_ORDER: ItemType[] = ["login", "totp", "card", "identity", "note"];

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
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const fabMenuRef = useRef<HTMLDivElement>(null);

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

  // Closes the FAB's type menu on any click outside its container (the FAB
  // button + the menu list share one relatively-positioned wrapper, so a
  // click on the FAB itself -- while the menu is open -- is never seen as
  // "outside" here; the FAB's own onClick toggle handles that case).
  useEffect(() => {
    if (!typeMenuOpen) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent) {
      if (fabMenuRef.current && !fabMenuRef.current.contains(event.target as Node)) {
        setTypeMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [typeMenuOpen]);

  async function openInNewTab(pathSuffix: string) {
    const config = await sendMessage({ kind: "config.get" });
    if (config === null) {
      return;
    }
    await browser.tabs.create({ url: `${config.baseUrl}${pathSuffix}` });
  }

  async function handleNewItemType(itemType: ItemType) {
    setTypeMenuOpen(false);
    await openInNewTab(`/?action=new-item&type=${itemType}`);
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
    // `relative` anchors the FAB + its menu at POPUP level, deliberately
    // OUTSIDE the scrolling list below: an `overflow-y-auto` ancestor forms
    // a clipping context, which silently cut the upward-opening type menu
    // off at the list's edge (Bartek, live test: only the last two entries
    // were ever visible, which read as "the menu only has Identity+Note").
    <div className="relative flex w-[380px] flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
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

      <div className="relative">
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

      {/* lg spacing token (24px, 10-UI-SPEC.md) between this section and
          the full item list below it -- the "On this page" list IS the
          D-07 multi-account picker when more than one item matches. */}
      <div className="pb-1">
        <OnThisPageSection locale={locale} />
      </div>

      {/* min-h keeps the popup a stable, comfortable size instead of
          collapsing around 1-2 rows; max-h keeps it inside the browser's
          ~600px popup ceiling (09-UI-SPEC "Popup shell"), scrolling beyond
          that. The FAB is NOT in here -- see the wrapper comment above. */}
      <div className="flex min-h-[280px] max-h-[380px] flex-col divide-y divide-base-300 overflow-y-auto">
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
                // No horizontal px here -- the root container's own p-4
                // already supplies the 16px rhythm (matching
                // UnlockView/ServerConfigView/ItemDetailView); adding px-2
                // on top would double-pad relative to those views.
                className="flex min-h-[48px] items-center gap-2 py-2 text-left hover:bg-base-content/[0.06]"
                onClick={() => onSelectItem(item)}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-base-200 text-base-content/70">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base">{item.fields.name}</span>
                  <span className="truncate text-sm text-base-content/60">{subtitle}</span>
                </span>
              </button>
            );
          })
        )}

      </div>

      {/* FAB lives at popup level (see wrapper comment) so the menu can
          overlay the list instead of being clipped by its scroll box. */}
      <div ref={fabMenuRef} className="absolute bottom-16 right-3 z-50">
        {typeMenuOpen ? (
          <ul
            role="menu"
            className="menu absolute bottom-12 right-0 max-h-[260px] w-44 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
          >
            {NEW_ITEM_TYPE_ORDER.map((itemType) => {
              const Icon = TYPE_ICON[itemType];
              return (
                <li key={itemType}>
                  <button type="button" role="menuitem" onClick={() => void handleNewItemType(itemType)}>
                    <Icon size={16} aria-hidden="true" />
                    {t(locale, TYPE_LABEL_KEY[itemType])}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <button
          type="button"
          aria-label={t(locale, "nav.newItem")}
          aria-haspopup="menu"
          aria-expanded={typeMenuOpen}
          className="btn btn-primary btn-circle btn-sm shadow-lg"
          onClick={() => setTypeMenuOpen((open) => !open)}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-base-300 pt-2">
        <label htmlFor="pv-autolock" className="whitespace-nowrap text-sm text-base-content/70">
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
              {minutes} min
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
