// Client-side i18n dictionary — no framework routing, compatible with
// `output: "export"` (see 02-UI-SPEC.md's Copywriting Contract). Every
// string this phase introduces (and every icon-only aria-label) lives here,
// keyed by a short dot-path. Copy is PL/EN verbatim from the design
// contract; do not paraphrase.
//
// DS-02 (plan 16-04): this file is now a thin wrapper over the shared
// pv-ui/i18n engine -- DICTIONARY spreads COMMON_DICTIONARY (34 keys
// shared byte-for-byte with the extension's own dictionary.ts) plus every
// web-only entry below (content and key SET unchanged from before this
// refactor; only where each of the 34 shared keys' content LIVES changed,
// never its value). `t()`/`interpolate()`/`Locale`'s public signature stay
// byte-identical to the pre-refactor shape -- zero call-site churn at this
// file's ~16 `t(locale, key)` call sites.
import { COMMON_DICTIONARY } from "pv-ui/i18n/common";
import { t as tEngine, interpolate, type Locale } from "pv-ui/i18n/engine";

export { interpolate };
export type { Locale };

export const DICTIONARY = {
  ...COMMON_DICTIONARY,

  "topbar.newItem": { pl: "+ Nowy item", en: "+ New item" },

  "auth.emailLabel": { pl: "Email", en: "Email" },
  "auth.confirmPasswordLabel": {
    pl: "Powtórz hasło główne",
    en: "Confirm master password",
  },
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
  "auth.logout": { pl: "Wyloguj", en: "Log out" },

  "unlock.heading": { pl: "Odblokuj vault", en: "Unlock your vault" },
  "unlock.sessionExpired": {
    pl: "Sesja wygasła. Zaloguj się ponownie.",
    en: "Your session expired. Please log in again.",
  },

  // PRF unlock / login unification (AUTH-04, AUTH-09, UI-02, Plan 04-02) —
  // copy verbatim from 04-UI-SPEC.md's Copywriting Contract.
  "unlock.passkeyLoginCta": {
    pl: "Zaloguj i odblokuj passkeyem",
    en: "Log in and unlock with passkey",
  },
  "unlock.passkeyBusy": {
    pl: "Potwierdź w przeglądarce lub na urządzeniu…",
    en: "Confirm in your browser or on your device…",
  },
  "unlock.passkeyUnsupported": {
    pl: "Ta przeglądarka nie obsługuje logowania passkeyem na tym urządzeniu — użyj hasła głównego poniżej.",
    en: "This browser doesn't support passkey sign-in on this device — use your master password below.",
  },
  "unlock.prfUnavailableExplainer": {
    pl: "Twoje passkeye nie wspierają PRF — odblokuj hasłem.",
    en: "Your passkeys don't support PRF unlock — use your password.",
  },
  "unlock.passkeyFailed": {
    pl: "Nie udało się użyć passkeya. Spróbuj ponownie albo użyj hasła poniżej.",
    en: "Couldn't use your passkey. Try again — or use your password below.",
  },
  // 260803-cnd: AbortError (GESTURE_TIMEOUT_MS fired) is its own outcome,
  // distinct from unlock.passkeyFailed — a 60s timeout usually means the
  // person walked away or never completed the prompt, not that the passkey
  // itself is broken.
  "unlock.passkeyTimedOut": {
    pl: "Nie zdążyłeś potwierdzić passkeya na czas. Spróbuj ponownie albo użyj hasła poniżej.",
    en: "You didn't confirm your passkey in time. Try again — or use your password below.",
  },

  // Plan 13-06: ExtUnlockBridge.tsx — a small server-origin surface the
  // extension opens (`?pv-ext-unlock=<nonce>`) so a Firefox (or Chrome)
  // extension user can run the SAME server-rpId PRF ceremony as the web
  // app's own unlock, without unlocking the web app itself (D-03 tone).
  "extUnlock.heading": {
    pl: "Odblokuj rozszerzenie",
    en: "Unlock the extension",
  },
  "extUnlock.explainer": {
    pl: "Twoje rozszerzenie Passkey Vault potrzebuje jednego dotknięcia passkeyem, żeby się odblokować.",
    en: "Your Passkey Vault extension needs one passkey tap to unlock.",
  },
  "extUnlock.cta": { pl: "Odblokuj rozszerzenie", en: "Unlock the extension" },
  "extUnlock.busy": {
    pl: "Potwierdź w przeglądarce lub na urządzeniu…",
    en: "Confirm in your browser or on your device…",
  },
  "extUnlock.success": {
    pl: "Gotowe — to okno zaraz się zamknie.",
    en: "Done — this window will close shortly.",
  },
  "extUnlock.noPasskeys": {
    pl: "To konto nie ma jeszcze passkeya po stronie serwera — dodaj go w Ustawieniach sejfu.",
    en: "This account has no server-side passkey yet — add one in your vault's Settings.",
  },
  "extUnlock.noPasskeysSettingsLink": {
    pl: "Otwórz Ustawienia",
    en: "Open Settings",
  },
  "extUnlock.failed": {
    pl: "Nie udało się odblokować rozszerzenia. Możesz zamknąć to okno i spróbować ponownie.",
    en: "Couldn't unlock the extension. You can close this window and try again.",
  },
  "extUnlock.notSignedIn": {
    pl: "Zaloguj się najpierw do swojego sejfu w tej przeglądarce, a potem spróbuj ponownie z rozszerzenia.",
    en: "Sign in to your vault in this browser first, then try again from the extension.",
  },

  // Plan 13-07 (Bartek mandate, full SIGN-IN): the SAME ceremony window's
  // `mode: 'signin'` surface -- passkeyLogin identifies the user by EMAIL
  // (v0.1's own prelogin), so this mode adds a one-field email input before
  // the gesture (D-03 tone).
  "extUnlock.signinHeading": {
    pl: "Zaloguj się do rozszerzenia",
    en: "Sign in to the extension",
  },
  "extUnlock.signinExplainer": {
    pl: "Zaloguj się i odblokuj rozszerzenie Passkey Vault jednym dotknięciem passkeyem.",
    en: "Sign in and unlock your Passkey Vault extension with one passkey tap.",
  },
  "extUnlock.signinCta": {
    pl: "Zaloguj się passkeyem",
    en: "Sign in with a passkey",
  },
  "extUnlock.emailLabel": { pl: "Email", en: "Email" },
  // Plan 15-01 (AMENDMENT, 15-CONTEXT.md): the mode:'signin' surface offers
  // BOTH master-password sign-in AND passkey sign-in, passkey-first
  // presentation -- mirrors auth.passwordLabel's copy.
  "extUnlock.passwordLabel": { pl: "Hasło główne", en: "Master password" },
  "extUnlock.passwordSubmit": { pl: "Zaloguj hasłem", en: "Log in with password" },
  // Bartek live-UAT bug (13-07 signin flow, .planning/debug/resolved/
  // signin-passkeyless-spin.md): the signin-mode "failed" terminal state's
  // OWN copy -- distinct from extUnlock.failed's unlock-flavored wording,
  // and unable to name a specific cause (T-04-01 anti-enumeration means the
  // ceremony's own failure is indistinguishable from "no passkeys" from
  // this component's point of view) -- so the hint stays generic/neutral,
  // shown identically whether the typed email has zero, some, or no
  // passkeys at all.
  "extUnlock.signinFailed": {
    pl: "Logowanie passkeyem się nie powiodło. Sprawdź Ustawienia → Passkeys na tym koncie albo zaloguj się hasłem poniżej.",
    en: "Couldn't sign in with a passkey. Check Settings → Passkeys on this account, or sign in with your password below.",
  },

  // Quick task 260719-sxa (Bartek live finding, Zen Browser/Firefox on
  // macOS): the ceremony-verified-but-browser-cannot-return-PRF case
  // (D-03 tone) -- distinct from extUnlock.noPasskeys/extUnlock.signinFailed,
  // which both mean "no PRF-capable credential exists at all". Here the
  // passkey DID work (server verified it and returned a PRF-capable
  // prf_wrapped_uk); THIS browser's own WebAuthn extension results just came
  // back empty (Firefox's documented `{}` gap -- see
  // 13-FF-WEBAUTHN-RESEARCH.md), so the message must not imply the passkey
  // is broken or missing.
  "extUnlock.prfUnavailable": {
    pl: "Passkey zadziałał, ale ta przeglądarka nie zwróciła sekretu PRF potrzebnego do odblokowania sejfu (ograniczenie przeglądarki lub urządzenia). Odblokuj hasłem — albo spróbuj w Chrome, gdzie PRF działa.",
    en: "Your passkey worked, but this browser didn't return the PRF secret needed to unlock your vault (a browser or device limitation). Unlock with your password instead — or try Chrome, where PRF works.",
  },
  "extUnlock.signinPrfUnavailable": {
    pl: "Zalogowano passkeyem, ale ta przeglądarka nie zwróciła sekretu PRF potrzebnego do odblokowania sejfu (ograniczenie przeglądarki lub urządzenia). Zaloguj się hasłem — albo spróbuj w Chrome, gdzie PRF działa.",
    en: "You signed in with your passkey, but this browser didn't return the PRF secret needed to unlock your vault (a browser or device limitation). Sign in with your password instead — or try Chrome, where PRF works.",
  },

  // Two-part fix (Bartek live finding, Zen Browser/Firefox on macOS): once
  // extractPrfBytes' strict shape validation (login.ts) routes a malformed
  // PRF result into prfBrowserGap instead of a false success, the remaining
  // failure class is different -- the ceremony + server verification
  // SUCCEEDED and a genuine PRF envelope was POSTed to content-relay
  // (postAndWaitForAck), but the extension background's own unwrap/nonce
  // step failed (ack ok:false). Distinct from extUnlock.failed/
  // signinFailed (whose copy names Settings -> Passkeys, misleading here --
  // the passkey itself worked) and from extUnlock.prfUnavailable/
  // signinPrfUnavailable (this browser DID return usable PRF bytes; the
  // failure is background-side, not a browser/device PRF gap).
  "extUnlock.deliveryFailed": {
    pl: "Ceremonia passkeya przebiegła poprawnie, ale rozszerzenie nie zdołało odszyfrować sejfu w tej przeglądarce. Odblokuj hasłem — albo spróbuj w Chrome.",
    en: "Your passkey ceremony completed successfully, but the extension couldn't decrypt your vault in this browser. Unlock with your password instead — or try Chrome.",
  },
  "extUnlock.signinDeliveryFailed": {
    pl: "Ceremonia passkeya przebiegła poprawnie, ale rozszerzenie nie zdołało odszyfrować sejfu w tej przeglądarce. Zaloguj się hasłem — albo spróbuj w Chrome.",
    en: "Your passkey ceremony completed successfully, but the extension couldn't decrypt your vault in this browser. Sign in with your password instead — or try Chrome.",
  },

  "vault.emptyHeading": { pl: "Vault jeszcze pusty", en: "Your vault is empty" },
  "vault.emptyBody": {
    pl: "Dodaj pierwszy item — hasło, kartę albo notatkę 👇",
    en: "Add your first item — a password, a card, or a note 👇",
  },
  // Dynamic list header (Bartek live-review round 3, TASK 1) — replaces the
  // previously-static "Vault" heading above the item list with the active
  // filter's own name; "all"/itemType/folder read straight off existing
  // sidebar.*/itemType.*/folder.name, so only the tag-filter case needs a
  // dedicated template key.
  "vault.tagFilterHeading": { pl: "Tag: {tag}", en: "Tag: {tag}" },

  // Per-item last-used tracking sort control (quick-260717, NordPass-style)
  // — sits in the header area next to the dynamic heading above.

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
  // Phase 12: provider-created passkey vault item — copy matches the
  // extension popup's own "itemType.passkey" dictionary entry
  // (extension/lib/i18n/dictionary.ts) verbatim.

  // Detail-panel/form field labels — Claude's-discretion copy, shared by
  // DetailPanel's view mode and ItemForm's create/edit fields.
  "field.name": { pl: "Nazwa", en: "Name" },
  "field.url": { pl: "URL", en: "URL" },
  "item.addUrl": { pl: "Dodaj URL", en: "Add URL" },
  "field.issuer": { pl: "Wystawca", en: "Issuer" },
  "field.algorithm": { pl: "Algorytm", en: "Algorithm" },
  "field.digits": { pl: "Liczba cyfr", en: "Digits" },
  "field.period": { pl: "Okres (s)", en: "Period (s)" },

  // Card PIN/ZIP + identity structured address fields (Bartek live-review
  // round 4, TASKS 4/5/6) — Claude's-discretion copy, not literally named
  // by any prior UI-SPEC.
  "field.pin": { pl: "PIN karty", en: "Card PIN" },
  "field.zip": { pl: "Kod pocztowy", en: "ZIP or Postal Code" },
  "field.fullName": { pl: "Imię i nazwisko", en: "Full Name" },
  "field.addressLine1": { pl: "Adres (linia 1)", en: "Address Line 1" },
  "field.addressLine2": { pl: "Adres (linia 2)", en: "Address Line 2" },
  "field.city": { pl: "Miasto", en: "City" },
  "field.state": { pl: "Województwo/Stan", en: "State or Province" },
  "field.country": { pl: "Kraj lub region", en: "Country or Region" },

  // Card/identity CREATE/EDIT form section headers + address helper texts
  // (Bartek live-review round 4, TASKS 4/6) — "form.otherSection" is shared
  // by both the card and identity forms' "Inne"/"Other" section.
  "form.cardDetailsSection": { pl: "Dane karty", en: "Card Details" },
  "form.contactDetailsSection": { pl: "Dane kontaktowe", en: "Contact Details" },
  "form.addressDetailsSection": { pl: "Adres", en: "Address Details" },
  "form.otherSection": { pl: "Inne", en: "Other" },
  "form.addressLine1Helper": {
    pl: "Ulica, numer, skrytka pocztowa…",
    en: "Street address, P.O. box, etc.",
  },
  "form.addressLine2Helper": {
    pl: "Mieszkanie, piętro, budynek…",
    en: "Apartment, suite, building, floor, etc.",
  },

  // Passkey read-only metadata (Phase 12 cross-client fix) — "field.rpId"
  // matches the extension's own key verbatim (extension/lib/i18n/
  // dictionary.ts); "field.userDisplayName" is new here (the extension's
  // detail view doesn't surface it, but this fix's scope explicitly does).
  "field.userDisplayName": { pl: "Nazwa wyświetlana", en: "Display name" },
  // Passkey DETAIL panel composed layout (Bartek live-review, Proton
  // Pass-inspired): distinct from the generic "field.username"/"field.rpId"
  // labels above (those stay "Użytkownik"/"RP ID" for login/technical
  // contexts) — these are the non-technical labels for the same underlying
  // values (PasskeyFields.username/rpId) as shown in this specific section.
  "field.passkeyUsername": { pl: "Email lub nazwa użytkownika", en: "Email or Username" },
  "field.passkeyWebsite": { pl: "Adres strony", en: "Website Address" },
  "detail.passkeySectionTitle": { pl: "Passkey", en: "Passkey" },
  "detail.passkeyLastUpdated": { pl: "Ostatnia zmiana", en: "Last updated" },
  "detail.passkeyExplainer": {
    pl: "Passkey to unikalny klucz logowania przypisany do konkretnej strony. Jest bezpieczniejszy i wygodniejszy niż hasło, w pełni szyfrowany end-to-end.",
    en: "A passkey is a unique sign-in credential tied to a specific website. It's more secure and easier to use than a password, and end-to-end encrypted.",
  },

  // TOTP manual-add form (VAULT-07, Plan 06-01) — copy verbatim from
  // 06-UI-SPEC.md's Copywriting Contract.
  "totp.advancedToggle": { pl: "Zaawansowane", en: "Advanced" },
  "totp.secretHelper": {
    pl: "Wklej sekret base32 albo link otpauth://",
    en: "Paste a base32 secret or an otpauth:// link",
  },
  "totp.invalidSecretError": {
    pl: "Nieprawidłowy sekret TOTP — sprawdź format base32",
    en: "Invalid TOTP secret — check the base32 format",
  },

  // ImportWizard (IMPEX-01/02/03, Plan 06-03) — copy verbatim from
  // 06-UI-SPEC.md's Copywriting Contract; `import.mappingConfirm`/
  // `import.reasonUnparseableRow` are Claude's-discretion additions the
  // spec's table didn't literally name.
  "import.title": { pl: "Import", en: "Import" },
  "import.skip": { pl: "Pomiń na razie", en: "Skip for now" },
  "import.dropzoneLabel": {
    pl: "Przeciągnij plik tutaj albo kliknij, żeby wybrać",
    en: "Drag a file here or click to choose one",
  },
  "import.dropzoneHint": { pl: "Obsługiwane: .json, .csv", en: "Supported: .json, .csv" },
  "import.formatDetected": { pl: "Wykryto format: {format}", en: "Detected format: {format}" },
  "import.formatUnknown": {
    pl: "Nie rozpoznaliśmy formatu — zmapuj kolumny ręcznie",
    en: "We didn't recognize this format — map the columns manually",
  },
  "import.mappingTitle": { pl: "Dopasuj kolumny", en: "Map columns" },
  "import.mappingHint": {
    pl: "Wybierz, która kolumna pliku odpowiada każdemu polu",
    en: "Choose which column in your file matches each field",
  },
  "import.mappingConfirm": { pl: "Zatwierdź mapowanie", en: "Confirm mapping" },
  "import.previewTitle": {
    pl: "Podgląd — {n} pozycji do zaimportowania",
    en: "Preview — {n} items to import",
  },
  "import.previewEmpty": {
    pl: "Nie znaleźliśmy żadnych pozycji do zaimportowania w tym pliku.",
    en: "We couldn't find any items to import in this file.",
  },
  "import.startButton": { pl: "Importuj {n} pozycji", en: "Import {n} items" },
  "import.progressLabel": { pl: "Importowanie... {n} / {total}", en: "Importing... {n} / {total}" },
  "import.summaryTitle": { pl: "Import zakończony", en: "Import complete" },
  "import.summaryPartial": {
    pl: "Zaimportowano {imported} z {total} — pominięto {skipped}.",
    en: "Imported {imported} of {total} — {skipped} skipped.",
  },
  "import.summaryAllOk": {
    pl: "Zaimportowano wszystkie {total} pozycje.",
    en: "Imported all {total} items.",
  },
  "import.skippedReasonsToggle": { pl: "Pokaż powody pominięcia", en: "Show skip reasons" },
  "import.reasonMissingField": { pl: "Brak wymaganego pola", en: "Missing a required field" },
  "import.reasonOversizedField": { pl: "Pole zbyt duże", en: "Field too large" },
  "import.reasonUnparseableRow": {
    pl: "Nie udało się przetworzyć wiersza",
    en: "Couldn't process this row",
  },
  "import.genericFileError": {
    pl: "Nie udało się odczytać pliku. Sprawdź, czy to poprawny plik .json lub .csv.",
    en: "Couldn't read the file. Check that it's a valid .json or .csv file.",
  },
  "import.doneButton": { pl: "Gotowe", en: "Done" },
  "import.cancel": { pl: "Anuluj", en: "Cancel" },
  "import.back": { pl: "Wstecz", en: "Back" },

  // ExportDialog (IMPEX-04, Plan 06-03) — copy verbatim from
  // 06-UI-SPEC.md's Copywriting Contract.
  "export.warningTitle": {
    pl: "Eksportować vault w postaci jawnego tekstu?",
    en: "Export your vault as plain text?",
  },
  // Phase 12 cross-client fix: corrected — provider-created passkey vault
  // items now exist (PasskeyFields) and DO flow through export. The old
  // copy ("Passkeys aren't exported — they can't be transferred") was
  // accurate before Phase 12 but is a false, security-relevant claim now
  // that a JSON export includes a passkey's full credential material
  // (rawPasskeyJson, including key_cbor) — see toJson.ts/toCsv.ts.
  "export.warningBody": {
    pl: "Plik będzie zawierał każde hasło i sekret w czytelnej postaci — bez szyfrowania. W formacie JSON passkeye zawierają pełne dane poświadczenia (traktuj jak klucz prywatny) — w CSV widoczne są tylko metadane, bez materiału klucza. Po pobraniu to Ty odpowiadasz za bezpieczne usunięcie pliku.",
    en: "The file will contain every password and secret in plain, readable text — no encryption. In JSON, passkey items include their full credential material (treat it like a private key) — CSV only shows read-only metadata, never key material. Once downloaded, you're responsible for deleting the file securely.",
  },
  "export.confirm": { pl: "Pobierz mimo to", en: "Download anyway" },
  "export.cancel": { pl: "Anuluj", en: "Cancel" },
  "export.formatJson": { pl: "JSON", en: "JSON" },
  "export.formatCsv": { pl: "CSV", en: "CSV" },
  // DEBT-02 (Plan 29-02) — disclose, never mask: states plainly that the
  // export file contains the passwords for items shared to this user at
  // `hidden_password` access level. Literal copy from 29-UI-SPEC.md's
  // Copywriting Contract. Renders only when n > 0 (ExportDialog.tsx).
  "export.hiddenPasswordDisclosure": {
    pl: "Ten eksport zawiera hasła {n} wpisów udostępnionych Ci z ukrytym hasłem — to maskowanie działa tylko w interfejsie, nigdy kryptograficznie.",
    en: "This export includes the passwords for {n} items shared to you with a hidden password — that mask is an interface-only protection, never a cryptographic one.",
  },

  "aria.chooseFileToImport": { pl: "Wybierz plik do importu", en: "Choose a file to import" },
  "aria.closePanel": { pl: "Zamknij panel", en: "Close panel" },

  // Onboarding wizard (UI-04, Plan 06-04) — copy verbatim from
  // 06-UI-SPEC.md's Copywriting Contract. `onboarding.step2PrfAnnotation` is
  // a Claude's-discretion addition (the spec calls for a hand-drawn
  // annotation near the PRF card but doesn't literally name its copy).
  "onboarding.step1Title": { pl: "Zaimportuj swoje hasła", en: "Import your passwords" },
  "onboarding.step1Body": {
    pl: "Masz już menedżer haseł? Przenieś wszystko w minutę.",
    en: "Already have a password manager? Bring everything over in a minute.",
  },
  "onboarding.step2Title": { pl: "Poznaj swój vault", en: "Meet your vault" },
  "onboarding.step2PrfHeading": { pl: "Odblokuj passkeyem", en: "Unlock with a passkey" },
  "onboarding.step2PrfBody": {
    pl: "Dodaj passkey w Ustawieniach, żeby odblokowywać vault jednym gestem — bez wpisywania hasła.",
    en: "Add a passkey in Settings to unlock your vault with one gesture — no password typing.",
  },
  "onboarding.step2PrfAnnotation": { pl: "nowość", en: "new" },
  "onboarding.step2AutolockHeading": {
    pl: "Zawsze pilnujemy Twoich sekretów",
    en: "We always watch your secrets",
  },
  "onboarding.step2AutolockBody": {
    pl: "Vault blokuje się sam po bezczynności, a skopiowane hasła znikają ze schowka same.",
    en: "Your vault locks itself after inactivity, and copied passwords clear themselves from your clipboard.",
  },
  "onboarding.step3Title": { pl: "Gotowe — Twój vault czeka 🎉", en: "All set — your vault is ready 🎉" },
  "onboarding.step3Body": {
    pl: "Możesz dodawać, importować i porządkować hasła w dowolnym momencie.",
    en: "You can add, import, and organize your passwords any time.",
  },
  "onboarding.finish": { pl: "Przejdź do vaulta", en: "Go to your vault" },
  "onboarding.next": { pl: "Dalej", en: "Next" },
  "onboarding.skip": { pl: "Pomiń", en: "Skip" },
  "onboarding.stepIndicator": { pl: "Krok {n} z 3", en: "Step {n} of 3" },

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
  "sidebar.catTotp": { pl: "TOTP", en: "TOTP" },
  "sidebar.passkeys": { pl: "Passkeys", en: "Passkeys" },
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
  // Attributed variant (Plan 23-05, SYNC-06) — shown INSTEAD OF
  // error.revisionConflict only when the conflicting item is shared and the
  // 409 body carried a last_editor_email; a personal item's conflict always
  // keeps the generic copy above, byte-for-byte unchanged.
  "error.revisionConflictAttributed": {
    pl: "{email} zmienił(a) ten item w międzyczasie. Odśwież i spróbuj ponownie.",
    en: "{email} changed this item in the meantime. Refresh and try again.",
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

  "aria.deleteItem": { pl: `Usuń „{name}"`, en: `Delete "{name}"` },
  "aria.itemMenu": { pl: `Więcej opcji dla „{name}"`, en: `More options for "{name}"` },
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
  "aria.copyTotpCode": { pl: "Kopiuj kod TOTP", en: "Copy TOTP code" },
  "aria.codeRefreshCountdown": {
    pl: "Kod odświeży się za {n}s",
    en: "Code refreshes in {n}s",
  },

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
  // "Family" tab (FAM-04/05/06, Plan 24-05) — copy verbatim from
  // 24-UI-SPEC.md's Copywriting Contract.
  "settings.tabFamily": { pl: "Rodzina", en: "Family" },
  "settings.importExportPlaceholder": {
    pl: "Import i eksport pojawią się w kolejnej fazie.",
    en: "Import and export are coming in a later phase.",
  },
  // Import/Export tab CTAs (IMPEX-01/04, Plan 06-03) — copy verbatim from
  // 06-UI-SPEC.md's Copywriting Contract, replacing the placeholder above.
  "settings.importCta": { pl: "Zaimportuj hasła", en: "Import passwords" },
  "settings.importBody": {
    pl: "Zaimportuj hasła z Bitwardena, NordPass, 1Password, LastPass, KeePass albo dowolnego CSV/JSON.",
    en: "Import passwords from Bitwarden, NordPass, 1Password, LastPass, KeePass, or any CSV/JSON file.",
  },
  "settings.exportCta": { pl: "Eksportuj vault", en: "Export vault" },
  "settings.exportBody": {
    pl: "Pobierz kopię swojego vaulta w formacie JSON lub CSV.",
    en: "Download a copy of your vault as JSON or CSV.",
  },

  // `/settings` page shell (Phase 29, SET-01/02/04, 29-UI-SPEC.md's
  // Copywriting Contract) — the real route replacing the SettingsPanel
  // drawer above. `settings.title`/`settings.tabFamily` above stay
  // unchanged (the former is promoted to page-title use, the latter
  // retires with the tab mechanism it labeled).
  "settings.backToVault": { pl: "Wróć do sejfu", en: "Back to vault" },
  "settings.jumpNavLabel": { pl: "Nawigacja ustawień", en: "Settings navigation" },
  "settings.groupAccount": { pl: "Konto", en: "Account" },
  "settings.groupAccountDescription": {
    pl: "Passkeys, sesje i urządzenia, usuwanie konta.",
    en: "Passkeys, sessions and devices, account deletion.",
  },
  "settings.groupSecurity": { pl: "Bezpieczeństwo", en: "Security" },
  "settings.groupSecurityDescription": {
    pl: "Automatyczne blokowanie i czyszczenie schowka.",
    en: "Auto-lock and clipboard clearing.",
  },
  "settings.groupData": { pl: "Dane", en: "Data" },
  "settings.groupDataDescription": {
    pl: "Import i eksport całego vaulta.",
    en: "Import and export your whole vault.",
  },
  "settings.groupFamily": { pl: "Rodzina i udostępnianie", en: "Family & sharing" },
  "settings.groupFamilyDescription": {
    pl: "Zarządzaj rodziną i zaproszeniami.",
    en: "Manage your family and invitations.",
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

  // Sync status dot, live-edit-conflict banner, remote-delete toast (SYNC-03,
  // Plan 05-04) — copy verbatim from 05-UI-SPEC.md's Copywriting Contract.
  "sync.reconnecting": {
    pl: "Łączenie ponownie… dane i tak odświeżają się co 30s",
    en: "Reconnecting… data still refreshes every 30s",
  },
  "sync.itemChangedElsewhere": {
    pl: "Ten element zmienił się na innym urządzeniu.",
    en: "This item changed on another device.",
  },
  // Attributed variant (Plan 23-05, SYNC-06) — shown INSTEAD OF
  // sync.itemChangedElsewhere only when item.isShared && item.lastEditorEmail
  // are both present on the currently-viewed item; a personal item's live
  // conflict always keeps the generic copy above, byte-for-byte unchanged.
  //
  // WR-05 (code review iteration 1): reworded from "{email} is currently
  // editing this item" — `lastEditorEmail` is sourced from
  // `vault_items.last_editor_user_id`, which records who last SAVED an edit,
  // never who is presently editing (there is no presence tracking anywhere
  // in this codebase). The old copy asserted a live-presence fact the
  // server has no way to back up: the named person may have finished and
  // closed the tab an hour ago, or (DetailPanel.tsx's own suppression logic
  // below) the viewer may be looking at their own prior edit from another
  // device. Matches `error.revisionConflictAttributed`'s already-correct
  // past-tense phrasing.
  "sync.itemChangedElsewhereAttributed": {
    pl: "{email} zmienił(a) ten element.",
    en: "{email} changed this item.",
  },
  "sync.itemChangedElsewhereConsequence": {
    pl: "Odświeżenie zastąpi Twoje niezapisane zmiany.",
    en: "Refreshing will replace your unsaved changes.",
  },
  "sync.refreshAction": { pl: "Odśwież", en: "Refresh" },
  // CR-03 (code review iteration 1): shown on an item whose last background
  // sync merge failed to decrypt its server row (DetailPanel.tsx's
  // `item.undecryptable` banner) — the retained copy is a last-known-good
  // fallback at a now-stale revision, so editing is disabled until a
  // refresh resolves the failure.
  //
  // WR-01 (code review iteration 2): "Try refreshing the page" was actively
  // misleading — a page refresh re-locks the vault and re-runs the exact
  // same full-snapshot decrypt that just failed, so it cannot possibly help
  // (store.ts's `applySyncSnapshot` re-fetches the identical server row on
  // every unlock). Reworded to the honest remedy: this is an AEAD
  // integrity-failure signal (corrupted or tampered ciphertext), not a
  // transient glitch, so the right next step is reporting it, not refreshing.
  "sync.itemUndecryptableWarning": {
    pl: "Ten element nie mógł zostać odszyfrowany podczas ostatniej synchronizacji. Wyświetlana jest ostatnia znana wersja — edycja jest zablokowana. Może to oznaczać uszkodzone lub sfałszowane dane; jeśli się powtarza, skontaktuj się z administratorem serwera.",
    en: "This item failed to decrypt during the last sync. Showing the last known version -- editing is disabled. This can indicate corrupted or tampered data; if it persists, contact your server operator.",
  },
  "sync.itemDeletedElsewhere": {
    pl: "Ten element został usunięty na innym urządzeniu.",
    en: "This item was deleted on another device.",
  },

  // Invitation flow / owner-side "Invite someone" panel (FAM-04/05/06, Plan
  // 24-05) — copy verbatim from 24-UI-SPEC.md's Copywriting Contract (both
  // tables). `invite.fingerprintHonesty`/`invite.honestVisibilityNote` are
  // hard requirements — must never imply verification/loss-of-access that
  // did not happen (see UI-SPEC's honesty constraints). `toast.copied`'s
  // existing `{field}` interpolation is reused verbatim for the invite-link
  // copy toast (Plan 24-07's call site supplies the literal "Link
  // zaproszenia"/"Invite link" string) — no new dictionary key for that, and
  // `delete.cancel` is reused verbatim for the revoke-confirm cancel button.
  "invite.joinCta": { pl: "Dołącz do {family}", en: "Join {family}" },
  "invite.registerAndJoinCta": { pl: "Załóż konto i dołącz", en: "Create account & join" },
  "invite.joining": { pl: "Dołączanie…", en: "Joining…" },
  "family.bootstrapHeading": { pl: "Załóż swoją rodzinę", en: "Set up your family" },
  "family.bootstrapBody": {
    pl: "Zanim zaprosisz kogoś, nadaj swojej rodzinie nazwę.",
    en: "Before you invite anyone, give your family a name.",
  },
  "invite.failureMessage": {
    pl: "To zaproszenie już nie jest ważne.",
    en: "This invite is no longer valid.",
  },
  "invite.failureHint": {
    pl: "Poproś osobę, która Cię zaprosiła, o nowy link.",
    en: "Ask whoever sent you this link for a new one.",
  },
  "invite.failureCta": { pl: "Przejdź do logowania", en: "Go to sign in" },
  "invite.joinFailedRetryable": {
    pl: "Nie udało się dołączyć. Spróbuj ponownie.",
    en: "Couldn't join. Try again.",
  },
  "invite.joinRetryCta": { pl: "Spróbuj ponownie", en: "Try again" },
  "invite.continueToVaultCta": { pl: "Przejdź do swojego vaulta", en: "Continue to your vault" },
  "invite.revokeConfirmTitle": { pl: "Unieważnić ten link?", en: "Revoke this invite link?" },
  "invite.revokeConfirmBody": {
    pl: "Nikt nie będzie mógł już dołączyć przez ten link. To nieodwracalne.",
    en: "No one will be able to join using this link anymore. This can't be undone.",
  },
  "invite.revokeConfirmConfirm": { pl: "Unieważnij", en: "Revoke" },
  "invite.loadingLabel": { pl: "Ładowanie zaproszenia…", en: "Loading invite…" },
  // Quick task 260803-inv: was "Dołączyć do {family}?" / "Join {family}?" --
  // read wrong in Polish for a family name alone ("Join Paczesny?"). "rodziny"
  // (family) made explicit in both locales for a natural, consistent register.
  "invite.joinHeading": {
    pl: "Dołączyć do rodziny {family}?",
    en: "Join the {family} family?",
  },
  "invite.invitedBy": { pl: "Zaprasza: {inviter}", en: "Invited by {inviter}" },
  // Quick task 260803-inv: dropped the {inviter} interpolation -- this label
  // sits directly beneath invite.invitedBy, which already names the inviter;
  // repeating (and, at typical email lengths, truncating) the same address
  // here read as a templating accident rather than a design choice.
  "invite.fingerprintLabel": {
    pl: "Odcisk tożsamości",
    en: "Identity fingerprint",
  },
  // Quick task 260803-inv: PL's second {inviter} ("z {inviter} telefonicznie")
  // became "z tą osobą" ("with that person") now that the same email is
  // already named earlier in this same sentence -- matches EN's existing
  // "them" pattern. The honesty claim itself (T-24-16/UI-SPEC Copywriting
  // rule 1) is unchanged byte-for-byte in substance: verification requires an
  // out-of-band comparison; displaying the fingerprint here verifies nothing.
  "invite.fingerprintHonesty": {
    pl: "Ten odcisk pozwala zweryfikować tożsamość {inviter}, ale musisz to zrobić sam/sama — np. porównując go z tą osobą telefonicznie albo SMS-em. Samo wyświetlenie go tutaj niczego nie weryfikuje.",
    en: "This fingerprint lets you verify {inviter}'s identity — but only if you compare it with them yourself, e.g. over a call or a text. Displaying it here doesn't verify anything on its own.",
  },
  "invite.fingerprintUnavailable": {
    pl: "{inviter} nie ma jeszcze skonfigurowanego klucza tożsamości do zweryfikowania.",
    en: "{inviter} hasn't set up a verifiable identity key yet.",
  },
  "invite.currentAccountNotice": { pl: "Jesteś zalogowany/a jako {email}.", en: "You're signed in as {email}." },
  "invite.joinAsDifferentAccount": { pl: "Dołącz jako inne konto", en: "Join as a different account" },
  "invite.alreadyMemberNotice": {
    pl: "Jesteś już członkiem/członkinią {family}. Przenosimy Cię do vaulta.",
    en: "You're already a member of {family}. Taking you to your vault.",
  },
  "family.nameLabel": { pl: "Nazwa rodziny", en: "Family name" },
  "family.createCta": { pl: "Utwórz rodzinę", en: "Create family" },
  "family.createFailed": {
    pl: "Nie udało się utworzyć rodziny. Spróbuj ponownie.",
    en: "Couldn't create the family. Try again.",
  },
  // Added for WR-11 (24-REVIEW.md): a transient membership-fetch failure
  // (500/network/expired session) must render a truthful, recoverable
  // state -- never the false "Set up your family" claim it previously
  // collapsed into.
  "family.loadError": {
    pl: "Nie udało się wczytać danych rodziny.",
    en: "Couldn't load your family data.",
  },
  "family.loadRetryCta": { pl: "Spróbuj ponownie", en: "Try again" },
  // Added for WR-02 (24-REVIEW.md): GET /api/families/members is readable by
  // every member, but POST /api/invitations is owner-only -- a non-owner
  // member must see a truthful read-only notice instead of an invite form
  // that would always 404 on submit.
  "family.memberViewNotice": {
    pl: "Tylko właściciel/właścicielka rodziny może zapraszać nowych członków.",
    en: "Only the family owner can invite new members.",
  },
  "invite.sectionHeading": { pl: "Zaproś kogoś", en: "Invite someone" },
  "invite.scopeLabel": { pl: "Co udostępnić", en: "What to share" },
  "invite.scopeWholeFamily": { pl: "Cała rodzina", en: "Whole family" },
  // Plan 26-12: genuinely reachable now -- `invite-scope-select`'s "folder"
  // `<option>` is no longer `disabled`, and choosing it mounts a real
  // `CollectionPicker` (Plan 26-07) beneath the select. CR-02
  // (24-REVIEW.md)'s block (personal `vault_items.folder_id` had no id
  // overlap with the server's `collections` table) is discharged --
  // `CollectionPicker` sources real collections via `useCollections()`, not
  // `useFolders()`.
  "invite.scopeFolder": { pl: "Rodzina + jeden folder", en: "Family + one folder" },
  "invite.folderPickerLabel": { pl: "Wybierz folder", en: "Choose a folder" },
  "invite.folderPickerEmpty": {
    pl: "Utwórz najpierw folder, aby móc go udostępnić.",
    en: "Create a folder first so you can share it.",
  },
  // Still unused/orphaned after Plan 26-12: `CollectionPicker` (Plan 26-07)
  // owns its own empty/populated-state copy (`folder.pickerLabel`/
  // `folder.pickerEmpty`/`folder.pickerCreateNew`) rather than these
  // `invite.folderPicker*`/`invite.honestVisibilityNote` keys, which
  // predate that component's extraction. Not retired here -- out of this
  // plan's scope (only `invite.scopeFolderComingSoon`/
  // `invite.scopeFolderUnavailableNote` were the named obligation) -- but no
  // longer accurately described as blocked by a disabled option either.
  "invite.honestVisibilityNote": {
    pl: "Udostępnienie nie ukrywa zawartości tego folderu przed Tobą — jako właściciel/właścicielka rodziny zawsze masz do niej dostęp.",
    en: "Sharing doesn't hide this folder's contents from you — as the family owner, you always keep full access to it.",
  },
  "invite.expiryLabel": { pl: "Link wygasa po", en: "Link expires after" },
  "invite.expiry1h": { pl: "1 godzinie", en: "1 hour" },
  "invite.expiry24h": { pl: "24 godzinach", en: "24 hours" },
  "invite.expiry7d": { pl: "7 dniach", en: "7 days" },
  "invite.generateCta": { pl: "Wygeneruj link", en: "Generate link" },
  "invite.expiresAt": { pl: "Wygasa {date}", en: "Expires {date}" },
  "invite.copyLinkAria": { pl: "Skopiuj link zaproszenia", en: "Copy invite link" },
  // Added by Plan 24-07 (Rule 2/3 auto-fix): the E5 "invite-creation failure"
  // backstop requires a non-silent inline error message, and no existing key
  // covers it — `invite.failureMessage` is the REDEMPTION-side unified
  // failure copy (deliberately silent about cause, per Amendment 1); reusing
  // it here for an owner-side create failure would be a category error.
  // Follows the established `error.itemSaveFailed`/`family.createFailed`
  // "Nie udało się ___. Spróbuj ponownie." pattern.
  "invite.generateFailed": {
    pl: "Nie udało się wygenerować linku. Spróbuj ponownie.",
    en: "Couldn't generate the link. Try again.",
  },
  // Added for WR-09 (24-REVIEW.md): POST /api/invitations is owner-only, so
  // a 404 on generate means the caller's ownership changed since mount
  // (WR-02 already hides the form from non-owners in the common case) --
  // this is a truthful, distinct message, never "Try again" for something
  // retrying cannot fix.
  "invite.generateNotOwner": {
    pl: "Tylko właściciel/właścicielka rodziny może tworzyć zaproszenia.",
    en: "Only the family owner can create invites.",
  },
  // Added by Plan 24-07 Task 2 (Rule 2 auto-fix): a revoke failure needs its
  // own non-silent inline error, distinct from invite.generateFailed (a
  // revoke failing is a different cause than a generate failing, and
  // reusing the generate copy would misdescribe what happened).
  "invite.revokeFailed": {
    pl: "Nie udało się unieważnić linku. Spróbuj ponownie.",
    en: "Couldn't revoke the invite link. Try again.",
  },

  // Member removal, suspension & re-key (FAM-07..10, KEY-02, UX-04, Plan
  // 25-07/25-08/25-09) — copy verbatim from 25-UI-SPEC.md's Copywriting
  // Contract. Two of these keys (see their own inline comments below) are
  // hard, non-negotiable honesty strings — see the UI-SPEC's copywriting
  // honesty constraints (must never be omitted, softened, or relocated).
  "family.membersHeading": { pl: "Członkowie", en: "Members" },
  "family.roleOwner": { pl: "Właściciel/Właścicielka", en: "Owner" },
  "family.roleMember": { pl: "Członek/Członkini", en: "Member" },
  "family.joinedLabel": { pl: "Dołączył/a {date}", en: "Joined {date}" },
  "family.youBadge": { pl: "Ty", en: "You" },
  "family.statusSuspended": { pl: "Zawieszony/a", en: "Suspended" },
  "family.membersLoadFailed": {
    pl: "Nie udało się wczytać listy członków.",
    en: "Couldn't load the member list.",
  },
  "member.suspendAria": { pl: "Zawieś dostęp {email}", en: "Suspend {email}'s access" },
  "member.reinstateAria": { pl: "Przywróć dostęp {email}", en: "Restore {email}'s access" },
  "member.removeAria": { pl: "Usuń {email} z rodziny", en: "Remove {email} from the family" },
  "member.suspendFailed": {
    pl: "Nie udało się zawiesić dostępu. Spróbuj ponownie.",
    en: "Couldn't suspend access. Try again.",
  },
  "member.reinstateFailed": {
    pl: "Nie udało się przywrócić dostępu. Spróbuj ponownie.",
    en: "Couldn't restore access. Try again.",
  },
  "member.removeLoadingAccess": {
    pl: "Sprawdzanie dostępu {email}…",
    en: "Checking {email}'s access…",
  },
  "member.removeStep1Title": {
    pl: "Usunąć {email} z rodziny?",
    en: "Remove {email} from the family?",
  },
  "member.removeStep1Intro": {
    pl: "{email} straci dostęp do wszystkiego poniżej. To uruchomi ponowne szyfrowanie kluczy tych folderów.",
    en: "{email} will lose access to everything listed below. This triggers a re-key of these folders' keys.",
  },
  "member.removeAccessListHeading": {
    pl: "{email} miał/a dostęp do:",
    en: "{email} had access to:",
  },
  "member.removeAccessFolderLabel": { pl: `Folder „{folder}"`, en: `Folder "{folder}"` },
  // Per-FOLDER fallback. CR-04 (code review, Phase 25): `{count}` is now the
  // number of items in that folder whose names genuinely failed to resolve —
  // NOT the folder's total. The old code passed the total, so a folder with 9
  // resolved names and 1 failure reported "10 items … couldn't load their
  // names" AND threw away the 9 it had. It is reached only when at least one
  // item's name failed, and it now renders BESIDE the resolved names rather
  // than replacing them.
  "member.removeAccessItemsUnresolvedNote": {
    pl: "{count} itemów w tym folderze — nie udało się wczytać ich nazw.",
    en: "{count} items in this folder — couldn't load their names.",
  },
  // CR-04 (code review, Phase 25) — new key, an addition to 25-UI-SPEC.md's
  // Copywriting Contract. A standalone `item_shares` grant is NOT in a folder,
  // so reusing `member.removeAccessItemsUnresolvedNote` above rendered
  // literally "1 items in this folder — couldn't load their names" for an item
  // that is in no folder at all: factually wrong text in the phase's single
  // most safety-critical dialog. Singular, folder-free, and still reached only
  // on a genuine resolution failure (the dialog now attempts the caller's own
  // personal-vault decrypt path first, which resolves the common case where
  // the owner authored what they shared).
  "member.removeAccessItemUnresolvedNote": {
    pl: "Item udostępniony bezpośrednio — nie udało się wczytać jego nazwy.",
    en: "Directly shared item — couldn't load its name.",
  },
  // CR-03 (code review, Phase 25) — new key. A folder whose every item turned
  // out to be listed individually below (because each was ALSO a direct
  // `item_shares` grant) would otherwise render as a bare heading with nothing
  // under it, which 25-UI-SPEC.md's E4 "populated" row explicitly forbids.
  "member.removeAccessFolderItemsListedBelow": {
    pl: "Wszystkie itemy z tego folderu są wypisane pojedynczo poniżej.",
    en: "All items in this folder are listed individually below.",
  },
  // CR-03 (code review, Phase 25) — new key. A folder that genuinely contains
  // no items is a real, ordinary state and must say so plainly, rather than
  // rendering an empty heading the owner reads as "this folder is safe".
  "member.removeAccessFolderEmpty": {
    pl: "Ten folder nie zawiera żadnych itemów.",
    en: "This folder contains no items.",
  },
  "member.removeStep2Title": { pl: "Na pewno usunąć {email}?", en: "Remove {email} for good?" },
  // 28-04 gap fix (FAM-09 copy honesty): "natychmiast"/"immediately" used
  // to claim a literal, sub-second cutoff on the removed member's OWN
  // device. The bound this phase actually proved (28-03-SUMMARY.md,
  // dual-extension-removal.spec.ts/remove-member.spec.ts) is the next
  // COMPLETED sync cycle -- server-side denial is immediate (the DELETE's
  // own transaction), but the removed member's client only discovers and
  // purges its cached copy on its next poll: up to ~1 min on the extension
  // (chrome.alarms floor) or ~30s on web (setInterval). Reworded to state
  // that honest bound without being alarming -- same discipline
  // `member.removeHonestyWarning` already applies to its own claim.
  "member.removeStep2Body": {
    pl: "To działanie jest nieodwracalne. {email} traci dostęp po stronie serwera od razu, a klucze zostaną ponownie zaszyfrowane. Ich urządzenie usunie lokalną kopię danych przy najbliższej synchronizacji, zwykle w ciągu około minuty.",
    en: "This action is irreversible. {email} loses server-side access right away, and the affected keys will be re-encrypted. Their device purges its own cached copy on its next sync, usually within about a minute.",
  },
  "member.removing": { pl: "Usuwanie…", en: "Removing…" },
  "member.removeFailed": {
    pl: "Nie udało się usunąć członka. Spróbuj ponownie.",
    en: "Couldn't remove the member. Try again.",
  },
  "member.removeStep1Continue": { pl: "Dalej", en: "Continue" },
  "member.removeStep2Confirm": { pl: "Usuń na stałe", en: "Remove permanently" },
  "member.suspendConfirmConfirm": { pl: "Zawieś dostęp", en: "Suspend access" },
  "member.suspendConfirmTitle": {
    pl: "Zawiesić dostęp {email}?",
    en: "Suspend {email}'s access?",
  },
  "member.suspendConfirmBody": {
    pl: "{email} straci dostęp do udostępnionych folderów i itemów, ale zostanie w rodzinie. To odwracalne — możesz przywrócić dostęp w każdej chwili. Własne pliki {email} pozostają nietknięte.",
    en: "{email} will lose access to shared folders and items, but stays in the family. This is reversible — you can restore access anytime. {email}'s own personal vault is untouched.",
  },
  // Hard requirement (copywriting honesty constraint 1): must never be
  // omitted, softened, or relocated away from directly beneath the access
  // list on Remove step 1 — must never imply the re-key undoes prior
  // exposure.
  "member.removeHonestyWarning": {
    pl: "Usunięcie nie cofnie dostępu, który {email} już miał/a. Jeśli widział/a którekolwiek z powyższych haseł lub sekretów, wciąż je zna — zmiana kluczy chroni tylko przyszły dostęp. Zalecamy zmianę (rotację) tych danych logowania.",
    en: "Removing {email} does not undo access they already had. If they saw any of the passwords or secrets above, they still know them — re-keying only protects future access. We recommend rotating those credentials.",
  },
  "member.removeAccessListEmpty": {
    pl: "{email} nie miał/a dostępu do żadnych udostępnionych folderów ani itemów.",
    en: "{email} had no access to any shared folders or items.",
  },
  "member.removeAccessLoadFailed": {
    pl: "Nie udało się sprawdzić, do czego {email} miał/a dostęp. Spróbuj ponownie, zanim usuniesz to konto.",
    en: "Couldn't check what {email} had access to. Try again before removing this account.",
  },
  "family.suspendedBannerTitle": {
    pl: "Twój dostęp do udostępnionych treści jest zawieszony",
    en: "Your access to shared content is suspended",
  },
  "family.suspendedBannerBody": {
    pl: "Właściciel/Właścicielka rodziny tymczasowo wstrzymał/a Twój dostęp do udostępnionych folderów i itemów. Twoje własne hasła i notatki są bezpieczne i niezmienione.",
    en: "The family owner has temporarily paused your access to shared folders and items. Your own passwords and notes are safe and unchanged.",
  },
  "account.deleteSectionHeading": { pl: "Usuń konto", en: "Delete account" },
  "account.deleteSectionBody": {
    pl: "To działanie jest ostateczne i nie można go cofnąć.",
    en: "This action is final and can't be undone.",
  },
  "account.deleteTriggerCta": { pl: "Usuń konto", en: "Delete account" },
  "account.deleteStep1Title": { pl: "Usunąć swoje konto?", en: "Delete your account?" },
  "account.deleteStep1Body": {
    pl: "To usunie na stałe Twój vault, passkeye, sesje i klucz tożsamości. Jeśli jesteś w rodzinie, stracisz dostęp do udostępnionych folderów, a ich klucze zostaną ponownie zaszyfrowane dla pozostałych członków.",
    en: "This permanently deletes your vault, passkeys, sessions, and identity key. If you belong to a family, you'll lose access to shared folders and their keys will be re-encrypted for the remaining members.",
  },
  "account.deleteStep2Title": { pl: "To nieodwracalne", en: "This can't be undone" },
  "account.deleteStep2Body": {
    pl: "Twoje konto i wszystkie jego dane zostaną usunięte na stałe.",
    en: "Your account and all its data will be permanently deleted.",
  },
  "account.deleting": { pl: "Usuwanie konta…", en: "Deleting account…" },
  "account.deleteFailed": {
    pl: "Nie udało się usunąć konta. Spróbuj ponownie.",
    en: "Couldn't delete the account. Try again.",
  },
  "account.deleteConfirm": { pl: "Usuń konto na stałe", en: "Delete account permanently" },
  // Hard requirement (copywriting honesty constraint 2): must render for the
  // owner and must interpolate a real family name and a real member count —
  // never a generic "this affects other people" without specifics. A
  // non-owner deleting their own account never sees this string.
  //
  // WR-07 (code review, Phase 25) — DELIBERATE amendment to 25-UI-SPEC.md's
  // literal text, because that text was factually false about the shipped
  // behavior. `account::delete_account_as_owner` step 1 is
  // `DELETE FROM vault_items WHERE collection_id IN (SELECT id FROM collections
  // WHERE family_id = ?)` — scoped by collection only, so it destroys items
  // authored by EVERY member, not just the departing owner. The old copy told
  // the owner those members' "vaults stay untouched", which read as "they only
  // lose access". They lose the rows.
  //
  // The BEHAVIOR is the correct half and was left alone: an item in a shared
  // folder is encrypted under that folder's Collection Key with
  // collection-scoped AAD, so "preserving" it by nulling `collection_id` would
  // hand its author a personal item their own client provably cannot decrypt —
  // silent corruption dressed up as rescued data. Deletion is honest; the copy
  // now says so. `tests/account_deletion.rs::owner_dissolution_deletes_items_
  // authored_by_other_members_as_the_copy_now_states` pins the behavior to
  // this string so the two cannot drift apart again.
  //
  // "personal" is added to the final sentence to keep the genuinely-true half
  // (items OUTSIDE the shared folders really are untouched) unambiguous now
  // that the sentence before it admits the deletion.
  "account.deleteOwnerWarning": {
    pl: `Jesteś właścicielem/właścicielką rodziny „{family}". Usunięcie konta zakończy tę rodzinę dla wszystkich — {count} os. straci dostęp do udostępnionych folderów, a cała zawartość tych folderów zostanie trwale usunięta, w tym itemy utworzone tam przez innych członków. Ich własne, osobiste vaulty pozostaną nietknięte.`,
    en: `You own the "{family}" family. Deleting your account ends this family for everyone — {count} member(s) will lose access to shared folders, and everything inside those folders will be permanently deleted, including items other members created there. Their own personal vaults stay untouched.`,
  },
  "access.readOnly": { pl: "Tylko odczyt", en: "Read-only" },
  "access.fullEdit": { pl: "Pełna edycja", en: "Full edit" },
  "access.hiddenPassword": { pl: "Ukryte hasło", en: "Hidden password" },
  // WR-13 (code review, Phase 25) — new key. An `access_level` outside
  // `read|edit|hidden_password` used to fall back to `access.readOnly`, i.e.
  // an unknown grant displayed as the LEAST privileged, most reassuring label,
  // inside the dialog whose entire purpose is telling the owner how much the
  // removed member could see. Fails closed instead, mirroring
  // `membership.rs::parse_access_level`'s own "never silently treated as a
  // valid access grant" discipline.
  "access.unknown": { pl: "Nieznany poziom dostępu", en: "Unknown access level" },

  // Phase 26 (Plan 06) — sharing UI + family management. Copy sourced
  // VERBATIM from 26-UI-SPEC.md's "## Copywriting Contract" table; do not
  // retype the Polish diacritics from memory or paraphrase. The five keys
  // immediately below (hiddenPasswordDisclosureTitle/Body/Ack,
  // hiddenPasswordInlineNote, fingerprintMismatchWarning) are the phase's
  // hard, non-negotiable honesty strings (D-2/UX-03, honesty constraints
  // 1-5) — never shortened, softened, or reworded to imply the password is
  // hidden from the recipient in any cryptographic sense, and
  // `identity.fingerprintMismatchWarning` is a SEPARATE key from the
  // reused `invite.fingerprintHonesty` (comparison ritual), never merged
  // into it, since other surfaces depend on that key's exact wording.
  "share.hiddenPasswordDisclosureTitle": {
    pl: `O co chodzi z „ukrytym hasłem"`,
    en: `What "hidden password" actually means`,
  },
  "share.hiddenPasswordDisclosureBody": {
    pl: `To ukrywa hasło TYLKO w interfejsie — osoba z dostępem nadal posiada klucz i technicznie może je odzyskać (np. przez narzędzia deweloperskie przeglądarki albo bezpośredni odczyt zaszyfrowanych danych, jeśli ma dostęp do własnego klucza). To nie jest zabezpieczenie kryptograficzne. Wybierz ten poziom, gdy chcesz, żeby ktoś mógł używać hasła bez przypadkowego zobaczenia go na ekranie — nie jako sposób na ukrycie go PRZED tą osobą.`,
    en: `This hides the password only in the interface — anyone with access still holds the decryption key and can technically recover it (e.g. via browser developer tools, or by reading the encrypted data directly if they have their own key). It is not a cryptographic protection. Use this level when you want someone to be able to use the password without accidentally seeing it on screen — not as a way to hide it FROM that person.`,
  },
  "share.hiddenPasswordDisclosureAck": {
    pl: "Rozumiem, przyznaj dostęp",
    en: "I understand, grant access",
  },
  "share.hiddenPasswordInlineNote": {
    pl: "Ukryte tylko w interfejsie — {recipient} nadal ma dostęp do klucza.",
    en: "Hidden in the interface only — {recipient} still has key access.",
  },
  // WR-04 (code review, Phase 26): 26-UI-SPEC.md:169 requires
  // `share.hiddenPasswordInlineNote`'s `{recipient}` to interpolate "the
  // selected member's email, or a generic PL `odbiorca`/EN `the recipient`
  // when no single recipient is yet selected". The generic half was never
  // implemented and this key did not exist, so the note -- rendered as soon
  // as hidden-password is selected, BEFORE any recipient is picked --
  // rendered subject-less: "Ukryte tylko w interfejsie —  nadal ma dostęp
  // do klucza." Per D-2 this note is the only honesty text most users ever
  // see after the first modal, so a malformed render is a real defect, not
  // a typo.
  "share.hiddenPasswordRecipientFallback": { pl: "odbiorca", en: "the recipient" },
  "identity.fingerprintMismatchWarning": {
    pl: "Jeśli słowa się nie zgadzają, klucz, który widzisz, nie należy do tej osoby — nie udostępniaj jej niczego i zgłoś to.",
    en: "If the words don't match, the key you're seeing isn't theirs — don't share anything with them, and report it.",
  },
  "share.itemDialogTitle": {
    pl: `Udostępnij „{name}"`,
    en: `Share "{name}"`,
  },
  "share.folderDialogTitleExisting": {
    pl: `Udostępnij folder „{name}"`,
    en: `Share folder "{name}"`,
  },
  "share.folderDialogTitleNew": { pl: "Nowy udostępniony folder", en: "New shared folder" },
  "share.recipientsLabel": { pl: "Komu udostępnić", en: "Share with" },
  "share.noOtherMembers": {
    pl: "W Twojej rodzinie nie ma jeszcze innych członków. Zaproś kogoś, żeby móc udostępniać.",
    en: "There are no other members in your family yet. Invite someone before you can share.",
  },
  "share.accessLevelLabel": { pl: "Poziom dostępu", en: "Access level" },
  // Deliberately not a bare "Udostępnij"/"Share" — the same submit button
  // backs two structurally different grants across the item/folder
  // variants, and honesty constraint 4 requires that distinction stay
  // legible through to the CTA itself.
  "share.ctaFolder": { pl: "Udostępnij folder", en: "Share folder" },
  "share.ctaItem": { pl: "Udostępnij item", en: "Share item" },
  // 26-12a gap fix: dedicated ENTRY-POINT copy, deliberately distinct from
  // the two submit CTAs directly above. ItemContextMenu.tsx (menu text) and
  // DetailPanel.tsx (Share2 icon aria-label) both used to reuse
  // `share.ctaItem` here — the button that OPENS ShareDialog should not
  // read identically to the button that SUBMITS the grant inside it.
  // `share.shareThisFolder`'s literal matches 26-UI-SPEC.md's own E2 prose
  // ("Udostępnij ten folder") verbatim; `share.shareThisItem` mirrors that
  // same register for the item-level entry points (E1), which the UI-SPEC
  // itself only described generically as "Share…" without a literal.
  "share.shareThisItem": { pl: "Udostępnij ten item", en: "Share this item" },
  "share.shareThisFolder": { pl: "Udostępnij ten folder", en: "Share this folder" },
  "share.sharing": { pl: "Udostępnianie…", en: "Sharing…" },
  "share.createFailed": {
    pl: "Nie udało się udostępnić. Spróbuj ponownie.",
    en: "Couldn't share. Try again.",
  },
  // CR-01 (code review, Phase 26): the PARTIAL-failure report. Previously
  // any throw anywhere in the per-recipient loop rendered
  // `share.createFailed` ("Couldn't share. Try again.") even when N-1 grants
  // had already committed server-side — the copy actively invited a retry
  // that made the state worse. This key names exactly which recipients did
  // NOT get access and states plainly that the successful ones already did,
  // so the retry the user is being invited to make is an honest one (the
  // per-recipient loop now treats a 409 on an already-granted recipient as
  // success-for-that-recipient, so retrying is genuinely idempotent).
  "share.partialShareFailed": {
    pl: "Nie udało się udostępnić: {recipients}. Pozostałe dostępy zostały już przyznane — ponowna próba ich nie zduplikuje.",
    en: "Couldn't share with: {recipients}. The other grants already went through — retrying won't duplicate them.",
  },
  "share.newFolderNameLabel": { pl: "Nazwa folderu", en: "Folder name" },
  // WR-05 (code review, Phase 26): a seed-move partial failure used to
  // render `share.createFailed` ("Couldn't share. Try again.") over a share
  // that genuinely SUCCEEDED -- the folder and every member grant had
  // committed, and only some of the seeded items failed to move. That copy
  // both misdescribed the outcome and invited a retry, and it never showed
  // the failure count, so the user could not tell what had not moved.
  // "elem." (not a declined noun) sidesteps Polish plural-form agreement the
  // same way share.seedFolderSummary's own count does.
  "share.seedMoveFailed": {
    pl: "Folder został udostępniony, ale {count} elem. nie udało się przenieść.",
    en: "The folder was shared, but {count} items couldn't be moved.",
  },
  // Plan 26-08 addition (Rule 2 auto-fix): 26-UI-SPEC.md's E3 "folder-create
  // variant — seed items" row requires "a non-editable summary line naming
  // that folder and its item count" when ShareDialog's folder-create variant
  // is seeded from an existing personal folder (Sidebar's "Share this
  // folder" action, E2) — this key was missing from Plan 26-06's otherwise-
  // complete dictionary pass. "elem." (not a declined noun) sidesteps Polish
  // plural-form agreement the same way sharing.sharedWithLabel's "os." does.
  "share.seedFolderSummary": {
    pl: `Zawartość folderu „{folder}" ({count} elem.) trafi do nowego udostępnionego folderu.`,
    en: `The contents of "{folder}" ({count} items) will move into this new shared folder.`,
  },
  "share.itemSharedOnCollectionNote": {
    pl: `Ten item jest częścią udostępnionego folderu „{folder}" — dostęp zarządzasz na poziomie folderu.`,
    en: `This item is part of the shared folder "{folder}" — manage access at the folder level.`,
  },
  "sharing.navLabel": { pl: "Udostępnione", en: "Shared" },
  "sharing.overviewHeading": { pl: "Co udostępniasz", en: "What you're sharing" },
  "sharing.tabByFolder": { pl: "Wg folderu", en: "By folder" },
  "sharing.tabByPerson": { pl: "Wg osoby", en: "By person" },
  "sharing.emptyHeading": { pl: "Nic nie udostępniasz", en: "You're not sharing anything" },
  "sharing.emptyBody": {
    pl: "Udostępnij folder lub pojedynczy item, żeby zobaczyć go tutaj.",
    en: "Share a folder or a single item to see it here.",
  },
  "sharing.sharedWithLabel": { pl: "Udostępniono {count} os.", en: "Shared with {count}" },
  // CR-02 (code review, Phase 26): the INBOUND-share marker. An item shared
  // TO the caller used to render the identical outgoing recipient stack
  // (`isShared === true` alone), telling the user they were sharing
  // something a third party actually owns. This label names the direction
  // explicitly instead.
  "sharing.sharedWithYouLabel": { pl: "Udostępnione Tobie", en: "Shared with you" },
  // CR-02: replaces the item-level Share affordance for an item the caller
  // does not own — the same "replaced, never merely disabled" discipline
  // `share.itemSharedOnCollectionNote` already applies to a
  // collection-scoped item (E1), for the same reason: a clickable Share
  // action that structurally cannot produce a grant is a UI lie.
  "share.sharedWithYouNote": {
    pl: "Ten item udostępniła Ci inna osoba — dostępem zarządza jego właściciel.",
    en: "Someone else shared this item with you — its owner manages access.",
  },
  // 26-VERIFICATION.md gap 3 (WINDOWS #11 / commit 4450dc0 class, third
  // occurrence): the Edit affordance was rendered for a directly-shared item
  // and every save failed with `error.itemSaveFailed` -- "Failed to save
  // item. Please try again." -- over an operation that is structurally
  // impossible and will never succeed, inviting an infinite retry.
  // `DirectShareNotEditableError` (store.ts) had the correct data-layer
  // refusal and ZERO UI consumers.
  //
  // Says plainly that the capability does not exist yet, and names the one
  // action that does work (ask the owner). Deliberately does NOT explain the
  // crypto reason in user copy -- "no encrypt-as-shared-key-recipient
  // primitive exists" is true but useless to the reader, and any shorter
  // paraphrase of it ("this app has no key for it") would be FALSE: the
  // recipient does hold the item's Cipher Key. Same "not yet available,
  // stated plainly" pattern Phase 24 used for the collection-scoped invite.
  // 26-VERIFICATION.md gap 1 (SHARE-03 / UX-03) — the RECIPIENT-side half of
  // the hidden-password honesty contract. D-2's existing copy is entirely
  // owner-facing (shown at share time); a recipient opening the item saw
  // nothing at all explaining why the reveal toggle is missing, which would
  // read as a bug rather than a deliberate, disclosed level.
  //
  // Says exactly what is true and no more. "this view masks it" is a claim
  // about THIS surface, deliberately not the absolute "hidden in the
  // interface" -- an export, the browser devtools, or a future client can
  // still produce the value, and the second sentence says so in the same
  // breath rather than leaving the reader to infer it. Same register and
  // same honesty constraint as `share.hiddenPasswordDisclosureBody`: never
  // reworded to imply the password is hidden FROM this reader in any
  // security sense. They hold the key; the copy must keep saying so.
  "share.hiddenPasswordRecipientNote": {
    pl: "Właściciel udostępnił to hasło jako ukryte — ten widok je maskuje. Nadal możesz je skopiować i użyć, a klucz i tak jest w Twoich rękach, więc to nie jest zabezpieczenie kryptograficzne.",
    en: "The owner shared this password as hidden — this view masks it. You can still copy and use it, and you hold the key anyway, so this is not a cryptographic protection.",
  },
  "share.sharedWithYouNotEditable": {
    pl: "Edycja itemu udostępnionego Ci bezpośrednio nie jest jeszcze dostępna. Poproś właściciela o wprowadzenie zmiany.",
    en: "Editing isn't available yet for an item shared directly with you. Ask its owner to make the change.",
  },
  // SHARE-06 revoke (Phase 28, Plan 02) -- 28-UI-SPEC.md's Copywriting
  // Contract §A, verbatim. `share.revokeBody` is the hard, non-negotiable
  // honesty string this row exists to deliver, same class of requirement as
  // `member.removeHonestyWarning` above -- must never be shortened or
  // reworded to imply revoking access retroactively protects a
  // password/secret the recipient already saw. `delete.cancel` is reused
  // verbatim for the revoke dialog's Cancel button -- no new key.
  "share.revokeFolderTitle": {
    pl: `Cofnąć dostęp „{email}" do folderu „{folder}"?`,
    en: `Revoke {email}'s access to "{folder}"?`,
  },
  "share.revokeItemTitle": {
    pl: `Cofnąć dostęp „{email}" do „{item}"?`,
    en: `Revoke {email}'s access to "{item}"?`,
  },
  "share.revokeBody": {
    pl: "{email} straci dostęp od teraz. Jeśli już widział/a hasło lub inne dane w środku, nadal je zna — cofnięcie dostępu nie cofa tego, co już zobaczył/a.",
    en: "{email} loses access from now on. If they already saw the password or other contents, they still know it — revoking access does not undo what they've already seen.",
  },
  "share.revokeConfirm": { pl: "Cofnij dostęp", en: "Revoke access" },
  "share.revoking": { pl: "Cofanie dostępu…", en: "Revoking access…" },
  "share.revokeFailed": {
    pl: "Nie udało się cofnąć dostępu. Spróbuj ponownie.",
    en: "Couldn't revoke access. Try again.",
  },
  // Collection-only 409 (28-RESEARCH.md §A's "last-key-holder guard") --
  // item revoke never returns this. A DISTINCT, expected response the
  // caller must be told about specifically, never folded into
  // `share.revokeFailed`'s generic copy.
  "share.revokeLastKeyHolder": {
    pl: "Nie można cofnąć dostępu — to jedyna osoba, która ma klucz do tego folderu. Zawartość stałaby się nieczytelna na zawsze.",
    en: "Can't revoke access — this is the only person holding the key to this folder. Its contents would become permanently unreadable.",
  },
  "share.revokeAriaFolder": {
    pl: `Cofnij dostęp {email} do folderu „{folder}"`,
    en: `Revoke {email}'s access to "{folder}"`,
  },
  "share.revokeAriaItem": {
    pl: `Cofnij dostęp {email} do „{item}"`,
    en: `Revoke {email}'s access to "{item}"`,
  },
  "identity.yourFingerprintHeading": { pl: "Twój odcisk tożsamości", en: "Your identity fingerprint" },
  "identity.fingerprintRevealAria": {
    pl: "Pokaż odcisk tożsamości {email}",
    en: "Show {email}'s identity fingerprint",
  },
  "identity.fingerprintUnavailable": {
    pl: "Odcisk pojawi się po pierwszym odblokowaniu vaulta przez tę osobę po aktualizacji.",
    en: "The fingerprint will appear once this person unlocks their vault for the first time after upgrading.",
  },
  "identity.fingerprintCopyAria": { pl: "Skopiuj odcisk tożsamości", en: "Copy identity fingerprint" },
  // WR-09 (code review, Phase 26): deliberately a DIFFERENT string from
  // `identity.fingerprintUnavailable`. That one describes an expected,
  // benign ABSENCE (this member hasn't unlocked since the upgrade). A
  // fingerprint the server returned but that isn't a well-formed SHA-256
  // hex value is a SIGNAL, not an absence -- in a zero-knowledge product
  // the server is explicitly untrusted -- so it must not be dressed up in
  // the reassuring copy. Honesty constraint 3 (never word the benign state
  // as an error) is not violated by naming a genuinely anomalous state.
  "identity.fingerprintMalformed": {
    pl: "Ten odcisk ma nieprawidłowy format — nie ufaj mu, nie udostępniaj tej osobie niczego i zgłoś to.",
    en: "This fingerprint is malformed — don't trust it, don't share anything with this person, and report it.",
  },
  "folder.pickerLabel": { pl: "Folder", en: "Folder" },
  "folder.pickerNone": { pl: "Bez folderu", en: "No folder" },
  "folder.pickerCreateNew": { pl: "+ Nowy udostępniony folder", en: "+ New shared folder" },
  "folder.pickerEmpty": {
    pl: "Nie masz jeszcze udostępnionych folderów.",
    en: "You don't have any shared folders yet.",
  },
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return tEngine(DICTIONARY, locale, key);
}
