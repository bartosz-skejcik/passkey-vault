# Passkey Vault (nazwa robocza)

## What This Is

Darmowy, open-source, **self-hostable jednym kontenerem Docker** menedżer haseł, który jest **passkey providerem** na wszystkich powierzchniach klienckich (extension Chrome+Firefox → Android → iOS → Windows) i traktuje **PRF vault unlock** (odblokowanie vaulta passkeyem) jako first-class feature — nie bolt-on. Zero-knowledge: serwer nigdy nie widzi kluczy ani plaintextu. UI w ciepłej, indie-makerowej estetyce datafa.st — przeciwieństwo enterprise'owego chłodu 1Password i sterylności Bitwardena.

Dla self-hosterów (społeczność Vaultwarden/homelab), którzy chcą passkeys + PRF unlock bez ciężkiego oficjalnego Bitwardena i bez czekania na niezmergowany PR Vaultwarden #5929.

## Core Value

**Lekki self-hostable vault (1 kontener + wtyczka Chrome/Firefox), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.** Jeśli wszystko inne zawiedzie, to musi działać.

## Requirements

### Validated

<!-- Istniejący kod — fundament krypto i szkielet serwera (zmapowany w .planning/codebase/). -->

- ✓ Hierarchia kluczy pv-core: losowy User Key wrapowany multi-recipient (hasło + N passkeys), Argon2id + HKDF, XChaCha20-Poly1305 — existing
- ✓ Ścieżka PRF → HKDF → wrapping key → unwrap User Key (`pv-core/src/prf.rs`) — existing
- ✓ Per-item encryption z osobnym Cipher Key per item (`pv-core/src/items.rs`) — existing
- ✓ Zeroize/ZeroizeOnDrop na wszystkich materiałach kluczowych — existing
- ✓ Szkielet serwera axum + SQLx/SQLite, migracja 0001, endpoint prelogin (KDF params + salt) — existing
- ✓ pv-core kompilowalny do WASM (bez I/O) — współdzielenie krypto z klientami — existing

### Active

<!-- v0.1 (MVP): serwer + web app -->

- [ ] Vault CRUD (itemy: login, passkey, karta, notatka, TOTP) przez REST API na zaszyfrowanych blobach
- [ ] Rejestracja + logowanie hasłem (hash-po-KDF, hasło nigdy nie leci na serwer)
- [ ] **PRF unlock**: enrollment passkeya z rozszerzeniem PRF + odblokowanie vaulta passkeyem (webauthn-rs po stronie RP)
- [ ] Recovery obowiązkowe: User Key zawsze wrapowany też pod master password — UI wymusza, żeby passkey nigdy nie był jedyną kopią klucza
- [ ] Web app (Next.js 15 + Tailwind v4 + DaisyUI 5, theme datafa.st) z krypto w pv-core→WASM
- [ ] Sync revision-based (GET/PUT /sync) + WebSocket push
- [ ] Import z Bitwardena (JSON) i CSV — przetwarzanie klientowe
- [ ] Wbudowany TOTP (generowanie kodów w vaulcie)
- [ ] Deploy jednym kontenerem Docker (serwer + statyczny web app, SQLite na wolumenie)

<!-- Po v0.1, w ramach v1: -->

- [ ] Extension (WXT, MV3, Chrome + Firefox): popup, autofill, **passkey provider** (MAIN-world patch navigator.credentials, passkey-rs→WASM, fall-through do natywnych) — obejmuje OBA przepływy: **rejestrację nowego passkeya na cudzej stronie** (`credentials.create` — np. GitHub → Settings → dodaj passkey → zapisuje się do naszego vaulta) i **logowanie zapisanym passkeyem** (`credentials.get`)
- [ ] Sharing: zaszyfrowane linki (klucz w URL fragment) + współdzielenie rodzinne w ramach instancji
- [ ] Password Health dashboard (hero-score, słabe/powtórzone/stare) + breach monitor (HIBP k-anonymity)
- [ ] Załączniki za trait-em storage (implementacja dyskowa w v1)
- [ ] Import/eksport **FIDO CXF** (crate `credential-exchange-format`)
- [ ] Integracja email masking: SimpleLogin/Addy (self-host)

### Out of Scope

- Kompatybilność z API Bitwardena — świadoma decyzja A1 (greenfield); kierat kompatybilności zabiłby design i prostotę modelu danych
- Funkcje enterprise (SSO/SCIM/polityki firmowe) — dopiero po v1
- Własny serwer mailowy do email maskingu — v1 integruje SimpleLogin/Addy; wzorem AliasVault rozważyć później
- Pełne organizacje (kolekcje, grupy, role jak Vaultwarden) — v1 to konta osobiste + rodzina; organizacje odsuwałyby MVP
- OPAQUE do logowania hasłem — v0.1 na hash-po-KDF (wzór BW); migracja do OPAQUE jako hardening przed v1.0
- Backend S3 dla załączników — trait storage od początku, ale w v1 tylko dysk (pozycja "1 kontener" bez wymaganej dodatkowej infry)
- Mobile providery (Android CredentialProviderService, iOS ASCredentialProvider) i Windows plugin (MSIX) — v2
- RSA layer w hierarchii kluczy (jak u Bitwardena) — przy naszej skali re-wrap N blobów przy rotacji UK jest akceptowalny

