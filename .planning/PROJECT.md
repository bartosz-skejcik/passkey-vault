# Passkey Vault (nazwa robocza)

## What This Is

Darmowy, open-source, **self-hostable jednym kontenerem Docker** menedżer haseł, który jest **passkey providerem** na wszystkich powierzchniach klienckich (extension Chrome+Firefox → Android → iOS → Windows) i traktuje **PRF vault unlock** (odblokowanie vaulta passkeyem) jako first-class feature — nie bolt-on. Zero-knowledge: serwer nigdy nie widzi kluczy ani plaintextu. UI w ciepłej, indie-makerowej estetyce datafa.st — przeciwieństwo enterprise'owego chłodu 1Password i sterylności Bitwardena.

Dla self-hosterów (społeczność Vaultwarden/homelab), którzy chcą passkeys + PRF unlock bez ciężkiego oficjalnego Bitwardena i bez czekania na niezmergowany PR Vaultwarden #5929.

## Core Value

**Lekki self-hostable vault (1 kontener + wtyczka Chrome/Firefox), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.** Jeśli wszystko inne zawiedzie, to musi działać.

## Current Milestone: v0.3 Polish & Hardening

**Goal:** Skonsolidować v0.2: jeden model logowania (Vaultwarden-style — pełny sign-in przez okno, popup = tylko unlock), jeden design system / źródło komponentów (wtyczka zasysa z frontendu przez `packages/pv-ui` na ile architektura pozwala), spójność wizualna in-page, oraz spłata długu technicznego i ukrytych ryzyk wyciągniętych podczas live-debugowania v0.2. Zero-knowledge i SECURED (faza 12) nienaruszone.

**Target features:**
- **Model logowania Vaultwarden-style** — full sign-in ZAWSZE przez okno server-ceremony (oba browsery); popup traci password-signin, robi tylko unlock (hasło + passkey przez okno); unifikacja unlock na jeden tor (AUTH-01..04).
- **Jeden design system** — czysta logika+typy, silnik i18n i `ItemIconTile` żyją raz w `pv-ui`; web i popup współdzielą; in-page overlays token-aligned (DS-01..04).
- **Spójność wizualna in-page** — jasne kafelki logo w Surface A/B jak na froncie; okna FF wycentrowane + self-close (UX-01/02).
- **Cross-browser hardening** — cross-realm response-direction fix na FF (byte-asserted); in-page consent FF decyzyjnie po security-review (XBR-02/03).
- **Serwer + supply-chain** — CORS Authorization jawnie, D-10 konkretne originy, cargo audit/deny + pin toolchain, sign-count clone-detection (SEC-01..04).
- **Rygor testów + CI** — pipeline CI full-gate, sondy FF w npm-scriptach, real-RP webauthn-rs round-trip, bramka serializacji bajtów (QA-01..04).

**Key context:** v0.2 (fazy 8–13) zapieczętowane 2026-07-20 po brutalnym live-debugu na realnym Firefox/Zen + github.com — 7 klas bugów niewidocznych dla zielonego CI (fixture za grzeczne: localhost bez CSP, tylko Uint8Array, `.ok` zamiast bajtów, jsdom bez Xrayów). v0.3 zamienia tę nauczkę w rygor. Cleanup/complete-milestone ŚWIADOMIE odłożone do v1.0 — pełna historia implementacji zostaje. Dwa Critical (cross-realm response + brak real-RP testów providera) = pierwsza faza. Research: `.planning/research/v0.3/`.

## Requirements

### Validated

<!-- Istniejący kod — fundament krypto i szkielet serwera (zmapowany w .planning/codebase/). -->

