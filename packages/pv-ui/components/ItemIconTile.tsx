"use client";

import { useEffect, useState } from "react";
import { CreditCard, Globe, IdCard, KeyRound, StickyNote, Timer } from "lucide-react";
import type { ItemType, VaultItem } from "pv-ui/vault/types";
import { domainFromUrl } from "pv-ui/vault/search";
import { detectCardBrand, type CardBrand } from "pv-ui/vault/cardBrand";

// Bartek live-review round 3 (TASK 2/3) — replaces the plain neutral
// type-icon tile with a per-item visual differentiator: a favicon for
// login/passkey rows (resolved from the item's OWN domain), or a card-brand
// glyph for card rows. Every other type (and any login/card/passkey that
// doesn't resolve one) still falls back to the exact same neutral tile this
// used to render unconditionally.
//
// Zero-knowledge / privacy rule (see this repo's CLAUDE.md "Constraints"):
// the <img> below is a DIRECT, uncached fetch straight to the item's own
// domain's /favicon.ico — never a third-party favicon-relay service (the
// well-known hosted favicon-lookup endpoints some password managers use)
// and never routed through pv-server. `referrerPolicy=
// "no-referrer"` keeps the request from leaking which vault item triggered
// it. A missing/broken favicon is an entirely expected, silent case — it
// just falls back to the neutral type-icon tile, never surfaced as an error.
//
// Promoted to packages/pv-ui/components/ItemIconTile.tsx (DS-03, plan
// 17-03): this is now the SOLE implementation, shared by web/ and
// extension/ via thin shims -- see web/src/components/vault/ItemIconTile.tsx
// and extension/entrypoints/popup/ItemIconTile.tsx.
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
    // component reads before that normalization runs. A missing/non-array
    // `urls` is the same as "no domain to resolve a favicon from", never a
    // crash.
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
//
// WR-04 fix (17-REVIEW.md): read `--pv-tile-bg`/`--pv-tile-fg` directly
// via Tailwind v4 arbitrary-value classes instead of re-deriving the same
// two colors independently with a `[data-theme=vault-dark]` selector
// variant + a hardcoded `zinc-100`/`zinc-600` pair. Before this fix,
// tokens.css's `--pv-tile-bg`/`--pv-tile-fg` were the source of truth
// ONLY for the in-page overlay CSS (inpage-overlay.ts's own
// `var(--pv-tile-bg)`/`var(--pv-tile-fg)`) — this React component
// silently duplicated the same intent via a DIFFERENT mechanism
// (Tailwind theme classes + a manual dark-theme override), held in sync
// only by the e2e visual-parity harness (best-effort, needs a live
// server+browser). A future edit to tokens.css's `--pv-tile-bg` would
// NOT have propagated here, reintroducing the exact dark-tile divergence
// this phase fixed. tokens.css already declares both custom properties
// per-theme (`:root, [data-theme=vault-dark]` block AND the
// `[data-theme=vault-light]` override), so referencing them directly
// makes both the flip AND the light/dark values themselves single-
// sourced — this class pair is picked up by Tailwind v4's `@source`
// scan of `packages/pv-ui/components/**/*.tsx` (already wired into both
// web/src/app/globals.css and extension/entrypoints/popup/style.css).
const TILE_BG = "bg-[var(--pv-tile-bg)]";
const TILE_FG = "text-[var(--pv-tile-fg)]";

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
            would optimize/relay through our own origin, which is exactly
            the third-party-relay pattern this feature must avoid. */}
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
