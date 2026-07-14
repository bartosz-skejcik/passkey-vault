# passkey-vault (nazwa robocza)

Darmowy, self-hostable menedżer haseł z first-class passkeys:
**passkey provider** (logowanie do cudzych stron) + **PRF vault unlock**
(odblokowanie vaulta passkeyem). UI w estetyce datafa.st.

Dokumentacja projektowa: [`docs/`](docs/) — RESEARCH.md, UI-DESIGN.md, ARCHITECTURE.md.

## Struktura

| Ścieżka | Co |
|---|---|
| `crates/pv-core` | Współdzielony core kryptograficzny (hierarchia kluczy, PRF unlock, szyfrowanie itemów). Kompilowalny do WASM — ten sam kod w web app i rozszerzeniu. |
| `crates/pv-server` | Serwer (axum + SQLx/SQLite + webauthn-rs). |
| `web/` | Web app (Next.js, Tailwind v4 + DaisyUI 5) — TODO |
| `extension/` | Rozszerzenie przeglądarkowe (WXT, MV3) — TODO |
| `docs/SELF-HOSTING.md` | Self-hosting quickstart: `docker compose up`, konfiguracja, backup, troubleshooting. |

## Self-hosting

```sh
docker compose up -d
```

Zobacz [`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) po pełną instrukcję.

## Dev

```sh
cargo check            # cały workspace
cargo run -p pv-server # serwer na :8620
```

Licencja: AGPL-3.0-only (robocza — do potwierdzenia).
