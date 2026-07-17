"use client";

import { useEffect, useState } from "react";
import { CreditCard, Globe, IdCard, KeyRound, StickyNote, Timer } from "lucide-react";
import type { ItemType, VaultItem } from "@/lib/vault/types";
import { domainFromUrl } from "@/lib/vault/search";
import { detectCardBrand, type CardBrand } from "@/lib/vault/cardBrand";

// Bartek live-review round 3 (TASK 2/3) — replaces the plain neutral
// type-icon tile with a per-item visual differentiator: a favicon for
// login/passkey rows (resolved from the item's OWN domain), or a card-brand
// glyph for card rows. Every other type (and any login/card/passkey that
// doesn't resolve one) still falls back to the exact same neutral tile this
// used to render unconditionally.
//
// Zero-knowledge / privacy rule (see this repo's CLAUDE.md "Constraints"):
// the <img> below is a DIRECT, uncached fetch straight to the item's own
// domain's /favicon.ico — never a third-party favicon proxy (Google/DDG/s2
// endpoints etc.) and never routed through pv-server. `referrerPolicy=
// "no-referrer"` keeps the request from leaking which vault item triggered
// it. A missing/broken favicon is an entirely expected, silent case — it
// just falls back to the neutral type-icon tile, never surfaced as an error.
const FAILED_FAVICON_HOSTS = new Set<string>();

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
    const url = item.fields.urls.find((u) => u.trim() !== "");
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

// "row" matches ItemList's pre-existing h-8 w-8 icon-tile frame; "header" is
// a smaller variant for DetailPanel's title bar (Bartek live-review:
// "detail header SHOULD also use it for consistency").
const SIZE = {
  row: { frame: "h-8 w-8 rounded-[8px]", icon: 18 },
  header: { frame: "h-6 w-6 rounded-[6px]", icon: 14 },
} as const;

// Bartek live-review: dark favicons (GitHub etc.) and dark glyphs vanish on a
// dark tile in the vault-dark theme — the tile bg flips to a LIGHT neutral
// there (and the glyph to a dark neutral), while vault-light keeps the
// original base-200 tile untouched.
const TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100";
const TILE_FG = "text-base-content/70 [[data-theme=vault-dark]_&]:text-zinc-600";

export default function ItemIconTile({
  item,
  variant = "row",
}: {
  item: VaultItem;
  variant?: "row" | "header";
}) {
  const { frame, icon: iconSize } = SIZE[variant];
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
      return <CardBrandTile brand={brand} frameClass={frame} />;
    }
  }

  if (hostname !== null && !faviconFailed) {
    return (
      <span
        className={`flex ${frame} shrink-0 items-center justify-center overflow-hidden ${TILE_BG}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a direct,
            uncached fetch straight to the item's own domain; next/image
            would proxy/optimize through our own origin, which is exactly
            the third-party-relay pattern this feature must avoid. */}
        <img
          src={`https://${hostname}/favicon.ico`}
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
    <span
      className={`flex ${frame} shrink-0 items-center justify-center ${TILE_BG} ${TILE_FG}`}
    >
      <Icon size={iconSize} aria-hidden="true" />
    </span>
  );
}

// Proton Pass-inspired brand tiles, adapted to our own 1px-border/rounded
// tokens — pure CSS + inline SVG + text, no external asset files, no
// third-party logo fetch (same zero-knowledge rule as the favicon above:
// nothing about a saved card ever leaves the client to render its glyph).
function CardBrandTile({ brand, frameClass }: { brand: CardBrand; frameClass: string }) {
  if (brand === "visa") {
    return (
      <span
        className={`flex ${frameClass} shrink-0 items-center justify-center bg-[#1434CB]`}
      >
        <span className="text-[9px] font-black italic leading-none tracking-tight text-white">
          VISA
        </span>
      </span>
    );
  }
  if (brand === "mastercard") {
    return (
      <span
        className={`flex ${frameClass} shrink-0 items-center justify-center bg-[#16171a] [[data-theme=vault-dark]_&]:bg-zinc-100`}
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
      <span className={`flex ${frameClass} shrink-0 items-center justify-center bg-[#2E77BC]`}>
        <span className="text-[8px] font-black leading-none tracking-tight text-white">AMEX</span>
      </span>
    );
  }
  // discover — the full "DISCOVER" wordmark doesn't fit legibly at this
  // tile's row/header sizes, so the brand's own orange accent color plus a
  // shortened "DISC" wordmark stands in (still visually distinct from the
  // other three brands, which is the only requirement here).
  return (
    <span
      className={`flex ${frameClass} shrink-0 items-center justify-center bg-[#1b1b1b] [[data-theme=vault-dark]_&]:bg-zinc-100`}
    >
      <span className="text-[7px] font-black leading-none tracking-tight text-[#FF6600]">
        DISC
      </span>
    </span>
  );
}
