# HANDOFF — /gsd-autonomous --from 16 (v0.3), 2026-07-21

**Stan:** Fazy 16, 17, 18 = COMPLETE + sealed (verified passed, validation validated, security 0 open, code review fixed, UI review gdzie dotyczy). Faza 19 = zaplanowana (3 plany), **Wave 1 W TRAKCIE** w dwóch worktree'ach. Faza 20 = nietknięta.

## NATYCHMIASTOWE KROKI WZNOWIENIA (nowa sesja)

1. **Poczekaj/odbierz wyniki dwóch executorów Wave 1 fazy 19** (uruchomione ~14:00, cold cargo build — kilka-kilkanaście min):
   - 19-01 (SEC-01/02 CORS): worktree branch `worktree-agent-a90e13b5c76aa881c`, ścieżka `.claude/worktrees/agent-a90e13b5c76aa881c`
   - 19-02 (SEC-04 counter): branch `worktree-agent-aad3bc319990f9a03`, ścieżka `.claude/worktrees/agent-aad3bc319990f9a03`
   - Sprawdź ukończenie: SUMMARY.md w `<worktree>/.planning/phases/19-server-supply-chain-hardening/` + git log worktree'a. Jeśli wciąż pracują — czekaj (git log --since ... aktywność).
2. **Zapisz + zmerguj wave 1** (manifest już zawiera orchestrator_root):
   ```bash
   GSD=~/.claude/gsd-core/bin/gsd-tools.cjs
   M=/var/folders/pm/7cfyh_553n554l9880l7y2rw0000gn/T/gsd-worktree-wave-rlheVx.json
   node $GSD query worktree.record-agent --manifest $M --agent-id 19-01 --path <wt-path-1> --branch worktree-agent-a90e13b5c76aa881c --base 48b6c51d98e5b365c8e276e739fefcb95511274a
   node $GSD query worktree.record-agent --manifest $M --agent-id 19-02 --path <wt-path-2> --branch worktree-agent-aad3bc319990f9a03 --base 48b6c51d98e5b365c8e276e739fefcb95511274a
   node $GSD query worktree.cleanup-wave --manifest $M   # z repo root, branch main
   ```
   (Jeśli manifest zniknął po reboocie: fail-closed — recovery per worktree-recovery-policy, NIE broad discovery.)
3. **Post-merge gate:** `cargo test --workspace` (Rust-only wave) + `cd extension && npx wxt prepare && npx vitest run && npx tsc --noEmit` sanity.
4. **Zaległe edyty STATE.md (odroczone z 19-01):** w Deferred Items oznacz wiersz D-10 (`PV_EXTENSION_ORIGINS=moz-extension://*` stopgap) jako **resolved-by-SEC-02 (Phase 19)**; dopisz do Decisions linijkę o decision-gate override fazy 19 (could-not-parse, precedens 15/16, plan-checker zweryfikował zgodność).
5. **Tracking:** `roadmap.update-plan-progress 19 19-01|19-02 complete` + commit "docs(phase-19): update tracking after wave 1".
6. **Wave 2:** dispatch executora 19-03 (supply-chain tooling; wave 2, depends_on 19-01 — konflikt na pv-server/Cargo.toml, dlatego sekwencyjnie). Wzorzec promptu executora = jak w tej sesji (worktree_branch_check z NOWĄ bazą po merge wave 1, bootstrap: cargo z worktree; cargo install cargo-audit@0.22.2 cargo-deny@0.20.2 dozwolone — oficjalne narzędzia RustSec/Embark).
7. **Po wave 2:** code review (opus, scope z SUMMARY key-files) → fix chain (critical_warning) → gsd-verifier (opus) → phase.complete 19 → transition (PROJECT.md wpis Validated, STATE evolve) → validate-phase (uzupełnij 19-VALIDATION: statusy ✅ green, status: validated, audit trail) → secure-phase (19-SECURITY.md z rejestrów threat modeli 3 planów — wzór z faz 16/17).
8. **Faza 20 (Test Infrastructure & CI Gate, QA-01/02/04):** pełny pipeline: smart discuss (infrastruktura → minimal CONTEXT bez pytań) → VALIDATION.md przy planowaniu (nie zapomnij — w 19 checker złapał brak!) → research → plan → checker → execute → review → verify → transition. UWAGA: lane'y probe wymagają dokumentacji env po SEC-02 (konkretne originy — patrz STATE notka Phase 18).
9. **Lifecycle po fazie 20:** `Skill(gsd-audit-milestone)` → routing wg statusu (gaps/tech_debt → AskUserQuestion) → `Skill(gsd-complete-milestone, "v0.3")` → `Skill(gsd-cleanup)`. Final banner.

## KONTEKST OPERACYJNY

- **Dev stack Bartka (utrzymywać!):** pv-server :8620 (`PV_STATIC_DIR=$PWD/web/out`, `PV_EXTENSION_ORIGINS=moz-extension://ec993803-582d-4d5a-92c1-06c6d2fd5bb7` — konkretny origin, ważny też po SEC-02) + `next dev` :3000 (ostatnio widziany 500 — może wymagać `rm -rf web/.next` i restartu; wcześniejszy crash Turbopack cache). Restart serwera po merge SEC-02: ten sam env działa.
- **web/out** bywa kasowany przez harness 17-04 (freshness check) — odbudowa: `cd web && NEXT_PUBLIC_API_BASE_URL="" npm run build` (obejście znanego problemu .env.local).
- **Wzorce sesji:** executor=sonnet, checker/verifier/reviewer/auditor=opus (memory: subagent-model-policy). Worktree bootstrap: rsync node_modules z main checkout, `npm ci` w packages/pv-ui, `scripts/build-wasm.sh`, `npx wxt prepare`. Heartbeaty `[checkpoint] phase.. wave..` między krokami. Hygiene-fixy checkera (RESOLVED markers w RESEARCH, wypełnienie VALIDATION map) rób inline, nie przez replan.
- **Playwright UAT authorized** (memory): human_needed items self-validuj + screenshoty do `<phase>/uat-screenshots/` (commitowane).
- **Probe window-geometry (faza 18):** wymaga serwera z originem `moz-extension://f6a7b8c9-d0e1-4234-a567-89abcdef0123` (pinned UUID) LUB (do SEC-02) wildcard; konto `uat-prf04@example.local` / `CorrectHorseBattery-UAT-2026!` musi istnieć na serwerze; env `PV_SERVER` (nie SERVER!).
- **Grey areas zaakceptowane przez Bartka:** Phase 17 tile (wszystkie przyjęte), Phase 18 XBR-03 conservative (przyjęte). Phase 19/20 = infrastruktura, bez pytań.
- **Postęp bar:** 16✅ 17✅ 18✅ (banner „GSD ► AUTONOMOUS ▸ Phase N/13 (k/5)").

## PO ZAKOŃCZENIU CAŁOŚCI
Zaktualizuj memory `milestone-v01-progress.md` (lub nową notkę v0.3) i usuń ten plik handoff + wpis w STATE.md Session Continuity.
