# Self-hosting

Status: v0.1 — jeden kontener Docker, self-build (bez publikowanego registry image).

## Szybki start

Wymagania: Docker + Docker Compose. Nic więcej — cały build (Rust, WASM,
Next.js) dzieje się wewnątrz obrazu.

```sh
git clone <adres-repo>
cd passkey-vault
docker compose up -d
```

To wszystko. `docker compose up` buduje obraz lokalnie (`build: .`) i
startuje jeden kontener `pv-server`, dostępny na `http://localhost:8620`.
Domyślna konfiguracja (`PV_RP_ID=localhost`, `PV_ORIGIN=http://localhost:8620`)
działa bez żadnej personalizacji — to zero-config case, który serwer
akceptuje bez żadnej dodatkowej walidacji.

Dane (baza SQLite) są trzymane w nazwanym wolumenie Dockera `pv_data`,
zamontowanym pod `/data` — przeżywają `docker compose down && docker compose
up`, nie tylko restart procesu.

Sprawdzenie, że kontener żyje:

```sh
curl -sf http://localhost:8620/healthz
# {"status":"ok"}
```

## Konfiguracja

Wszystkie zmienne środowiskowe, które `pv-server` faktycznie czyta
(`crates/pv-server/src/config.rs`, `crates/pv-server/src/main.rs`):

| Zmienna | Cel | Domyślna wartość |
|---|---|---|
| `PV_RP_ID` | WebAuthn Relying Party ID — musi być hostem `PV_ORIGIN` albo jego rodzicielską domeną. | `localhost` |
| `PV_ORIGIN` | Pełny adres origin (ze schematem), pod którym przeglądarka widzi vault. Musi być `https://` dla realnego wdrożenia. | `http://localhost:8620` (w `docker-compose.yml`; sam `pv-server` domyślnie zakłada `http://localhost:3000` poza kontenerem) |
| `PV_SESSION_TTL_HOURS` | Czas życia sesji, w godzinach. | `168` |
| `PV_DB_URL` | Ścieżka do bazy SQLite (`sqlite://...`). W obrazie Docker wskazuje na wolumen `/data`. | `sqlite:///data/pv.db` (w obrazie); `sqlite://data/pv.db` poza kontenerem |
| `PV_ADDR` | Adres i port, na którym serwer nasłuchuje. | `0.0.0.0:8620` (w obrazie, żeby był osiągalny z hosta); `127.0.0.1:8620` poza kontenerem |
| `PV_STATIC_DIR` | Katalog ze statycznym exportem Next.js (serwowany na tym samym porcie co API). | `/app/static` (w obrazie); brak (tylko API) poza kontenerem |
| `PV_EXTENSION_ORIGINS` | Lista originów rozszerzenia przeglądarki dopuszczonych do CORS — patrz sekcja "PV_EXTENSION_ORIGINS — CORS dla rozszerzenia przeglądarki" niżej. | (puste — brak dostępu CORS dla rozszerzeń) |

`docker-compose.yml` ustawia `PV_DB_URL`, `PV_ADDR` i `PV_STATIC_DIR` na
sztywno — nie są przeznaczone do nadpisywania przez `.env` (patrz komentarz
w `.env.example`). `PV_RP_ID`, `PV_ORIGIN` i `PV_SESSION_TTL_HOURS` czytane
są z `.env` (skopiuj `.env.example` → `.env` i edytuj):

```sh
cp .env.example .env
```

### Dlaczego niespójny `PV_RP_ID`/`PV_ORIGIN` blokuje start serwera

`pv-server` waliduje parę `PV_RP_ID`/`PV_ORIGIN` **przy starcie**, zanim
zacznie przyjmować jakikolwiek ruch — celowo, żeby błędna konfiguracja WebAuthn
ujawniła się od razu jako czytelny komunikat w logach, a nie dopiero jako
tajemniczy `SecurityError` w przeglądarce użytkownika w trakcie rejestracji
passkeya.

Zasady (obowiązują tylko dla wdrożenia innego niż `localhost` — zero-config
default zawsze przechodzi bez walidacji):

1. **`PV_ORIGIN` musi być pełnym, poprawnym URL-em** ze schematem i hostem,
   np. `https://vault.example.com`. Sam `example.com` bez `https://` nie
   wystarczy.
