// lib/i18n/dictionary.ts — the extension popup's i18n dictionary, following
// web/src/lib/i18n/dictionary.ts's exact structural pattern (same
// `Locale = "pl" | "en"` type, same `{pl, en}` entry shape, same
// `interpolate()` helper). Scoped to ONLY the copy 09-UI-SPEC.md's
// Copywriting Contract table (plus its AMENDMENT 2026-07-15) requires for
// the popup this phase -- every line marked "reused verbatim" below is
// copied byte-for-byte from that document, never paraphrased.
//
// A few keys are Claude's-discretion additions the spec doesn't literally
// name (item-type/field labels, the server-config screen's own copy --
// that screen predates EXT-05 and isn't in 09-UI-SPEC.md at all) --
// flagged as such inline and called out again in the plan's SUMMARY for
// UI-checker review, per the plan's own instruction.
//
// No LocaleContext/React-context provider exists here (unlike the web
// app) -- the popup has no locale switcher this phase, so `resolveLocale()`
// below is a plain one-shot read, not a stateful provider.
//
// DS-02 (plan 16-04): this file is now a thin wrapper over the shared
// pv-ui/i18n engine -- DICTIONARY spreads COMMON_DICTIONARY (34 keys
// shared byte-for-byte with web's own dictionary.ts) plus every
// extension-only entry below, INCLUDING the 4 key-name-shared-but-
// value-divergent keys (vault.emptyHeading, vault.emptyBody,
// search.emptyResults, autolock.label) with their extension-specific
// PL/EN copy kept exactly as-is (content and key SET unchanged from
// before this refactor). `t()`/`interpolate()`/`Locale`/`resolveLocale()`'s
// public signature stay byte-identical to the pre-refactor shape -- zero
// call-site churn at this file's ~13 `t(locale, key)` call sites.
import { COMMON_DICTIONARY } from "pv-ui/i18n/common";
import { t as tEngine, interpolate, type Locale, resolveLocale } from "pv-ui/i18n/engine";

export { interpolate, resolveLocale };
export type { Locale };

