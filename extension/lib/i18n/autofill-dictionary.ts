// lib/i18n/autofill-dictionary.ts — Phase 10's popup-autofill copy slice
// (10-UI-SPEC.md's Copywriting Contract table), kept as ITS OWN dictionary
// object rather than merged into lib/i18n/dictionary.ts's DICTIONARY --
// scoping this phase's ~15 keys separately keeps that file's existing
// keyof-based type inference untouched, and makes this phase's copy
// reviewable as one self-contained unit (per 10-06-PLAN.md's own
// instruction). Reuses the shared pv-ui/i18n engine's `Locale` type and
// `interpolate()` helper verbatim -- no second implementation of either,
// same `{pl, en}` entry shape and `t(locale, key)` accessor convention.
// DS-02 (plan 16-04): these two imports moved from `./dictionary` (which
// itself now re-exports them from pv-ui/i18n/engine) directly to
// `pv-ui/i18n/engine` -- one hop closer to the shared source, zero change
// to AUTOFILL_DICTIONARY's own content or this file's local `t()`.
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
import type { Locale } from "pv-ui/i18n/engine";

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

  // NordPass two-section redesign (Bartek 2026-07-16,
  // 10-POPUP-REDESIGN-SPEC.md): replaces the old two-line emoji empty block
  // ("empty.heading"/"empty.body") -- vault non-empty but nothing matches
  // the active site now gets ONE compact, calm line; the full vault is
  // always visible right below in ItemListView's "Wszystkie" section, so a
  // second empty state pointing the user "down below" is no longer needed.
  "onThisPage.noMatch": { pl: "Nic nie pasuje do tej strony", en: "Nothing matches this page" },

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

  // --- In-page overlay (10-10, Claude's-discretion additions not in
  // 10-UI-SPEC.md's Copywriting Contract table -- that spec only covers the
  // popup surface; 10-10-PLAN.md's design_reference names these two
  // headings directly ("Zaloguj z Passkey Vault" / "Hasła") but leaves the
  // aria-labels for the close/block-this-site icon buttons to executor
  // discretion, matched to onThisPage.heading's/autofill.cancelCta's
  // existing tone) --------------------------------------------------------
  "overlay.promptTitle": { pl: "Zaloguj z Passkey Vault", en: "Log in with Passkey Vault" },
  "overlay.fieldDropdownHeading": { pl: "Hasła", en: "Passwords" },
  "overlay.closeAria": { pl: "Zamknij", en: "Close" },
  "overlay.blockSiteAria": { pl: "Zablokuj tę stronę", en: "Block this site" },

  // --- Generate-password popover (Phase 11, Plan 11-04, Surface 1) -------
  // Verbatim from 11-UI-SPEC.md's Copywriting Contract table.
  "generate.trigger": { pl: "Wygeneruj silne hasło", en: "Generate a strong password" },
  "generate.title": { pl: "Sugerowane hasło", en: "Suggested password" },
  "generate.modeCharacter": { pl: "Znaki", en: "Characters" },
  "generate.modePassphrase": { pl: "Passphrase", en: "Passphrase" },
  "generate.regenerate": { pl: "Losuj ponownie", en: "Regenerate" },
  "generate.apply": { pl: "Użyj tego hasła", en: "Use this password" },
  "generate.failed": {
    pl: "Nie udało się wygenerować hasła. Spróbuj ponownie.",
    en: "Couldn't generate a password. Try again.",
  },

  // X-2 note: 11-04-PLAN.md's own text claims these two keys "do not exist
  // in either extension dictionary today" -- that's imprecise (they already
  // exist in lib/i18n/dictionary.ts, the POPUP dictionary, added by an
  // earlier phase), but this file's own `t()` accessor below is scoped
  // ONLY to AUTOFILL_DICTIONARY's own keys (a deliberately separate,
  // smaller `keyof` union from dictionary.ts's DICTIONARY -- see this
  // file's header comment), so generate-popover.ts's reveal/hide toggle
  // still needs its OWN copy of these two keys here to compile against
  // this dictionary's `t()`. Same PL/EN strings as dictionary.ts's
  // existing entries -- not a new translation, just re-scoped.
  "aria.showPassword": { pl: "Pokaż hasło", en: "Show password" },
  "aria.hidePassword": { pl: "Ukryj hasło", en: "Hide password" },

  // --- Save/update toast (Phase 11, Plan 11-05, Surface 2, CAP-02/CAP-03)
  // Verbatim from 11-UI-SPEC.md's Copywriting Contract table.
  "save.title": { pl: "Zapisać to hasło do vaulta?", en: "Save this password to your vault?" },
  "save.body": { pl: "Dla {origin} · {username}", en: "For {origin} · {username}" },
  "save.confirm": { pl: "Zapisz", en: "Save" },
  "save.dismiss": { pl: "Nie teraz", en: "Not now" },
  "save.saved": { pl: "Zapisano", en: "Saved" },
  "save.failed": {
    pl: "Nie udało się zapisać. Sprawdź połączenie i spróbuj ponownie.",
    en: "Couldn't save. Check your connection and try again.",
  },
  "save.retry": { pl: "Spróbuj ponownie", en: "Retry" },
  "update.title": { pl: "Zaktualizować zapisane hasło?", en: "Update your saved password?" },
  "update.body": {
    pl: "Wygląda na to, że zmieniłeś hasło dla {origin} · {username}",
    en: "Looks like you changed the password for {origin} · {username}",
  },
  "update.confirm": { pl: "Zaktualizuj", en: "Update" },
  "update.dismiss": { pl: "Nie teraz", en: "Not now" },
  "update.updated": { pl: "Zaktualizowano", en: "Updated" },
  "update.conflict": {
    pl: "Ten login zmienił się na innym urządzeniu. Odśwież i spróbuj ponownie.",
    en: "This login changed on another device. Refresh and try again.",
  },
  "toast.closeAria": { pl: "Zamknij powiadomienie", en: "Close notification" },

  // --- Origin-mismatch escalation modal (Phase 11, Plan 11-05, Surface 3,
  // CAP-02/CAP-03, ROADMAP SC#4, D-06) -- verbatim from 11-UI-SPEC.md's
  // Copywriting Contract table.
  "mismatch.title": { pl: "To pole jest na innej domenie", en: "This field is on a different domain" },
  "mismatch.body": {
    pl: `Formularz, z którego pochodzi to hasło, działa na {frameOrigin} — inaczej niż strona, którą widzisz ({topOrigin}). Zapisanie tego hasła przypisze je do {frameOrigin}.`,
    en: `The form this password came from runs on {frameOrigin} — not the page you're viewing ({topOrigin}). Saving will attribute this password to {frameOrigin}.`,
  },
  "mismatch.confirm": { pl: "Zapisz mimo to", en: "Save anyway" },
  "mismatch.cancel": { pl: "Anuluj", en: "Cancel" },
  "mismatch.warningAria": {
    pl: "Ostrzeżenie o niezgodności domeny",
    en: "Domain mismatch warning",
  },
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof AUTOFILL_DICTIONARY): string {
  return AUTOFILL_DICTIONARY[key][locale];
}

export { interpolate } from "pv-ui/i18n/engine";
export type { Locale } from "pv-ui/i18n/engine";
