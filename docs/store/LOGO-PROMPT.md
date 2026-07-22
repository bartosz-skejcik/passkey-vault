# Logo — prompt do ChatGPT (darmowa wersja, generator obrazów)

## Prompt główny (wklej po angielsku — modele obrazkowe działają najlepiej z EN)

```
A minimal flat vector app icon for a password manager called "Passkey Vault".
Design: a rounded-square app icon containing a single friendly symbol — a
simplified keyhole merged with a fingerprint swirl (the fingerprint lines form
the round top of the keyhole). Warm indie aesthetic: creamy off-white
background (#FAF7F0), the symbol in deep teal (#0F766E) with one coral accent
(#F97316) as a small dot or single fingerprint line. Soft 24% corner radius,
very subtle inner shadow, NO text, NO letters, NO gradients heavier than 5%,
no metallic effects. Centered composition with generous padding (symbol takes
~60% of the canvas). Clean thick strokes that stay readable at 16x16 pixels.
Flat design, high contrast, sticker-like simplicity, dribbble-style app icon.
Square 1:1, 1024x1024.
```

## Warianty (jak pierwszy nie siądzie)

- Zamień symbol: `a simplified shield with a passkey circle-and-line symbol
  inside` (passkey ma swój quasi-standardowy glif: kółko + kreska w dół).
- Zamień tła: `deep teal background (#0F766E) with the symbol in warm cream
  (#FAF7F0) and a coral accent` — wersja ciemna często wygląda lepiej w pasku
  narzędzi.
- Dociśnij prostotę: dopisz `as simple as possible, maximum 3 shapes total`.

## Wskazówki

- Proś o **1024×1024** i **bez tekstu** (litery rozjeżdżają się przy 16 px
  i AMO/Google odradzają tekst w ikonie — nie skaluje się i nie tłumaczy).
- Wygeneruj 3–4 podejścia i wybierz to, które czytelnie wygląda ZMNIEJSZONE —
  przetestuj zoom-outem do rozmiaru favicony zanim wybierzesz.
- Kolory celowo spójne z motywem vault-dark/vault-light (teal + coral na
  ciepłym tle — estetyka datafa.st jak w UI-DESIGN.md).

## Co z nim zrobić potem

Wrzuć mi finalny PNG (1024×1024) do repo jako `docs/store/logo-master.png` —
z niego wygeneruję automatycznie:
- ikony manifestu wtyczki: 16/32/48/96/128 px (podmiana placeholderów WXT),
- ikonę store 128×128 (CWS + AMO),
- small promo tile CWS 440×280 (logo + tagline na tle),
- favikonę web appa.
