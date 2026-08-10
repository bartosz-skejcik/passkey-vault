# Passkey Vault (nazwa robocza)

## What This Is

Darmowy, open-source, **self-hostable jednym kontenerem Docker** menedżer haseł, który jest **passkey providerem** na wszystkich powierzchniach klienckich (extension Chrome+Firefox → Android → iOS → Windows) i traktuje **PRF vault unlock** (odblokowanie vaulta passkeyem) jako first-class feature — nie bolt-on. Zero-knowledge: serwer nigdy nie widzi kluczy ani plaintextu. UI w ciepłej, indie-makerowej estetyce datafa.st — przeciwieństwo enterprise'owego chłodu 1Password i sterylności Bitwardena.

Dla self-hosterów (społeczność Vaultwarden/homelab), którzy chcą passkeys + PRF unlock bez ciężkiego oficjalnego Bitwardena i bez czekania na niezmergowany PR Vaultwarden #5929.

## Core Value

**Lekki self-hostable vault (1 kontener + wtyczka Chrome/Firefox), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.** Jeśli wszystko inne zawiedzie, to musi działać.

## Current State

**✅ v0.4 Family & Sharing SHIPPED 2026-08-09** (fazy 21–28, 64 plany, 548 commitów od v0.3). Cztery
milestone'y dowiezione: v0.1 MVP, v0.2 Browser Extension, v0.3 Polish & Hardening, v0.4 Family & Sharing.
Instancja jest teraz multi-user: warstwa asymetryczna (X25519 identity keypair + sealed Collection Keys)
w `pv-core`, model rodziny/kolekcji z jednym jednolicie egzekwowanym sprawdzeniem członkostwa, live
fan-out współdzielonych danych, zaproszenia jednorazowym linkiem/kodem bez SMTP, trzy poziomy dostępu,
atomowy re-key ograniczony kosztowo przy zawieszeniu/usunięciu członka, oraz współdzielone wpisy
działające identycznie w web app i we wtyczce (autofill, TOTP, passkey provider). Zero-knowledge trzyma:
serwer nigdy nie widzi klucza prywatnego, Collection Key ani plaintextu. Deployment 1 kontener/SQLite bez zmian.

**Stack żywy:** Rust workspace (pv-core / pv-server / pv-provider / pv-wasm), Next.js static-export web app,
WXT MV3/MV2 extension, `packages/pv-ui` jako design-system home. Gate: cargo workspace + 821 web vitest +
788 ext vitest + oba tsc + oba buildy + web-ext lint + MAIN-world audit + supply-chain + live Playwright
(web e2e oraz dwuwtyczkowy harness dwóch członków).

**Nauczka v0.4, warta przeniesienia dalej:** zielony unit suite NIE jest dowodem dla twierdzenia dotykającego
krypto — oba suite'y mockują `@/lib/crypto`. Faza 24 znalazła live 4 realne bugi, faza 25 defekt kontraktu
wire, faza 26 dwa (w tym feature działający tylko w jedną stronę przy 700+ zielonych testach), faza 27 kolejne,
a audyt milestone'u jeszcze trzy — wszystkie tej samej postaci: **zdolność serwera, do której nie sięga żaden
klient**. Standard, który z tego wyrósł (testy real-WASM albo live Playwright, twierdzenia pozytywne po
stronie odbiorcy zamiast asercji nieobecności, falsyfikacja każdego nowego guardu) jest najbardziej
przenośnym wynikiem tego milestone'u.

**Dług przeniesiony do v0.5 (5 pozycji, pełna lista w `.planning/milestones/v0.4-ROADMAP.md`):**
osierocony `POST /api/identity/verify/{user_id}` (ostatnia instancja sygnaturowego trybu awarii v0.4),
WINDOWS #12 (export ignoruje maskę hidden-password, oba klienty), WINDOWS #13 (brak UI dodającego członka do
ISTNIEJĄCEJ kolekcji), brak przycinania `pendingSharedItems` per wiersz, clippy `explicit_auto_deref` ×19.
Niezaimplementowane świadomie: **UX-04** i **FAM-10**.

