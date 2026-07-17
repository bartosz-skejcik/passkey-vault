---
phase: 13-dual-browser-hardening
plan: 04
subsystem: testing
tags: [firefox, selenium-webdriver, geckodriver, webauthn, mv2, uat, cross-browser]

# Dependency graph
requires:
  - phase: 13-dual-browser-hardening
    provides: "13-01 (Firefox manifest/CSP/gecko hardening), 13-03 (Chrome baseline + 24-row checklist skeleton), 13-05 (moz-extension://* CORS wildcard + CORS-blocked UX) — this plan's walk exercises the packaged build all three plans shipped"
provides:
  - "13-UAT-CHECKLIST.md: all 24 rows PASS on both Chrome and Firefox — the phase's closing deliverable"
  - "extension/e2e-firefox/: a reusable selenium-webdriver + geckodriver Firefox UAT harness (run-core.cjs + run-autofill-capture.cjs + find_color.py), documented for future dual-browser regressions"
  - "Definitive empirical closure of wxt.config.ts:56-64's open question: Firefox rejects navigator.credentials from ANY moz-extension:// page (SecurityError), independent of rpId — the product's existing D-12/D-13 handling already covers this correctly"
affects: []

# Tech tracking
tech-stack:
  added: ["selenium-webdriver@4.46.0 (devDependency)", "geckodriver@6.1.0 (devDependency, wraps real geckodriver 0.37.0 binary)"]
  patterns:
    - "Fixed extensions.webextensions.uuids preference pins the moz-extension:// origin across Firefox relaunches, making storage.session/storage.local state and CORS-origin observation reproducible in a persistent profile"
    - "Coordinate-click automation for closed-shadow-root UI (no CDP on Firefox): compute click points from the product's own CSS/JS positioning formulas where known, or locate the brand-color primary-action button via a small screenshot-scanning script (find_color.py) — never visual guessing"
    - "Surface B/A (autofill.matchFrame/fillFrame, sender-derived origin) as the WebDriver-compatible substitute for the popup's active-tab-based autofill.match/fill picker, which classic WebDriver cannot drive reliably (switching windows changes Firefox's real active tab, unlike CDP)"

key-files:
  created:
    - extension/e2e-firefox/run-core.cjs
    - extension/e2e-firefox/run-autofill-capture.cjs
    - extension/e2e-firefox/find_color.py
    - extension/e2e-firefox/README.md
  modified:
    - .planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md
    - .planning/phases/13-dual-browser-hardening/13-VALIDATION.md
    - extension/package.json
    - extension/package-lock.json
    - extension/.gitignore

key-decisions:
  - "No product-code divergences found or fixed — Task 2's mandate was to triage FAIL rows, and there were none by the time the harness itself was debugged to correctness. Every issue hit during this session was a test-harness technique bug, documented honestly rather than silently worked around."
  - "wxt.config.ts:56-64's open question is CLOSED: a direct, isolated navigator.credentials.create() probe (rpId=extension-id) versus a control probe (rpId='localhost', same popup origin) both returned the IDENTICAL SecurityError 'The operation is insecure.' in ~2ms — proving Firefox rejects WebAuthn from ANY moz-extension:// page outright, not specifically because of the extension-scoped rpId. No code change needed: EnrollExtPasskeyPrompt/UnlockView's existing D-12/D-13 handling already flips to disabled+explainer correctly on this exact failure."
  - "Autofill fill rows (P10-SC1-5) were driven via Surface B/A (content-relay.content.ts's sender-derived-origin channel) instead of the popup's own active-tab picker, because classic WebDriver's switchTo().window() genuinely changes Firefox's OS-level active tab (confirmed empirically) — unlike CDP, which the Chrome harness relies on to address the popup without stealing tab focus from the form page."
  - "P10-SC3/SC4 (card/identity) verify a plausible real-value SHAPE rather than an exact match, and P10-SC2/SC4 iterate rows rather than assuming row 0 — this shared, many-times-reused UAT account has accumulated dozens of historical items, and card/identity items are not origin-scoped by product design (itemMatchesOrigin() returns true unconditionally for both kinds), so a fixed-index click is not reliable there. A fresh/isolated account would not need this."

