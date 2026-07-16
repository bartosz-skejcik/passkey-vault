# Deferred Items — Phase 12

Out-of-scope discoveries logged during plan execution, not fixed (per executor scope-boundary rule).

## From Plan 12-03

- **Pre-existing test flakiness: `entrypoints/popup/App.test.tsx` — unhandled rejection in `ServerConfigView.tsx:95` (`Cannot read properties of undefined (reading 'request')`).** Observed as an "Unhandled Rejection" in the full `npm test` run (not a reported test failure — all 43 files/444 tests still pass). Neither `App.test.tsx` nor `ServerConfigView.tsx` is in this plan's `files_modified`, and `git status` confirms both are untouched by this plan's changes. Likely a pre-existing `browser.permissions.request` mock gap surfacing after a test's own assertions complete. Not fixed here — out of scope per the executor's scope-boundary rule (only fixes directly caused by the current task's changes are in-scope).
