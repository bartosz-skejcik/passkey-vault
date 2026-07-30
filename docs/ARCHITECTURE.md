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
     │
     └─ UK → wrapuje X25519 identity secret key (aead_seal, INFO_X25519_SK_WRAP)
              │
              └─ identity public key → sealuje per-recipient Collection Keys
                       │
                       └─ Collection Key → klucze itemów scope'owanych do kolekcji
```

- **Prostszy niż Bitwarden**: bez warstwy RSA — `PRF → HKDF → wrapping key → bezpośredni wrap UK`, jeden blob na enrolled passkey. Warstwa RSA u BW służy ergonomii rotacji; przy naszej skali re-wrap N blobów przy rotacji UK jest akceptowalny.
- **Recovery obowiązkowe**: UK zawsze wrapowany także pod master password (i opcjonalnie pod wydrukowanym recovery code). Usunięcie passkeya nigdy nie może być jedyną kopią klucza — UI musi to wymuszać.
- Zmiana master password = re-wrap tylko blob_pw.
- PRF Chromium-first; fallback: unlock hasłem wszędzie tam, gdzie PRF niedostępny.

### Decyzja D: sealed-box dla Collection Key (KEY-05)

Sharing (v0.4) wymaga warstwy asymetrycznej: każde konto dostaje parę kluczy X25519, a Collection Key (klucz kolekcji/foldera współdzielonego) jest sealowany per-recipient do publicznej połówki tej pary — dokładnie ten sam kształt fan-out co dzisiejsze multi-recipient wrapowanie UK (hasło + N passkeyów), tylko z asymetrycznym recipientem zamiast symetrycznego.

**Wybór: crate `crypto_box`, dokładnie przypięty `=0.9.1`, `default-features = false`, `features = ["chacha20", "alloc", "rand_core"]`.** `crypto_box` jest jedynym stabilnym, audytowanym przez Cure53 (finansowanie Threema, konstrukcja niezmieniona od 0.7.1 do 0.9.1) crate'em public-key-encryption w organizacji RustCrypto, który już współdzieli graf zależności `chacha20poly1305`/`rand_core`/`aead` tego projektu. Jego feature `chacha20` daje AEAD **XChaCha20-Poly1305 — dokładnie ten cipher, którego `keys::aead_seal` już używa**. Twierdzenie "zero nowych linii rand_core/getrandom" zostało niezależnie zweryfikowane (nie tylko przyjęte z research milestone'u) przez realne `cargo tree -p pv-core -i rand_core` / `-i getrandom` oraz `cargo tree --duplicates`, zarówno na targecie natywnym, jak i `wasm32-unknown-unknown` — w obu przypadkach wynik to pojedyncza wersja (`rand_core v0.6.4`, `getrandom v0.2.17`), zero duplikatów, a realny build `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` przechodzi czysto z `crypto_box` obecnym.

**Odrzucone alternatywy:**
- `hpke` 0.14.0 — wymusza podbicie już przypiętych `hkdf =0.12.4` (→ `^0.13`) i `chacha20poly1305 =0.10.1` (→ `^0.11.0`); crate i jego KEM `x25519-dalek 3.0.0` miały ~3 tygodnie w momencie researchu; brak niezależnego audytu.
- `rsa` 0.9.10 — otwarty, niepatchowany advisory `RUSTSEC-2023-0071` (atak Marvina), który `deny.toml` dziś trzyma uśpiony; bezpośrednia zależność skompilowałaby realnie tę podatną ścieżkę. To też dokładnie wzorzec warstwy RSA Bitwardena, który ten projekt już odrzucił.
- Ręcznie składany X25519-ECDH przez `x25519-dalek` bezpośrednio — `x25519-dalek 3.0.0` ciągnie major `rand_core ^0.10`, łamiąc wyrównanie grafu zależności, które zachowuje `crypto_box`; ręczne składanie KEM-a to dokładnie to, co recenzent bezpieczeństwa oflaguje jako rolled crypto. `crypto_box` *jest* tą kompozycją, już audytowaną.
- **Wbudowany `seal()`/`unseal()` crypto_boxa (opcjonalny feature `seal`) — znaleziony i świadomie odrzucony, nie pominięty.** Hardkoduje `SalsaBox` (XSalsa20Poly1305) zamiast `ChaChaBox`, łamiąc własne uzasadnienie spójności cipherów, dla którego wybrano `crypto_box` w pierwszej kolejności. Zamiast tego pv-core ma własny, minimalny, mocno skomentowany wrapper: świeży efemeryczny `SecretKey` per seal, `ChaChaBox::new(&recipient_pk, &ephemeral_sk)`, losowy 24-bajtowy nonce, `{ephemeral_pk, nonce, ciphertext}` w bloku `SealedKey`; efemeryczny sekret jest lokalną zmienną jednego wywołania, nigdy nie przechowywany ani reużywany — jego surowa kopia `bytes` NIE jest zeroizowana (patrz ograniczenie 2 poniżej).

**Dwa znane ograniczenia — zapisane wprost, nie obejście po cichu:**
1. **Brak AAD na warstwie seal.** Wywołania `encrypt`/`decrypt` `ChaChaBox` odrzucają dowolne niepuste associated data (potwierdzone komentarzem w źródle i realnym failing callem w runtime) — nie da się związać sealowanego bloku Collection Key z `(collection_id, recipient_user_id)` na tej warstwie. Scope-binding (KEY-03) jest zamiast tego wymuszany warstwę niżej, na poziomie item-AEAD (`items.rs`): AAD itemu koduje `collection_id`, więc podmieniony/pomieszany `SealedKey` albo nie odszyfruje się w ogóle, albo w skrajnym przypadku wyprodukuje 32 bajty śmieci, które i tak nie odszyfrują żadnego realnego itemu w złej kolekcji.
2. **`crypto_box::SecretKey` nie implementuje `zeroize::Zeroize`.** Jego własny, ręcznie napisany `Drop` zeroizuje wyłącznie wewnętrzne pole `scalar` (to, które faktycznie bierze udział w mnożeniu skalarnym X25519) — nigdy surowej tablicy `bytes: [u8; 32]`, a typ nie implementuje traitu `Zeroize` wcale. Dlatego opakowanie klucza tożsamości w pv-core (`IdentitySecretKey`) przechowuje własną tablicę bajtów z własnym `Zeroize`/`ZeroizeOnDrop`, zamiast trzymać długożyciowy `crypto_box::SecretKey` jako pole — `crypto_box::SecretKey` jest rekonstruowany tylko przejściowo, na czas pojedynczego seal/unseal. Ten przejściowy egzemplarz wciąż nie gwarantuje zeroizacji swojej surowej kopii `bytes` przy drop — to mała, uczciwie udokumentowana resztkowa ekspozycja skądinąd audytowanego crate'a, nie fabrykowana ani przemilczana.

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
