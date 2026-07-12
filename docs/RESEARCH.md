# Research — darmowy, self-hostable menedżer haseł z passkeys (lipiec 2026)

Skonsolidowane wyniki trzech researchy (NordPass vs Vaultwarden, krajobraz rynku, design datafa.st).

**Terminologia:**
- **Passkey provider** — produkt przechowuje poświadczenia WebAuthn i loguje użytkownika do **cudzych** stron/aplikacji (działa jako authenticator).
- **PRF vault unlock** — logowanie/odszyfrowanie **własnego** vaulta passkeyem, z użyciem rozszerzenia WebAuthn PRF (`hmac-secret`) do wyprowadzenia klucza.
- FIDO2 jako 2FA to trzecia, słabsza rzecz.

---

## 1. Feature set NordPass (cel do pokrycia)

**Premium:** multi-device sync, **przechowywanie passkeys**, Password Health (słabe/powtórzone/stare hasła), Data Breach Scanner (monitoring maili/kart vs bazy wycieków), **Email Masking** (aliasy), wbudowany TOTP Authenticator, secure sharing + zaszyfrowane linki do nie-użytkowników, Emergency Access, załączniki, biometria, klucze FIDO U2F jako MFA.

**Business/Enterprise:** activity log (+API), polityki firmowe, SSO (Entra/Okta/ADFS), SCIM provisioning, integracje Sentinel/Splunk, Vanta.

**Tech:** XChaCha20 + Argon2, zero-knowledge, audyty Cure53, SOC 2. Proprietary, brak self-hostingu.

## 2. Stan Vaultwarden (v1.36.0, ~maj 2026)

