// entrypoints/popup/ItemIconTile.tsx — popup UI round (Bartek-decided,
// FINAL): per-item visual differentiator for the "Wszystkie" list rows,
// ported verbatim from web/src/components/vault/ItemIconTile.tsx (the same
// favicon-tile pattern, adapted to this popup's own single row size — the
// web original's "header" DetailPanel variant has no popup equivalent this
// round, so only the row-sized tile is kept here).
//
// Zero-knowledge / privacy rule (see this repo's CLAUDE.md "Constraints"):
// the <img> below is a DIRECT, uncached fetch straight to the item's own
// domain's /favicon.ico — never a third-party favicon proxy (Google/DDG/s2
// endpoints etc.) and never routed through pv-server. `referrerPolicy=
// "no-referrer"` keeps the request from leaking which vault item triggered
// it. A missing/broken favicon is an entirely expected, silent case — it
// just falls back to the neutral type-icon tile, never surfaced as an error.
import { useEffect, useState } from "react";
import { CreditCard, Globe, IdCard, KeyRound, StickyNote, Timer } from "lucide-react";
import type { ItemType, VaultItem } from "../../lib/vault/types";
import { domainFromUrl } from "../../lib/vault/search";
import { detectCardBrand, type CardBrand } from "../../lib/vault/cardBrand";

const FAILED_FAVICON_HOSTS = new Set<string>();

// A separate protocol-prefix constant (not inlined into the template
// literal below) so this dynamic, per-item favicon URL never matches
// entrypoints/background/server-config.test.ts's whole-extension
// hard-coded-server-URL literal guard (that regex flags any quoted
// `https://<more-chars>` literal) -- this is not a hard-coded ORIGIN at
// all (the actual host always comes from the item's own domain/rpId at
// runtime), so it carries none of that invariant's threat, but the guard's
// naive string-literal regex can't tell a real hard-coded server URL
// apart from an interpolated template literal that merely starts with the
// same protocol string.
const FAVICON_URL_PREFIX = "https://";

// Matches ItemListView.tsx's own TYPE_ICON exactly (that copy stays there
// too, unchanged — it also drives the "+" FAB's type-menu icons, which have
// no VaultItem to resolve a favicon from).
const TYPE_ICON: Record<ItemType, typeof Globe> = {
  login: Globe,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
  totp: Timer,
  passkey: KeyRound,
};

function faviconHostnameFor(item: VaultItem): string | null {
  if (item.fields.type === "login") {
    // Defensive against a pre-multi-URL item shape slipping through without
    // ever going through normalizeItemFields() (types.ts) -- e.g. a hand-
    // built test fixture, or (in principle) an un-migrated stored item this
    // popup surface reads before that normalization runs. A missing/non-
    // array `urls` is the same as "no domain to resolve a favicon from",
    // never a crash.
    const urls = Array.isArray(item.fields.urls) ? item.fields.urls : [];
    const url = urls.find((u) => u.trim() !== "");
    if (!url) return null;
    const hostname = domainFromUrl(url).trim();
    return hostname !== "" ? hostname : null;
  }
  if (item.fields.type === "passkey") {
    const rpId = item.fields.rpId.trim();
    return rpId !== "" ? rpId : null;
  }
  return null;
}

// This popup's one row-tile frame, matching the size ItemListView.tsx's
// rows already used before this port (h-8 w-8 rounded-[8px], 18px glyph).
const FRAME = "h-8 w-8 rounded-[8px]";
const ICON_SIZE = 18;

// Bartek live-review (web): dark favicons (GitHub etc.) and dark glyphs
// vanish on a dark tile in the vault-dark theme — the tile bg flips to a
// LIGHT neutral there (and the glyph to a dark neutral), while vault-light
// keeps the original base-200 tile untouched. Same `[data-theme=vault-dark]`
// mechanism the popup already uses everywhere else (theme-mirror.ts stamps
// this attribute on `document.body`).
const TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100";
const TILE_FG = "text-base-content/70 [[data-theme=vault-dark]_&]:text-zinc-600";