requirements-completed: [XBR-01]

coverage:
  - id: D1
    description: "Every Phase 9-12 SC (21 total) plus D-05, D-08, and the ext-scoped rpId-on-Firefox row verified with real, falsifiable evidence on Firefox — 24/24 rows PASS"
    requirement: "XBR-01"
    verification:
      - kind: manual_procedural
        ref: "extension/e2e-firefox/run-core.cjs + run-autofill-capture.cjs, real runs against Firefox 152.0.6 + firefox-mv2 build + live pv-server; results and screenshots recorded in 13-UAT-CHECKLIST.md and .planning/phases/13-dual-browser-hardening/uat-ff-screenshots/"
        status: pass
    human_judgment: false
  - id: D2
    description: "wxt.config.ts:56-64's ext-scoped rpId-on-Firefox open question closed with a definitive empirical finding (SecurityError, origin-independent of rpId) and confirmed D-12/D-13 UI compliance"
    requirement: "XBR-01"
    verification:
      - kind: manual_procedural
        ref: "Direct navigator.credentials.create() probe (rpId=extension-id) + control probe (rpId='localhost') from the popup's own JS context, both SecurityError 'The operation is insecure.'; UI probe confirmed EnrollExtPasskeyPrompt's Create-a-passkey button flips to disabled=true with the D-13 canonical explainer within 500ms"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every genuine divergence encountered was triaged; zero required a source-file fix in any owning phase (9/10/11/12)"
    requirement: "XBR-01"
    verification:
      - kind: other
        ref: "13-UAT-CHECKLIST.md's Firefox Deviations section — full accounting of the 5 test-harness technique bugs found and corrected, none of which were product bugs"
        status: pass
    human_judgment: false

# Metrics
duration: ~5.5h (majority spent building and debugging the from-scratch selenium-webdriver harness, since no prior Firefox extension automation existed for this project)
completed: 2026-07-17
status: complete
---

# Phase 13 Plan 04: Firefox Dual-Browser UAT Walk Summary

**Built a from-scratch selenium-webdriver + geckodriver Firefox harness, walked all 24 checklist rows against a real Firefox 152.0.6 + packaged firefox-mv2 build, found zero product-code divergences, and closed `wxt.config.ts:56-64`'s open question with a definitive empirical finding: Firefox rejects WebAuthn from any `moz-extension://` page outright, and the extension's existing D-12/D-13 handling already covers it correctly.**

## Performance

- **Duration:** ~5.5h (the large majority spent building the harness itself and root-causing genuine WebDriver-vs-CDP tooling gaps — no prior Firefox extension automation existed anywhere in this project to build on, unlike 13-03's Chrome pass which had this project's own prior-session probe scripts as precedent)
- **Started:** 2026-07-17 (approx, orchestrator handoff with server + build already prepared)
- **Completed:** 2026-07-17
- **Tasks:** 2
- **Files modified:** 9 (5 created, 4 modified — see key-files above; 99 screenshot files also committed as evidence)

## Accomplishments

