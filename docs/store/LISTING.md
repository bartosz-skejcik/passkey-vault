# Passkey Vault — Store Listing Copy (CWS + AMO)

_Prepared 2026-07-22. Source of truth for both marketplace forms._

## Identity

- **Name:** `Passkey Vault` (13 chars — CWS limit 75)
- **Version:** 0.4.0
- **Homepage:** https://github.com/bartosz-skejcik/passkey-vault
- **Hosted demo/default server:** https://vault.blonie.cloud
- **Privacy policy URL:** https://github.com/bartosz-skejcik/passkey-vault/blob/main/PRIVACY.md
- **Support URL:** https://github.com/bartosz-skejcik/passkey-vault/issues
- **License:** AGPL-3.0-only — LICENSE w repo root (decyzja Bartka 2026-07-22). ⚠ Dropdown AMO nie ma AGPL na predefiniowanej liście (MPL/GPL/LGPL/BSD/MIT/Apache) — wybierz „Custom License" i wklej nagłówek AGPL-3.0 + link do LICENSE. Dystrybucja FF: **AMO listed** (nie self-distributed).
- **Category:** CWS → Productivity / Tools · AMO → Privacy & Security

## Summary

**EN — CWS (≤132 chars, currently 129):**
> Self-hosted, zero-knowledge password manager & passkey provider. Autofill, TOTP and passkey login — your server, your keys.

**EN — AMO (≤250 chars):**
> Self-hosted, zero-knowledge password manager and passkey provider. Autofill logins, cards and TOTP codes, generate strong passwords, and use real passkeys on any site — synced to a server you control. Your server, your keys, your data.

**PL (dla `_locales/pl` / listing PL):**
> Self-hostowany menedżer haseł zero-knowledge i provider passkeys. Autofill, kody TOTP i logowanie passkeyem — twój serwer, twoje klucze.

## Detailed description (EN)

```
Passkey Vault is a free, open-source password manager that you host yourself —
one Docker container — with first-class passkey support that most self-hosted
vaults are still missing.

WHAT MAKES IT DIFFERENT

🔑 A real passkey provider — create and use passkeys on third-party sites
(GitHub, Google, and any WebAuthn site) straight from your vault, on both
Chrome and Firefox.

🔐 Passkey vault unlock (PRF) — unlock your encrypted vault with a passkey,
not just a master password.

🏠 Your server, your data — the extension connects to the Passkey Vault server
YOU configure. No vendor cloud, no accounts with us, no telemetry.

🕵️ Zero-knowledge — everything is encrypted on your device (Argon2id,
XChaCha20-Poly1305). The server only ever stores ciphertext.

EVERYDAY FEATURES

• Autofill for logins, credit cards and identities — with a second confirmation
  before sensitive fills
• Live TOTP codes with one-click fill
• Strong password generator (characters or passphrases) offered right on
  signup forms
• Save & update prompts after you log in on a new site — including protection
  against look-alike-domain phishing
• Multi-device sync via your own server (encrypted, revision-safe)
• Full vault management in the companion web app

OPEN SOURCE & SELF-HOSTED

The entire stack — extension, web app, and Rust server — is open source. Run
the server with a single Docker container and SQLite on a volume.

GitHub: https://github.com/bartosz-skejcik/passkey-vault
```

## Detailed description (PL)

```
Passkey Vault to darmowy, open-source'owy menedżer haseł, który hostujesz
u siebie — jeden kontener Docker — z pełnym wsparciem passkeys, którego wciąż
brakuje większości self-hostowanych sejfów.

CO GO WYRÓŻNIA

🔑 Prawdziwy provider passkeys — twórz i używaj passkeys na cudzych stronach
(GitHub, Google i każda strona z WebAuthn) prosto ze swojego sejfu, w Chrome
i Firefoksie.

🔐 Odblokowanie sejfu passkeyem (PRF) — nie tylko hasłem głównym.

🏠 Twój serwer, twoje dane — wtyczka łączy się z serwerem Passkey Vault, który
TY wskażesz. Zero chmury producenta, zero telemetrii.

🕵️ Zero-knowledge — wszystko szyfrowane na twoim urządzeniu (Argon2id,
XChaCha20-Poly1305). Serwer przechowuje wyłącznie szyfrogram.

NA CO DZIEŃ

• Autofill loginów, kart i tożsamości — z drugim potwierdzeniem przy danych
  wrażliwych
• Kody TOTP na żywo z wypełnianiem jednym kliknięciem
• Generator mocnych haseł (znaki lub passphrase) podpowiadany na formularzach
  rejestracji
• Propozycja zapisu/aktualizacji loginu po zalogowaniu — z ochroną przed
  phishingiem na podobnej domenie
• Synchronizacja wielu urządzeń przez twój własny serwer
• Pełne zarządzanie sejfem w towarzyszącej aplikacji web

OPEN SOURCE I SELF-HOSTING

Cały stack — wtyczka, aplikacja web i serwer w Ruście — jest open source.
Serwer stawiasz jednym kontenerem Docker (SQLite na wolumenie).

GitHub: https://github.com/bartosz-skejcik/passkey-vault
```

