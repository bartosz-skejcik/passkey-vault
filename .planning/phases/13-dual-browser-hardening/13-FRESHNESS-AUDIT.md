# Phase 13 Freshness Audit — plans vs post-phase-12 tree

**Audited:** 2026-07-17 (5 parallel Opus auditors, workflow wf_1851d3f3-5f2)
**Baseline:** main @ 19444f6 (Phase 12 SEALED); extension 514/514 vitest, both wxt builds green.
**Verdict:** ALL FIVE SUBJECTS MAJOR_STALE — plans written 2026-07-15, before phases 11-12 executed. Root cause: 13-RESEARCH Assumption A4 ("no server-side CORS work needed") falsified by the 2026-07-17 Firefox live-UAT; plus systemic "19 SCs" miscount (ROADMAP Phase 9 has SEVEN SCs; real total 21 -> 23 checklist rows).

## Executive repair map

1. **NEW plan 13-05 (moz-extension CORS / EXT-05, closes Phase 9 SC#6 moz half)** — server CODE needs nothing (parse_extension_origins already accepts concrete moz-extension origins, rejects `*` per WR-07); deliver: empirical UUID stability check, docs (.env.example, SELF-HOSTING.md, deploy examples), ServerConfigView UX (copyable own-origin + CORS-vs-unreachable distinction — per Bartek decisions), verification that the 13-01 host-permission fix lets background fetches bypass CORS on FF MV2. ROADMAP §13: add 5th checkbox.
2. **13-01** — keep skeleton; surgery: gecko.id UNCHANGED (D-09: passkey-vault@extension.local), strict_min_version = "115.0" (storage.session floor; never 91), CSP = verify-not-add (WXT auto-converts object->MV2 string, already shipped), Task 1 shrinks to `npm i -D web-ext@10.5.0` + lint:firefox --source-dir ./.output/firefox-mv2, keep the optional_permissions MV2 fix (Firefox branch only), Task 3 smoke scoped to the D-02 WASM-instantiation proof.
3. **13-02** — re-scope: CUT the provider-ceremony half entirely (ProviderCeremonyView already ships capability-driven prfUnavailableNote per D-16/WR-02 — the plan's copy would REGRESS a recorded decision); no vitest.config creation (exists, ^3.2.7, 45 test files); real gap = popup ext-scoped surfaces: UnlockView get()-throw silent dead-end, extractPrfBytes-undefined shown as text-error instead of neutral D-03 tone, EnrollExtPasskeyPrompt create()-throw silent; helper goes in lib/passkeys/ (DRY the inline .prf?.enabled read), NOT new lib/platform/.
4. **13-03** — 21 SCs (P9=7!), 23 checklist rows; fixture-based launchPersistentContext (config CANNOT express --load-extension); vitest must exclude e2e/ (else npm test breaks); provider SCs drive the REAL consent UI (provider-confirm/provider-decline/provider-credential-row-<id>) — CDP vAuth ONLY for native-fallthrough + ext-scoped PRF unlock; mine prior-session harnesses (selector map in appendix); honesty dispositions for P12-SC5 (grep audit), P9-SC6 (chrome half only), P12-SC3 (two-PM manual), P12-SC4 (degradation is Firefox-side); pin @playwright/test@1.61.1; respect 12-07 overlay coordination + mediation.
5. **13-04** — Task 1 step 0: Firefox server bring-up (capture moz-extension origin via runtime.getURL, restart pv-server with it in PV_EXTENSION_ORIGINS); persistent-profile web-ext run (--keep-profile-changes --firefox-profile <dir> + --source-dir .output/firefox-mv2) — fresh temp profiles rotate the UUID and wipe storage; D-05 rewrite for MV2-PERSISTENT background (no idle-kill exists on Firefox — verify storage placement + clear-on-lock/close instead); T-13-10 threat text still asserts createElement injection 12-03 never shipped; scriptable primary = selenium-webdriver + geckodriver (installAddon temporary) with web-ext+manual as fallback, falsifiable evidence per row; count fix; NEW rows: ext-scoped rpId-on-Firefox (closes wxt.config.ts open question), Phase 9 SC#6 + SC#7, optional V-04.
6. **13-UI-SPEC** — D-03 copy rows reconciled to SHIPPED strings (provider.prfUnavailableNote site-framed per WR-02; unlock.passkeyUnsupported); trigger split by surface (browser clientExtensionResults read = popup ext-scoped only; provider = passkey-rs derivePrfCapability).
7. **13-VALIDATION** — 19->21 SCs, drop "vitest new to extension/", wave-0 fix, "all 21 rows" -> "all 23 rows".

Bartek decisions pending (asked via AskUserQuestion before fixers run): moz-CORS UX surfacing, CORS-vs-unreachable message, Firefox ext-passkey degradation presentation, D-03 copy canonicalization.

---

## 13-01-PLAN.md

**Verdict:** MAJOR_STALE

### [BLOCKER] B1-gecko-id-must-not-change

**Finding:** Task 2 instructs setting browser_specific_settings.gecko.id to 'passkey-vault@paczesny.pl', which REVERSES a recorded, already-shipped decision. The gecko.id was pinned to 'passkey-vault@extension.local' in Phase 8 (D-09/D-04) and changing it is precisely the identity churn D-04 exists to prevent (it would orphan any storage.session state keyed to add-on identity).

**Evidence:** 13-01-PLAN.md:114-115 and :139 prescribe 'passkey-vault@paczesny.pl'; extension/wxt.config.ts:128-132 already ships gecko.id='passkey-vault@extension.local'; 08-03-SUMMARY.md:73-76 (coverage D4) records both packaged manifests carrying 'passkey-vault@extension.local'; generated .output/firefox-mv2/manifest.json shows "gecko":{"id":"passkey-vault@extension.local"}.

**Repair:** In Task 2 <action> and <acceptance_criteria>, replace every 'passkey-vault@paczesny.pl' with the shipped value 'passkey-vault@extension.local'. Reframe from 'set gecko.id' to: gecko.id is ALREADY pinned (Phase 8, wxt.config.ts:130) and MUST NOT change; Task 2 only ADDS strict_min_version beside the existing id. Change the acceptance criterion 'gecko.id that is NOT a WXT default/dev-mode placeholder' to 'gecko.id equals the existing passkey-vault@extension.local, unchanged'.

### [BLOCKER] B2-strict-min-version-floor-wrong

**Finding:** Task 2 suggests an MV2 strict_min_version floor of 'Firefox 91 ESR'. That is below the real API floor: the extension relies on browser.storage.session (the D-05 User-Key home) in 9 non-test files, and storage.session did not ship in Firefox until 115. A floor of 91 would assert compatibility with versions where the extension cannot function, which is exactly the Pitfall-3 trap the plan cites.

**Evidence:** 13-01-PLAN.md:120 recommends 'Firefox 91 ESR'; grep storage.session (non-test) → 9 files incl extension/entrypoints/background/session-storage.ts:1, provider-ceremony.ts:148-162, popup/App.tsx:137-285; wxt.config.ts:125-127 records strict_min_version 'deliberately NOT set here -- deferred to Phase 13'; browser.storage.session availability = Firefox 115+ (MDN browser-compat).

**Repair:** In Task 2 <action>, delete the '91 ESR is defensible' guidance and set strict_min_version: '115.0' with rationale = 'storage.session requires FF115; 115 is also an ESR'. Explicitly forbid any floor <115. Add: after the floor is set, `web-ext lint` (Task 3) validates every manifest key against it — watch specifically for a content_scripts[].world finding, since the generated firefox-mv2 manifest emits "world":"ISOLATED" (a key Firefox only recognizes from 128). Resolve that per ACTUAL lint output; do not pre-emptively bump to 128 on assumption.

### [BLOCKER] B3-csp-shape-claim-false-and-already-shipped

**Finding:** Task 2 frames the strict identical CSP as new work and instructs that MV2 needs a plain-string content_security_policy because 'the MV3 object shape under an MV2 manifest ... will be silently ignored or rejected by web-ext lint'. Both are false for the pinned WXT 0.20.27: WXT auto-converts the object to the MV2 string at build time, and the CSP is already shipped and lands correctly on both browsers. Following this instruction risks an unnecessary per-browser CSP branch, which violates D-09 ('identical, not branched per browser').

**Evidence:** node_modules/wxt/dist/core/utils/manifest.mjs:348-351 convertCspToMv2() converts content_security_policy.extension_pages → MV2 string; generated .output/firefox-mv2/manifest.json already has "content_security_policy":"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"; wxt.config.ts:122-124 ships the object shape (D-07 comment); 13-01-PLAN.md:106-110 and :141 state the false MV2 claim.

**Repair:** In Task 2 <action>, DELETE the 'MV2 uses a plain string / object shape is ignored or rejected' paragraph. Reframe: the CSP is ALREADY shipped as the object shape (wxt.config.ts:122-124) and WXT auto-converts it to the correct MV2 string (verified in the real firefox-mv2 manifest) — Task 2 must NOT add, rewrite, or per-browser-branch the CSP (branching would break D-09). State Task 2's ONLY wxt.config.ts edits are: (1) add strict_min_version (B2), (2) add the Firefox-branch optional_permissions fix (B5). Update the objective (line 29) accordingly from 'pin a strict CSP' to 're-confirm the already-shipped CSP survives the packaged build'.

### [WARNING] B4-task1-stale-facts

**Finding:** Task 1's core premises are stale: it claims 'This dev machine has no Firefox installed' and prescribes adding dev:firefox/build:firefox scripts that already exist. Only web-ext (devDependency) and lint:firefox are genuinely missing, and the lint script's placeholder dir (firefox-mv3) is wrong.

**Evidence:** firefox --version → 'Mozilla Firefox 152.0.6'; extension/package.json:9 has "dev:firefox":"wxt -b firefox" and :12 has "build:firefox":"wxt build -b firefox"; package.json:8 "dev":"wxt" already targets chrome by default; `npm view web-ext version` → 10.5.0 (plan's @10.5.0 pin is CORRECT); real output dir is .output/firefox-mv2 (not firefox-mv3 as in plan lines 79-81 / RESEARCH:309).

**Repair:** Rewrite Task 1 to the actual delta only: (a) DELETE the brew-install-Firefox step and the 'no Firefox installed' premise (FF 152.0.6 present). (b) Do NOT add dev:firefox or build:firefox (already present, equivalent). (c) dev:chrome is redundant with existing 'dev'; add only for naming symmetry, mark optional. (d) Genuine work: `npm i -D web-ext@10.5.0` (pin confirmed still-latest) and add "lint:firefox": "web-ext lint --source-dir ./.output/firefox-mv2" (hard-correct mv3→mv2). Keep the fast `npm view web-ext repository.url`/`scripts.postinstall` sanity re-check.

### [WARNING] B5-optional-permissions-fix-valid-but-conflated-with-cors

**Finding:** The carried-over optional_host_permissions→optional_permissions MV2 fix is REAL and correctly identified — keep it. But Task 2 conflates it with server reachability: it claims verifying browser.permissions.request() proves 'configureServer()'s path works end-to-end on Firefox'. The healthz probe that produced the Firefox 'CORS Missing Allow Origin' failure runs BEFORE the permission is granted, so the manifest fix cannot resolve it.

**Evidence:** WXT strips optional_host_permissions for MV2: manifest.mjs:390-395 (mv3OnlyKeys); generated firefox-mv2/manifest.json permissions=[storage,alarms,activeTab,tabs] with zero host patterns; 09-03-SUMMARY.md:172,182 flags the fix 'for Phase 13'; ServerConfigView.tsx:80-95 shows config.set (healthz probe) runs FIRST and browser.permissions.request fires AFTER onConfigured() (best-effort), i.e. the probe is a pre-grant cross-origin fetch.

**Repair:** Keep the fix but scope its claim: (1) confirm Firefox-branch-ONLY (host patterns in optional_permissions are invalid in Chrome MV3 — retain optional_host_permissions for Chrome; the plan already says this). (2) Verify WXT passes optional_permissions through untouched (it is in no strip list) and that the rebuilt firefox-mv2 manifest gains the host patterns. (3) Split the acceptance criterion: this task verifies the permission PROMPT/grant only; explicitly note that server reachability of the pre-grant healthz probe is a SEPARATE deliverable (B6), so 'configureServer end-to-end on Firefox' must NOT be asserted as satisfied here.

### [WARNING] B6-moz-extension-cors-deliverable-unplaced

**Finding:** The Bartek-confirmed moz-extension CORS deliverable has no home in 13-01. It is a different requirement (EXT-05 / Phase-9 SC#6, not XBR-01) touching pv-server + docs + possibly the popup — all outside 13-01's declared files_modified. The plan-fixer must place it, or the phase's own confirmed commitment falls through.

**Evidence:** deferred-items.md:25-26 (Firefox live-UAT hit 'CORS Missing Allow Origin', 'Faza 13 ... musi' — Bartek-confirmed 2026-07-17); 13-01-PLAN.md:7 files_modified=[wxt.config.ts, package.json] only; server ALREADY parses moz-extension origins (mod.rs:162-184 parse_extension_origins) and rejects bare '*' loudly (mod.rs:165-172, WR-07).

**Repair:** Do NOT fold this into 13-01 (keep 13-01 = manifest/CSP/gecko/tooling). Recommend a NEW plan 13-05 (requirement EXT-05) covering: (a) empirical Firefox check — temp-add-on moz-UUID stability vs an installed-build UUID, AND whether a POST-grant extension fetch bypasses CORS on FF MV2 (belt-and-braces question); (b) operator UX only, since server parsing already exists: document the paste-your-moz-UUID workflow (mirroring EXT-05's server-base-URL) in SELF-HOSTING.md + .env.example, NEVER a blanket '*'; (c) record that the healthz-probe-pre-grant timing (B5) makes the server-side moz-extension allowlist genuinely REQUIRED for Firefox configure to succeed, not optional. Add a note in 13-01 pointing to 13-05 so the two are linked.

### [INFO] B7-task3-smoke-overlaps-13-04-uat

**Finding:** Task 3's about:debugging runtime WASM smoke test overlaps the full per-feature dual-browser UAT that 13-04 owns (D-01). It should stay, but be scoped minimally to avoid duplicated effort now that Firefox is installed.

**Evidence:** 13-01-PLAN.md:159-163 (load temp add-on, trigger a crypto op, check console); 13-CONTEXT.md:25 (D-01: every v0.2 feature manually re-verified on both browsers = 13-04's job); MEMORY notes Playwright UAT authorized with Firefox harnesses staged.

**Repair:** Keep Task 3's smoke but scope it to the D-02 proof only: load .output/firefox-mv2 via about:debugging, trigger ONE vault-unlock WASM round-trip, confirm no CompileError/EvalError under the packaged CSP. Add one sentence: full per-feature cross-browser parity UAT is deferred to 13-04 (D-01); 13-01's smoke proves only that WASM instantiates under the packaged Firefox CSP.

**Bartek questions raised:**
- moz-extension CORS UX (for the proposed 13-05): should the extension surface the user's own moz-extension://<uuid> origin string inside ServerConfigView so they can paste it into PV_EXTENSION_ORIGINS (mirroring the EXT-05 server-base-URL paste flow), or is a docs-only workflow in SELF-HOSTING.md acceptable? This is a user-story/UX call, not a security call — the security constraint (never a blanket '*', WR-07) is already fixed by the server.

**Auditor notes:** VERDICT RATIONALE (MAJOR_STALE): the plan's skeleton (harden manifest/CSP/gecko + web-ext lint on the packaged Firefox build) is still the right shape and much genuine work is correctly present, but four items need substantive surgery: it prescribes reversing a recorded decision (B1 gecko.id), asserts a mechanism contrary to the shipped build (B3 CSP object 'rejected on MV2' — WXT auto-converts), would ship a false compatibility floor (B2 strict_min_version 91 vs real 115), and omits a Bartek-confirmed deliverable (B6). These are corrections, not a rewrite.

KEEP (verified fresh / correct — the fixer should NOT touch these): web-ext@10.5.0 pin is still the latest published version; the optional_host_permissions→optional_permissions MV2 fix is genuinely needed and correctly diagnosed (B5); Task 3's lint + runtime-WASM-smoke structure is sound (just scope it, B7); the Package Legitimacy re-check note is fine; must_haves.truths and files_modified are internally consistent with a manifest/CSP/gecko-only scope.

GROUND-TRUTH SPOT-CHECKS CONFIRMED: Firefox 152.0.6 installed; web-ext NOT yet a devDependency (genuinely missing); .output dirs are chrome-mv3 + firefox-mv2 (Firefox=MV2, background.persistent:true); firefox-mv2 manifest already carries the correct CSP string, gecko.id=passkey-vault@extension.local, background.persistent:true, content_scripts world:ISOLATED, and NO host patterns; Chrome manifest keeps optional_host_permissions + CSP object + the pinned key + stable id bbpnpamaoddpkfjnohkkepbjgbjpdbfo; server parse_extension_origins already accepts moz-extension entries and panics-guards '*'.

NET for the plan-fixer: Task 1 shrinks to (web-ext dep + lint:firefox --source-dir ./.output/firefox-mv2). Task 2 shrinks to (add strict_min_version '115.0' + Firefox-branch optional_permissions fix) with gecko.id and CSP re-confirmed-not-changed. Task 3 kept but minimally scoped. Add a pointer to a NEW plan 13-05 for the EXT-05 moz-extension CORS deliverable (server already parses it; missing pieces are the empirical Firefox check + operator docs + one UX call for Bartek).

---

## 13-02-PLAN.md + 13-UI-SPEC (D-03 contract)

**Verdict:** MAJOR_STALE

### [BLOCKER] B1

**Finding:** Task 1's core premise 'No test framework exists yet for extension/' is FALSE. The extension already has a full vitest harness; the plan would have the executor create/overwrite an existing config and add a conflicting/downgraded vitest@3.2.4 devDependency.

**Evidence:** extension/vitest.config.ts EXISTS (81 lines, two projects: background=node, popup=jsdom). extension/package.json:16 '"test": "vitest run"', vitest ^3.2.7 (NOT 3.2.4), jsdom ^25.0.1, @testing-library/react. `find` counts 45 *.test.ts(x) files. The plan's cited source, 13-RESEARCH.md:383-384, is itself stale ('no automated test framework exists yet for the extension/ package ... extension package has none yet').

**Repair:** In Task 1 <action> (13-02-PLAN.md:74-91): DELETE the entire 'No test framework exists yet ... Add a minimal extension/vitest.config.ts mirroring web/vitest.config.ts ... or a fresh vitest@3.2.4 devDependency' instruction. Replace with: 'extension/vitest.config.ts already exists (two projects; vitest ^3.2.7). A pure-logic test placed outside entrypoints/popup/ runs under the background(node) project automatically — do NOT create/overwrite vitest.config.ts and do NOT add any vitest devDependency.' Remove extension/vitest.config.ts from files_modified (line 7), from Task 1 <files> (line 66), and from the git-add in verification line 164.

### [BLOCKER] B2

**Finding:** files_modified (frontmatter line 7) and Task 2 <files> (line 104) name 'extension/entrypoints/content' — a directory that does not exist. The plan cannot git-add it and the executor would guess the wrong file.

**Evidence:** `ls extension/entrypoints/` returns only __tests__/, background/, popup/, and the flat files content-relay.content.ts, page-bridge.content.ts, page-bridge-firefox.ts, background.ts. No content/ dir. Popup surfaces are flat files: extension/entrypoints/popup/UnlockView.tsx, ProviderCeremonyView.tsx, EnrollExtPasskeyPrompt.tsx.

**Repair:** In frontmatter files_modified (line 7) and Task 2 <files> (line 104): drop 'extension/entrypoints/content' and 'extension/entrypoints/popup' (the bare dir). Name the concrete real files this re-scoped plan touches: extension/entrypoints/popup/UnlockView.tsx, extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx, extension/lib/i18n/dictionary.ts, plus their .test.tsx siblings (UnlockView.test.tsx, EnrollExtPasskeyPrompt.test.tsx). Remove ProviderCeremonyView.tsx (see B3).

### [BLOCKER] B3

**Finding:** Task 2 wires detectPrfSupport (a browser clientExtensionResults read) into the passkey-provider ceremony consent card — but that surface already ships an honest-degradation note driven by the CORRECT (passkey-rs/WASM) signal, is a pure presentational component with no ceremony to read, and the plan's copy reverses recorded decision WR-02/D-16.

**Evidence:** ProviderCeremonyView.tsx:87-102 (resolvePrfNoteKey) and :231 already render provider.prfUnavailableNote when prfCapable===false; prfCapable is sourced from background passkey-rs derivePrfCapability (12-04-SUMMARY D2; 12-05-SUMMARY key-decisions). File header :14-22 documents D-16 (capability-driven, never browser-sniffed) and that the component 'never talks to ... sendMessage directly' — it has no PublicKeyCredential to pass to detectPrfSupport. dictionary.ts:220-230 records WR-02: prfUnavailableNote reworded to attribute unavailability to the SITE/passkey, NEVER 'this browser', because 'the provider computes PRF entirely in WASM regardless of browser'. The plan's Task 2 provider copy (lines 122-123) reintroduces exactly 'This browser doesn't support fast unlock (PRF)...'.

**Repair:** CUT the provider-ceremony half of Task 2 entirely. Remove: the ProviderCeremonyView target from <files>; the two provider copy strings (lines 122-123) and the provider acceptance criterion (line 136); the second key_link (frontmatter lines 25-28); and the '...and the passkey-provider ceremony consent card both show...' clause in must_haves.truths (line 13). Add a one-line note that the provider surface already satisfies D-03 via its capability-driven prfUnavailableNote (no change needed) and that detectPrfSupport (browser read) must NOT be wired there under D-16.

### [BLOCKER] B4

**Finding:** Task 2's automated verify (line 132) greps extension/entrypoints/ for the two WR-02-forbidden provider strings; the plan cannot pass verification without reverting the recorded WR-02 rewording.

**Evidence:** 13-02-PLAN.md:132 requires `grep -rq "This browser doesn't support fast unlock (PRF) for this passkey"` AND `grep -rq "Ta przeglądarka nie wspiera szybkiego odblokowania (PRF)"`. Neither exists in the tree (dictionary.ts:227-230 ships the WR-02 site/passkey-framed copy instead), and adding them reverses WR-02/D-16.

**Repair:** In the line-132 verify and acceptance_criteria (lines 135-136): delete the two provider-string greps/assertions. Keep only the two POPUP-surface strings ('Fast unlock isn't available for this passkey on this browser' / 'Szybkie odblokowanie passkeyem nie jest dostępne'), which are legitimately new for the ext-scoped popup unlock path. Point the grep at the real popup files (extension/entrypoints/popup/ and extension/lib/i18n/dictionary.ts), not the whole entrypoints/ tree.

### [BLOCKER] B5

**Finding:** 13-UI-SPEC.md's Copywriting Contract (line 108) and capability-degradation-contract section (lines 130-152) — the exact spec section this audit covers — carry the WR-02-forbidden browser-blaming provider copy and describe the provider note's trigger as a browser clientExtensionResults read, both contradicting the shipped D-16/WR-02 reality.

**Evidence:** 13-UI-SPEC.md:108 row 'Firefox PRF-gap (D-03) — passkey-provider ceremony' = 'Ta przeglądarka nie wspiera szybkiego odblokowania (PRF)...' / 'This browser doesn't support fast unlock (PRF)...' vs shipped dictionary.ts:227-230 ('Ta strona poprosiła o funkcję PRF...' / 'This site requested a PRF feature this passkey can't provide.'). 13-UI-SPEC.md:141-145 states the trigger is 'clientExtensionResults.prf.enabled' for the note, wrong for the provider path (passkey-rs/WASM, per D-16).

**Repair:** In 13-UI-SPEC.md: (a) reconcile the line-108 provider-ceremony row to the shipped WR-02 copy (site/passkey-framed, never browser) OR strike the row and note the provider surface's honest-degradation is already shipped and capability-driven; (b) in the capability-degradation-contract block (lines 130-152), split the trigger by surface — the browser clientExtensionResults.prf read applies ONLY to the popup ext-scoped unlock/enroll surface; the provider note is driven by background passkey-rs derivePrfCapability, not a browser read. Leave line 107 (the popup D-03 row) intact — it is legitimately new and browser-framing is correct there.

### [WARNING] B6

**Finding:** The genuinely-missing Firefox honest-degradation work is under-scoped. The real D-03 'never silently fail' violations are the ext-scoped create()/get() THROW paths (moz-extension rpId can reject EARLIER than clientExtensionResults), which currently silently reset to idle or show a generic error — not the calm neutral D-03 line the UI-SPEC specifies.

**Evidence:** UnlockView.tsx:152-158 — navigator.credentials.get() throw is swallowed with a bare `return` (no notice at all). UnlockView.tsx:160-164 — extractPrfBytes undefined sets prfNotice 'failed' → renders unlock.passkeyFailed with text-error (generic error, not the neutral text-base-content/70 D-03 tone UI-SPEC lines 85/135 mandate). EnrollExtPasskeyPrompt.tsx:63-70 — create() throw → setPhase('idle'), fully silent. (Note EnrollExtPasskeyPrompt.tsx:72-78 already handles create-ok-but-no-PRF honestly via extPasskey.enrollNoPrf.)

**Repair:** Re-scope Task 2 to the popup ext-scoped surface with three concrete sub-cases using the new popup D-03 copy: (a) UnlockView get() catch (line 153) — distinguish NotAllowedError (user cancel: stay silent) from other throws (SecurityError etc: show the neutral D-03 banner); (b) UnlockView extractPrfBytes-undefined (line 161) — replace the text-error unlock.passkeyFailed with the calm neutral D-03 line (text-base-content/70, no error styling) per UI-SPEC; (c) EnrollExtPasskeyPrompt create() catch (line 65) — same cancel-vs-fail split + neutral banner. Keep the passkey CTA always visible/clickable (already true at UnlockView.tsx:222 / EnrollExtPasskeyPrompt.tsx:153). Reuse existing lib/passkeys/prf.ts extractPrfBytes for the get-path.

### [WARNING] B7

**Finding:** Task 1 creates a new lib/platform/ directory and a parsePrfExtensionResults/detectPrfSupport pair that partly duplicates existing code; placement is inconsistent with the established home and detectPrfSupport's .enabled read matches the ENROLL create-path, not the unlock get-path the objective pairs it with.

**Evidence:** No extension/lib/platform/ dir exists; the analogous PRF readers live in extension/lib/passkeys/ (prf.ts exports extractPrfBytes reading prf.results.first — the get-path OUTPUT; ext-prf.ts builds options). EnrollExtPasskeyPrompt.tsx:72-73 already inlines `getClientExtensionResults()...prf?.enabled` — the exact capability two-case-collapse Task 1 specifies as new. The plan's detectPrfSupport reads .enabled (create/enroll capability), distinct from extractPrfBytes's .results.first (get/unlock output).

**Repair:** Place the new pure function in extension/lib/passkeys/ (co-located with prf.ts / ext-prf.ts), not a new lib/platform/. Update Task 1 <files> (line 66), frontmatter artifacts (lines 16-19), key_links (line 21), and the objective/verify paths accordingly. Have it DRY up EnrollExtPasskeyPrompt.tsx:72-73's inline capability read (its real consumer). Clarify in the objective that this capability helper feeds the ENROLL create-path; the unlock get-path keeps using the existing extractPrfBytes (undefined === PRF-unavailable).

**Auditor notes:** Plan 13-02 was written 2026-07-15 against a pre-phase-8-12 tree and is materially out of sync with what phases 11/12 actually shipped. Two structural problems dominate: (1) Task 1's premise ("no test framework exists yet for extension/") is false — extension/ has a full vitest ^3.2.7 harness (81-line vitest.config.ts, 45 test files, background+popup projects), so the executor would recreate/downgrade an existing config. (2) Task 2 tries to wire a browser-clientExtensionResults PRF banner into ProviderCeremonyView.tsx, but that surface (a) already renders provider.prfUnavailableNote gated on the real passkey-rs capability signal (prfCapable prop), (b) is a pure presentational component that never runs a WebAuthn ceremony (no PublicKeyCredential to feed detectPrfSupport), and (c) per WR-02 (12-05) had its copy DELIBERATELY reworded to never blame "this browser" — the exact wording the plan and 13-UI-SPEC line 108 try to reintroduce. Under D-16 the provider computes PRF in WASM regardless of browser, so browser-framed copy there is factually wrong and forbidden. The provider half of Task 2 must be CUT, not fixed. The genuinely-missing D-03 work lives on the POPUP ext-scoped surface only (UnlockView + EnrollExtPasskeyPrompt), where create()/get() against a moz-extension rpId can throw EARLIER than clientExtensionResults and currently silently dead-ends. There the browser-framed copy IS correct (ext-scoped unlock genuinely uses the browser's own WebAuthn/PRF). The two surfaces have architecturally different PRF mechanisms and the plan wrongly treats them identically. Popup components are flat in extension/entrypoints/popup/ (App.tsx, UnlockView.tsx, ProviderCeremonyView.tsx, EnrollExtPasskeyPrompt.tsx); there is NO extension/entrypoints/content directory. extractPrfBytes already exists in lib/passkeys/prf.ts, and EnrollExtPasskeyPrompt.tsx:72-73 already inlines the exact prf.enabled two-case-collapse the plan wants to "newly" build.

---

## 13-03-PLAN.md

**Verdict:** MAJOR_STALE

### [BLOCKER] B1-sc-count-wrong

**Finding:** The entire plan is built on '19 success criteria' with 'Phase 9's 5'. Phase 9 actually has 7 SCs, so the real total across Phases 9-12 is 21 (7+5+4+5), not 19. This wrong number is baked into must_haves.truths, the context comment, Task 1, the verify script, acceptance criteria, and the checklist row count.

**Evidence:** ROADMAP.md:76-84 lists Phase 9 SC 1-7 (server-URL config, password+PRF unlock, storage.session survival, auto-lock, browse/search/sync, CORS extension-origin, open-full-vault). ROADMAP.md:121-127 Phase 10=5; :151-156 Phase 11=4; :178-184 Phase 12=5. Plan asserts 19 at 13-03-PLAN.md:12,13,47-48,84,95,98,127,163.

**Repair:** Replace every '19' with '21' and 'Phase 9's 5'/'Phase 9 SCs 1-5' with 'Phase 9's 7'/'Phase 9 SCs 1-7' at 13-03-PLAN.md lines 12, 13, 47-48, 84 (rewrite to '21 total: Phase 9's 7, Phase 10's 5, Phase 11's 4, Phase 12's 5'), 98, 163. Change the Task-1 verify one-liner at line 95 from 'if(n<19)' to 'if(n<21)'. Change Task-2 row math at line 127 from '21 rows (19 SCs + D-05 + D-08)' to '23 rows (21 SCs + D-05 + D-08)' and the acceptance criterion at line 127 accordingly. Use the exact 21-SC list supplied in notes so the checklist mapping is unambiguous.

### [BLOCKER] B2-cdp-vauth-wrong-for-provider

**Finding:** Task 1 tells the executor to drive ALL 'Phase 12 passkey-provider SCs' with a CDP WebAuthn virtual authenticator. That is the wrong authenticator model post-phase-12 and would produce false greens or timeouts: the extension itself is the authenticator (passkey-rs in WASM), and the page's navigator.credentials.create/get is replaced by the shipped MAIN-world patch, which brokers the ceremony via the popup consent UI. A CDP vAuth operates below the JS API and only ever fires on fallthrough to native — for create/get it never runs (the shim brokers), so a test relying on it either hangs waiting for a consent it never drives, or bypasses the extension entirely and passes without exercising the provider bridge at all.

**Evidence:** extension/.output/chrome-mv3/manifest.json content_scripts include world:"MAIN" (the page-bridge patch). 12-03-SUMMARY.md:10-11 provides page-bridge.content.ts as the navigator.credentials RPC shim. Real consent UI = extension/entrypoints/popup/ProviderCeremonyView.tsx:238 (data-testid=provider-confirm), :265 (provider-decline), :209 (provider-credential-row-<itemId>). Ground-truth D-16: provider PRF is WASM-computed, capability-driven, works on Firefox too. Contrast the CORRECT vAuth use: popup-full-flow.js attaches a CDP virtual authenticator (hasPrf) to the POPUP page for the ext-scoped (rpId=extension id) UNLOCK passkey — that IS a real browser WebAuthn call. Plan text: 13-03-PLAN.md:86-92.

**Repair:** Rewrite 13-03-PLAN.md:86-92. State: (a) Provider create/get SCs (P12-SC1/SC2) are brokered by the extension — NO CDP virtual authenticator; the test calls navigator.credentials.create/get on a fixture page, then drives the popup ProviderCeremonyView consent (click [data-testid=provider-confirm]; pick [data-testid=provider-credential-row-<itemId>] for get) and asserts the vault item was created/used. (b) CDP virtual authenticator is needed ONLY for: P12-SC3 fallthrough (stands in for the native OS authenticator reached AFTER the shim falls through via [data-testid=provider-decline]) and P9-SC2's ext-scoped PRF unlock (hasPrf:true vAuth on the popup CDP session, rpId=extension id, per popup-full-flow.js/probe-webauthn-rpid.js). (c) Do NOT use hasPrf:false on the provider ceremony to 'exercise the D-03 banner on Chrome' — provider PRF is WASM-computed (D-16) and won't read a browser authenticator's clientExtensionResults; the D-03 degradation banner belongs to the ext-scoped UNLOCK path (13-02) and can only be forced on Chrome via a hasPrf:false vAuth on the UNLOCK ceremony, not the provider one. Add a line: tests must respect 12-07 overlay coordination (passkeyCeremonyInFlight suppresses the phase-10 login overlay; passkey always wins when two in-page surfaces compete) and mediation (conditional vs immediate get) — a provider test must not assert an autofill overlay is visible while a ceremony is in flight.

### [BLOCKER] B3-vitest-collision

**Finding:** The new extension/e2e/dual-browser.spec.ts will be collected by the EXISTING vitest suite. The 'background' vitest project uses vitest's default include (**/*.spec.ts) and excludes only node_modules and entrypoints/popup/**. A Playwright spec importing from @playwright/test throws under vitest, so `npm test` (currently 506 green) will break. The plan neither adds an exclude nor lists vitest.config.ts in files_modified.

**Evidence:** extension/vitest.config.ts:61-69 — background project: exclude: ["**/node_modules/**", "entrypoints/popup/**"], no include override (=> default **/*.{test,spec}.?(c|m)[jt]s?(x)); popup project include is entrypoints/popup only. No root-level test.exclude exists. 13-03-PLAN.md:7 files_modified omits vitest.config.ts. Note 13-02-PLAN.md:7 already lists extension/vitest.config.ts as a file it modifies (coordination point; 13-03 depends_on 13-02).

**Repair:** Add extension/vitest.config.ts to 13-03-PLAN.md:7 files_modified. In Task 1 <action>, instruct: add "e2e/**" (and/or "**/*.pw.spec.ts") to BOTH the background and popup project excludes (or a root-level test.exclude) in vitest.config.ts so vitest never collects the Playwright specs, and confirm `npm test` still reports the full pre-existing suite green after adding the e2e dir. Set Playwright's testDir to 'e2e' in playwright.config.ts so the two runners stay disjoint. (WXT entrypoint discovery is unaffected — it scans entrypoints/, not e2e/.)

### [BLOCKER] B4-config-cannot-express-load-extension

**Finding:** Task 1 and its acceptance criterion require 'playwright.config.ts defines exactly one chromium project using launchPersistentContext with --load-extension'. Persistent-context creation and --load-extension CANNOT be expressed in playwright.config.ts project/use options — extension loading requires chromium.launchPersistentContext, which must live in a custom test FIXTURE (the official Playwright 'Chrome extensions' pattern: test.extend that creates the context + derives the extension id). As written the acceptance criterion is unsatisfiable and would send the executor down a dead end.

**Evidence:** Proven in-repo harnesses all create the context imperatively: chrome-idle-kill.js and popup-full-flow.js call `chromium.launchPersistentContext('', { channel:'chromium', headless:true, args:['--disable-extensions-except=<.output/chrome-mv3>','--load-extension=<...>'] })` then derive extId from ctx.serviceWorkers(). Plan text: 13-03-PLAN.md:71-79 (action) and :99-100 (acceptance).

**Repair:** Reword 13-03-PLAN.md:71-79 and :99-100: playwright.config.ts holds only testDir/reporter/timeouts and a single 'chromium' project; the persistent-context + --load-extension + extension-id derivation live in an e2e/fixtures.ts that exports an extended `test` (context + extensionId fixtures) per Playwright's official chrome-extension example. Change acceptance criterion to: 'e2e/fixtures.ts loads the unpacked .output/chrome-mv3 via chromium.launchPersistentContext with --load-extension/--disable-extensions-except and exposes context+extensionId fixtures; playwright.config.ts declares one chromium project and NO firefox project.' Encode the proven launch config: channel:'chromium', headless:true works with extension loading in this repo (no headed/--headless=new needed); derive extId from ctx.serviceWorkers()[0]/waitForEvent('serviceworker').

### [WARNING] B5-mine-existing-harnesses

**Finding:** The plan tells the executor to author 21 test cases from scratch ('copy the exact SC wording... write one test per SC') but never points at the extensive proven Playwright harnesses from prior sessions, which already encode the exact selectors, flows, env, and gotchas. Inventing selectors risks wrong-path tests and false greens.

**Evidence:** Prior-session harnesses exist under /private/tmp/claude-501/-Users-j5on--work-projects-passkey-vault/{270023a3,e1361adc,e2d2ac4c,71997f1b}*/scratchpad/uat/: chrome-idle-kill.js, popup-full-flow.js, probe-sc4567.js (P9 SC4/5/7), probe-crossclient-sync.js (P9-SC5), probe-webauthn-rpid.js (ext PRF), probe-autofill-wave3.js/probe-totp.js (P10), probe-adversarial-iframe-10-07.js (P10-SC5), probe-phase11-capture.js (P11), probe-passkey-net.js + 71997f1b/12-PROVIDER-UAT.md (P12). Real selectors verified: input#pv-server-url, input[type=email]/[type=password], button[type=submit] (probe-sc4567.js:19-25); data-testid=provider-confirm/provider-decline (ProviderCeremonyView.tsx:238,265); data-testid=autofill-totp-fill-/copy- (TotpFillRow.tsx:158,167); data-testid=on-this-page-section (OnThisPageSection.tsx:149); web app unlock data-testid=unlock-submit (web/src/components/auth/UnlockOverlay.tsx:167,220).

**Repair:** Add a Task-1 read_first/action step: 'Mine the prior-session harnesses in the four listed scratchpad/uat dirs for selectors, flows, and gotchas before writing any test; do not invent selectors.' Embed the verified selector map above. Encode gotchas as explicit test-setup rules: (1) SERVER = http://localhost:8620 NEVER 127.0.0.1 (RP_ID binding) — popup-full-flow.js still uses the wrong 127.0.0.1; probe-sc4567.js uses the correct localhost; normalize to localhost. (2) Kill zombie serve.mjs children on ports 8791/8792 before/after adversarial-iframe tests. (3) pv-server must run with PV_STATIC_DIR=web/out and PV_EXTENSION_ORIGINS=chrome-extension://bbpnpamaoddpkfjnohkkepbjgbjpdbfo; account uat-prf04@example.local / CorrectHorseBattery-UAT-2026!. (4) CDP-vAuth ceremonies need a single focused tab. (5) Playwright Chromium is en-US — use data-testids or bilingual (PL+EN) text selectors, never PL-only.

### [WARNING] B6-feasibility-honesty

**Finding:** Task 2 mandates 'every row's Chrome column is PASS or FAIL, never blank' and the must_haves claim 'every SC has an automated Playwright test exercising it on Chromium'. Four SCs cannot be a clean Chromium green and must be marked honestly, not forced into a fabricated PASS.

**Evidence:** P12-SC5 (ROADMAP.md:184) is a /gsd-secure-phase grep audit already completed in Phase 12 — it is scripts/audit-mainworld-boundary.sh (12-03-SUMMARY.md:15,133), a static check, not a runtime behavior. P9-SC6 (ROADMAP.md:83) moz-extension CORS half is DEFERRED to phase 13 Firefox work and still open (deferred-items.md:25-26). P12-SC3 (ROADMAP.md:182) 'with another password-manager extension installed' coexistence is a manual install-order UAT (deferred-items.md:19-22, D-15). P12-SC4 (ROADMAP.md:183) honest-degradation COPY is Firefox-side; Chrome has PRF so the banner won't fire on the provider path.

**Repair:** In Task 2, add explicit disposition rules: P12-SC5 row = 'verified by scripts/audit-mainworld-boundary.sh (exit 0) + 12-05 security review — static audit, not a Playwright case' (a spec MAY shell out to the audit script and assert exit 0). P9-SC6 Chrome column = PASS for the chrome-extension origin only; annotate 'moz-extension half deferred to 13-01/13-04 (Firefox)'. P12-SC3 Chrome column = automate the fallthrough-to-native half via CDP vAuth; annotate the two-PM-coexistence clause 'MANUAL — see deferred-items.md D-15 install-order UAT'. P12-SC4 Chrome column = assert the positive 'PRF used' path only; annotate 'degradation copy verified Firefox-side in 13-04 (won't fire on Chrome)'. Do NOT emit a green for a path not actually exercised. Also note: Phase 11 theme/style-parity work (11-07/08/09) is taste/visual, NOT an SC — the checklist must not fabricate a visual-parity green.

### [INFO] B7-pin-playwright-version

**Finding:** Plan installs @playwright/test without a pinned version ('latest' per research). Pin it for reproducibility.

**Evidence:** `npm view @playwright/test version` => 1.61.1; repository.url => git+https://github.com/microsoft/playwright.git (Microsoft-official, matches 13-RESEARCH.md:114 Package Legitimacy Audit). Not currently installed (no node_modules/@playwright/test, absent from package-lock.json). Plan text: 13-03-PLAN.md:65.

**Repair:** In Task 1 <action>, pin the install: `npm i -D @playwright/test@1.61.1` (or ^1.61.0) and `npx playwright install chromium` only (Firefox intentionally excluded). Keep the `npm view @playwright/test repository.url` sanity re-confirm as already written.

**Auditor notes:** CORRECTED SC INVENTORY (feeds 13-UAT-CHECKLIST.md). Real total = 21 SCs (NOT 19). Per-phase: Phase 9 = 7, Phase 10 = 5, Phase 11 = 4, Phase 12 = 5. Checklist = 21 SC rows + D-05 + D-08 = 23 rows.

PHASE 9 — Session Unlock Core (7 SCs) [ROADMAP.md:76-84]:
- P9-SC1 First-run: configure own pv-server URL; validated via /healthz; persisted; editable; nothing hard-coded. AUTOMATABLE (probe-configset/probe-realconfig/verify-changeserver; selector input#pv-server-url).
- P9-SC2 Unlock from popup with master password AND with a PRF passkey where supported. AUTOMATABLE (password: popup-full-flow; PRF half: CDP vAuth hasPrf:true on POPUP CDP session, rpId=ext id, per probe-webauthn-rpid).
- P9-SC3 Unlocked User Key ONLY in chrome.storage.session; usable across SW idle-kill/wake (60s+). AUTOMATABLE (chrome-idle-kill/probe-wake-list). == D-05 invariant row.
- P9-SC4 Auto-lock: key cleared after configurable idle timeout AND on browser close. AUTOMATABLE (probe-autolock for idle; browser-close half via context teardown/reopen — partial/indirect).
- P9-SC5 Browse/search/pick any item; edit on another synced client appears via REST+WS. AUTOMATABLE (probe-crossclient-sync; needs API write + WS propagation).
- P9-SC6 pv-server CORS allowlist accepts fixed extension origin (chrome-extension:// AND moz-extension://), end-to-end. CHROME HALF AUTOMATABLE (PV_EXTENSION_ORIGINS=chrome-extension://bbp...); moz-extension HALF DEFERRED to 13-01/13-04 (Firefox), still open per deferred-items.md:25-26.
- P9-SC7 Popup 'open full vault' opens configured server web app in new tab; popup doesn't re-implement management. AUTOMATABLE (probe-sc4567; assert new-tab URL==server; web app lands authed-but-locked → click [data-testid=unlock-submit] if asserting web state).

PHASE 10 — Autofill (5 SCs) [ROADMAP.md:121-127]:
- P10-SC1 Detect login form; offer fill username+password; picker on multiple matches. AUTOMATABLE (probe-autofill-wave3 + e2e-fixtures).
- P10-SC2 Live TOTP fills/copies into 2FA field. AUTOMATABLE (probe-totp; data-testid autofill-totp-fill/copy).
- P10-SC3 Card fields (number/expiry/CVV/cardholder) fill from saved card, same-origin. AUTOMATABLE.
- P10-SC4 Identity fields (name/address/email/phone) fill from saved identity. AUTOMATABLE.
- P10-SC5 No autofill without explicit gesture; no top-level creds into cross-origin iframe — adversarial fixture. AUTOMATABLE, SECURITY (e2e-fixtures/adversarial-iframe/serve.mjs ports 8791 origin A / 8792 origin B; probe-adversarial-iframe-10-07).

PHASE 11 — Generate & Capture (4 SCs) [ROADMAP.md:151-156]:
- P11-SC1 Signup form → offer generated password (character + passphrase modes). AUTOMATABLE (probe-phase11-capture).
- P11-SC2 After successful submit/login → prompt to save new login, attributed to correct origin. AUTOMATABLE (SPA/AJAX submit heuristic).
- P11-SC3 Password change on site with existing login → offer update (not duplicate). AUTOMATABLE.
- P11-SC4 Save/update prompts show actual origin + warn on origin mismatch (cross-origin iframe). AUTOMATABLE (adversarial fixture).
  NOTE: 11-07/08/09 theme/style parity = TASTE/visual, NOT an SC — no fabricated visual-parity green.

PHASE 12 — Passkey Provider (5 SCs) [ROADMAP.md:178-184]:
- P12-SC1 navigator.credentials.create() registers ES256 passkey (passkey-rs) saved to vault. AUTOMATABLE — EXTENSION is authenticator, NO CDP vAuth; drive popup ProviderCeremonyView consent [data-testid=provider-confirm]; assert item saved. (12-PROVIDER-UAT.md/probe-passkey-net).
- P12-SC2 navigator.credentials.get() logs in with a vault passkey. AUTOMATABLE — same; provider-confirm + provider-credential-row-<itemId>.
- P12-SC3 Decline/no-match → clean fallthrough to native OS authenticator, with another PM extension installed. FALLTHROUGH half AUTOMATABLE via CDP vAuth (fires only after shim falls through, via [data-testid=provider-decline]); 'another PM extension installed' coexistence = MANUAL (deferred-items.md:19-22, D-15).
- P12-SC4 PRF used where allowed (Chromium-first); Firefox/PRF-unavailable degrades honestly with specific message. Chrome POSITIVE 'PRF used' path AUTOMATABLE; degradation COPY is Firefox-side (13-04) — do NOT assert provider-ceremony banner on Chrome (provider PRF is WASM-computed, D-16). Unlock-path banner can be forced on Chrome only via hasPrf:false vAuth on the UNLOCK ceremony (13-02 surface).
- P12-SC5 Security review confirms MAIN-world patch is key-free RPC shim, grep-audited. NOT A PLAYWRIGHT TEST — scripts/audit-mainworld-boundary.sh + completed 12-05 review; checklist row = 'verified by audit script + 12-05'.

TWO EXPLICIT INVARIANT ROWS (already in plan Task 2, keep):
- D-05: chrome.storage.session-only key survives idle-kill/wake (Chrome). Overlaps P9-SC3.
- D-08: MAIN-world navigator.credentials patch injection behaves as designed (Chrome). Overlaps P12-SC1/2/5.

TEST-COUNT GATE: change the `if(n<19)` gate to at least 20 (21 SCs minus P12-SC5 which is a grep, unless represented as a spec that shells to the audit script → then 21). Never 19.

COORDINATION / DEPENDENCY NOTES:
- 13-03 depends_on 13-01 (Firefox manifest/gecko/strict_min_version + web-ext — files: wxt.config.ts, package.json; no vitest/playwright overlap) and 13-02 (PRF degradation module + wires D-03 banner into UnlockView + ProviderCeremonyView; 13-02-PLAN.md:7 also modifies extension/vitest.config.ts). The vitest e2e-exclude edit (B3) should be owned by 13-03 (add vitest.config.ts to its files_modified) and must not conflict with 13-02's vitest edit.
- Build target confirmed: extension/.output/chrome-mv3/manifest.json exists (production `wxt build`/`npm run build`); also chrome-mv3-dev exists — point --load-extension at chrome-mv3 (NOT chrome-mv3-dev), matching all prior harnesses.
- 13-RESEARCH.md itself carries the same stale '19 SCs' (lines 386/394/406) and suggests a Playwright 'firefox project' (line 409) — the plan CORRECTLY dropped the firefox project (Playwright can't load a WebExtension into its Firefox channel; web-ext path is 13-04). The plan-fixer must NOT re-introduce a firefox Playwright project; keep chromium-only.
- Prior-session harnesses are plain `require('playwright')` node scripts (not @playwright/test); mine them for flow/selectors but port into the @playwright/test fixture model (B4).

---

## 13-04-PLAN.md

**Verdict:** MAJOR_STALE

### [BLOCKER] B1-server-cors-unowned

**Finding:** 13-04 walks all server-touching Firefox SCs but NO Phase-13 plan configures pv-server to accept the moz-extension origin. This is the exact Bartek-confirmed live blocker: Firefox's fetch to localhost:8620 carries Origin: moz-extension://<uuid>, which is not in PV_EXTENSION_ORIGINS, so every request fails 'CORS Missing Allow Origin' — the Firefox UAT dies at server-config (Phase 9 SC#1/#6) before any other SC can run. 13-01's optional_permissions host-grant is the CLIENT half only; the SERVER allowlist half is unowned. depends_on:[13-03] (line 6) transitively pulls in 13-01 but 13-01 never touches pv-server.

**Evidence:** grep across 13-01..13-04 PLAN.md for pv-server|PV_EXTENSION_ORIGINS|CORS|moz-extension returned ZERO hits (files_modified: 13-01=[wxt.config.ts,package.json], 13-02=[prf-support,vitest,popup,content], 13-03=[playwright,e2e,package.json,checklist], 13-04=[checklist,dual-browser.spec.ts]); deferred-items.md:25-26 'Faza 13 musi pozwolić pv-serverowi akceptować moz-extension origin ... Bez tego Firefox nie połączy się z serwerem w ogóle. Half of SC#6 z fazy 9 wciąż otwarte'; crates/pv-server/src/routes/mod.rs:162-184 parse_extension_origins accepts concrete moz-extension://<uuid> but bails on '*' (no pattern support); 13-RESEARCH.md:342 assumption A4 'No new server-side pv-server changes are needed' — now falsified by the 2026-07-17 deferred item written AFTER the research.

**Repair:** Add an explicit Firefox-server bring-up prerequisite as step 0 of Task 1, BEFORE any server-touching SC: (1) load the firefox-mv2 add-on, then in its background devtools console capture the live origin via `browser.runtime.getURL('')` -> moz-extension://<uuid>/; (2) (re)start pv-server with PV_EXTENSION_ORIGINS='chrome-extension://bbpnpamaoddpkfjnohkkepbjgbjpdbfo,moz-extension://<captured-uuid>' (parser already accepts concrete moz origins per routes/mod.rs:286 test 'moz-extension://bbb'); (3) record the exact moz origin used in the checklist Notes for Phase 9 SC#6. Change depends_on to ['13-01','13-03'] so the host-permission fix is an explicit (not just transitive) predecessor. Add a note that the deferred 'configurable safe pattern' server change is not delivered by any plan — the minimal correct path is that 13-04 owns the runtime-capture+restart step (server already accepts concrete moz origins; never '*').

### [BLOCKER] B2-sc-count-19-vs-21

**Finding:** The plan asserts '19 SCs' and a '21-row checklist (19 SCs + D-05 + D-08)'. The real ROADMAP count is 21 SCs: Phase 9 has SEVEN SCs (not 5), Phase 10=5, Phase 11=4, Phase 12=5. The miscount is systemic (research -> 13-03 -> 13-04). Corrected, the checklist is 23 rows. Worse: the two dropped Phase 9 SCs are #6 (moz-extension CORS end-to-end — the very deferred blocker in B1) and #7 (fullscreen/open-tab) — so as written, the Firefox walk silently omits the CORS SC Phase 13 exists to close.

**Evidence:** ROADMAP.md:78-84 lists Phase 9 SC 1..7 (line 83 = SC#6 'CORS allowlist accepts ... moz-extension://<id>, verified end-to-end against a real request, not assumed'; line 84 = SC#7 fullscreen); 13-04-PLAN.md:27 'walk all 19', :65 'Task 1 of 13-03 defines the 19 cases', :100 'All 21 checklist rows', :172 'Full 21-row matrix'; 13-03-PLAN.md:48 'Phase 9 SCs 1-5' and :83 'Phase 9's 5'; 13-RESEARCH.md:279 'Phase 9 (5 SCs) ... 19 total' — the origin of the error.

**Repair:** Do NOT hardcode a count. Reword every '19 SCs'/'21 rows'/'21-row matrix' (lines 27,65,100,172, must_haves.truths line 12, verify grep comments) to 'every SC row present in 13-03's checklist' so it tracks the corrected artifact. State the corrected total explicitly (21 SCs -> 23 rows incl. D-05+D-08, per ROADMAP: P9=7,P10=5,P11=4,P12=5). Add a hard requirement that Phase 9 SC#6 (moz-extension CORS, end-to-end real request) and SC#7 (fullscreen) each get a Firefox row — SC#6 must not be dropped, it is B1's verification. Flag the dependency: this count MUST equal auditor-13-03's corrected count; if 13-03 is not corrected, 13-04 will inherit the wrong checklist.

### [BLOCKER] B3-d05-idle-kill-impossible-on-firefox

**Finding:** Task 1's D-05 check instructs 'force the background context to terminate or go idle for 60+ seconds (Firefox's event-page model is more lenient...)'. Firefox does NOT ship an event page — the shipped target is MV2 with a PERSISTENT background page (background.persistent=true), which cannot be idle-killed at all. The test as written is unperformable, and its 'event-page model' premise is factually wrong. read_first even points the executor at 13-01-SUMMARY 'Firefox MV2/MV3 target confirmed', which will record MV2-persistent — contradicting the task body.

**Evidence:** extension/wxt.config.ts:3-14 'WXT's own per-browser default already produces Chrome -> MV3 service worker, Firefox -> MV2 persistent background page, and that split is exactly the deliberate choice ... background.persistent === true and a background.scripts array'; 13-04-PLAN.md:76-79 'force the background context to terminate or go idle for 60+ seconds (Firefox's event-page model ...)'; session-storage.ts:1-7,104-118 (User Key envelope in browser.storage.session, cleared by lockVaultSession / browser restart), :43 access_level TRUSTED_CONTEXTS.

**Repair:** Rewrite the Firefox D-05 row (lines 76-79): DELETE 'force the background to terminate or go idle 60+s' and the 'event-page model' framing. Replace with what is verifiable on MV2-persistent: in about:debugging -> Inspect (background devtools) console, assert `await browser.storage.session.get()` holds the key envelope (session-storage.ts KEY_STORAGE_KEY) while `await browser.storage.local.get()` holds NO key material; confirm access_level stays TRUSTED_CONTEXTS (never widened to content scripts, T-13-09); confirm auto-lock (lockVaultSession) clears the session key; confirm browser-close clears storage.session. Document HONESTLY that Firefox's persistent background page has no idle-kill to survive, so Chrome's 'survive idle-kill/wake' has no Firefox analog — parity is proven by storage-API placement + clear-on-lock/close behavior, NOT by a survival test (a persistent page plus a leaked module var would both trivially pass survival). Update T-13-09 wording if it implies an idle-kill event.

### [WARNING] B4-moz-uuid-rotation-fresh-profile

**Finding:** The plan's launch mechanism (`npx web-ext run -t firefox-desktop --verbose`, or dev:firefox=`wxt dev -b firefox`) uses a FRESH temporary profile per run by default. That rotates the moz-extension UUID every launch (independent of gecko.id) AND wipes storage.local + storage.session. Consequences: B1's PV_EXTENSION_ORIGINS goes stale on every relaunch; the EXT-05 server-config (storage.local) must be re-entered every run; cross-restart persistence can't be tested. A 21-SC systematic walk is impractical without a stable UUID. Also a mechanical bug: `web-ext run` needs `--source-dir .output/firefox-mv2` or it runs against CWD with no extension loaded.

**Evidence:** 13-04-PLAN.md:59-61 invocation omits --source-dir; deferred-items.md:26 'Firefox temporary add-on dostaje LOSOWY moz-extension UUID przy każdym przeładowaniu (niezależny od gecko.id)'; ground-truth env rule pins PV_EXTENSION_ORIGINS to the chrome origin only; server-config.ts:87-93 persists config in storage.local (wiped with a fresh profile).

**Repair:** Specify a PERSISTENT-profile launch so the UUID (stored in the profile's `extensions.webextensions.uuids` pref) stays stable across runs: `web-ext run --source-dir .output/firefox-mv2 --keep-profile-changes --firefox-profile <persistent-dir>` (or pre-seed a profile user.js pinning `extensions.webextensions.uuids` to a chosen UUID so PV_EXTENSION_ORIGINS can be set ahead of time). Add --source-dir to the invocation. Note that a SIGNED/AMO build gets a stable per-install UUID within any profile (still random but persistent), which is what a real install does differently. State plainly that default `web-ext run`/`wxt dev -b firefox` fresh temp profiles are unusable for a multi-SC walk (UUID rotation + storage reset).

### [WARNING] B5-d08-stale-mechanism-and-timing

**Finding:** Two D-08 problems. (1) Threat T-13-10's Mitigation asserts 'confirms identical manual document.createElement(\'script\')-from-ISOLATED-world injection behavior on both browsers' — a mechanism 12-03 did NOT ship, and it contradicts the plan's own reconciled Task 1 text (lines 81-90). Chrome uses declarative world:'MAIN' (no manual injection); Firefox uses WXT injectScript() of the page-bridge-firefox.js unlisted script. (2) The D-08 Firefox check ('patch present before page observation') omits the known injectScript timing caveat: the Firefox path is explicitly only 'as close to document_start as this mechanism allows' — it can lose the race on first navigation, and even Chrome's world:'MAIN' has Chromium bug 634381.

**Evidence:** 13-04-PLAN.md:158 T-13-10 'identical manual document.createElement(\'script\') ... injection behavior on both browsers'; 12-03-SUMMARY.md:58-67 (D2: Chrome declarative world:'MAIN' + document_start; Firefox injectScript() unlisted script, ISOLATED-only content_scripts + web_accessible_resources:[page-bridge-firefox.js]); content-relay.content.ts:770-786 'Fired fire-and-forget at the very top of main() ... to get Firefox as close to Chrome's document_start timing as this mechanism allows'; deferred-items.md:13 'Chromium bug 634381: world:\'MAIN\' + document_start does not guarantee running before the page's own inline scripts'.

**Repair:** (a) Rewrite T-13-10's Mitigation to name the actual per-browser mechanisms (Chrome declarative world:'MAIN'; Firefox injectScript() of page-bridge-firefox.js) and reframe the threat as 'different mechanisms may produce different OUTCOMES' — the check confirms identical outcomes, mechanism differs by design. (b) Add the honest timing caveat to the D-08 Firefox row: verify on a FRESH navigation to a page that reads navigator.credentials early — confirm EITHER the shim wins (`navigator.credentials.create.toString()` shows the RPC wrapper, not [native code]) OR it fails safe to native (installPatch try/catch, deferred-items.md IN-01) — never assume the shim always beats the page. 'Patched before page observation' on Firefox = verified-on-fresh-nav, not assumed.

### [WARNING] B6-firefox-automation-vehicle

**Finding:** Task 1 relies on `web-ext run --verbose` + manual driving with no scriptable vehicle named. Manual is policy-allowed (Playwright-UAT-authorized memory), but that memory requires results to be REAL ('an assertion that cannot fail is not a test'). Playwright genuinely cannot load an extension into its Firefox build, so the plan needs an explicit falsifiable-evidence path per SC — currently only console streaming is required for most rows.

**Evidence:** 13-04-PLAN.md:57-66 (web-ext run + 'drive each ... manually'); 13-VALIDATION.md:70 'Playwright does not support loading a WebExtension into its Firefox channel'; MEMORY playwright-uat-authorized (results must be real); 13-RESEARCH.md has no mention of selenium/geckodriver/puppeteer/installAddon (grep returned zero) — no scriptable mechanism was researched.

**Repair:** Name a concrete scriptable primary so each SC assertion can actually fail: PRIMARY = selenium-webdriver (npm, pin a current ^4.x) + geckodriver matching Firefox 152 (>=0.35) using `driver.installAddon(<zipped .output/firefox-mv2>, /*temporary*/ true)` — the canonical way to script a real Firefox with an extension loaded; drive each SC and assert on DOM/page state. FALLBACK = `web-ext run --verbose` + orchestrator-manual driving, but require per-SC concrete evidence (screenshot + captured console excerpt), never a bare PASS. Optionally note puppeteer-core WebDriver-BiDi `webExtension.install` as an alternative. Commit to one and mandate falsifiable evidence per row.

### [INFO] B7-nyquist-fresh-plus-minor

**Finding:** nyquist_compliant interplay is FRESH/correct — no repair needed there. Two minor non-blocking notes: (a) files_modified will not list the Phase 9-12 source files touched by divergence fixes (inherent to a triage plan; verification section already says git add per-file), and (b) the plan run against dev:firefox should confirm it is the wxt-wrapped web-ext path, not a separate one.

**Evidence:** 13-VALIDATION.md:5 'nyquist_compliant: false'; :84 'flip during Plan 13-04, Task 2, once all 21 checklist rows are green'; 13-04-PLAN.md:128-129 flips it to true once every row is PASS/RESOLVED — accurate and mutually consistent. 13-04-PLAN.md:7 files_modified omits owning-phase source files; :167 acknowledges per-fix git add.

**Repair:** No change required for nyquist_compliant (verified fresh). Optionally add a one-line note to files_modified that it is non-exhaustive for divergence fixes (owning-phase source files are added per-fix per the verification section). When the count in B2 is corrected to 23 rows, update VALIDATION.md:84's 'all 21 checklist rows' wording to match (that is 13-VALIDATION's line, flagged here only for cross-consistency).

**Auditor notes:** Audited 13-04-PLAN.md against the real post-phase-12 tree. Verdict MAJOR_STALE: 3 BLOCKERs + 3 WARNINGs + 1 INFO.

The plan's premise (walk the Firefox UAT, triage divergences, sign off) is structurally sound and D-08's Task-1 reconciled text (lines 81-90) already matches 12-03's shipped per-browser injection — but three load-bearing assumptions are broken by what actually shipped after these plans were written (2026-07-15):

1. SEQUENCING (B1): the moz-extension CORS server-side fix that the Phase 12 deferred item (2026-07-17) explicitly assigns to Phase 13 is owned by NO plan. 13-01 does the client host-permission half; the pv-server PV_EXTENSION_ORIGINS half is missing. Without it the Firefox walk cannot pass server-config, so every server-touching SC fails — this is the single most important repair. The server parser already accepts concrete moz origins (routes/mod.rs:162-184,286), so the fix is a runtime-capture+restart procedure 13-04 must own, not new server code — but it is currently absent from the plan.

2. COUNT (B2): '19 SCs' is a genuine miscount (ROADMAP Phase 9 has 7 SCs, real total 21 -> 23 rows). The two dropped Phase 9 SCs are #6 (moz-extension CORS) and #7 (fullscreen) — dropping #6 would erase the very verification Phase 13 exists to deliver. Must be reconciled with auditor-13-03's corrected count.

3. D-05 (B3): the 'force idle-kill 60+s / event-page model' test is unperformable — Firefox ships an MV2 persistent background page (wxt.config.ts:3-14), no idle-kill exists. Repair to storage-API-placement + clear-on-lock/close inspection, documented honestly.

WARNINGS: moz UUID rotation on fresh profiles makes the walk impractical unless a persistent profile pins the UUID (B4); T-13-10 asserts a 'manual document.createElement' mechanism 12-03 didn't ship and D-08 omits the injectScript first-navigation timing caveat (B5); no scriptable Firefox driver is named to keep self-driven results falsifiable (B6). INFO: nyquist_compliant interplay is fresh and correct (B7).

No Bartek question required — the moz-CORS mechanism and Firefox-driving choices are architecture/tooling within Claude's discretion per the discuss-question-level memory; the deferred item already records his 'never blanket *' constraint.

---

## Cross-cutting (CONTEXT/UI-SPEC/VALIDATION/ROADMAP/REQUIREMENTS)

**Verdict:** MAJOR_STALE

### [BLOCKER] B1-mozCORS-coverage-gap

**Finding:** The Bartek-confirmed moz-extension CORS deliverable — the phase's headline deferred item, which closes the still-open moz half of Phase 9 SC#6 — appears in NO Phase-13 plan. All four plans (13-01..13-04) are client-only: none touch pv-server docs, .env.example, SELF-HOSTING.md, deploy examples, or the ServerConfigView CORS UX. Root cause: 13-RESEARCH Assumption A4 ('no new server-side changes needed — CORS was handled in Phase 9') was written 2026-07-15 and falsified by the 2026-07-17 Firefox live-UAT.

**Evidence:** deferred-items.md:25-26 (Bartek-confirmed 2026-07-17, 'Half of SC#6 z fazy 9 wciąż otwarte'); 13-RESEARCH.md:342 Assumption A4 + :62,:65; grep -rln PV_EXTENSION_ORIGINS returns only config.rs/mod.rs/.planning (absent from .env.example, docs/SELF-HOSTING.md, deploy/*); SELF-HOSTING.md grep = 'NO CORS/origin mentions'; server-config.ts:44-55 probeServerHealth `catch { return false }` swallows the CORS TypeError; ServerConfigView.tsx:63 error union is only 'invalid-url'|'unreachable'; wxt.config.ts:56-64 open Firefox-origin question; grep of 13-0*.md for moz-extension/SC#6 = zero hits

**Repair:** Add a NEW plan 13-05 (files: docs/SELF-HOSTING.md, .env.example, deploy/*.example, extension/entrypoints/popup/ServerConfigView.tsx, extension/entrypoints/background/server-config.ts) with this deliverable set: (a) EMPIRICAL moz-extension UUID behavior check — temp add-on reload vs `web-ext run` with a kept/`--firefox-profile` profile vs an installed signed build — record whether the UUID is stable per-profile; (b) DOCS — document PV_EXTENSION_ORIGINS in .env.example and add a CORS section to SELF-HOSTING.md instructing Firefox self-hosters to paste their concrete moz-extension://<uuid> origin (CONCRETE origins ONLY, never `*` — honor WR-07 which panics on `*` at parse_extension_origins mod.rs:165-170); server CODE needs NOTHING (parse_extension_origins already accepts concrete moz-extension entries); (c) EXTENSION UX — surface the extension's own origin (browser.runtime.getURL('') → origin) as copyable text in ServerConfigView, and make probeServerHealth/ServerConfigView distinguish a CORS-blocked probe from a genuinely-unreachable server so the Firefox user gets actionable guidance instead of the generic 'unreachable'; (d) verify the Firefox MV2 host-grant fix from 13-01 Task2 actually lets background REST fetches bypass CORS, and pin down whether the moz-extension allowlist entry is still needed for any non-background-context fetch. Update ROADMAP §13 plan list from 4 to 5 checkboxes.

### [BLOCKER] B2-SC-count-19-vs-21

**Finding:** 13-03, 13-04 and 13-VALIDATION assume 19 success criteria ('Phase 9's 5, 10's 5, 11's 4, 12's 5'). Phase 9 actually has SEVEN SCs. Real total = 7+5+4+5 = 21. The two silently omitted are exactly Phase 9 SC#6 (moz-extension CORS — the deferred deliverable) and SC#7 (fullscreen/open-full-vault). The verification matrix therefore structurally excludes the very item Phase 13 must close.

**Evidence:** ROADMAP.md:78-84 lists Phase 9 SC1..SC7 (SC#6 = CORS chrome+moz, SC#7 = fullscreen); ROADMAP.md:121-127 Phase10=5, :151-155 Phase11=4, :180-184 Phase12=5; 13-03-PLAN.md:48 & :82 '19 total: Phase 9's 5...'; 13-03-PLAN.md:95 verify `if(n<19)`; 13-VALIDATION.md:46,:70 '19 SCs'; 13-03 acceptance '21 rows (19 SCs + D-05 + D-08)'

**Repair:** Update 13-03 (harness must have ≥21 test cases; verify `if(n<21)`), 13-04, and 13-VALIDATION to 21 SCs. Checklist row count becomes 23 (21 SCs + D-05 + D-08), not 21. Explicitly enumerate Phase 9 SC#6 (verify moz-extension CORS end-to-end against a real Firefox request — ties to B1) and SC#7 (fullscreen action) as their own rows. Note Playwright/CDP cannot exercise SC#6 on Firefox, so SC#6's Firefox column is a 13-04 manual/web-ext item.

### [BLOCKER] B3-13-02-rebuilds-shipped-PRF-UI-and-regresses-WR-02

**Finding:** 13-02's premise ('the one genuinely new piece of UI this phase owns') is false. Both target surfaces already ship honest PRF-degradation UI: popup unlock (UnlockView.tsx + dictionary `unlock.passkeyUnsupported`) and provider ceremony (ProviderCeremonyView.tsx:231 rendering `provider.prfUnavailableNote`, gated by derivePrfCapability). Worse, 13-02 Task2's exact-copy grep demands browser-blaming strings that (a) do not exist and (b) directly CONTRADICT Phase 12's deliberate WR-02 rewording that removed browser-blaming from the provider copy (D-16: extension computes PRF in WASM, so provider-PRF works on Firefox too — there is NO provider-side Firefox gap to announce). Following 13-02 literally regresses WR-02. It also creates lib/platform/prf-support.ts duplicating derivePrfCapability + extractPrfBytes, and lists a files_modified path (extension/entrypoints/content) that does not exist.

**Evidence:** dictionary.ts:220-229 (WR-02 comment: 'reworded to attribute PRF unavailability to the SITE...never this browser') + provider.prfUnavailableNote PL/EN (non-browser-blaming); dictionary.ts:56-58 unlock.passkeyUnsupported (already shipped, different wording); ProviderCeremonyView.tsx:87-99,:231 (note already rendered, text-sm text-base-content/70); provider-ceremony.ts:314-336 derivePrfCapability reads clientExtensionResults.prf.enabled (D-16, never browser-sniff); UnlockView.tsx:37,:96 (extractPrfBytes + 'Tier-1 line when a passkey IS enrolled but this browser can't run it'); 13-02-PLAN.md:7 files_modified 'extension/entrypoints/content' (find confirms no such dir); 13-02-PLAN.md:132 grep verify demands 'This browser doesn't support fast unlock (PRF)...' / 'Ta przeglądarka nie wspiera szybkiego odblokowania (PRF)' — neither string exists in tree

**Repair:** Rewrite 13-02 from 'build new detection module + banner + new copy' to 'VERIFY the already-shipped honest-degradation on both surfaces during the Firefox walk' (or fold entirely into 13-04). Concretely: (1) DELETE the create-lib/platform/prf-support.ts task — reuse the existing derivePrfCapability (provider) and extractPrfBytes/prf.ts (unlock); (2) REMOVE the exact-string greps in Task2 verify — they contradict shipped WR-02 copy; do NOT re-author provider.prfUnavailableNote back to browser-blaming; (3) fix files_modified (drop 'extension/entrypoints/content'); (4) the only genuine Phase-13 PRF work is confirming the EXTENSION-SCOPED UNLOCK passkey (rpId=extension id) degrades honestly to password on Firefox if moz-extension origins reject it — verify UnlockView's existing webauthnSupported gate + unlock.passkeyUnsupported copy actually fires on Firefox (see B8).

### [BLOCKER] B4-13-01-re-decides-D09-gecko-id

**Finding:** 13-01 Task2 instructs the executor to SET browser_specific_settings.gecko.id to a NEW value 'passkey-vault@paczesny.pl'. gecko.id is already pinned to the literal 'passkey-vault@extension.local' as recorded decision D-09 (Phase 8). This re-decides a recorded decision and would churn the Firefox add-on identity.

**Evidence:** wxt.config.ts:125-131 (gecko.id: 'passkey-vault@extension.local', comment 'strict_min_version is deliberately NOT set here -- deferred to Phase 13'); 08-01-SUMMARY.md:41 (D-09 'gecko.id fixed to the literal passkey-vault@extension.local...strict_min_version intentionally deferred to Phase 13'); STATE.md:91; 13-01-PLAN.md:112-117 ('set browser_specific_settings.gecko.id to a real, permanent extension identifier (e.g. passkey-vault@paczesny.pl...)'); 13-01-PLAN.md:139 acceptance

**Repair:** Rewrite 13-01 Task2: gecko.id is ALREADY pinned to 'passkey-vault@extension.local' (D-09) — DO NOT change it. This phase adds ONLY strict_min_version. Update the action text, acceptance criteria (drop the gecko.id-value assertion, keep 'gecko.id present and non-dev-placeholder'), and verify accordingly.

### [WARNING] B5-13-01-CSP-already-shipped-shape-instruction-wrong

**Finding:** 13-01 Task2 says to 'add a strict, identical CSP declaration' and warns at length that 'MV2 uses a plain string...do not use the MV3 object shape under an MV2 manifest, it will be silently ignored or rejected by web-ext lint'. Reality: wxt.config.ts already declares the exact strict CSP as a single MV3 object, and WXT auto-translates it to a Firefox MV2 string at build time (the same auto-convert it does for web_accessible_resources) — Phase 8 already verified the generated Firefox manifest carries the CSP string. So the CSP is already shipped and the shape-branching instruction is misaligned with how WXT actually handles it.

**Evidence:** wxt.config.ts:117-124 (content_security_policy.extension_pages = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';", single object for both browsers); 08-VERIFICATION.md:28 ('Both generated manifests carry content_security_policy with wasm-unsafe-eval (chrome extension_pages object; firefox string)'); wxt.config.ts:140-148 (same object→MV2 auto-convert pattern documented for web_accessible_resources); 13-01-PLAN.md:104-112

**Repair:** Reframe 13-01 Task2's CSP work as VERIFY-not-add (confirm the already-present single object declaration survives to the packaged firefox-mv2 manifest as a string). Delete the 'MV2 needs a plain string, don't use the object shape' instruction — WXT already translates the one object declaration correctly.

### [WARNING] B6-13-UI-SPEC-D03-copy-contract-stale

**Finding:** 13-UI-SPEC's Copywriting Contract D-03 rows are browser-blaming ('This browser doesn't support fast unlock (PRF)...', 'Fast unlock isn't available for this passkey on this browser...'). The shipped provider copy was deliberately reworded OFF browser-blaming (WR-02/D-16) and the shipped popup copy uses different wording. This stale UI-SPEC copy is the source 13-02 enforces via grep (feeds B3).

**Evidence:** 13-UI-SPEC.md:107-108 (browser-blaming D-03 lines); contradicted by dictionary.ts:227-229 provider.prfUnavailableNote ('Ta strona poprosiła o funkcję PRF...'/'This site requested a PRF feature this passkey can't provide') per WR-02 note dictionary.ts:220-226; and dictionary.ts:56-58 unlock.passkeyUnsupported

**Repair:** Update 13-UI-SPEC Copywriting Contract D-03 rows to cite the SHIPPED strings (provider.prfUnavailableNote for the ceremony; unlock.passkeyUnsupported for the popup) and mark them 'already shipped in Phases 9/12 — verify, do not re-author'. Keep the visual composition note (text-sm text-base-content/70, no icon/box) — that part already matches ProviderCeremonyView.tsx:231.

### [WARNING] B7-vitest-already-present

**Finding:** 13-02 Task1 and 13-VALIDATION assert 'no test framework exists yet for extension/' and instruct creating extension/vitest.config.ts and adding vitest@3.2.4. Extension already has vitest.config.ts, vitest ^3.2.7, jsdom, and 45 test files (506 tests).

**Evidence:** ls extension/vitest.config.ts exists; package.json devDependencies vitest ^3.2.7, jsdom ^25.0.1, script test='vitest run'; 45 *.test.ts(x) files; 13-02-PLAN.md:76-80 ('No test framework exists yet...Add a minimal extension/vitest.config.ts...fresh vitest@3.2.4'); 13-VALIDATION.md:20 ('Vitest 3.2.4...new to extension/ this phase') & :57 Wave-0 item

**Repair:** Remove the create-vitest.config.ts and add-vitest-dependency instructions from 13-02 Task1 and 13-VALIDATION Wave 0 / Test Infrastructure. The new prf test (if any survives B3) uses the existing config; version is ^3.2.7, not 3.2.4.

### [WARNING] B8-firefox-ext-passkey-rpId-row-unowned

**Finding:** The explicitly-deferred Phase-13 question — whether the extension-scoped UNLOCK passkey (rpId = extension id) works at all on Firefox given per-install moz-extension UUID origins, with 'honest degradation to password' as the expected outcome — is referenced by NO 13 plan and has no checklist row. This is distinct from the provider-ceremony PRF (which D-16 makes browser-agnostic).

**Evidence:** wxt.config.ts:56-64 (open question deferred to Phase 13); 09-08-SUMMARY.md:239 & 09-06-SUMMARY.md:361 (Firefox moz-extension rpId acceptance deferred to Phase 13, expected honest degradation); grep of 13-0*.md for rpId/ext-passkey = zero hits

**Repair:** Add an explicit checklist row (in 13-03/13-04, ties to Phase 9 SC#2 unlock) + a 13-04 Firefox-walk step: attempt extension-scoped PRF unlock on Firefox, record whether moz-extension origins accept rpId=extension id; if rejected, confirm UnlockView's webauthnSupported gate hides the passkey button and unlock.passkeyUnsupported copy fires, with password unlock fully working (D-06). Close the wxt.config.ts:56-64 open question in the 13-04 summary.

### [INFO] B9-V-04-reconfigure-session-unowned

**Finding:** Phase 9 verification flagged V-04 ('changing the server while a session exists doesn't invalidate the old-server session, and the old host permission isn't revoked') as 'note for Phase 13 hardening'. No 13 plan owns it.

**Evidence:** 09-VERIFICATION.md:130 (V-04 INFO, 'note for Phase 13 hardening'); grep of 13-0*.md for reconfigure/host permission = zero hits

**Repair:** Either add a small 13-04 checklist row (reconfigure-server behavior + stale host-permission on both browsers) or explicitly record V-04 as out-of-scope/backlog in 13-CONTEXT so it isn't silently dropped. Low priority — not an SC requirement.

### [INFO] B10-13-01-duplicate-scripts

**Finding:** 13-01 Task1 instructs adding dev:chrome, dev:firefox, build:firefox, lint:firefox. dev:firefox and build:firefox already exist in package.json (dev:firefox='wxt -b firefox', build:firefox='wxt build -b firefox'). Only lint:firefox is genuinely new (web-ext); dev:chrome is redundant with the existing 'dev'.

**Evidence:** package.json scripts: dev, dev:firefox, build, build:chrome, build:firefox, zip, zip:firefox, compile, test (no lint:firefox); web-ext undefined; 13-01-PLAN.md:76-82

**Repair:** 13-01 Task1: add ONLY lint:firefox (and dev:chrome if wanted). Do not re-declare dev:firefox/build:firefox. Confirm lint:firefox --source-dir targets the real output dir './.output/firefox-mv2' (NOT the placeholder 'firefox-mv3' in the plan) — Firefox builds to firefox-mv2.

**Bartek questions raised:**
- moz-extension CORS operator/user UX — how should a Firefox self-hoster supply their per-install moz-extension origin to PV_EXTENSION_ORIGINS? (A) ServerConfigView surfaces the extension's own origin as copyable text and the operator pastes it into PV_EXTENSION_ORIGINS, mirroring the EXT-05 base-URL paste flow — concrete origin, honors WR-07 [recommended]; (B) documentation-only: instruct a manual .env edit in SELF-HOSTING.md, no in-popup surfacing; (C) add a server-side guarded moz-extension://* pattern — flagged as risky, tension with WR-07's concrete-origins-only stance.
- When the /healthz probe is blocked by CORS (Firefox origin not yet allowlisted), the popup currently shows the same generic 'unreachable' as a genuinely-down server. Should ServerConfigView distinguish them? (A) detect the CORS/opaque failure and show a specific 'server reached but rejected this extension's origin — add <copyable-origin> to PV_EXTENSION_ORIGINS' message [recommended, directly unblocks the Firefox first-run]; (B) keep the single generic 'unreachable' message; (C) keep generic message but add a docs link.
- Firefox extension-scoped unlock-passkey degradation — if moz-extension origins reject rpId=extension-id, how should the popup present it? (A) hide the passkey-unlock button entirely and fall back to password, using the already-shipped webauthnSupported gate + unlock.passkeyUnsupported copy [matches current code + D-06]; (B) show the button but disabled with an inline explainer; (C) show + attempt + honest failure copy on rejection. (Respects standing passkey-priority + password-always-works D-06.)
- D-03 copy reconciliation — 13-UI-SPEC's browser-blaming D-03 lines conflict with the shipped, deliberately non-browser-blaming provider copy (WR-02) and the shipped popup unlock copy. (A) treat the shipped dictionary strings as canonical and retire the 13-UI-SPEC D-03 lines — do NOT re-decide WR-02 [recommended]; (B) re-author the popup unlock copy to the 13-UI-SPEC 'Fast unlock isn't available...' wording for consistency; (C) you pick the final wording per surface.

**Auditor notes:** VERDICT MAJOR_STALE. The 4 plans were written 2026-07-15 on 13-RESEARCH Assumption A4 ('no server-side work needed, CORS done in Phase 9'), which the 2026-07-17 Firefox live-UAT falsified — that single stale assumption drives the two biggest gaps (B1 moz-CORS deliverable absent, B2 SC count omits SC#6). \n\nQ2 (SC#6 closure): Phase 9 SC#6 is 'CORS allowlist accepts chrome-extension AND moz-extension origin, verified end-to-end' (ROADMAP:83); 09-VERIFICATION.md:59 verified the chrome half and deferred the moz half to Phase 13. Phase 13's SC set does NOT currently close it because (a) the moz-CORS deliverable is in no plan (B1) and (b) the 19-SC harness silently drops SC#6 (B2). Fixing B1+B2 (plus adding the Firefox end-to-end CORS row) closes SC#6. XBR-01 wording ('Firefox degrades explicitly/legibly where an API/PRF capability differs') does NOT cover moz-CORS — that's a hard connectivity blocker, not a capability degradation, so parity genuinely requires Firefox connecting; the deliverable is in-scope, not optional. \n\nQ5 (plan list): ROADMAP §13 has 4 checkboxes (:210-213) and needs a 5th for the moz-CORS plan (13-05); no renumber of 13-01..13-04 needed. \n\nWHAT IS FRESH / OK: server CODE needs no change (parse_extension_origins mod.rs:162-178 already accepts concrete moz-extension origins and loudly rejects '*' per WR-07); the provider-ceremony PRF path is correctly capability-driven not browser-sniffed (D-16, derivePrfCapability); 13-01's core intent (install Firefox, add web-ext+lint:firefox, pin strict_min_version, fix the 09-03 MV2 optional_host_permissions→optional_permissions blocker in Task2) is valid and correctly carried; @playwright/test and web-ext genuinely absent (those installs are real); 13-03's Chromium-only Playwright rationale is sound; 13-UI-SPEC popup-shell section already aligns with standing decisions (read-only popup, redirects-not-inline, no in-popup create/delete). \n\nMINOR (not Phase-13 blockers, FYI for the fixer): 13-UI-SPEC:178-181 describes the passkey-provider ceremony as an injected host-page Shadow-DOM overlay, but the shipped ProviderCeremonyView.tsx lives in entrypoints/popup/ (a popup view) — stale description, but 13-02's executor greps for the real file so it's non-blocking. ROADMAP Phase 12 section (:187) still shows '4/4 plans' while the header table and seal commit say 7/7 — pre-existing Phase-12 staleness, outside Phase 13.

---
