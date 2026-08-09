---
gsd_state_version: 1.0
milestone: v0.4
milestone_name: Family & Sharing
current_phase: 27
current_phase_name: Extension Integration — Shared Items
status: verifying
stopped_at: Completed 27-14-PLAN.md (gap closure, access-level live coverage + EXT-07 fill + flake fix)
last_updated: "2026-08-09T10:18:14.842Z"
last_activity: 2026-08-09
last_activity_desc: 27-14-PLAN.md executed
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 61
  completed_plans: 60
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-31)

**Core value:** Lekki self-hostable vault (1 kontener + wtyczka), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.
**Current focus:** Phase 27 — Extension Integration — Shared Items

## Current Position

Phase: 27 (Extension Integration — Shared Items) — GAP CLOSURE
Plan: 14 of 14 (gap-closure plans 12-14, from 27-VERIFICATION.md's gaps_found)
Status: 27-12 complete (Blocker 1 closed); 27-14 complete (Gaps 3/4/5 closed) — 27-13 remaining (independent, depends_on: [])
Last activity: 2026-08-09 — 27-14-PLAN.md executed

## Performance Metrics

**Velocity:**

- Total plans completed: 94 (all v0.1 — see milestones/v0.1-ROADMAP.md for per-phase breakdown)
- Average duration: - min
- Total execution time: 0 hours (v0.3)

**By Phase (v0.2 + v0.3 — complete, archived):**

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
| 21 | 5 | - | - |
| 22 | 5 | - | - |
| 23 | 6 | - | - |
| 24 | 8 | - | - |

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
| Phase 24 P01 | 25min | 2 tasks | 6 files |
| Phase 24 P02 | 45min | 2 tasks | 6 files |
| Phase 24 P03 | 20min | 1 tasks | 1 files |
| Phase 24 P04 | 45min | 2 tasks | 2 files |
| Phase 24 P05 | 40min | 3 tasks | 10 files |
| Phase 24 P06 | 40min | 2 tasks | 4 files |
| Phase 24 P07 | ~55min | 2 tasks | 6 files |
| Phase 24 P08 | ~100min | 2 tasks | 9 files |
| Phase 27 P01 | 15min | 2 tasks | 2 files |
| Phase 27 P02 | 20min | 2 tasks | 3 files |
| Phase 27 P03 | 20min | 3 tasks | 7 files |
| Phase 27 P04 | 40min | 3 tasks | 13 files |
| Phase 27 P05 | 35min | 2 tasks | 5 files |
| Phase 27 P06 | 70min | 2 tasks | 6 files |
| Phase 27 P07 | 10min | 1 tasks | 3 files |
| Phase 27 P08 | ~35min | 3 tasks | 6 files |
| Phase 27 P09 | 15min | 1 tasks | 4 files |
| Phase 27 P10 | ~20min | 2 tasks | 5 files |
| Phase 27 P11 | ~2h | 3 tasks | 3 files |
| Phase 27 P12 | 30min | 3 tasks | 8 files |
| Phase 27 P14 | ~40min | 3 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Phase 15 planning] decision-coverage-plan gate override: CONTEXT.md decisions are prose-form (no D-NN tokens) so the parser extracted 0; compliance was verified instead by ui-checker (4/4 locked decisions honored) and plan-checker (full context compliance, 3 iterations). Verify-phase may re-surface this — treat as resolved-by-checker-evidence.
- [Phase 16 planning] decision-coverage-plan gate override (same Phase 15 precedent): CONTEXT.md decisions are prose-form so the parser extracted 0; plan-checker verified full context compliance (0 blockers — all locked architectural decisions explicitly honored across 6 plans). Treat as resolved-by-checker-evidence.
- [Phase 19 planning] decision-coverage-plan gate override (same precedent): prose-form CONTEXT decisions, parser extracted 0; plan-checker verified full coverage (1 blocker fixed: missing VALIDATION.md; SEC-01..04 all traced). Resolved-by-checker-evidence.

