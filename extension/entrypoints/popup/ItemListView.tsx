// ItemListView.tsx — browse/search/pick surface (09-UI-SPEC.md's "Item
// List + Search" section) PLUS the BINDING (Bartek 2026-07-15, NordPass
// reference screenshots) "Popup header + delegated-management
// affordances": settings gear + "open full vault" + a "+" new-item
// affordance + an auto-lock control.
//
// Post-UAT (Bartek 2026-07-15, live testing): the "+" control does NOT
// redirect directly. Per Bartek's NordPass reference screenshots, it first
// expands an in-popup TYPE MENU (Login / TOTP / Card / Identity / Note) --
// only choosing a type then opens the fullscreen editor via tabs.create(),
// with the chosen type passed along as `&type=<id>` so the web app's
// TypePicker step is skipped. The menu itself is a plain DaisyUI `menu`
// list, never a form -- EXT-06's doctrine ("no in-popup forms") is about
// FORMS, not type menus, and stays intact.
//
// Popup UI round (Bartek-decided, FINAL, 2026-07-17): SHEET-LOOK restyle --
// a dark top strip (title + search, "one dark strip") sits above a rounded
// content card holding the two item sections; the old floating bottom-right
// "+" FAB is GONE, folded into the footer's left group next to the gear;
// the footer's right side is now a "Full screen" PILL button plus the
// unchanged auto-lock select; row icons are now ItemIconTile.tsx (favicon/
// card-brand tiles, ported from web/); a compact sort control sits beside
// the "Wszystkie" heading. The D-14 single-scroll-region invariant (search
// 11-09 below) is UNCHANGED by any of this -- only the chrome around it
// moved.
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  Search,
  Settings,
  ExternalLink,
  Plus,
  Globe,
  CreditCard,
  IdCard,
  StickyNote,
  Timer,
  KeyRound,
} from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { searchItems, filterItems } from "../../lib/vault/search";
import {
  DEFAULT_SORT,
  readSortPreference,
  sortItems,
  writeSortPreference,
  type SortOption,
} from "../../lib/vault/sort";
import type { VaultItem, ItemType } from "../../lib/vault/types";
import { t, interpolate, type Locale } from "../../lib/i18n/dictionary";
import ItemIconTile from "./ItemIconTile";
// Phase 10 (Plan 10-06): the "On this page" autofill section -- the ONE
// visible surface Phase 10 adds, mounted here per 10-UI-SPEC.md's Scope
// Note ("every surface is a new section inside the existing popup shell").
// Owns its own useAutofillMatches() data fetch entirely internally; this
// view only needs to render it above the existing item list below.
import OnThisPageSection from "./autofill/OnThisPageSection";
import { useAutofillMatches } from "./autofill/useAutofillMatches";

// Duplicated from entrypoints/background/autolock.ts's AUTOLOCK_OPTIONS
// constant -- NOT imported directly, since that file (and its
// background-only import chain, down to the generated WASM bindings) is
// background-context code; importing it here would put WASM-adjacent
// modules in the popup's bundle graph even though this particular
// constant is inert data (D-05's spirit, not just its letter). Keep the
// two arrays in sync by hand.
const AUTOLOCK_OPTIONS = [5, 15, 30, 60] as const;

// Globe matches web/src/components/vault/ItemRow.tsx's own TYPE_ICON
// exactly (and ItemIconTile.tsx's own copy, used for the "Wszystkie" rows'
// per-item tile) -- this copy stays here too, since it ALSO drives the "+"
// menu's per-type icons, which have no VaultItem to resolve a favicon/
// card-brand tile from. Always rendered MUTED here (never teal): teal is
// reserved for PRF-capability-specific UI (the provider-ceremony consent
// view, Plan 12-04), not this menu.
// `totp` has no icon named in 09-UI-SPEC.md's enumerated four -- `Timer`
// is a Claude's-discretion addition (same icon web/ItemRow.tsx already
// uses for the same type), flagged for UI-checker review.
// Phase 12 (Plan 12-02): "passkey" now exists in the data model
// (PasskeyFields) -- `KeyRound` per 12-UI-SPEC.md's icon convention
// ("KeyRound (passkey/PRF meaning)"), matching this app's existing
// passkey-adjacent icon reservation everywhere else.
const TYPE_ICON: Record<ItemType, typeof Globe> = {
  login: Globe,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
  totp: Timer,
  passkey: KeyRound,
};

