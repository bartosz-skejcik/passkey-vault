---
phase: 6
slug: import-export-totp-onboarding
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 06-RESEARCH.md § Validation Architecture and the 4-plan/10-task breakdown.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `cargo test` (pv-core RFC 6238 unit tests) + Vitest 3.2.4 + Testing Library (web, jsdom) — no new test-framework setup needed this phase |
| **Config file** | Cargo.toml (workspace); web/vitest.config.ts |
| **Quick run command** | `cd web && npx vitest run <path-to-file>` / `cargo test -p pv-core totp::` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test) && (cd web && npm run build)` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run the crate-scoped test for the touched crate (`cargo test -p pv-core totp::` / `cargo build -p pv-wasm --target wasm32-unknown-unknown --release`) or `cd web && npx vitest run <touched file(s)>`
- **After every plan wave:** Run full suite (`cargo test --workspace && cd web && npm test`)
- **Before `/gsd-verify-work`:** Full suite must be green, including `npm run build` (static export)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | VAULT-07 | T-06-01, T-06-02 | `generate_code` produces RFC 6238 Appendix B known-answer codes (SHA1/SHA256/SHA512); rejects invalid base32/zero-period without panicking; never calls a same-crate now()-reading variant (code-review gate, not grep) | unit (Rust, TDD) | `cargo test -p pv-core totp::` | N/A (created by task) | ⬜ pending |
| 06-01-02 | 01 | 1 | VAULT-07 | — | `totpNow` wasm export round-trips through `lib/crypto`; `TotpCountdownRing` ticks via mocked `totpNow`, clears its interval on unmount, degrades to an error state (not a crash) on a rejected call | unit (Rust/WASM + Vitest, TDD) | `cargo build -p pv-wasm --target wasm32-unknown-unknown --release && cd web && npx vitest run src/components/vault/TotpCountdownRing.test.tsx` | N/A (created by task) | ⬜ pending |
| 06-01-03 | 01 | 1 | VAULT-07 | T-06-03 | `totp` wired into `ItemType`/`TypePicker`/`ItemForm` (otpauth:// auto-parse, Advanced-toggle default-closed)/`DetailPanel` (masked/revealable secret, live ring, no algorithm/digits/period leak into view mode)/`ItemRow` (ring replaces relative-time)/`Sidebar` (`CATEGORY_ICON`/`CATEGORY_LABEL_KEY`/`ITEM_TYPES` stay exhaustive so `npm run build` doesn't break and TOTP items remain filterable) | component (Vitest) + build | `cd web && npx vitest run src/components/vault/{TypePicker,ItemForm,DetailPanel,ItemRow}.test.tsx && npm run build` | N/A (created by task) | ⬜ pending |
| 06-02-01 | 02 | 1 | IMPEX-01/02/03 | T-06-SC | Package Legitimacy Gate: papaparse's `[SUS]`/"too-new" auto-flag confirmed as a documented false positive against the live npm registry before install | checkpoint (human-verify; overnight: orchestrator resolves with recorded evidence per standing authorization) | — | N/A | ⬜ pending |
| 06-02-02 | 02 | 1 | IMPEX-01 | T-06-04 | `parseTotpValue` disambiguates otpauth://-vs-bare-base32; `detectFormat` dispatches correctly; Bitwarden JSON+CSV mappers split an embedded `login.totp` into a standalone totp draft; missing-required-field rows return a skip, never throw | unit (Vitest, TDD) | `cd web && npx vitest run src/lib/vault/importers/{types,detect,bitwardenJson,bitwardenCsv}.test.ts` | N/A (created by task) | ⬜ pending |
| 06-02-03 | 02 | 1 | IMPEX-02, IMPEX-03 | — | NordPass/1Password/LastPass/KeePass `detect()` match only a minimal drift-resilient column subset; KeePass mapper degrades gracefully with/without the KeePassXC-only TOTP column; genericMapping produces correct drafts from a user-chosen column mapping | unit (Vitest, TDD) | `cd web && npx vitest run src/lib/vault/importers/{nordpassCsv,onePasswordCsv,lastpassCsv,keepassCsv,genericMapping}.test.ts` | N/A (created by task) | ⬜ pending |
| 06-03-01 | 03 | 2 | IMPEX-01, IMPEX-02, IMPEX-03 | T-06-07 | Full select→detect/map→preview→progress→summary flow; folder-name deduplication (createVaultFolder called at most once per name); row-level fault tolerance (a failing row is skipped, never aborts the loop); no dismissal possible while the write loop is active | component (Vitest, TDD) | `cd web && npx vitest run src/components/vault/ImportWizard.test.tsx` | N/A (created by task) | ⬜ pending |
| 06-03-02 | 03 | 2 | IMPEX-04 | T-06-08 | `buildJsonExport`/`buildCsvExport` produce the documented schemas; `downloadFile` never called without `ExportDialog`'s explicit confirm; Settings' Import/Eksport placeholder replaced with working CTAs | unit + component (Vitest, TDD) | `cd web && npx vitest run src/lib/vault/exporters/ src/components/vault/ExportDialog.test.tsx src/components/settings/SettingsPanel.test.tsx` | N/A (created by task) | ⬜ pending |
| 06-04-01 | 04 | 3 | UI-04 | T-06-10 | `isOnboardingComplete`/`markOnboardingComplete` fail-safe direction; step 1's `onSkip` jumps to step 3 (step 2 never rendered); step 1's `onDone` advances to step 2; `markOnboardingComplete` fires exactly once, only from step 3's Finish | component (Vitest, TDD) | `cd web && npx vitest run src/lib/onboarding/flag.test.ts src/components/onboarding/OnboardingWizard.test.tsx` | N/A (created by task) | ⬜ pending |
| 06-04-02 | 04 | 3 | UI-04 | — | Onboarding shown only after `RegisterForm`'s `onAuthed` (never `LoginForm`'s); not shown when the flag is already set; `onFinish` hides the takeover | component (Vitest) + build | `cd web && npx vitest run src/app/page.test.tsx && npm run build` | N/A (created by task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-core/src/totp.rs` `#[cfg(test)] mod tests` — RFC 6238 Appendix B known-answer vectors (SHA1/SHA256/SHA512), computed and cross-checked independently during planning (delivered by Plan 06-01 Task 1)
- [ ] `web/src/components/vault/TotpCountdownRing.test.tsx` — covers VAULT-07's live-tick/unmount-cleanup/error-state behavior (delivered by Plan 06-01 Task 2)
- [ ] `web/src/lib/vault/importers/*.test.ts` (one per mapper module, 7 files) — covers IMPEX-01/02/03 (delivered by Plan 06-02 Tasks 2-3)
- [ ] `web/src/lib/vault/exporters/{toJson,toCsv}.test.ts` — covers IMPEX-04's schema correctness (delivered by Plan 06-03 Task 2)
- [ ] `web/src/components/vault/{ImportWizard,ExportDialog}.test.tsx` — covers the write-loop/dismissal-rule/confirm-gate behaviors (delivered by Plan 06-03)
- [ ] `web/src/components/onboarding/OnboardingWizard.test.tsx`, `web/src/lib/onboarding/flag.test.ts` — covers UI-04 (delivered by Plan 06-04 Task 1)
- [ ] `web/src/app/page.test.tsx` — covers UI-04's trigger/gating rule (delivered by Plan 06-04 Task 2; create the file if it does not already exist)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Bitwarden/NordPass/1Password/LastPass/KeePass export file import | IMPEX-01, IMPEX-02 | Per-tool CSV column tables are `[CITED: websearch]`/MEDIUM-LOW confidence (06-RESEARCH.md) — unit tests use synthetic fixtures matching the documented column names, not a guaranteed-current real export sample | Morning: import a real export from at least one of the five tools (Bitwarden JSON preferred, highest confidence) and confirm items appear correctly; report any column-name drift as a follow-up gap, not a phase blocker (row-level fault tolerance is the designed safety net for exactly this case) |
| Onboarding visual taste (5 flagged items in 06-UI-SPEC.md "Morning review notes") | UI-04 | Aesthetic judgment (modal chrome/step-dot styling, export dialog warning-vs-error color, TOTP icon choice) | Morning review with screenshots |
| TOTP code cross-check against an authenticator app | VAULT-07 | Confirms real-world interop beyond RFC known-answer vectors | Morning: add the same base32 secret to Google/Microsoft Authenticator and a vault totp item side-by-side, confirm codes match |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (Task 06-02-01 is a checkpoint, exempt per convention)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references from the RESEARCH test map
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-14 (generated during autonomous overnight run alongside the 4-plan/10-task breakdown).
