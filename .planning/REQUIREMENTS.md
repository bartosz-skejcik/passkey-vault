# Requirements — Passkey Vault v0.1 (MVP: serwer + web app)

Milestone: **v0.1** — self-hostable serwer (1 kontener) + web app z vault CRUD, unlockiem hasłem i passkeyem (PRF), importem/eksportem, TOTP.

## v1 Requirements

### Auth & Konta

- [x] **AUTH-01**: Użytkownik może założyć konto (email + master password); hasło nigdy nie opuszcza klienta — serwer dostaje tylko hash-po-KDF (Argon2id)
- [x] **AUTH-02**: Użytkownik może zalogować się master passwordem i otrzymać token sesji; odblokowanie vaulta (odszyfrowanie lokalne) jest architektonicznie odrębne od logowania (uwierzytelnienia na serwerze)
- [ ] **AUTH-03**: Użytkownik może enrollować passkey z rozszerzeniem PRF (dwuceremonialny enrollment: `create` rejestruje credential, `get` ewaluuje PRF i wrapuje User Key)
- [ ] **AUTH-04**: Użytkownik może zalogować się i odblokować vault jednym gestem passkeya: assertion → sesja na serwerze, wynik PRF → lokalny unwrap User Key (PRF nigdy nie opuszcza klienta)
- [ ] **AUTH-05**: System wymusza inwariant recovery: User Key zawsze wrapowany pod master password; nie istnieje tryb konta passkey-only; serwer i klient blokują operacje, które zostawiłyby vault bez fallbacku hasłowego
- [ ] **AUTH-06**: Użytkownik może zarządzać enrollowanymi passkeys (lista z nazwą/datą/ostatnim użyciem, zmiana nazwy, usunięcie z wyraźnym ostrzeżeniem recovery)
- [ ] **AUTH-07**: Użytkownik może zobaczyć aktywne sesje/urządzenia i unieważnić wybrane
- [ ] **AUTH-08**: Vault auto-blokuje się po konfigurowalnym czasie bezczynności (sensowny, nie-nieskończony default, np. 15 min)
- [ ] **AUTH-09**: Gdy PRF jest niedostępny (przeglądarka/OS/authenticator bez wsparcia), użytkownik dostaje czytelny fallback do unlocku hasłem — nie generyczny błąd

### Vault

- [x] **VAULT-01**: Użytkownik może tworzyć/edytować/usuwać itemy typów: login (z pod-rekordem passkey), karta, tożsamość, bezpieczna notatka, TOTP — całość szyfrowana klientowo (pv-core→WASM), serwer widzi tylko bloby
- [x] **VAULT-02**: Szyfrowanie itemów wiąże ciphertext z tożsamością (AEAD associated data: item ID + rewizja + kontekst) — ochrona przed podmianą/przestawieniem blobów przez złośliwy serwer
- [x] **VAULT-03**: Użytkownik może organizować itemy w foldery i tagi
- [ ] **VAULT-04**: Użytkownik może natychmiastowo przeszukiwać vault po stronie klienta (nazwa, username, domena)
- [ ] **VAULT-05**: Użytkownik może wygenerować silne hasło (długość-first, default 16+, tryb passphrase obok znakowego)
- [ ] **VAULT-06**: Użytkownik może skopiować pole do schowka; schowek czyści się automatycznie po 30–60 s (default ON, konfigurowalny)
- [ ] **VAULT-07**: Użytkownik widzi kody TOTP generowane z sekretu itemu (totp-rs w pv-core/WASM), z odliczaniem ważności

### Sync

- [ ] **SYNC-01**: Klient synchronizuje vault przez revision-gated full-snapshot pull (`GET /sync` z tanim revision-checkiem — bez delty/CRDT)
- [ ] **SYNC-02**: Serwer pushuje przez WebSocket wyłącznie metadane zmian `{item_id, revision, change_type}` (nigdy ciphertext); klient reaguje normalnym pullem
- [ ] **SYNC-03**: Użytkownik może korzystać z vaulta na wielu urządzeniach jednocześnie; konflikty rozstrzygane per-item po rewizji

