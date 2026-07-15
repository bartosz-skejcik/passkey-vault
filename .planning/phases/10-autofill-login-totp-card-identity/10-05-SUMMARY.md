---
phase: 10-autofill-login-totp-card-identity
plan: 05
subsystem: extension-autofill
tags: [webextension, typescript, vitest, wxt, content-script, dom, autofill]

requires:
  - phase: 10-autofill-login-totp-card-identity
    provides: "10-01's extension/lib/autofill/types.ts (FillKind/DetectedFields/FillValues + ContentDetectRequest/Response/ContentFillRequest/Response), 10-02's detect-login.ts/detect-totp.ts, 10-03's detect-scored.ts (detectCard/detectIdentity + CardSlots/IdentitySlots), and 10-04's extension/entrypoints/background/autofill-match.ts (the background caller this plan's listener answers, via browser.tabs.sendMessage(tabId, msg, {frameId}))"
provides:
  - "extension/lib/autofill/fill-dom.ts: setNativeValue() (prototype-setter bypass + bubbling input/change events) and fillValues() (dispatches on FillValues.type, split-expiry MM/YY parsing with width-matched year, never throws on a vanished/missing target) -- the shared DOM writer all four fill kinds use"
  - "extension/entrypoints/content-relay.content.ts: the ISOLATED-world, all-frames content script -- content.detect (fresh boolean-only detection, never a field value) and content.fill (re-resolves live targets at fill time, writes via fillValues()) -- the phase's only page-touching code, crypto-free, UI-free"
affects: [10-06, 10-07]

tech-stack:
  added: []
  patterns:
    - "Native prototype-setter bypass: setNativeValue() resolves Object.getOwnPropertyDescriptor(HTMLInputElement.prototype | HTMLTextAreaElement.prototype, 'value').set and calls it directly, then dispatches bubbling input+change events -- survives a React-style instance-level setter override (10-RESEARCH.md Pitfall 5)"
    - "Fresh-resolve-per-message in the content-relay: content.detect and content.fill each re-run the relevant detector against the live document independently -- content.fill never reuses a target element from an earlier content.detect (SPA re-render defense, mirrors 10-04's own fresh-resolve-per-call TOCTOU pattern for the background side)"
    - "FillTargets is a flat discriminated union shaped like FillValues (same 'type' discriminant, element refs instead of strings) -- fillValues() matches on both values.type and targets.type together so a kind mismatch is structurally a no-op, never a runtime type-check bypass"

key-files:
  created:
    - extension/lib/autofill/fill-dom.ts
    - extension/lib/autofill/fill-dom.test.ts
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
  modified: []

key-decisions:
  - "content-relay's test file could NOT live at the plan's literal path (extension/entrypoints/content-relay.test.ts) -- WXT's entrypoint auto-discovery (find-entrypoints.mjs) derives an entrypoint's name from the string before the first '.'/'/' in its path and matches ANY top-level entrypoints/*.ts file against a catch-all *.[jt]s?(x) 'unlisted-script' glob. A file named content-relay.test.ts sitting next to content-relay.content.ts collides on the name 'content-relay' and npx wxt build fails hard with 'Multiple entrypoints with the same name detected' before any code runs. Relocated to extension/entrypoints/__tests__/content-relay.test.ts -- one directory level down, the glob's single '*' no longer crosses the path separator, so the file is invisible to entrypoint discovery (the same mechanism that already lets entrypoints/background/*.ts's many non-entrypoint modules coexist with the top-level entrypoints/background.ts entrypoint). vitest's default recursive test glob still discovers and runs it unchanged."
  - "FillTargets (fill-dom.ts) is a flat discriminated union -- { type: 'login' } & LoginTargets, etc. -- deliberately mirroring FillValues' own flat shape (same 'type' key, element refs instead of strings) rather than a nested { type, targets: {...} } wrapper, so the content-relay's per-kind detector output (detectLogin()/detectTotp()/detectCard()/detectIdentity()'s CardSlots/IdentitySlots) maps onto it with a single spread, and fillValues()'s own values.type/targets.type double-check makes a kind mismatch a structural no-op rather than a runtime assertion."
  - "CardTargets/IdentityTargets are Pick<> types over detect-scored.ts's own CardSlots/IdentitySlots (minus hasAny) rather than a parallel hand-written shape -- one source of truth for the field names, consistent with field-tokens.ts's own 'slot names match web/src/lib/vault/types.ts exactly' rule."
  - "Split-expiry year width is resolved from the target element's maxLength (2 -> short '26', anything else including unset -> long '2026') rather than a hardcoded assumption -- the plan's 'to match each sub-field's expected width' requirement, and 04/26 raw text intentionally never reaches a split sub-field (Test 4 asserts the raw string is NOT written verbatim to either sub-field)."
  - "vi.mock('wxt/browser', ...) direct-mock convention (matching autofill-match.test.ts's established precedent, not the plan's fakeBrowser-from-wxt/testing suggestion) -- wxt/testing's fakeBrowser remains unused anywhere in this codebase; the direct mock gives per-test control over the captured runtime.onMessage listener with no new test-only dependency."

