# Deferred Items — Phase 10

Out-of-scope discoveries logged per the executor's scope-boundary rule (not fixed by this plan's tasks).

## Pre-existing unhandled rejection in `entrypoints/popup/App.test.tsx`

- **Found during:** 10-01, Task 1 verification (`npx vitest run`)
- **Symptom:** `Vitest caught 1 unhandled error during the test run` — `TypeError: Cannot read properties of undefined (reading 'request')` at `entrypoints/popup/ServerConfigView.tsx:95:32`, surfacing while `entrypoints/popup/App.test.tsx` runs. All 8 tests in that file still report as passed.
- **Confirmed pre-existing:** reproduced identically on a clean `git stash` (pre-Phase-10 `HEAD`, commit `2d15ad3`) with `npx vitest run entrypoints/popup/App.test.tsx` — same error, same "8 passed" result. Not caused by any Phase 10 change.
- **Scope:** `ServerConfigView.tsx` and `App.test.tsx` are Phase 9 (09-06) files, untouched by 10-01's `files_modified`. Out of scope for this plan.
- **Status:** open — recommend a future plan (Phase 10 UAT plan or a Phase-9 cleanup pass) investigate and fix the unhandled promise rejection in `ServerConfigView.tsx`'s `handleSubmit`.
