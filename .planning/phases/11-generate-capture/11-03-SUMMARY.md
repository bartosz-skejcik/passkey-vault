---
phase: 11-generate-capture
plan: 03
subsystem: extension
tags: [wxt, browser-extension, capture, encrypt-persist, messaging-protocol, revision-conflict]

# Dependency graph
requires:
  - phase: 11-generate-capture
    plan: "11-01"
    provides: "ext-protocol.ts's capture.propose/capture.confirm message-kind shapes; registerAutofillFrameChannel()'s content-frame dispatch registration pattern"
  - phase: 09-session-unlock-popup-sync
    provides: "vault-session.ts's ensureHydrated() (MV3-idle-kill-safe key re-read), auth-api.ts's apiFetch/ApiClientError"
  - phase: 10-autofill
    provides: "frame-guard.ts's itemMatchesOrigin() (exact-origin login-item match gate), autofill-frame.ts's assertContentSender()/originFromContentSender()"
provides:
  - "capture-handler.ts's classifySubmit() — pure new/update/no-op classification against the already-decrypted vault, with independently-computed origin mismatch"
  - "capture-handler.ts's confirmNewLogin()/confirmUpdateLogin() — encrypt-then-persist via the extension's newly-added write path, with LockedVaultError/RevisionConflictError typed failure modes"
  - "vault-api.ts's createItem/updateItem and vault-store.ts's splitCombinedEncryptedItem/RevisionConflictError/isConflictError — the extension's first write path, ported verbatim from web/src/lib/vault/{api,store}.ts's templates"
  - "wasm-loader.ts's encryptItem re-export — the extension's first encrypt entry point (previously read-only/decrypt-only)"
  - "capture.propose/capture.confirm wired into registerAutofillFrameChannel(), with senderTopOrigin derived exclusively from sender.tab.url"
affects: [11-04, 11-05, capture-flow, generate-popover]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "capture.propose/capture.confirm dispatched via the SAME registerAutofillFrameChannel() listener as autofill.matchFrame/fillFrame and generate-request -- never the popup router's handle()/isProtocolMessage() (X-1 precedent, now applied a third/fourth time)."
    - "senderTopOrigin is derived from sender.tab.url exclusively, parsed via new URL(...).origin and failing CLOSED to '' (never equal to a real origin) on an unparseable/missing tab URL -- mirrors frame-guard.ts's originEquals' own 'never treat a parse failure as a match' discipline (D-06/T-11-07)."
    - "The extension's write path (createItem/updateItem/splitCombinedEncryptedItem/RevisionConflictError/isConflictError) is ported verbatim from web/'s templates into the SAME files (vault-api.ts/vault-store.ts) that already held the read path, not a parallel/duplicate module (D-01/D-09)."
    - "confirmNewLogin/confirmUpdateLogin call vault-api.ts directly and do NOT mutate vault-store.ts's in-memory items array themselves -- the next sync pull (vault-store.ts's existing applySyncSnapshot, already wired since Phase 9) picks up the new/changed item, avoiding a second optimistic-update path alongside the read-only cache's existing merge logic."

key-files:
  created:
    - extension/entrypoints/background/capture-handler.ts
    - extension/entrypoints/background/capture-handler.test.ts
  modified:
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/vault-api.ts
    - extension/lib/crypto/wasm-loader.ts

key-decisions:
  - "classifySubmit's return type is exactly MessageResponseMap['capture.propose'] (ext-protocol.ts) -- no intermediate shape -- so router.ts's handleCaptureProposeMessage can return it directly with zero mapping."
  - "confirmNewLogin/confirmUpdateLogin do not touch vault-store.ts's in-memory items array -- persistence relies on vault-api.ts's createItem/updateItem plus the existing sync-pull merge path, not a new optimistic-update mechanism."
  - "A rejected sender on capture.propose returns a maximally-inert {action:'no-op', frameOrigin:'', topOrigin:'', mismatch:true} rather than throwing -- mirrors handleMatchFrame's own fail-closed-empty-result discipline for a non-content-script sender, since capture.propose's response shape has no dedicated 'restricted' variant."
  - "capture.confirm's handler catches RevisionConflictError/LockedVaultError internally and returns typed {status:'conflict'|'error', message} responses rather than letting them propagate to registerAutofillFrameChannel()'s generic catch-all (which sends an autofill-shaped {ok:false, reason:'target-unreachable'} that would be the wrong response shape for this kind)."

patterns-established:
  - "Encrypt-then-persist login capture reuses the exact {uk, plaintext, id, revision} -> encryptItem -> split -> createItem/updateItem shape web/'s createVaultItem/updateVaultItem already proved correct -- capture-handler.ts is the extension's second caller of this shape (vault-store.ts's read path being the first for decrypt)."

requirements-completed: [CAP-02, CAP-03]

