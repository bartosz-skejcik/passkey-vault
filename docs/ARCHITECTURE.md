# Architektura — self-hostable menedżer haseł z first-class passkeys

Status: DRAFT do dyskusji. Bazuje na RESEARCH.md (lipiec 2026).

## 1. Cele

- Darmowy, open-source, **self-hostable jednym kontenerem Docker** (jak Vaultwarden, nie jak 11-kontenerowy Bitwarden Standard).
- **Passkey provider** na wszystkich powierzchniach klienckich (extension → Android → iOS → Windows plugin).
- **PRF vault unlock jako first-class feature** — odblokowanie vaulta passkeyem, nie bolt-on.
- Zero-knowledge: serwer nigdy nie widzi kluczy ani plaintextu.
- Import/eksport **FIDO CXF** od pierwszej wersji.
- UI w estetyce datafa.st (patrz UI-DESIGN.md).

### Non-goals (v1)

- Kompatybilność z API Bitwardena (świadoma decyzja — patrz Decyzja A).
- Funkcje enterprise (SSO/SCIM/polityki) — dopiero po v1.
- Własny serwer mailowy do email maskingu — v1 integruje SimpleLogin/Addy (self-host), wzorem AliasVault można rozważyć później.

## 2. Kluczowe decyzje

### Decyzja A: Greenfield vs Bitwarden-compatible vs wkład w Vaultwarden