## Context

- **Pełny research i architektura w `docs/`**: RESEARCH.md (krajobraz rynku, lipiec 2026), ARCHITECTURE.md (decyzje, komponenty, krypto, model danych, API, roadmapa v0.1→v2), UI-DESIGN.md (tokeny datafa.st, ekrany, theme DaisyUI).
- **Luka rynkowa** (RESEARCH.md §4): żaden w pełni self-hostable projekt nie shipuje naraz passkey-provider na wszystkich platformach + PRF vault unlock. Najbliżej Bitwarden oficjalny (ciężki) i Vaultwarden (PR #5929 draft, niezmergowany). Luka wąska — monitorować, czy się nie domknie.
- **Fundament już istnieje**: workspace Rust z `pv-core` (krypto, WASM-ready) i `pv-server` (axum, szkielet) — zmapowany w `.planning/codebase/`.
- **Klocki**: webauthn-rs 0.5 (RP), passkey-rs (soft authenticator z PRF, tylko ES256 — wystarcza), WXT (extension), crate `credential-exchange-format` (CXF), SQLx (SQLite domyślnie, opcja Postgres).
- **Znane ryzyka** (ARCHITECTURE.md §8): Bitwarden/Vaultwarden mogą domknąć lukę; patch `navigator.credentials` to wyścig z przeglądarkami i innymi menedżerami (w3c/webextensions#361 utknięte); PRF jest Chromium-first (fallback: hasło); krypto własnej roboty → trzymać się libsodium-wzorców + audyt przed v1.0.

## Constraints

- **Deployment**: 1 kontener Docker, SQLite na wolumenie — to pozycja rynkowa; żadnych wymaganych zewnętrznych usług (S3, Redis, itp.)
- **Tech stack**: Rust (axum + SQLx) na serwerze; pv-core współdzielony przez WASM z web/extension; Next.js 15 + Tailwind v4 + DaisyUI 5 na froncie — zdecydowane w docs/
- **Krypto**: prymitywy libsodium-style (Argon2id, XChaCha20-Poly1305, HKDF-SHA256, ES256); zero-knowledge bezwzględnie — serwer nigdy nie widzi PRF output, kluczy, plaintextu
- **Design**: estetyka datafa.st wg UI-DESIGN.md (tokeny OKLCH, DM Sans + Fuzzy Bubbles, 1px bordery); security UI zawsze czytelne — playfulness nigdy w dialogach bezpieczeństwa
- **Budżet/zespół**: solo indie — pragmatyczna kolejność platform (web → extension → mobile), bez enterprise scope creep

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| A1: Greenfield (własny serwer + klienty), nie Bitwarden-compatible | Pełna kontrola designu (datafa.st), PRF-first od zera, prosty model danych; bez kieratu API BW | — Pending |
| Rust (axum + SQLx) na serwerze | webauthn-rs, passkey-rs i credential-exchange-format są w Rust; jeden język, core współdzielony przez WASM | — Pending |
| SQLite domyślnie, opcja Postgres | Single-container, backup = plik; wzór Vaultwarden | — Pending |
| Hierarchia kluczy: multi-recipient wrap UK bez warstwy RSA | Prostszy niż BW; `PRF → HKDF → wrap UK`, jeden blob per passkey; re-wrap N blobów przy rotacji akceptowalny | — Pending |
| Licencja AGPL-3.0 | Jak Vaultwarden — copyleft chroni przed proprietary forkami SaaS | — Pending |
| Hash-po-KDF do logowania hasłem (nie OPAQUE) | Wzór Bitwardena, sprawdzone, mniej ruchomych części w MVP; OPAQUE jako hardening przed v1.0 | — Pending |
| Konta osobiste + rodzina w v1 (bez organizacji) | Sharing linkami + współdzielenie rodzinne wystarcza self-hosterom; organizacje odsuwałyby MVP | — Pending |
| Załączniki: trait storage + implementacja dyskowa w v1 | Utrzymuje "1 kontener" bez wymuszania S3/Appwrite; backend S3 dodawalny później bez migracji | — Pending |
| Extension: WXT z dual-output Chrome + Firefox | Plasmo martwy; Chrome+Firefox to część pozycji rynkowej | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-12 after initialization*