### Import / Eksport

- [ ] **IMPEX-01**: Użytkownik może zaimportować vault z Bitwardena (JSON i CSV) — przetwarzanie w całości klientowe
- [ ] **IMPEX-02**: Użytkownik może zaimportować dane z NordPass, 1Password, LastPass i KeePass (ich formaty eksportu CSV) — mappery kolumn per narzędzie
- [ ] **IMPEX-03**: Użytkownik może zaimportować generyczny CSV/JSON z ręcznym mapowaniem kolumn
- [ ] **IMPEX-04**: Użytkownik może wyeksportować cały vault do generycznego JSON i CSV (odszyfrowanie klientowe, z ostrzeżeniem o plaintext)

### Web App / UI

- [x] **UI-01**: Web app (Next.js 16, `output: "export"`, Tailwind v4 + DaisyUI 5) w theme datafa.st — dark default, pełnoprawny light; cała kryptografia wyłącznie przez choke-point moduł importujący pv-core WASM
- [ ] **UI-02**: Ekran unlock/login: PRF-first — duży tealowy przycisk „Odblokuj passkeyem" nad polem master password
- [ ] **UI-03**: Vault: lista itemów (favicon, nazwa, username, badge typu) + panel boczny szczegółów z copy-buttonami i sekcją passkey
- [ ] **UI-04**: Onboarding (3 kroki) z importem z innego menedżera jako pierwszym krokiem
- [ ] **UI-05**: Ustawienia: enrolled passkeys, sesje/urządzenia, import/eksport, parametry auto-lock/schowka

### Deploy / Self-host

- [ ] **DEPLOY-01**: Całość działa w jednym kontenerze Docker: binarka axum serwuje API + WS + statyczny export Next.js (ServeDir); SQLite (WAL + busy_timeout) na wolumenie; migracje na starcie
- [ ] **DEPLOY-02**: Serwer wymaga jawnego `RP_ID`/`PUBLIC_URL` i failuje głośno na starcie przy błędnej konfiguracji (WebAuthn za reverse proxy — czołowa pułapka self-hosterów)

## v2 Requirements (deferred — kolejne milestone'y wg roadmapy docs/)

### v0.2 — Extension

- **EXT-01**: Extension WXT (MV3, Chrome + Firefox): popup w estetyce vaulta
- **EXT-02**: Passkey provider — logowanie zapisanym passkeyem na cudzych stronach (`credentials.get`, MAIN-world patch z fall-through do natywnych)
- **EXT-03**: Passkey provider — rejestracja NOWEGO passkeya na cudzej stronie (`credentials.create`, np. GitHub → dodaj passkey → zapis do vaulta)
- **EXT-04**: Autofill loginów/haseł dopasowanych do bieżącej domeny

### v0.3 — Sharing & Health

- **SHARE-01**: Zaszyfrowane linki sharingowe (klucz w URL fragment, expiry, max views)
- **SHARE-02**: Współdzielenie rodzinne w ramach instancji (flat shared-vault membership, bez org/ról)
- **HEALTH-01**: Password Health dashboard (hero-score, słabe/powtórzone/stare)
- **HEALTH-02**: Breach monitor serwerowy (HIBP k-anonymity, cron)
- **ATTACH-01**: Załączniki za trait-em storage (implementacja dyskowa)

### v0.4+

- **CXF-01**: Import/eksport FIDO CXF (crate credential-exchange-format)
- **MASK-01**: Integracja email masking (SimpleLogin/Addy)
- **HARD-01**: Drukowany recovery code (dodatkowy wrap User Key) — hardening przed v1.0
- **HARD-02**: Rozważenie OPAQUE zamiast hash-po-KDF — hardening przed v1.0
- Historia haseł per item; audyt zewnętrzny krypto przed v1.0

## Out of Scope

