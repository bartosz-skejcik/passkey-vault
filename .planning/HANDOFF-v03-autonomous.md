# HANDOFF — /gsd-autonomous --from 16 (v0.3), 2026-07-21 (updated)

**Stan:** Fazy 16, 17, 18, **19 = COMPLETE + sealed** (verified/validated/secured/reviewed). Faza **20 (OSTATNIA) = zaplanowana + poprawiona po checkerze; Wave 1 W TRAKCIE** (3 executory w worktree'ach). Po fazie 20 → **lifecycle milestone'u v0.3**.

## NATYCHMIASTOWE KROKI (nowa sesja)

1. **Odbierz 3 executory Wave 1 fazy 20** (base `b5d9b596b1f33048c6d5ccd876d57deddaf73136`, manifest `/var/folders/pm/7cfyh_553n554l9880l7y2rw0000gn/T/gsd-worktree-wave-Io74a3.json`):
   - 20-01 QA-04 (Rust base64url byte-shape test) — agent `adf9e1740b86e73a7`
   - 20-02 QA-02 (wire 2 probe npm scripts + README lanes) — agent `a880a21eb992424bd`
   - 20-03 (macOS-passkey-sheet todo → ff-profile-prefs helper) — agent `a3505a8be4a7b5875`
   - Sprawdź SUMMARY.md w każdym worktree + git log. `worktree.record-agent` każdego (agent-id, path, branch worktree-agent-<id>, base b5d9b596), potem `worktree.cleanup-wave`.
2. **Post-merge gate Wave 1:** `cargo test --workspace` + `cd extension && npx wxt prepare && npx vitest run && npx tsc --noEmit`.
3. **Tracking** 20-01/02/03 complete + commit.
4. **Wave 2:** dispatch executora **20-04** (QA-01 `.github/workflows/ci.yml` + web `compile` script; depends_on 20-01/02/03 — konflikt files_modified). NOWA baza = HEAD po merge Wave 1. Prompt jak w tej sesji (worktree_branch_check z nową bazą). Plan sam robi lokalny full-gate „green vs main" (brak git remote → lokalny przebieg to osiągalny dowód, cloud-run flagowany jako follow-up).
5. **Post-Wave-2:** post-merge gate → code review (opus; scope: .github/workflows/ci.yml, web+ext package.json, crates/pv-provider/tests/response_shape.rs, e2e-firefox/README + 2 probe .cjs, ff-profile-prefs.cjs) → fix chain jeśli findings → gsd-verifier (opus) → phase.complete 20 → transition (PROJECT.md Validated wpis, STATE evolve, validate-phase → 20-VALIDATION status:validated+green map+audit, secure-phase → 20-SECURITY.md z threat modeli 4 planów).
6. **LIFECYCLE v0.3 (wszystkie 13 faz gotowe):** `Skill(gsd-audit-milestone)` → odczyt `.planning/v0.3-MILESTONE-AUDIT.md` status → passed=auto-continue / gaps_found|tech_debt=AskUserQuestion (CTRL-01) → `Skill(gsd-complete-milestone, "v0.3")` → `Skill(gsd-cleanup)` (własna bramka dry-run) → final banner „MILESTONE COMPLETE 🎉".
7. **Sprzątanie po całości:** usuń ten plik + wpis STATE Session Continuity; zaktualizuj memory `milestone-v03-autonomous-run.md` na complete.

## KONTEKST OPERACYJNY (bez zmian od poprzedniego handoffu)
- Dev stack Bartka: pv-server :8620 (`PV_STATIC_DIR=$PWD/web/out`, `PV_EXTENSION_ORIGINS=moz-extension://038e998f-316d-4d3e-8333-e732cce092c2,moz-extension://ec993803-582d-4d5a-92c1-06c6d2fd5bb7`) + next dev :3000. web/out bywa kasowany → `cd web && NEXT_PUBLIC_API_BASE_URL="" npm run build`.
- Modele: executor=sonnet, checker/verifier/reviewer/auditor=opus. Worktree bootstrap: rsync node_modules + `npm ci` w packages/pv-ui + build-wasm.sh + wxt prepare. Hygiene-fixy checkera inline. decision-coverage `could-not-parse` = znany precedens (override, STATE nota).
- Firefox probe'y: NIE w cloud CI (lokalne/self-hosted lanes, PV_EXTENSION_ORIGINS konkretne po SEC-02); konto uat-prf04@example.local / CorrectHorseBattery-UAT-2026!.
- CI supply-chain job: `cargo install cargo-audit@0.22.2 cargo-deny@0.20.2 --locked` na runnerze (R-19-03).