requirements-completed: []

coverage:
  - id: D1
    description: "fill-dom.ts's setNativeValue() writes through the native prototype value setter (bypassing a React-style instance-level override) and dispatches bubbling input+change events; fillValues() dispatches per FillValues.type across all four kinds, parses MM/YY|MM/YYYY into a width-matched split month+year pair, and never throws on a missing/vanished target"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/fill-dom.test.ts (6 tests: native-setter bubbling events, React-instance-setter bypass via a redefined prototype descriptor, login write incl. missing-username-target, card incl. split-expiry parsing/width-matching, vanished-field no-throw, identity with skipped slots)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "content-relay.content.ts registers a single ISOLATED-world, all-frames runtime.onMessage listener answering content.detect (boolean-only, never a field value) and content.fill (re-resolves live targets, writes via fillValues, reports { ok } including the graceful no-match failure) -- no MutationObserver, no crypto import, no in-page UI"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts (5 tests: detect-returns-booleans-only with no leaked field value, no-write-without-message across load/focus/mutation events, fill-on-message with live re-resolved targets, unknown-message-kind ignored without throwing, fill-failed-no-match reports { ok: false })"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit && npx wxt build -b chrome"
        status: pass
    human_judgment: false
  - id: D3
    description: "Packaged Chrome manifest's content_scripts entry matches the plan exactly: matches [\"<all_urls>\"], all_frames true, run_at document_idle, world ISOLATED, no MAIN-world registration"
    requirement: "FILL-01"
    verification:
      - kind: other
        ref: "npx wxt build -b chrome then inspecting .output/chrome-mv3/manifest.json's content_scripts array directly (not assumed) -- single entry: {matches:[\"<all_urls>\"], all_frames:true, run_at:\"document_idle\", js:[\"content-scripts/content-relay.js\"], world:\"ISOLATED\"}"
        status: pass
    human_judgment: true
    rationale: "The full in-browser adversarial proof that a real cross-origin subframe never receives a fill, and that a real React/Vue app on a live page actually registers the fill (jsdom cannot reproduce a real reconciler), remain Plan 10-07's UAT job -- this deliverable is the packaged-manifest and unit-level foundation that UAT exercises, not the final proof."

duration: 20min
completed: 2026-07-15
status: complete
---

# Phase 10 Plan 05: Content-Relay -- ISOLATED-World Sensor/Writer Summary

**The phase's only page-touching code: `content-relay.content.ts` (ISOLATED-world, all-frames content script answering `content.detect`/`content.fill`) and `fill-dom.ts` (the shared native-prototype-setter writer that survives React/Vue-controlled inputs, with split-expiry MM/YY parsing) -- crypto-free, UI-free, writes only on an explicit background message.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-15T19:44:00Z
- **Tasks:** 2 (both TDD: RED then GREEN each, plus one Rule 3 blocking-issue fix)
- **Files modified:** 4 (all created)

## Accomplishments