- **24/24 checklist rows PASS on Firefox** (0 FAIL, V-04 DEFERRED as explicitly permitted) — every Phase 9-12 SC, D-05, D-08, and the new ext-scoped rpId-on-Firefox row, each with real, falsifiable evidence (screenshot + observed values, never a bare PASS)
- **Zero product-code divergences found.** Task 2's own mandate (triage and fix any FAIL) had nothing to do — every issue hit while building this session's harness was a test-harness technique bug, documented honestly in `13-UAT-CHECKLIST.md`'s Firefox Deviations section rather than silently worked around
- **`wxt.config.ts:56-64`'s open question definitively closed:** an isolated `navigator.credentials.create()` probe (rpId=extension-id) and a control probe (rpId=`"localhost"`, same popup origin) both returned the identical `SecurityError: "The operation is insecure."` in ~2ms — Firefox rejects WebAuthn from ANY `moz-extension://` page context outright, independent of the requested rpId (unlike Chrome's `chrome-extension://`-specific special-casing). The product's existing `EnrollExtPasskeyPrompt`/`UnlockView` D-12/D-13 handling was confirmed, via the real UI, to already flip to disabled+explainer correctly on this exact failure — no code change needed
- **P9-SC6's headline row closed both halves:** a real `fetch()` from the popup's own live `moz-extension://<uuid>` origin against `pv-server` succeeded with zero CORS rejection, passing through 13-05's `moz-extension://*` scheme-scoped wildcard with a genuine per-install-shaped UUID, not just a theoretical pattern match
- **D-05 and D-08 explicitly re-confirmed, not assumed:** D-05 via direct storage-API placement checks (never an idle-kill-survival test, since Firefox's MV2 background is persistent and has no idle-kill to survive — exactly per this plan's own instruction) plus a genuine browser-restart observation (session token wiped, full re-sign-in required); D-08 via a fresh-navigation `navigator.credentials.create.toString()` inspection confirming the RPC-shim wrapper wins the injection race on Firefox's `injectScript()` mechanism, identical outcome to Chrome's declarative `world:'MAIN'`
- **A reusable Firefox UAT harness** (`extension/e2e-firefox/`) committed to the repo — `run-core.cjs` (Phase 9 + 12 + invariants) and `run-autofill-capture.cjs` (Phase 10 + 11), plus `find_color.py` (a small screenshot-scanning script for closed-shadow-root button targeting, since Firefox has no CDP shadow-piercing equivalent), env-var-configurable, documented in a README, so a future dual-browser regression pass doesn't need to rebuild this tooling from scratch

## Task Commits

1. **Task 1: Firefox server bring-up + self-driven UAT walk** — `e9c5de7` (feat) — includes the full checklist update, the harness itself, and 99 evidence screenshots
2. **Task 2: Triage and fix every divergence** — `0d1be3a` (docs) — no source fixes were needed (0 FAIL rows from Task 1); this commit flips `13-VALIDATION.md`'s `nyquist_compliant` to `true`

**Plan metadata:** (final commit, see below)

## Files Created/Modified

