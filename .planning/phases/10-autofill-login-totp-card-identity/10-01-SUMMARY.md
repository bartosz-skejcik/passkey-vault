---
phase: 10-autofill-login-totp-card-identity
plan: 01
subsystem: extension-messaging
tags: [webextension, typescript, vitest, wxt, origin-matching, access-control, message-contract]

requires:
  - phase: 09-session-unlock-core-popup-sync-client
    provides: "extension/lib/messaging/ext-protocol.ts's Message union + MessageResponseMap + sendMessage() (Plan 09-02), extension/entrypoints/background/router.ts's registerMessageRouter()/handle() dispatch table + WR-01 sender gate (Plan 09-02), extension/lib/vault/types.ts's VaultItem/ItemFields shapes mirroring web/src/lib/vault/types.ts (Plan 09-05)"
provides:
  - "extension/lib/autofill/types.ts: FillKind/DetectedFields/AutofillMatch/FillTarget/FillValues shared across popup, background, content-relay, plus the background<->content-relay ContentDetectRequest/Response and ContentFillRequest/Response payloads"
  - "extension/lib/messaging/ext-protocol.ts extended additively with autofill.match/autofill.fill/autofill.totpCode kinds + AutofillMatchResult, JSON-round-trip-safe (ext-protocol.test.ts fixtures added)"
  - "extension/entrypoints/background/frame-guard.ts: assertPopupSender()/originFromContentSender()/resolveFillTarget()/itemMatchesOrigin() -- the pure, unit-tested origin/frame access-control gate for Phase 10's fill flow"
  - "extension/entrypoints/background/router.ts threads the platform-provided MessageSender through handle() and enforces the popup-only privilege tier for session.*/vault.* kinds via assertPopupSender()"
affects: [10-02, 10-03, 10-04, 10-05, 10-06, 10-07]

tech-stack:
  added: []
  patterns:
    - "Popup-driven autofill transport: popup -(runtime.sendMessage: autofill.*)-> background -(tabs.sendMessage {frameId})-> content-relay -- NOT content-driven; content-relay never proactively messages background this phase"
    - "Origin/frame access-control gate kept pure (no browser.tabs.* calls inside predicates) so it is unit-testable without a browser fake; the caller performs the one browser.tabs.get() and injects the result"
    - "Per-file jsdom opt-in via '// @vitest-environment jsdom' docblock, verified to override the 'background' project's node default even under vitest's projects-based workspace config (v3.2.7)"

key-files:
  created:
    - extension/lib/autofill/types.ts
    - extension/entrypoints/background/frame-guard.ts
    - extension/entrypoints/background/frame-guard.test.ts
  modified:
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/vitest.config.ts

key-decisions:
  - "Background entrypoint layout resolved: extension/entrypoints/background/ already exists as a directory of modules (router.ts, vault-session.ts, etc.) alongside the flat background.ts entrypoint file -- frame-guard.ts placed directly in that directory, router.ts edited in place, per the orchestrator's resolved_facts (no background/index.ts created)"
  - "vitest.config.ts required NO structural change -- it already uses vitest v3's 'projects' mechanism (not the plan's assumed environmentMatchGlobs/docblock choice); verified with a throwaway smoke test that per-file '// @vitest-environment jsdom' docblocks still override the 'background' project's node default, satisfying what 10-02/10-03/10-05 will rely on"
  - "itemMatchesOrigin() compares full URL#origin equality (scheme+hostname+port) rather than literally importing web/src/lib/vault/search.ts's domainFromUrl() (hostname-only, not exported, and permissively falls back to the raw string on parse failure) -- extends its try/catch parsing shape but fails CLOSED on an unparseable stored URL, since an access-control gate must never treat 'couldn't parse' as a match"
  - "totp items always return false from itemMatchesOrigin() -- the real VaultItem/TotpFields shape (web/src/lib/vault/types.ts) carries no stored URL at all to compare against; TOTP codes are surfaced via the separate autofill.totpCode message keyed by itemId, not this origin gate"
  - "Left requirements-completed empty in this SUMMARY's frontmatter, matching Phase 9's EXT-04/EXT-05 precedent (STATE.md) -- this plan only builds the contract/gate layer for FILL-01..04, not user-facing fill functionality; marking those requirement IDs complete now would be premature"

requirements-completed: []

