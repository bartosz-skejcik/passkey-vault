# Phase 6: Import/Export, TOTP & Onboarding - Research

**Researched:** 2026-07-14
**Domain:** Client-side CSV/JSON import-export pipelines, RFC 6238 TOTP generation over a Rust/WASM crypto core, first-run onboarding wizard
**Confidence:** HIGH (TOTP crate/API verified by local wasm32 build; import/export CSV column formats MEDIUM — third-party formats drift; onboarding UI taste flagged for morning review per CONTEXT.md)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1: TOTP as a first-class item type & crypto path**
- TOTP is its own `ItemType`, not a field bolted onto `login` — `web/src/lib/vault/types.ts`'s `ItemType` union grows a fifth member: `"totp"`. Fields: `{ type: "totp", name, secret (base32), issuer?, algorithm?, digits?, period?, folderId, tags }` with RFC 6238 defaults (SHA1, 6 digits, 30s period) applied when a source format doesn't specify them.
- TOTP code computation goes through pv-core → pv-wasm, not a standalone JS library — add `totp-rs` to `pv-core` with `default-features = false` and only the `otpauth` feature enabled — explicitly not the `qr`/`gen_secret`/`steam` features. `pv-wasm` exposes a pure, stateless `totp_now(secret, algorithm, digits, period, unix_time_seconds) -> { code, seconds_remaining }` — takes the current time as an explicit parameter rather than reading the clock inside WASM.
- Live countdown ticks client-side via `setInterval` (~1s), recomputing through the WASM export each tick — no server involvement, no push channel. Detail-panel ring color is coral (`--color-primary`, `#E16540`) per `docs/UI-DESIGN.md` §3.3 — not teal.
- A TOTP item is a standalone item, never implicitly linked to a login item — no foreign keys between items. When an imported source row bundles a TOTP secret onto a login record, the importer creates a *second*, separate TOTP item named after the same login, same folder/tags copied across.

**Area 2: Import pipeline — parsing, mapping, execution**
- CSV parsing uses a small dedicated library (`papaparse`), not a hand-rolled parser — first new npm dependency this phase.
- One shared `ImportWizard` component, invoked from two call sites (Settings → Import/Export tab and Onboarding step 1): (1) file drop/select, (2) auto-detect source format from file extension + header/shape sniffing, (3) preview table of parsed rows mapped to our item fields, with a manual column-mapping UI surfaced whenever auto-detection doesn't recognize the header set (this *is* IMPEX-03's generic-CSV path), (4) sequential per-item `encryptItem` + `POST /api/vault/items` with a progress bar. No new server endpoint — the existing single-item `POST /api/vault/items` is reused in a loop.
- Per-tool CSV column mappers are static lookup tables, not a generic heuristic engine — one small mapper module per source (`bitwardenCsv.ts`, `nordpassCsv.ts`, `onePasswordCsv.ts`, `lastpassCsv.ts`, `keepassCsv.ts`) each exporting a fixed `{ ourField: sourceColumnName }` table plus a `detect(headers): boolean`. KeePass CSV export (File → Export → "CSV File") is the supported IMPEX-02 path.
- Row-level fault tolerance, not all-or-nothing — a malformed/unparseable row is skipped and counted, not fatal to the whole import; final screen reports `"Imported 42 of 45 — 3 skipped"` with an expandable reason list. No dedup against existing vault items in v0.1.

**Area 3: Export pipeline**
- Export format is our own generic schema, not Bitwarden-compatible. JSON export: `{ "exportedAt": ISO8601, "items": [ { type, name, ...type-specific fields }, ... ], "folders": [...] }`.
- CSV export is a single flat file with a `type` column, blank cells for inapplicable fields — one row per item, superset of columns across all 5 types (`name, type, username, password, urls, cardholderName, number, expiry, cvv, firstName, lastName, email, phone, address, secret, notes, folder, tags`).
- Passkey sub-records are never exported — omitted entirely, plaintext-warning dialog copy notes this explicitly.
- Plaintext warning is a confirmation dialog before the download fires, reusing `DeleteConfirmDialog`'s sober security-UI treatment. Download itself is a client-side `Blob` + `<a download>` (no server round-trip).

**Area 4: Onboarding wizard (UI-04)**
- Three concrete steps: Step 1 — Import (the `ImportWizard`, with a prominent "Skip for now"); Step 2 — "Poznaj swój vault"/"Meet your vault" (PRF passkey unlock teaser + auto-lock/clipboard-clear orientation, no new functionality); Step 3 — Finish (calm confirmation screen dismissing into the normal app).
- Triggers once, immediately after registration succeeds; never forced on returning users — a `localStorage` flag (`pv-onboarding-complete`) set on wizard dismissal (via finish OR explicit skip-to-end) gates it. Re-accessible later only indirectly via Settings → Import/Export.
- Rendered as a distinct full-screen modal wizard, not the existing z-40 drawer+scrim pattern — first-run, celebratory, higher-chrome moment (Fuzzy Bubbles annotations, step dots/progress), echoing `UnlockOverlay`'s blur treatment. **Flagged for morning review**: exact modal chrome/step-indicator styling is Claude's taste call, not pixel-locked.
- Step 1's import UI inside the wizard is the same full `ImportWizard`, not a stripped-down subset — including the manual-column-mapping screen. "Skip" is available at the file-select screen only.

### Claude's Discretion
- Exact `totp-rs` version pin and wasm32 build verification (confirm no incompatible transitive dep before locking the dependency).
- Exact per-tool CSV column-name tables (Bitwarden/NordPass/1Password/LastPass/KeePass) — verify against each tool's actual current export format at plan/implementation time rather than trusting memory; format drift is plausible.
- Component decomposition of `ImportWizard`/export flow, exact progress-bar/error-list UI, migration/test structure, i18n key naming — all within established codebase conventions.
- Whether TOTP's `algorithm`/`digits`/`period` are exposed as advanced fields in the manual-add form (behind a collapsed "Advanced" toggle) or fully hidden with RFC 6238 defaults and only settable via import — leaning toward the collapsed-advanced-toggle.

