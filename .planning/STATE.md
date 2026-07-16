---
gsd_state_version: 1.0
milestone: v0.2
milestone_name: Browser Extension
current_phase: 11
current_phase_name: Generate & Capture
status: planning
stopped_at: Completed 10-09-PLAN.md
last_updated: "2026-07-16T09:18:52.703Z"
last_activity: 2026-07-16
last_activity_desc: Phase 10 complete, transitioned to Phase 11
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 33
  completed_plans: 18
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-14)

**Core value:** Lekki self-hostable vault (1 kontener + wtyczka), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.
**Current focus:** Phase 10 — Autofill — Login, TOTP, Card & Identity

## Current Position

Phase: 11 — Generate & Capture
Plan: Not started
Status: Ready to plan
Last activity: 2026-07-16 — Phase 10 complete, transitioned to Phase 11

Progress: [██████░░░░] 55%

## Performance Metrics

**Velocity:**

- Total plans completed: 18 (all v0.1 — see milestones/v0.1-ROADMAP.md for per-phase breakdown)
- Average duration: - min
- Total execution time: 0 hours (v0.2)

**By Phase (v0.2):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 8. Bootstrap & WASM Spike | TBD | - | - |
| 9. Session/Unlock/Popup/Sync | TBD | - | - |
| 10. Autofill | TBD | - | - |
| 11. Generate & Capture | TBD | - | - |
| 12. Passkey Provider | TBD | - | - |
| 13. Dual-Browser Hardening | TBD | - | - |
| 8 | 3 | - | - |
| 9 | 8 | - | - |
| 10 | 7 | - | - |

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 08 P01 | 20min | 2 tasks | 14 files |
| Phase 08 P02 | 7min | 3 tasks | 7 files |
| Phase 08 P03 | 10min | 2 tasks | 5 files |
| Phase 09 P03 | 20min | 2 tasks | 3 files |
| Phase 09 P02 | 10min | 3 tasks | 8 files |
| Phase 09 P04 | 25min | 2 tasks | 7 files |
| Phase 09 P05 | 55min | 3 tasks | 13 files |
| Phase 09 P08 | 55min | 4 tasks | 15 files |
| Phase 09 P06 | ~90min | 3 tasks | 24 files |
| Phase 10 P01 | 30min | 3 tasks | 9 files |
| Phase 10 P09 | 25min | 3 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap (v0.2): 6 phases derived directly from research's build order — bootstrap/WASM-in-background spike first (de-risks idle-kill + CSP before any feature), session/unlock core+popup+sync second (real vault access before autofill/provider touch it), autofill third, generate & capture fourth, passkey provider fifth (deliberately LAST — highest-risk MAIN-world patch, gated by a `/gsd-secure-phase` security-review checkpoint), dual-browser hardening closes the milestone.
- Roadmap (v0.2): FILL-03/FILL-04 (card/identity autofill) kept in-milestone per REQUIREMENTS.md even though research's FEATURES.md flagged them P2 "add after validation" — REQUIREMENTS.md is the authoritative scope source and lists them as v0.2, not deferred.
- Roadmap (v0.2): Two cross-cutting technical items threaded through phases rather than given their own phase — `pv-server` CORS allowlist for the extension origin (small server change, surfaces in Phase 9's sync client) and unlocked-key-in-`chrome.storage.session`-only (never `storage.local`; established in Phase 9, must hold through Phases 10 and 12).
- [Phase ?]: Package legitimacy checkpoint (wxt@0.20.27, @wxt-dev/browser@0.2.2) approved by Bartek before install — [SUS] flag was a too-new heuristic false-positive.
- [Phase ?]: Firefox MV2 background (D-08) kept as WXT's own default split vs Chrome MV3 service worker; no manifestVersion override added.
- [Phase ?]: gecko.id fixed to literal 'passkey-vault@extension.local' (D-09); strict_min_version deferred to Phase 13.
- [Phase ?]: wasm-loader.ts re-exports WasmUserKey as a value (not type-only) so vault-session.ts can call WasmUserKey.generate() directly
- [Phase ?]: vault-session.ts uses a fixed spike password + injected SessionStorage dependency to prove chrome.storage.session round-trip survival, mirroring web/'s memoized initCrypto()/lock-state singleton patterns
- [Phase ?]: Firefox MV2 background.persistent must be set via defineBackground() in background.ts, not wxt.config.ts, to appear in the generated manifest
- [Phase ?]: 09-03: server-config.ts is the sole pv-server base-URL source; EXT-05 completion deferred to 09-07 (this plan only delivers client-side config + validation, not REST/WS call sites or server CORS)
- [Phase ?]: 09-03: Firefox MV2 manifest strips optional_host_permissions entirely (WXT's mv3OnlyKeys) -- Firefox-side runtime permission parity deferred to Phase 13 (dual-browser-hardening)
- [Phase 09]: 09-02: background.ts (not entrypoints/background/index.ts) is Phase 8's real WXT background entrypoint -- edited the actual file; router.ts added as a second, independent onMessage listener alongside the untouched Phase-8 spike.roundtrip listener — WXT treats a directory index.ts as an alternate way to define the same entrypoint; creating both risks a duplicate background entrypoint. Confirmed via both wxt build -b chrome/-b firefox producing exactly one background.js each.
- [Phase 09]: 09-02: lockVaultSession() clears ONLY the key envelope, never the session-meta record (token/email/idle-minutes) -- the bearer token survives an auto-lock so session.status's locked branch is reachable — Blocker-2 fix in the plan itself; matches v0.1's own posture (UnlockOverlay.tsx re-derives the key from an existing token after a lock, never re-logs-in).
- [Phase ?]: unlock.ts's handleUnlockPassword uses one function with an optional email argument (undefined=unlock-only via me(), provided=sign-in via login()) so router.ts dispatches both unlock.password and auth.signIn.password to the same implementation
- [Phase ?]: prf.ts duplicates a tiny local base64Decode instead of importing auth-api.ts's, keeping the popup-importable PRF helper module free of any background-context (chrome.storage) dependency
- [Phase ?]: wasm-loader.ts gained a deriveAuthMaterial re-export (Rule 3 fix, mirrors 09-02's precedent) since it is the sole choke-point importer of the generated WASM bindings
- [Phase ?]: Exported apiFetch from auth-api.ts so vault-api.ts reuses base-URL/auth-header logic instead of duplicating it (mirrors web/'s lib/auth/api.ts -> lib/vault/api.ts relationship)
- [Phase ?]: vault-store.ts exports applySyncSnapshot directly (unlike v0.1's module-private version) for direct testability; the lock-state wiring is tested separately via the real registered listener
- [Phase ?]: EXT-04 left unmarked in REQUIREMENTS.md -- this plan delivers only the backing sync/store/search engine; full completion (popup UI) is Plan 09-06's job, same precedent as 09-03 leaving EXT-05 unmarked
- [Phase ?]: Extension-scoped PRF passkey enrollStart guards via cheap isSessionUnlocked(); enrollFinish re-guards via ensureHydrated()+getUnlockedUserKey() before wrapping the current UK
- [Phase ?]: 09-06: popup replaces Phase 8's vanilla debug harness with React+DaisyUI+Tailwind v4 (reused web theme), thin sendMessage-only dispatch layer per D-05
- [Phase ?]: 09-06: UnlockView dispatches ONLY unlock.extPrf.*/09-08's ext-scoped PRF kinds per the AMENDMENT -- never 09-04's web-RP unlock.prf.*/auth.signIn.prf.* -- Sign-in variant has no PRF button this phase
- [Phase ?]: 09-06: popup header/footer redirects (settings gear, full-screen, + new-item) are pure browser.tabs.create opens of config.get's baseUrl -- no in-popup settings/create UI, per Bartek's NordPass-reference decision
- [Phase ?]: 10-01: itemMatchesOrigin() extends web/src/lib/vault/search.ts's domainFromUrl() parsing shape (not a literal import -- unexported, hostname-only, permissive fallback) with full URL#origin equality that fails closed on unparseable stored URLs -- an access-control gate must never treat a parse failure as a match
- [Phase ?]: 10-01: totp items always return false from itemMatchesOrigin() -- TotpFields has no stored URL field to compare; TOTP codes reach the popup via the separate autofill.totpCode message keyed by itemId, not this origin gate
- [Phase ?]: 10-01: requirements-completed left empty for FILL-01..04 -- this plan builds only the contract/gate layer shared by all four fill kinds, matching Phase 9's EXT-04/EXT-05 precedent of not marking a requirement complete until user-facing functionality lands
- [Phase ?]: [Phase 10]: 10-09: registerAutofillFrameChannel() is a SECOND, independent runtime.onMessage listener from registerMessageRouter() -- content scripts reach ONLY autofill.matchFrame/autofill.fillFrame via assertContentSender()'s guard, never session.*/vault.*; the popup router's WR-01 gate stays textually unchanged
- [Phase ?]: [Phase 10]: 10-09: autofill-match.ts's EMPTY_DETECTED/asFillKind/maskedHintFor/buildFillValues exported (not duplicated) for autofill-frame.ts to reuse -- one shared decrypt/lookup/derive surface for both the popup-driven and content-frame-driven autofill channels

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Research flags PRF browser/OS support matrix as a moving target — re-verify current-state support at Phase 12 (Passkey Provider) planning time, not from the 2026-07-14 research snapshot.
- ARCHITECTURE.md flags `chrome.storage.session` TTL/eviction semantics (survives extension update? idle-time-only eviction?) as needing hands-on verification during Phase 8/9 planning, not assumed from docs.
- WASM loading inside content-script bundling context specifically (vs. background/popup) is unverified per research STACK.md — validate during Phase 8's bootstrap spike if autofill (Phase 10) ends up needing `pv-core` decrypt calls close to the DOM.

## Deferred Items

Items acknowledged and deferred at v0.1 milestone close on 2026-07-14 (override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| uat | Phase 07 container/proxy E2E — ✅ RESOLVED 2026-07-14: Docker installed (Colima), full E2E run live and PASSED (build, compose persistence+WAL, SIGTERM 1s, nginx+Caddy WS + WR-02 token-log redaction). Surfaced+fixed 6 real bugs incl. a Caddy WR-02 token-leak (a716f80, 4e0ee37, f6ae439). Only the browser passkey-ceremony-behind-proxy remains a manual Playwright item. See 07-UAT.md. | resolved | 2026-07-14 |
| uat | Phase 05 UAT | passed (0 pending scenarios) | 2026-07-14 |
| uat | Phase 06 UAT | passed (0 pending scenarios) | 2026-07-14 |
| todo | 2026-07-12-ui-review-phase1-fixes — 3 WARNING UI findings (light-theme base-300 surface borders, SelfTestCard fatal-branch retry, "patrz błąd poniżej" copy order) — cosmetic, v0.2 polish candidates | open | 2026-07-14 |
| tech-debt | IMPEX-04 CSV export lossy for non-default TOTP (algorithm/digits/period dropped; JSON lossless) — see v0.1-MILESTONE-AUDIT.md W-1 | open | 2026-07-14 |

## Session Continuity

Last session: 2026-07-15T21:33:03.690Z
Stopped at: Completed 10-09-PLAN.md
Resume file: None

## Operator Next Steps

- Execute Wave 3 (09-04, 09-05) with `/gsd-execute-phase 09`
