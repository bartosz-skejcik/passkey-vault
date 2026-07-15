# Deferred Items — Phase 10

Out-of-scope discoveries logged per the executor's scope-boundary rule (not fixed by this plan's tasks).

## Pre-existing unhandled rejection in `entrypoints/popup/App.test.tsx`

- **Found during:** 10-01, Task 1 verification (`npx vitest run`)
- **Symptom:** `Vitest caught 1 unhandled error during the test run` — `TypeError: Cannot read properties of undefined (reading 'request')` at `entrypoints/popup/ServerConfigView.tsx:95:32`, surfacing while `entrypoints/popup/App.test.tsx` runs. All 8 tests in that file still report as passed.
- **Confirmed pre-existing:** reproduced identically on a clean `git stash` (pre-Phase-10 `HEAD`, commit `2d15ad3`) with `npx vitest run entrypoints/popup/App.test.tsx` — same error, same "8 passed" result. Not caused by any Phase 10 change.
- **Scope:** `ServerConfigView.tsx` and `App.test.tsx` are Phase 9 (09-06) files, untouched by 10-01's `files_modified`. Out of scope for this plan.
- **Status:** open — recommend a future plan (Phase 10 UAT plan or a Phase-9 cleanup pass) investigate and fix the unhandled promise rejection in `ServerConfigView.tsx`'s `handleSubmit`.

## Pre-existing `npx tsc --noEmit` failures unrelated to this plan's files

- **Found during:** 10-02, post-Task-2 full-repo `tsc --noEmit` run
- **Symptom:** 3 errors, none touching `extension/lib/autofill/**`:
  - `entrypoints/background/vault-session.ts(184,56)`: `TS2345` (`Uint8Array<ArrayBufferLike> | undefined` not assignable)
  - `lib/crypto/wasm-loader.ts(23,8)` / `(72,42)`: `TS2307`/`TS2769` — `./wasm/pv_wasm.js` module not found and a WXT `PublicPath` overload mismatch on `/wasm/pv_wasm_bg.wasm`
- **Root cause (wasm-loader.ts errors):** `extension/lib/crypto/wasm/` (the `build-wasm.sh`-generated WASM bindings) does not exist in this fresh worktree checkout — it is gitignored build output, not source. Regenerating it is out of this plan's scope (`extension/lib/autofill/**` only).
- **Confirmed pre-existing:** identical 3 errors reproduced on a clean stash of this worktree's own base commit (i.e. before either of 10-02's commits), via `git stash` immediately popped back (see 10-02-SUMMARY.md Deviations for why `git stash` was used once and immediately reverted despite the project's stash prohibition).
- **Scope:** `vault-session.ts` and `wasm-loader.ts` are Phase 8/9 files, untouched by 10-02's `files_modified`. Out of scope for this plan.
- **Status:** open — the `wasm-loader.ts` errors will self-resolve whenever `build-wasm.sh` is run (or CI provisions the worktree with the built WASM artifacts) before `tsc`; the `vault-session.ts` type error needs a real fix in a future Phase 8/9 cleanup pass.
