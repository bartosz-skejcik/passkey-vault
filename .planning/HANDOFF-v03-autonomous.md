# HANDOFF — /gsd-autonomous --from 16 (v0.3), 2026-07-21 (updated)

**Stan:** Fazy 16–19 sealed. Faza **20 (OSTATNIA): Wave 1 ZMERGOWANY + gate zielony** (pv-provider 2/2, ext vitest 693, tsc clean; 20-01 QA-04, 20-02 QA-02, 20-03 ff-profile-prefs — na main). **ZOSTAŁO: Wave 2 (20-04 CI) → review/verify/transition → lifecycle v0.3.**

## NATYCHMIASTOWE KROKI (nowa sesja)

1. **Wave 1 ZROBIONY** (zmergowany, zgate'owany, HEAD `16f70ca`). NIE powtarzaj — sprawdź `git log` (są 3 merge commity + tracking).
2. **Wave 2 (START TU):** dispatch executora **20-04** (QA-01 `.github/workflows/ci.yml` + web `compile` script). **BASE = `16f70ca`**. Nowy manifest. Prompt jak w tej sesji (worktree_branch_check z base 16f70ca). Prompt jak w tej sesji (worktree_branch_check z nową bazą). Plan sam robi lokalny full-gate „green vs main" (brak git remote → lokalny przebieg to osiągalny dowód, cloud-run flagowany jako follow-up).
5. **Post-Wave-2:** post-merge gate → code review (opus; scope: .github/workflows/ci.yml, web+ext package.json, crates/pv-provider/tests/response_shape.rs, e2e-firefox/README + 2 probe .cjs, ff-profile-prefs.cjs) → fix chain jeśli findings → gsd-verifier (opus) → phase.complete 20 → transition (PROJECT.md Validated wpis, STATE evolve, validate-phase → 20-VALIDATION status:validated+green map+audit, secure-phase → 20-SECURITY.md z threat modeli 4 planów).
6. **LIFECYCLE v0.3 (wszystkie 13 faz gotowe):** `Skill(gsd-audit-milestone)` → odczyt `.planning/v0.3-MILESTONE-AUDIT.md` status → passed=auto-continue / gaps_found|tech_debt=AskUserQuestion (CTRL-01) → `Skill(gsd-complete-milestone, "v0.3")` → `Skill(gsd-cleanup)` (własna bramka dry-run) → final banner „MILESTONE COMPLETE 🎉".
7. **Sprzątanie po całości:** usuń ten plik + wpis STATE Session Continuity; zaktualizuj memory `milestone-v03-autonomous-run.md` na complete.

## KONTEKST OPERACYJNY (bez zmian od poprzedniego handoffu)
- Dev stack Bartka: pv-server :8620 (`PV_STATIC_DIR=$PWD/web/out`, `PV_EXTENSION_ORIGINS=moz-extension://038e998f-316d-4d3e-8333-e732cce092c2,moz-extension://ec993803-582d-4d5a-92c1-06c6d2fd5bb7`) + next dev :3000. web/out bywa kasowany → `cd web && NEXT_PUBLIC_API_BASE_URL="" npm run build`.
- Modele: executor=sonnet, checker/verifier/reviewer/auditor=opus. Worktree bootstrap: rsync node_modules + `npm ci` w packages/pv-ui + build-wasm.sh + wxt prepare. Hygiene-fixy checkera inline. decision-coverage `could-not-parse` = znany precedens (override, STATE nota).
- Firefox probe'y: NIE w cloud CI (lokalne/self-hosted lanes, PV_EXTENSION_ORIGINS konkretne po SEC-02); konto uat-prf04@example.local / CorrectHorseBattery-UAT-2026!.
- CI supply-chain job: `cargo install cargo-audit@0.22.2 cargo-deny@0.20.2 --locked` na runnerze (R-19-03).