### Deferred Ideas (OUT OF SCOPE)
- FIDO CXF import/export (CXF-01) — v0.4+, deferred; `credential-exchange-format` crate not touched this phase.
- Dedup-on-import (fuzzy-match existing vault items against incoming rows) — explicitly deferred past v0.1.
- QR-code scanning to add a TOTP secret — no requirement drives it; totp-rs's `qr` feature deliberately left disabled.
- Bulk/transactional server-side import endpoint — the existing single-item POST loop is judged sufficient at self-host scale.
- Server-tracked onboarding-completion state (vs. the chosen per-browser localStorage flag) — not justified for v0.1.
- Password-history / attachments sections mentioned in `docs/UI-DESIGN.md`'s item-detail screen sketch — out of this phase's requirement set.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VAULT-07 | Użytkownik widzi kody TOTP generowane z sekretu itemu (totp-rs w pv-core/WASM), z odliczaniem ważności | Standard Stack (`totp-rs` 5.7.2, verified wasm32 build), Pattern 1 (`totp_now` WASM export), Pitfall 1 (`generate()` vs `generate_current()`), Code Examples (DaisyUI radial-progress ring) |
| IMPEX-01 | Użytkownik może zaimportować vault z Bitwardena (JSON i CSV) — przetwarzanie w całości klientowe | Architecture Patterns (import flow diagram), Bitwarden JSON/CSV schema findings (Sources: Secondary), Pattern 4 (otpauth value parsing for `login.totp`) |
| IMPEX-02 | Użytkownik może zaimportować dane z NordPass, 1Password, LastPass i KeePass (ich formaty eksportu CSV) — mappery kolumn per narzędzie | Pattern 3 (per-tool mapper module shape), per-tool CSV column findings (Sources: Secondary/Tertiary), Pitfall 3 (KeePass vs KeePassXC divergence), Pitfall 4 (format-drift risk), Assumptions A1/A2 |
| IMPEX-03 | Użytkownik może zaimportować generyczny CSV/JSON z ręcznym mapowaniem kolumn | Architecture Patterns (manual column-mapping fallback in the import flow diagram), Recommended Project Structure (`genericMapping.ts`) |
| IMPEX-04 | Użytkownik może wyeksportować cały vault do generycznego JSON i CSV (odszyfrowanie klientowe, z ostrzeżeniem o plaintext) | Architecture Patterns (export flow diagram), Code Examples (`Papa.unparse`, Blob download), Security Domain (plaintext-warning threat pattern) |
| UI-04 | Onboarding (3 kroki) z importem z innego menedżera jako pierwszym krokiem | Recommended Project Structure (`onboarding/` components), Integration point (RegisterForm's `onAuthed` closure verified in codebase read) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Deployment:** single Docker container, SQLite on a volume — this phase adds zero server routes/migrations, consistent with this constraint (import/export/TOTP are 100% client-side; TOTP is just another `fields.type` value inside the existing opaque `enc_data` blob).
- **Tech stack:** Rust (axum + SQLx) server; `pv-core` shared via WASM; Next.js 15+/Tailwind v4/DaisyUI 5 frontend — `totp-rs` goes into `pv-core` (not a standalone JS TOTP library), `papaparse` goes into `web/` only.
- **Crypto:** libsodium-style primitives, zero-knowledge absolute — TOTP secrets are stored inside the same per-item AEAD envelope as every other field; no new plaintext-touching server code path.
- **Design:** datafa.st aesthetic (OKLCH tokens, DM Sans + Fuzzy Bubbles, 1px borders); security UI always legible — the export plaintext-warning dialog must stay in the sober/no-emoji register even though the onboarding wizard around it is allowed Fuzzy Bubbles per `docs/UI-DESIGN.md` §1/§4.
- **Solo indie / pragmatic scope:** no bulk-import server endpoint, no dedup engine, no QR scanning — all explicitly deferred per CONTEXT.md, consistent with avoiding enterprise scope creep.
- **"No new crypto paths outside pv-core"** (established Phase 2, reaffirmed every phase since): binding on Area 1's `totp-rs`-in-pv-core decision — the planner must not permit a JS-side TOTP fallback/reimplementation.
- **i18n PL+EN dictionary entries for every new string** (`web/src/lib/i18n/dictionary.ts`): this phase adds the largest single batch yet (per-tool import copy, onboarding step copy, export warning copy, TOTP field labels) — every plan task touching UI copy must include dictionary entries in both languages.
- **Comments mix Polish and English; module-level `//!` docs; 4-space Rust indentation; `#[cfg(test)] mod tests` convention** — `crates/pv-core/src/totp.rs` should follow the exact structure of `crates/pv-core/src/prf.rs`/`items.rs` (module doc, small focused functions, `Zeroize`/`ZeroizeOnDrop` where secret bytes are handled transiently — note `totp-rs`'s own `Secret` enum already implements `Zeroize`).

## Summary

Phase 6 adds no new server surface — everything is a client-side pipeline built on top of Phase 2's existing single-item `POST/PUT /api/vault/items` calls and the `encryptItem`/`decryptItem` WASM choke-point. Two genuinely new pieces of technical risk exist: (1) a **fifth crypto path** — `totp-rs` compiled into `pv-core`/`pv-wasm` to generate RFC 6238 codes from a stored base32 secret, and (2) a **first new npm dependency** — `papaparse` for RFC 4180-correct CSV parsing in the browser. Both were independently verified this session: `totp-rs` 5.7.2 with `default-features = false, features = ["otpauth"]` was built locally against `wasm32-unknown-unknown` and compiles cleanly with zero `getrandom`/`chrono`/`time` transitive dependencies (the one dependency worth flagging is the `url` crate, pulled in for `otpauth://` parsing, which drags a sizeable ICU/IDNA subtree — acceptable but not free). `papaparse` 5.5.4 has zero runtime dependencies, a 2014-era GitHub history, and 10M+/week downloads — the automated package-legitimacy check mis-flags it `SUS`/"too-new" because it reads the *latest release* date, not first-publish date; this is a documented false positive, not a real risk signal.

The rest of the phase is UI/data-shaping work over already-established patterns: `ItemType` grows a fifth `"totp"` member exactly like the prior four, CSV column mapping is five small static lookup tables (one per source tool) feeding a shared preview/mapping screen, and export is a client-side `Blob` download with no server round-trip. The one format-research surprise worth flagging to the planner: **KeePass's own CSV export has no TOTP column** (`Group,Title,Username,Password,URL,Notes` only) — only KeePassXC's newer CSV export adds a `TOTP` column. CONTEXT.md's IMPEX-02 mapper set should treat these as two distinct, if similar, column tables, or explicitly document that a stock-KeePass CSV import will never carry a TOTP secret (KeePassXC's will).

**Primary recommendation:** Add `totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }` to `pv-core`, expose a pure `totp_now(secret_b32, algorithm, digits, period, unix_time_seconds) -> {code, seconds_remaining}` from `pv-wasm` that always calls `TOTP::generate(time)` (never `generate_current()`, which internally calls `SystemTime::now()` — unimplemented/panics on `wasm32-unknown-unknown`), add `papaparse` as `web/package.json`'s first new runtime dependency for CSV parsing, and build the import/export pipeline as a pure client-side loop around the existing `createVaultItem`/`encryptItem` primitives — no new server routes, no new crypto choke-points beyond the one WASM export.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TOTP code computation (RFC 6238 HMAC) | Crypto core (pv-core → pv-wasm) | — | "No new crypto paths outside pv-core" convention (Phase 2, reaffirmed every phase); zero-knowledge irrelevant here (read-only derived value) but choke-point discipline still applies |
| TOTP live countdown UI | Browser / Client | — | Pure `setInterval` re-render, no server involvement; matches VAULT-06 clipboard-clear's existing "client-owned timer" precedent |
| CSV/JSON parsing (import) | Browser / Client | — | IMPEX-01 explicit "przetwarzanie w całości klientowe" — plaintext never leaves the browser before encryption |
| Column mapping / format detection | Browser / Client | — | Static lookup tables per source tool; pure data transform, no crypto, no network |
| Per-item encrypt + write (import) | Browser / Client (encrypt) → API / Backend (storage only) | — | Reuses Phase 2's `encryptItem` + `POST /api/vault/items` exactly; server only ever receives ciphertext |
| Export file generation | Browser / Client | — | Client-side `Blob` + `<a download>`; static-export/no-SSR constraint already forbids server-side file generation |
| Onboarding wizard state | Browser / Client (localStorage) | — | Pure UX orientation, no security implication (explicitly not server-tracked per CONTEXT.md) |
| Vault item storage (opaque blob) | API / Backend | Database / Storage | No schema change needed — TOTP is just another `fields.type` value inside the existing `enc_data` blob (Phase 2's model already covers a 5th type for free) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `totp-rs` | 5.7.2 `[VERIFIED: crates.io + local wasm32 build]` | RFC 6238 TOTP code generation, `otpauth://` URI parsing | Most-downloaded pure-Rust TOTP crate (216K/week per crates.io), MIT-licensed, actively maintained since 2020, zero I/O by default |
| `papaparse` | 5.5.4 `[VERIFIED: npm registry, zero runtime deps]` | RFC 4180-correct CSV parsing (quoted commas, embedded newlines, BOM, CRLF) | De facto standard browser CSV parser; zero dependencies, well-established (2014+), no build-step/native deps — bundles cleanly into a static export |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `base32` (transitive, via `totp-rs`'s `otpauth`/`Secret::Encoded` path) | 0.5.1 `[VERIFIED: cargo tree]` | Decodes a base32 TOTP secret string to raw bytes | Automatically pulled in — do not add a separate `base32` direct dependency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `totp-rs` | Hand-rolled HMAC-SHA1/256 + Base32 in TS via WebCrypto | Rejected by CONTEXT.md's locked decision — "no new crypto paths outside pv-core"; would also duplicate HMAC/SHA logic already available via `sha2`/`hmac` in pv-core's dependency graph |
| `totp-rs` | `otpauth` crate (0.2.4, appeared in search results) | Smaller/less maintained, no `otpauth://` URI parsing needed for the import path's embedded-secret case; `totp-rs`'s `otpauth` feature already covers this |
| `papaparse` | Hand-rolled `.split(",")` CSV parser | Explicitly rejected in CONTEXT.md — RFC 4180 edge cases (quoted commas, embedded newlines, BOM) silently corrupt real user passwords; this is exactly the class of bug a hand-rolled parser produces |
| `papaparse` | `csv-parse` (Node-oriented) | Heavier, Node-stream-oriented API; `papaparse` is purpose-built for in-browser `File`/`Blob` parsing (`Papa.parse(file, {...})` with a `worker: true` option), better fit for a static-export client-only app |

**Installation:**
```bash
# Rust side (pv-core/Cargo.toml)
# [dependencies]
# totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }

# Web side
cd web && npm install papaparse@5.5.4
npm install -D @types/papaparse
```

**Version verification:** `totp-rs` version confirmed via `cargo info totp-rs` (5.7.2, published against crates.io, MIT, `rust-version: 1.66` — well under the project's stable toolchain). `papaparse` confirmed via `npm view papaparse version` (5.5.4) and `npm view papaparse time.created`/`time.modified` (created 2014-11-19, latest release 2026-06-19 — actively maintained, not stale).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `totp-rs` | crates.io | First published 2020-04-13 (~6 yrs) | ~216K/week | `github.com/constantoine/totp-rs` | `[OK]` | Approved |
| `papaparse` | npm | First published 2014-11-19 (~11 yrs); latest release 2026-06-19 | ~10.3M/week | `github.com/mholt/PapaParse` | `[SUS]` (seam) → `[OK]` (human override, see below) | Approved with checkpoint |

**Packages removed due to `[SLOP]` verdict:** none.

**Packages flagged as suspicious `[SUS]`:** `papaparse` — the automated `package-legitimacy check` seam flagged it with reason `"too-new"`. This is a **verified false positive**: the seam's `publishedAt` signal reflects the *most recent release's* publish date (2026-06-19, i.e. days before this research), not the package's first-publish date. Independently confirmed via `npm view papaparse time.created` = 2014-11-19 and `npm view papaparse time.modified` = 2026-06-19 (11+ years of history, not a brand-new package), plus 10.3M weekly downloads and zero runtime dependencies. Per the Package Legitimacy Protocol, the planner **must still insert a `checkpoint:human-verify` task** before the `npm install papaparse` step — treat it as a formality confirming this documented reasoning, not a real red flag requiring re-investigation.

## Architecture Patterns

### System Architecture Diagram

```text
IMPORT FLOW (client-only, no plaintext ever crosses the network)
──────────────────────────────────────────────────────────────
[File drop/select]
        │
        ▼
[Format sniff: extension + header/shape match]──▶ known format (Bitwarden JSON/CSV,
        │                                          NordPass/1Password/LastPass/
        │ no match                                 KeePass CSV)
        ▼                                                  │
[Manual column-mapping UI] ◀─────────────────────────────────┘
        │
        ▼
[Papa.parse() → raw rows]  (CSV path)  /  [JSON.parse() → raw objects]  (JSON path)
        │
        ▼
[Per-tool mapper: row → ItemFields draft]
   - Bitwarden login.totp / CSV login_totp → separate standalone TOTP item
   - malformed row → skipped + counted, never fatal
        │
        ▼
[Preview table: N rows mapped, M skipped]
        │
        ▼  (user confirms)
   for each row:
        │
        ▼
   [encryptItem(uk, JSON.stringify(fields), id, 1)]   ◀── WASM choke-point, same as
        │                                                  createVaultItem's existing path
        ▼
   [POST /api/vault/items]  (existing single-item endpoint, looped)
        │
        ▼
   [Progress bar: N / total imported] → [Done: "Imported 42 of 45 — 3 skipped"]


EXPORT FLOW (client-only, no server round-trip for file generation)
──────────────────────────────────────────────────────────────
[In-memory decrypted VaultItem[]/Folder[] (already held by store.ts)]
        │
        ▼
[Filter out passkey sub-records — never exported]
        │
        ▼
[Plaintext warning confirmation dialog] (DeleteConfirmDialog-style, sober UI)
        │  (user confirms)
        ▼
[Serialize: JSON (direct VaultItem[] shape) | CSV (flat, superset columns via Papa.unparse)]
        │
        ▼
[Blob + <a download>] — no fetch(), no server involvement


TOTP LIVE CODE (read-only, per rendered item)
──────────────────────────────────────────────────────────────
[DetailPanel/ItemRow renders a "totp" item]
        │
        ▼
[setInterval(~1s)] ──▶ [pv-wasm totp_now(secret_b32, algo, digits, period, Date.now()/1000)]
        │                        │  (pure function: TOTP::generate(time) — never generate_current())
        ▼                        ▼
[6-8 digit code]         [seconds_remaining for coral ring]
```

### Recommended Project Structure
```
crates/pv-core/src/
├── totp.rs              # NEW: thin wrapper around totp-rs's TOTP::generate(time)/from_url
crates/pv-wasm/src/lib.rs # + totp_now export (pure data, not an opaque handle)

web/src/lib/vault/
├── types.ts              # ItemType grows "totp"; new TotpFields interface
├── importers/
│   ├── detect.ts          # format sniffing (extension + header/shape)
│   ├── bitwardenJson.ts
│   ├── bitwardenCsv.ts
│   ├── nordpassCsv.ts
│   ├── onePasswordCsv.ts
│   ├── lastpassCsv.ts
│   ├── keepassCsv.ts      # covers KeePassXC's TOTP column too; document the gap for stock KeePass
│   └── genericMapping.ts  # manual column-mapping fallback (IMPEX-03)
├── exporters/
│   ├── toJson.ts
│   └── toCsv.ts

web/src/components/vault/
├── ImportWizard.tsx        # shared: Settings tab + Onboarding step 1
├── ImportWizard.*.tsx      # sub-steps (file select, preview/map, progress, done)
├── ExportDialog.tsx        # plaintext-warning confirmation + trigger
├── TotpCountdownRing.tsx   # coral radial-progress, used by DetailPanel + ItemRow

web/src/components/onboarding/
├── OnboardingWizard.tsx    # full-screen takeover, 3 steps
├── OnboardingStep1Import.tsx  # wraps ImportWizard
├── OnboardingStep2MeetVault.tsx
├── OnboardingStep3Finish.tsx

web/src/lib/onboarding/
├── flag.ts                 # pv-onboarding-complete localStorage read/write (mirrors autolock.ts pattern)
```

### Pattern 1: WASM-side pure TOTP export (no opaque handle needed)
**What:** Unlike `WasmUserKey`/`WasmWrappingKey`, TOTP's secret is not root key material — it's a per-item stored value the client already holds in plaintext once the item is decrypted. `totp_now` therefore takes the secret as a plain string parameter and returns plain data, following the same "pure/testable, explicit time parameter" pattern the codebase already established for `deriveAuthMaterial`.
**When to use:** Any read-only derived value where no secret needs to survive across the WASM boundary as a handle.
**Example:**
```rust
// Source: verified locally (cargo build --target wasm32-unknown-unknown --release), pattern
// mirrors crates/pv-wasm/src/lib.rs's existing to_js_err/to_js_str_err split.
use totp_rs::{Algorithm, Secret, TOTP};

#[wasm_bindgen(js_name = totpNow)]
pub fn totp_now(
    secret_b32: &str,
    algorithm: &str,   // "SHA1" | "SHA256" | "SHA512"
    digits: usize,
    period: u64,
    unix_time_seconds: u64,
) -> Result<JsValue, JsValue> {
    let algo = match algorithm {
        "SHA256" => Algorithm::SHA256,
        "SHA512" => Algorithm::SHA512,
        _ => Algorithm::SHA1,
    };
    let secret_bytes = Secret::Encoded(secret_b32.to_string())
        .to_bytes()
        .map_err(|_| to_js_str_err("invalid base32 TOTP secret"))?;
    let totp = TOTP::new(algo, digits, 1, period, secret_bytes)
        .map_err(|_| to_js_str_err("invalid TOTP parameters"))?;
    // NEVER totp.generate_current()/check_current() — SystemTime::now() is
    // unimplemented on wasm32-unknown-unknown (panics at runtime). Always
    // pass an explicit time from JS's Date.now().
    let code = totp.generate(unix_time_seconds);
    let seconds_remaining = period - (unix_time_seconds % period);
    // Return a small struct; wasm-bindgen serializes via serde as usual
    // elsewhere in this file (see encrypt_item's JSON-string pattern) —
    // either return a JSON string (consistent with the rest of this file)
    // or a small #[wasm_bindgen] struct with getters. JSON string is the
    // more consistent choice given every other export in this file.
    serde_json::to_string(&serde_json::json!({
        "code": code,
        "secondsRemaining": seconds_remaining
    }))
    .map(JsValue::from_str)
    .map_err(|e| to_js_str_err(&e.to_string()))
}
```

### Pattern 2: TotpFields as a fifth ItemType (additive, matches existing switch shape)
**What:** Add `"totp"` to the `ItemType` union and a `TotpFields` interface following the exact shape of `CardFields`/`IdentityFields`.
**When to use:** `web/src/lib/vault/types.ts`, `TypePicker.tsx`'s `TILES`, `ItemForm.tsx`'s `emptyFieldsFor` switch, `DetailPanel.tsx`'s `FIELD_ORDER` map.
**Example:**
```typescript
// Source: pattern from web/src/lib/vault/types.ts (existing CardFields/IdentityFields)
export interface TotpFields extends CommonFields {
  type: "totp";
  secret: string;              // base32, required
  issuer: string;               // optional in UI, "" if absent
  algorithm: "SHA1" | "SHA256" | "SHA512"; // RFC 6238 default: SHA1
  digits: number;               // default: 6
  period: number;                // default: 30
  notes: string;
}

export type ItemFields = LoginFields | CardFields | IdentityFields | NoteFields | TotpFields;
```
Note: `FIELD_ORDER` in `DetailPanel.tsx` maps `key -> t("field.${key}")` for plain string fields — `secret`/`algorithm`/`digits`/`period` don't fit that generic string-value loop (the live code + ring is a bespoke render, not a labeled field), so DetailPanel needs a TOTP-specific branch analogous to the existing `item.fields.type === "login" ? <PasskeyPlaceholderSection /> : null` pattern, not a `FIELD_ORDER` entry.

### Pattern 3: CSV import mapper module shape (static table + detect())
**What:** One small module per source tool, each exporting a fixed column-name table and a `detect(headers: string[]): boolean`.
**When to use:** `web/src/lib/vault/importers/*.ts`
**Example:**
```typescript
// Source: pattern derived from CONTEXT.md's locked Area 2 decision + verified
// LastPass CSV header (websearch, MEDIUM confidence — see Sources)
export const LASTPASS_CSV_COLUMNS = {
  name: "name",
  username: "username",
  password: "password",
  urls: "url",           // single URL column -> wrapped into urls: [url]
  totpSecret: "totp",    // may be empty, a bare base32 secret, or an otpauth:// URI
  notes: "extra",
  folder: "grouping",    // backslash-delimited path; v0.1 takes only the first segment
} as const;

export function detect(headers: string[]): boolean {
  const required = ["url", "username", "password", "extra", "name", "grouping", "fav"];
  return required.every((h) => headers.includes(h));
}
```

### Pattern 4: otpauth:// URI as a TOTP-secret source, not just a display format
**What:** Several import sources (Bitwarden's `login.totp`, some CSV `totp` columns) may contain either a bare base32 secret OR a full `otpauth://totp/...?secret=...&issuer=...` URI. The importer must detect which shape it received before constructing `TotpFields`.
**When to use:** Any importer mapping a `totp`/`login_totp` source column.
**Example:**
```typescript
// Source: otpauth URI format verified via websearch (Google Authenticator Key
// URI Format wiki), MEDIUM confidence
function parseTotpValue(raw: string): { secret: string; issuer: string; algorithm: string; digits: number; period: number } | null {
  if (!raw) return null;
  if (raw.startsWith("otpauth://")) {
    const url = new URL(raw);
    const secret = url.searchParams.get("secret");
    if (!secret) return null;
    return {
      secret,
      issuer: url.searchParams.get("issuer") ?? "",
      algorithm: (url.searchParams.get("algorithm") as "SHA1" | "SHA256" | "SHA512") ?? "SHA1",
      digits: Number(url.searchParams.get("digits") ?? 6),
      period: Number(url.searchParams.get("period") ?? 30),
    };
  }
  // Bare base32 secret, RFC 6238 defaults apply.
  return { secret: raw, issuer: "", algorithm: "SHA1", digits: 6, period: 30 };
}
```

### Anti-Patterns to Avoid
- **Calling `TOTP::generate_current()`/`check_current()` from pv-wasm:** these call `SystemTime::now()` internally, which is unimplemented on `wasm32-unknown-unknown` (no OS clock) and will panic at runtime in the browser — even though the crate compiles fine (the panic is runtime-only, invisible until exercised in-browser). CONTEXT.md's locked decision to take `unix_time_seconds` as an explicit parameter from `Date.now()` on the JS side is the correct and only safe pattern; do not "simplify" this later.
- **Trusting a source tool's CSV column names to be stable across versions:** all five per-tool tables in this research are `[CITED: websearch]`/MEDIUM confidence, not `[VERIFIED]` — CONTEXT.md's own "Claude's Discretion" section flags this ("format drift is plausible"). The planner should size a task for re-verifying each table against a real, current export sample if possible, and the row-level fault-tolerance design (skip + count, never fatal) is the correct mitigation for any single stale column name.
- **A bulk/transactional import endpoint:** explicitly deferred (CONTEXT.md) — the existing single-item `POST` in a loop is correct for this phase's scope; do not introduce new server routes.
- **Treating KeePass and KeePassXC CSV exports as the same format:** stock KeePass 2.x's own CSV export has no `TOTP` column at all; only KeePassXC (a different, cross-platform fork) added one. A `keepassCsv.ts` mapper that assumes a `TOTP` column will silently produce empty imports from real KeePass users' files unless it degrades gracefully (missing column → import proceeds without TOTP, not a fatal error).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RFC 6238 TOTP code generation | Custom HMAC-SHA1 + dynamic truncation in TypeScript via WebCrypto | `totp-rs` in pv-core → pv-wasm | Locked by CONTEXT.md's "no new crypto paths outside pv-core" convention; a TS reimplementation would be a second, independently-auditable crypto surface for a security-sensitive value |
| CSV parsing (RFC 4180 edge cases) | `.split(",")` / regex-based parser | `papaparse` | Quoted commas, embedded newlines/quotes, BOM, CRLF-vs-LF handling is exactly the kind of correctness surface where a hand-rolled parser silently corrupts a user's real password data — this is CONTEXT.md's own explicit rationale |
| Base32 decode of TOTP secrets | Hand-rolled base32 decoder | `totp-rs`'s `Secret::Encoded(...).to_bytes()` (transitively uses the `base32` crate) | Already included transitively — no separate dependency or hand implementation needed |
| otpauth:// URI parsing | Manual query-string splitting | Browser's built-in `URL`/`URLSearchParams` (client-side, JS layer) for import mapping; `totp-rs`'s `TOTP::from_url()` (Rust layer) if URI parsing is ever needed inside pv-core itself | `URL`/`URLSearchParams` already correctly handles percent-encoding in the `issuer`/label parts; don't reimplement |

**Key insight:** This phase's two "don't hand-roll" items (TOTP crypto, CSV parsing) are both explicitly named in CONTEXT.md as deliberate, justified exceptions to the codebase's normally-minimal-dependencies discipline — the planner should treat both additions as pre-approved, not as decisions to re-litigate.

## Common Pitfalls

### Pitfall 1: `SystemTime::now()` panics on `wasm32-unknown-unknown`
**What goes wrong:** Code compiles fine, then panics the moment `TOTP::generate_current()` or `TOTP::check_current()` actually executes in the browser.
**Why it happens:** `wasm32-unknown-unknown` has no OS clock; `std::time::SystemTime`/`Instant` are `unimplemented!()` on that target unless bridged via `wasm-bindgen`'s `js` feature on a time-reading crate (which `totp-rs` does not use).
**How to avoid:** Always call `TOTP::generate(unix_time_seconds)` / `TOTP::check(token, unix_time_seconds)` with an explicit time sourced from `Date.now()` on the JS side — exactly CONTEXT.md's locked design.
**Warning signs:** Any call site in `pv-core`/`pv-wasm` referencing `_current` TOTP methods; a `cargo build --target wasm32-unknown-unknown` that succeeds is not sufficient proof this pitfall was avoided — it must be checked by code review, not just build success.

### Pitfall 2: `getrandom`/gen_secret feature accidentally enabled
**What goes wrong:** If `pv-core/Cargo.toml`'s `totp-rs` dependency line is later "cleaned up" to `totp-rs = "5.7.2"` without explicit `default-features = false, features = ["otpauth"]`, no extra features turn on by default (the crate's own defaults are empty) — but a careless `features = ["otpauth", "gen_secret"]` addition would pull in `rand`, which on `wasm32-unknown-unknown` requires the `getrandom` `js` feature to be reachable from the *root* `Cargo.toml` (the exact duplicate-getrandom-major class of bug `scripts/build-wasm.sh` already audits for, per Phase 1's established pitfall).
**Why it happens:** `gen_secret`/`qr`/`steam` features are not needed anywhere in this phase's scope (no QR scanning, no secret generation UI — TOTP secrets always come from import or manual paste).
**How to avoid:** Keep `default-features = false, features = ["otpauth"]` exactly as CONTEXT.md locked it; run `scripts/build-wasm.sh`'s existing getrandom-duplicate-major audit after adding the dependency (it already covers this class of regression for the whole `pv-wasm` build).
**Warning signs:** `cargo tree -i getrandom --target wasm32-unknown-unknown -p pv-wasm` showing more than one distinct major version.

### Pitfall 3: Treating all "CSV export" formats as interchangeable
**What goes wrong:** A `keepassCsv.ts` mapper written against KeePassXC's newer `TOTP`-inclusive column set silently fails to detect (or worse, silently mis-maps) a stock-KeePass export that lacks that column entirely.
**Why it happens:** "KeePass" colloquially refers to both the original Windows-only KeePass 2.x and the popular cross-platform KeePassXC fork; their CSV exports have diverged (verified this session — KeePassXC added `TOTP`/`Icon`/`Last Modified`/`Created` columns that stock KeePass's export never had).
**How to avoid:** `detect()` for the KeePass mapper should match on the *minimum* shared column set (`Group,Title,Username,Password,URL,Notes`) and treat `TOTP` as an optional bonus column, not a required one for format detection.
**Warning signs:** A KeePass-sourced import that reports 0 rows imported despite a well-formed file, or that silently drops every row because a `detect()` check required an absent `TOTP` header.

### Pitfall 4: Per-tool CSV column names are training-data-adjacent, not registry-verifiable
**What goes wrong:** Unlike npm/crates.io packages, there is no authoritative machine-checkable source for "the current LastPass/NordPass/1Password CSV export column order" — these are product UI behaviors that can change without a version number or changelog entry.
**Why it happens:** Password managers' export formats are not a stable public API surface; several (1Password in particular) have de-emphasized CSV export in favor of their own JSON formats (1PUX for 1Password), making the CSV path itself a legacy/secondary feature subject to removal or column reordering.
**How to avoid:** Treat every column table in this document as `[CITED: websearch]`/MEDIUM confidence (or LOW for 1Password specifically, where search results were the least consistent) — the planner should budget a verification task (real export sample, or at minimum a second corroborating source) before implementation, and lean hard on the row-level fault-tolerance design already locked in CONTEXT.md as the safety net for any single wrong column name.
**Warning signs:** None automatable — this is an inherent property of the domain, not a detectable bug pattern.

## Code Examples

### DaisyUI 5 radial-progress ring for the TOTP countdown (coral)
```tsx
// Source: daisyui.com/components/radial-progress (websearch-verified class/CSS-var
// contract); coral color mapping per docs/UI-DESIGN.md §3.3
<div
  className="radial-progress text-primary"
  style={{ "--value": secondsRemainingPercent, "--size": "2.5rem", "--thickness": "3px" } as React.CSSProperties}
  role="progressbar"
  aria-valuenow={secondsRemainingPercent}
>
  <span className="font-mono text-xs">{code}</span>
</div>
```
`--color-primary` (`#E16540`, coral) is already the DaisyUI `text-primary`/`bg-primary` token per the project's existing theme wiring (Phase 1) — no new color token needed, just the correct utility class on this one component.

### papaparse: parsing an uploaded File with header detection
```typescript
// Source: papaparse README pattern (Context7-fetched, verified against 5.5.4 API shape)
import Papa from "papaparse";

function parseCsvFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve({ headers: results.meta.fields ?? [], rows: results.data });
      },
      error: reject,
    });
  });
}
```

### papaparse: generating export CSV (Papa.unparse)
```typescript
// Source: papaparse README pattern — unparse is the export-side counterpart
import Papa from "papaparse";

const EXPORT_COLUMNS = [
  "name", "type", "username", "password", "urls", "cardholderName", "number",
  "expiry", "cvv", "firstName", "lastName", "email", "phone", "address",
  "secret", "notes", "folder", "tags",
] as const;

function toCsv(rows: Record<string, string>[]): string {
  return Papa.unparse({ fields: [...EXPORT_COLUMNS], data: rows });
}
```

### Client-side download without a server round-trip
```typescript
// Source: standard Blob + <a download> pattern, consistent with static-export/
// no-SSR constraint already established for this codebase
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Full-vault re-encryption on any change | Per-item Cipher Key wrapping (already established Phase 2) | Phase 2 | Import's per-row `encryptItem` loop is cheap — each row gets its own fresh item key, no shared-state coordination needed across rows |
| 1Password's own CSV export as a first-class feature | 1Password's 1PUX JSON as the primary export format, CSV de-emphasized/legacy | Ongoing (1Password product direction) | Weakest-confidence mapper in this phase's scope — plan for `onePasswordCsv.ts` to degrade gracefully rather than assume a stable, richly-documented column set |

**Deprecated/outdated:**
- KeePass's original CSV export format (no TOTP column) is still the *only* format the stock KeePass application produces — it is not "deprecated" so much as "never had TOTP support"; KeePassXC (a separate project) is the one that added it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 1Password CSV export column order/names as researched | Architecture Patterns / Pitfalls | Low-medium — row-level fault tolerance means a wrong column name produces skipped rows (reported to user), not silent data loss or corruption; user can fall back to IMPEX-03's generic manual-mapping path |
| A2 | NordPass CSV `totp` column does not exist (no TOTP export support found) | Architecture Patterns (Pattern 3) | Low — if NordPass does export a `totp` column under a different name, the mapper simply won't populate `totpSecret`; user can still manually add TOTP items afterward |
| A3 | Bitwarden JSON/CSV schema exact field names (`login.totp`, `login_totp`) | Standard Stack / Code Examples | Low-medium — Bitwarden's own documentation and multiple independent sources agree on this shape (MEDIUM confidence, not LOW), but exact field presence/absence should be spot-checked against a real Bitwarden export sample during implementation |
| A4 | DaisyUI 5's `radial-progress` `--value`/`--size`/`--thickness` CSS variable names | Code Examples | Low — cosmetic only; wrong variable names degrade the visual ring but don't affect TOTP correctness, and DaisyUI 5 is already the project's locked UI library (Phase 1) so this is a low-novelty claim |

**If this table is empty:** N/A — see entries above. Everything else in this document (totp-rs API/version/wasm32-compatibility, papaparse version/dependencies, otpauth URI format, existing codebase patterns) was independently verified this session via `cargo info`, a local `wasm32-unknown-unknown` build, `npm view`, or direct file reads.

## Open Questions (RESOLVED)

1. **Does `totp-rs` compile to `wasm32-unknown-unknown` with the intended feature set?**
   - What we knew: CONTEXT.md flagged this as "Claude's Discretion... confirm no incompatible transitive dep... before locking the dependency."
   - Resolution: **Verified this session.** `totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }` was built locally with `cargo build --target wasm32-unknown-unknown --release` in an isolated scratch crate — succeeds cleanly. Dependency tree confirmed via `cargo tree`: only `hmac`, `sha1`, `sha2`, `digest`, `base32`, `constant_time_eq`, `url`, `urlencoding` (plus `url`'s own transitive ICU/IDNA subtree) — no `getrandom`, no `chrono`/`time` crate, no I/O.

2. **What exact API does `pv-wasm`'s `totp_now` export call into?**
   - What we knew: CONTEXT.md specified the desired signature (`totp_now(secret, algorithm, digits, period, unix_time_seconds) -> {code, seconds_remaining}`).
   - Resolution: **Resolved.** `TOTP::new(algorithm, digits, skew, step, secret_bytes)` constructs the struct (skew=1 recommended for clock-drift tolerance, matching common TOTP library defaults); `Secret::Encoded(base32_string).to_bytes()` decodes the stored base32 secret; `TOTP::generate(unix_time_seconds: u64) -> String` computes the code (never `generate_current()` — see Pitfall 1); `seconds_remaining` is computed directly as `period - (unix_time_seconds % period)` rather than via a crate method, since this is trivial arithmetic not worth a fallible call.

3. **Do KeePass, NordPass, and 1Password CSV exports actually carry a TOTP column?**
   - What we knew: CONTEXT.md assumed KeePass's "CSV File" export was the IMPEX-02 path for that tool, without confirming TOTP-column presence.
   - Resolution: **Partially resolved, documented as a known gap.** Stock KeePass 2.x's CSV export has no TOTP column at all (Group,Title,Username,Password,URL,Notes only) — only the separate KeePassXC fork's CSV export adds one. NordPass's documented CSV template also shows no explicit TOTP column. The `keepassCsv.ts`/`nordpassCsv.ts` mappers should treat TOTP secret population as best-effort/absent for these two sources, not assume it's always present — this is now reflected in Pitfall 3 and Assumption A2 above.

4. **What is the exact `otpauth://` URI shape an importer must parse?**
   - What we knew: CONTEXT.md referenced it only implicitly ("Bitwarden's `login.totp` field is the common case").
   - Resolution: **Resolved.** `otpauth://totp/{label}?secret=BASE32&issuer=X&algorithm=SHA1|SHA256|SHA512&digits=6|8&period=30` per the Google Authenticator Key URI Format spec — `secret` is the only required parameter; `algorithm`/`digits`/`period` all have RFC 6238-matching defaults (SHA1/6/30) when absent, matching CONTEXT.md's own stated default-application strategy.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable + `wasm32-unknown-unknown` target | `totp-rs` build into pv-wasm | ✓ | rustup toolchain, target installed (verified: `rustup target list --installed` shows `wasm32-unknown-unknown`) | — |
| Node.js / npm | `papaparse` install, Next.js build | ✓ | (existing project toolchain, unchanged this phase) | — |
| `wasm-bindgen-cli` (version-pinned) | `scripts/build-wasm.sh` glue generation | ✓ (already established Phase 1 pattern; no version change needed for this phase) | pinned in `crates/pv-wasm/Cargo.toml` | — |

**Missing dependencies with no fallback:** none — this phase adds no new external service/tool dependency beyond two library crates/packages already verified above.

**Missing dependencies with fallback:** none applicable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (web) | Vitest 3.2.4 + Testing Library (jsdom environment) — `web/vitest.config.ts` |
| Framework (Rust) | `cargo test` (native target) for pv-core; existing `mod tests` convention in every `pv-core/src/*.rs` file |
| Config file | `web/vitest.config.ts` (existing) |
| Quick run command (web) | `cd web && npx vitest run <path-to-file>` |
| Quick run command (Rust) | `cargo test -p pv-core totp::` |
| Full suite command | `cd web && npm test` (vitest run, all files) + `cargo test --workspace` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAULT-07 | `totp_now`/pv-core TOTP generation produces RFC 6238-correct codes for known secret+time+algorithm test vectors | unit (Rust) | `cargo test -p pv-core totp::` | ❌ Wave 0 — `crates/pv-core/src/totp.rs` + `mod tests` needed |
| VAULT-07 | TOTP countdown ring re-renders on tick, resets at period boundary | unit (web) | `npx vitest run src/components/vault/TotpCountdownRing.test.tsx` | ❌ Wave 0 |
| IMPEX-01 | Bitwarden JSON import maps folders + items + `login.totp` correctly, including the TOTP-as-separate-item rule | unit (web) | `npx vitest run src/lib/vault/importers/bitwardenJson.test.ts` | ❌ Wave 0 |
| IMPEX-01 | Bitwarden CSV import maps `login_totp` correctly; RFC 4180 edge cases (quoted commas, embedded newlines) round-trip via papaparse | unit (web) | `npx vitest run src/lib/vault/importers/bitwardenCsv.test.ts` | ❌ Wave 0 |
| IMPEX-02 | NordPass/1Password/LastPass/KeePass CSV mappers each detect their own header set and map correctly; KeePass mapper tolerates missing TOTP column | unit (web) | `npx vitest run src/lib/vault/importers/*.test.ts` | ❌ Wave 0 |
| IMPEX-03 | Generic CSV/JSON with manual column mapping produces correct `ItemFields` | unit (web) | `npx vitest run src/components/vault/ImportWizard.test.tsx` | ❌ Wave 0 |
| IMPEX-02/03 | Row-level fault tolerance: malformed row skipped + counted, import continues, never fatal | unit (web) | `npx vitest run src/lib/vault/importers/detect.test.ts` | ❌ Wave 0 |
| IMPEX-04 | JSON export produces the documented schema; CSV export produces flat superset-column output; passkey items silently omitted | unit (web) | `npx vitest run src/lib/vault/exporters/*.test.ts` | ❌ Wave 0 |
| IMPEX-04 | Plaintext-warning dialog blocks download until confirmed | unit (web) | `npx vitest run src/components/vault/ExportDialog.test.tsx` | ❌ Wave 0 |
| UI-04 | Onboarding wizard triggers once after registration, never on login; `pv-onboarding-complete` flag gates re-display; Skip available at step 1 file-select only | unit (web) | `npx vitest run src/components/onboarding/OnboardingWizard.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `vitest run <file>` / `cargo test -p pv-core totp::` for the module just touched
- **Per wave merge:** `cd web && npm test` (full vitest suite) + `cargo test --workspace`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `crates/pv-core/src/totp.rs` + `mod tests` — RFC 6238 test vectors (RFC 6238 Appendix B provides known secret/time/code triples for SHA1/SHA256/SHA512 — use these as the canonical test fixtures, not invented values)
- [ ] `web/src/lib/vault/importers/*.test.ts` (one per mapper module) — fixture CSV/JSON strings per source format
- [ ] `web/src/lib/vault/exporters/*.test.ts`
- [ ] `web/src/components/vault/TotpCountdownRing.test.tsx`, `ImportWizard.test.tsx`, `ExportDialog.test.tsx`
- [ ] `web/src/components/onboarding/OnboardingWizard.test.tsx`
- [ ] Framework install: none — Vitest and `cargo test` are already fully configured; no new test-framework setup needed this phase

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 6 adds no auth surface |
| V3 Session Management | No | Unaffected by this phase |
| V4 Access Control | No | Reuses existing per-user item ownership checks (Phase 2), no new access paths |
| V5 Input Validation | Yes | Import: every parsed row must be validated before `encryptItem` — malformed/oversized rows rejected (row-level fault tolerance, already locked in CONTEXT.md); CSV/JSON parsing itself delegated to `papaparse`/`JSON.parse`, not hand-rolled, to avoid parser-differential injection classes |
| V6 Cryptography | Yes | TOTP secret storage/computation goes through pv-core/`totp-rs`, never a custom implementation (locked convention); TOTP secrets at rest are protected by the same per-item AEAD (`XChaCha20-Poly1305`) as every other item field — no new at-rest exposure |
| V7 Error Handling / Logging | Yes | Import row failures must be reported to the user (count + reason) without ever logging the plaintext secret/password value itself — matches existing `CryptoError`'s message-only-no-payload discipline |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious/malformed CSV/JSON import file crafted to cause a client-side parser DoS (CSV bomb: deeply nested quotes, huge field count) | Denial of Service | `papaparse` is a mature, widely-used parser with its own hardening against these classes; row-level fault tolerance (skip + count) bounds the blast radius of any single malformed row; a max-file-size / max-row-count guard on the file-select step is a reasonable additional client-side control (not currently in CONTEXT.md — worth the planner adding as a defensive task) |
| Import file crafted with a huge single field (e.g. a multi-MB "notes" value) exceeding `MAX_ITEM_BLOB_BYTES` (Phase 2's 64 KiB limit) | Denial of Service / Tampering | The existing `MAX_ITEM_BLOB_BYTES` server-side check (Phase 2) already rejects oversized items on `POST /api/vault/items` — the import loop must surface this as a per-row skip-with-reason, not a fatal import abort |
| Export file left on disk in plaintext after the user "deletes" it (browser Trash/undo, OS file recovery) | Information Disclosure | Out of this phase's technical control — mitigated only by the plaintext-warning dialog's copy explicitly telling the user they're responsible for secure deletion afterward (already locked in CONTEXT.md's Area 3) |
| Crafted `otpauth://` URI in an imported field used to smuggle unexpected data via `issuer`/label (e.g. XSS if rendered unescaped) | Tampering / Injection | `issuer`/`account_name` are rendered as React text content (auto-escaped by JSX), never via `dangerouslySetInnerHTML` — no new rendering path introduced by this phase; the `URL`/`URLSearchParams` browser APIs used for parsing are themselves injection-safe (no `eval`, no string concatenation into markup) |
| A TOTP secret pasted/imported in an unexpected encoding (hex instead of base32, whitespace-padded) silently produces a wrong/garbage code with no error | Tampering (silent data corruption, not security-critical but a real correctness bug) | `Secret::Encoded(...).to_bytes()` returns `Result<Vec<u8>, SecretParseError>` — the manual-add form and every importer must surface this error to the user rather than silently accepting invalid input, matching the codebase's existing `CryptoError`-surfaces-not-swallows convention |

## Sources

### Primary (HIGH confidence)
- `cargo info totp-rs` / crates.io registry — version 5.7.2, license, feature flags, `rust-version: 1.66`
- Local `cargo build --target wasm32-unknown-unknown --release` in an isolated scratch crate with `totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }` — build succeeded, `cargo tree` output captured
- `npm view papaparse version/dependencies/time.created/time.modified/scripts.postinstall` — 5.5.4, zero deps, 2014-2026 history, no postinstall
- Direct codebase reads: `web/src/lib/vault/types.ts`, `crates/pv-wasm/src/lib.rs`, `crates/pv-core/src/items.rs`, `web/src/components/vault/{DetailPanel,ItemForm,TypePicker}.tsx`, `web/src/lib/vault/{store,api}.ts`, `web/src/components/auth/RegisterForm.tsx`, `web/src/app/page.tsx`, `web/src/lib/idle/autolock.ts`, `web/src/lib/clipboard.ts`, `docs/UI-DESIGN.md`, `scripts/build-wasm.sh`

### Secondary (MEDIUM confidence)
- docs.rs `totp-rs` `TOTP`/`Secret` struct pages (WebFetch) — constructor/method signatures, `Secret::Encoded`/`.to_bytes()` behavior
- Google Authenticator Key URI Format wiki (websearch) — otpauth:// URI parameter spec
- Bitwarden's own help docs + community gist (websearch) — JSON export root shape, CSV header
- LastPass, NordPass, KeePass/KeePassXC CSV export column research (websearch, cross-referenced across multiple results)

### Tertiary (LOW confidence)
- 1Password CSV export column names — search results were the least consistent of the five source tools researched; flagged as Assumption A1, planner should budget a verification task

## Metadata

**Confidence breakdown:**
- Standard stack (totp-rs, papaparse): HIGH — both independently verified via registry tools and a local wasm32 build, not just training knowledge
- Architecture (TOTP WASM export, import/export pipeline shape): HIGH — directly extends already-verified existing codebase patterns (encryptItem/createVaultItem, ItemType switch shape)
- CSV format specifics (per-tool column names): MEDIUM (LOW for 1Password specifically) — third-party product UI details with no authoritative registry, subject to drift; documented as such throughout

**Research date:** 2026-07-14
**Valid until:** 30 days for the crate/package version findings (stable, registry-verified); ~14 days for the per-tool CSV column tables (product UI details, faster-moving, no changelog to track drift against) — the planner should treat the CSV column tables as due for a spot-check if execution happens more than ~2 weeks after this research date.