coverage:
  - id: D1
    description: "classifySubmit() distinguishes new/update/no-op by comparing plaintext against an already-decrypted vault item matched on origin+username (never ciphertext), reusing itemMatchesOrigin() for the origin half; mismatch is computed by direct frameOrigin-vs-senderTopOrigin comparison on every action branch"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts (classifySubmit describe block, 9 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "confirmNewLogin/confirmUpdateLogin encrypt+persist via the newly-ported store.ts-mirrored shape (encryptItem -> splitCombinedEncryptedItem -> createItem/updateItem), re-reading the unlocked User Key via ensureHydrated() (never getUnlockedUserKey()); a 409 throws RevisionConflictError instead of silently overwriting; an absent/idle-killed session throws LockedVaultError"
    requirement: "CAP-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts (confirmNewLogin + confirmUpdateLogin describe blocks, 5 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "capture.propose/capture.confirm are wired into registerAutofillFrameChannel()'s content-frame dispatch, guarded by assertContentSender, with topOrigin derived exclusively from sender.tab.url (never the client-supplied frameOrigin payload field) — neither kind reachable via the popup router's isProtocolMessage()/handle()"
    requirement: "CAP-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts + extension/entrypoints/background/autofill-frame.test.ts (assertContentSender coverage, reused unmodified)"
        status: pass
      - kind: other
        ref: "manual source-grep: router.ts's isProtocolMessage() switch does not list capture.propose/capture.confirm; registerAutofillFrameChannel()'s isContentFrameMessage()/handleContentFrameMessage() do"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 03: Generate-Capture Background Brain Summary

**classifySubmit() (new/update/no-op classification with independent D-06 origin-mismatch computation) plus confirmNewLogin/confirmUpdateLogin's encrypt-then-persist write path, ported verbatim into the extension's previously read-only vault-store.ts/vault-api.ts, wired into capture.propose/capture.confirm on the content-frame channel.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-07-16T11:45:00Z (approx.)
- **Completed:** 2026-07-16T12:11:29Z
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `classifySubmit()` — a pure function distinguishing new/update/no-op submits against the already-decrypted vault, reusing `frame-guard.ts`'s `itemMatchesOrigin()` for exact origin matching and layering username equality on top; `mismatch` computed by direct `frameOrigin !== senderTopOrigin` comparison on every branch, never trusted from an upstream flag
- The extension's first encrypt/write path: `wasm-loader.ts` gained `encryptItem`, `vault-api.ts` gained `createItem`/`updateItem`, `vault-store.ts` gained `splitCombinedEncryptedItem`/`RevisionConflictError`/`isConflictError` — all ported verbatim from `web/src/lib/vault/{api,store}.ts`'s proven templates into the SAME files that already held the read path
- `confirmNewLogin`/`confirmUpdateLogin` re-read the unlocked User Key via `ensureHydrated()` (never `getUnlockedUserKey()`'s in-memory-only cache) at the moment of encrypt+persist, throwing `LockedVaultError` on an absent key and `RevisionConflictError` on a 409 instead of silently overwriting
- `capture.propose`/`capture.confirm` wired into `registerAutofillFrameChannel()`'s content-frame dispatch (never the popup router), guarded by `assertContentSender`, with the trusted top-level origin derived exclusively from `sender.tab.url`

## Task Commits

Each task used TDD, with separate RED/GREEN commits:

1. **Task 1: classifySubmit + independent origin-mismatch computation** - `8b05755` (test, RED) → `7795687` (feat, GREEN)
2. **Task 2: write path port + encrypt-then-persist confirm-new/confirm-update + router wiring** - `3f138ed` (test, RED) → `99fa452` (feat, GREEN)

**Plan metadata:** committed by orchestrator after wave merge (worktree mode)

## Files Created/Modified

- `extension/entrypoints/background/capture-handler.ts` - New: `classifySubmit()` (pure), `confirmNewLogin()`/`confirmUpdateLogin()` (encrypt+persist), `LockedVaultError`, `buildLoginFields()` helper
- `extension/entrypoints/background/capture-handler.test.ts` - New: 14 tests (9 classifySubmit, 5 confirmNewLogin/confirmUpdateLogin)
- `extension/entrypoints/background/router.ts` - `registerAutofillFrameChannel()`'s `isContentFrameMessage()`/`handleContentFrameMessage()` now recognize `capture.propose`/`capture.confirm`; new `handleCaptureProposeMessage`/`handleCaptureConfirmMessage`/`deriveSenderTopOrigin` helpers
- `extension/entrypoints/background/vault-store.ts` - Gained `splitCombinedEncryptedItem`/`RevisionConflictError`/`isConflictError` (ported verbatim from `web/src/lib/vault/store.ts`), sitting alongside the existing read-only `recombineEncryptedItem`
- `extension/entrypoints/background/vault-api.ts` - Gained `createItem`/`updateItem` (ported verbatim from `web/src/lib/vault/api.ts`), reusing this file's own `apiJson`/`apiFetch`
- `extension/lib/crypto/wasm-loader.ts` - Gained `encryptItem` re-export (mirrors the existing `decryptItem` re-export)

## Decisions Made

- `classifySubmit`'s return type is exactly `MessageResponseMap["capture.propose"]` (ext-protocol.ts) — router.ts's `handleCaptureProposeMessage` returns it directly with zero mapping/translation layer.
- `confirmNewLogin`/`confirmUpdateLogin` intentionally do NOT mutate `vault-store.ts`'s in-memory `items` array — persistence relies on `vault-api.ts`'s `createItem`/`updateItem` plus the vault's existing sync-pull merge path (`applySyncSnapshot`, wired since Phase 9) to eventually reflect the new/changed item, avoiding a second, parallel optimistic-update mechanism alongside the read-only cache's existing merge logic. A future plan surfacing the captured item in the popup immediately (before the next sync tick) may need to revisit this.
- A rejected sender on `capture.propose` returns a maximally-inert `{action:"no-op", frameOrigin:"", topOrigin:"", mismatch:true}` rather than throwing — mirrors `handleMatchFrame`'s own fail-closed-empty-result discipline, since `capture.propose`'s response shape has no dedicated "restricted"/"forbidden" variant.
- `handleCaptureConfirmMessage` catches `RevisionConflictError`/`LockedVaultError` internally and returns typed `{status: "conflict"|"error", message}` responses rather than letting them propagate to `registerAutofillFrameChannel()`'s generic catch-all (which sends an autofill-shaped `{ok:false, reason:"target-unreachable"}` — the wrong response shape for `capture.confirm`).
- `senderTopOrigin` fails CLOSED to `""` (never equal to any real origin, so `classifySubmit`'s mismatch check trips) when `sender.tab.url` is missing or unparseable, mirroring `frame-guard.ts`'s `originEquals`' own "never treat a parse failure as a match" discipline.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written; no bugs, missing critical functionality, or blocking issues were discovered beyond what's covered in "Issues Encountered" below (environmental, not code fixes).

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None. Plan's task shapes, threat-model dispositions, and success criteria all implemented as specified.

## Issues Encountered

- **`extension/node_modules` was missing** in this fresh worktree checkout — ran `npm ci` (documented tooling setup, not a code change; `node_modules` is gitignored, nothing to commit).
- **3 pre-existing `tsc --noEmit` errors** in `entrypoints/background/vault-session.ts` and `lib/crypto/wasm-loader.ts`, caused by the missing generated WASM build artifact (`extension/lib/crypto/wasm/`) — confirmed identical count/location before and after this plan's changes (adding `export { encryptItem }` to the same already-broken import line introduced no new error). Documented in `.planning/phases/11-generate-capture/deferred-items.md` (from Plan 11-01, still accurate). Not fixed here — out of scope (Rust/cargo/wasm-bindgen-cli toolchain step, not a code bug).
- **`router.test.ts` fails to LOAD** (module-load error, not a test failure) with the same missing-WASM root cause, pre-existing since before this plan (confirmed via `git status --short` showing no local edits to that file and 11-01-SUMMARY.md documenting the identical failure at the prior commit). This plan's own `<verification>` block only requires `vitest run entrypoints/background/capture-handler` and `tsc --noEmit`, both of which pass cleanly; `router.test.ts`'s pre-existing gap is unrelated to `capture.propose`/`capture.confirm`'s wiring (verified via direct source inspection: the new dispatch code in `handleCaptureProposeMessage`/`handleCaptureConfirmMessage` introduces no additional import that `router.test.ts` doesn't already fail to satisfy).
- Neither issue blocks this plan's own success criteria: both plan-specified verification commands pass cleanly (`npx vitest run entrypoints/background/capture-handler -t classifySubmit` — 9/9; full `npx vitest run entrypoints/background/capture-handler` — 14/14; `npx tsc --noEmit` — same 3 pre-existing errors, zero new).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `capture-handler.ts`'s `classifySubmit`/`confirmNewLogin`/`confirmUpdateLogin` are ready for Plan 11-04/11-05's capture UI (content-script prompt) to drive via `capture.propose`/`capture.confirm` `sendMessage` calls.
- The extension's write path (`vault-api.ts`'s `createItem`/`updateItem`, `vault-store.ts`'s `splitCombinedEncryptedItem`/`RevisionConflictError`) is now available for any future plan needing to persist an encrypted item from the background context — no longer read-only.
- Concern for a future plan/session: install `wasm-bindgen-cli` and run `scripts/build-wasm.sh` (or accept the pre-existing gap) to get a fully clean `tsc --noEmit`/full-suite baseline, including `router.test.ts`'s load failure — both pre-existing and unrelated to Phase 11, tracked in `deferred-items.md`.
- Concern for Plan 11-04/11-05: `confirmNewLogin`/`confirmUpdateLogin` do not immediately update `vault-store.ts`'s in-memory `items` array — a capture-UI plan surfacing the just-captured item in the popup before the next sync tick completes should be aware of this and may want an explicit `getSyncSnapshot(0)`-style refresh trigger after a successful `capture.confirm`, or accept the brief lag until the next poll/WS push.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*