coverage:
  - id: D1
    description: "Message contract extended with autofill.match/autofill.fill/autofill.totpCode + AutofillMatchResult, additive to Phase 9's Message union, and shared autofill/content-relay types (FillKind, DetectedFields, AutofillMatch, FillTarget, FillValues, content.detect/content.fill payloads) defined with v0.1's exact field names"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/lib/messaging/ext-protocol.test.ts (34 tests, incl. 3 new JSON-round-trip fixtures for autofill.match/autofill.fill/autofill.totpCode)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "frame-guard.ts's origin/frame access-control gate (assertPopupSender, originFromContentSender, resolveFillTarget, itemMatchesOrigin) as pure, adversarially-tested predicates, including the cross-origin-subframe refusal (D-04's core rule) and the card/identity-any-origin vs login/totp-strictly-bound asymmetry"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/frame-guard.test.ts (12 assertions across the plan's 7 required behaviors, TDD RED->GREEN: 7446cfd then 8ce2eef)"
        status: pass
    human_judgment: true
    rationale: "The predicate logic is fully unit-proven at this plan's scope, but the plan's own threat_model explicitly defers the full in-browser adversarial property (a real cross-origin iframe never receiving a fill, T-10-03/T-10-04 dual-browser confirmation) to Plan 10-07's UAT -- this deliverable is the foundation that UAT will exercise, not the final proof."
  - id: D3
    description: "router.ts threads the platform-provided MessageSender through handle() and independently enforces the popup-only privilege tier (assertPopupSender) for session.*/vault.* kinds, defense-in-depth alongside the pre-existing WR-01 addListener-level origin gate"
    requirement: "FILL-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts (11 tests, incl. 3 new 'handle() privilege-tier guard (T-10-01)' cases added post-hoc as a Rule 2 coverage-gap fix, commit 42efc33)"
        status: pass
      - kind: other
        ref: "cd extension && npx vitest run (full suite, 164/164 across 17 files)"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-07-15
status: complete
---

# Phase 10 Plan 01: Autofill Contract & Origin/Frame Access-Control Gate Summary

**Extended Phase 9's `ext-protocol.ts`/`router.ts` additively with the `autofill.*` message contract and a pure, TDD-built origin/frame access-control gate (`frame-guard.ts`) that is the sole arbiter of which frame may receive which vault item.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-15T19:13:00Z
- **Tasks:** 3 (Task 2 was TDD: RED then GREEN, no REFACTOR needed)
- **Files modified:** 9 (3 created, 6 modified, including 2 files outside the plan's stated `files_modified` — see Deviations)

## Accomplishments

- `extension/lib/autofill/types.ts` created: `FillKind`, `DetectedFields`, `AutofillMatch`, `FillTarget`, `FillValues` (login/totp/card/identity, TOTP carrying only the derived `code`), plus the background↔content-relay `ContentDetectRequest/Response` and `ContentFillRequest/Response` payloads — one shared module across all three Phase 10 contexts.
- `extension/lib/messaging/ext-protocol.ts` extended additively (Phase 9's `session.*`/`unlock.*`/`vault.*`/`extPasskey.*`/`config.*` kinds untouched) with `autofill.match` (no origin field — background resolves the tab itself), `autofill.fill` (value-free response — plaintext never crosses the popup), and `autofill.totpCode` (the one sanctioned path for a derived-from-secret value to reach the popup, for the clipboard-copy action).
- `extension/entrypoints/background/frame-guard.ts` built via strict TDD (7 behaviors, RED then GREEN): `assertPopupSender()`, `originFromContentSender()`, `resolveFillTarget()` (always returns an explicit `frameId`, allow-lists http/https only), `itemMatchesOrigin()` (exact origin equality, fails closed, the explicit cross-origin-subframe adversarial test asserted).
- `extension/entrypoints/background/router.ts` now threads `sender` all the way into `handle()` and independently refuses any `session.*`/`vault.*` kind from a sender with `.tab` defined — defense in depth alongside the pre-existing WR-01 addListener-level gate.
- `extension/vitest.config.ts` verified (not restructured) to already support jsdom-on-demand for the DOM plans that follow.

## Task Commits

1. **Task 1: Extend the message contract and add the shared autofill types** — `e381ccb` (feat)
2. **Task 2: frame-guard.ts (TDD)** — `7446cfd` (test, RED) → `8ce2eef` (feat, GREEN)
3. **Task 3: Thread MessageSender through the router** — `c463a8c` (feat)
4. **Post-hoc coverage-gap fix (Rule 2)** — `42efc33` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/lib/autofill/types.ts` — shared autofill/content-relay shapes (new)
- `extension/lib/messaging/ext-protocol.ts` — additive `autofill.*` kinds + `AutofillMatchResult`
- `extension/lib/messaging/ext-protocol.test.ts` — 3 new JSON-round-trip fixtures (not in `files_modified` — see Deviations)
- `extension/entrypoints/background/frame-guard.ts` — origin/frame access-control gate (new)
- `extension/entrypoints/background/frame-guard.test.ts` — 7 TDD behaviors, 12 assertions (new)
- `extension/entrypoints/background/router.ts` — `sender` threaded, `assertPopupSender()` guard, `noteActivity` decision comment, `// Plan 10-04 adds:` marker
- `extension/entrypoints/background/router.test.ts` — 3 new privilege-tier guard tests (not in `files_modified` — see Deviations)
- `extension/vitest.config.ts` — documenting comment only (already jsdom-ready)
- `.planning/phases/10-autofill-login-totp-card-identity/deferred-items.md` — pre-existing unrelated test issue logged (new)

## Real Phase 9 shapes found (vs. the plan's `<interfaces>` block)

The plan's `<interfaces>` block was written pre-Phase-9-execution and is a simplified sketch. The real files at execution time:

- **`ext-protocol.ts`**: `Message` already has 14 kinds (`session.status`, `session.setAutoLockMinutes`, `unlock.password`, `auth.signIn.password`, `vault.list`, `vault.updated`, `session.locked`, `extPasskey.enroll.start/finish`, `extPasskey.suppressPrompt`, `unlock.extPrf.start/finish`, `config.get`, `config.set`) — far beyond the sketch's 2. It already has a JSON-round-trip structural test (`ext-protocol.test.ts`) enforcing exhaustiveness via a mapped type keyed on `Message["kind"]` — **adding a new kind without a matching fixture fails `tsc`, not just tests**. This plan added fixtures for the 3 new kinds to keep that gate intact.
- **`router.ts`**: `handle(message)` already existed with a WR-01 sender-based origin gate at the `addListener` level (rejecting any `sender.url` that doesn't start with the extension's own origin) — the plan's sketch showed a bare `_sender` discard with no such gate. This plan added the second, independent `assertPopupSender()` check inside `handle()` itself, on top of the pre-existing WR-01 gate.
- **Background layout**: `extension/entrypoints/background/` already exists as a directory of 9+ modules (confirmed via the orchestrator's `resolved_facts`, not re-derived) — `frame-guard.ts` was placed directly there; no `background/index.ts` was created.

## Decisions Made

- **`itemMatchesOrigin()` does not literally call `web/src/lib/vault/search.ts`'s `domainFromUrl()`** (it is module-private/unexported there, hostname-only, and permissively falls back to the raw string on a parse failure — correct for a search feature, wrong for an access-control gate). Instead `frame-guard.ts` extends the same `new URL(...)` try/catch parsing *shape* to compare full `URL#origin` equality (scheme+hostname+port, satisfying the plan's explicit "compare hostname AND scheme" requirement) and fails CLOSED on an unparseable stored URL. Documented inline as a deliberate divergence, not a second matching algorithm.
- **totp items always return `false`** from `itemMatchesOrigin()` — the real `TotpFields` shape (`web/src/lib/vault/types.ts`, mirrored in `extension/lib/vault/types.ts`) has no stored URL field at all, so there is nothing to compare. This matches the plan's stated policy ("login and totp items are strictly origin-bound") by omission rather than by an explicit URL check; TOTP codes reach the popup via the separate `autofill.totpCode` message keyed by `itemId`, never through this origin gate.
- **`requirements-completed` left empty** in this SUMMARY's frontmatter. This plan builds only the contract/gate layer shared by all four fill kinds (FILL-01..04); no user-facing fill behavior exists yet. Matches Phase 9's established precedent (STATE.md: "EXT-04 left unmarked... full completion is [a later] plan's job").
- **Resolved a literal contradiction in Task 3's own instructions**: the action text explicitly requires a comment containing `// Plan 10-04 adds: case "autofill.match": ...`, while the acceptance-criteria bullet list says router.ts "does NOT yet contain 'autofill.match'". Followed the more specific `<action>` instruction (added the comment) since it does not add a real switch case or `isProtocolMessage()` entry — the contract stays functionally type-clean, only a forward-reference comment exists.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added JSON-round-trip fixtures for the 3 new message kinds in `ext-protocol.test.ts`**
- **Found during:** Task 1
- **Issue:** `ext-protocol.test.ts`'s `MESSAGE_FIXTURES`/`RESPONSE_FIXTURES` are typed as mapped-object types keyed by `Message["kind"]` — TypeScript requires every key present. Adding `autofill.match`/`autofill.fill`/`autofill.totpCode` to the `Message` union without adding fixtures fails `tsc` (not just the test file's own assertions).
- **Fix:** Added one request-side and one response-side fixture per new kind, following the file's existing convention.
- **Files modified:** `extension/lib/messaging/ext-protocol.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; `npx vitest run lib/messaging/ext-protocol.test.ts` — 34/34 passing.
- **Committed in:** `e381ccb` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added a router-level integration test for the T-10-01 privilege-tier guard**
- **Found during:** post-Task-3 review, before writing this SUMMARY
- **Issue:** T-10-01 is a "high" severity threat-register mitigation. `frame-guard.test.ts` proves `assertPopupSender()` correct in isolation, but nothing exercised `router.ts`'s `handle()` actually invoking it — the pre-existing WR-01 addListener-level gate already blocks any real content-script sender before `handle()` runs, so the new guard was untested-but-currently-unreachable, not untested-and-broken, but still a coverage gap for a documented "defense in depth... do not remove" mitigation.
- **Fix:** Added 3 cases to `router.test.ts` directly exercising `handle()` with a sender shaped to have `.tab` defined (bypassing the outer gate the way a future loosened WR-01 check legitimately might for `autofill.*` traffic): `session.status` and `vault.list` both refused with `{ok:false, error:"forbidden-sender"}`, plus a control case confirming the ordinary popup sender still dispatches.
- **Files modified:** `extension/entrypoints/background/router.test.ts`
- **Verification:** `npx vitest run` — full suite 164/164 (17 files) passing.
- **Committed in:** `42efc33`

---

**Total deviations:** 2 auto-fixed (1 blocking/Rule 3, 1 missing-critical-coverage/Rule 2). Both necessary for correctness (tsc would not compile without #1) and for proving the plan's own stated threat mitigation actually fires (#2). No scope creep beyond that.

## Issues Encountered

- **Pre-existing, unrelated unhandled rejection** in `entrypoints/popup/App.test.tsx` (`TypeError: Cannot read properties of undefined (reading 'request')` at `entrypoints/popup/ServerConfigView.tsx:95:32`). Confirmed present on a clean pre-Phase-10 `HEAD` (`2d15ad3`) via `git stash` + re-run — not caused by any change in this plan. Out of scope (`ServerConfigView.tsx`/`App.test.tsx` are Phase 9 files not in this plan's `files_modified`). Logged in `.planning/phases/10-autofill-login-totp-card-identity/deferred-items.md` for a future cleanup pass.
- The plan's Task 1 instructions assumed `vitest.config.ts` might need `environmentMatchGlobs` or a docblock-only setup; the real file already uses vitest v3's `projects` mechanism. Verified (via a throwaway smoke test, not committed) that per-file `// @vitest-environment jsdom` docblocks still override the `"background"` project's `node` default even under `projects` — no structural change was needed, only a documenting comment.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `extension/lib/autofill/types.ts` and the extended `ext-protocol.ts` are the shared contract Plans 10-02 through 10-06 build against.
- `frame-guard.ts`'s `resolveFillTarget()`/`itemMatchesOrigin()` are ready for Plan 10-04 (the background handler for `autofill.match`/`autofill.fill`/`autofill.totpCode`) to call directly — they take injected `browser.tabs.get()` output, so 10-04 only needs to perform that one call and pass the result in.
- `router.ts` has the `// Plan 10-04 adds:` marker at the exact insertion point for the three new switch cases.
- No blockers. The full in-browser adversarial proof of the cross-origin-subframe refusal (SC #5) remains Plan 10-07's job, as designed.

---
*Phase: 10-autofill-login-totp-card-identity*
*Completed: 2026-07-15*