- Roadmap (v0.4): 7 phases (21–27) derived from `.planning/research/v0.4/SUMMARY.md`'s reconciled build order, which itself reconciles ARCHITECTURE.md/PITFALLS.md/STACK.md/FEATURES.md. Sequence: 21 Crypto Foundation (KEY-01..05 — pv-core identity keypair + sealed Collection Key + AAD scope-binding; KEY-05's `crypto_box`-vs-hand-rolled decision must land here, documented, before any dependent code) → 22 Family & Collection Data Model/Server Authorization (FAM-01..03, SHARE-04..06, SEC-06 — schema + the shared membership-authorization extractor + the Vaultwarden #6269 hidden-password-reassignment fix, all server/API-level) → 23 Sync Model Extension (SYNC-04..08, SEC-08 — highest integration risk per all four research docs; the live multi-session test harness is stood up HERE, not deferred) → 24 Invitation Flow (FAM-04..06 — no-SMTP single-use link/code, sequenced after sync so "new member becomes visible" is demonstrably provable) → 25 Member Removal/Suspension & Re-key (FAM-07..10, KEY-06/07, SEC-07, UX-04 — deliberately after sync since revoked access is unverifiable without it) → 26 Web App Sharing UI (SHARE-01..03, UX-03/05, SEC-05 — the actual share dialogs, hidden-password disclosure, sharing badges, fingerprint display; depends on the full backend stack for real E2E) → 27 Extension Integration (EXT-07..12 — autofill/TOTP/provider parity plus the EXT-10 shared-passkey signature-counter design spike, called out with its own success criterion per explicit instruction, not folded into "extension integration" as an ordinary subtask). 41/41 v0.4 requirements mapped, no orphans, no duplicates, verified by direct count against REQUIREMENTS.md's 7 categories (KEY 7, FAM 10, SHARE 6, SYNC 5, EXT 6, SEC 4, UX 3).
- Roadmap (v0.4): SHARE-04/05/06 and SEC-06 (server-side permission enforcement, uniform authorization, share revocation) were placed in Phase 22 (backend/API) rather than Phase 26 (web UI) even though SHARE-01/02/03 (the user-facing act of creating a share) live in Phase 26 — the security boundary itself (Pitfalls 7/8 in PITFALLS.md) must exist at the API layer regardless of which phase ships the UI that calls it, and Phase 22's success criteria are deliberately phrased as API/route-sweep-test-observable rather than UI-observable for this reason.
- Roadmap (v0.4): KEY-06 (re-key cost proportional to collection size) and KEY-07 (re-key atomicity) were placed in Phase 25 (Member Removal & Re-key) rather than Phase 21 (Crypto Foundation) — the two-layer Collection Key *design* that makes proportional cost possible is locked in at Phase 21, but the requirements' actual observable proof (load test scaling with member count, fault-injection test on the real removal transaction) only exists once the removal endpoint is built in Phase 25.
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
- [Phase ?]: [Phase 24] Plan 24-01 (tracer foundation): invite.rs calls only keys::aead_seal/aead_open, never identity::seal/unseal — the two invite-flow crypto primitives (AAD-capable symmetric wrap vs AAD-incapable asymmetric self-seal) stay textually separated per 24-CONTEXT.md Amendment 2's correction of ARCHITECTURE.md §7.1
- [Phase ?]: invitations.rs never imports pv_core::invite - server hash lives in pv_server::crypto::hash_invite_proof, textually distinct from the client-side twin
- [Phase ?]: Deliberately does not bump collections.revision in invitations::accept, matching shipped collections::add_member WR-05 wire-contract gap
- [Phase ?]: WasmInviteChannel stores only the raw invite_secret, never a pre-derived wrap key or proof — mirrors pv_core::invite's own re-derivation design
- [Phase ?]: Rejected original concurrency test design (common::test_pool() max_connections(1)) — rebuilt with a genuine multi-connection shared-cache pool mirroring tests/collections.rs's atomic-guard analog, proving accept's single-use guard under real SQLite write-lock contention.
- [Phase ?]: lib/crypto/index.ts exports WasmIdentityKey/WasmIdentityPublicKey/WasmCollectionKey/WasmInviteChannel as values, not just types, since downstream code calls static constructors on them (matches WasmWrappingKey's existing shape)
- [Phase ?]: getCollection added to lib/vault/api.ts (Rule 2) — no single-collection-fetch client existed; generateInviteLink needs the caller's own sealed_key before re-wrapping it for an invite
- [Phase ?]: web/package.json gained a typecheck script alias (Rule 3) — the plan's own verification command had no matching script
- [Phase ?]: page.tsx's invite state carries a setter (unlike extUnlockNonce) so a successful join can hand control back to the normal authed/vault tree
- [Phase ?]: selectCollectionId is accepted from redeemInviteFlow but not wired into a vault filter -- VaultFilter has no collection variant; documented as a tracked gap rather than a misleading fabricated filter
- [Phase ?]: 24-07: Added web/src/lib/families/api.ts (createFamily/getFamilyMembers) — no client existed for either families.rs endpoint despite being live since Phase 22
- [Phase ?]: 24-07: Collection-scope invite folder-picker sourced from useFolders() per plan, but generateInviteLink's collectionId requires a genuine Phase 22 collections resource nothing in the client can create/list/decrypt yet — documented as a stub that fails loud via invite.generateFailed, not silently
- [Phase ?]: Introduced fixtures.ts's ensureFamilyOwnerSession as a shared, real, register-or-login-idempotent family-owner identity so invite-flow.spec.ts and shared-sync.spec.ts resolve to the same owner regardless of file run order (v0.4 singleton family constraint).
- [Phase ?]: Fixed three real-browser-only bugs found by this plan's own e2e run: missing initCrypto() await race in lib/invite/crypto.ts, page.tsx's no-fragment invite-link detection gap, and InviteLandingView's escape button being unclickable behind UnlockOverlay's modal.
- [Phase ?]: FamilyTab's Revoke now treats a 404 (invite already accepted/expired) as already-resolved rather than a failure, closing a gap where the owner could never generate a second invite after the first was accepted.
- [Phase ?]: 27-01: unpacked-extension ids are deterministic-by-path in Chromium (not per-profile) — storage isolation, not extension-id difference, is the valid proof of independent persistent-context profiles
- [Phase ?]: [Phase 27] 27-02: EXT-10 no per-item signature-counter tracking for shared provider passkeys — requirement's own premise (no shipped precedent) was factually wrong; pv-provider already reports signCount 0 (confirmed by raw wire-byte decode), matching iCloud Keychain/Google Password Manager; SEC-04 classifier structurally unreachable from provider-ceremony assertions (file:line-traced).
- [Phase ?]: [Phase 27] 27-03: implemented all 12 collection/identity WASM re-exports (crates/pv-wasm/src/lib.rs's actual list) rather than the plan prose's off-by-one count of 11
- [Phase ?]: [Phase 27] 27-03: collections-store.ts/identity-store.ts register no subscribeSessionLockState listener of their own (27-PATTERNS.md Pitfall 4) -- both export plain free/refresh functions with a caller-must-invoke contract; 27-04 wires them into vault-store.ts's single existing handler
- [Phase ?]: [Phase 27] 27-03: EXT-11/KEY-01 left unmarked in REQUIREMENTS.md -- this plan delivers only the crypto primitives; the client-trigger/full wake-lifecycle wiring that makes them observably correct is 27-04's job, matching this project's precedent of not marking a requirement complete until user/system-facing behavior lands
- [Phase ?]: [Phase 27] 27-04: CollectionKeyPendingError vs. genuinely-broken decrypt failure both surface via the SAME getPendingSharedItems() array -- Task 1 is background-wiring-only, so one always-populated channel satisfies the never-silently-absent guarantee for both classifications
- [Phase ?]: [Phase 27] 27-04: fixtures-account-setup.ts joins member B to the family via direct owner-side POST /api/families/members, not invitations.rs::accept -- that endpoint's crypto (WasmInviteChannel) is not in wasm-loader.ts's re-export list and is out of this task's scope; matches web/e2e/shared-sync.spec.ts's own established REST-only precedent
- [Phase ?]: [Phase 27] 27-05: UX-3 personal-before-shared partition built as two-array-then-concat (never Array.prototype.sort) for a deterministic, by-construction stable ordering
- [Phase ?]: [Phase 27] 27-05: live TOTP proof found a real crypto bug -- the codebase's usual mocked-unit-test secret (JBSWY3DPEHPK3PXP, 10 bytes) fails totp_rs's real RFC 4226 128-bit minimum; fixture now uses RFC 6238 Appendix B's own 20-byte secret, the same literal pv-core's own totp.rs test module uses
- [Phase ?]: [Phase 27] 27-05: computeTotpCandidates() always computes {current, previous} 30s-time-step candidates, never a single value -- pv-core's generate_code never reads the clock itself, so a live round trip can legitimately straddle a period boundary
- [Phase ?]: [Phase 27] 27-06: line ~711's ephemeral matchingItemJson round trip in handleCredentialsGet stays User-Key-scoped and UNCHANGED (contradicting 27-RESEARCH.md's/27-PATTERNS.md's literal suggestion) -- wasm_get_provider_assertion has no collection-key-accepting variant; the real fix belongs in persistUpdatedProviderItem's write-back dispatch instead
- [Phase ?]: [Phase 27] 27-06: EXT-10's live-wire signCount measurement closed -- member B's real browser-returned credentials.get() assertion decodes authenticatorData bytes 33-36 to 0, joining 27-02's in-process Rust regression as the two evidence tiers the requirement's spec mandated
- [Phase ?]: 27-07: CollectionKeyUnavailableError is capture-handler.ts's own local class (mirrors web's, not cross-imported); read-only gate checks accessLevel !== 'edit' && !== 'hidden_password' directly rather than importing accessLevel.ts's accessRank
- [Phase ?]: 27-08: SharedBadge.tsx is the one badge-markup owner for the whole phase; ItemDetailView.tsx fetches vault.list itself (gated on collectionId) rather than taking a collections prop; E1-error/E3-error item.undecryptable backstops wired as documented dead-code defense-in-depth since 27-04 never sets that field for the extension.
- [Phase ?]: 27-09: extended the SharedBadge wrapper convention to AutofillItemRow.tsx/TotpFillRow.tsx's own icon frames — same relative inline-flex host pattern, no badge JSX re-derived.
- [Phase ?]: 27-10: App.tsx widened to pass ProviderCeremonyView's matches prop for every get() ceremony (not only multi-match) so the single-match shared-passkey note has isShared/folderName data to render from
- [Phase ?]: 27-10: confirmed a shared-but-undecryptable item can never reach the provider ceremony's candidate list (vault-store.ts never retains it in getItems()); wired a defensive filter anyway as dead-code defense-in-depth
- [Phase ?]: [Phase 27] 27-11: Found live (not fixed, out of scope) -- capture-handler.ts's buildLoginFields() always derives an item's name from the submitting page's hostname on every capture-confirm save, new AND update alike, discarding a shared item's custom name; the write-path proof's own locator was adjusted to search by unique username instead of the now-renamed item name
- [Phase ?]: [Phase 27] 27-11: closed the phase's three whole-phase-only obligations with live evidence -- EXT-11 chrome.storage.session audit, post-revocation staleness (T-27-24) with a genuine ~1-minute alarm-backed poll wait, and the phase's only real-crypto write-path proof (T-27-25)
- [Phase ?]: 27-12: pendingSharedItems entries now carry a pending-vs-broken status discriminant (upsert on reattempt), and ItemListView.tsx degrades a broken shared row to a terminal honest warning instead of an indefinite skeleton -- closes 27-VERIFICATION.md Blocker 1 (UI-SPEC E2-error backstop)
- [Phase 27] 27-14: closed 27-VERIFICATION.md Gaps 3/4/5 -- setupAccessLevelFixture() (real hidden_password direct share + real read-access collection); dual-extension-access-levels.spec.ts proves hidden_password autofill-without-reveal/copy AND read-only write-refusal (ReadOnlyAccessError) live for the first time; a live DOM-fill assertion closes EXT-07's fill-event gap; signInAndUnlock's service-worker-readiness fix (3/3 green --retries=0) closes the diagnosed cold-MV3-wake flake; KEY-01 reconciled to Complete in REQUIREMENTS.md

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Phase 26] **Phase 27 must budget a live browser proof FROM THE START, not at the end.** Phase 26 twice declared a feature done while it did not work, and both times 700+ unit tests were green: (1) sharing worked only one-way — every recipient-side read path existed server-side with ZERO client consumers, so a user could share perfectly and the recipient saw nothing; (2) `hidden_password` protected nothing at all while the UI claimed it did — `access_level` was not even on the wire. Both were found only by a live two-session Playwright run flipping assertions. The mocked `@/lib/crypto` blind spot systematically hides exactly this class. Phase 27 inherits the same shape (extension surfaces consuming shared data) and should write its live proof early enough to steer the phase, not to audit it.
- [Phase 26] **The post-await bookkeeping hazard has now recurred THREE times** (`4450dc0` WR-12, WINDOWS #10, WINDOWS #11). `createVaultItem`/`updateVaultItem`/`deleteVaultItem` mutate local state after the awaited API call, so any throw reports failure over a completed server mutation. Closed at pattern level in Phase 26 with three independent layers — but the durable layer is `recomputeAllTags`'s `?? []`, deliberately NOT a choke point, because assuming a choke point stays complete is what failed twice. A future field that is both unguarded-dereferenced AND on an every-mutation path would be a genuinely new instance; nothing catches that automatically.
- [Phase 26] **WINDOWS #12 (open, accepted):** the `hidden_password` interface mask does NOT extend to vault export — `ExportDialog` → `getItems()` → `toCsv.ts:59` / `toJson.ts:23` emit `fields.password`. Accepted because a deliberate whole-vault export is inside what D-2 already discloses, and silently blanking a password in a user's own backup is unnoticed data loss. The recipient-facing copy was weakened to match ("this **view** masks it"), i.e. toward honesty. Recommended future fix: warn at export time rather than blank or stay silent.
- [Phase 26] **WINDOWS #13 (open):** no UI entry point adds a member to an EXISTING collection — all five `ShareDialogScope` paths pass an item or a personal folder, and shared-folder sidebar rows are non-interactive. So a partially-failed share recovers only within the same dialog session; closing it orphans a collection permanently. CR-01's scoped claim holds; its unscoped "no manual DB surgery" claim is recorded as NOT true.
- [Phase 26] **WINDOWS #1/#3 (open, pre-existing):** 18 × `clippy::explicit_auto_deref` in `vault.rs` predating Phase 24 still block whole-crate `cargo clippy -- -D warnings`. Untouched by Phases 25/26 per scope boundary; a one-line `--fix` sweep would clear it.
- [Phase 25] **Phase 26 inherits a confirmed wire-contract defect (WR-09), independently found twice.** `collections::create` (`crates/pv-server/src/routes/collections.rs:98`) mints the collection id server-side with `Uuid::new_v4()` AFTER the client has already encrypted `enc_name`, whose AAD binds that same id. Consequence: **no real client can produce a decryptable collection name**, so every folder in Phase 25's removal-disclosure list renders as `Folder "<uuid>"`. Live-confirmed in UAT. Phase 25's UI-SPEC "real folder name" requirement is recorded as an **open UAT gap, not a passed criterion**; Phase 26 owns the fix (client-generated id, or a two-step create) since it owns real collection authoring.
- [Phase 25] **Latent e2e flakiness to account for in Phases 26/27.** `web/playwright.config.ts` sets `retries: 2` while the suite reuses ONE server/DB and a fixed singleton `FAMILY_OWNER_EMAIL` account, so vault items accumulate across retries — any "expect exactly N items" assertion can see N+1/N+2 on retry and pass or fail nondeterministically. The Phase 25 UAT needed `--retries=0` for a clean single-attempt DB.
- [Phase 25] **The "resolve_access is the sole enforcement point" premise was false and cost real leaks.** Code review found `GET /api/sync/shared/direct` ungated; the fix pass then audited every `family_members` reference and found **five** holes, not three — including `vault::fetch_items_for` arm 2 (leaked `enc_data` of a suspended member's authored collection items, including others' post-suspension edits) and `collections::list` (no join at all). Lesson for Phases 26/27: when adding an authorization predicate, audit every query touching that table rather than trusting the one call site the feature was designed around.
- [Phase 25] **Accepted, recorded scope boundary:** direct `item_shares` are revoke-only and are NOT re-keyed for other recipients on those items. The honesty copy is the stated compensating control, and it ships unconditionally (`RemoveMemberDialog.tsx` renders `member.removeHonestyWarning` outside every conditional, including the empty-access case).
- [Phase 25] Cosmetic debt: `account.deleteOwnerWarning` renders "1 member(s)" — the i18n layer has no plural machinery. Not an honesty defect.
- Research flags PRF browser/OS support matrix as a moving target — re-verify current-state support at Phase 12 (Passkey Provider) planning time, not from the 2026-07-14 research snapshot.
- ARCHITECTURE.md flags `chrome.storage.session` TTL/eviction semantics (survives extension update? idle-time-only eviction?) as needing hands-on verification during Phase 8/9 planning, not assumed from docs.
- WASM loading inside content-script bundling context specifically (vs. background/popup) is unverified per research STACK.md — validate during Phase 8's bootstrap spike if autofill (Phase 10) ends up needing `pv-core` decrypt calls close to the DOM.
- **RESOLVED 2026-07-17**: Quick task 260717-lnx's `headless: true` re-enable reproduced the historical `P12-SC1` headless hang (13-03-SUMMARY.md). Fix landed: `extension/playwright.config.ts` now splits into two projects — `chromium` (everything except Phase 12, headless) and `chromium-ceremony` (Phase 12 only, headed); `extension/e2e/fixtures.ts` picks the real `headless` flag from `workerInfo.project.name` (commit `b393f90`). A follow-up verification run then hit a SEPARATE issue — `P12-SC2` failed after 2 retries against a STALE `extension/.output/chrome-mv3` build (predating Task A's one-click-picker source change) — root-caused and fixed via a `pretest:e2e:chrome` npm script that rebuilds chrome before every e2e run (commit `ddc770f`). Whole `chromium-ceremony` project (5 SCs) now passes cleanly and repeatably (5 consecutive full-project runs, headed, zero flake); `npm test` stays 533/533 green. See `.planning/quick/260717-lnx-extension-ux-one-click-passkey-picker-no/260717-lnx-SUMMARY.md` and `.planning/phases/13-dual-browser-hardening/13-03-SUMMARY.md` for the original investigation.
- web/.env.local's NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8620 breaks same-origin fetch() for any web/out build served/visited via http://localhost:8620 (this project's own documented convention) -- routed around this session via NEXT_PUBLIC_API_BASE_URL="" npm run build, not fixed in .env.local (out of scope, outside file-write permissions). Bartek should review/clean up this env var.
- **RESOLVED 2026-07-20**: XBR-02 (Firefox response-direction Xray hole) closed. Plan 14-02 fixed `page-bridge-firefox.ts`'s `shapeCredential()` to re-materialize every response-direction binary field as a genuine MAIN-world ArrayBuffer, then discovered mid-verification that the original `instanceof ArrayBuffer: false` signal was itself a WebDriver/geckodriver `executeScript` measurement artifact (a genuine inline `<script>` RP fixture showed correct behavior on both pre-fix and post-fix builds) — the fix was kept anyway as harmless defense-in-depth. Plan 14-03 closed the loop with two permanent, artifact-free proofs: a deterministic jsdom regression test (`page-bridge-firefox.test.ts`) and an upgraded live-Firefox probe (`probe-request-xray.cjs`, now hard-gating every response-direction `*IsArrayBuffer` field via a genuinely inline fixture, never `driver.executeScript()`). Full gate suite green (vitest 674/674, tsc clean, both builds, mainworld-boundary audit PASS, run-core.cjs 17 PASS+1 OBSERVED, run-server-unlock.cjs 15 PASS/2 INFO, probe-request-xray.cjs all PASS, chromium-ceremony 5/5, cargo test --workspace 151 passed). Doc moved to `.planning/debug/resolved/firefox-request-xray-hole.md`; Bartek's own live github.com retest of the original request-direction fix remains open at his leisure (not claimed as done).
- **RESOLVED 2026-07-30 (KEY-05 half)**: v0.4 research flagged two genuinely open design decisions carried into the roadmap. KEY-05 landed in Phase 21 as required — `crypto_box` exact-pinned `=0.9.1` (features chacha20+alloc+rand_core), decision record committed *before* any dependent code, full rationale + the three rejected alternatives (hpke 0.14.0, rsa 0.9.10 with its open RUSTSEC-2023-0071, hand-assembled x25519-dalek) in PROJECT.md Key Decisions. Two constraints written down rather than discovered later: ChaChaBox rejects non-empty AAD (so scope-binding happens a layer lower, at item-AEAD), and `crypto_box::SecretKey` does not implement `zeroize::Zeroize` (its hand-written Drop zeroizes only the inner scalar, never the raw 32-byte array) — pv-core therefore keeps its own byte array with its own Zeroize/ZeroizeOnDrop. **Still open:** EXT-10 (shared-passkey WebAuthn signature-counter behavior — Phase 27 spike, zero product precedent exists anywhere).
- **RESOLVED 2026-07-30 (R-20-03)**: the v0.3-era "repo has no remote, so the CI gate has never run on a real GitHub Actions runner" follow-up is closed. `origin` → github.com/bartosz-skejcik/passkey-vault; run 30584149151 is green across all 5 jobs, including Phase 23's new blocking `web-e2e` (`Running 3 tests using 1 worker` → `3 passed (2.3m)`). CI-vs-local parity is now observed, not asserted.
- [Phase 23] Recorded, non-blocking debt carried forward (all three re-examined against the success criteria by both the verifier and the security auditor; none undermines an SC): **WR-02** — `vault.rs::move_item` resolves the event audience *before* the same-tx `item_shares` DELETE, so a just-stripped direct sharee gets one `EntityType::Item` frame carrying only an item id it already knew (no collection identity, no revision of the destination, no ciphertext, no actor); one-line fix documented in 23-REVIEW.md. **WR-07** — `revoke_access` moves no counter the revoked member can observe, so their *own authored* rows look stale locally until an unrelated bump; server-side authorization is unaffected (404 via `Collection::resolve_access`) — squarely **Phase 25** territory. **WR-01** — delete-on-move silently destroys the owner's direct shares with no signal; removes access rather than leaking it, so it is product/UX debt for human judgment.
- [Phase 23] `/api/sync/shared` is fully implemented, authorized, tested and reachable but has **no client consumer** — `sync.ts` short-circuits the call because nothing supplies `onSharedRevisions`. This is CONTEXT.md's own design (signal 2, the per-recipient `vault_revision` bump, is what shipped clients poll; Collection Key unwrap is Phase 26/27 scope). **Phase 26/27 must wire the consumer** or the per-collection cheap-check stays server-side-only.
- [Phase 23] **Phase 26 owes a live-browser proof it inherited, not one of its own**: SC 3's browser-level conflict-attribution assertion was deliberately removed from `web/e2e/shared-sync.spec.ts` because the fixture's DUMMY sealed key makes B's write necessarily undecryptable, which correctly trips the overwrite refusal *before* any 409 can occur — the assertion was unreachable by construction. Reaching it needs the client-side identity-keypair / Collection Key unwrap that lands in Phase 26. The obligation is written into the spec file itself, beside the deferred test.
- [Phase 23] Process gap to enforce in Phases 24–27: **none of the six SUMMARY files populated its `## Threat Flags` section**, so the security auditor had to recover threat-adjacent findings from 23-REVIEW.md instead of the declared channel.
- [Phase 24] **Phase 26 inherits three dissolved UI-SPEC backstops.** #4 (folder-picker zero-one-many), #5 (long folder-name option truncation) and #6 (selected-folder value truncation) constrained the folder picker that Phase 24's CR-02 fix removed. Per the honest-verifier contract they are *dissolved*, not *met* — the element they constrain no longer exists, so they cannot be confirmed with evidence and must not silently pass. Whichever Phase 26 plan builds the real collections picker owes all three. Also recorded in WINDOWS.md row 2.
- [Phase 24] **SC 1 accepted with a recorded override: collection-scoped invites ship API-complete and UI-disabled.** A user can create a whole-family invite end-to-end through real UI (live-proven, 9/9 Playwright across two independent browser contexts); a user cannot scope an invite to one folder — that option is unconditionally disabled with truthful not-yet-available copy. The server half is genuinely complete (validates the collection triple, inserts a real `collection_keys` row, re-validates inviter authority in-transaction, rolls back on conflict, fans out a real WS event). The blocker is cross-phase: personal `folders` and Phase 22 `collections` are distinct tables with unrelated id spaces, and **no client-side capability to create, list, or decrypt a `collections` resource exists anywhere in the product yet** — which is precisely Phase 26's job. Enabling it later is a UI change, not an API or crypto change.
- [Phase 24] **The unit suite's `@/lib/crypto` mocking is a structural blind spot, now partially closed.** Wave 5's live Playwright run found four real bugs no unit test could see (three invite flows missing `await initCrypto()`; a no-fragment `/invite/{id}` falling through to the login screen; the account-escape button unclickable under `UnlockOverlay`'s modal; `Revoke` 404ing on a consumed invite). Code review then found the same mechanism had let a 100%-failure control ship green — `FamilyTab.test.tsx` mocked `@/lib/invite/crypto` wholesale. The WR-10 fix added `web/src/lib/invite/crypto.real-wasm.test.ts`, a genuine real-WASM regression test. Treat "the unit test passes" as weak evidence for anything crypto-adjacent in Phases 25-27.
- [Phase 23] Register correction worth not re-inheriting: T-23-16's authored rationale claimed the CI Chromium download was "the identical mechanism the extension job already runs today" — **factually wrong**; the `extension` job runs no Playwright step at all, and Phase 23 introduced the first Playwright run in this repo's CI. The threat is closed on stronger independent grounds (byte-identical lockfile integrity hashes across `web/` and `extension/`, plus `npm ci` before `npx playwright install` so the pinned local binary resolves).
- v0.4 research flags an account-deletion re-key gap (ARCHITECTURE.md §4.3): today's `ON DELETE CASCADE` on `users` drops membership rows via FK but does not itself trigger a collection re-key — FAM-10 (Phase 25) requires the deletion flow to explicitly run the same re-key path as removal before dropping the user row, not rely on the cascade alone.
- [Phase 27] **Accepted, out-of-scope finding, recorded per 27-14-PLAN.md's own instruction:** `capture-handler.ts`'s `buildLoginFields()` (Phase 11) unconditionally derives an item's `name` from the submitting page's hostname on every capture-confirm save, new AND update alike — first confirmed live by 27-11's own write-path proof, recorded again here for visibility. For a SHARED item this means one member's capture write silently renames the item for every other member too. Not a Phase 27 regression (pre-existing Phase 11 behavior, untouched by 27-07/27-11/27-14). Recommend a future fix that preserves an existing item's custom name on an `'update'` capture-confirm, deriving a hostname-based name only for a brand-new `'new'` capture.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260717-lnx | Extension UX: one-click passkey picker, NordPass-style inpage dropdown restyle, headless e2e fixture | 2026-07-17 | 115e68d | [260717-lnx-extension-ux-one-click-passkey-picker-no](./quick/260717-lnx-extension-ux-one-click-passkey-picker-no/) |
| 260718-0qi | Popup UI fix round: theme parity, FAB/footer/top-bar restructure, hover shadow removal, label/sort sizing, Phase 9 e2e repair | 2026-07-18 | 39754b3 | [260718-0qi-popup-ui-fix-round-theme-match-web-sideb](./quick/260718-0qi-popup-ui-fix-round-theme-match-web-sideb/) |
| 260719-sxa | Distinguish prf-unavailable terminal state from generic failed in server-origin passkey ceremony (ExtUnlockBridge + login.ts), both signin and unlock modes, with PL/EN copy and tests | 2026-07-19 | 20eaaf1 | [260719-sxa-distinguish-prf-unavailable-terminal-sta](./quick/260719-sxa-distinguish-prf-unavailable-terminal-sta/) |
| 260720-16k | Firefox aux windows feel like popups: centering, consent-window resize/self-close, candidate-list scroll cap, autofill-flash race fix | 2026-07-20 | 40d1965 | [260720-16k-firefox-aux-windows-feel-like-popups-cen](./quick/260720-16k-firefox-aux-windows-feel-like-popups-cen/) |
| 260803-cnd | Fix passkey unlock 401 handling and AbortError misclassification | 2026-08-03 | 231321d | [260803-cnd-passkey-unlock-401-and-aborterror](./quick/260803-cnd-passkey-unlock-401-and-aborterror/) |

## Deferred Items

Items acknowledged and deferred at v0.3 milestone close on 2026-07-22 (pre-existing v0.1/v0.2-era artifacts; v0.3's own 7 phases all verified passed):

| Category | Item | Status |
|----------|------|--------|
| debug | firefox-provider-corruption — RESOLVED in code, awaiting Bartek's human verify (checkpoint in doc) | awaiting_human_verify |
| debug | signin-passkeyless-spin — reasoning checkpoint open, awaiting Bartek's human verify | awaiting_human_verify |
| uat | Phases 05–07 UAT passed (0 pending); Phases 08/09/10/13 UAT files status "unknown" (0 pending scenarios — parser artifact, live UAT evidence in phase SUMMARYs) | acknowledged |
| quick_task | 260717-lnx one-click-passkey-picker — listed complete in Quick Tasks table; audit flag `needs-decision` is a status-parse artifact | acknowledged |
| todo | 2026-07-12-ui-review-phase1-fixes (3 cosmetic WARNING findings, already deferred at v0.1 close) | open |
| todo | 2026-07-20-stale-default-pv-origin-3000 (stale default PV origin :3000 — api) | open |
| context | Phases 09/10/11/13 CONTEXT "open questions" — all read "None required to unblock planning" (parser artifact) | acknowledged |

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

**Stopped at:** Completed 27-14-PLAN.md (gap closure, access-level live coverage + EXT-07 fill + flake fix)
**Resume file:** None

Last session: 2026-08-09T10:18:14.830Z
27-14-PLAN.md (gap closure) executed: setupAccessLevelFixture() (real hidden_password direct
share + real read-access collection); dual-extension-access-levels.spec.ts proves both
hidden_password autofill-without-reveal/copy and read-only write-refusal (ReadOnlyAccessError)
live for the first time in this phase; dual-extension-sharing.spec.ts gained a live DOM-fill
assertion closing EXT-07's fill-event gap; signInAndUnlock's service-worker-readiness fix (3/3
consecutive green --retries=0 runs) closes the diagnosed cold-MV3-wake flake (27-VERIFICATION.md
Gap 5); REQUIREMENTS.md's KEY-01 row reconciled from Partial to Complete. Next entry point:
27-13-PLAN.md (independent gap-closure plan, not yet executed) or `/gsd-verify-phase 27`.

## Operator Next Steps

- Autonomous run in progress — Phases 24 → 27, then milestone lifecycle (audit → complete → cleanup)
- One explicit open decision still lands inside its own phase, not silently assumed: EXT-10 (shared-passkey signature-counter spike, Phase 27). KEY-05 closed in Phase 21
- Phase 25 inherits two concrete obligations: the WR-07 unobservable-revocation gap, and the account-deletion re-key gap (today's `ON DELETE CASCADE` drops membership rows but does not itself trigger a collection re-key — FAM-10 needs the deletion flow to run the same re-key path as removal)
- Phase 26 inherits Phase 23's deferred SC-3 live-browser conflict-attribution proof, plus wiring an actual consumer for `/api/sync/shared`
- Nadal czekają na Twoją ludzką weryfikację: 2 debug-doc (firefox-provider-corruption, signin-passkeyless-spin)