**Czeka na ocenę Bartka:** kontrast plakietki shared-item w popupie wtyczki oraz czytelność copy wiersza
broken/dialogu usuwania (screenshoty: `.playwright-mcp/uat-27/`). Dodatkowo `data/pv.db` zawiera 12 kont
`pv-e2e-*` (incydent `reuseExistingServer` w 28-02) — zostawione, to dane Bartka.

**Next Milestone:** nieokreślony — uruchom `/gsd-new-milestone` (questioning → research → requirements → roadmap).

**Key context (historyczny):** v0.2 zapieczętowane 2026-07-20 po brutalnym live-debugu na realnym Firefox/Zen
+ github.com — 7 klas bugów niewidocznych dla zielonego CI. v0.3 zamieniło tę nauczkę w rygor. v0.4 pokazało,
że rygor trzeba stosować także *między* fazami, nie tylko wewnątrz nich.

## Current Milestone: v0.5 Sharing That Makes Sense

**Goal:** v0.4 zbudowało maszynerię współdzielenia; v0.5 sprawia, że da się jej używać. Krypto,
autoryzacja, re-key, fan-out i integracja z wtyczką działają i są live-proven — brakuje tego, żeby
człowiek mógł **znaleźć, zrozumieć i uporządkować** to, co udostępnia.

**Target features:**
- Prawdziwa strona `/settings` (dziś: fixed-right overlay panel), z przeprojektowaną sekcją Family & Sharing
- Wrzucanie itemów do ISTNIEJĄCEGO udostępnionego folderu — dziś niemożliwe
- Udostępnianie **całej rodzinie** jako żywa grupa: kto dołączy później, dostaje dostęp automatycznie
- Rzetelne oznaczenie shared w liście itemów + rozróżnienie „ja udostępniam" vs „mnie udostępniono"
- Sharing overview pokazujący ITEMY, nie tylko foldery; filtry shared-by-me / shared-with-me
- Modal udostępniania: wiersz na osobę + select poziomu dostępu po prawej (projekt Bartka)

**Trzy zweryfikowane defekty funkcjonalne** (sprawdzone w kodzie przed napisaniem requirements, nie
przyjęte na słowo): `ItemForm.tsx` w ogóle nie zna `collectionId`; `AvatarStack.tsx:100` zwraca `null`
przy pustym zbiorze odbiorców, więc udostępniony item potrafi wyglądać na prywatny; a
`SharingOverviewPanel` buduje wiersze wyłącznie z `editableCollections`, więc pojedynczo udostępnione
itemy nie pojawiają się nigdzie.

**Centralne ryzyko techniczne — FSH-02.** „Kto dołączy później, dostaje dostęp automatycznie" wymaga,
by Collection Key trafił do nowego członka ścieżką **wyłącznie kliencką** — serwer nigdy go nie ma i
mieć nie będzie. Mechanizm jest jawnym spike'em decyzyjnym, udokumentowanym PRZED zależnym kodem
(precedens KEY-05 i EXT-10). Konsekwencja do zakomunikowania uczciwie w UI: „automatycznie" nie
znaczy „natychmiast", jeśli catch-up zależy od tego, aż inny członek otworzy aplikację.

**Rationale kolejności:** użyteczność sharingu przed platformami mobilnymi — dokładanie drugiego
providera do UX, który sam autor nazywa „bardzo niejasny", oznaczałoby przeniesienie zamieszania na
kolejną powierzchnię.

<details>
<summary>📦 v0.4 Family & Sharing — SHIPPED 2026-08-09 (archiwum)</summary>

### Current Milestone: v0.4 Family & Sharing (jak zdefiniowany na starcie)

**Goal:** Instancja obsługuje wielu użytkowników w ramach rodziny — wpisy i foldery można współdzielić z zachowaniem zero-knowledge, a współdzielone dane działają tak samo w web app jak w autofillu i passkey providerze wtyczki.

**Target features:**
- Konta rodzinne / multi-user admin — rodzina jako obiekt, właściciel, lista członków, usuwanie członka (z re-key)
- Zaproszenia przez jednorazowy link/kod — bez SMTP, pozycja „1 kontener" nietknięta
- Współdzielone foldery (kolekcje) widoczne dla wybranych członków
- Udostępnienie pojedynczego wpisu konkretnej osobie
- Trzy poziomy dostępu: odczyt / pełna edycja / ukryte hasło
- Współdzielone wpisy w extension: autofill, TOTP, passkey provider