2. **`PV_ORIGIN` musi używać `https://`** dla każdego wdrożenia innego niż
   localhost — każda prawdziwa przeglądarka odrzuca niebezpieczny
   `http://` origin przy ceremonii WebAuthn, więc `pv-server` nie pozwoli Ci
   nawet spróbować.
3. **`PV_RP_ID` musi być równy hostowi `PV_ORIGIN` albo być jego
   rodzicielską domeną**, np. `PV_RP_ID=example.com` z
   `PV_ORIGIN=https://vault.example.com` jest poprawne, ale
   `PV_RP_ID=example.com` z `PV_ORIGIN=https://app.other-domain.com` — nie.

Jeśli któryś z tych warunków nie jest spełniony, `pv-server` **odmawia
startu** i wypisuje w logach dokładnie, która wartość jest problemem i
dlaczego (nazwana, nie generyczny błąd) — sprawdź `docker compose logs
pv-server` po nieudanym starcie.

### PV_EXTENSION_ORIGINS — CORS dla rozszerzenia przeglądarki

Rozszerzenie (Chrome/Firefox) łączy się z Twoim self-hostowanym `pv-server`
z własnego originu (`chrome-extension://<id>` albo `moz-extension://<uuid>`),
który przeglądarka traktuje jako inny origin niż sam `pv-server` — bez
jawnego dopuszczenia w CORS przeglądarka odrzuci nawet `/healthz`, zanim
rozszerzenie zdąży cokolwiek zrobić. Domyślnie (zmienna nieustawiona/pusta)
`pv-server` nie dopuszcza żadnego originu rozszerzenia — musisz to jawnie
skonfigurować, żeby rozszerzenie mogło połączyć się z Twoim serwerem.

**Chrome:** opublikowany identyfikator rozszerzenia jest stabilny — jeden
konkretny wpis wystarcza na zawsze:

```
PV_EXTENSION_ORIGINS=chrome-extension://<published-id>
```

**Firefox:** `moz-extension://<uuid>` jest przypisywany PER-PROFIL/PER-
INSTALACJĘ i zmienia się przy każdej reinstalacji lub nowym profilu — jeden
konkretny wpis jest niepraktyczny dla większości self-hosterów (musieliby go
aktualizować za każdym razem). Dlatego `pv-server` akceptuje specjalny,
dosłowny literał `moz-extension://*` jako **schematowo ograniczony wildcard**
— dopasowuje TYLKO poprawnie zbudowany origin `moz-extension://<uuid>` (36
znaków w kształcie UUID), nigdy dowolny inny origin. To jest **świadomy dług
techniczny** (decyzja Bartka, 13-CONTEXT.md ADDENDUM D-10), zaakceptowany bo:

- CORS nie jest tu granicą uwierzytelniania tego API — każda operacja
  zmieniająca stan nadal wymaga ważnego tokenu sesji/bearer niezależnie od
  wyniku CORS; wrogie rozszerzenie bez tokenu nic tym nie zyskuje.
- Rotacja UUID Firefoksa per-profil czyni konfigurację wyłącznie-konkretnymi-
  originami wrogą UX dzisiaj.
- Docelowo zostanie zastąpiony konfiguracją per-instalację z konkretnym
  originem w późniejszej wersji (patrz `.planning/STATE.md`, sekcja
  Deferred Items).

Dokładna linia `.env` dla obu przeglądarek naraz:

```
PV_EXTENSION_ORIGINS=chrome-extension://<published-id>,moz-extension://*
```

Bare `*` (sam wildcard, bez schematu) jest ZAWSZE odrzucany — `pv-server`
odmawia startu zamiast po cichu wyłączyć CORS albo spanikować.

## Wdrożenie za reverse proxy

`pv-server` nigdy sam nie terminuje TLS — to zawsze zadanie reverse proxy
(nginx lub Caddy) stojącego przed kontenerem. Dla realnego wdrożenia (nie
`localhost`) zawsze potrzebujesz proxy z certyfikatem TLS.

Zobacz `deploy/` po gotowe, skomentowane konfiguracje referencyjne (nginx i
Caddy). Obie konfiguracje muszą obsługiwać dwie rzeczy poprawnie, nie
opcjonalnie:

- **Nagłówki upgrade WebSocket** dla `/api/sync/ws` — bez nich sync push
  przestaje działać za proxy (nginx wymaga jawnego `Upgrade`/
  `Connection: upgrade` + `proxy_http_version 1.1`; Caddy obsługuje to
  automatycznie).
- **Zacieranie tokenu w logach dostępu** dla `/api/sync/ws?token=...` — token
  sesji sync leci w query stringu (nieuniknione ograniczenie WebSocket API w
  przeglądarce), więc surowy log dostępu reverse proxy (logowany przed
  jakąkolwiek warstwą `pv-server`) musi go wycinać, żeby nie zapisywać
  aktywnych tokenów sesji na dysku w plaintext.

## Backup i restore

Baza to pojedynczy plik SQLite w trybie WAL: `/data/pv.db`. **Backup musi
obejmować też jego siostrzane pliki `-wal` i `-shm`** — SQLite w trybie WAL
trzyma niezapisane jeszcze do głównego pliku zmiany właśnie w `pv.db-wal`.
Backup, który skopiuje samo `pv.db` i pominie `-wal`, straci ostatnie
zapisy (może nawet kilka ostatnich minut/godzin operacji, w zależności od
tego kiedy ostatni checkpoint WAL nastąpił).

```sh
# Backup (kontener może zostać uruchomiony w trakcie kopiowania — WAL mode
# jest bezpieczny do odczytu współbieżnego plikowego, ale najprościej i
# najbezpieczniej jest zatrzymać kontener na czas kopii):
docker compose stop pv-server
docker run --rm -v pv_data:/data -v "$(pwd)/backup":/backup debian:bookworm-slim \
  sh -c "cp /data/pv.db /data/pv.db-wal /data/pv.db-shm /backup/ 2>/dev/null; true"
docker compose start pv-server

# Restore (do świeżego wolumenu lub po docker compose down):
docker run --rm -v pv_data:/data -v "$(pwd)/backup":/backup debian:bookworm-slim \
  sh -c "cp /backup/pv.db* /data/"
docker compose up -d
```

## Rozwiązywanie problemów

| Objaw | Prawdopodobny błąd `Config::validate()` | Rozwiązanie |
|---|---|---|
| Kontener startuje i od razu się zatrzymuje; logi mówią o `PV_ORIGIN` i "not a valid absolute URL" | `PV_ORIGIN` nie jest pełnym URL-em ze schematem (np. ustawiono samo `example.com` zamiast `https://example.com`) | Ustaw `PV_ORIGIN` jako pełny URL ze schematem i hostem: `PV_ORIGIN=https://vault.example.com` |
| Logi mówią o `PV_ORIGIN` i "must use https://" | `PV_ORIGIN` używa `http://` dla wdrożenia innego niż localhost | Zmień schemat na `https://` — potrzebujesz reverse proxy z TLS przed kontenerem (patrz sekcja wyżej) |
| Logi mówią o `PV_RP_ID` i "must equal PV_ORIGIN's host... or be its registrable parent domain" | `PV_RP_ID` nie pasuje do hosta `PV_ORIGIN` | Ustaw `PV_RP_ID` na dokładnie ten sam host co w `PV_ORIGIN`, albo na jego rodzicielską domenę — np. `PV_RP_ID=example.com` + `PV_ORIGIN=https://vault.example.com` |
| Kontener działa, ale `curl http://<host>:8620/healthz` nic nie zwraca z zewnątrz maszyny | `PV_ADDR` przypadkowo nadpisany na `127.0.0.1:8620` (np. przez ręczną edycję `docker-compose.yml`) | Usuń nadpisanie — obraz domyślnie wiąże się na `0.0.0.0:8620`, co jest wymagane do osiągalności z hosta |
| Po `docker compose down && docker compose up` dane zniknęły | Wolumen `pv_data` nie został użyty (np. uruchomiono `docker run` bez `-v`) | Zawsze uruchamiaj przez `docker compose up` albo jawnie `-v pv_data:/data` — obraz deklaruje `VOLUME /data`, ale nazwany wolumen trzeba utworzyć raz i konsekwentnie podłączać |
| Passkey/PRF ceremonie failują tylko za reverse proxy, działają lokalnie | Brakujące nagłówki upgrade WebSocket albo zły `PV_ORIGIN` względem faktycznego adresu widzianego przez przeglądarkę | Sprawdź konfigurację w `deploy/` (nginx/Caddy) i upewnij się, że `PV_ORIGIN` odpowiada dokładnie temu, co widzi przeglądarka (łącznie ze schematem) |
| Rozszerzenie we Firefoksie pokazuje błąd "CORS Missing Allow Origin" / nie może połączyć się z serwerem mimo że serwer działa | `PV_EXTENSION_ORIGINS` nie zawiera originu tego rozszerzenia (`moz-extension://<uuid>`) | Zobacz sekcję "`PV_EXTENSION_ORIGINS` — CORS dla rozszerzenia przeglądarki" wyżej — dodaj `moz-extension://*` (lub konkretny UUID) do `PV_EXTENSION_ORIGINS` |