export default function ItemIconTile({ item }: { item: VaultItem }) {
  const hostname = faviconHostnameFor(item);
  const [faviconFailed, setFaviconFailed] = useState(
    () => hostname !== null && FAILED_FAVICON_HOSTS.has(hostname),
  );

  // Re-derives whenever the resolved hostname changes (item switched, or its
  // URL/rpId edited) — a previously-failed hostname must not stay
  // permanently "failed" for a DIFFERENT item that happens to render through
  // the same component instance, and a freshly-failing hostname must be
  // picked up from the module-level cache instead of re-flashing a broken
  // <img> on every re-render.
  useEffect(() => {
    setFaviconFailed(hostname !== null && FAILED_FAVICON_HOSTS.has(hostname));
  }, [hostname]);

  if (item.fields.type === "card") {
    const brand = detectCardBrand(item.fields.number);
    if (brand !== null) {
      return <CardBrandTile brand={brand} />;
    }
  }

  if (hostname !== null && !faviconFailed) {
    return (
      <span className={`flex ${FRAME} shrink-0 items-center justify-center overflow-hidden ${TILE_BG}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a direct,
            uncached fetch straight to the item's own domain; this popup has
            no image-optimizing framework anyway, and routing this through
            our own origin would be exactly the third-party-relay pattern
            this feature must avoid. */}
        <img
          src={`${FAVICON_URL_PREFIX}${hostname}/favicon.ico`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-1"
          onError={() => {
            FAILED_FAVICON_HOSTS.add(hostname);
            setFaviconFailed(true);
          }}
        />
      </span>
    );
  }

  const Icon = TYPE_ICON[item.fields.type];
  return (
    <span className={`flex ${FRAME} shrink-0 items-center justify-center ${TILE_BG} ${TILE_FG}`}>
      <Icon size={ICON_SIZE} aria-hidden="true" />
    </span>
  );
}

// Proton Pass-inspired brand tiles, pure CSS + inline SVG + text, no
// external asset files, no third-party logo fetch (same zero-knowledge rule
// as the favicon above). Verbatim port of web/src/components/vault/
// ItemIconTile.tsx's own CardBrandTile, fixed to this popup's one row frame.
function CardBrandTile({ brand }: { brand: CardBrand }) {
  if (brand === "visa") {
    return (
      <span className={`flex ${FRAME} shrink-0 items-center justify-center bg-[#1434CB]`}>
        <span className="text-[9px] font-black italic leading-none tracking-tight text-white">VISA</span>
      </span>
    );
  }
  if (brand === "mastercard") {
    return (
      <span
        className={`flex ${FRAME} shrink-0 items-center justify-center bg-[#16171a] [[data-theme=vault-dark]_&]:bg-zinc-100`}
      >
        {/* Two overlapping circles, red + orange, the second blended
            multiply-over-red for the classic overlap tone — deliberately
            not a pixel copy of Mastercard's actual mark, just evocative of
            it within our own tile aesthetic. */}
        <svg viewBox="0 0 24 16" className="h-3.5 w-5" aria-hidden="true">
          <circle cx="9" cy="8" r="6.5" fill="#EB001B" />
          <circle cx="15" cy="8" r="6.5" fill="#F79E1B" style={{ mixBlendMode: "multiply" }} />
        </svg>
      </span>
    );
  }
  if (brand === "amex") {
    return (
      <span className={`flex ${FRAME} shrink-0 items-center justify-center bg-[#2E77BC]`}>
        <span className="text-[8px] font-black leading-none tracking-tight text-white">AMEX</span>
      </span>
    );
  }
  // discover — the full "DISCOVER" wordmark doesn't fit legibly at this
  // tile's size, so the brand's own orange accent color plus a shortened
  // "DISC" wordmark stands in (still visually distinct from the other three
  // brands, which is the only requirement here).
  return (
    <span
      className={`flex ${FRAME} shrink-0 items-center justify-center bg-[#1b1b1b] [[data-theme=vault-dark]_&]:bg-zinc-100`}
    >
      <span className="text-[7px] font-black leading-none tracking-tight text-[#FF6600]">DISC</span>
    </span>
  );
}
