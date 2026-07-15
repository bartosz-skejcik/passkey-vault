---
phase: 10-autofill-login-totp-card-identity
plan: 03
subsystem: autofill-detection
tags: [webextension, typescript, vitest, jsdom, dom-heuristics, autocomplete, card-detection, identity-detection]

requires:
  - phase: 10-autofill-login-totp-card-identity
    provides: "extension/lib/autofill/types.ts's FillKind/DetectedFields shapes and the exact v0.1 card/identity field names (Plan 10-01)"
provides:
  - "extension/lib/autofill/field-tokens.ts: CARD_AUTOCOMPLETE_TOKENS / IDENTITY_AUTOCOMPLETE_TOKENS weight tables, FILL_THRESHOLD=6, KEYWORD_FALLBACK (English + Polish vocabulary, cappedFallbackScore()), normalizeToken() — the single home for every magic number the scorer uses"
  - "extension/lib/autofill/detect-scored.ts: detectCard(root)/detectIdentity(root) — autocomplete-first, threshold-gated slot resolution to HTMLInputElement, including split cc-exp-month/cc-exp-year pairing"
  - "extension/lib/autofill/__fixtures__/README.md + 4 curated fixture HTML files documenting provenance/sanitization rules"
affects: [10-05, 10-06, 10-07]

tech-stack:
  added: []
  patterns:
    - "Two-tier scoring: autocomplete token match short-circuits the keyword-fallback tier entirely (tier 2 never consulted once tier 1 matches) — this is what makes 'autocomplete-first' structural rather than code-ordering convention"
    - "Fallback tier structurally capped at floor(weight * 0.5) so it can clear FILL_THRESHOLD on its own (real coverage) but never outscore an exact autocomplete match for the same slot"
    - "Exact score ties fail CLOSED to null rather than first-wins — ambiguous evidence is never silently resolved"
    - "Self-contained detection module (no import from a sibling detect-*.ts) because Plan 10-02 runs in a parallel worktree and its files are not present at this plan's execution time"

key-files:
  created:
    - extension/lib/autofill/field-tokens.ts
    - extension/lib/autofill/detect-scored.ts
    - extension/lib/autofill/detect-scored.card.test.ts
    - extension/lib/autofill/detect-scored.identity.test.ts
    - extension/lib/autofill/__fixtures__/README.md
    - extension/lib/autofill/__fixtures__/card-checkout.html
    - extension/lib/autofill/__fixtures__/card-fallback.html
    - extension/lib/autofill/__fixtures__/identity-form-en.html
    - extension/lib/autofill/__fixtures__/identity-form-pl.html
  modified: []

key-decisions:
  - "FILL_THRESHOLD kept at the plan's illustrative starting value of 6 (10-RESEARCH.md A4 flags weights/threshold as untuned) — no real-world corpus of checkout/identity forms was available at this plan's execution time to tune against beyond the 4 curated fixtures this plan itself authored, so the threshold is left where the plan set it rather than moved on synthetic evidence alone. Tuning against a larger real-form corpus is deferred to whichever later plan (10-07 UAT is the natural point) has access to live forms to validate against."
  - "Added a new 'cardinfo' fallback keyword (weight 11 -> capped 5) specifically so the exact-threshold boundary test (Test 2) pins the FILL_THRESHOLD=6 cutoff against a real production weight-table entry rather than a synthetic-only number invented purely for the test. Documented inline in field-tokens.ts as a deliberate, lower-confidence keyword (a field merely mentioning 'card info' in generic terms is weaker evidence than an explicit cardholder-name phrase)."
  - "detect-login.ts (Plan 10-02) was not available in this worktree at execution time (parallel wave, disjoint files) — wrote a self-contained isFillableInput() predicate in detect-scored.ts instead of importing a shared one, per the orchestrator's resolved_facts. A future integration pass (post-merge) may want to de-duplicate the two predicates if they converge on identical logic, but that is out of this plan's scope."
  - "expiryMode: 'single' | 'split' models cc-exp-month/cc-exp-year as a genuinely separate representation from a single cc-exp field, rather than trying to force both into one CardSlots.expiry — the filler (a later plan) needs to know which shape it received to write MM/YYYY correctly."
  - "Copied the gitignored WASM build artifacts (extension/lib/crypto/wasm/, extension/public/wasm/) from the main worktree into this parallel worktree, and re-ran `npx wxt prepare`, purely to get a clean `tsc --noEmit` baseline before touching any autofill files — these are unmodified, deterministic build outputs of Rust source this plan never touches, not a change to tracked code."