## Weryfikacja end-to-end za reverse proxy

Ta sekcja pokrywa ROADMAP.md Phase 7 success criterion #3 — passkey ceremonie
i sync WebSocket muszą przeżyć realny reverse proxy, nie tylko połączenie
bezpośrednio do kontenera.

### Automatyczna: transport + zacieranie logów

```sh
bash scripts/verify-container.sh
```

Buduje obraz, stawia `pv-server` za realnym, zdockeryzowanym nginx **i**
realnym, zdockeryzowanym Caddy (`docker-compose.proxy-test.yml`, overlay nad
`docker-compose.yml` — nigdy osobna, rozjeżdżająca się definicja), rejestruje
jednorazowe konto i loguje się bezpośrednio na `pv-server`, żeby uzyskać
prawdziwy token sesji, po czym asertuje: HTTPS `/healthz` (przez `curl -k` z
nagłówkiem `Host`), kompletny handshake WS `wss://.../api/sync/ws` z tym
prawdziwym tokenem, oraz brak `token=` we własnym logu dostępu każdego z
proxy. Skrypt kończy się kodem różnym od zera i nazywa dokładnie, która
asercja nie przeszła.

HTTPS jest tu osiągane przez jednorazowy, wygenerowany-przez-skrypt
self-signed certyfikat (nginx) i wymuszone `tls internal` w kopii testowej
Caddyfile (Caddy) — żaden z tych mechanizmów nie trafia do
`deploy/nginx.conf.example` ani `deploy/Caddyfile.example`, które pozostają
realistycznymi konfiguracjami produkcyjnymi (prawdziwe certy / prawdziwe
ACME, zgodnie z ich własnymi komentarzami).

To sprawdza wyłącznie warstwę transportu HTTP/WS i logowania — pełna
ceremonia WebAuthn (rejestracja passkeya, PRF unlock) wymaga prawdziwej
przeglądarki + authenticatora i nie da się jej zeskryptować samym
`curl`/`websocat`. Do tego służy manualny krok poniżej.

### Manualna: pełna ceremonia passkey za proxy (Playwright-UAT)

Zgodnie z ustaloną w projekcie konwencją Playwright-UAT (self-walidacja przez
Playwright + jednorazowe konto testowe; zrzuty ekranu tylko dla ocen
smakowych/UX, nie wymagane tutaj — to czysto funkcjonalny check):

1. Wystaw oba proxy razem z `pv-server`:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.proxy-test.yml up -d
   ```
2. Otwórz w realnej przeglądarce zaproxowany adres (np.
   `https://127.0.0.1:8621/` z nagłówkiem `Host: vault.example.com`, albo
   dodaj wpis do `/etc/hosts` żeby uniknąć ręcznego nadpisywania nagłówka).
3. Przejdź pełną rejestrację passkeya + PRF unlock vaulta.
4. Zasymuluj krótką przerwę w sieci (np. DevTools → Network → Offline na
   chwilę) i potwierdź, że sync WebSocket ponownie się łączy po jej
   ustaniu.
5. Powtórz dla drugiego proxy (port 8622 dla Caddy) — obie konfiguracje
   referencyjne muszą przejść ten sam manualny check.