- Ma: vault, organizacje/kolekcje/grupy/polityki, event log, Sends, załączniki, emergency access, TOTP, 2FA (WebAuthn/Yubikey/Duo), **OIDC SSO od 1.35**, archiwizacja itemów (1.36).
- **Passkeys na cudzych stronach: DZIAŁAJĄ** — cała logika WebAuthn jest w kliencie Bitwardena (extension/mobile), serwer trzyma tylko zaszyfrowany blob `fido2Credentials`.
- **Logowanie passkeyem do vaulta (PRF): BRAK** — draft PR [#5929](https://github.com/dani-garcia/vaultwarden/pull/5929) niezmergowany (alternatywny #7297 zamknięty); przycisk w web vaulcie jest tylko ukryty CSS-em. Wymaga endpointów `/identity/accounts/webauthn/assertion-options` itd., upgrade webauthn-rs 0.5, migracji DB.
- Realne braki vs NordPass: PRF unlock, natywny email masking (jest tylko integracja SimpleLogin/Addy), ciągły serwerowy breach monitoring (jest tylko klienckie HIBP).

## 3. Co znaczy „być providerem passkeys"

| Platforma | Mechanizm |
|---|---|
| Przeglądarki (desktop) | **Brak oficjalnego API.** Content script wstrzykiwany do MAIN world **monkey-patchuje `navigator.credentials.create/get`** (tak robi Bitwarden i 1Password; 1P hardenuje shim jako non-configurable accessor). Most `window.postMessage` → background worker. Problemy: psuje conditional mediation, dwa menedżery biją się o patch. `chrome.webAuthenticationProxy` istnieje, ale jest single-occupant (remote desktop). Właściwe API — [w3c/webextensions#361](https://github.com/w3c/webextensions/issues/361) — wciąż otwarte (Safari opposed). |
| Android 14+ | `CredentialProviderService` przez **Credential Manager API** |
| iOS 17+/macOS | AutoFill extension: `ASCredentialProviderViewController`, entitlement `autofill-credential-provider`, `ProvidesPasskeys=YES` |
| Windows 11 | **Passkey plugin API — GA od listopada 2025** (MSIX, rejestracja w Settings > Passkeys, gated przez Windows Hello). 1Password i Bitwarden już shipują. |
| Import/eksport | **FIDO CXF** (format) — Proposed Standard od 08.2025; **CXP** (protokół) — wciąż draft, ale iOS 26 shipuje pierwszy transfer (Apple ↔ 1Password ↔ Bitwarden, on-device). Android/Windows — brak. Biblioteka OSS: crate [`credential-exchange-format`](https://crates.io/crates/credential-exchange-format) (Bitwarden, Rust, v0.4.0). |

## 4. Krajobraz rynku (tabela zbiorcza)

| Projekt | Passkey provider | PRF unlock | Self-host | Uwagi |
|---|---|---|---|---|
| **Bitwarden (oficjalny)** | TAK — ext + Android 14 + iOS 17, free tier | **TAK** — web + Chromium ext (login 11.2025, unlock 02.2026); na self-hoście prawdopodobnie działa, **niezweryfikowane** | Standard ~11 kontenerów MSSQL / **Lite** 1 kontener ~200 MB | Jedyny z kompletem. AGPL + Bitwarden License; klienty GPL-3.0 |
| **Vaultwarden** | TAK (klienty BW) | **NIE** (PR #5929 draft) | 1 lekki kontener Rust | Ulubieniec community |
| Psono | TAK — tylko ext + Android | NIE (WebAuthn=2FA) | Docker + PostgreSQL | Apache-2.0 CE / proprietary EE |
| Passbolt | NIE (backlog „H2 2026") | NIE — auth PGP, PRF strukturalnie N/A | Docker, MySQL only | Aktywny, Cure53 |
| Padloc | NIE | NIE | tak | **MARTWY** (ostatni release 03.2023) |
| KeePassXC | TAK (desktop ext, off by default) | NIE (hmac-secret unlock WIP) | plik KDBX | + KeePassDX (Android, TAK), Strongbox (iOS/macOS, TAK) — ekosystem poszatkowany na 4 aplikacje |
| Proton Pass | TAK — pełny | brak danych | **NIE — potwierdzone** | serwer proprietary |
| **AliasVault** ⭐ | **TAK — prawdziwy** (WebAuthn L2 soft authenticator; ext + iOS + Android; od v0.24.0, 11.2025) | Nie reklamowany | TAK — Docker, zero-knowledge, **wbudowany serwer aliasów mailowych** | Najmocniejszy nowy gracz: ~3k★, AGPL, C#+TS, release co 2–3 tyg. |
| Bramble (Show HN 07.2026) | TAK (ext+iOS+Android, własny authenticator) | NIE | local-first, sync P2P po self-hostowanym Nostr relay | młody (v0.6, ~218★) |
| AuthPass | NIE | NIE | KDBX | stale (02.2024) |

### Werdykt — luka rynkowa

**Żaden w pełni self-hostable projekt nie shipuje NARAZ passkey-provider na wszystkich platformach + PRF vault unlock.** Najbliżej jest oficjalny Bitwarden (ciężki Standard albo Lite; PRF na self-hoście do zweryfikowania ~30 min testu; PRF tylko Chromium). Vaultwarden czeka na PR. Psono/AliasVault — provider bez PRF. Reszta odpada.

**Precyzyjna luka do wypełnienia:** lekki, darmowy, self-hostable vault, który jest passkey providerem na wszystkich powierzchniach klienckich **i** traktuje PRF unlock jako first-class feature, z importem/eksportem CXF. Luka jest realna, ale wąska — istnieje o tyle, o ile Bitwarden self-hosted PRF okaże się ograniczony/za ciężki, a PR Vaultwarden pozostanie niezmergowany. **Wkład w Vaultwarden (dokończenie #5929) to wiarygodna alternatywa dla budowy od zera.**

## 5. Klocki do budowy (rekomendowane)

| Klocek | Wybór | Status |
|---|---|---|
| Server RP (WebAuthn) | [webauthn-rs](https://github.com/kanidm/webauthn-rs) | v0.5.2 (07.2025), SUSE-audited, napędza Kanidm |
| Software authenticator (klient) | [passkey-rs](https://github.com/1Password/passkey-rs) (1Password) | **PRF/hmac-secret potwierdzone w źródle** (`extensions/hmac_secret.rs`, `client/extensions/prf.rs`); v0.5.0 (01.2026); caveat: tylko ES256 |
| WebAuthn TS (web app) | SimpleWebAuthn / natywne API | aktywny; PRF tylko encode/decode |
| Prymitywy krypto | libsodium (Argon2id, XChaCha20-Poly1305, HKDF) | wzorzec multi-recipient jak w age/rage |
| Extension framework | **WXT** (Plasmo martwy od 05.2025) | MV3, dual-output, ~10.2k★ |
| CXF import/export | crate `credential-exchange-format` (Bitwarden) | v0.4.0 (06.2026) |

### Hierarchia kluczy Bitwardena (wzorzec)

`master password → PBKDF2 600k/Argon2id → Master Key → HKDF → Stretched MK → AES-wrap losowego 512-bit User Key (blob na serwerze) → User Key wrapuje per-item Cipher Keys`. Zmiana hasła = re-wrap tylko User Key.

### PRF unlock — wzorzec

1. PRF zwraca 32 bajty = `HMAC-SHA-256(credential_secret, salt)` — nigdy nie opuszcza klienta.
2. HKDF → 64 bajty (32 AES-256 + 32 MAC).
3. Bitwarden wstawia per-credential RSA keypair (ergonomia rotacji). **Prostszy poprawny design: `PRF → HKDF → wrapping key → bezpośredni wrap User Key`**, jeden blob na zarejestrowany passkey.
4. **Footgun:** usunięcie passkeya = utrata klucza → obowiązkowa ścieżka recovery (User Key wrapowany też pod kluczem z master password).
5. PRF jest Chromium-first; Windows Hello dostał hmac-secret dopiero w lutym 2026.

## 6. Licencje

- Klienty Bitwardena: **GPLv3** — legalnie można je wycelować w custom serwer (model Vaultwarden). Kontrowersja SDK z 10.2024 zakończona relicencją `sdk-internal` na GPLv3.
- Caveaty: fork musi zostać GPLv3 + wyciąć trademarki; Bitwarden zastrzegł sobie dual-build; fork = kompatybilnościowy kierat z API Bitwardena.

## 7. Design datafa.st — skrót (pełny doc: UI-DESIGN.md)

Stack zweryfikowany ze źródła: **Next.js 15 / React 19 / Tailwind v4 / DaisyUI 5**. Koralowy primary **#E16540** na ciepłych ciemnych szarościach (#262626/#212121/#1F1F1F), light theme z kremowym #FCFBFA. Fonty: **DM Sans** (całość UI) + **Fuzzy Bubbles** (odręczne adnotacje). Karty 16px, przyciski 8px, badge-pigułki, 1px bordery zamiast cieni. Emoji w copy, founder-voice.