- `extension/lib/autofill/fill-dom.ts` created: `setNativeValue()` resolves the value setter from `HTMLInputElement.prototype`/`HTMLTextAreaElement.prototype` via `Object.getOwnPropertyDescriptor` and calls it directly (bypassing any React-style instance-level override), then dispatches bubbling `input`+`change` events. `fillValues()` dispatches on `FillValues.type` across login/totp/card/identity, parses `MM/YY`|`MM/YYYY`|`MM / YY` into a split month+year pair matched to each sub-field's `maxLength`, and never throws on a missing or SPA-vanished target -- returns `{ ok: filledCount > 0, filledCount }`.
- `extension/entrypoints/content-relay.content.ts` created: a WXT `defineContentScript` entry (`matches: ["<all_urls>"]`, `allFrames: true`, `runAt: "document_idle"`, `world: "ISOLATED"` stated explicitly per D-01) registering one `runtime.onMessage` listener. `content.detect` runs all four detectors fresh against `document` and returns booleans only (`DetectedFields` + `hasOtpField`), never a field value. `content.fill` re-runs the relevant detector to resolve LIVE target elements (never reuses a stale `content.detect` result) and writes via `fillValues()`. No MutationObserver, no crypto import, no in-page UI -- verified by grep and by the packaged Chrome build.
- Real-browser-shaped verification: `npx wxt build -b chrome` succeeded and the packaged `manifest.json`'s `content_scripts` entry was inspected directly (not assumed) -- exact match to the plan's spec.

## Task Commits

Each task was committed atomically:

1. **Task 1: fill-dom.ts (TDD)** -- `9b92cb1` (test, RED) -> `d34b772` (feat, GREEN)
2. **Task 2: content-relay.content.ts (TDD)** -- `a4edca2` (test, RED) -> `a2a9e6e` (feat, GREEN)
3. **Rule 3 fix: relocate content-relay's test out of entrypoints/ root (WXT entrypoint-name collision)** -- `2a79464` (fix) -> `aa36513` (docs, follow-up landing the intended edit content -- see Issues Encountered)

**Plan metadata:** (this commit)

_Note: Both tasks were TDD (test -> feat), matching the plan's `tdd="true"` marking on each._

## Files Created/Modified