- ✓ Hierarchia kluczy pv-core: losowy User Key wrapowany multi-recipient (hasło + N passkeys), Argon2id + HKDF, XChaCha20-Poly1305 — existing
- ✓ Ścieżka PRF → HKDF → wrapping key → unwrap User Key (`pv-core/src/prf.rs`) — existing
- ✓ Per-item encryption z osobnym Cipher Key per item (`pv-core/src/items.rs`) — existing
- ✓ Zeroize/ZeroizeOnDrop na wszystkich materiałach kluczowych — existing
- ✓ Szkielet serwera axum + SQLx/SQLite, migracja 0001, endpoint prelogin (KDF params + salt) — existing
- ✓ pv-core kompilowalny do WASM (bez I/O) — współdzielenie krypto z klientami — existing
- ✓ Most WASM: crate `pv-wasm` (opaque-handle keys, klucze nigdy nie opuszczają pamięci WASM) + themed shell Next.js 16 (static export, DaisyUI vault-dark/vault-light) + choke-point `lib/crypto/` z działającym round-tripem w przeglądarce — Phase 1 (UI-01)
- ✓ Rejestracja/login hasłem, sesje, vault CRUD (items/foldery/tagi) z per-item encryption end-to-end, generator haseł — Phase 2
- ✓ Enrollment passkeys (two-ceremony PRF), Settings (Passkeys/Sesje/Bezpieczeństwo), server-enforced no-stranding, revoke sesji — Phase 3
- ✓ PRF unlock vaulta passkeyem + zunifikowany login (passkey-first), pending-unlock recovery — Phase 4
- ✓ Multi-device sync: revision-gated GET /api/sync, WS push metadata-only (zero ciphertext w kanale push), konflikt per-item po rewizji (409 + banner), reconnecting dot, remote-delete toast — Phase 5 (SYNC-01/02/03), zweryfikowane live w 2 kartach
- ✓ Import (Bitwarden JSON/CSV, NordPass/1Password/LastPass/KeePass CSV, generic z ręcznym mapowaniem) + eksport JSON/CSV z bramką ostrzeżenia plaintext + TOTP jako typ itemu (RFC 6238 w pv-core/WASM, live coral ring) + onboarding 3-krokowy (import-first, per-browser flag) — Phase 6 (VAULT-07, IMPEX-01..04, UI-04), UAT 4/4 live
- ✓ Self-host packaging: `Config::validate()` fail-loud na błędny RP_ID/ORIGIN przed bootem, 1 kontener Docker (axum serwuje API + statyczny web app + SQLite WAL na wolumenie), reference nginx/Caddy (strip `?token=` z access-logów WS), SIGTERM graceful — Phase 7 (DEPLOY-01/02); code+runtime zweryfikowane, container E2E → human_needed na hoście z Dockerem

**✅ v0.1 MVP SHIPPED 2026-07-14** — 30/30 requirements, 7/7 faz zweryfikowanych, integracja cross-phase czysta (5/5 flows E2E). Audit: `.planning/milestones/v0.1-MILESTONE-AUDIT.md`.

