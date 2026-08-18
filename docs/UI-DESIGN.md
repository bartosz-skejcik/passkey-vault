# UI Design Doc — self-hostable menedżer haseł w estetyce datafa.st

Status: DRAFT do dyskusji. Wartości kolorów/geometrii zweryfikowane z żywego CSS datafa.st (lipiec 2026).

## 1. Kierunek

Ciepły, przyjazny, „indie-maker minimalism" — przeciwieństwo enterprise'owego chłodu 1Password/Dashlane i sterylności Bitwardena. Menedżer haseł, który wygląda jak narzędzie zrobione przez człowieka dla ludzi: duże liczby, dużo powietrza, mało metryk na ekran, odręczne dopiski, emoji w copy. Bezpieczeństwo komunikujemy spokojem i czytelnością, nie czernią i kłódkami.

Zasada nadrzędna: **security UI zawsze czytelne** — Fuzzy Bubbles i emoji tylko w onboardingu, empty states i zachętach; nigdy w treści itemów, dialogach potwierdzeń, modalu odblokowania.

## 2. Design tokens

### Kolory (OKLCH — zweryfikowane z datafa.st)

| Rola | OKLCH | Hex | Użycie u nas |
|---|---|---|---|
| Primary (mandarynka) | `71% 0.1849 42` | **#FD7235** | CTA, aktywne stany, brand |
| Primary content | `26% 0.0926 42` | #421300 | tekst na primary — biały nie przechodzi WCAG 3:1 na nowym primary (2.75:1), #421300 mierzy 5.76:1 |
| Secondary (błękit) | `82.36% 0.0962 242.82` | #8DCDFF | wykresy (linie), linki, info-akcenty |
| Accent (teal) | `74.51% 0.167 183.61` | #00CDB7 | passkey badge, „passwordless" akcenty |
| Base-100 dark (powierzchnia) | `26.86% 0 0` | #262626 | karty |
| Base-200 dark | `24.78% 0 0` | #212121 | sidebar / wtórne tła |
| Base-300 dark (strona) | `23.93% 0 0` | #1F1F1F | tło strony |
| Base-content dark | `89.80% 0.0017 67.80` | #DEDDDC | tekst (ciepła biel) |
| Muted dark | — | #ABA8A7 | tekst wtórny |
| Base-100 light | `100% 0 0` | #FFFFFF | karty |
| Base-200 light (krem) | `98.86% 0.0017 67.80` | #FCFBFA | tło strony |
| Base-content light | `26.86% 0 0` | #262626 | tekst |
| Muted light | — | #595451 | tekst wtórny |
| Success | `64.80% 0.150 160` | #00A96E | silne hasło, brak wycieków |
| Warning | `84.71% 0.199 83.87` | #FFBE00 | hasło stare/powtórzone |
| Error | `71.76% 0.221 22.18` | #FF5861 | wyciek, słabe hasło |
| Info | `72.06% 0.191 231.6` | #00B5FF | neutralne powiadomienia |

Uwaga: nawet szarości mają ~67° ciepły (beżowy) hue — nic nie może być zimno-niebieskie. Dark theme domyślny, light pełnoprawny.

### Semantyka domenowa