## CWS Privacy tab — ready-to-paste answers

**Single purpose (EN):**
> Passkey Vault is a password manager and passkey provider: it stores the user's credentials in an end-to-end-encrypted vault synced to a server the user configures, autofills logins/TOTP/cards/identities on websites, generates strong passwords, and creates/uses WebAuthn passkeys on third-party sites on the user's behalf.

**Permission justifications:**

| Permission | Justification (paste as-is) |
|---|---|
| `storage` | Stores the user-configured server URL and non-secret preferences in chrome.storage.local, and the unlocked vault key envelope exclusively in chrome.storage.session so it is wiped when the browser closes or the vault auto-locks. No plaintext credentials are ever written to persistent storage. |
| `alarms` | Runs the configurable auto-lock timer that clears the in-memory vault key after a period of inactivity. No other background scheduling. |
| `activeTab` / `tabs` | Reads the current tab's origin to show credentials matching the site the user is on, and opens the user's own web vault in a new tab. Page content is not read via this permission. |
| Content scripts on `<all_urls>` | The extension is a password manager and passkey provider: it must detect login/signup/card forms on any site the user visits to offer autofill, save-password prompts and password generation, and must expose the WebAuthn passkey-provider bridge (navigator.credentials) on any site that uses passkeys. The content scripts are key-free: all decryption happens in the background service worker after an explicit user gesture; the scripts read only form structure of the visited page and never collect, log or transmit page content. Sensitive fills (cards/identities) require a second explicit confirmation. |
| Optional host permissions (`http(s)://*/*`) | Requested at runtime only for the specific server URL the user configures as their self-hosted vault backend, so the background worker can call its REST/WebSocket API. |

**Remote code:** No. All executable code, including the WebAssembly crypto core
(compiled from Rust and shipped inside the package), is contained in the
extension bundle. The extension communicates with the user-configured server
exclusively via JSON over HTTPS carrying encrypted blobs and WebAuthn ceremony
data — never executable code.

**Data usage checkboxes:**
- ✅ **Authentication information** — YES (core purpose; credentials are end-to-end encrypted on-device before any transmission; the server never receives plaintext or keys)
- ✅ Personally identifiable information — YES, minimal: the e-mail address used as the account login on the user's own server
- ❌ Health, Financial*, Communications, Location, Web history, User activity, Website content — NO
  - *Card items typed by the user are stored end-to-end encrypted as vault content; nothing is read from pages or transmitted in plaintext. If the reviewer treats stored card items as "financial and payment information", tick it and reuse the authentication-information wording.
- ✅ All four Limited Use certifications apply (single purpose only, no ads, no human access, no unrelated transfer)

## AMO — extra fields

- **Tags:** password manager, passkeys (pick from the predefined list at submission)
- **"Notes to Reviewer":** see `docs/store/AMO-REVIEWER-NOTES.md` (build
  reproduction for WASM + bundler, test account, architecture pointers)
- **Source archive:** generate with `scripts/make-amo-source.sh` — REQUIRED
  (WXT/Vite bundling + Rust→WASM triggers the source-submission rule)
- **`data_collection_permissions`** (already in the manifest):
  `required: ["authenticationInfo"]` — native consent UI appears on Firefox 140+;
  older versions (115–139) rely on the listing disclosure
- **Privacy policy:** link to the GitHub PRIVACY.md (AMO no longer requires hosting on AMO)

## Assets checklist

| Asset | Spec | Status |
|---|---|---|
| Store icon 128×128 PNG | both stores | ✅ `docs/store/store-icon-128.png` (+512 dla AMO promo) |
| Manifest icons 16/32/48/96/128 | in package | ✅ generated from logo-master, in both builds |
| Screenshots 1280×800 PNG (CWS: 1–5, AMO: same size ok) | `docs/store/screenshots/final/` | ✅ generated |
| CWS small promo tile 440×280 | REQUIRED by CWS | ✅ `docs/store/promo-tile-440x280.png` |
| CWS marquee 1400×560 | optional | skip for launch |

## Submission gotchas (from research, both stores)

1. **CWS:** $5 one-time fee, 2FA on the Google account mandatory, expect the
   **in-depth manual review track** (broad host permissions + password manager)
   — budget 1–2 weeks; don't schedule launch on approval day.
2. **CWS trader/non-trader (EU DSA):** as a free OSS project you can declare
   non-trader; if you ever add a paid tier, your legal name/address becomes
   public — decide consciously.
3. **AMO:** free, but **source archive is mandatory** (bundler + WASM). The
   reviewer rebuilds and diffs — the archive must reproduce the exact bytes;
   include lockfiles + exact toolchain versions (rust-toolchain.toml pins
   1.97.0; build-wasm.sh pins wasm-bindgen).
4. **AMO:** obfuscation is banned (standard minification is fine — we're fine).
5. **AMO id** `passkey-vault@extension.local` is valid (uniqueness only).
6. Both stores: listing screenshots must show real UI without misleading
   overlays; minimal marketing text on images.
