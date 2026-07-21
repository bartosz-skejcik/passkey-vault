---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: Polish & Hardening
current_phase: 20
status: completed
stopped_at: context exhaustion at 75% (2026-07-21)
last_updated: "2026-07-21T15:44:19.036Z"
last_activity: 2026-07-21
last_activity_desc: Phase 20 complete
progress:
  total_phases: 13
  completed_phases: 12
  total_plans: 72
  completed_plans: 70
  percent: 92
current_phase_name: Test Infrastructure & CI Gate
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-21)

**Core value:** Lekki self-hostable vault (1 kontener + wtyczka), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.
**Current focus:** Phase 20 — Test Infrastructure & CI Gate

## Current Position

Phase: 20
Plan: Not started
Status: All phases complete
Last activity: 2026-07-21 — Phase 20 complete

## Performance Metrics

**Velocity:**

- Total plans completed: 70 (all v0.1 — see milestones/v0.1-ROADMAP.md for per-phase breakdown)
- Average duration: - min
- Total execution time: 0 hours (v0.3)

**By Phase (v0.2 — complete):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 8. Bootstrap & WASM Spike | 3 | - | - |
| 9. Session/Unlock/Popup/Sync | 8 | - | - |
| 10. Autofill | 7 | - | - |
| 11. Generate & Capture | 9 | - | - |
| 12. Passkey Provider | 7 | - | - |
| 13. Dual-Browser Hardening | 7 | - | - |
| 14 | 3 | - | - |
| 15 | 7 | - | - |
| 16 | 6 | - | - |
| 17 | 4 | - | - |
| 18 | 2 | - | - |
| 19 | 3 | - | - |
| 20 | 4 | - | - |

**By Phase (v0.3 — planned, not yet executed):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 14. Critical Risk Closure | TBD | - | - |
| 15. Login & Unlock Unification | TBD | - | - |
| 16. Design System Extraction (Logic/i18n) | TBD | - | - |
| 17. Shared Component & Visual Alignment | TBD | - | - |
| 18. Firefox Window & Consent Hardening | TBD | - | - |
| 19. Server & Supply-Chain Hardening | TBD | - | - |
| 20. Test Infrastructure & CI Gate | TBD | - | - |

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
| Phase 13 P01 | 12min | 3 tasks | 3 files |
| Phase 13 P05 | 35min | 3 tasks | 12 files |
| Phase 13-dual-browser-hardening P02 | 25min | 2 tasks | 7 files |
| Phase 13 P03 | 4h | 2 tasks | 10 files |
| Phase 13 P04 | ~5.5h | 2 tasks | 9 files |
| Phase 13 P06 | ~4h | 3 tasks | 20 files |
| Phase 14 P03 | ~50min | 3 tasks | 5 files |
| Phase 15 P07 | 190 | 3 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 15 planning] decision-coverage-plan gate override: CONTEXT.md decisions are prose-form (no D-NN tokens) so the parser extracted 0; compliance was verified instead by ui-checker (4/4 locked decisions honored) and plan-checker (full context compliance, 3 iterations). Verify-phase may re-surface this — treat as resolved-by-checker-evidence.
- [Phase 16 planning] decision-coverage-plan gate override (same Phase 15 precedent): CONTEXT.md decisions are prose-form so the parser extracted 0; plan-checker verified full context compliance (0 blockers — all locked architectural decisions explicitly honored across 6 plans). Treat as resolved-by-checker-evidence.
- [Phase 19 planning] decision-coverage-plan gate override (same precedent): prose-form CONTEXT decisions, parser extracted 0; plan-checker verified full coverage (1 blocker fixed: missing VALIDATION.md; SEC-01..04 all traced). Resolved-by-checker-evidence.