export const DICTIONARY = {
  ...COMMON_DICTIONARY,

  // --- Loading / shell state (reused verbatim) -------------------------
  "loading.vault": { pl: "Ładowanie sejfu…", en: "Loading your vault…" },

  // --- Unlock / Sign-in (reused verbatim from 04-UI-SPEC.md unless noted)
  "unlock.sessionLockedNotice": {
    pl: "Sesja wygasła po bezczynności — odblokuj ponownie.",
    en: "Your session locked after being idle — unlock again.",
  },

  "unlock.serverCeremonyInFlight": {
    pl: "Dokończ w otwartym oknie…",
    en: "Finish in the opened window…",
  },
  "unlock.serverCeremonyFailed": {
    pl: "Nie udało się odblokować przez stronę serwera. Spróbuj ponownie albo użyj hasła.",
    en: "Couldn't unlock via your server. Try again — or use your password.",
  },

  // Phase 15 (Plan 15-03): the trailing "or use your password" clause is
  // stale under the window-based sign-in model -- the popup's own
  // SignInView.tsx has no password field to fall back to (AUTH-01).
  "unlock.serverCeremonySigninFailed": {
    pl: "Nie udało się zalogować przez stronę serwera. Spróbuj ponownie.",
    en: "Couldn't sign in via your server. Try again.",
  },

  // --- Item list / search (reused verbatim) ----------------------------
  "search.emptyResults": { pl: `Brak wyników dla „{query}"`, en: `No matches for "{query}"` },
  "vault.emptyHeading": { pl: "Twój sejf jest jeszcze pusty", en: "Your vault is empty so far" },
  "vault.emptyBody": {
    pl: "Dodaj pierwszy login w aplikacji webowej — pojawi się tu automatycznie.",
    en: "Add your first item in the web app — it'll show up here automatically.",
  },
  "error.connectionFailed": {
    pl: "Nie można połączyć z serwerem. Sprawdź połączenie i spróbuj ponownie.",
    en: "Can't reach the server. Check your connection and try again.",
  },
  "autolock.label": { pl: "Automatyczna blokada", en: "Auto-lock" },

  // NordPass two-section popup redesign (Bartek 2026-07-16,
  // 10-POPUP-REDESIGN-SPEC.md) -- the permanent "rest of the vault" section
  // header below "Na tej stronie" (onThisPage.heading, autofill-
  // dictionary.ts). Label-role weight (14px/400), not a heading.
  "vault.allItemsHeading": { pl: "Wszystkie", en: "All items" },

  // --- Popup header + delegated-management affordances (BINDING,
  // Bartek 2026-07-15) --------------------------------------------------
  "nav.settings": { pl: "Ustawienia", en: "Settings" },
  "vault.openFullVault": { pl: "Pełny widok", en: "Full screen" },
  "nav.newItem": { pl: "Nowy element", en: "New item" },

  // --- Popup UI round (Bartek-decided, FINAL, additive-only per this
  // round's scope note) --------------------------------------------------
  // Sheet-look header's title (decision 2) -- a brand name, deliberately
  // identical in both locales (not a translated phrase).
  "app.title": { pl: "Passkey Vault", en: "Passkey Vault" },
  // Footer's right-side pill button (decision 3) -- same open-full-vault
  // behavior as the pre-existing `vault.openFullVault` key above, but with
  // Bartek's exact new copy ("Pełny ekran", not "Pełny widok"). Added as a
  // NEW key rather than editing the old one, since this file's own
  // additive-only scope note for this round forbids modifying existing
  // entries; `vault.openFullVault` is left in place, simply unused now.
  "nav.fullScreen": { pl: "Pełny ekran", en: "Full screen" },
  // Sort control (decision 4) -- mirrors web/src/lib/i18n/dictionary.ts's
  // own sort.label/sort.lastUsed/sort.name keys verbatim (same PL/EN copy),
  // so the popup and web app never present different option wording for
  // the same underlying SortOption values.

  // --- Server config (EXT-05; this screen predates 09-UI-SPEC.md, so
  // this copy is Claude's-discretion, kept strictly within the design
  // contract's existing token/component vocabulary -- flagged for
  // UI-checker review in the SUMMARY) -----------------------------------
  "config.heading": { pl: "Połącz z serwerem", en: "Connect to your server" },
  "config.urlLabel": { pl: "Adres serwera", en: "Server address" },
  "config.submit": { pl: "Połącz", en: "Connect" },
  "config.invalidUrl": {
    pl: "Nieprawidłowy adres — podaj pełny adres zaczynający się od http lub https.",
    en: "Invalid address — use a full http or https URL.",
  },
  "config.unreachable": {
    pl: "Nie można połączyć z tym serwerem. Sprawdź adres i upewnij się, że działa.",
    en: "Can't reach that server. Check the address and make sure it's running.",
  },
  // D-11 (13-05-PLAN.md): distinct from config.unreachable above -- the
  // server DID answer, it just hasn't allowlisted this extension's origin
  // for CORS yet. Must literally name PV_EXTENSION_ORIGINS (grep-verified)
  // and must NOT claim the server is unreachable.
  "config.corsBlocked": {
    pl: "Serwer odpowiedział, ale odrzucił origin tego rozszerzenia (CORS). Dodaj poniższy adres do PV_EXTENSION_ORIGINS na serwerze.",
    en: "The server answered, but rejected this extension's origin (CORS). Add the address below to PV_EXTENSION_ORIGINS on your server.",
  },
  "config.corsBlockedOriginLabel": {
    pl: "Origin tego rozszerzenia:",
    en: "This extension's origin:",
  },
  // EXT-05's "editable later" clause (09-VERIFICATION.md gap 1): the
  // discreet re-entry affordance on the UNLOCK view -- where a user with a
  // wrong/moved server is actually stuck. Deliberately NOT in the list-view
  // footer (cramped) and NOT the header gear (that redirects to the WEB
  // app's settings per EXT-06's binding NordPass layout, and could never
  // change the extension's own chrome.storage.local baseUrl anyway).
  "config.changeServer": { pl: "Zmień serwer", en: "Change server" },
  "config.cancel": { pl: "Anuluj", en: "Cancel" },
  "config.permissionDenied": {
    pl: "Bez tej zgody rozszerzenie nie może łączyć się z Twoim serwerem. Spróbuj ponownie i zaakceptuj prośbę o uprawnienie.",
    en: "Without this permission the extension can't talk to your server. Try again and accept the permission prompt.",
  },
  // AUTH-04 (15-02-PLAN.md, 15-UI-SPEC.md): the server-change confirmation
  // dialog's copy -- landed here (wave 1, this plan produces, does not
  // consume) so Plan 15-05 (wave 2, ServerConfigView.tsx's confirm dialog)
  // can rely on wave-sequencing to guarantee these keys exist before its
  // own tests assert on them. Interpolated `{host}` = hostname only (never
  // the full URL with scheme/path), per 15-UI-SPEC.md's long-text
  // resolution.
  "config.changeServerConfirmBody": {
    pl: "Zmiana serwera wyloguje Cię z {host}",
    en: "Changing servers will sign you out of {host}",
  },
  // Distinct from config.changeServer above (the icon-button's aria-label)
  // -- this is the confirm-dialog's own confirm button, whose EN text
  // differs ("Switch server" vs. "Change server"), per ui-checker
  // recommendation: a bare "Confirm" is ambiguous on a sign-out-triggering
  // dialog.
  "config.changeServerConfirm": { pl: "Zmień serwer", en: "Switch server" },
  // AUTH-04's "no stranded state" clause made honest in copy -- shown when
  // the sign-out + old-origin-revoke + new-origin-grant sequence fails
  // partway (15-05's job); the dialog stays open, both buttons re-enable.
  "config.changeServerMigrationFailed": {
    pl: "Nie udało się przełączyć serwera. Zostajesz zalogowany na poprzednim serwerze — spróbuj ponownie.",
    en: "Couldn't switch servers. You're still signed in on your previous server — try again.",
  },

  // --- Item type / field labels (Claude's-discretion, mirrors
  // web/src/lib/i18n/dictionary.ts's own precedent for these -- not in
  // UI-SPEC's Copywriting Contract table, needed for the item-detail
  // heading badge and per-type field rows) ------------------------------
  // Phase 12 (Plan 12-02): "passkey" now exists in the data model
  // (PasskeyFields, lib/vault/types.ts) -- ItemListView.tsx's TYPE_LABEL_KEY
  // Record needs this entry to stay exhaustive.

  // Guaranteed passkey-detail rows (BINDING, Bartek 2026-07-15) -- see
  // ItemDetailView.tsx; no "passkey" item type exists in the data model
  // yet (Phase 12 introduces it), so these keys are unused today but
  // ready the instant that type lands.
  "field.lastUsed": { pl: "Ostatnio użyty", en: "Last used" },

  "aria.backToList": { pl: "Wróć do listy", en: "Back to list" },

  // --- Passkey provider ceremony consent screen (Phase 12, Plan 12-04,
  // 12-UI-SPEC.md Copywriting Contract table -- reused verbatim, byte-for-
  // byte, never paraphrased). Rendered ONLY by ProviderCeremonyView.tsx;
  // scoped to the RP's own create()/get() ceremony, never Phase 3/4's
  // vault-unlock PRF feature (see that view's own header comment). --------
  "provider.createTitle": { pl: "Nowy passkey", en: "New passkey" },
  "provider.createBody": {
    pl: "{site} chce zapisać nowy passkey w Twoim vaulcie.",
    en: "{site} wants to save a new passkey to your vault.",
  },
  "provider.signinTitle": { pl: "Logowanie passkeyem", en: "Sign in with a passkey" },
  "provider.signinBodySingle": {
    pl: "Zaloguj się do {site} jako {account}.",
    en: "Sign in to {site} as {account}.",
  },
  "provider.signinBodyMultiple": {
    pl: "Wybierz konto, którym chcesz się zalogować do {site}.",
    en: "Choose the account to sign in to {site} with.",
  },
  "provider.accountLabel": { pl: "Konto: {account}", en: "Account: {account}" },
  "provider.createCta": { pl: "Utwórz passkey", en: "Create passkey" },
  "provider.signinCta": { pl: "Zaloguj passkeyem", en: "Sign in with passkey" },
  "provider.useOther": { pl: "Użyj innej metody", en: "Use something else" },
  "provider.createBusy": { pl: "Tworzymy passkey…", en: "Creating your passkey…" },
  "provider.signinBusy": { pl: "Podpisujemy logowanie…", en: "Signing you in…" },
  // D-16: the TRIGGER for these two lines is background's real passkey-rs
  // capability signal (never browser detection) -- the copy itself is
  // unchanged by that decision (ADDENDUM 2026-07-16).
  "provider.prfCapableNote": {
    pl: "Ten passkey będzie też mógł odblokować Twój vault.",
    en: "This passkey will also be able to unlock your vault.",
  },
  // WR-02 fix (12-REVIEW.md, Plan 12-05): reworded to attribute PRF
  // unavailability to the SITE's request / THIS passkey's capability, never
  // "this browser" -- under D-16 the provider computes PRF entirely in
  // WASM regardless of browser, so blaming the browser here was factually
  // wrong for the provider role and re-introduced the exact browser-framing
  // D-16 forbids. The trigger stays wired to the real capability signal
  // (derivePrfCapability, provider-ceremony.ts) -- only the copy changed.
  "provider.prfUnavailableNote": {
    pl: "Ta strona poprosiła o funkcję PRF, której ten passkey nie obsługuje.",
    en: "This site requested a PRF feature this passkey can't provide.",
  },
  "provider.noMatchTransient": {
    pl: "Brak zapisanego passkeya dla tej strony — przełączamy na inną metodę.",
    en: "No saved passkey for this site — switching to another method.",
  },
  "provider.failed": {
    pl: "Nie udało się dokończyć operacji passkey. Spróbuj ponownie albo użyj innej metody.",
    en: "Couldn't complete the passkey operation. Try again, or use something else.",
  },
  "provider.closeAria": {
    pl: "Zamknij i użyj innej metody",
    en: "Close and use something else",
  },
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return tEngine(DICTIONARY, locale, key);
}
