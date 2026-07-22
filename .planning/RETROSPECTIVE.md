# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v0.1 — MVP

**Shipped:** 2026-07-14
**Phases:** 7 | **Plans:** 29 | **Sessions:** multiple (incl. autonomous overnight + continuation runs)

### What Was Built
- `pv-wasm` crate bridging pv-core's Argon2id/HKDF/XChaCha20-Poly1305 crypto to WASM behind opaque-handle types, with a single grep-auditable `lib/crypto/` choke-point (Phase 1, UI-01).
- Full password-auth + zero-knowledge vault CRUD (login/card/identity/note items, folders, tags, client-side search, CSPRNG generator, clipboard auto-clear, idle-lock) over AD-bound XChaCha20-Poly1305 blobs (Phase 2).
- Two-ceremony PRF passkey enrollment + account-security Settings + server-enforced no-stranding recovery invariant (Phase 3); one-gesture PRF login+unlock with honest fallback tiers (Phase 4).
- Multi-device sync: revision-gated pull + metadata-only WS push (ciphertext never in the channel) + optimistic-concurrency 409 conflict handling (Phase 5).
- Import (Bitwarden/NordPass/1Password/LastPass/KeePass/generic) + JSON/CSV export with plaintext-warning gate + RFC-6238 TOTP item type with a live ring + 3-step import-first onboarding (Phase 6).
- Single-container Docker packaging with fail-loud `Config::validate()`, SQLite WAL, SIGTERM, and reverse-proxy reference configs that strip the WS session token from access logs (Phase 7).

### What Worked
- **Workflow-orchestrated GSD pipeline:** running review/verify/plan-check/integration as background `Workflow` fan-outs (Opus for verification-class agents, Sonnet for execution) kept the orchestrator context lean and let independent checks run in parallel with UAT.
- **Adversarial second perspectives:** pairing the goal-backward verifier with an independent requirements-traceability audit (Phase 6) and a dedicated cross-phase integration checker (milestone) caught the framing gaps a single pass misses (stale UI-04 checkbox, CSV-TOTP fidelity).
- **Self-driven Playwright UAT** with a CDP virtual authenticator closed the human_needed loop overnight; cross-checking the live TOTP code against an independent RFC-6238 computation gave real correctness evidence, not just "it rendered."
- **Sequential worktree/executor discipline:** worktree isolation for parallel same-tree waves; sequential-on-main for single-plan waves. Executor deaths mid-run (server_error / session-limit) lost zero work because commits persisted — resumed via SendMessage.

### What Was Inefficient
- **GSD "stale verification" mtime gate** bit twice (Phase 3, Phase 7) purely because SUMMARY/VERIFICATION files were committed out of order — cost re-stamp cycles for no code reason. Write SUMMARYs before VERIFICATION, or the verifier last.
- **`passed_with_concerns` is not a recognized GSD status** — the verifier emitted it and blocked phase.complete until flipped to `passed`. Verifier prompts should stick to passed/gaps_found/human_needed.
- **Executors deferred SUMMARY writes to the orchestrator**, so 07-02/07-03 SUMMARYs were missing at audit time — a documentation gap the integration verifier flagged. Executors should always emit their own SUMMARY.
- **Docker unavailable in the autonomous env** forced the whole Phase-7 container/proxy E2E to human_needed; later installed Colima (CLI, no Desktop) to actually run it.

### Patterns Established
- **Single-source domain-separation constants** verified across the enroll↔unlock seam (`pv:prf-unlock:v1`) — the highest-risk crypto seam held because one function serves both wrap and unwrap.
- **Baseline-revision capture at edit-open** (not live revision) is what makes optimistic-concurrency 409s actually fire — the CR-01 fix pattern.
- **Human-needed E2E as a first-class artifact:** when a check can't run in-env, enumerate the exact commands in a `*-UAT.md` checklist rather than silently skipping.
- **Colima for CLI-only Docker on macOS** — real daemon, no Docker Desktop.

### Key Lessons
1. Order artifact commits so verification is last (or re-stamp) — the mtime-based staleness gate is unforgiving.
2. Constrain verifier status vocabulary to the three recognized values; carry nuance in the body + a UAT.md, not the frontmatter status.
3. Independent adversarial passes (traceability audit, integration checker) find framing/wiring gaps that goal-backward verification of a single phase cannot.
4. Prove crypto correctness against an external reference (independent RFC-6238), not just against the app's own output.

### Cost Observations
- Model mix: Opus reserved for verification/review/plan-check/integration + the orchestrator's judgment; Sonnet for all execution/doc-generation subagents (per the standing model policy). Effort tuned per task (high for verify/plan-check, medium for execution/docs).
- Notable: background `Workflow` fan-outs let verification run in parallel with hands-on UAT, compressing wall-clock without inflating orchestrator context.

---

## Milestone: v0.3 — Polish & Hardening

**Shipped:** 2026-07-22
**Phases:** 7 (14–20) | **Plans:** 29 | **Mode:** autonomous run (handoff-driven across 3 sessions)