| Opcja | Za | Przeciw |
|---|---|---|
| **A1. Greenfield (REKOMENDACJA)** — własny serwer + własne klienty | Pełna kontrola designu (bez tego nie ma „wyglądu datafa.st"), PRF-first od zera, prosty model danych, brak kieratu kompatybilności z API BW | Największy nakład — extension i mobile trzeba napisać samemu |
| A2. Bitwarden-compatible serwer (model Vaultwarden) + PRF endpoints | Darmowe klienty BW (GPL), passkey provider i PRF unlock już w klientach | UI = web vault Bitwardena (restyling GPL-owego molocha ≠ datafa.st), kierat API, trademarki |
| A3. Wkład w Vaultwarden (dokończyć PR #5929) | Najtańsze dla ekosystemu | To nie jest „nasz produkt" — brak własnego UI, brak nauki/brandu |

Rekomendacja: **A1**, z pragmatyczną kolejnością platform. Jeśli cel byłby czysto utylitarny („mieć PRF w self-hoście"), A3 jest uczciwie najtańsze — ale wymaganie „design jak datafa.st" przesądza o A1.

### Decyzja B: język serwera

**Rust** (axum + SQLx) — webauthn-rs i passkey-rs oraz crate `credential-exchange-format` są w Rust; jeden język dla serwera i core krypto współdzielonego z extension przez **WASM**. Alternatywa TS (Fastify + SimpleWebAuthn) jest szybsza w bootstrapie, ale traci współdzielenie core'u z klientami i dojrzałe klocki PRF.

### Decyzja C: baza danych

**SQLite domyślnie** (single-container, backup = plik) z opcją **PostgreSQL** (SQLx wspiera oba). Wzór: Vaultwarden.

## 3. Komponenty systemu

```
┌────────────────────────────────────────────────────────┐
│ Docker container                                       │
│  ┌──────────────┐   ┌───────────────────────────────┐  │
│  │ Rust server  │   │ Web app (Next.js static/SSR)  │  │
│  │ axum + SQLx  │   │ Tailwind v4 + DaisyUI 5       │  │
│  │ webauthn-rs  │   │ crypto: WASM core             │  │
│  └──────┬───────┘   └───────────────────────────────┘  │
│         │ SQLite / Postgres                            │
└─────────┼──────────────────────────────────────────────┘
          │ REST/JSON + WebSocket (sync push)
 ┌────────┴─────────┬──────────────────┬────────────────┐
 │ Extension (WXT)  │ Android (Kotlin) │ iOS (Swift)    │
 │ MAIN-world patch │ CredentialProv-  │ ASCredential-  │
 │ navigator.creds  │ iderService      │ ProviderVC     │
 │ passkey-rs→WASM  │                  │                │
 └──────────────────┴──────────────────┴────────────────┘
```

- **Serwer (Rust)**: auth (SRP-podobny lub OPAQUE — do decyzji; minimum: hasło nigdy nie leci na serwer, tylko hash po KDF), przechowywanie zaszyfrowanych blobów, endpoints PRF (WebAuthn RP przez webauthn-rs), sync (revision-based + WS push), breach monitor (cron: HIBP k-anonymity dla haseł, HIBP domain search dla maili), załączniki (dysk/S3), zaszyfrowane linki sharingowe.
- **Web app**: Next.js; cała kryptografia klientowa w **współdzielonym Rust core skompilowanym do WASM** (ten sam kod w extension) — jedna implementacja hierarchii kluczy.
- **Extension (WXT, MV3)**: popup + autofill + **passkey provider** przez wstrzyknięcie do MAIN world i patch `navigator.credentials.create/get` z fall-through do natywnych; authenticator = passkey-rs (WASM) z emulacją hmac-secret/PRF. Uwaga na współistnienie z innymi menedżerami (znany konflikt patchy).
- **Mobile**: v2 — Android `CredentialProviderService`, iOS `ASCredentialProviderViewController` (+`ProvidesPasskeys`). Core krypto reużyty przez UniFFI z tego samego Rust crate'a.

## 4. Kryptografia

Prymitywy: **libsodium-style** — Argon2id (KDF), XChaCha20-Poly1305 (AEAD), HKDF-SHA256, ES256 (podpisy passkey; ograniczenie passkey-rs).

### Hierarchia kluczy (uproszczony model Bitwardena + multi-recipient jak age)

```
                    losowy 256-bit User Key (UK)
                              │ wrapowany równolegle do N "recipientów":
   ┌──────────────────────────┼──────────────────────────────┐
   │                          │                              │
master password          passkey #1                     passkey #2
→ Argon2id → MK       → PRF(salt) 32B                 → PRF(salt) 32B
→ HKDF → wrap UK      → HKDF → wrap UK                → HKDF → wrap UK
 (blob_pw)              (blob_pk1)                      (blob_pk2)

UK → wrapuje per-item Cipher Keys → itemy (XChaCha20-Poly1305)
```

- **Prostszy niż Bitwarden**: bez warstwy RSA — `PRF → HKDF → wrapping key → bezpośredni wrap UK`, jeden blob na enrolled passkey. Warstwa RSA u BW służy ergonomii rotacji; przy naszej skali re-wrap N blobów przy rotacji UK jest akceptowalny.
- **Recovery obowiązkowe**: UK zawsze wrapowany także pod master password (i opcjonalnie pod wydrukowanym recovery code). Usunięcie passkeya nigdy nie może być jedyną kopią klucza — UI musi to wymuszać.
- Zmiana master password = re-wrap tylko blob_pw.
- PRF Chromium-first; fallback: unlock hasłem wszędzie tam, gdzie PRF niedostępny.

### Przepływ PRF unlock

1. Klient: `navigator.credentials.get` z rozszerzeniem `prf` i solą per-user (z serwera, publiczna).
2. Wynik PRF (32B) → HKDF → klucz odszyfrowujący blob_pkN → **User Key** → vault odszyfrowany lokalnie.
3. Równolegle assertion uwierzytelnia sesję na serwerze (webauthn-rs weryfikuje podpis) → token sesji.
4. Serwer nigdy nie widzi wyniku PRF (zostaje w kliencie).

## 5. Model danych (szkic)

- `users` (id, email, kdf_params, pw_wrapped_uk, created_at)
- `webauthn_credentials` (id, user_id, credential_id, public_key, prf_salt, prf_wrapped_uk, sign_count, transports, name, last_used)
- `vault_items` (id, user_id, folder_id, type[login|passkey|card|note|totp], enc_data blob, enc_key blob, revision, deleted_at) — pola przeszukiwalne (domena do autofill) w enc_data; indeks po stronie klienta
- `folders`, `attachments` (enc, dysk/S3), `shares` (enc_link_key, expiry, max_views), `breach_watches` (email_hash, last_checked, findings), `sessions`, `event_log`

## 6. API (szkic v1)

- `POST /auth/prelogin` → kdf_params
- `POST /auth/login` (hash po KDF) / `POST /auth/webauthn/{options,verify}` (PRF login)
- `GET/PUT /sync` (revision-based delta), WS `/sync/stream`
- CRUD `/items`, `/folders`, `/attachments`
- `POST /shares` → link `https://host/s/{id}#fragment-z-kluczem` (klucz w URL fragment, nie dociera do serwera)
- `GET /health/report` (agregaty liczone klientowo, opcjonalny cache), `POST /breach/check`
- `POST /export/cxf`, `POST /import/cxf` (przetwarzanie klientowe; serwer tylko przyjmuje bloby)

## 7. Roadmapa

| Faza | Zakres |
|---|---|
| **v0.1 (MVP)** | Serwer (SQLite) + web app: vault CRUD, unlock hasłem, **PRF unlock**, import z Bitwardena/CSV, TOTP |
| **v0.2** | Extension (WXT): autofill + **passkey provider** (MAIN-world patch, passkey-rs), popup UI |
| **v0.3** | Sharing (linki), Password Health dashboard, breach monitor (HIBP), załączniki |
| **v0.4** | **CXF import/export**, integracja SimpleLogin/Addy (email masking) |
| **v1.0** | Hardening + audyt zależności, docs self-host, migracje |
| **v2** | Android provider, iOS provider, potem Windows plugin (MSIX) |

## 8. Ryzyka

1. **Bitwarden/Vaultwarden mogą domknąć lukę** (PR #5929 lub udokumentowany self-hosted PRF) — nasza przewaga zostaje wtedy w wadze i UI, nie w capability. Monitorować.
2. Patch `navigator.credentials` to wieczny wyścig z przeglądarkami i innymi menedżerami; brak oficjalnego API (w3c/webextensions#361 utknięte).
3. Apple: passkey provider entitlement wymaga płatnego konta dev i review — iOS jest najdroższą platformą.
4. Krypto własnej roboty = odpowiedzialność; trzymać się libsodium + wzorców BW, docelowo audyt zewnętrzny.
5. passkey-rs: tylko ES256 — wystarcza w praktyce (RP-y wymagają ES256), ale odnotować.

## 9. Otwarte pytania do rozstrzygnięcia

1. Nazwa projektu / licencja (AGPL-3.0 jak Vaultwarden vs Apache-2.0 „permissive"?).
2. OPAQUE vs klasyczny hash-po-KDF do logowania hasłem.
3. Multi-user/organizacje w v1 czy tylko konta osobiste + rodzina?
4. Hosting załączników: dysk kontenera vs S3-compatible od razu.
