---
phase: 06-import-export-totp-onboarding
verified: 2026-07-14T00:00:00Z
status: passed
score: 5/5 roadmap success criteria verified; 15/15 plan must-have truths verified
method: static code-vs-goal (no dev server / Playwright — live E2E deferred to separate UAT pass)
gates:
  tsc: "clean (exit 0) — npx tsc --noEmit"
  web_tests: "49 files / 339 tests passed (exit 0) — npm test"
  pv_core_totp_tests: "6/6 passed (exit 0) — cargo test -p pv-core totp::"
must_haves:
  # Roadmap Success Criteria (the contract)
  - id: SC-1
    truth: "During a 3-step onboarding flow, importing from another password manager is offered as the first step"
    status: verified
  - id: SC-2
    truth: "User can import a Bitwarden JSON or CSV export, and CSV exports from NordPass/1Password/LastPass/KeePass, entirely client-side — no plaintext sent to server"
    status: verified
  - id: SC-3
    truth: "User can import a generic CSV/JSON with manual column mapping"
    status: verified
  - id: SC-4
    truth: "User can export the full vault to JSON and CSV, with a clear plaintext warning shown before export"
    status: verified
  - id: SC-5
    truth: "Vault items of type TOTP show a live, counting-down code generated locally from the item's secret"
    status: verified
  # Plan 06-01 (VAULT-07)
  - id: "06-01-T1"
    truth: "TOTP code computed entirely client-side via pv-core totp-rs through pv-wasm, never a JS-side HMAC reimplementation"
    status: verified
  - id: "06-01-T2"
    truth: "totpNow never derives current time inside WASM — caller always supplies unix_time_seconds"
    status: verified
  - id: "06-01-T3"
    truth: "Invalid base32 TOTP secret rejected with a visible error, never silently accepted"
    status: verified
  # Plan 06-02 (IMPEX-01/02/03)
  - id: "06-02-T1"
    truth: "papaparse approved via resolved human-verify checkpoint before added to package.json"
    status: verified
  - id: "06-02-T2"
    truth: "Every per-tool CSV mapper detect() matches only a minimal tool-specific column subset (graceful non-match)"
    status: verified
  - id: "06-02-T3"
    truth: "Embedded TOTP secret maps to two separate drafts (primary + standalone totp), never a hidden relation"
    status: verified
  - id: "06-02-T4"
    truth: "Malformed/unparseable row never throws past a mapper boundary — reported as a counted skip, never aborts the file"
    status: verified
  # Plan 06-03 (IMPEX-01/02/03/04)
  - id: "06-03-T1"
    truth: "User can drop/select any supported (or unrecognized) export and reach a preview before writes; manual-mapping screen surfaced when auto-detect fails"
    status: verified
  - id: "06-03-T2"
    truth: "Import write loop never aborts on a single bad row — counts/reports it; summary states imported-of-total"
    status: verified
  - id: "06-03-T3"
    truth: "Plaintext export warning must be explicitly confirmed before download — no code path downloads without confirmation"
    status: verified
  - id: "06-03-T4"
    truth: "Settings Import/Eksport placeholder replaced with working Import and Export entry points"
    status: verified
  # Plan 06-04 (UI-04)
  - id: "06-04-T1"
    truth: "Onboarding takeover appears only after registration (never plain login), import offered as step 1 (full ImportWizard, not a subset)"
    status: verified
  - id: "06-04-T2"
    truth: "All paths converge on step 3 Finish which sets a per-browser localStorage flag (fail-safe to not-showing)"
    status: verified
  - id: "06-04-T3"
    truth: "Skip from step 1 jumps straight to step 3 bypassing step 2; done/decline advances to step 2"
    status: verified