const TYPE_LABEL_KEY: Record<
  ItemType,
  "itemType.login" | "itemType.card" | "itemType.identity" | "itemType.note" | "itemType.totp" | "itemType.passkey"
> = {
  login: "itemType.login",
  card: "itemType.card",
  identity: "itemType.identity",
  note: "itemType.note",
  totp: "itemType.totp",
  passkey: "itemType.passkey",
};

// The "+" control's type-menu entry order -- Bartek's NordPass reference
// screenshots' own ordering (Login, then the two "quick" types, then the
// rest).
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
  // Popup UI round (decision 4): popup-local sort preference, persisted via
  // browser.storage.local (lib/vault/sort.ts) -- distinct from web's own
  // localStorage-backed preference, never shared between the two surfaces.
  // Seeded with the locked DEFAULT_SORT synchronously (chrome.storage has
  // no sync read API) and corrected the instant the async read below
  // resolves, matching autoLockMinutes' own "seed a sane default, correct
  // from the real read" pattern a few lines up.
  const [sortOption, setSortOption] = useState<SortOption>(DEFAULT_SORT);

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
    void readSortPreference().then(setSortOption);

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

  // Closes the "+" control's type menu on any click outside its container
  // (the button + the menu list share one relatively-positioned wrapper, so
  // a click on the button itself -- while the menu is open -- is never seen
  // as "outside" here; the button's own onClick toggle handles that case).
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

  async function handleSortChange(next: SortOption) {
    setSortOption(next);
    await writeSortPreference(next);
  }

  // filterItems is a no-op {kind:"all"} pass this phase (no folder/tag
  // filter UI exists in the popup yet -- CONTEXT.md's locked scope), but
  // composed here anyway, mirroring web/src/components/vault/ItemList.tsx's
  // exact `searchItems(filterItems(items, filter), query)` composition so
  // a future folder/tag filter slots in without restructuring this call.
  const results = searchItems(filterItems(items, { kind: "all" }), query);
  const trimmedQuery = query.trim();

  // The ONE autofill.match hook instance for the popup (10-06). ItemListView
  // owns it now (was inside OnThisPageSection before Bartek's 2026-07-16
  // two-section redesign) so the same result drives BOTH the "Na tej
  // stronie" section AND the de-duplication of the "Wszystkie" section
  // below: an item shown as a suggestion is never repeated in the full list.
  const autofill = useAutofillMatches();
  const suggestedIds = new Set(autofill.matches.map((m) => m.itemId));
  // "Wszystkie" = the searched full list minus anything already surfaced in
  // "Na tej stronie" (dedup by item id, Bartek: "itemy między listami nie są
  // duplikowane"), ordered by the popup's own sort preference (decision 4;
  // "lastUsed" is the DEFAULT_SORT, matching quick-260717's prior
  // default-only behavior for anyone who has never touched the control).
  const restResults = sortItems(
    results.filter((item) => !suggestedIds.has(item.id)),
    sortOption,
  );

  // 11-09 addendum, ROUND 2 (Bartek 2026-07-16, further live-review
  // clarification: "nie powinno być 2 scrolli pod sekcjami -- jeden
  // kontener scrollowalny w środku z tekstami od sekcji i jedna sekcja
  // pod drugą z itemkami"). The restricted/unreachable pageState renders
  // a plain static banner (OnThisPageSection's own early-return branch) --
  // that stays PINNED above the scroll region below, same as the search
  // strip/footer, since it is not scrollable content. Every OTHER
  // pageState renders "Na tej stronie"'s real heading+rows/hint, which now
  // scrolls TOGETHER with "Wszystkie" inside the one shared scroll
  // container -- computed once here so the single `<OnThisPageSection>`
  // call site below can be rendered from either branch without duplicating
  // its prop list.
  const isBannerPageState = autofill.pageState === "restricted" || autofill.pageState === "unreachable";
  const onThisPageSection = (
    <OnThisPageSection
      locale={locale}
      pageState={autofill.pageState}
      origin={autofill.origin}
      detected={autofill.detected}
      matches={autofill.matches}
      fill={autofill.fill}
      copyTotp={autofill.copyTotp}
      peekTotp={autofill.peekTotp}
    />
  );

  return (
    // Popup UI round: this outer wrapper no longer carries any padding of
    // its own -- the strip/card/footer zones below each own their own
    // (the strip needs edge-to-edge dark background; the card needs
    // rounded top corners that read against the strip's own color, which a
    // shared outer padding would inset away from the popup's actual edges).
    <div className="relative flex min-h-0 w-[380px] flex-1 flex-col overflow-hidden">
      {/* Sheet-look top bar (decision 2): title + search, visually one dark
          strip. `bg-neutral` + `text-primary-content` -- both REAL tokens
          from packages/pv-ui/tokens.css, deliberately not a hand-picked
          literal color. `--color-neutral` (a pure, chroma-0 mid-gray) and
          `--color-primary-content` (pure white) are BOTH left unredeclared
          by `[data-theme="vault-light"]` (that block only overrides the
          base-100/200/300/content tokens), so this pairing stays the exact
          same value in both themes -- a legible, consistent "dark bar" regardless of
          theme, exactly the "use tokens so it stays legible" bar this
          round's quality gate calls out. (`text-neutral-content` was
          considered first, but tokens.css never defines
          `--color-neutral-content` at all -- daisyUI 5's utility CSS has no
          runtime fallback for a missing content token, so that pairing
          would have silently depended on CSS's inherited-value fallback
          instead of an explicit, verified token.) */}
      <div className="flex shrink-0 flex-col gap-2 bg-neutral px-4 pb-3 pt-3 text-primary-content">
        <h1 className="text-[20px] font-semibold leading-tight">{t(locale, "app.title")}</h1>
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
      </div>

      {/* Rounded content card below the strip (decision 2) -- rises over
          the dark strip's own color at its two top corners, the classic
          "bottom sheet over a dark header" silhouette. Owns this popup's
          ONE overflow-y-auto region inside it (D-14, unchanged). */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-t-2xl bg-base-100 px-4 pb-2 pt-3">
        {items.length === 0 ? (
          <div
            className="flex min-h-[320px] flex-col items-center justify-center gap-1 px-4 py-8 text-center"
            data-testid="vault-empty-state"
          >
            <p className="text-base">{t(locale, "vault.emptyHeading")}</p>
            <p className="text-sm text-base-content/60">{t(locale, "vault.emptyBody")}</p>
          </div>
        ) : (
          <>
            {/* Restricted/unreachable pageState's plain warning banner is the
                ONE piece of "Na tej stronie" content that stays PINNED,
                outside the scroll region below -- it's static, not a list, so
                it belongs with the strip/footer, not the scrolling item
                content. */}
            {isBannerPageState ? <div className="pb-1">{onThisPageSection}</div> : null}

            {/* THE popup's one scrollable region (Bartek 2026-07-16
                live-review round 2: "jeden kontener scrollowalny w środku z
                tekstami od sekcji i jedna sekcja pod drugą z itemkami").
                "Na tej stronie" (heading + rows/hint, when NOT a banner
                pageState) and "Wszystkie" (heading + sort control + rows)
                are section-under-section SIBLINGS inside this ONE
                container -- both headings scroll away with their own
                content (deliberately not sticky, per Bartek's "z tekstami
                od sekcji"). */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pv-scroll-thin">
              {isBannerPageState ? null : onThisPageSection}

              {/* "Wszystkie" section — the rest of the vault, dedup'd against
                  the suggestions above, with the popup UI round's new sort
                  control (decision 4) beside the heading. Section-label
                  typography (decision 2): 12px/weight 500, not a heavy
                  heading (Bartek: the bold header "nie pasuje tutaj").
                  Hidden when there is nothing left to show and no active
                  query, so it never renders an orphan header over an empty
                  list. */}
              {restResults.length > 0 || trimmedQuery !== "" ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-medium text-base-content/60">
                      {t(locale, "vault.allItemsHeading")}
                    </h2>
                    <select
                      aria-label={t(locale, "sort.label")}
                      data-testid="popup-sort-select"
                      className="select select-bordered select-xs"
                      value={sortOption}
                      onChange={(e) => void handleSortChange(e.target.value as SortOption)}
                    >
                      <option value="lastUsed">{t(locale, "sort.lastUsed")}</option>
                      <option value="name">{t(locale, "sort.name")}</option>
                    </select>
                  </div>
                  <div className="flex flex-col divide-y divide-base-300">
                    {trimmedQuery !== "" && restResults.length === 0 ? (
                      <p className="px-4 py-8 text-center text-base text-base-content/60">
                        {interpolate(t(locale, "search.emptyResults"), { query: trimmedQuery })}
                      </p>
                    ) : (
                      restResults.map((item) => {
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
                            // 11-09: pv-row-hover (style.css) replaces the old
                            // hover:bg-base-content/[0.06] one-off -- same
                            // token direction, now shared verbatim with
                            // AutofillItemRow.tsx's "Na tej stronie" rows plus
                            // the button-style border+press affordance Bartek
                            // asked for (flat at rest, only on hover).
                            className="flex min-h-[48px] items-center gap-2 rounded-field px-1 py-2 text-left pv-row-hover"
                            onClick={() => onSelectItem(item)}
                          >
                            <ItemIconTile item={item} />
                            <span className="flex min-w-0 flex-col">
                              <span className="truncate text-base">{item.fields.name}</span>
                              <span className="truncate text-sm text-base-content/60">{subtitle}</span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Footer (decision 3): left = gear (settings redirect) + "+" (new-
          item redirect, via the SAME in-popup type menu the old floating
          FAB used -- only its POSITION changed, never its behavior); right
          = auto-lock select + the "Full screen" pill. Replaces the old
          floating bottom-right FAB entirely -- there is no more absolutely-
          positioned element at the popup's own root level. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-base-300 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t(locale, "nav.settings")}
            className="btn btn-ghost btn-square btn-sm"
            onClick={() => void openInNewTab("/?panel=settings")}
          >
            <Settings size={18} aria-hidden="true" />
          </button>

          {/* The "+" type-menu -- `relative` wrapper anchors the upward-
              opening menu to THIS button, still a sibling of the scrolling
              card region above (never nested inside its overflow-y-auto
              ancestor), so it is never clipped the way an in-scroll-region
              placement was (see the git history of this file for that
              regression). */}
          <div ref={fabMenuRef} className="relative">
            {typeMenuOpen ? (
              <ul
                role="menu"
                className="menu absolute bottom-full left-0 z-50 mb-2 max-h-[260px] w-44 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
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
              className="btn btn-primary btn-square btn-sm"
              onClick={() => setTypeMenuOpen((open) => !open)}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="pv-autolock" className="sr-only">
            {t(locale, "autolock.label")}
          </label>
          <select
            id="pv-autolock"
            aria-label={t(locale, "autolock.label")}
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

          {/* "Full screen" pill (decision 3): 36px height, 10px radius --
              built from plain Tailwind rather than daisyUI's `btn` sizing
              scale (whose closest step, `btn-sm`, is 32px/8px-radius, not
              this control's own spec). */}
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-sm font-medium text-primary-content transition hover:opacity-90"
            onClick={() => void openInNewTab("")}
          >
            <ExternalLink size={16} aria-hidden="true" />
            {t(locale, "nav.fullScreen")}
          </button>
        </div>
      </div>
    </div>
  );
}
