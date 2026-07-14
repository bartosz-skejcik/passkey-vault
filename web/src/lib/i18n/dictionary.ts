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
    pl: "Zapamiętaj to hasło. Nie da się go odzyskać. Nikt, łącznie z nami, nie ma do niego dostępu.",
    en: "Remember this password. It cannot be recovered. No one, including us, has access to it.",
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
  "item.noFolder": { pl: "Bez folderu", en: "No folder" },
  "item.folderLabel": { pl: "Folder", en: "Folder" },
  "item.tagsLabel": { pl: "Tagi", en: "Tags" },

  // Item-type labels (badges, type picker) — Claude's-discretion copy, not
  // explicitly enumerated in UI-SPEC's Copywriting Contract table.
  "itemType.login": { pl: "Login", en: "Login" },
  "itemType.card": { pl: "Karta", en: "Card" },
  "itemType.identity": { pl: "Tożsamość", en: "Identity" },
  "itemType.note": { pl: "Notatka", en: "Note" },

  // Detail-panel/form field labels — Claude's-discretion copy, shared by
  // DetailPanel's view mode and ItemForm's create/edit fields.
  "field.name": { pl: "Nazwa", en: "Name" },
  "field.username": { pl: "Użytkownik", en: "Username" },
  "field.password": { pl: "Hasło", en: "Password" },
  "field.url": { pl: "URL", en: "URL" },
  "item.addUrl": { pl: "Dodaj URL", en: "Add URL" },
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

  "aria.closePanel": { pl: "Zamknij panel", en: "Close panel" },

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
  "generator.modeCharacter": { pl: "Znaki", en: "Characters" },
  "generator.modePassphrase": { pl: "Passphrase", en: "Passphrase" },

  "time.justNow": { pl: "Przed chwilą", en: "Just now" },
  "time.minutesAgo": { pl: "{n} min temu", en: "{n}m ago" },
  "time.hoursAgo": { pl: "{n} godz. temu", en: "{n}h ago" },
  "time.daysAgo": { pl: "{n} dni temu", en: "{n}d ago" },

  "autolock.label": { pl: "Blokuj po bezczynności", en: "Lock after inactivity" },
  "clipboard.durationLabel": {
    pl: "Czyszczenie schowka po",
    en: "Clear clipboard after",
  },

  "sidebar.all": { pl: "Wszystkie", en: "All" },
  "sidebar.folders": { pl: "Foldery", en: "Folders" },
  "sidebar.tags": { pl: "Tagi", en: "Tags" },
  "sidebar.newFolderPlaceholder": { pl: "Nazwa folderu", en: "Folder name" },
  "sidebar.categories": { pl: "Kategorie", en: "Categories" },
  "sidebar.catLogins": { pl: "Loginy", en: "Logins" },
  "sidebar.catCards": { pl: "Karty", en: "Cards" },
  "sidebar.catIdentities": { pl: "Tożsamości", en: "Identities" },
  "sidebar.catNotes": { pl: "Notatki", en: "Notes" },
  "sidebar.passkeys": { pl: "Passkeys", en: "Passkeys" },
  "sidebar.passkeysSoon": { pl: "wkrótce", en: "soon" },
  "sidebar.tools": { pl: "Narzędzia", en: "Tools" },
  "sidebar.generator": { pl: "Generator haseł", en: "Password generator" },
  "sidebar.account": { pl: "Konto", en: "Account" },

  "action.copyPassword": { pl: "Kopiuj hasło", en: "Copy password" },
  "action.copyUsername": { pl: "Kopiuj nazwę użytkownika", en: "Copy username" },
  "action.copyCardNumber": { pl: "Kopiuj numer karty", en: "Copy card number" },
  "action.copyEmail": { pl: "Kopiuj email", en: "Copy email" },
  "action.move": { pl: "Przenieś", en: "Move" },
  "action.delete": { pl: "Usuń", en: "Delete" },

  "error.revisionConflict": {
    pl: "Ten item zmienił się w międzyczasie (np. na innym urządzeniu). Odśwież i spróbuj ponownie.",
    en: "This item changed elsewhere in the meantime. Refresh and try again.",
  },
  "error.itemSaveFailed": {
    pl: "Nie udało się zapisać itemu. Spróbuj ponownie.",
    en: "Failed to save item. Please try again.",
  },
  "error.folderCreateFailed": {
    pl: "Nie udało się utworzyć folderu. Spróbuj ponownie.",
    en: "Failed to create folder. Please try again.",
  },
  "error.itemMoveFailed": {
    pl: "Nie udało się przenieść itemu. Spróbuj ponownie.",
    en: "Failed to move item. Please try again.",
  },

  "validation.required": { pl: "To pole jest wymagane", en: "This field is required" },
  "validation.passwordMismatch": {
    pl: "Hasła nie są identyczne",
    en: "Passwords don't match",
  },

  "aria.copyField": { pl: "Kopiuj {field}", en: "Copy {field}" },
  "aria.deleteItem": { pl: `Usuń „{name}"`, en: `Delete "{name}"` },
  "aria.itemMenu": { pl: `Więcej opcji dla „{name}"`, en: `More options for "{name}"` },
  "aria.showPassword": { pl: "Pokaż hasło", en: "Show password" },
  "aria.hidePassword": { pl: "Ukryj hasło", en: "Hide password" },
  "aria.dismissToast": { pl: "Zamknij powiadomienie", en: "Dismiss notification" },
  "aria.generatePassword": { pl: "Generuj hasło", en: "Generate password" },
  "aria.changeLanguage": { pl: "Zmień język", en: "Change language" },
  "aria.lockNow": { pl: "Zablokuj teraz", en: "Lock now" },
  "aria.logout": { pl: "Wyloguj się", en: "Log out" },
  "aria.newFolder": { pl: "Nowy folder", en: "New folder" },
  "aria.newTag": { pl: "Nowy tag", en: "New tag" },
  "aria.removeUrl": { pl: "Usuń URL", en: "Remove URL" },
  "aria.closeDrawer": { pl: "Zamknij panel", en: "Close panel" },
  "aria.toggleTheme": { pl: "Przełącz motyw", en: "Toggle theme" },

  // Self-test (dev diagnostic route, not part of UI-SPEC's copywriting
  // contract — added here per Task 4's carried-forward Phase 1 UI-REVIEW
  // fixes, which require these strings to be i18n-sourced, not hardcoded).
  "self-test.title": { pl: "Crypto Self-Test", en: "Crypto Self-Test" },
  "self-test.retry": { pl: "Uruchom ponownie", en: "Run again" },
  "self-test.running": { pl: "Uruchamianie...", en: "Running..." },
  "self-test.fatalHeading": {
    pl: "Self-test nie przeszedł",
    en: "Self-test failed",
  },
  "self-test.fatalBody": {
    pl: `Krok „initCrypto" zwrócił błąd: {error}. Sprawdź konsolę przeglądarki.`,
    en: `Step "initCrypto" returned an error: {error}. Check the browser console.`,
  },
  "self-test.allPassed": { pl: "{passed}/5 kroków przeszło", en: "{passed}/5 steps passed" },
  "self-test.partialFailed": {
    pl: "{passed}/5 kroków przeszło — patrz błąd przy kroku powyżej",
    en: "{passed}/5 steps passed — see the error at the step above",
  },

  // Passkey enrollment dialog (AUTH-03, Plan 03-03) — copy verbatim from
  // 03-UI-SPEC.md's Copywriting Contract. `passkeys.*`/`sessions.*`/
  // `settings.*` keys are deliberately NOT added here — those belong to
  // Plan 03-04's Settings tabs/panel, which owns the rest of this file's
  // growth in the next wave.
  "enroll.title": { pl: "Dodaj passkey", en: "Add passkey" },
  "enroll.step1Label": {
    pl: "Krok 1: rejestracja urządzenia",
    en: "Step 1: registering your device",
  },
  "enroll.step1Waiting": {
    pl: "Potwierdź w oknie przeglądarki lub na urządzeniu...",
    en: "Confirm in your browser or on your device...",
  },
  "enroll.step2Label": {
    pl: "Krok 2: włączanie odblokowania PRF",
    en: "Step 2: enabling PRF unlock",
  },
  "enroll.step2Waiting": {
    pl: "Potwierdź jeszcze raz, żeby włączyć odblokowanie vaulta tym passkeyem...",
    en: "Confirm once more to enable unlocking your vault with this passkey...",
  },
  "enroll.nameLabel": {
    pl: "Nazwa (możesz zmienić później)",
    en: "Name (you can change this later)",
  },
  "enroll.successPrfTitle": { pl: "Passkey dodany", en: "Passkey added" },
  "enroll.successPrfBody": {
    pl: "Ten passkey może teraz odblokować Twój vault.",
    en: "This passkey can now unlock your vault.",
  },
  "enroll.successNoPrfTitle": { pl: "Passkey dodany", en: "Passkey added" },
  "enroll.successNoPrfBody": {
    pl: "To urządzenie nie obsługuje PRF, więc passkey zadziała do logowania — vault nadal odblokujesz hasłem.",
    en: "This device doesn't support PRF, so the passkey works for sign-in — you'll still unlock the vault with your password.",
  },
  "enroll.cancelled": { pl: "Anulowano dodawanie passkeya.", en: "Passkey setup was cancelled." },
  "enroll.failed": {
    pl: "Nie udało się dodać passkeya. Spróbuj ponownie.",
    en: "Couldn't add the passkey. Please try again.",
  },
  "enroll.done": { pl: "Gotowe", en: "Done" },
  "enroll.retry": { pl: "Spróbuj ponownie", en: "Try again" },
  "enroll.cancel": { pl: "Anuluj", en: "Cancel" },

  // Settings panel + Passkeys/Sessions tabs (UI-05, AUTH-05/06/07, Plan
  // 03-04) — copy verbatim from 03-UI-SPEC.md's Copywriting Contract,
  // extended by this plan's binding morning-review resolutions (see
  // 03-UI-SPEC.md's "Resolutions" section) with a few keys the spec didn't
  // anticipate (per-passkey rename failure, per-session revoke confirm
  // modal — both are Claude's-discretion additions, not spec paraphrases).
  "settings.title": { pl: "Ustawienia", en: "Settings" },
  "settings.tabPasskeys": { pl: "Passkeys", en: "Passkeys" },
  "settings.tabSessions": { pl: "Sesje i urządzenia", en: "Sessions & devices" },
  "settings.tabSecurity": { pl: "Bezpieczeństwo", en: "Security" },
  "settings.tabImportExport": { pl: "Import/Eksport", en: "Import/Export" },
  "settings.importExportPlaceholder": {
    pl: "Import i eksport pojawią się w kolejnej fazie.",
    en: "Import and export are coming in a later phase.",
  },

  "passkeys.emptyState": {
    pl: "Nie masz jeszcze żadnego passkeya. Dodaj go, żeby móc odblokować vault jednym gestem.",
    en: "You don't have any passkeys yet. Add one to unlock your vault with a single gesture.",
  },
  "passkeys.addCta": { pl: "+ Dodaj passkey", en: "+ Add passkey" },
  "passkeys.createdLabel": { pl: "Utworzono {date}", en: "Created {date}" },
  "passkeys.lastUsedLabel": { pl: "Ostatnio użyty {time}", en: "Last used {time}" },
  "passkeys.neverUsed": { pl: "Nigdy nieużyty", en: "Never used" },
  "passkeys.prfBadge": { pl: "PRF", en: "PRF" },
  "passkeys.noPrfBadge": { pl: "Bez PRF", en: "No PRF" },
  "passkeys.noPrfExplainer": {
    pl: "Logowanie bez odblokowania PRF — vault odblokujesz hasłem.",
    en: "Sign-in only, no PRF unlock — you'll unlock the vault with your password.",
  },
  "passkeys.loadFailed": { pl: "Nie udało się wczytać passkeyów.", en: "Couldn't load your passkeys." },
  "passkeys.renameFailed": {
    pl: "Nie udało się zmienić nazwy. Spróbuj ponownie.",
    en: "Couldn't rename the passkey. Please try again.",
  },
  "passkeys.deleteTitle": { pl: `Usunąć passkey „{name}"?`, en: `Delete passkey "{name}"?` },
  "passkeys.deleteBody": {
    pl: "Ten passkey przestanie działać. Hasło główne zawsze pozostaje działającym sposobem odblokowania vaulta.",
    en: "This passkey will stop working. Your master password always remains a working way to unlock the vault.",
  },
  "passkeys.deleteConfirm": { pl: "Usuń passkey", en: "Delete passkey" },
  "passkeys.deleteBlockedError": {
    pl: "Nie można usunąć — vault musi mieć działający sposób odblokowania.",
    en: "Can't delete — the vault must always have a working unlock method.",
  },
  "passkeys.deleteFailed": {
    pl: "Nie udało się usunąć passkeya. Spróbuj ponownie.",
    en: "Couldn't delete the passkey. Please try again.",
  },

  "sessions.currentDevice": { pl: "to urządzenie", en: "this device" },
  "sessions.signedInLabel": { pl: "Zalogowano {date}", en: "Signed in {date}" },
  "sessions.lastActiveLabel": { pl: "Ostatnia aktywność {time}", en: "Last active {time}" },
  "sessions.unknownDevice": { pl: "Nieznane urządzenie", en: "Unknown device" },
  "sessions.revokeOthers": { pl: "Wyloguj pozostałe", en: "Sign out other sessions" },
  "sessions.revokeOthersConfirmTitle": {
    pl: "Wylogować pozostałe sesje?",
    en: "Sign out other sessions?",
  },
  "sessions.revokeOthersConfirmBody": {
    pl: "Wszystkie urządzenia oprócz tego zostaną wylogowane.",
    en: "All devices except this one will be signed out.",
  },
  "sessions.revokeOthersConfirmButton": { pl: "Tak, wyloguj", en: "Yes, sign out" },
  // Per-session revoke confirm modal (binding resolution #6 — both
  // destructive actions get a confirm modal, fat-finger/fat-key
  // prevention) — not in 03-UI-SPEC.md's original inline-confirm design,
  // added here since the spec never named a single-session confirm copy.
  "sessions.revokeConfirmTitle": { pl: "Wylogować to urządzenie?", en: "Sign out this device?" },
  "sessions.revokeConfirmBody": {
    pl: "To urządzenie zostanie wylogowane. Będziesz mógł/mogła zalogować się na nim ponownie w każdej chwili.",
    en: "This device will be signed out. You can sign back in on it anytime.",
  },
  "sessions.revokeConfirmButton": { pl: "Wyloguj", en: "Sign out" },
  "sessions.revokeFailed": {
    pl: "Nie udało się wylogować tej sesji. Spróbuj ponownie.",
    en: "Couldn't sign out that session. Please try again.",
  },
  "sessions.loadFailed": { pl: "Nie udało się wczytać sesji.", en: "Couldn't load your sessions." },

  "aria.renameSaveLabel": { pl: "Zapisz nazwę", en: "Save name" },
  "aria.renameCancelLabel": { pl: "Anuluj zmianę nazwy", en: "Cancel rename" },
  "aria.renamePasskeyLabel": {
    pl: `Zmień nazwę passkeya „{name}"`,
    en: `Rename passkey "{name}"`,
  },
  "aria.deletePasskeyLabel": { pl: `Usuń passkey „{name}"`, en: `Delete passkey "{name}"` },
  "aria.revokeSessionLabel": {
    pl: `Wyloguj sesję „{device}"`,
    en: `Sign out session "{device}"`,
  },
  "aria.openSettings": { pl: "Otwórz ustawienia", en: "Open settings" },
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return DICTIONARY[key][locale];
}

/**
 * Substitutes `{token}` placeholders in a translated string with the
 * given values. Falls back to appending the values (space-joined) when no
 * placeholder token is found in the template — this keeps components
 * correct under both the real dictionary (which contains the `{token}`
 * markers) and test doubles that stub `t()` as an identity function
 * returning the bare key (which obviously has no placeholder to replace).
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