- `.planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md` — all 24 rows filled with real Firefox results + a full Firefox Deviations section
- `.planning/phases/13-dual-browser-hardening/13-VALIDATION.md` — `nyquist_compliant: true`, sign-off checked
- `extension/e2e-firefox/run-core.cjs` — Phase 9 + Phase 12 + D-05/D-08/rpId-on-Firefox Firefox walk
- `extension/e2e-firefox/run-autofill-capture.cjs` — Phase 10 + Phase 11 Firefox walk
- `extension/e2e-firefox/find_color.py` — brand-orange-color cluster detection for closed-shadow-root button targeting
- `extension/e2e-firefox/README.md` — prerequisites, env vars, known test-harness quirks
- `extension/package.json` — `selenium-webdriver@4.46.0`/`geckodriver@6.1.0` devDependencies (both re-vetted: official Selenium repo, webdriverio-community's maintained geckodriver wrapper — no postinstall risk beyond the vetted binary download, approved via `npm approve-scripts`), `test:e2e:firefox:core`/`test:e2e:firefox:autofill` scripts
- `extension/.gitignore` — ignores the harness's own profile/screenshot output directories
- `.planning/phases/13-dual-browser-hardening/uat-ff-screenshots/` — 99 real screenshots (evidence for every row, plus the exploratory probes that led to each technique fix)

## Decisions Made

- **No product-code divergences found — Task 2 made zero source changes.** Every genuine issue encountered while building this session's harness was a test-harness bug (see Firefox Deviations in `13-UAT-CHECKLIST.md` for the full accounting): WebDriver-vs-CDP tab-focus semantics, closed-shadow-root coordinate targeting, `sendKeys('\n')` not dispatching a real Enter keypress on Firefox/geckodriver, and this shared UAT account's historical item accumulation skewing fixed-row-index assumptions. None of these are things a real user would ever hit — they are artifacts of automating a browser that has no CDP.
- **The ext-scoped rpId-on-Firefox question is answered "no, and the product already handles it correctly."** This is a browser-platform limitation (Firefox doesn't extend WebAuthn to extension pages the way Chrome does for `chrome-extension://`), not a bug to fix. Password unlock remains the fully-functional universal fallback (D-06), confirmed throughout the entire walk.
- **Surface B/A (not the popup) drove every autofill fill test.** This is architecturally sound, not a workaround-of-convenience: `autofill.matchFrame`/`fillFrame` is the content-relay's own sender-derived-origin channel, exercising the identical `fillValues()`/`content.fill` product code the popup's picker also calls — just reached through a different, equally-real in-page UI surface, chosen because classic WebDriver cannot address the popup without genuinely stealing Firefox's OS-level active-tab focus from the page being tested (confirmed via a dedicated isolated probe).
- **Coordinate clicks into closed shadow roots were computed, not guessed.** Where the product's own CSS/JS gives an exact formula (`inpage-overlay.ts`'s panel/row geometry; `generate-popover.ts`'s `positionTrigger()`/`positionPopover()`), that formula was used directly. Where the button position is dynamic (Apply/Fill/Confirm buttons whose vertical position depends on variable content), a small purpose-built script (`find_color.py`) locates the brand-orange primary-action button by scanning a genuine screenshot for that exact RGB value — real, falsifiable automation, never a narrated pass.

## Deviations from Plan

### Auto-fixed Issues (test-harness only — see key-decisions above; NOT product code)

None of the following are Task 2 divergence fixes (no `extension/`/`crates/` source file was touched) — they are corrections made to THIS PLAN'S OWN harness while building it, listed here for completeness per the deviation-tracking convention:

1. **[Harness bug] `sendKeys('\n')` does not dispatch a real Enter keypress on Firefox/geckodriver.** Produced two false FAILs (P11-SC2, P11-SC4) before being root-caused (the test page's own `submit` listener never fired) and fixed to `sendKeys(Key.RETURN)`.
2. **[Harness bug] Orange-color-cluster selection initially picked the wrong cluster** (Surface B's small "PV" brand badge, ~19px wide, also renders in the exact same brand orange as the intended Fill/Confirm button, and both can have `cx > 500`). Fixed by selecting the WIDEST cluster instead of the first one past an x-threshold — the primary action button is reliably the widest orange region on any given panel.
3. **[Harness bug] A fixed "click row 0" assumption on Surface B's match list is not reliable on this shared, many-session UAT account** — TOTP items match by issuer-vs-hostname only (ignoring port), and card/identity items are not origin-scoped at all by product design, so historical items from dozens of prior sessions can occupy row 0 ahead of a freshly-created test item. Fixed via bounded row iteration (P10-SC2) and a reload-before-each-attempt strategy (P10-SC4, since a successful wrong-kind fill dismisses the whole panel).
4. **[Harness bug] P9-SC7's fullscreen-button click initially targeted a non-clickable ancestor `<div>`** sharing the button's own text instead of the real `<button>` element, producing a false FAIL on the first attempt.
5. **[Harness bug] P11-SC4's cross-origin-isolation check initially queried both `[data-pv-mount-host]` and `[data-pv-autofill-host]`** on the top page, wrongly flagging Surface B's own legitimate, unrelated login-autofill suggestion for the top page's real form as if it were the (correctly frame-scoped, correctly absent) mismatch panel.

---

**Total deviations:** 0 product-code fixes (Task 2's own mandate found nothing to fix). 5 test-harness technique bugs found and corrected while building this plan's own tooling, documented above and in `13-UAT-CHECKLIST.md` for transparency.
**Impact on plan:** None on product correctness — every one of the 24 rows was proven genuinely correct on Firefox once the harness itself was debugged to accurately reflect real product behavior.

## Issues Encountered

- **No prior Firefox extension automation existed anywhere in this project** (unlike Chrome, which had this project's own prior-session probe scripts as a starting point for 13-03's harness) — this plan built the entire selenium-webdriver + geckodriver approach from scratch within this session, including working out that Firefox has no CDP, that WebDriver's tab-switching genuinely changes OS-level focus (unlike CDP), and that closed shadow roots block `elementFromPoint()` on Firefox too. This consumed the large majority of this plan's total time; documented in full in `13-UAT-CHECKLIST.md`'s Firefox Deviations section and `extension/e2e-firefox/README.md` so a future investigator doesn't have to repeat this discovery work.
- **Firefox's WebAuthn Virtual Authenticator WebDriver extension is confirmed NOT IMPLEMENTED** (`NS_ERROR_NOT_IMPLEMENTED` on `nsIWebAuthnService.addVirtualAuthenticator`, tested directly) — there is no CDP-equivalent stand-in for "the native OS authenticator" on Firefox/geckodriver. P12-SC3's fallthrough-to-native half was verified only up to "the page's promise settles, never hangs" (which is the literal thing the SC's own wording requires); completing an actual native-authenticator ceremony needs real hardware/user interaction, same manual carve-out as the Chrome row's own "another PM extension installed" clause (deferred-items.md D-15).

## User Setup Required

None — no external service configuration required. (The harness itself needs Firefox + Python/Pillow installed locally to re-run; documented in `extension/e2e-firefox/README.md`.)

## Next Phase Readiness

- **Phase 13 (Dual-Browser Hardening) is now fully complete.** All four success criteria (D-01 through D-04 per ROADMAP) are satisfied: every v0.2 feature re-verified on both browsers (this plan), `web-ext lint` passing (13-01), honest Firefox degradation UX for capability gaps (13-02, confirmed live in this plan's rpId-on-Firefox row), and the Firefox MV2 target re-confirmed under full feature load (this plan's D-05/D-08 rows).
- `13-VALIDATION.md`'s `nyquist_compliant: true` — the phase's validation contract is satisfied.
- No blockers for whatever milestone/phase comes next. The `extension/e2e-firefox/` harness is available for any future Firefox-side regression investigation without needing to rebuild the tooling.

---
*Phase: 13-dual-browser-hardening*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: extension/e2e-firefox/run-core.cjs
- FOUND: extension/e2e-firefox/run-autofill-capture.cjs
- FOUND: extension/e2e-firefox/find_color.py
- FOUND: extension/e2e-firefox/README.md
- FOUND: .planning/phases/13-dual-browser-hardening/13-UAT-CHECKLIST.md
- FOUND: .planning/phases/13-dual-browser-hardening/13-VALIDATION.md
- Commit e9c5de7 (Task 1) — FOUND in git log
- Commit 0d1be3a (Task 2) — FOUND in git log


---

## CORRECTION ADDENDUM (2026-07-17, post-research — see 13-FF-WEBAUTHN-RESEARCH.md)

The headline claim above ("Firefox rejects WebAuthn from ANY moz-extension:// page outright, independent of rpId") is TOO STRONG. Verified against Bugzilla/MDN: since **Firefox 150** (bug 1956484, RESOLVED FIXED) an extension MAY call navigator.credentials for a **web-domain rpId covered by its host_permissions**; what is permanently impossible is `rpId = extension-id` (moz-extension is not a registrable domain — spec origin validation, not a Mozilla choice). Both empirical probes were expected to fail under the new model too (extension-id rpId = invalid domain; "localhost" = no host permission held at probe time), so the observation stands but the generalization does not. Separately, bug 2026687 (open, design-decision-approved) closes the action popup when the OS WebAuthn prompt appears — any extension-run ceremony must live in a tab/window, not the popup. The shipped D-12/D-13 disabled+explainer degradation remains CORRECT for what v0.2 ships. A viable Firefox passkey-unlock path exists (server-origin PRF ceremony, rpId = server domain, PRF since FF135) — registered as v0.2.x backlog, not a phase-13 gap.
