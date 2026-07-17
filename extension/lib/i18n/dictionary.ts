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
export type Locale = "pl" | "en";

export const DICTIONARY = {
  // --- Loading / shell state (reused verbatim) -------------------------
  "loading.vault": { pl: "Ładowanie sejfu…", en: "Loading your vault…" },

  // --- Unlock / Sign-in (reused verbatim from 04-UI-SPEC.md unless noted)
  "auth.emailLabel": { pl: "Email", en: "Email" },
  "auth.passwordLabel": { pl: "Hasło główne", en: "Master password" },
  "auth.loginSubmit": { pl: "Zaloguj się", en: "Log in" },
  "auth.wrongCredentials": {
    pl: "Nieprawidłowy email lub hasło",
    en: "Invalid email or password",
  },
  "auth.loginFailed": {
    pl: "Logowanie nie powiodło się. Spróbuj ponownie.",
    en: "Login failed. Please try again.",
  },
  "unlock.submit": { pl: "Odblokuj", en: "Unlock" },
  "unlock.passkeyCta": { pl: "Odblokuj passkeyem", en: "Unlock with passkey" },
  // AMENDMENT 2026-07-15: reserved for the web app / a future options
  // page -- the Sign-in variant has NO PRF button in the popup this
  // phase (the extension passkey is UNLOCK-ONLY), so this key is unused
  // by any popup component, kept only so the string exists if a later
  // phase needs it.
  "unlock.passkeyLoginCta": {
    pl: "Zaloguj i odblokuj passkeyem",
    en: "Log in and unlock with passkey",
  },
  "unlock.passkeyBusy": {
    pl: "Potwierdź w przeglądarce lub na urządzeniu…",
    en: "Confirm in your browser or on your device…",
  },
  // 13-02-PLAN.md Task 2: no longer rendered by UnlockView.tsx's PRF-catch
  // paths (both now render the neutral `unlock.passkeyUnsupported` D-13
  // banner instead of this alarming `text-error` line) -- kept, unused, in
  // case a future phase needs a distinct "genuine hardware error" copy.
  "unlock.passkeyFailed": {
    pl: "Nie udało się użyć passkeya. Spróbuj ponownie albo użyj hasła poniżej.",
    en: "Couldn't use your passkey. Try again — or use your password below.",
  },
  "unlock.orDivider": { pl: "lub", en: "or" },
  // D-13 (13-02-PLAN.md, Bartek override, copy canon): ONE shared string for
  // every "this popup surface's passkey fast-path can't run here" case --
  // the Tier-1 "WebAuthn API entirely absent" case, AND the two new D-12
  // ceremony-catch cases (a genuine get()/create() failure, or a PRF-less
  // authenticator on the unlock get()-path). Browser-framed deliberately:
  // this IS a real browser WebAuthn ceremony on this surface (unlike the
  // passkey-PROVIDER ceremony's D-16 capability-framed copy, a different
  // surface -- see ProviderCeremonyView.tsx's own header comment).
  "unlock.passkeyUnsupported": {
    pl: "Szybkie odblokowanie passkeyem nie jest dostępne w tej przeglądarce — użyj hasła.",
    en: "Fast unlock isn't available for this passkey on this browser — use your password.",
  },
  "unlock.sessionLockedNotice": {
    pl: "Sesja wygasła po bezczynności — odblokuj ponownie.",
    en: "Your session locked after being idle — unlock again.",
  },

  // --- Extension-scoped PRF passkey (AMENDMENT 2026-07-15, verbatim) ---
  "extPasskey.promptTitle": {
    pl: "Odblokowuj szybciej passkeyem",
    en: "Unlock faster with a passkey",
  },
  "extPasskey.promptBody": {
    pl: "Utwórz passkey powiązany z tą wtyczką, aby odblokowywać sejf bez wpisywania hasła głównego.",
    en: "Create a passkey tied to this extension to unlock your vault without typing your master password.",
  },
  "extPasskey.promptCta": { pl: "Utwórz passkey", en: "Create a passkey" },
  "extPasskey.promptSkip": { pl: "Nie teraz", en: "Not now" },
  "extPasskey.promptDontAskAgain": { pl: "Nie pytaj ponownie", en: "Don't ask again" },
  "extPasskey.enrollDone": {
    pl: "Passkey gotowy — użyjesz go przy następnym odblokowaniu.",
    en: "Passkey ready — use it the next time you unlock.",
  },
  "extPasskey.enrollNoPrf": {
    pl: "Ten authenticator nie wspiera PRF — odblokowywanie passkeyem nie będzie dostępne. Hasło główne nadal działa.",
    en: "This authenticator doesn't support PRF — passkey unlock won't be available. Your master password still works.",
  },
  "extPasskey.enrollFailed": {
    pl: "Nie udało się utworzyć passkeya. Spróbuj ponownie albo odblokowuj hasłem.",
    en: "Couldn't create the passkey. Try again — or keep unlocking with your password.",
  },
  "extPasskey.unlockOrphaned": {
    pl: "Ten passkey nie pasuje do tego sejfu — odblokuj hasłem i utwórz passkey ponownie.",
    en: "This passkey doesn't match this vault — unlock with your password and create the passkey again.",
  },

  // --- Item list / search (reused verbatim) ----------------------------
  "search.placeholder": { pl: "Szukaj...", en: "Search..." },
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

  // --- Item type / field labels (Claude's-discretion, mirrors
  // web/src/lib/i18n/dictionary.ts's own precedent for these -- not in
  // UI-SPEC's Copywriting Contract table, needed for the item-detail
  // heading badge and per-type field rows) ------------------------------
  "itemType.login": { pl: "Login", en: "Login" },
  "itemType.card": { pl: "Karta", en: "Card" },
  "itemType.identity": { pl: "Tożsamość", en: "Identity" },
  "itemType.note": { pl: "Notatka", en: "Note" },
  "itemType.totp": { pl: "TOTP", en: "TOTP" },
  // Phase 12 (Plan 12-02): "passkey" now exists in the data model
  // (PasskeyFields, lib/vault/types.ts) -- ItemListView.tsx's TYPE_LABEL_KEY
  // Record needs this entry to stay exhaustive.
  "itemType.passkey": { pl: "Passkey", en: "Passkey" },

  "field.username": { pl: "Użytkownik", en: "Username" },
  "field.password": { pl: "Hasło", en: "Password" },
  "field.notes": { pl: "Notatki", en: "Notes" },
  "field.cardholderName": { pl: "Właściciel karty", en: "Cardholder name" },
  "field.number": { pl: "Numer karty", en: "Card number" },
  "field.expiry": { pl: "Data ważności", en: "Expiry" },
  "field.cvv": { pl: "CVV", en: "CVV" },
  "field.firstName": { pl: "Imię", en: "First name" },
  "field.lastName": { pl: "Nazwisko", en: "Last name" },
  "field.email": { pl: "Email", en: "Email" },
  "field.phone": { pl: "Telefon", en: "Phone" },
  "field.address": { pl: "Adres", en: "Address" },
  "field.body": { pl: "Treść", en: "Content" },
  "field.secret": { pl: "Sekret (base32)", en: "Secret (base32)" },
  // Guaranteed passkey-detail rows (BINDING, Bartek 2026-07-15) -- see
  // ItemDetailView.tsx; no "passkey" item type exists in the data model
  // yet (Phase 12 introduces it), so these keys are unused today but
  // ready the instant that type lands.
  "field.rpId": { pl: "RP ID", en: "RP ID" },
  "field.lastUsed": { pl: "Ostatnio użyty", en: "Last used" },

  "aria.copyField": { pl: "Kopiuj {field}", en: "Copy {field}" },
  "aria.showPassword": { pl: "Pokaż hasło", en: "Show password" },
  "aria.hidePassword": { pl: "Ukryj hasło", en: "Hide password" },
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
  return DICTIONARY[key][locale];
}

/**
 * Substitutes `{token}` placeholders in a translated string with the given
 * values -- same shape as web/src/lib/i18n/dictionary.ts's helper of the
 * same name.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  let replacedAny = false;
  for (const [key, value] of Object.entries(vars)) {
    const token = `{${key}}`;
    if (result.includes(token)) {
      result = result.split(token).join(value);
      replacedAny = true;
    }
  }
  if (!replacedAny) {
    const extra = Object.values(vars).join(" ");
    result = extra ? `${result} ${extra}` : result;
  }
  return result;
}

/**
 * One-shot locale detection (no stateful provider this phase -- the popup
 * has no language switcher yet, unlike the web app's LocaleContext).
 * `navigator` is always defined in a popup's DOM document; the
 * `typeof`-guard only matters for this module being importable from a
 * Node-environment vitest run (background tests) without crashing.
 */
export function resolveLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  return navigator.language.toLowerCase().startsWith("pl") ? "pl" : "en";
}
