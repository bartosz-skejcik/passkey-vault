---
phase: 06-import-export-totp-onboarding
uat_date: 2026-07-14
method: Playwright MCP (self-driven, authorized overnight UAT) + independent RFC-6238 cross-check
account: uat-prf04@example.local (import/TOTP/export), uat-onb06@example.local (onboarding — fresh registration)
status: passed
result: 4/4 UAT flows passed
screenshots: uat-screenshots/
---

# Phase 6 — UAT (live E2E via Playwright)

Live end-to-end validation of the four headline Phase-6 surfaces, driven through the
running dev stack (`pv-server` :8620 + Next :3000). Complements `06-VERIFICATION.md`
(static code-vs-goal, which was intentionally deferred on live E2E to this pass).

## 1. Import — Bitwarden JSON (IMPEX-01/02/03) — PASS

- Uploaded a 2-item Bitwarden JSON export (one login carrying an embedded
  `login.totp` otpauth:// URI, one plain login) via Settings → Import/Eksport → Zaimportuj hasła.
- **Format auto-detected** as `bitwarden-json` (shown in preview header).
- **Preview showed 3 drafts** — the GitHub login split into a **login draft + a standalone
  TOTP draft** (validates IMPEX-02 dual-draft rule: embedded TOTP → two separate items,
  no hidden relation), plus the second login. Screenshot: `uat-06-import-preview.png`.
- Executed import → summary screen: **"Zaimportowano wszystkie 3 pozycje."** (states
  exactly how many of how many — IMPEX-03 fault-tolerant loop + count).
- All 3 items landed in the vault with folder ("UAT Import Folder") preserved.

## 2. TOTP live countdown ring (VAULT-07) — PASS

- The imported TOTP item rendered a **coral countdown progress ring + live 6-digit code**
  in the vault list. Screenshot: `uat-06-imported-totp-live.png`.
- **Cryptographic correctness cross-checked independently:** app displayed `389868`
  (secondsRemaining ~13); an independent Node RFC-6238 HMAC-SHA1 computation over the
  same secret `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` produced **exactly `389868`**.
- **Live tick verified:** after crossing a 30s period boundary the code rolled to
  `262754`, which again **matched** the independent computation for the new window.
  Confirms the ring is live (setInterval), client-side, and RFC-6238-correct.

## 3. Export — JSON + CSV with plaintext-warning gate (IMPEX-04) — PASS

- Settings → Import/Eksport → Eksportuj vault opened a **plaintext-warning dialog**:
  heading "Eksportować vault w postaci jawnego tekstu?", JSON/CSV toggle, explicit
  warning that the file contains every password/secret unencrypted and that passkeys are
  not exported. Download is gated behind an explicit **"Pobierz mimo to"** confirm — no
  code path downloads without it. Screenshot: `uat-06-export-plaintext-warning.png`.
- **JSON download succeeded** (`passkey-vault-export-2026-07-14.json`) — confirms the
  WR-04 cross-browser download fix (anchor appended + deferred revoke). Content was
  **full-fidelity**: logins with plaintext credentials, TOTP with `algorithm/digits/period`,
  folder mapping — a clean import→export round-trip.
- **CSV download succeeded** (`passkey-vault-export-2026-07-14.csv`) — flat columns, all
  3 items, folder names resolved.
- **Known limitation (non-blocking, carried forward):** CSV export has only a `secret`
  column and drops TOTP `algorithm/digits/period`; a non-default TOTP (e.g. SHA256/8-digit/60s)
  round-tripped through CSV would reconstruct with RFC defaults and produce wrong codes.
  JSON export is lossless. Flagged by the traceability audit — data-quality note, not a
  requirement miss (IMPEX-04 asks for JSON+CSV export with warning, both present).

## 4. Onboarding — 3-step post-registration takeover (UI-04) — PASS

- Registered a **fresh account** (`uat-onb06@example.local`). The onboarding takeover
  appeared **immediately after successful registration** (not after a plain login):
  "Krok 1 z 3", heading "Zaimportuj swoje hasła", with the **ImportWizard embedded inline**.
- **WR-05 fix confirmed live:** the step-1 title/subtitle render *above* the wizard body
  (inline `variant`), i.e. the onboarding chrome is visible — not covered by a detached
  full-screen scrim. Screenshot: `uat-06-onboarding-step1-import.png`.
- **Skip path:** "Pomiń na razie" from step 1 jumped **straight to step 3** ("Krok 3 z 3",
  "Gotowe — Twój vault czeka 🎉"), bypassing step 2 entirely (UI-04 skip rule).
  Screenshot: `uat-06-onboarding-step3-finish.png`.
- **Finish:** "Przejdź do vaulta" dismissed onboarding to the vault and set the per-browser
  localStorage flag **`pv-onboarding-complete = "true"`** (verified before=null → after="true").
  Same browser will not re-show onboarding; a fresh browser/device on the same account still would.

## Console / regressions

Only two pre-existing, dev-only console errors observed across the whole session: a React
hydration warning on the `<html data-theme lang>` attributes (client-set theme/locale
persistence) and a `favicon.ico` 404. Neither is a Phase-6 regression.

## Verdict

**4/4 flows passed.** All Phase-6 roadmap success criteria confirmed live. One non-blocking
CSV-TOTP-fidelity limitation documented above and in `06-VERIFICATION.md` carry-forward.
