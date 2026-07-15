// lib/i18n/autofill-dictionary.ts — Phase 10's popup-autofill copy slice
// (10-UI-SPEC.md's Copywriting Contract table), kept as ITS OWN dictionary
// object rather than merged into lib/i18n/dictionary.ts's DICTIONARY --
// scoping this phase's ~15 keys separately keeps that file's existing
// keyof-based type inference untouched, and makes this phase's copy
// reviewable as one self-contained unit (per 10-06-PLAN.md's own
// instruction). Reuses dictionary.ts's `Locale` type and `interpolate()`
// helper verbatim -- no second implementation of either, same `{pl, en}`
// entry shape and `t(locale, key)` accessor convention.
//
// "Skopiowano {field}. Wyczyści się za {n}s." (toast.copied below) is the
// EXACT template from web/src/lib/i18n/dictionary.ts's own `toast.copied`
// key, mirrored here (the extension's lib/i18n/dictionary.ts never
// defined a toast.copied key -- Phase 9's real popup has no toast
// primitive to reuse yet, confirmed by grep across
// extension/entrypoints/popup/ at exec time; see this plan's SUMMARY
// "Real Phase 9 shapes found" section). TotpFillRow.tsx interpolates this
// template with `field` = "kod"/"code" (totp.copiedField below) to produce
// exactly the plan's literal "Skopiowano kod. Wyczyści się za {n}s."
// string, never a second hand-typed copy of it.
import type { Locale } from "./dictionary";

export const AUTOFILL_DICTIONARY = {
  "onThisPage.heading": { pl: "Na tej stronie", en: "On this page" },

  "autofill.fillCta": { pl: "Wypełnij", en: "Fill" },
  "autofill.cancelCta": { pl: "Anuluj", en: "Cancel" },

  "totp.fillCta": { pl: "Wypełnij kod", en: "Fill code" },
  "totp.copyCta": { pl: "Kopiuj kod", en: "Copy code" },
  "totp.fillDisabledHint": {
    pl: "Brak pola kodu na tej stronie",
    en: "No code field on this page",
  },
  "totp.copiedField": { pl: "kod", en: "code" },

  // Reused verbatim from web/src/lib/i18n/dictionary.ts's toast.copied --
  // same {field}/{n} template, interpolated with field=totp.copiedField to
  // produce the plan's literal PL string.
  "toast.copied": {
    pl: "Skopiowano {field}. Wyczyści się za {n}s.",
    en: "Copied {field}. Clears in {n}s.",
  },

  "confirm.card": {
    pl: "Wypełnić dane karty kończącej się na {last4} na tej stronie?",
    en: "Fill the card ending in {last4} on this page?",
  },
  "confirm.identity": {
    pl: `Wypełnić dane tożsamości „{label}" na tej stronie?`,
    en: `Fill identity details for "{label}" on this page?`,
  },

  "empty.heading": { pl: "Nic tu nie pasuje 🤷", en: "Nothing matches here" },
  "empty.body": {
    pl: "Żaden zapisany item nie pasuje do tej strony. Przeszukaj cały vault poniżej albo dodaj nowy.",
    en: "No saved item matches this page. Search your whole vault below, or add a new one.",
  },

  "restricted.heading": {
    pl: "Autofill niedostępny na tej stronie",
    en: "Autofill isn't available on this page",
  },
  "restricted.body": {
    pl: "Ta strona nie pozwala na wypełnianie z rozszerzeń. Skopiuj dane ręcznie z widoku itemu.",
    en: "This page doesn't allow extension autofill. Copy the values manually from the item view.",
  },

  "fill.failed": {
    pl: "Nie udało się wypełnić — spróbuj ponownie.",
    en: "Couldn't fill — try again.",
  },
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof AUTOFILL_DICTIONARY): string {
  return AUTOFILL_DICTIONARY[key][locale];
}

export { interpolate } from "./dictionary";
export type { Locale } from "./dictionary";