**Rationale kolejności:** sharing przed platformami mobilnymi (iOS/Android) — model współdzielenia zmienia hierarchię kluczy i API serwera, więc dorabianie go po drugim providerze oznaczałoby implementację w dwóch miejscach.

**Key context:**
- Sharing wymaga warstwy asymetrycznej (per-user keypair) w `pv-core` — hierarchia kluczy jej dziś nie ma. Out of Scope odrzuca *RSA layer jak w Bitwardenie*, nie kryptografię klucza publicznego jako taką; wariant minimalny zostanie wybrany i udokumentowany jako decyzja w fazie krypto.
- Usunięcie członka = re-key współdzielonego zasobu + re-wrap dla pozostałych; projekt musi unikać kosztu O(cały vault).
- **Ukryte hasło jest zabezpieczeniem UI, nie kryptograficznym** — członek z dostępem posiada klucz i technicznie odczyta hasło (to samo ograniczenie ma Bitwarden). UI musi to komunikować uczciwie.
- Serwer nadal nie widzi żadnego klucza ani plaintextu — twarda granica całego modelu sharingu.

</details>

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

**✅ v0.2 Browser Extension COMPLETE 2026-07-20** — EXT-01..06, PROV-01..05, FILL-01..04, CAP-01..03, XBR-01 dostarczone; katalogi faz zarchiwizowane przy zamknięciu v0.3 → `.planning/milestones/v0.2-phases/`.
- ✓ Critical risk closure (pierwsza faza v0.3, risk-first): XBR-02 root-caused — response-direction `instanceof:false` to artefakt pomiaru WebDriver/executeScript (inline-script fixture: `instanceof:true` nawet pre-fix); MAIN-world re-materializacja jako defense-in-depth, probe hard-gate (exit 1 na FAIL) + jsdom cross-realm regression suite; QA-03 zamknięte prawdziwym cross-vendor testem `webauthn-rs` (kanidm weryfikuje realne ceremonie pv-provider/passkey-rs, prawdziwe podpisy nad prawdziwymi challenge'ami); debug doc git-tracked → resolved; pełna 9-komendowa bramka zielona (vitest 674, cargo 151, run-core 17+1, server-unlock 15/2/0, chromium 5/5) — Phase 14 (XBR-02, QA-03), code review 0C/0W po fixach, zweryfikowana 2026-07-20

- ✓ Unifikacja logowania (model Vaultwarden): sign-in ZAWSZE przez okno server-ceremony (hasło+passkey, oba browsery), popup = tylko unlock (hasło-first + passkey przez okno) i URL serwera; ext-scoped PRF twardo usunięty (9 plików + trwały guard-test); zmiana serwera z dialogiem potwierdzenia i czystą migracją sesji/uprawnień (udowodnione żywo na dwóch serwerach, 2 realne bugi znalezione i naprawione przy dowodzie); vitest po raz pierwszy exit 0 (678/678 ext + 474/474 web) — Phase 15 (AUTH-01..04), review 0C/1W(fixed)/3I, zweryfikowana 2026-07-20
- ✓ Design system extraction (logika/typy/i18n): 7 kanonicznych modułów w `packages/pv-ui` (types superset, cardBrand, search, sort-comparator split-shim, clipboard, i18n engine `t<D>`/`interpolate`/`resolveLocale` + `common.ts` 34 klucze wspólne / 4 rozbieżne celowo lokalne), web+extension konsumują przez 1-liniowe `export *` shimy (zero churnu importów), zero duplikatów zweryfikowane grepem, oba suity bez zmian zachowania (481 web + 685 ext po fixach review WR-01/WR-02), exports map jako jedyne źródło resolucji (tsconfig paths usunięte) — Phase 16 (DS-01/DS-02), review 0C/2W(fixed)/4I, zweryfikowana 2026-07-21 (UAT: web unlock screenshot + 7/7 P9 e2e)
- ✓ Shared component & visual alignment: `ItemIconTile` żyje raz w `pv-ui/components/` (pierwszy współdzielony .tsx — peerDeps + lokalne node_modules pv-ui + resolve.dedupe w wxt/vitest przeciw duplikacji Reacta, udowodnione negative-control buildem), web+popup = shimy; kafelek ikony na WSZYSTKICH powierzchniach (web/popup/in-page dropdown+prompt) czyta `--pv-tile-bg`/`--pv-tile-fg` z tokens.css — jasny kafelek w vault-dark wszędzie (bug ciemnego kafelka in-page zamknięty), parytet 16/16 identycznych computed colors + 10 screenshotów; audyt overlayów: dokładnie 8 udokumentowanych wyjątków literałów (4 cienie rgba + 4 pill-radius), zero innych hand-copied stałych; harness wizualny `extension/e2e-visual/` jako stała linia regresji; README pv-ui z kontraktem konsumenta (dedupe/lockstep/@source) — Phase 17 (DS-03/DS-04/UX-01), review 1C+5W(fixed)/2I, zweryfikowana 2026-07-21 (8/8 must-haves)
- ✓ Firefox window & consent hardening: geometria/lifecycle okien ceremony (480×640) i consent (380×460) sformalizowane — 13/13 unit testów (dokładne asercje pozycji ujemnych, isFinite guardy z negative-control) + stała linia live-probe `test:e2e:firefox:window-geometry` (7/7 GEOM gates PASS, evidence snapshot w phase dir); XBR-03 rozstrzygnięte REJECT-WITH-REASON (czterowymiarowa recenzja: DEF CON 33 clickjacking — closed shadow-root tylko częściowa ochrona; T-12-14 nietknięte, model okna potwierdzony) — Phase 18 (UX-02, XBR-03), review 0C/3W(fixed), zweryfikowana 2026-07-21 (11/11)
- ✓ Server & supply-chain hardening: CORS zawężony (SEC-01 jawna lista allow_headers [authorization, content-type], zero `*`; SEC-02 tylko konkretne per-install originy — wildcard `moz-extension://*` usunięty, D-10 zamknięty, WR-07 zachowany, parse fail-loud na każdy wildcard) z dowodem real-TCP preflight (reqwest); SEC-04 regresja licznika WebAuthn ujawniona — migracja 0013 `counter_anomaly_at` + wspólny klasyfikator `handle_finish_auth_error` (wbudowany hard-fail webauthn-rs nietknięty, tylko log+flag na już-odrzuconej ścieżce) + test regresji; SEC-03 cargo-audit 0.22.2/cargo-deny 0.20.2 + deny.toml + scripts/check-supply-chain.sh (exit 0) + exact `=x.y.z` piny watch-listy + toolchain 1.97.0; review 0C/2W(fixed: warn-log przy write-fail, parytet enumeracji prf_salts); cargo test --workspace 153 zielone — Phase 19 (SEC-01..04), zweryfikowana 2026-07-21 (4/4 SC)
- ✓ Test infrastructure & CI gate (ostatnia faza v0.3): `.github/workflows/ci.yml` z 4 jobami (rust workspace, web 481 vitest+tsc+build, extension 693 vitest+tsc+oba wxt buildy+web-ext lint+MAIN-world audit, supply-chain cargo-audit/cargo-deny pinned `--locked`) na push/PR — pełny SC1 gate zielony lokalnie (brak remote; cloud-run = follow-up); QA-04 trwały byte-shape regression gate `crates/pv-provider/tests/response_shape.rs` (base64url string dla KAŻDEGO binarnego pola create+get, panic z nazwą pola przy regresji do number-array); QA-02 wszystkie realne lane'y Firefox (server-unlock, provider-corruption, request-xray; CSP-strict wpleciony w core+request-xray wg planu) jako npm scripts + 6 lane'ów w README; `ff-profile-prefs.cjs` wygasza macOS passkey-sheet w automacji (todo resolved); review 1C+5W wszystkie naprawione (exit-1 na CORRUPTED, bounded driver cleanup, `permissions: contents: read`, SHA-pinned actions, fail-fast na hasła UAT bez commitowanych defaultów, awaited ceremony executeScript) — Phase 20 (QA-01/02/04), zweryfikowana 2026-07-21 (3/3 SC)

**✅ v0.3 Polish & Hardening SHIPPED 2026-07-22** — 20/20 requirements, 7/7 faz zweryfikowanych + Nyquist-compliant + threat-secure, integracja 5/5 seams. Audit: `.planning/milestones/v0.3-MILESTONE-AUDIT.md`. ~~Znany follow-up: pierwszy push/PR na realny runner GitHub Actions~~ — **zamknięte 2026-07-30** (patrz Current State).

<!-- v0.4 Family & Sharing — w toku: -->

- ✓ Crypto foundation (asymetryczna tożsamość + Collection Keys): decyzja KEY-05 zapisana i uzasadniona **przed** jakimkolwiek zależnym kodem (`crypto_box` =0.9.1 — jedyny audytowany przez Cure53 crate public-key w RustCrypto dzielący już istniejący graf chacha20poly1305/rand_core; wbudowany `seal` świadomie odrzucony bo hardkoduje SalsaBox zamiast ChaChaBox; „zero new getrandom lines" zweryfikowane `cargo tree` natywnie **i** na wasm32); X25519 identity keypair z własnym Zeroize (bo `crypto_box::SecretKey` zeroizuje tylko wewnętrzny scalar, nie surowe 32 bajty); sealed Collection Key round-trip cross-keypair; scope-bound AAD z wersjonowanymi stałymi domain-separation i testem cross-context rejection; konto sprzed v0.4 dostaje keypair **bez re-enkrypcji ani jednego bajta** (dowód na zacommitowanym fixture pre-v0.4); pełny most pv-wasm opaque-handle — Phase 21 (KEY-01..05), 5/5 planów, zweryfikowana 2026-07-30
- ✓ Family & collection data model + autoryzacja serwera: migracja 0014 + **jeden** ekstraktor `Membership<R,M>`/`FamilyMembership<M>` jako granica bezpieczeństwa dla każdego mutującego endpointu (dowód: route-sweep test — żaden mutujący endpoint nie jest osiągalny dla nie-członka); SHARE-04 zamyka bypass Vaultwarden #6269 dedykowanym testem regresji (hidden-password nie może przenieść itemu do innej kolekcji); KEY-01 server half (klucz publiczny serwowany, prywatny jako opaque blob którego serwer nigdy nie rozwija) i KEY-02 fan-out per-member (N członków = N osobnych `SealedKey`, każdy otwieralny wyłącznie swoim kluczem, `enc_data` byte-identyczne przed i po dodaniu członka); SHARE-06 revocation egzekwowana na następnym requeście — Phase 22 (FAM-01..03, SHARE-04..06, SEC-06, KEY-01/02 server), 5/5 planów, zweryfikowana 2026-07-30
- ✓ Sync fan-out współdzielonych danych (najwyższe ryzyko integracyjne milestone'u): per-collection revision counter bumpowany **w tej samej transakcji** co mutacja, ekspozycja jako `Vec` per-kolekcja (nigdy MAX/SUM fold); członkostwo rozwiązywane **świeżo w momencie emisji**, nigdy z cache (właśnie dodany zaczyna dostawać framy, właśnie usunięty przestaje — dowód na wciąż otwartym gnieździe WS, nie inferencja z kolejności zapytań); 409 `StaleRevisionShared` atrybuuje konflikt po emailu na **obu** bannerach (reaktywnym i proaktywnym), PL+EN; **zero** wycieku do nie-członka udowodnione 6 adwersarialnymi testami (404-nie-403, `SyncEvent` nadal dokładnie 4 pola); osobisty `GET /api/sync` **bajtowo nietknięty** (diff pusty na ciele handlera i klauzulach autoryzacji `fetch_items_for`) — dane współdzielone wchodzą wyłącznie trzema addytywnymi endpointami; SEC-08 = stojący harness multi-session postawiony **w tej fazie**: warstwa Rust (2 sesje + 2 realne WS) plus pierwszy w tym repo pakiet Playwright w `web/`, wpięty w CI jako **blokujący** job (3/3 zielone lokalnie i na realnym runnerze) — Phase 23 (SYNC-04..08, SEC-08), 6/6 planów, zweryfikowana 2026-07-31, threat-secure (17/17 zagrożeń zamkniętych)

### Active

<!-- Po v0.3 — kandydaci na kolejne milestone'y: -->

- [ ] **→ v0.4 (w toku):** Rodzina w ramach instancji: multi-user admin, zaproszenia linkiem, współdzielone foldery + per-item share, poziomy odczyt/edycja/ukryte hasło, widoczne w extension
- [ ] Sharing: zaszyfrowane linki (klucz w URL fragment) dla osób bez konta — odłożone z v0.4, kandydat na kolejny milestone
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
| XBR-03: in-page consent panel na Firefox (closed-shadow DOM) vs. okno server-chrome | Recenzja bezpieczeństwa (DEF CON 33, Marek Toth, sierpień 2025) wykazała, że closed shadow-root daje tylko częściową ochronę przed clickjackingiem/manipulacją opacity/z-index/focus() w 11 głównych menedżerach haseł (w tym 1Password i Bitwarden) — panel in-page ponownie otworzyłby domknięte T-12-14; model okna pozostaje strukturalnie odporny | ✓ REJECT-WITH-REASON (Phase 18) |
| KEY-05: sealed-box crypto — crypto_box crate (exact-pinned =0.9.1, features chacha20+alloc+rand_core) vs. hand-rolled X25519-ECDH vs. hpke 0.14.0 vs. rsa 0.9.10 | crypto_box jest jedynym stabilnym, audytowanym przez Cure53 crate'em public-key-encryption w organizacji RustCrypto, który już współdzieli graf zależności chacha20poly1305/rand_core/aead tego projektu; jego feature `chacha20` daje AEAD XChaCha20-Poly1305 — dokładnie ten cipher, którego już używa `aead_seal`; twierdzenie "zero new rand_core/getrandom lines" zostało niezależnie zweryfikowane przez `cargo tree` zarówno na targecie natywnym, jak i `wasm32-unknown-unknown` (a nie tylko przyjęte z research milestone'u). Odrzucone: hpke 0.14.0 (wymusza podbicie przypiętych hkdf i chacha20poly1305; crate i jego KEM x25519-dalek 3.0.0 miały ~3 tygodnie w momencie researchu; brak niezależnego audytu); rsa 0.9.10 (otwarty, niepatchowany advisory RUSTSEC-2023-0071 Marvin-attack; ten sam wzorzec warstwy RSA Bitwardena, który ten projekt już odrzucił); ręcznie składany X25519-ECDH przez x25519-dalek bezpośrednio (x25519-dalek 3.0.0 ciągnie major rand_core, który łamie wyrównanie grafu zależności zachowywane przez crypto_box; ręczne składanie KEM-a to dokładnie to, co recenzent bezpieczeństwa oflaguje jako rolled crypto). Wbudowany seal/unseal crypto_box (opcjonalny feature `seal`) został znaleziony i świadomie odrzucony, nie pominięty: hardkoduje SalsaBox (XSalsa20Poly1305) zamiast ChaChaBox, łamiąc własne uzasadnienie spójności cipherów, dla którego wybrano crypto_box. Dwa znane ograniczenia zapisane wprost: wywołania encrypt/decrypt ChaChaBox odrzucają niepuste associated data, więc scope-binding Collection Key jest wymuszany warstwę niżej, na poziomie item-AEAD, a nie na warstwie seal; oraz `crypto_box::SecretKey` nie implementuje traitu `zeroize::Zeroize` (jego własny ręcznie napisany Drop zeroizuje tylko wewnętrzne pole scalar, nigdy surową tablicę 32 bajtów), więc opakowanie klucza tożsamości w pv-core przechowuje własną tablicę bajtów z własnym Zeroize/ZeroizeOnDrop zamiast trzymać długożyciowy `crypto_box::SecretKey` | Decided (Phase 21) |
| EXT-10: shared-passkey WebAuthn signature-counter behavior — no per-item monotonic counter vs. server-authoritative counter state (the requirement's own starting hypothesis) | Requirement text framed this as "no shipped product precedent exists"; a direct code read of `crates/pv-provider/src/ceremony.rs`'s `create_provider_credential`/`get_provider_assertion` shows the `Authenticator` is never configured with `make_credentials_with_signature_counter(true)`, so it already reports a constant `signCount: 0` — confirmed empirically, not just by code read, by a new permanent regression (`sign_count_is_always_zero_for_a_provider_ceremony_assertion` in `crates/pv-provider/tests/response_shape.rs`) that decodes the RAW WIRE BYTES of `response.authenticatorData` (offset 33..37, WebAuthn §6.1) rather than trusting the Rust-side `Option<u32>`. WebAuthn L3 §6.1.1 explicitly permits an authenticator with no counter to report constant 0, and both iCloud Keychain and Google Password Manager ship this identical behavior for synced passkeys — so the requirement's own premise was factually wrong, and saying so is the spike's deliverable. Explicit anti-goal: no per-item monotonic counter is added, because N concurrently active member extensions sharing one passkey have no single authoritative "last counter" to race-free advance — two members' extensions would race on a revision-guarded row, manufacturing exactly the counter-regression false-positive this decision prevents (27-CONTEXT.md §A-8's pluralization-promotion). Separately traced with file:line evidence: a provider-ceremony assertion structurally cannot reach the Phase 19 SEC-04 counter-anomaly classifier (`crates/pv-server/src/routes/passkeys.rs:299-350`, `handle_finish_auth_error`) — called from exactly 3 sites (`passkeys.rs:269`, `passkeys.rs:552`, `auth.rs:575`), every one inside pv-server's own vault login/unlock ceremony against the `passkeys` table; `pv-provider`'s `Cargo.toml` has no `webauthn-rs`/`sqlx`/`pv-server` edge in `[dependencies]` (only a `[dev-dependencies]`-scoped QA-03 test verifier at `Cargo.toml:46`, never a production path) — the two code paths cannot meet, so ROADMAP SC 3's "does not trip the classifier" clause is satisfied structurally, not by omission. Full decision record lives in `ceremony.rs`'s doc comment above `get_provider_assertion`. The remaining evidence tier (genuine live-wire measurement against a real browser) is completed downstream in 27-06. | Decided (Phase 27) |
| FSH-02: family-wide key-delivery mechanism — hybrid invite-time wrap + lazy reseal vs. invite-wrap-only, vs. lazy-reseal-excluding-sharer, vs. server-side re-key, vs. a shared symmetric family key | Chosen: invite-time wrap (every family-wide collection's key wrapped into an invite at generation time, via an additive `invitation_family_wide_keys` sibling table — never a widened `invitations` column) PLUS lazy reseal (unwrap-own-key/reseal-to-one-new-recipient, no rotation, POSTed to the existing `add_member` endpoint) as the required fallback, with the reseal trigger explicitly including the SHARER's own subsequent app usage, not scoped to "another member" — the sharer already holds a key by construction via the existing multi-recipient fan-out, so excluding them manufactures an unnecessary single-point-of-failure. Rejected: invite-wrap alone, no lazy-reseal fallback (measured, not assumed — `invitations.rs::create` performs a one-time `INSERT` with no re-computation path, so a share created after invite generation is structurally invisible to that invite's payload for its entire remaining lifetime; without the fallback FSH-02 breaks unconditionally for that timing window); lazy reseal scoped to exclude the sharer (the starting hypothesis's own framing, overturned by research — needlessly fragile once the sharer's always-already-held key is recognized as a valid trigger occasion); server-side re-key on every join (direct FSH-03 violation — the server would need to hold or generate a Collection Key); a per-family shared symmetric key (cannot be revoked from one member without rotating for everyone, breaking the per-recipient sealed-key model KEY-06/KEY-07 already proved correct). User-visible caveat stated honestly: invite-carried delivery is genuinely immediate ("automatically" may mean "instantly" for that case only); lazy-reseal delivery is not instant — it arrives on the next completed sync/unlock by any current keyholder, sharer included — and the shipped UI copy must never collapse the two cases into one unqualified "automatically"/"instantly" claim. Residual limitation recorded plainly: a newcomer is stranded only if every keyholder, including the sharer, never opens the app again — an orthogonal "nobody uses this vault" condition, not a design defect. Full record: `30-DECISION-FSH-02.md`. | Decided (Phase 30) |

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
*Last updated: 2026-07-31 after Phase 23 (v0.4 Family & Sharing — 3/7 faz zweryfikowanych; next: Phase 24 Invitation Flow)*