- `extension/lib/autofill/fill-dom.ts` -- `setNativeValue()`, `fillValues()`, `FillTargets`/`LoginTargets`/`TotpTargets`/`CardTargets`/`IdentityTargets` types (new)
- `extension/lib/autofill/fill-dom.test.ts` -- 6 tests (new)
- `extension/entrypoints/content-relay.content.ts` -- the ISOLATED-world sensor/writer (new)
- `extension/entrypoints/__tests__/content-relay.test.ts` -- 5 tests (new; relocated from the plan's literal `extension/entrypoints/content-relay.test.ts` path -- see Deviations)

## Decisions Made

See frontmatter `key-decisions` for the full record. Summary:

- **Test file relocated to `entrypoints/__tests__/`** -- the plan's literal path collided with WXT's entrypoint auto-discovery and broke `npx wxt build` outright (Rule 3, see Deviations).
- **`FillTargets` is a flat discriminated union** mirroring `FillValues`' own shape, not a nested wrapper -- lets the content-relay spread a detector's result straight into it.
- **`CardTargets`/`IdentityTargets` are `Pick<>`s over `detect-scored.ts`'s own `CardSlots`/`IdentitySlots`** -- one source of truth for field names.
- **Split-expiry year width resolved from the target's `maxLength`** (2 -> short form, else long form) rather than assumed.
- **Test mocking follows `autofill-match.test.ts`'s `vi.mock("wxt/browser", ...)` convention**, not the plan's `fakeBrowser` suggestion -- consistent with the rest of this codebase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Relocated `content-relay.test.ts` out of `entrypoints/` root to dodge a WXT entrypoint-name collision**
- **Found during:** Task 2, running `npx wxt build -b chrome` per this plan's own verification block
- **Issue:** WXT's `find-entrypoints.mjs` derives an entrypoint's NAME from the string before the first `.`/`/` in its path relative to `entrypointsDir`, and matches any top-level `entrypoints/*.ts` file against a catch-all `*.[jt]s?(x)` glob (type `unlisted-script`) when no more specific pattern applies. `extension/entrypoints/content-relay.test.ts` (the plan's literal `files_modified` path) and `extension/entrypoints/content-relay.content.ts` both resolve to the entrypoint name `content-relay` -- `npx wxt build` failed hard with `Multiple entrypoints with the same name detected` before any code ran, contradicting this same plan's own verification requirement (`npx wxt build` must succeed).
- **Fix:** Moved the test file to `extension/entrypoints/__tests__/content-relay.test.ts`. One directory level down, the glob's single `*` does not cross a path separator, so the file is invisible to entrypoint discovery entirely -- the same mechanism that already lets `entrypoints/background/*.ts`'s many non-entrypoint modules coexist with the top-level `entrypoints/background.ts` entrypoint. Updated the two relative imports (`../content-relay.content`, `../../lib/autofill/types`) and documented the rationale inline in the file's own header comment.
- **Files modified:** `extension/entrypoints/__tests__/content-relay.test.ts` (moved from `extension/entrypoints/content-relay.test.ts`)
- **Verification:** `npx vitest run` (209/209, full suite); `npx tsc --noEmit` exits 0; `npx wxt build -b chrome` succeeds; packaged `manifest.json`'s `content_scripts` entry inspected directly and matches the plan's spec exactly.
- **Committed in:** `2a79464` (fix), landed fully in `aa36513` (docs follow-up -- see Issues Encountered for why two commits were needed)

---

**Total deviations:** 1 auto-fixed (Rule 3/blocking -- necessary because the plan's literal test-file path is structurally incompatible with WXT's own entrypoint auto-discovery, discovered only by actually running the plan's own `npx wxt build` verification step). No scope creep: only the test file's location and its two relative imports changed; no production code was touched to work around this.

## Issues Encountered

- **Git staging anomaly during the Rule 3 fix.** After `git mv`-ing the test file and editing its header comment + relative imports (both edits confirmed applied on disk -- `npx vitest run`/`npx tsc --noEmit`/`npx wxt build` all passed against the edited content before staging), the first `git add` + `git commit` for that fix (`2a79464`) unexpectedly captured the PRE-edit content (old header, old `./content-relay.content` import that would not have resolved from the new location). Root cause not conclusively identified within this plan's scope -- possibly a filesystem-sync artifact of the sandboxed bash environment's cwd-reset-per-call behavior. Caught immediately via `git show HEAD:<path>` vs. on-disk `diff`, corrected with a second, clean commit (`aa36513`) that lands the intended content and was verified byte-identical to disk (`diff <(git show HEAD:...) <path>` => `MATCH`) before proceeding. Flagging here as a process anomaly worth watching for in future worktree-mode plans, not a code defect.
- Pre-existing, unrelated unhandled rejection in `entrypoints/popup/App.test.tsx` (`ServerConfigView.tsx:95:32`) persists across this plan's changes -- already documented in `.planning/phases/10-autofill-login-totp-card-identity/deferred-items.md` by 10-01 as confirmed-present-on-clean-`HEAD`, out of scope for this plan's `files_modified`.
- Fresh worktree lacked `node_modules` and the gitignored WASM build artifacts (`extension/lib/crypto/wasm/`, `extension/public/wasm/`) -- ran `npm install`, copied the artifacts from the main checkout, and re-ran `npx wxt prepare`, matching the orchestrator's `resolved_facts` and 10-04's own precedent. Standard environment bootstrap, not a plan deviation.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- `extension/entrypoints/content-relay.content.ts` is ready to answer Plan 10-04's background handlers (`handleAutofillMatch`'s `content.detect` call, `handleAutofillFill`'s `content.fill` call, both via `browser.tabs.sendMessage(tabId, msg, {frameId})`) -- the two ends of this channel now both exist and their payload shapes were verified against the real 10-01 contract, not the plan's simplified sketch.
- `extension/lib/autofill/fill-dom.ts`'s `fillValues()`/`FillTargets` are the shared writer Plan 10-06's popup UI does not call directly (it only triggers `autofill.match`/`autofill.fill`/`autofill.totpCode` messages) -- no further wiring needed on this file for 10-06.
- End-to-end autofill still does not have a UI trigger: Plan 10-06 (popup UI driving `autofill.match`/`autofill.fill`/`autofill.totpCode`) is the last piece before FILL-01..04 are user-facing. `requirements-completed` is left empty here, matching 10-01's and 10-04's own precedent.
- The full in-browser adversarial proof of a real React/Vue-controlled input actually accepting the write, and of a real cross-origin subframe never receiving a fill, remain Plan 10-07's UAT job, as this plan's own `coverage` D3 rationale records.
- No blockers.

---
*Phase: 10-autofill-login-totp-card-identity*
*Completed: 2026-07-15*

## Self-Check: PASSED

All claimed files (extension/lib/autofill/fill-dom.ts, extension/lib/autofill/fill-dom.test.ts,
extension/entrypoints/content-relay.content.ts, extension/entrypoints/__tests__/content-relay.test.ts,
this SUMMARY) confirmed present on disk. All 6 commit hashes (9b92cb1, d34b772, a4edca2, a2a9e6e,
2a79464, aa36513) confirmed present in git log.