review_fixes:
  - id: WR-01
    claim: "Folder-creation guarded in ImportWizard.runImport"
    status: present
    evidence: "ImportWizard.tsx:321-334 — try/catch around createVaultFolder → counted skip + processed++/continue"
  - id: WR-02
    claim: "bitwardenJson row-level fault tolerance"
    status: present
    evidence: "bitwardenJson.ts:47-49 name null-guard; :66-68 uris Array.isArray + element typeof guard; :118-121 default-case skip. ImportWizard.tsx:217-224 per-row try/catch around mapItem"
  - id: WR-03
    claim: "otpauth digits/period clamped in importers/types.ts parseTotpValue"
    status: present
    evidence: "types.ts:123-127 — Number.isInteger + range clamp (digits 6..10, period >0), RFC defaults on non-finite"
  - id: WR-04
    claim: "download.ts appends anchor + deferred revoke"
    status: present
    evidence: "download.ts:15-19 — appendChild before click, removeChild, setTimeout(revokeObjectURL, 0)"
  - id: WR-05
    claim: "ImportWizard inline variant used by OnboardingStep1Import"
    status: present
    evidence: "ImportWizard.tsx:140-149 variant prop, :617-618 inline returns scrim-less panel. OnboardingStep1Import.tsx:33 renders <ImportWizard ... variant=\"inline\" />"
  - id: WR-06
    claim: "toCsv formula-injection neutralization"
    status: present
    evidence: "toCsv.ts:41-43 neutralizeFormulaInjection (/^[=+\\-@\\t\\r]/ → leading apostrophe); :87-89 applied to every cell before Papa.unparse"
info_findings_nonblocking:
  - id: IN-01
    note: "detect.ts fileName param unused (void fileName) — cosmetic, no functional impact"
  - id: IN-02
    note: "ImportWizard preview/summary lists use array index as React key — low-impact, lists are static at render"
---

# Phase 6: Import/Export, TOTP & Onboarding — Verification Report

**Phase Goal:** A new user can bring their existing passwords in during onboarding, see live TOTP codes in the vault, and export everything back out.
**Verified:** 2026-07-14
**Status:** passed
**Method:** Static code-vs-goal, goal-backward. Build/test gate run (tsc, web vitest, pv-core cargo). Live E2E (dev server / Playwright) intentionally NOT run — a separate UAT pass covers it.

## Build / Test Gate

| Gate | Command | Result |
|------|---------|--------|
| TypeScript | `cd web && npx tsc --noEmit` | ✓ clean (exit 0) |
| Web tests | `cd web && npm test` | ✓ 49 files / 339 tests passed (exit 0) |
| Rust TOTP | `cargo test -p pv-core totp::` | ✓ 6/6 passed (exit 0) — RFC 6238 SHA1/256/512 KATs, invalid-base32, zero-period, same-period stability |

## Roadmap Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Onboarding offers import as first step | ✓ VERIFIED | `page.tsx:166-168` shows `OnboardingWizard` only on RegisterForm `onAuthed` when `!isOnboardingComplete()`; login branch (`:160`) untouched. `OnboardingWizard` step 1 → `OnboardingStep1Import` → real `ImportWizard variant="inline"`. Tested in OnboardingWizard.test / page.test (in the 339 passing). |
| 2 | Import Bitwarden JSON/CSV + NordPass/1Password/LastPass/KeePass CSV, client-side | ✓ VERIFIED | 6 mapper modules present + unit-tested (bitwardenJson 9, bitwardenCsv 7, nordpassCsv 6, onePasswordCsv 6, lastpassCsv 6, keepassCsv 7). `ImportWizard.handleFileSelected` parses via `file.text()`/`Papa.parse`/`JSON.parse` in-browser; write loop uses existing `createVaultItem` (client-side encrypt-then-POST). No server-side parsing path. |
| 3 | Generic CSV/JSON with manual column mapping | ✓ VERIFIED | `genericMapping.ts` (`GENERIC_TARGET_FIELDS`, `mapRowGeneric`) tested (6). `ImportWizard` mapping screen (`:419-466`) renders per-target `<select>` over file headers; unknown-format route (`:248-286`) reaches it for both CSV and JSON-array-of-objects. |
| 4 | Export vault to JSON and CSV with plaintext warning before export | ✓ VERIFIED | `buildJsonExport`/`buildCsvExport` present + tested. `ExportDialog` always renders `alert-warning` banner; `downloadFile` invoked ONLY in `handleConfirm` (confirm button); cancel/backdrop → `onClose` without download. |
| 5 | TOTP items show live counting-down code generated locally | ✓ VERIFIED | `pv-core::totp::generate_code` passes RFC 6238 KATs (6 cargo tests). `totpNow` wasm export → `lib/crypto` wrapper → `TotpCountdownRing` ticks via `setInterval(1s)`, recomputes through pv-wasm each tick, cleans up on unmount. Wired into `ItemRow` (24px) and `DetailPanel` (64px). |

