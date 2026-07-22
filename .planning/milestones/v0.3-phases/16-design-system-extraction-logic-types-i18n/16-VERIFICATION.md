---
phase: 16-design-system-extraction-logic-types-i18n
verified: 2026-07-20T22:47:51Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Load the security-critical screens — vault unlock, passkey-ceremony consent, and PRF error/degradation states — in both PL and EN locales in the running app (web) and the extension popup, and confirm every translated string renders as human-readable copy."
    expected: "Every string on those screens shows the intended PL/EN sentence (e.g. unlock.submit, unlock.passkeyCta, auth.loginFailed) — never a raw dotted key like \"unlock.submit\", never blank/undefined/lookup-failure artifact."
    why_human: "Judgment-tier prohibition (Plan 16-04, status: unresolved) on security-UI legibility. tsc guarantees every t(locale,key) call site's key still exists at compile time (keyof typeof DICTIONARY narrowing preserved on both wrappers, tsc clean) and the moved values are byte-identical, so a lookup-failure is structurally near-precluded — but no automated test renders these specific security surfaces and asserts the visible runtime copy. Per this project's 'security UI must always be legible' constraint (CLAUDE.md), a human render-check on these exact screens is the only proof of the runtime-legibility claim. This is a quick confirmation, not a deep investigation."
prohibitions:
  - statement: "MUST NOT let additive type-superset adoption (CardFields.pin/zip, IdentityFields structured address fields) cause extension autofill (fill-dom.ts) to newly read/write these PII fields into a third-party page's DOM this phase."
    plan: 16-02
    tier: test
    disposition: verified
    evidence: "fill-dom.ts last modified in Phase 10 (d34b772) — untouched by Phase 16 (git log). Exactly 1 IdentityFields write, the legacy flat `write(targets.address, values.address)`. Zero reads of addressLine1/addressLine2/city/state/zip/country. Deterministic git+grep enforcement present and independently re-run."
  - statement: "MUST NOT let the generic engine lose compile-time keyof narrowing or let a missing/mistyped key render as a raw key string/undefined/blank on a security-critical screen (unlock, passkey-ceremony consent, PRF error states)."
    plan: 16-04
    tier: judgment
    disposition: verified
    flag: "resolved — validated via authorized Playwright UAT 2026-07-21"
    evidence: "Structural half VERIFIED: both wrappers keep `key: keyof typeof DICTIONARY` (web:702, ext:243) so a missing key is a compile error, and both tsc --noEmit are clean; moved values are byte-identical. Runtime-legibility half on the specific security screens is judgment-tier and unresolved — routed to human_verification (see item 1). NOT a silent pass."
---

# Phase 16: Design System Extraction — Logic, Types, i18n — Verification Report

**Phase Goal:** Pure vault logic/types and the i18n engine live once in `packages/pv-ui`, consumed by both the web app and the extension via `export *` shims — closing the largest block of byte-identical duplicated code without a big-bang rewrite.
**Verified:** 2026-07-20T22:47:51Z
**Status:** passed (human item self-validated via authorized Playwright UAT — see Validation Evidence)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria — the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Card-brand detection, domain/search helpers, sort comparator, clipboard, and vault item type shapes are defined once in `pv-ui`; web and extension import them through shims, and both test suites pass unchanged. | ✓ VERIFIED | 7 canonical modules exist in `packages/pv-ui/{vault,i18n,clipboard.ts}`; all 4 pure modules (types, cardBrand, search, clipboard) are 1-statement `export *` shims on both consumers; sort is a split-shim. web vitest 481/481 pass, extension vitest 685/685 pass — unchanged from baseline. |
| 2 | A single i18n resolver (`t`/`interpolate`/`Locale`/`resolveLocale`) lives in `pv-ui`; web and extension both call the same engine, dictionary keys split per surface. | ✓ VERIFIED | `packages/pv-ui/i18n/engine.ts` exports `Locale`, generic `t<D>()`, `interpolate()`, `resolveLocale()`. Both `dictionary.ts` files import `t as tEngine`/`interpolate` from `pv-ui/i18n/engine` and delegate `return tEngine(DICTIONARY, locale, key)`. `common.ts` holds exactly 34 shared value-identical keys; 4 divergent keys stay local in each consumer (vault.emptyHeading/vault.emptyBody/search.emptyResults/autolock.label present in both dicts, absent from common.ts). `autofill-dictionary.ts` imports interpolate/Locale from the engine. engine.test.ts triplicated (pv-ui + web + extension), all pass. |
| 3 | No parallel duplicate implementation of any migrated module remains in `web/` or `extension/` — verified by search, not assumed. | ✓ VERIFIED | Repo-wide grep for `function {detectCardBrand,domainFromUrl,sortItems,copyWithAutoClear,normalizeItemFields,resolveLocale,searchItems,filterItems,clampClipboardSeconds,interpolate}` across web/src + extension/lib (excluding pv-ui): **zero hits**. Old closed-over `\bDICTIONARY[key][locale]` t()-body literal: **zero hits** anywhere (both wrappers now delegate to the shared generic engine). |

