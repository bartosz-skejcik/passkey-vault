// pv-ui/i18n/common.ts — the shared dictionary slice (DS-02, plan 16-04).
// These 34 keys are both key-name-AND-value-identical between web's and
// extension's DICTIONARY objects, re-verified at execution time via a
// direct key-by-key diff of the live tree (not trusted from the plan's own
// list alone) -- confirming the same 34/4 split this plan's own RESEARCH
// found. Four key-name-shared-but-value-DIVERGENT keys are deliberately
// EXCLUDED here (vault.emptyHeading, vault.emptyBody, search.emptyResults,
// autolock.label) -- each surface keeps its own distinct PL/EN copy for
// those, local-only to its own dictionary.ts.
export const COMMON_DICTIONARY = {
  "auth.passwordLabel": { pl: "Hasło główne", en: "Master password" },
  "auth.loginSubmit": { pl: "Zaloguj się", en: "Log in" },
  "auth.loginFailed": {
    pl: "Logowanie nie powiodło się. Spróbuj ponownie.",
    en: "Login failed. Please try again.",
  },
  "unlock.submit": { pl: "Odblokuj", en: "Unlock" },
  "unlock.passkeyCta": { pl: "Odblokuj passkeyem", en: "Unlock with passkey" },
  "unlock.orDivider": { pl: "lub", en: "or" },
  "sort.label": { pl: "Sortuj", en: "Sort" },
  "sort.lastUsed": { pl: "Ostatnio używane", en: "Last used" },
  "sort.name": { pl: "Nazwa", en: "Name" },
  "itemType.login": { pl: "Login", en: "Login" },
  "itemType.card": { pl: "Karta", en: "Card" },
  "itemType.identity": { pl: "Tożsamość", en: "Identity" },
  "itemType.note": { pl: "Notatka", en: "Note" },
  "itemType.totp": { pl: "TOTP", en: "TOTP" },
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
  "field.rpId": { pl: "RP ID", en: "RP ID" },
  "search.placeholder": { pl: "Szukaj...", en: "Search..." },
  "aria.copyField": { pl: "Kopiuj {field}", en: "Copy {field}" },
  "aria.showPassword": { pl: "Pokaż hasło", en: "Show password" },
  "aria.hidePassword": { pl: "Ukryj hasło", en: "Hide password" },
} satisfies Record<string, { pl: string; en: string }>;
