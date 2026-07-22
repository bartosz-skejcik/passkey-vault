
## From 15-03 execution (2026-07-20)

- **Flaky test (out of scope, not caused by this plan):** `entrypoints/background/generate-handler.test.ts` > "passphrase mode returns a password with the requested word count" intermittently fails under full-suite `npx vitest run` (observed: 6 words instead of 5), but passes consistently (3/3) when run in isolation. Not touched by Plan 15-03's `files_modified`; unrelated to popup auth surfaces. Logged, not fixed, per SCOPE BOUNDARY.

## From 15-04 execution (2026-07-20)

- **Dead dictionary keys (out of scope, not in `files_modified`):** `extension/lib/i18n/dictionary.ts`'s 9 `extPasskey.*` keys (`promptTitle`, `promptBody`, `promptCta`, `promptSkip`, `promptDontAskAgain`, `enrollDone`, `enrollNoPrf`, `enrollFailed`, `unlockOrphaned`, `serverPathPointer`) are now unreferenced by any live source file -- confirmed via `grep -rn '"extPasskey\.' entrypoints lib` finding zero consumers outside `dictionary.ts` itself. `dictionary.ts` was not in this plan's `files_modified`, and TypeScript's structural typing does not flag unused object keys on a plain data map, so this does not block `tsc`/`vitest`. Logged, not fixed, per SCOPE BOUNDARY -- a future dictionary-cleanup pass (or the next plan touching `dictionary.ts`) can drop these 9 keys.