- **Passkey = teal (#00CDB7)** — konsekwentnie: badge na itemie, ikona, przycisk „Zaloguj passkeyem".
- **Hasło-health** mapuje się na success/warning/error.
- Koral zarezerwowany dla akcji i brandu, nie dla ostrzeżeń.

### Typografia

- **DM Sans** — całe UI (nagłówki 700+, body 400/500). Nagłówki duże, ciasny leading; hero-liczby (security score, liczba itemów) oversized.
- **Fuzzy Bubbles 400** — wyłącznie adnotacje: strzałka z dopiskiem w onboardingu („tu wklej swój pierwszy login →"), empty states, celebracje („0 wycieków! 🎉").
- Mono (`ui-monospace`) — hasła, kody TOTP, klucze recovery.

### Geometria i elewacja

- Radius: karty/modale **16px** (`1rem`), przyciski/inputy **8px**, badge **pigułki** (1.9rem).
- **1px bordery + stopnie tła zamiast cieni** — płaski, low-elevation look. Separacja powierzchni: #1F1F1F → #212121 → #262626.
- Przyciski: `--btn-focus-scale: 0.95` (lekki „dip" przy kliknięciu), transitions 0.2–0.25s.

## 3. Struktura aplikacji webowej

Layout jak dashboard datafa.st: **lewy sidebar** (vaulty/foldery/tagi + dolny blok konta) + top bar (search „⌘K", przycisk + Nowy item) + główna kolumna.

### Kluczowe ekrany

1. **Unlock / Login** — centralna karta na tle base-300. Dwie równorzędne ścieżki: duży tealowy przycisk **„Odblokuj passkeyem"** (PRF — to nasz wyróżnik, ma być pierwszy) i pole master password poniżej. Zero clutteru.
2. **Vault (lista itemów)** — wiersze-karty: favicon, nazwa, username, badge typu (Hasło / **Passkey** teal / Karta / Notatka / TOTP), wskaźnik health jako kolorowa kropka. Gęstość niska, hover = subtelne 6% white.
3. **Item detail** — panel boczny (nie osobna strona): pola z copy-buttonem, sekcja passkey (RP ID, data utworzenia, „ostatnio użyty"), TOTP z odliczającym pierścieniem w kolorze koralowym, historia haseł, załączniki.
4. **Security dashboard („Health")** — tu w pełni gra estetyka datafa.st: **wielki hero-score** (np. 87/100) + sparkline'y w stylu ich wykresów (siatka `rgba(82,82,82,.5)`, ticki `hsla(0,0%,64%,.8)`, crosshair #777, hover-kolumna 6% white). Kafle: słabe / powtórzone / stare / wycieki. Wykres „logowania w czasie": linie błękitne, zdarzenia koralowe słupki.
5. **Breach monitor** — lista monitorowanych maili, status per mail, timeline wycieków.
6. **Sharing** — itemy udostępnione + generator zaszyfrowanych linków z expiry (odpowiednik NordPass links / BW Sends).
7. **Settings / Admin** — konta, enrolled passkeys (z wyraźnym ostrzeżeniem recovery przy usuwaniu!), eksport/import (CXF!), SSO, SMTP.
8. **Onboarding** — 3 kroki, adnotacje Fuzzy Bubbles, import z Bitwarden/NordPass/CXF jako pierwszy krok.

### Rozszerzenie przeglądarkowe (popup)

Ta sama paleta i geometria, szerokość ~360px: search na górze, itemy dopasowane do bieżącej domeny, duży przycisk autofill. **Dialog przechwycenia passkey** (create/get) — nasz najważniejszy moment UX: karta z favicon strony, nazwa RP, wybór konta, teal przycisk potwierdzenia; opcja „użyj natywnego" (fall-through do przeglądarki) zawsze widoczna.

## 4. Ton i mikrocopy

Founder-voice, bez korpomowy: „Twoje hasła, Twój serwer", „0 wycieków 🎉", „To hasło ma 4 lata — czas na emeryturę". Emoji w nagłówkach sekcji i pustych stanach, nigdy w alertach bezpieczeństwa.

## 5. Implementacja

**Tailwind v4 + DaisyUI 5 z custom theme** (najwierniejsze odtworzenie — datafa.st to dokładnie ten stack). shadcn/ui tylko jeśli okażą się potrzebne prymitywy Radix; wtedy przenosimy te same tokeny.

```css
@import "tailwindcss";
@plugin "daisyui";

@plugin "daisyui/theme" {
  name: "vault-dark";
  default: true;
  color-scheme: dark;
  --color-primary: oklch(71% 0.1849 42);
  --color-primary-content: oklch(26% 0.0926 42);
  --color-secondary: oklch(82.36% 0.0962 242.82);
  --color-accent: oklch(74.51% 0.167 183.61);
  --color-neutral: oklch(42.02% 0 0);
  --color-base-100: oklch(26.86% 0 0);
  --color-base-200: oklch(24.78% 0 0);
  --color-base-300: oklch(23.93% 0 0);
  --color-base-content: oklch(89.80% 0.0017 67.80);
  --color-info: oklch(72.06% 0.191 231.6);
  --color-success: oklch(64.80% 0.150 160);
  --color-warning: oklch(84.71% 0.199 83.87);
  --color-error: oklch(71.76% 0.221 22.18);
  --radius-box: 1rem;
  --radius-field: 0.5rem;
  --radius-selector: 1.9rem;
  --border: 1px;
}
```

Light theme: `base-100: oklch(100% 0 0)`, `base-200: oklch(98.86% 0.0017 67.80)`, `base-content: oklch(26.86% 0 0)`.

Fonty (next/font): `DM_Sans` jako `--font-sans`, `Fuzzy_Bubbles` (400) jako `--font-hand`.

Wykresy: Recharts z tokenami `--chart-grid: rgba(82,82,82,.5)`, `--chart-tick: hsla(0,0%,64%,.8)`, `--chart-cursor: hsla(0,0%,100%,.06)`, cursor-line #777.

## 6. Otwarte pytania designowe

1. Nazwa i logo produktu (wpływa na landing i extension store).
2. Czy popup rozszerzenia dziedziczy dark/light z systemu czy z ustawień vaulta?
3. Ile „playfulness" w wersji Business/team (jeśli kiedyś będzie) — ton indie może wymagać stonowania.