requirements-completed: [FILL-03, FILL-04]

coverage:
  - id: D1
    description: "field-tokens.ts: CARD_AUTOCOMPLETE_TOKENS/IDENTITY_AUTOCOMPLETE_TOKENS weight tables, FILL_THRESHOLD gate, English+Polish KEYWORD_FALLBACK vocabulary capped at floor(weight*0.5), normalizeToken() — single home for every magic number the scorer uses"
    requirement: "FILL-03"
    verification:
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
      - kind: unit
        ref: "extension/lib/autofill/detect-scored.card.test.ts + detect-scored.identity.test.ts (12/12, exercise field-tokens.ts's tables through detectCard/detectIdentity)"
        status: pass
    human_judgment: false
  - id: D2
    description: "detectCard(root): autocomplete-first, threshold-gated resolution of cardholderName/number/expiry/cvv to HTMLInputElement, including cc-exp-month/cc-exp-year split-pair reporting, hidden/disabled exclusion, and fail-closed tie resolution"
    requirement: "FILL-03"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/detect-scored.card.test.ts (8/8: well-marked resolve, exact-threshold boundary, tie fail-closed, quantity-input false positive, empty/no-evidence, fallback-tier coverage, hidden/disabled exclusion, split expiry pair)"
        status: pass
    human_judgment: false
  - id: D3
    description: "detectIdentity(root): autocomplete-first, threshold-gated resolution of firstName/lastName/email/phone/address to HTMLInputElement, including Polish-language fallback vocabulary and markup-only (value-untouched) resolution"
    requirement: "FILL-04"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/detect-scored.identity.test.ts (4/4: well-marked resolve, Polish fallback vocabulary, deterministic tie-refusal, unicode value untouched)"
        status: pass
    human_judgment: false
  - id: D4
    description: "T-10-11 mitigation: a hidden (type=hidden, [hidden] attribute, or inline display:none/visibility:hidden ancestor) or disabled input is never returned as a fill target regardless of how well its markup scores"
    requirement: "FILL-03"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/detect-scored.card.test.ts#Test 7"
        status: pass
    human_judgment: true
    rationale: "The frontmatter's own prohibition marks this 'verification: flagged / status: unverified' at plan-authoring time (no wired end-to-end check, no human available at plan time). This plan's unit test proves the DOM predicate correct in isolation; the real-page adversarial property (a genuinely offscreen/CSS-hidden field on a live site never becoming a fill target end-to-end) is deferred to Plan 10-07's UAT, consistent with how Plan 10-01 deferred its own frame-guard adversarial proof to the same UAT plan."

duration: ~15min
completed: 2026-07-15
status: complete
---

# Phase 10 Plan 03: Scored Card & Identity Detector Summary