## Observable Truths (per-plan must_haves)

### Plan 06-01 — TOTP crypto path (VAULT-07)

| Truth | Status | Evidence |
|-------|--------|----------|
| Client-side via pv-core/pv-wasm, no JS HMAC | ✓ VERIFIED | `totp.rs` uses `totp_rs` `TOTP::generate`; `pv-wasm:163` `totpNow` calls `pv_core::totp::generate_code`; `TotpCountdownRing` imports `totpNow` from `@/lib/crypto` only. Choke-point grep (`wasm/pv_wasm` outside `lib/crypto/`) returns 0 matches. No JS-side HMAC anywhere. |
| totpNow never reads clock in WASM | ✓ VERIFIED | `generate_code(...,unix_time_seconds)` and `totp.generate(unix_time_seconds)` — explicit-time method only; caller passes `Math.floor(Date.now()/1000)` from JS (`TotpCountdownRing:36`). No `generate_current`/`SystemTime::now`. |
| Invalid base32 rejected with visible error | ✓ VERIFIED | `generate_code` maps `Secret::Encoded(...).to_bytes()` err → `CryptoError::InvalidInput`; `invalid_base32_secret_rejected` test passes; `TotpCountdownRing` catch → visible `—` error state; ItemForm validates on submit (dictionary `totp.invalidSecretError`). |

### Plan 06-02 — Import mapping layer (IMPEX-01/02/03)

| Truth | Status | Evidence |
|-------|--------|----------|
| papaparse approved via resolved checkpoint | ✓ VERIFIED | Blocking human-verify Task 1; `grep "papaparse" web/package.json` present; 06-02-SUMMARY records approval. tsc/tests green with it installed. |
| Minimal-subset detect() per mapper | ✓ VERIFIED | Each mapper exports `{TOOL}_CSV_REQUIRED_COLUMNS` minimal subset; detect true/false boundary tests pass; false non-match falls through to generic mapping in `detect.ts`. |
| Embedded TOTP → two separate drafts | ✓ VERIFIED | `bitwardenJson.ts:129-142` pushes standalone `type:"totp"` draft named after login; behavior tested (bitwardenJson.test, lastpass/keepass/generic). |
| Malformed row → counted skip, never aborts file | ✓ VERIFIED | `MapRowResult.skipped`; mappers return `{items:[],skipped}` not throw; ImportWizard per-row try/catch (WR-02). Defensive `?? ""` throughout CSV mappers. |

### Plan 06-03 — ImportWizard + ExportDialog (IMPEX-01/02/03/04)

| Truth | Status | Evidence |
|-------|--------|----------|
| Preview before writes; manual-map on unknown | ✓ VERIFIED | `ImportWizard` 5-screen state machine; auto-detect → preview, unknown → mapping → preview. Tested in ImportWizard.test. |
| Write loop never aborts; summary counts | ✓ VERIFIED | `runImport` per-item + per-folder try/catch → `skippedEntries`; summary `summaryPartial` interpolates imported/total/skipped. WR-01 folder guard present. |
| Plaintext warning must be confirmed before download | ✓ VERIFIED | `ExportDialog` — `downloadFile` only in `handleConfirm`; banner always rendered; backdrop/cancel → onClose, no download. |
| Settings placeholder replaced | ✓ VERIFIED | `SettingsPanel.tsx:105/108/117/120` importCta/exportCta buttons render `ImportWizard`/`ExportDialog`; placeholder paragraph gone. |