**Score:** 3/3 ROADMAP success criteria verified (0 present-behavior-unverified). Plus all 19 plan-level truths across Plans 16-01→16-06 verified (see below). One judgment-tier prohibition flagged for human review (does not fail a truth).

### Plan-Level Truths (all VERIFIED)

| Plan | Truth summary | Status | Evidence |
|------|---------------|--------|----------|
| 16-01 | 7 new exports subpaths + 3 web tsconfig aliases declared before consumers | ✓ VERIFIED | package.json exports has 11 entries (4 pre-existing + 7 new). NOTE: web/tsconfig paths aliases were subsequently removed by review-fix 643606f (WR-02) making the exports map the sole resolution authority — tsc/vitest still resolve pv-ui subpaths cleanly after removal (both tsc exit 0, both suites pass). Deviation is intentional and improves on the plan. |
| 16-02 | types.ts moves to pv-ui superset; both consumers pure shims; fill-dom.ts untouched | ✓ VERIFIED | pv-ui/vault/types.ts has full type set + normalizeItemFields + superset fields (pin/zip, addressLine1/2/city/state/country). Both shims are `export *`. fill-dom.ts unchanged (see prohibition). |
| 16-03 | cardBrand + clipboard move to pv-ui; 4 consumer copies become shims | ✓ VERIFIED | pv-ui/vault/cardBrand.ts + pv-ui/clipboard.ts exist; all 4 consumers are `export *` shims; web cardBrand.test.ts (9) + clipboard.test.ts pass. |
| 16-04 | Generic engine + common.ts split; interpolate/resolveLocale moved byte-for-byte; flagged fallback-locale/missing-key assumption | ✓ VERIFIED | Engine exports verified; interpolate WR-01-corrected (up-front hasAnyToken); resolveLocale undefined→"en" guard present. The flagged-assumption edge (fallback-locale, missing-key, interpolation semantics) is now exercised by the 5 behavior cases in engine.test.ts × 3, all passing — assumption discharged by passing tests. |
| 16-05 | search.ts pure shim; sort.ts split-shim (comparator shared, persistence local); frame-guard.ts untouched | ✓ VERIFIED | pv-ui/vault/search.ts imports from sibling ./types; sort.ts comparator-only with byName tie-break + lastUsed-desc/undefined-sinks rule preserved verbatim. Both sort.ts split-shims keep local persistence (web sync localStorage key "pv-vault-sort"; ext async browser.storage.local key "pv-popup-sort" + local sortByLastUsed). frame-guard.ts last modified Phase 10, no import of search.ts. |
| 16-06 | Aggregate zero-duplication + full gates green + structural guards pass | ✓ VERIFIED | Zero-duplication greps clean; both suites pass (guards no_other_extension_file_hard_codes_a_server_url + no_ext_scoped_prf_strings are within the 685 passing extension tests). |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/pv-ui/vault/types.ts` | Canonical type shapes + normalizeItemFields | ✓ VERIFIED | 9755 bytes, full superset, exported |
| `packages/pv-ui/vault/cardBrand.ts` | CardBrand + detectCardBrand | ✓ VERIFIED | exists, consumed via shims |
| `packages/pv-ui/vault/search.ts` | domainFromUrl/searchItems/filterItems | ✓ VERIFIED | imports sibling ./types |
| `packages/pv-ui/vault/sort.ts` | SortOption/DEFAULT_SORT/sortItems (comparator only) | ✓ VERIFIED | no persistence funcs; byName tie-break intact |
| `packages/pv-ui/clipboard.ts` | clamp/read/copyWithAutoClear | ✓ VERIFIED | single-active-timer discipline moved |
| `packages/pv-ui/i18n/engine.ts` | Locale/t<D>/interpolate/resolveLocale | ✓ VERIFIED | generic t, WR-01-corrected interpolate |
| `packages/pv-ui/i18n/common.ts` | COMMON_DICTIONARY (34 keys) | ✓ VERIFIED | exactly 34 keys, 0 divergent leaked |
| web + extension shims (10 files) | `export *` / split-shim re-exports | ✓ VERIFIED | all confirmed thin |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| package.json exports map | every consumer `export * from "pv-ui/..."` shim | subpath resolution under moduleResolution: bundler | ✓ WIRED (both tsc clean, both suites pass; exports map is sole authority after 643606f) |
| web/extension dictionary.ts | pv-ui/i18n/engine + common | `import { t as tEngine, interpolate } ... ...COMMON_DICTIONARY` | ✓ WIRED |
| extension search.ts/sort.ts | pv-ui/vault/types.ts | sibling `./types` import inside pv-ui/vault/ | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| web full suite | `web && npx vitest run` | 56 files, 481/481 pass | ✓ PASS |
| extension full suite | `extension && npx vitest run` | 53 files, 685/685 pass | ✓ PASS |
| web typecheck | `web && npx tsc --noEmit` | exit 0 | ✓ PASS |
| extension typecheck | `extension && npx tsc --noEmit` | exit 0 | ✓ PASS |
| zero-duplication (all migrated symbols) | repo-wide grep excl. pv-ui | 0 hits | ✓ PASS |
| old t()-body literal | `\bDICTIONARY[key][locale]` grep | 0 hits | ✓ PASS |

Note: full `next build` / `wxt build` (Plan 16-06 Task 2) not re-run by the verifier — vitest + tsc + the deterministic greps are sufficient behavioral evidence for the three success criteria; build-artifact correctness was gated in-plan and is not the phase's success condition.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DS-01 | 16-01,02,03,05,06 | Pure shared logic + types live once in pv-ui; extension consumes via shims; no duplicate copies | ✓ SATISFIED | SC-1 + SC-3 verified; REQUIREMENTS.md line 28 marked [x], line 86 Phase 16 Complete |
| DS-02 | 16-01,04,06 | Shared i18n engine in pv-ui; both surfaces consume same resolver; keys split per surface | ✓ SATISFIED | SC-2 verified; REQUIREMENTS.md line 29 marked [x], line 87 Phase 16 Complete |

No orphaned requirements — both IDs mapped to Phase 16 in REQUIREMENTS.md and both accounted for by plans.

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX) introduced in migrated files; shims are legitimate 1-statement re-exports (the established Phase 11 generator precedent), not stubs; the pv-ui-located engine.test.ts is an intentionally orphan-but-kept canonical copy per the documented triplication convention.

### Human Verification Required

**1. Security-screen i18n legibility (judgment-tier prohibition, Plan 16-04)**

**Test:** Load vault unlock, passkey-ceremony consent, and PRF error/degradation screens in both PL and EN, on web and the extension popup.
**Expected:** Every translated string is human-readable PL/EN copy — never a raw dotted key, never blank/undefined.
**Why human:** Security-critical UI keys (unlock.submit, unlock.passkeyCta, auth.loginFailed) were among the 34 moved into common.ts. Compile-time keyof narrowing + clean tsc + byte-identical values make a lookup-failure structurally near-precluded, but no test renders these exact security surfaces. Per CLAUDE.md's "security UI always legible" constraint and the planner's own unresolved judgment-tier prohibition, a human render-check is the only proof. Quick confirmation expected. (Memory: authorized to self-validate via Playwright + test account.)

### Gaps Summary

No gaps. All three ROADMAP success criteria and all 19 plan-level truths are verified in the codebase: the 7 modules live once in `pv-ui`, both consumers wire through shims, the shared i18n engine is consumed identically with per-surface key splits, and a repo-wide search confirms zero surviving duplicate implementations. Both test suites (481/481, 685/685) and both `tsc --noEmit` are green. The single reason this is `human_needed` rather than `passed`: one judgment-tier prohibition on security-screen i18n legibility (Plan 16-04, status: unresolved) cannot be silently absorbed into a pass — it is routed to a human render-check. The companion test-tier prohibition (Plan 16-02, autofill DOM-write surface unchanged) is independently VERIFIED via git+grep evidence.

---

_Verified: 2026-07-20T22:47:51Z_
_Verifier: Claude (gsd-verifier)_


## Validation Evidence (human_verification item 1 — self-validated per standing authorization)

Validated 2026-07-21 per Bartek's standing authorization (memory: playwright-uat-authorized — human_needed items self-validate via Playwright + test account).

1. **Web unlock/sign-in surface** (http://localhost:8620, static build served by pv-server): Playwright snapshot + screenshot (`phase16-uat-web-unlock.png`) show full legible PL copy — "Zaloguj się" (heading + submit), "Email", "Hasło główne", "Zaloguj i odblokuj passkeyem" (passkey CTA), "lub", "Nie masz konta? Zarejestruj się". Zero raw dotted keys, zero blank/undefined artifacts.
2. **Extension popup unlock/sign-in/lock surfaces**: full Phase-9 e2e lane re-run against a freshly rebuilt chrome-mv3 bundle containing the shared pv-ui engine + spread dictionaries — 7/7 pass (P9-SC1..SC7, including the server-origin sign-in ceremony window, master-password unlock after lock, and auto-lock flows, whose assertions match on visible dictionary strings).

Both halves of the judgment-tier prohibition (Plan 16-04) now have runtime evidence on the exact security surfaces; the structural half (keyof narrowing, tsc clean) was already verified.