- Roadmap (v0.3): 7 phases (14–20) derived from `.planning/research/v0.3/CODEBASE-GAPS.md` + `DESIGN-SYSTEM-UNIFICATION.md`. Phase 14 is risk-first per Bartek's explicit mandate — the two Critical findings (XBR-02 Firefox response-direction cross-realm corruption, QA-03 no real-RP-verified provider ceremony) are closed BEFORE any UX/design-system work, since both are silent-failure classes a green v0.2 CI could not see. Phase 15 unifies login/unlock onto the Vaultwarden model (AUTH-01..04). Phases 16–17 extract the shared design system into `packages/pv-ui` in the research's measured order — pure logic/types + i18n engine first (16), then the flagship shared React component `ItemIconTile` + in-page token alignment + light-tile UX-01 (17), since DS-03 and UX-01 share the tile concept. Phase 18 formalizes Firefox ceremony-window polish (UX-02) and decision-gates the in-page consent alternative (XBR-03 — may resolve as "rejected-with-reason", not a guaranteed build). Phase 19 batches the CORS touch (SEC-01/02) with server/supply-chain hardening (SEC-03/04). Phase 20 closes the CI/test-rigor gap (QA-01/02/04). 20/20 v0.3 requirements mapped, no orphans, no duplicates.
- Roadmap (v0.3): v0.2's milestone header changed from "in progress" to "complete, not formally closed" in ROADMAP.md to reflect reality (phase 13 sealed 2026-07-20) without running `/gsd-complete-milestone` — cleanup/retrospective for v0.2 stays deliberately deferred to v1.0 per PROJECT.md.
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
- [Phase ?]: 13-01: strict_min_version pinned to '115.0' (browser.storage.session floor); gecko.id left byte-for-byte unchanged (passkey-vault@extension.local)
- [Phase ?]: 13-01: Firefox host-permission pre-declaration moved to optional_permissions (shared MV2/MV3 key) since WXT strips optional_host_permissions (MV3-only) for Firefox MV2; Chrome's optional_host_permissions branch untouched
- [Phase ?]: D-10: pv-server accepts moz-extension://* as scheme-scoped wildcard PATTERN via AllowOrigin::predicate (never loosening bare-* WR-07 rejection); logged as active tech-debt
- [Phase ?]: D-11: ServerConfigView distinguishes cors-blocked from unreachable via a no-cors retry probe, showing the extension's own copyable origin + PV_EXTENSION_ORIGINS pointer
- [Phase ?]: 13-02: unlock.passkeyUnsupported now holds D-13 canon PL+EN copy, single shared string for all popup PRF-unusable cases
- [Phase ?]: 13-02: D-12 session-scoped unusable flag named prfUnusableThisSession (UnlockView) and Phase value "unusable" (EnrollExtPasskeyPrompt) -- never hides the passkey button, only disables it after an observed non-cancel ceremony failure
- [Phase ?]: 13-03: headed Chromium (not headless) required for Phase 12 provider ceremony to resolve reliably in this test environment
- [Phase ?]: 13-03: crates/pv-provider now enables passkey-client's allows_insecure_localhost for local-RP testing and self-hosted-dev use
- [Phase ?]: 13-04: wxt.config.ts:56-64 ext-scoped rpId-on-Firefox question closed — Firefox rejects WebAuthn from any moz-extension:// page (SecurityError, rpId-independent); existing D-12/D-13 disabled+explainer handling already covers it, no code change needed
- [Phase ?]: 13-06: server-ceremony button visibility widened beyond the plan's literal D-12 wording to also include import.meta.env.FIREFOX (a static known-impossible signal) -- an ext-scoped enrollment attempt requires the same create() ceremony that also fails on Firefox, so gating purely on the dynamic prfUnusableThisSession signal would make the button permanently unreachable for the browser it exists for
- [Phase ?]: 13-06: found and routed around (not fixed -- out of scope) a pre-existing web/.env.local NEXT_PUBLIC_API_BASE_URL=127.0.0.1 misconfiguration that broke same-origin fetch() on localhost:8620 in every web/out build; flagged for Bartek's own .env.local review
- [Phase ?]: [quick-260718-0qi] Task 2's FAB relocation to bottom-right required flipping the type-menu anchor from left-0 to right-0 (Rule 1 bug fix) -- a left-0-anchored w-44 menu would overflow past the 380px popup width once the FAB moved to the right edge
- [Phase ?]: [quick-260718-0qi] P9-SC5/SC7 e2e failures were downstream cascades of P9-SC2's ambiguous-select strict-mode violation (shared worker-scoped popup left on the wrong screen), not independent bugs -- fixing the Step 2 selector disambiguation alone restored all 7 Phase 9 SCs, confirmed via 3 zero-flake re-runs
- [Phase ?]: 13-07: session token needs no base64url boundary (opaque bearer string); signin mode reuses setUnlockedUserKey's own writeSessionMeta call, no separate persist path
- [Phase ?]: 14-03: response-direction Firefox instanceof/toString.call battery must be measured via a genuinely inline <script> RP fixture (never driver.executeScript()) -- geckodriver runs executeScript-injected code in a fresh per-call sandbox realm with its own ArrayBuffer global, producing false-negative instanceof readings against page-realm-constructed values
- [Phase ?]: 14-03: run-core.cjs's three unguarded switchTo(popupHandle) calls fixed for quick-260720-16k's same-day consent-window self-close behavior (Rule 3 blocking-issue fix, out-of-scope file but required for Task 3's mandatory green gate suite)
- [Phase ?]: Plan 15-07 found + fixed two live product bugs (migration-dialog unmount race, unbounded permission-prompt hang) that only a real live-browser AUTH-04 proof could catch
- [Phase 16]: exports map w packages/pv-ui/package.json jest JEDYNYM źródłem resolucji subpathów (WR-02: pv-ui paths usunięte z web/tsconfig.json — TS 5.9 moduleResolution:bundler czyta exports bezpośrednio); nowy subpath = tylko wpis w exports map
- [Phase 16]: i18n engine jest generyczny (`t<D>(dict, locale, key)` w pv-ui/i18n/engine.ts); konsumenci trzymają cienkie 2-arg wrappery zachowujące keyof narrowing; 4 klucze o rozbieżnej kopii (vault.emptyHeading, vault.emptyBody, search.emptyResults, autolock.label) celowo lokalne — NIE przenosić do common.ts
- [Phase 16]: interpolate() sprawdza hasAnyToken na oryginalnym szablonie (WR-01) — nie mylić częściowej substytucji z pełnym fallbackiem; regression test w 3 kopiach engine.test.ts
- [Phase 16]: świeży worktree executora wymaga bootstrapu: node_modules (rsync/npm ci), scripts/build-wasm.sh, npx wxt prepare — standardowy wzorzec dla przyszłych faz
- [Phase 17]: pv-ui ma WŁASNE node_modules (Option A — react/react-dom/lucide-react/@types/react, package-lock.json commitowany) bo pakiety bez exports map (lucide-react) nie resolvują się przez symlink; konsekwencja: KAŻDY bundler resolvujący realpath musi dedupe'ować React — wxt.config.ts vite.resolve.dedupe (build), oba vitest.config.ts (testy); web działa przez wewnętrzny vendored-React alias Next 16 (nieudokumentowany — kontrakt w packages/pv-ui/README.md)
- [Phase 17]: --pv-tile-bg/--pv-tile-fg w tokens.css to JEDYNE źródło koloru kafelka ikony; React ItemIconTile czyta je przez bg-[var(--pv-tile-bg)] (WR-04 celowo odwrócił prohibicję planu 17-03); harness parytetu: extension/e2e-visual/capture-tile-parity.mjs (npm run test:e2e:visual)
- [Phase 17]: overlay literal allowlist = dokładnie 8 (4 cienie rgba, 4 pill-radius 999px) — audyt w 17-04; nowy kafelek w generate-popover/save-toast musi użyć --pv-tile-*
- [Phase 18]: probe-window-geometry.cjs wymaga serwera z moz-extension://* wildcard (pinned UUID f6a7b8c9 profilu probe nie jest na allowliście koncretnego originu) + konta uat-prf04@example.local — zielony przebieg: izolowany pv-server (PV_SERVER env); dokumentacja lane'a dla Phase 20 CI
- [Phase 18]: XBR-03 = REJECT-WITH-REASON (verdict w 18-SECURITY.md + PROJECT.md Key Decisions); in-page consent panel NIE wraca bez nowych prymitywów platformy (post-v1.0)

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Research flags PRF browser/OS support matrix as a moving target — re-verify current-state support at Phase 12 (Passkey Provider) planning time, not from the 2026-07-14 research snapshot.
- ARCHITECTURE.md flags `chrome.storage.session` TTL/eviction semantics (survives extension update? idle-time-only eviction?) as needing hands-on verification during Phase 8/9 planning, not assumed from docs.
- WASM loading inside content-script bundling context specifically (vs. background/popup) is unverified per research STACK.md — validate during Phase 8's bootstrap spike if autofill (Phase 10) ends up needing `pv-core` decrypt calls close to the DOM.
- **RESOLVED 2026-07-17**: Quick task 260717-lnx's `headless: true` re-enable reproduced the historical `P12-SC1` headless hang (13-03-SUMMARY.md). Fix landed: `extension/playwright.config.ts` now splits into two projects — `chromium` (everything except Phase 12, headless) and `chromium-ceremony` (Phase 12 only, headed); `extension/e2e/fixtures.ts` picks the real `headless` flag from `workerInfo.project.name` (commit `b393f90`). A follow-up verification run then hit a SEPARATE issue — `P12-SC2` failed after 2 retries against a STALE `extension/.output/chrome-mv3` build (predating Task A's one-click-picker source change) — root-caused and fixed via a `pretest:e2e:chrome` npm script that rebuilds chrome before every e2e run (commit `ddc770f`). Whole `chromium-ceremony` project (5 SCs) now passes cleanly and repeatably (5 consecutive full-project runs, headed, zero flake); `npm test` stays 533/533 green. See `.planning/quick/260717-lnx-extension-ux-one-click-passkey-picker-no/260717-lnx-SUMMARY.md` and `.planning/phases/13-dual-browser-hardening/13-03-SUMMARY.md` for the original investigation.
- web/.env.local's NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620 breaks same-origin fetch() for any web/out build served/visited via http://localhost:8620 (this project's own documented convention) -- routed around this session via NEXT_PUBLIC_API_BASE_URL="" npm run build, not fixed in .env.local (out of scope, outside file-write permissions). Bartek should review/clean up this env var.
- **RESOLVED 2026-07-20**: XBR-02 (Firefox response-direction Xray hole) closed. Plan 14-02 fixed `page-bridge-firefox.ts`'s `shapeCredential()` to re-materialize every response-direction binary field as a genuine MAIN-world ArrayBuffer, then discovered mid-verification that the original `instanceof ArrayBuffer: false` signal was itself a WebDriver/geckodriver `executeScript` measurement artifact (a genuine inline `<script>` RP fixture showed correct behavior on both pre-fix and post-fix builds) — the fix was kept anyway as harmless defense-in-depth. Plan 14-03 closed the loop with two permanent, artifact-free proofs: a deterministic jsdom regression test (`page-bridge-firefox.test.ts`) and an upgraded live-Firefox probe (`probe-request-xray.cjs`, now hard-gating every response-direction `*IsArrayBuffer` field via a genuinely inline fixture, never `driver.executeScript()`). Full gate suite green (vitest 674/674, tsc clean, both builds, mainworld-boundary audit PASS, run-core.cjs 17 PASS+1 OBSERVED, run-server-unlock.cjs 15 PASS/2 INFO, probe-request-xray.cjs all PASS, chromium-ceremony 5/5, cargo test --workspace 151 passed). Doc moved to `.planning/debug/resolved/firefox-request-xray-hole.md`; Bartek's own live github.com retest of the original request-direction fix remains open at his leisure (not claimed as done).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260717-lnx | Extension UX: one-click passkey picker, NordPass-style inpage dropdown restyle, headless e2e fixture | 2026-07-17 | 115e68d | [260717-lnx-extension-ux-one-click-passkey-picker-no](./quick/260717-lnx-extension-ux-one-click-passkey-picker-no/) |
| 260718-0qi | Popup UI fix round: theme parity, FAB/footer/top-bar restructure, hover shadow removal, label/sort sizing, Phase 9 e2e repair | 2026-07-18 | 39754b3 | [260718-0qi-popup-ui-fix-round-theme-match-web-sideb](./quick/260718-0qi-popup-ui-fix-round-theme-match-web-sideb/) |
| 260719-sxa | Distinguish prf-unavailable terminal state from generic failed in server-origin passkey ceremony (ExtUnlockBridge + login.ts), both signin and unlock modes, with PL/EN copy and tests | 2026-07-19 | 20eaaf1 | [260719-sxa-distinguish-prf-unavailable-terminal-sta](./quick/260719-sxa-distinguish-prf-unavailable-terminal-sta/) |
| 260720-16k | Firefox aux windows feel like popups: centering, consent-window resize/self-close, candidate-list scroll cap, autofill-flash race fix | 2026-07-20 | 40d1965 | [260720-16k-firefox-aux-windows-feel-like-popups-cen](./quick/260720-16k-firefox-aux-windows-feel-like-popups-cen/) |

