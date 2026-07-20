---
phase: 15-login-unlock-unification-vaultwarden-model
plan: 05
subsystem: auth
tags: [webauthn, extension, sendMessage, vitest, i18n, ux]

# Dependency graph
requires:
  - phase: 15-login-unlock-unification-vaultwarden-model (plan 02)
    provides: "signOutVaultSession() (vault-session.ts) + the 3 config.changeServer* dictionary.ts keys this plan consumes but never writes"
provides:
  - "config.probe message kind (ext-protocol.ts, router.ts's handleConfigProbe) -- a persist-free sibling of config.set, reusing server-config.ts's probeServerHealthDetailed()"
  - "session.signOut message kind (ext-protocol.ts, router.ts) -- delegates to signOutVaultSession(), falls under the existing WR-01 'session.' prefix gate automatically"
  - "ServerConfigView.tsx's server-change confirmation dialog + needsConfirm() + migration sequencing (grant new -> sign out old -> persist new -> revoke old)"
affects: [15-07-checkpoint-live-two-server-verification, auth-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Persist-free probe sibling of an existing probe-and-persist message kind (config.probe vs config.set) -- lets a UI sequence 'validate first, mutate later' across a sendMessage boundary without adding server-side state."
    - "Per-kind sendMessage mock routing in tests (mockMessagesByKind helper) instead of a single blanket mockResolvedValue -- required once a component dispatches multiple DIFFERENTLY-shaped message kinds from one handler."

key-files:
  created: []
  modified:
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/router.test.ts
    - extension/entrypoints/popup/ServerConfigView.tsx
    - extension/entrypoints/popup/ServerConfigView.test.tsx
    - extension/entrypoints/popup/App.test.tsx

key-decisions:
  - "handleConfigProbe mirrors handleConfigSet's exact error-mapping shape (invalid-url/cors-blocked/unreachable) but calls probeServerHealthDetailed() directly instead of configureServer() -- guarantees zero browser.storage.local.set() calls on the probe path, proven by a dedicated test."
  - "needsConfirm()'s session-status check runs BEFORE the permissions.contains() check and short-circuits on the OR -- so a locked/unlocked session for the old server never even calls browser.permissions.contains(), which mattered because App.test.tsx's wxt/browser mock has no permissions object at all."
  - "Both browser.permissions.request() call sites (the pre-existing first-run one and the new confirm-flow one) are now guarded via typeof browser.permissions?.request !== 'function' checks -- fixes the pre-existing unhandled rejection this handler left in vitest/jsdom (App.test.tsx never mocks browser.permissions) instead of leaving it as a known-flagged wart."

patterns-established:
  - "Confirm-dialog-gated state mutation: probe/validate the target state fully BEFORE presenting the confirmation UI, so a user is never asked to confirm a switch that would fail anyway (mirrors this same discipline already used for config.set's own pre-persist probe)."

requirements-completed: [AUTH-04]

coverage:
  - id: D1
    description: "Reconfiguring the server URL while a session exists for the OLD server shows the confirm dialog, with the OLD hostname interpolated, BEFORE any config.set dispatch"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#AUTH-04 server-change confirmation dialog > a NEW url with an existing session for the OLD one shows the confirm dialog with the OLD hostname interpolated, BEFORE any config.set call"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration sequencing on confirm never strands the user: permissions.request(new origin) -> session.signOut -> config.set, in that exact order"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#AUTH-04 server-change confirmation dialog > confirming: permissions.request(new origin) is called BEFORE sendMessage(session.signOut), which is called BEFORE sendMessage(config.set)"
        status: pass
    human_judgment: false
  - id: D3
    description: "First-run config, or a resubmit of the SAME URL, or a NEW url with no session/permission for the old one, never shows the confirm dialog -- byte-identical direct-persist path"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#nothing-to-lose path > first-run (config.get -> null): persists immediately via config.set, confirm dialog never shown, dispatches config.set BEFORE requesting the permission grant"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#nothing-to-lose path > resubmitting the SAME url as already configured never shows the confirm dialog, even with an existing session for it"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#nothing-to-lose path > a NEW url when no session/permission exists for the OLD one falls through to the direct persist path, confirm dialog never shown"
        status: pass
    human_judgment: false
  - id: D4
    description: "A config.set failure after sign-out (migration fails partway) keeps the dialog open with migrationError shown, both buttons re-enabled, and never calls onConfigured() -- UI-SPEC's backstop requirement"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#AUTH-04 server-change confirmation dialog > a config.set failure after signOut leaves migrationError shown, the dialog open, both buttons re-enabled, and onConfigured() NOT called"
        status: pass
    human_judgment: false
  - id: D5
    description: "A successful full migration calls onConfigured() and fires permissions.remove(old origin) best-effort"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ServerConfigView.test.tsx#AUTH-04 server-change confirmation dialog > a successful full sequence calls onConfigured() and fires permissions.remove(old origin) best-effort"
        status: pass
    human_judgment: false
  - id: D6
    description: "config.probe validates reachability without persisting anything (zero browser.storage.local.set() calls), and maps probeServerHealthDetailed's ok/cors-blocked/unreachable outcomes plus a caught InvalidServerUrlError to the same error union config.set uses"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts#config.probe / session.signOut (Plan 15-05, AUTH-04) > handleConfigProbe: probeServerHealthDetailed resolving 'ok' returns {ok:true} and never persists anything"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts#config.probe / session.signOut (Plan 15-05, AUTH-04) > handleConfigProbe: probeServerHealthDetailed resolving 'cors-blocked' returns {ok:false, error:'cors-blocked'}"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts#config.probe / session.signOut (Plan 15-05, AUTH-04) > handleConfigProbe: an invalid URL (normalizeServerUrl throws InvalidServerUrlError) returns {ok:false, error:'invalid-url'} without ever probing"
        status: pass
    human_judgment: false
  - id: D7
    description: "session.signOut is popup-gated by the existing WR-01 assertPopupSender check (rejected for a content-script-shaped sender) and calls signOutVaultSession() exactly once for a genuine popup sender"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts#config.probe / session.signOut (Plan 15-05, AUTH-04) > session.signOut from a non-popup (content-script-shaped) sender is rejected by the existing assertPopupSender gate, exactly like session.status"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/router.test.ts#config.probe / session.signOut (Plan 15-05, AUTH-04) > session.signOut from a popup sender calls signOutVaultSession() exactly once and returns {ok:true}"
        status: pass
    human_judgment: false
  - id: D8
    description: "Live two-server end-to-end proof (a genuinely running second pv-server, real browser.permissions grant/revoke) -- this plan's own <verification> explicitly defers this to Plan 15-07's checkpoint; the coverage above proves call ORDER and error-handling correctness via mocks only"
    verification: []
    human_judgment: true
    rationale: "Requires two live pv-server instances and a real browser extension context (host-permission prompts cannot be simulated in vitest/jsdom) -- explicitly out of this plan's scope per its own <verification> section."

duration: ~12min
completed: 2026-07-20
status: complete
---

# Phase 15 Plan 05: AUTH-04 Server-Change Confirmation Dialog Summary

**`ServerConfigView.tsx` now gates a server-URL switch behind an explicit warning-tier confirm dialog whenever a session or host permission exists for the OLD server, sequencing grant-new -> sign-out-old -> persist-new -> revoke-old so the user can never end up stranded with zero working origins.**

## Performance

- **Duration:** ~12 min (includes one-time `npm install` + WASM rebuild + `wxt prepare` in this fresh worktree)
- **Started:** 2026-07-20T18:22:59Z
- **Completed:** 2026-07-20T18:34:13Z
- **Tasks:** 2
- **Files modified:** 7 (2 new message kinds' plumbing, 1 rewritten UI component, 4 test files)

## Accomplishments

- `config.probe` message kind (`ext-protocol.ts`, `router.ts`'s `handleConfigProbe`) -- persist-free reachability check reusing `server-config.ts`'s already-exported `probeServerHealthDetailed()`, proven to never call `browser.storage.local.set()`
- `session.signOut` message kind, delegating to Plan 15-02's `signOutVaultSession()`, automatically covered by the existing WR-01 `"session."`-prefix `assertPopupSender()` gate with zero changes to that gate's own code
- `ServerConfigView.tsx`'s AUTH-04 confirm dialog: `needsConfirm()` implements CONTEXT.md's explicit session-OR-permission disjunction; migration sequencing (grant new origin -> sign out old session -> persist new config -> best-effort revoke old origin) proven in call order via mocked `invocationCallOrder` assertions
- Backstop path proven: a `config.set` failure mid-migration keeps the dialog open with `config.changeServerMigrationFailed` copy and both buttons re-enabled, never calling `onConfigured()`
- Fixed the pre-existing unhandled rejection (`browser.permissions.request()` being `undefined` in vitest/jsdom) by guarding both permission call sites -- full `npx vitest run` now exits 0 with zero unhandled errors
- 25 net-new passing tests (7 router.test.ts, 4 ext-protocol.test.ts fixture round-trips, 13 ServerConfigView.test.tsx, plus App.test.tsx's existing reconfigure test updated in place); full suite 713/713 green

## Task Commits

Each task was committed atomically:

1. **Task 1: config.probe + session.signOut message kinds** - `941eb6e` (feat)
2. **Task 2: ServerConfigView.tsx confirm dialog + migration sequencing** - `e2a4fc9` (feat)

_Both tasks were `tdd="true"`; tests and implementation were authored together per task rather than as separate RED/GREEN commits, matching this plan's own `<action>`/`<behavior>` structure._

## Files Created/Modified

- `extension/lib/messaging/ext-protocol.ts` - added `config.probe`/`session.signOut` to the `Message` union and `MessageResponseMap`
- `extension/lib/messaging/ext-protocol.test.ts` - added the two new kinds' JSON-transport-safety fixtures (required by the file's own type-level exhaustiveness gate)
- `extension/entrypoints/background/router.ts` - `handleConfigProbe()`, `signOutVaultSession` import, two new `isProtocolMessage()`/`handle()` cases
- `extension/entrypoints/background/router.test.ts` - 7 new behavior cases for `config.probe`/`session.signOut`
- `extension/entrypoints/popup/ServerConfigView.tsx` - `needsConfirm()`, confirm-dialog state/markup, restructured `handleSubmit` (probe-first, conditional confirm), guarded both `permissions.request()` call sites, added `permissions.remove()`
- `extension/entrypoints/popup/ServerConfigView.test.tsx` - rewritten to per-kind `sendMessage` mocking; 13 tests covering the nothing-to-lose direct-persist path and the AUTH-04 confirm-dialog path
- `extension/entrypoints/popup/App.test.tsx` - updated the EXT-05 reconfigure integration test's `primeLockedWithConfig` helper (added `config.probe`/`session.signOut` mocks) and its "successful change" test to click through the now-required AUTH-04 confirm dialog (its LOCKED-session-for-the-old-server scenario is exactly the AUTH-04 trigger condition)

## Decisions Made

- `needsConfirm()`'s session-status check short-circuits BEFORE the `permissions.contains()` check on the OR -- not just a minor ordering choice: it means a locked/unlocked session for the old server never touches `browser.permissions.contains()` at all, which is what let `App.test.tsx`'s existing `wxt/browser` mock (no `permissions` object whatsoever) keep working unmodified for that check.
- `config.set`'s `rawUrl` field carries the raw (unnormalized) user input on the direct-persist path (unchanged from before this plan) but carries the NORMALIZED `pendingNewUrl` on the confirm-flow path, per the plan's own explicit `<action>` text -- a deliberate asymmetry between the two paths, not an oversight.
- Both `browser.permissions.request()` call sites now share a `bestEffortPermissionsRequest()` helper (guarded + `.catch(() => false)`); `permissions.contains()`/`permissions.remove()` got matching guards even though the plan's action text only explicitly named the two `.request()` sites, applying the same defensive discipline consistently (Rule 2 -- missing guard would have been a live crash risk against any browser/test environment that doesn't fully implement the permissions API).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated `App.test.tsx`'s EXT-05 reconfigure test to route through the new AUTH-04 confirm dialog**
- **Found during:** Task 2 full-suite verification (`npx vitest run`)
- **Issue:** `App.test.tsx`'s "a successful change dispatches config.set... and leaves the config view" test primes a LOCKED session for the OLD server (`old.example.com`) and submits a DIFFERENT URL (`new.example.com`) -- this is exactly the AUTH-04 trigger condition (session exists for the server being replaced). Under the plan's own new, correct behavior, this now (rightly) shows the confirm dialog instead of persisting directly; the test's old assertions (`config.set` called immediately on submit) no longer matched reality. The test's mock (`primeLockedWithConfig`) also didn't yet handle the two new `config.probe`/`session.signOut` message kinds, which the new `handleSubmit` dispatches unconditionally.
- **Fix:** Added `config.probe`/`session.signOut` branches to `primeLockedWithConfig`'s per-kind dispatch, and updated the test to find and click the confirm dialog's "Switch server" button before asserting `config.set` fired -- preserving the test's original intent (a successful reconfigure eventually persists and returns to the unlock view) while accommodating the new, correct confirm-gate step.
- **Files modified:** `extension/entrypoints/popup/App.test.tsx`
- **Verification:** `npx vitest run` -- full suite 713/713 passing, zero unhandled errors.
- **Committed in:** `e2a4fc9` (Task 2 commit)

**2. [Rule 3 - Blocking] Added `config.probe`/`session.signOut` fixtures to `ext-protocol.test.ts`'s exhaustive JSON-transport fixture maps**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `ext-protocol.test.ts`'s `MESSAGE_FIXTURES`/`RESPONSE_FIXTURES` are typed as mapped-object types keyed by `Message["kind"]` (the file's own documented "structural gate against regression" design) -- adding a new `kind` to the `Message` union without a matching fixture entry fails `tsc`, by design, not just the test file's own runtime assertions.
- **Fix:** Added one request-side and one response-side fixture each for `config.probe` and `session.signOut`, matching the file's existing per-kind fixture conventions.
- **Files modified:** `extension/lib/messaging/ext-protocol.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0; the file's own JSON-round-trip tests pass for both new kinds.
- **Committed in:** `941eb6e` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug in stale test assumptions, 1 blocking structural-gate fixture requirement). Both were mechanically necessary consequences of this plan's own new message kinds/UI behavior, not scope creep -- neither file is in this plan's `files_modified` frontmatter list, but both were required to keep `npx tsc --noEmit` and `npx vitest run` green, which this plan's own `<verification>` section requires ("full suite green").
**Impact on plan:** Zero scope creep beyond what was structurally required to keep the existing test suite passing under the new, correct AUTH-04 behavior.

## Issues Encountered

- This worktree had neither `extension/node_modules/` nor the gitignored WASM build output present (a fresh worktree, flagged in the plan's own `<environment_notes>`). `npm install` + `bash scripts/build-wasm.sh` + `npx wxt prepare` handled this before any task work began -- a one-time, environment-only step with no effect on future runs in this worktree.
- The original `ServerConfigView.test.tsx` used a single blanket `mockSendMessage.mockResolvedValue({ok:true})` for every message kind, which would have silently broken under the new multi-kind `handleSubmit` (e.g. `config.get` resolving `{ok:true}` instead of `null`/`{baseUrl}` would have made `needsConfirm()` misfire). Rewrote the test file's mocking strategy to per-kind dispatch (`mockMessagesByKind` helper, mirroring `App.test.tsx`'s own established `primeLockedWithConfig` per-kind convention) rather than patching around the blanket mock -- this was flagged in the plan's own `<read_first>` as an expected restructuring, not a surprise.

## Next Phase Readiness

- `config.probe`/`session.signOut` and the confirm-dialog sequencing are ready for Plan 15-07's checkpoint, which the plan's own `<verification>` explicitly defers the live two-server end-to-end proof to (a genuinely running second `pv-server`, real `browser.permissions` grant/revoke prompts -- neither simulable in vitest/jsdom).
- No dictionary.ts changes made this plan (all 3 `config.changeServer*` keys were consumed, not written, per Plan 15-02's wave-1 handoff) -- confirmed via the rendered dialog text in `ServerConfigView.test.tsx`'s assertions.

---
*Phase: 15-login-unlock-unification-vaultwarden-model*
*Completed: 2026-07-20*
