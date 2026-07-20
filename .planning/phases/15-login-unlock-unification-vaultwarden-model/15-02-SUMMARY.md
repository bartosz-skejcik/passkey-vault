---
phase: 15-login-unlock-unification-vaultwarden-model
plan: 02
subsystem: auth
tags: [webauthn, session-management, chrome-storage-session, vitest, i18n]

# Dependency graph
requires:
  - phase: 09-session-unlock-popup-sync
    provides: session-storage.ts's two-record (SessionMeta/KeyEnvelope) storage.session split and the lockVaultSession()/Blocker-2 discipline this plan mirrors for its first full-meta-delete path
provides:
  - "clearSessionMeta() — session-storage.ts's first-ever full-meta-delete code path, distinct from clearKeyEnvelope()"
  - "logout() — auth-api.ts, first client call to the pre-existing SessionUser-gated POST /api/auth/logout server route"
  - "signOutVaultSession() — vault-session.ts, composes lockVaultSession() -> best-effort logout() -> unconditional clearSessionMeta()"
  - "3 dictionary.ts keys (config.changeServerConfirmBody, config.changeServerConfirm, config.changeServerMigrationFailed) for Plan 15-05's server-change confirm dialog"
affects: [15-05-server-config-signout-sequencing, auth-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Best-effort remote call wrapped in try/catch swallow, followed by an UNCONDITIONAL local teardown step — mirrors lockVaultSession()'s existing .catch(() => {}) broadcast shape, applied here to auth-api.ts's logout() so a stale/invalid token can never block clearSessionMeta()"

key-files:
  created:
    - extension/entrypoints/background/session-storage.test.ts
    - extension/entrypoints/background/auth-api.test.ts
  modified:
    - extension/entrypoints/background/session-storage.ts
    - extension/entrypoints/background/auth-api.ts
    - extension/entrypoints/background/vault-session.ts
    - extension/entrypoints/background/vault-session.test.ts
    - extension/lib/i18n/dictionary.ts

key-decisions:
  - "signOutVaultSession() takes no arguments and performs no server-URL mutation — it purely tears down the CURRENTLY-configured session. The caller (Plan 15-05) is responsible for invoking it strictly BEFORE any configureServer(newUrl) call, since auth-api.ts's apiFetch reads readServerConfig() fresh on every call."
  - "Ordering is fixed and unconditional: lockVaultSession() (key envelope + cache/WS teardown via the existing subscribeSessionLockState listener) THEN best-effort logout() THEN unconditional clearSessionMeta() — a rejected server-side logout can never block or skip the local teardown."

patterns-established:
  - "Full-meta-delete vs. partial-update distinction in session-storage.ts is now proven by a dedicated regression test (clearKeyEnvelope leaves session-meta untouched) alongside the new clearSessionMeta() full-delete path."

requirements-completed: [AUTH-04]

coverage:
  - id: D1
    description: "clearSessionMeta() removes ONLY the session-meta record; a subsequent readSessionMeta() returns null"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/session-storage.test.ts#clearSessionMeta > removes the session-meta record so a subsequent readSessionMeta() returns null"
        status: pass
    human_judgment: false
  - id: D2
    description: "clearKeyEnvelope() does NOT remove the session-meta record (auto-lock vs. full sign-out must clear DIFFERENT things)"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/session-storage.test.ts#clearKeyEnvelope > leaves the session-meta record untouched"
        status: pass
    human_judgment: false
  - id: D3
    description: "logout() POSTs to /api/auth/logout with a Bearer Authorization header and resolves undefined on 204"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/auth-api.test.ts#logout > POSTs to /api/auth/logout with an Authorization: Bearer header when a token exists, and resolves undefined on 204"
        status: pass
    human_judgment: false
  - id: D4
    description: "logout() rejects with ApiClientError on a non-2xx response"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/auth-api.test.ts#logout > throws ApiClientError on a non-2xx response"
        status: pass
    human_judgment: false
  - id: D5
    description: "signOutVaultSession() calls lockVaultSession()'s effects first (key envelope cleared, in-memory handle freed, session.locked broadcast) before touching session-meta"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#signOutVaultSession > calls lockVaultSession()'s own effects first"
        status: pass
    human_judgment: false
  - id: D6
    description: "signOutVaultSession() calls logout() exactly once, and completes without throwing (clearSessionMeta still runs) when logout() rejects"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#signOutVaultSession > calls the mocked logout() export exactly once"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#signOutVaultSession > completes without throwing even when the mocked logout() call rejects"
        status: pass
    human_judgment: false
  - id: D7
    description: "A subsequent readSessionMeta() after signOutVaultSession() returns null — full teardown proof"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#signOutVaultSession > a subsequent readSessionMeta() after signOutVaultSession() returns null"
        status: pass
    human_judgment: false
  - id: D8
    description: "3 dictionary.ts keys (config.changeServerConfirmBody, config.changeServerConfirm, config.changeServerMigrationFailed) exist with pl+en values matching 15-UI-SPEC.md verbatim"
    requirement: "AUTH-04"
    verification:
      - kind: unit
        ref: "grep -cE '\"config\\.changeServerConfirmBody\"|\"config\\.changeServerConfirm\"|\"config\\.changeServerMigrationFailed\"' extension/lib/i18n/dictionary.ts -> 3"
        status: pass
    human_judgment: false

duration: ~13min
completed: 2026-07-20
status: complete
---

# Phase 15 Plan 02: AUTH-04 Teardown Primitives Summary

**`signOutVaultSession()` (extension) composes lockVaultSession() + best-effort server-side `POST /api/auth/logout` + unconditional `clearSessionMeta()`, closing the gap where a client-perceived sign-out left a valid bearer token live indefinitely.**

## Performance

- **Duration:** ~13 min (includes a one-time `npm install` and WASM rebuild in this fresh worktree — see Issues Encountered)
- **Tasks:** 2
- **Files modified:** 5 (2 new test files, 3 modified source files)

## Accomplishments

- `clearSessionMeta()` in `session-storage.ts` — the file's first-ever full-meta-delete code path, mirroring `clearKeyEnvelope()`'s shape exactly
- `logout()` in `auth-api.ts` — the first client code path to ever call the pre-existing, previously-unused `POST /api/auth/logout` server route
- `signOutVaultSession()` in `vault-session.ts` — a self-contained, argument-free full sign-out primitive, safely composable by Plan 15-05's server-URL-change sequencing as long as it runs strictly before `configureServer(newUrl)`
- 3 new `dictionary.ts` keys pre-landed for Plan 15-05's server-change confirmation dialog, closing a same-wave nondeterminism hazard flagged in the plan's revision note
- 9 net-new passing tests (3 session-storage, 2 auth-api, 4 vault-session); full suite 683/683 green with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: clearSessionMeta() + logout() + AUTH-04 dictionary keys** - `f1c292f` (feat)
2. **Task 2: signOutVaultSession()** - `31c3da5` (feat)

_Both tasks were `tdd="true"`; tests and implementation were authored together per task rather than as separate RED/GREEN commits, matching this plan's own `<action>`/`<behavior>` structure (a single test file + implementation per task, not a strict red-green-refactor gate sequence)._

## Files Created/Modified

- `extension/entrypoints/background/session-storage.ts` - added `clearSessionMeta()`
- `extension/entrypoints/background/session-storage.test.ts` (new) - round-trip, full-clear, and partial-clear regression coverage
- `extension/entrypoints/background/auth-api.ts` - added `logout()`
- `extension/entrypoints/background/auth-api.test.ts` (new) - wire-format and error-mapping coverage for `logout()`
- `extension/entrypoints/background/vault-session.ts` - added `signOutVaultSession()`
- `extension/entrypoints/background/vault-session.test.ts` - 4 new behavior cases for `signOutVaultSession()`
- `extension/lib/i18n/dictionary.ts` - 3 new `config.*` keys (not consumed by this plan)

## Decisions Made

- `signOutVaultSession()` deliberately takes no arguments and performs no server-URL mutation — this keeps it a pure, composable teardown primitive. The plan's own design already assigns the grant-new/sign-out-old/persist-new/revoke-old sequencing to Plan 15-05; this plan documents the ordering constraint (must run before `configureServer(newUrl)`) inline as a code comment rather than encoding it in the function signature.
- Test files mock `./auth-api`'s `logout()` in `vault-session.test.ts` (proving orchestration/ordering) and mock `fetch`/`./server-config`/`./session-storage` in `auth-api.test.ts` (proving wire format) — no test re-verifies the same concern at two layers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built missing WASM artifacts to unblock `tsc --noEmit`**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** This fresh worktree had no `extension/lib/crypto/wasm/` or `extension/public/wasm/` (gitignored WASM build output from `scripts/build-wasm.sh`). `tsc --noEmit` failed with 3 errors: a missing module (`./wasm/pv_wasm.js`), a `PublicPath` type overload mismatch for `/wasm/pv_wasm_bg.wasm`, and a downstream `Uint8Array | undefined` argument error in `vault-session.ts`'s pre-existing `setUnlockedUserKey()` (unrelated to this plan's own code — line 184 predates this plan's edits). None of the errors were caused by this plan's changes; they were a pure fresh-environment build-artifact gap not called out in the plan's `<environment_notes>`.
- **Fix:** Ran `cargo install wasm-bindgen-cli` (already at the pinned version, no-op) then `bash scripts/build-wasm.sh`, which compiled `pv-wasm` and generated the JS/TS glue + `.wasm` binary for both `web/` and `extension/`. Then re-ran `npx wxt prepare` to regenerate `extension/.wxt/types/paths.d.ts` (WXT had generated this file during `npm install`, before `public/wasm/pv_wasm_bg.wasm` existed, so the auto-generated `PublicPath` union type didn't yet include the new asset path).
- **Files modified:** None tracked by git — all outputs (`extension/lib/crypto/wasm/`, `extension/public/wasm/`, `web/src/lib/crypto/wasm/`, `web/public/wasm/`, `extension/.wxt/types/`) are gitignored build artifacts, confirmed via `git status --short` showing no new entries after the build.
- **Verification:** `npx tsc --noEmit` exits 0; full `npx vitest run` suite (683 tests) unaffected either way since `wasm-loader.ts` is always mocked in tests.
- **Committed in:** N/A — no tracked files changed; this was a local build-environment fix, not a code change.

---

**Total deviations:** 1 auto-fixed (1 blocking, build-environment only — no source code affected)
**Impact on plan:** Zero scope creep. No tracked file was touched by this fix; it only unblocked the plan's own `tsc --noEmit` verification step in this specific fresh worktree.

## Issues Encountered

- This worktree had neither `extension/node_modules/` nor the gitignored WASM build output present (a fresh worktree, as flagged in the plan's `<environment_notes>` for `node_modules` but not for WASM). `npm install` handled the first gap; `scripts/build-wasm.sh` + `wxt prepare` handled the second (see Deviations above). Both are one-time, environment-only steps with no effect on future runs in this same worktree.
- `auth-api.test.ts`'s first draft of the "throws ApiClientError on a non-2xx response" test reused a single `mockResolvedValue(...)` `Response` instance across two awaited `logout()` calls in the same test body — a `Response` body can only be consumed once, so the second call's `response.json()` silently fell back to `statusText` instead of the mocked JSON error body. Fixed (Rule 1, bug in test code I had just written, fixed inline before ever committing) by switching to `mockImplementation` that constructs a fresh `Response` per call.

## Next Phase Readiness

- `signOutVaultSession()` is ready for Plan 15-05 to call as the first step of its server-URL-change sequencing (grant-new-permission -> sign-out-old -> persist-new-config -> revoke-old-permission), strictly before any `configureServer(newUrl)` call.
- The 3 new `dictionary.ts` keys (`config.changeServerConfirmBody`, `config.changeServerConfirm`, `config.changeServerMigrationFailed`) are landed and ready for Plan 15-05's `ServerConfigView.tsx` confirm dialog — wave-sequencing (`15-05` `depends_on: ["15-02"]`) guarantees they exist before 15-05's own tests run.
- No UI was built by this plan, matching its stated scope — pure background orchestration only.

---
*Phase: 15-login-unlock-unification-vaultwarden-model*
*Completed: 2026-07-20*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commits (`f1c292f`, `31c3da5`) verified present in git log. No missing items.