| Wykluczenie | Powód |
|---|---|
| Kompatybilność z API Bitwardena | Decyzja A1 (greenfield) — kierat kompatybilności zabija design i prostotę |
| Enterprise: SSO/SCIM/polityki/organizacje z rolami | Złe audytorium — łamie pozycję "1 kontener, indie"; rodzina ≠ organizacja |
| OPAQUE w v0.1 | Młode biblioteki; hash-po-KDF to sprawdzony wzorzec BW; rewizja przed v1.0 |
| S3 jako wymóg załączników | Nikt nie musi mieć dodatkowej infry; trait storage + dysk wystarczy |
| Własny serwer mailowy (masking) | v1 integruje SimpleLogin/Addy; wzorem AliasVault ewentualnie później |
| Mobile providery (Android/iOS), Windows MSIX plugin | v2 — najdroższe platformy, po udowodnieniu web+extension |
| Auto-submit autofill domyślnie | Znany wektor phishing/UX-footgun |
| SSR/API routes w Next.js | Zero-knowledge: warstwa Node nigdy nie może widzieć plaintextu; wyłącznie static export |
| Warstwa RSA w hierarchii kluczy | Prostszy model multi-recipient wrap; re-wrap N blobów przy rotacji akceptowalny |

## Traceability

<!-- Wypełnia roadmapper: REQ-ID → faza -->

| REQ-ID | Faza | Status |
|--------|------|--------|
| UI-01 | Phase 1: WASM Crypto Bridge & Web App Shell | Complete |
| AUTH-01 | Phase 2: Password Auth & Vault Core | Complete |
| AUTH-02 | Phase 2: Password Auth & Vault Core | Complete |
| AUTH-08 | Phase 2: Password Auth & Vault Core | Pending |
| VAULT-01 | Phase 2: Password Auth & Vault Core | Complete |
| VAULT-02 | Phase 2: Password Auth & Vault Core | Complete |
| VAULT-03 | Phase 2: Password Auth & Vault Core | Complete |
| VAULT-04 | Phase 2: Password Auth & Vault Core | Pending |
| VAULT-05 | Phase 2: Password Auth & Vault Core | Pending |
| VAULT-06 | Phase 2: Password Auth & Vault Core | Pending |
| UI-03 | Phase 2: Password Auth & Vault Core | Pending |
| AUTH-03 | Phase 3: Passkey Enrollment & Account Security | Pending |
| AUTH-05 | Phase 3: Passkey Enrollment & Account Security | Pending |
| AUTH-06 | Phase 3: Passkey Enrollment & Account Security | Pending |
| AUTH-07 | Phase 3: Passkey Enrollment & Account Security | Pending |
| UI-05 | Phase 3: Passkey Enrollment & Account Security | Pending |
| AUTH-04 | Phase 4: PRF Unlock & Login Unification | Pending |
| AUTH-09 | Phase 4: PRF Unlock & Login Unification | Pending |
| UI-02 | Phase 4: PRF Unlock & Login Unification | Pending |
| SYNC-01 | Phase 5: Multi-Device Sync | Pending |
| SYNC-02 | Phase 5: Multi-Device Sync | Pending |
| SYNC-03 | Phase 5: Multi-Device Sync | Pending |
| VAULT-07 | Phase 6: Import/Export, TOTP & Onboarding | Pending |
| IMPEX-01 | Phase 6: Import/Export, TOTP & Onboarding | Pending |
| IMPEX-02 | Phase 6: Import/Export, TOTP & Onboarding | Pending |
| IMPEX-03 | Phase 6: Import/Export, TOTP & Onboarding | Pending |
| IMPEX-04 | Phase 6: Import/Export, TOTP & Onboarding | Pending |
| UI-04 | Phase 6: Import/Export, TOTP & Onboarding | Pending |
| DEPLOY-01 | Phase 7: Self-Host Packaging & Deployment | Pending |
| DEPLOY-02 | Phase 7: Self-Host Packaging & Deployment | Pending |