### Plan 06-04 — Onboarding wizard (UI-04)

| Truth | Status | Evidence |
|-------|--------|----------|
| Takeover only after registration, import step 1 (full wizard) | ✓ VERIFIED | `page.tsx` register-only gating; `OnboardingStep1Import` renders real `ImportWizard` (inline). |
| All paths converge on step 3 Finish → per-browser flag | ✓ VERIFIED | `OnboardingWizard` step 3 `onFinish` → `markOnboardingComplete()`; `flag.ts` fail-safe returns `true` on storage error (never re-force). |
| Skip → step 3 bypass step 2; done → step 2 | ✓ VERIFIED | `OnboardingWizard` `onSkip={()=>setStep(3)}`, `onDone={()=>setStep(2)}`; tested in OnboardingWizard.test. |

## Review Fix Verification (WR-01..WR-06)

All six standard-review warnings confirmed fixed in code (not merely claimed):

| ID | Fix | Present | Location |
|----|-----|---------|----------|
| WR-01 | Folder-creation guarded → counted skip | ✓ | ImportWizard.tsx:321-334 |
| WR-02 | Bitwarden JSON row-level fault tolerance | ✓ | bitwardenJson.ts:47,66-68,118-121 + ImportWizard.tsx:217-224 |
| WR-03 | otpauth digits/period clamp | ✓ | importers/types.ts:123-127 |
| WR-04 | Anchor appended + deferred revoke | ✓ | download.ts:15-19 |
| WR-05 | Inline ImportWizard variant | ✓ | ImportWizard.tsx:140-149,617-618 + OnboardingStep1Import.tsx:33 |
| WR-06 | CSV formula-injection neutralization | ✓ | toCsv.ts:41-43,87-89 |

## Non-Blocking Info Findings

- **IN-01** — `detect.ts` carries an unused `fileName` param (`void fileName`). Cosmetic; no functional impact.
- **IN-02** — ImportWizard preview/summary lists use array index as React key. Low-impact (lists static at render). Latent only if lists become editable.

Neither affects goal achievement; no action required for this phase.

## Human Verification / UAT (routed to separate pass)

Per instructions, live E2E was not exercised here. The separate UAT pass should confirm the inherently-visual/interactive aspects that static analysis cannot: the coral radial ring renders and counts down smoothly in-browser; the onboarding takeover's blur/scrim and step-dot chrome match the datafa.st aesthetic; a real Bitwarden/1Password export file imports end-to-end; a downloaded CSV opens correctly in a spreadsheet (formula neutralization visible). These are expected UAT items, not verification gaps.

**UPDATE (2026-07-14) — live UAT completed and PASSED (4/4).** See `06-UAT.md`. Self-driven
Playwright pass confirmed: Bitwarden-JSON import with auto-detect + TOTP dual-draft split +
counted summary; live TOTP ring rendering a code that matched an independent RFC-6238
computation and ticked correctly across a period boundary (`389868`→`262754`); plaintext-warning
gate + working JSON (full-fidelity) & CSV downloads; post-registration 3-step onboarding with
inline import (WR-05), skip→step-3, and per-browser `pv-onboarding-complete` flag set on Finish.
Non-blocking carry-forward: **CSV export drops TOTP algorithm/digits/period** (only `secret`
column) — lossy round-trip for non-default TOTP; JSON is lossless. Data-quality note, not a
requirement miss.

## Gaps Summary

None. All 5 roadmap success criteria and all 15 plan must-have truths are satisfied by shipped code, all six code-review fixes (WR-01..WR-06) are present in the codebase, and all three automated gates (tsc, 339 web tests, 6 pv-core TOTP tests) are green.

---

_Verified: 2026-07-14_
_Verifier: Claude (gsd-verifier), Opus 4.8_