## Deferred Items

Items acknowledged and deferred at v0.1 milestone close on 2026-07-14 (override_closeout):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| uat | Phase 07 container/proxy E2E — ✅ RESOLVED 2026-07-14: Docker installed (Colima), full E2E run live and PASSED (build, compose persistence+WAL, SIGTERM 1s, nginx+Caddy WS + WR-02 token-log redaction). Surfaced+fixed 6 real bugs incl. a Caddy WR-02 token-leak (a716f80, 4e0ee37, f6ae439). Only the browser passkey-ceremony-behind-proxy remains a manual Playwright item. See 07-UAT.md. | resolved | 2026-07-14 |
| uat | Phase 05 UAT | passed (0 pending scenarios) | 2026-07-14 |
| uat | Phase 06 UAT | passed (0 pending scenarios) | 2026-07-14 |
| todo | 2026-07-12-ui-review-phase1-fixes — 3 WARNING UI findings (light-theme base-300 surface borders, SelfTestCard fatal-branch retry, "patrz błąd poniżej" copy order) — cosmetic, v0.2 polish candidates | open | 2026-07-14 |
| tech-debt | IMPEX-04 CSV export lossy for non-default TOTP (algorithm/digits/period dropped; JSON lossless) — see v0.1-MILESTONE-AUDIT.md W-1 | open | 2026-07-14 |
| tech-debt | `PV_EXTENSION_ORIGINS=moz-extension://*` scheme-scoped CORS wildcard stopgap (D-10, 13-05-PLAN.md) — accepted knowingly because CORS is not this API's auth boundary and Firefox's per-profile UUID churn makes concrete-origin-only config hostile UX; planned to be replaced with per-install concrete-origin configuration in a later version — **RESOLVED by SEC-02 (Phase 19, 2026-07-21)** — wildcard branch removed; concrete per-install origins only (WR-07 preserved); D-11 screen is the operator flow | resolved | 2026-07-17 |
| debug | RESPONSE-direction Firefox Xray hole (`.planning/debug/resolved/firefox-request-xray-hole.md`) — data intact, `instanceof ArrayBuffer` contract restored via MAIN-world re-materialization (Plan 14-02) + a WebDriver-artifact correction; permanent jsdom + live-Firefox regression coverage added (Plan 14-03) — v0.3 XBR-02 closed | resolved | 2026-07-20 |

## Session Continuity

Last session: 2026-07-21T14:36:37.288Z
Stopped at: context exhaustion at 75% (2026-07-21)
Resume file: .planning/HANDOFF-v03-autonomous.md

## Operator Next Steps

- Review the v0.3 roadmap (`.planning/ROADMAP.md`, Phases 14–20); once approved, start with `/gsd-plan-phase 14` (Critical Risk Closure — XBR-02 + QA-03).
