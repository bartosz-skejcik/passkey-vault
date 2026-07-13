// Client-side i18n dictionary — no framework routing, compatible with
// `output: "export"` (see 02-UI-SPEC.md's Copywriting Contract). Every
// string this phase introduces (and every icon-only aria-label) lives here,
// keyed by a short dot-path. Copy is PL/EN verbatim from the design
// contract; do not paraphrase.
export type Locale = "pl" | "en";

export const DICTIONARY = {
  "topbar.newItem": { pl: "+ Nowy item", en: "+ New item" },

  "auth.emailLabel": { pl: "Email", en: "Email" },
  "auth.passwordLabel": { pl: "Hasło główne", en: "Master password" },
  "auth.confirmPasswordLabel": {
    pl: "Powtórz hasło główne",
    en: "Confirm master password",
  },
  "auth.loginSubmit": { pl: "Zaloguj się", en: "Log in" },
  "auth.registerSubmit": { pl: "Załóż konto", en: "Create account" },
  "auth.toggleToRegister": {
    pl: "Nie masz konta? Zarejestruj się",
    en: "No account yet? Sign up",
  },
  "auth.toggleToLogin": {
    pl: "Masz już konto? Zaloguj się",
    en: "Already have an account? Log in",
  },
  "auth.irrecoverableWarning": {
    pl: "Zapamiętaj to hasło. Nie da się go odzyskać — nikt, łącznie z nami, nie ma do niego dostępu.",
    en: "Remember this password. It cannot be recovered — no one, including us, has access to it.",
  },
  "auth.wrongCredentials": {
    pl: "Nieprawidłowy email lub hasło",
    en: "Invalid email or password",
  },
  "auth.duplicateEmail": {
    pl: "Konto z tym adresem email już istnieje",
    en: "An account with this email already exists",
  },
  "auth.registrationFailed": {
    pl: "Nie udało się utworzyć konta. Spróbuj ponownie.",
    en: "Account creation failed. Please try again.",
  },
  "auth.loginFailed": {
    pl: "Logowanie nie powiodło się. Spróbuj ponownie.",
    en: "Login failed. Please try again.",
  },
  "auth.logout": { pl: "Wyloguj", en: "Log out" },

  "unlock.heading": { pl: "Odblokuj vault", en: "Unlock your vault" },
  "unlock.submit": { pl: "Odblokuj", en: "Unlock" },
  "unlock.sessionExpired": {
    pl: "Sesja wygasła. Zaloguj się ponownie.",
    en: "Your session expired. Please log in again.",
  },

  "vault.emptyHeading": { pl: "Vault jeszcze pusty", en: "Your vault is empty" },
  "vault.emptyBody": {
    pl: "Dodaj pierwszy item — hasło, kartę albo notatkę 👇",
    en: "Add your first item — a password, a card, or a note 👇",
  },

  "item.typePicker": { pl: "Wybierz typ itemu", en: "Choose item type" },
  "item.save": { pl: "Zapisz item", en: "Save item" },
  "item.edit": { pl: "Edytuj item", en: "Edit item" },
  "item.passkeyPlaceholder": {
    pl: "Brak passkeyów — enrollment dostępny wkrótce",
    en: "No passkeys yet — enrollment coming soon",
  },

  "delete.title": { pl: `Usunąć „{name}"?`, en: `Delete "{name}"?` },
  "delete.body": {
    pl: "Tej operacji nie da się cofnąć — item zniknie na stałe.",
    en: "This can't be undone — the item will be gone for good.",
  },
  "delete.confirm": { pl: "Usuń na stałe", en: "Delete permanently" },
  "delete.cancel": { pl: "Anuluj", en: "Cancel" },

  "toast.copied": {
    pl: "Skopiowano {field}. Wyczyści się za {n}s.",
    en: "Copied {field}. Clears in {n}s.",
  },
  "toast.cleared": { pl: "Schowek wyczyszczony.", en: "Clipboard cleared." },

  "search.placeholder": { pl: "Szukaj...", en: "Search..." },
  "search.emptyResults": {
    pl: `Brak wyników dla „{query}"`,
    en: `No results for "{query}"`,
  },

  "generator.regenerate": { pl: "Losuj ponownie", en: "Regenerate" },
  "generator.apply": { pl: "Użyj tego hasła", en: "Use this password" },

  "autolock.label": { pl: "Blokuj po bezczynności", en: "Lock after inactivity" },

  "error.revisionConflict": {
    pl: "Ten item zmienił się w międzyczasie (np. na innym urządzeniu). Odśwież i spróbuj ponownie.",
    en: "This item changed elsewhere in the meantime. Refresh and try again.",
  },

  "validation.required": { pl: "To pole jest wymagane", en: "This field is required" },
  "validation.passwordMismatch": {
    pl: "Hasła nie są identyczne",
    en: "Passwords don't match",
  },

  "aria.copyField": { pl: "Kopiuj {field}", en: "Copy {field}" },
  "aria.deleteItem": { pl: `Usuń „{name}"`, en: `Delete "{name}"` },
  "aria.showPassword": { pl: "Pokaż hasło", en: "Show password" },
  "aria.hidePassword": { pl: "Ukryj hasło", en: "Hide password" },
  "aria.dismissToast": { pl: "Zamknij powiadomienie", en: "Dismiss notification" },
  "aria.generatePassword": { pl: "Generuj hasło", en: "Generate password" },
  "aria.changeLanguage": { pl: "Zmień język", en: "Change language" },
  "aria.lockNow": { pl: "Zablokuj teraz", en: "Lock now" },
  "aria.logout": { pl: "Wyloguj się", en: "Log out" },
  "aria.newFolder": { pl: "Nowy folder", en: "New folder" },
  "aria.newTag": { pl: "Nowy tag", en: "New tag" },
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return DICTIONARY[key][locale];
}