*(v0.2 Browser Extension — fazy 8–13, complete 2026-07-20 — nigdy nie miało formalnego close; jego katalogi faz zarchiwizowano przy tym zamknięciu do `milestones/v0.2-phases/`. Osobnej retrospektywy v0.2 nie ma — nauczka z live-debugu v0.2 JEST treścią v0.3.)*

### What Was Built
- Oba Critical risks z v0.2 zamknięte risk-first (XBR-02 root-cause = WebDriver artifact + trwałe regression gates; QA-03 real cross-vendor webauthn-rs round-trip).
- Jeden model logowania (Vaultwarden): sign-in tylko przez okno server-ceremony, popup unlock-only, ext-scoped PRF hard-usunięty z trwałym grep-guardem.
- Design system w `packages/pv-ui`: logika/typy/i18n + pierwszy współdzielony komponent React (ItemIconTile), token-aligned in-page overlays, harness wizualny.
- Server/supply-chain hardening (CORS konkretne originy, counter-anomaly, cargo-audit/deny + piny) i pełny 4-jobowy CI gate odwzorowujący lokalną bramkę 1:1.

### What Worked
- Risk-first ordering (mandat Bartka): oba silent-failure classes zamknięte zanim UX/DS praca mogła na nich budować.
- Handoff-driven autonomous run: 3 sesje kontynuowane z pliku HANDOFF bez utraty kontekstu; „NIE re-dispatchuj zmergowanej pracy" + git log jako ground truth.
- Post-review fix chain (opus review → sonnet fixer → opus verifier) domykał fazy z 0 otwartych findings — w fazie 20 review złapał realny false-green (CR-01 exit 0 mimo CORRUPTED).
- Inline-fixture probes zamiast driver.executeScript() — usunęły całą klasę artefaktów pomiarowych WebDriver.

### What Was Inefficient
- v0.2 bez formalnego close odbiło się czkawką przy v0.3 close: `milestone.complete` zgarnął fazy 8–13 do archiwum v0.3 i zawyżył staty w MILESTONES.md (13 faz/72 plany) — wymagało ręcznej korekty na 7/29 i przeniesienia do `v0.2-phases/`.
- decision-coverage parser nie czyta prose-form decisions (3 fazy wymagały override z checker-evidence) — znany, powtarzalny koszt.
- Świeże worktree executorów wymagały każdorazowego bootstrapu (rsync node_modules + build-wasm + wxt prepare) — zautomatyzowany wzorzec, ale wciąż per-worktree koszt.

### Patterns Established
- Threat model w każdym PLAN (STRIDE register) → secure-phase L1 short-circuit z grep-weryfikacją mitigacji.
- SHA-pinned GitHub Actions + `permissions: contents: read` + zero exit-swallowing jako standard CI dla projektu o profilu password-managera.
- Fail-fast na sekretach harnessu (żadnych commitowanych defaultów haseł; env-var contract w README musi zgadzać się z kodem).

### Key Lessons
1. Zamykaj milestone formalnie od razu — odroczony close v0.2 skaził staty i archiwizację następnego.
2. Mierz przez realną powierzchnię (inline `<script>` fixture), nie przez tooling (executeScript) — inaczej root-causujesz artefakty pomiaru.
3. Regression gate musi failować procesem (exit code), nie tylko logiem — CR-01 pokazał, że „permanent gate" z exit 0 to false-green.

### Cost Observations
- Model mix: executor=sonnet, reviewer/verifier/auditor/integration=opus, Fable jako orchestrator (standing policy).
- Notable: fix chain + weryfikacja per faza w jednej sesji; largest single-agent runs ~100–120k tokenów (review/fix).

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v0.1 | multiple | 7 | Established the GSD workflow-orchestrated pipeline (background Workflow fan-outs, Opus-verify/Sonnet-execute split, self-driven Playwright UAT). |
| v0.2 | multiple | 6 | Live-debug na realnym Firefox/Zen jako brakująca warstwa weryfikacji; brak formalnego close (nauczka do v0.3). |
| v0.3 | 3 (autonomous) | 7 | Handoff-driven autonomous run; risk-first ordering; per-phase review→fix→verify→validate→secure chain domykany w jednej sesji. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v0.1 | ~101 Rust workspace + 339 web vitest | all phases verified passed, 5/5 E2E flows wired | papaparse (CSV), totp-rs (TOTP), tower-http fs (static serve) |
| v0.3 | 153+ Rust workspace + 481 web + 693 ext vitest + 6 live-FF probe lanes + CI gate | 20/20 reqs, 7/7 verified + Nyquist + secured, 5/5 integration | zero nowych zależności package-manager (SHA-pinned Actions only) |

### Top Lessons (Verified Across Milestones)

1. (v0.1) Commit verification artifacts last to avoid the staleness gate.
2. (v0.1) Independent adversarial verification catches what single-pass verification misses.
3. (v0.3) Zamykaj milestone'y formalnie na bieżąco — odroczony close poprzedniego psuje archiwizację następnego.
4. (v0.3) Bramki regresyjne muszą failować exit-codem; log-only „gate" to false-green.