- ✓ Extension bootstrap (WXT): MV3 Chrome + MV2 Firefox z jednego builda, `pv-wasm` instancjonowany w background service workerze pod CSP `wasm-unsafe-eval`, round-trip krypto przeżywa realny idle-kill/wake (obserwowane w przeglądarce, nie inferowane — CDP kill + marker ground-truth), `build-wasm.sh` rozszerzony addytywnie (jedna ścieżka artefaktu krypto) — Phase 8 (EXT-01)
- ✓ Extension session core + popup + sync: unlock hasłem i **extension-scoped PRF passkeyem** (RP ID = ext id, HKDF `pv:ext-prf-unlock:v1`, blob `prf_wrapped_uk` na serwerze — serwer bez zmian webauthn-rs), User Key wyłącznie w `chrome.storage.session` (przeżywa idle-kill, auto-lock przez `chrome.alarms` z konfigurowalnym timeoutem), popup browse/search/pick (React+DaisyUI, NordPass-layout), REST+WS sync jako trzeci klient (cross-client push udowodniony żywym drugim klientem), user-configured server URL z walidacją `/healthz` + „Zmień serwer" na unlocku, CORS allowlist na sztywny published extension origin (forged origin odrzucany), fullscreen/settings/new-item = czyste redirecty do web appa — Phase 9 (EXT-02..06), re-weryfikacja 7/7 po gap-closure (1 Critical + 8 Warnings naprawione, 689 linii martwego spike'a usunięte)
- ✓ Autofill (login/TOTP/card/identity): deterministyczna detekcja formularzy + scored card/identity, origin-gated decrypt/fill w tle z frame-addressed dispatch, ISOLATED content-relay z native-setter fill (React-safe), popup „Na tej stronie"+„Wszystkie" (NordPass 2-sekcje, dedup) ORAZ in-page shadow-DOM overlay (in-field dropdown + form-prompt, crypto-free, closed shadow, „PV" affordance), TOTP po issuer-match+pole-OTP, D-12 second-confirm dla card/identity, gesture-gated, cross-origin-iframe refusal udowodniony adwersarialnie (SC#5) — Phase 10 (FILL-01..04), 5/5 SC + pełna runda live-review Bartka, UAT paczkowanego builda w realnym Chrome
- ✓ Generate & Capture: generator na formularzach signup (popover click-triggered w closed shadow, znaki+passphrase, CSPRNG z współdzielonego `packages/pv-ui`), zapis nowego loginu po udanym submicie (warstwowa heurystyka DOM/URL+brak błędu, toast z originem i maskowanym hasłem), wykrycie zmiany hasła → update bez duplikatu (klasyfikacja origin+username na zaufanym sender-originie, `ensureItemsHydrated` przeciw wyścigowi po idle-killu), origin-mismatch modal (klasa Bitwarden-CVE, oba originy w pełnym brzmieniu, decyzja wyłącznie z danych przeglądarki) + suggested bez formularza (D-11), parytet motywu/stylu z frontendem (lustro `pv-theme-mirror` z web appa, tokeny `pv-ui`, generator 1:1 z webowym) i popup single-scroll (D-14) — Phase 11 (CAP-01/02/03), 4/4 SC, 2 iteracje review (1C+6W naprawione), UAT 28/28 + 12/12 theme parity, 5 rund live-review Bartka, akceptacja explicite
- ✓ Passkey provider: MAIN-world key-free RPC shim (`credentials.create`/`get` na cudzych stronach), `passkey-rs` soft authenticator + PRF, consent UI, native fallthrough (D-11), security-review gated (SECURED) — Phase 12 (PROV-01..05), zweryfikowane 2026-07-17
- ✓ Dual-browser hardening: zweryfikowany parytet Chrome/Firefox (lub jawna degradacja — np. ext-scoped WebAuthn niemożliwy na FF), strict_min_version 115, moz-extension CORS pattern (D-10), server-ceremony unlock na FF, headed-Chromium ceremony lane — Phase 13 (XBR-01), zapieczętowana 2026-07-20 (ostatnia faza v0.2)
- ✓ Critical risk closure (pierwsza faza v0.3, risk-first): XBR-02 root-caused — response-direction `instanceof:false` to artefakt pomiaru WebDriver/executeScript (inline-script fixture: `instanceof:true` nawet pre-fix); MAIN-world re-materializacja jako defense-in-depth, probe hard-gate (exit 1 na FAIL) + jsdom cross-realm regression suite; QA-03 zamknięte prawdziwym cross-vendor testem `webauthn-rs` (kanidm weryfikuje realne ceremonie pv-provider/passkey-rs, prawdziwe podpisy nad prawdziwymi challenge'ami); debug doc git-tracked → resolved; pełna 9-komendowa bramka zielona (vitest 674, cargo 151, run-core 17+1, server-unlock 15/2/0, chromium 5/5) — Phase 14 (XBR-02, QA-03), code review 0C/0W po fixach, zweryfikowana 2026-07-20

### Active

<!-- v0.2 (Browser Extension) i dalej: -->

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
| Next.js 16 (nie 15) + wyłącznie static export | 15 tylko w maintenance; breaking changes 16 nie dotyczą static exportu; SSR = naruszenie zero-knowledge | ✓ Good (Phase 1) |
| pv-wasm: osobny crate bindingów, opaque-handle keys | pv-core zostaje czysty/audytowalny; surowe bajty kluczy nigdy nie przekraczają granicy WASM | ✓ Good (Phase 1) |
| getrandom 0.2 `js` (nie 0.4 `wasm_js`) | Zmierzony graf zależności: chacha20poly1305 0.10→rand_core 0.6→getrandom 0.2.17; 0.4/wasm_js dopiero po odroczonym bumpie chacha 0.11 | ✓ Good (Phase 1) |
| TypeScript 5.9.3 (nie 7.x) | TS7 eksportuje natywny kompilator (Go) — łamie classic Compiler API workera Next.js 16 | ✓ Good (Phase 1) |
| Tailwind v4 wymaga @tailwindcss/postcss pod Turbopackiem | Bez pluginu dyrektywy CSS-first cicho nie kompilują się (build przechodzi, strona bez styli) — złapane na ludzkim checkpoincie | ✓ Good (Phase 1) |

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
*Last updated: 2026-07-20 — Phase 14 (Critical Risk Closure) complete: XBR-02 + QA-03 closed with byte-level proof; next: Phase 15 (Login & Unlock Unification)*
