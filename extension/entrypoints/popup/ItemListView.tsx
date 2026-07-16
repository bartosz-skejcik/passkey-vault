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
import { Search, Settings, ExternalLink, Plus, Globe, CreditCard, IdCard, StickyNote, Timer, KeyRound } from "lucide-react";
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
// exactly (and this popup's own AutofillItemRow.tsx) -- a design-batch
// correction: login is a website credential, so Globe reads lighter and
// more distinct than the earlier Vault choice (which now reads as a
// generic/brand-adjacent glyph rather than a per-type icon).
// Always rendered MUTED here (never teal): teal is reserved for
// PRF-capability-specific UI (the provider-ceremony consent view, Plan
// 12-04), not the plain list-row icon -- this list's own `passkey` icon
// stays the same neutral treatment as every other type.
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

  // The ONE autofill.match hook instance for the popup (10-06). ItemListView
  // owns it now (was inside OnThisPageSection before Bartek's 2026-07-16
  // two-section redesign) so the same result drives BOTH the "Na tej
  // stronie" section AND the de-duplication of the "Wszystkie" section
  // below: an item shown as a suggestion is never repeated in the full list.
  const autofill = useAutofillMatches();
  const suggestedIds = new Set(autofill.matches.map((m) => m.itemId));
  // "Wszystkie" = the searched full list minus anything already surfaced in
  // "Na tej stronie" (dedup by item id, Bartek: "itemy między listami nie są
  // duplikowane").
  const restResults = results.filter((item) => !suggestedIds.has(item.id));

  // 11-09 addendum, ROUND 2 (Bartek 2026-07-16, further live-review
  // clarification: "nie powinno być 2 scrolli pod sekcjami -- jeden
  // kontener scrollowalny w środku z tekstami od sekcji i jedna sekcja
  // pod drugą z itemkami"). The restricted/unreachable pageState renders
  // a plain static banner (OnThisPageSection's own early-return branch) --
  // that stays PINNED above the scroll region below, same as the top bar/
  // search/footer, since it is not scrollable content. Every OTHER
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
    // `relative` anchors the FAB + its menu at POPUP level, deliberately
    // OUTSIDE the scrolling list below: an `overflow-y-auto` ancestor forms
    // a clipping context, which silently cut the upward-opening type menu
    // off at the list's edge (Bartek, live test: only the last two entries
    // were ever visible, which read as "the menu only has Identity+Note").
    //
    // 11-09 live-review addendum (Bartek 2026-07-16, popup scroll-in-
    // scroll), ROUND 2 CORRECTED: this root is `flex-1 min-h-0` -- it
    // fills whatever vertical space App.tsx's `h-[600px]` list-view
    // wrapper hands it (all of it, unless the enroll-prompt banner is also
    // showing) and `overflow-hidden` so it can never scroll AS A WHOLE.
    // Top bar, search, the restricted-page banner (when that pageState
    // applies), and the footer are normal, naturally-sized flex children --
    // PINNED simply by virtue of not being the one `flex-1 min-h-0` child.
    // EVERYTHING else -- "Na tej stronie"'s heading+rows/hint AND
    // "Wszystkie"'s heading+rows -- lives inside that ONE `flex-1 min-h-0
    // overflow-y-auto` child, section under section, per Bartek's round-2
    // clarification ("jeden kontener scrollowalny w środku"). No element in
    // this view has an independent SECOND scroll box anymore.
    <div className="relative flex min-h-0 w-[380px] flex-1 flex-col gap-2 overflow-hidden p-4">
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

      {/* Bartek's 2026-07-16 NordPass two-section redesign
          (10-POPUP-REDESIGN-SPEC.md): "Na tej stronie" and "Wszystkie" are
          now permanent siblings in one scroll column, de-duplicated by id,
          with a SINGLE empty state (the old layout stacked two empty blocks
          -- the "duplikat informacji" he flagged). When the vault has never
          had an item, show only the one empty state; the autofill section is
          meaningless then. */}
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
              it belongs with the top bar/search/footer, not the scrolling
              item content. */}
          {isBannerPageState ? <div className="pb-1">{onThisPageSection}</div> : null}

          {/* THE popup's one scrollable region (Bartek 2026-07-16
              live-review round 2: "jeden kontener scrollowalny w środku z
              tekstami od sekcji i jedna sekcja pod drugą z itemkami").
              "Na tej stronie" (heading + rows/hint, when NOT a banner
              pageState) and "Wszystkie" (heading + rows) are section-under-
              section SIBLINGS inside this ONE container -- both headings
              scroll away with their own content (deliberately not sticky,
              per Bartek's "z tekstami od sekcji"). Replaces the earlier
              two-scrollbox version (OnThisPageSection's own bounded
              max-h-[140px] internal scroll + this list's independent
              flex-1) with a single `overflow-y-auto`, `flex-1 min-h-0` so
              it fills exactly whatever space is left after every pinned
              sibling. pv-scroll-thin (style.css) matches 11-09's own
              in-page .pv-list scrollbar recipe. */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pv-scroll-thin">
            {isBannerPageState ? null : onThisPageSection}

            {/* "Wszystkie" section — the rest of the vault, dedup'd against the
                suggestions above. Label-role weight (14px/400), not a heavy
                heading (Bartek: the bold header "nie pasuje tutaj"). Hidden when
                there is nothing left to show and no active query, so it never
                renders an orphan header over an empty list. */}
            {restResults.length > 0 || trimmedQuery !== "" ? (
              <div className="flex flex-col gap-1">
                <h2 className="px-1 text-sm font-normal text-base-content/60">
                  {t(locale, "vault.allItemsHeading")}
                </h2>
                <div className="flex flex-col divide-y divide-base-300">
                  {trimmedQuery !== "" && restResults.length === 0 ? (
                    <p className="px-4 py-8 text-center text-base text-base-content/60">
                      {interpolate(t(locale, "search.emptyResults"), { query: trimmedQuery })}
                    </p>
                  ) : (
                    restResults.map((item) => {
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
                          // 11-09: pv-row-hover (style.css) replaces the old
                          // hover:bg-base-content/[0.06] one-off -- same
                          // token direction, now shared verbatim with
                          // AutofillItemRow.tsx's "Na tej stronie" rows plus
                          // the button-style border+press affordance Bartek
                          // asked for (flat at rest, only on hover).
                          className="flex min-h-[48px] items-center gap-2 rounded-field px-1 py-2 text-left pv-row-hover"
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
              </div>
            ) : null}
          </div>
        </>
      )}

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
          // Square (not circle) to match the web frontend's primary buttons
          // (btn btn-primary) — Bartek 2026-07-16.
          className="btn btn-primary btn-square btn-sm shadow-lg"
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