**Autocomplete-first, threshold-gated (FILL_THRESHOLD=6) DOM scorer resolving credit-card and identity form fields to elements — two-tier scoring where an exact `autocomplete` token structurally outranks the English/Polish keyword-fallback tier, with tie-refusal and hidden-field exclusion pinned by tests.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-15T21:26:03+02:00
- **Tasks:** 2 (Task 2 was TDD: RED then GREEN, no REFACTOR needed — all 12 tests passed on first implementation attempt)
- **Files modified:** 9 (all created; 0 modified outside this plan's own new files)

## Accomplishments

- `extension/lib/autofill/field-tokens.ts`: `CARD_AUTOCOMPLETE_TOKENS`/`IDENTITY_AUTOCOMPLETE_TOKENS` map every standardized `autocomplete` token this plan cares about to a v0.1 slot name (`cardholderName`/`number`/`expiry`/`cvv`, `firstName`/`lastName`/`email`/`phone`/`address`) with an illustrative weight; `FILL_THRESHOLD = 6` is the gate; `KEYWORD_FALLBACK` carries English + Polish vocabulary (`cardnumber`/`numerkarty`, `cvv`/`kodcvv`, `nazwisko`/`telefon`, etc.), each entry capped via `cappedFallbackScore()` at `floor(weight * 0.5)` so the fallback tier can earn real coverage but never structurally outrank an exact autocomplete match.
- `extension/lib/autofill/detect-scored.ts`: `detectCard(root)`/`detectIdentity(root)` walk every `<input>` under the given `Document | Element`, filter to fillable (non-hidden, non-disabled, text-ish) inputs, score each via the autocomplete-first/keyword-fallback two-tier algorithm, drop anything below `FILL_THRESHOLD`, and resolve each slot to the highest-scoring candidate — with an exact tie failing closed to `null`. `cc-exp-month`/`cc-exp-year` are detected as a genuine split pair (`expiryMode: "split"`) distinct from a single `cc-exp` field.
- 12 behaviors pinned across `detect-scored.card.test.ts` (8) and `detect-scored.identity.test.ts` (4): well-marked-form resolution, the exact-threshold boundary (6 fills, 5 does not), tie fail-closed, the canonical quantity-input false positive, empty/no-evidence handling, fallback-tier coverage, hidden/disabled exclusion, the split-expiry pair, a well-marked identity form, the Polish fallback vocabulary, deterministic tie behavior across repeated calls, and markup-only resolution (a unicode value is left completely untouched).
- `extension/lib/autofill/__fixtures__/README.md` + 4 curated fixtures (`card-checkout.html`, `card-fallback.html`, `identity-form-en.html`, `identity-form-pl.html`) document the curated-fixture provenance/sanitization rule (10-VALIDATION.md's Wave 0 gap) and give the boundary/tie/empty synthetic cases real-form-shaped company.

## Task Commits

1. **Task 1: field-tokens.ts — weight tables, threshold, fallback vocabulary** — `664f2b7` (feat)
2. **Task 2: detect-scored.ts (TDD)** — `86156e0` (test, RED) → `94d6e5f` (feat, GREEN)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/lib/autofill/field-tokens.ts` — weight tables, `FILL_THRESHOLD`, `KEYWORD_FALLBACK`, `normalizeToken()`, `cappedFallbackScore()` (new)
- `extension/lib/autofill/detect-scored.ts` — `detectCard()`, `detectIdentity()`, `CardSlots`, `IdentitySlots`, `isFillableInput()` (new)
- `extension/lib/autofill/detect-scored.card.test.ts` — 8 card behaviors (new)
- `extension/lib/autofill/detect-scored.identity.test.ts` — 4 identity behaviors (new)
- `extension/lib/autofill/__fixtures__/README.md` — curated-fixture provenance/sanitization rules (new)
- `extension/lib/autofill/__fixtures__/card-checkout.html`, `card-fallback.html`, `identity-form-en.html`, `identity-form-pl.html` — curated, sanitized fixtures (new)

## Decisions Made

- **FILL_THRESHOLD stays at the plan's illustrative 6.** 10-RESEARCH.md A4 explicitly flags the starting weights/threshold as untuned and hands tuning discretion to whoever executes this plan against real forms. This plan's own curated fixtures (4 forms, modeled on but not copied from real checkout/shipping flows) all clear or fail the threshold exactly as designed, but that is not the same as tuning against a large real-world corpus — no such corpus was available at execution time. Left at 6 rather than moved on weak evidence; the tuning rule (raising costs coverage, lowering costs trust — prefer a missed fill) is documented inline in `field-tokens.ts` for whoever tunes it next against live traffic (naturally Plan 10-07's UAT).
- **Added a new `cardinfo` fallback keyword (weight 11 → capped 5)** specifically so the exact-threshold boundary test pins `FILL_THRESHOLD=6` against a real weight-table entry, not an ad hoc test-only number. A field merely mentioning "card info" in generic terms is legitimately weaker evidence than an explicit cardholder-name phrase — this is a genuine (if illustrative) tuning choice, documented inline.
- **`detect-login.ts` (Plan 10-02) was not importable** — it runs in a parallel worktree and is not present in this one at execution time (confirmed via `ls`, matching the orchestrator's `resolved_facts`). `detect-scored.ts` therefore carries its own `isFillableInput()` predicate rather than importing a shared one. A post-merge pass may want to de-duplicate if the two predicates converge on identical logic once both worktrees land, but that's out of this plan's scope.
- **Copied gitignored WASM build artifacts from the main worktree** (`extension/lib/crypto/wasm/`, `extension/public/wasm/`) and re-ran `npx wxt prepare` before touching any autofill file, purely to establish a clean `tsc --noEmit` baseline — this parallel worktree's fresh checkout lacked these generated (never-committed) build outputs that the main worktree already had from a prior `scripts/build-wasm.sh` run. No tracked file was changed by this step; confirmed via `git status --short` showing the copied files as ignored, not untracked.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fresh worktree checkout lacked generated WASM build artifacts, breaking `tsc --noEmit`**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `lib/crypto/wasm-loader.ts` failed to resolve `./wasm/pv_wasm.js` and WXT's generated `PublicPath` type didn't include `/wasm/pv_wasm_bg.wasm` — both because this worktree is a fresh checkout of a directory `.gitignore`'d for exactly this reason (build artifact of `scripts/build-wasm.sh`, which this plan has no reason to run). Confirmed pre-existing/environmental by running `npx tsc --noEmit` in the main worktree (clean, exit 0) and diffing the affected file against the main worktree (byte-identical) — not a bug introduced by this plan's files.
- **Fix:** Copied the already-built, unmodified artifacts (`extension/lib/crypto/wasm/*.js`/`*.d.ts`, `extension/public/wasm/*.wasm`) from the main worktree into this one, then re-ran `npx wxt prepare` to regenerate the `PublicPath` type now that the static asset exists.
- **Files modified:** none tracked (gitignored build outputs only)
- **Verification:** `npx tsc --noEmit` exits 0 after the copy; confirmed the copied files remain untracked/ignored via `git status --short`.
- **Committed in:** N/A (nothing to commit — gitignored)

---

**Total deviations:** 1 auto-fixed (1 blocking/Rule 3, environmental — not a code change).
**Impact on plan:** No scope creep; no tracked file was touched by the fix. All of this plan's actual deliverables (field-tokens.ts, detect-scored.ts, tests, fixtures) are unaffected in substance.

## Issues Encountered

None beyond the WASM-artifact environmental gap documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `extension/lib/autofill/field-tokens.ts` and `detect-scored.ts` are ready for Plan 10-05 (content-relay) to call `detectCard(document)`/`detectIdentity(document)` directly and fold the results into the `content.detect` response's `DetectedFields`.
- `CardSlots`/`IdentitySlots`' element-only shape (no values read or written) matches the zero-knowledge boundary Plan 10-05's `fill-dom.ts` will need — it is the one file allowed to write into these resolved elements.
- The `expiryMode: "single" | "split"` distinction is ready for whichever plan builds the actual fill-value writer to consume directly.
- `FILL_THRESHOLD`/weight tuning against a larger real-form corpus remains open — flagged for Plan 10-07's UAT, which is the first point in the phase with access to live forms.
- No blockers for 10-04/10-05/10-06.

---
*Phase: 10-autofill-login-totp-card-identity*
*Completed: 2026-07-15*

## Self-Check: PASSED

All 9 claimed files (field-tokens.ts, detect-scored.ts, detect-scored.card.test.ts,
detect-scored.identity.test.ts, __fixtures__/README.md, and the 4 curated fixture HTML
files) confirmed present on disk. All 3 commit hashes (664f2b7, 86156e0, 94d6e5f)
confirmed present in `git log --oneline --all`.
