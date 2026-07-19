# Deferred Items — Phase 13

Out-of-scope discoveries logged during plan execution, not fixed per the
deviation rules' scope boundary (only auto-fix issues directly caused by
the current task's changes).

## From 13-01 (Firefox manifest/CSP/gecko hardening)

### Pre-existing unhandled rejection in `entrypoints/popup/App.test.tsx`

- **Discovered during:** Task 3's gate check (`npm --prefix extension test`)
- **Symptom:** `npm --prefix extension test` exits 1 despite all 514/514
  tests passing (`Test Files 45 passed (45)`, `Tests 514 passed (514)`).
  Vitest reports 1 "Unhandled Rejection": `TypeError: Cannot read
  properties of undefined (reading 'request')` at
  `entrypoints/popup/ServerConfigView.tsx:95:32`
  (`browser.permissions.request(...)`), surfacing during
  `entrypoints/popup/App.test.tsx`'s "a successful change dispatches
  config.set ... and leaves the config view" test.
- **Root cause:** `App.test.tsx`'s `browser` mock does not include a
  `permissions` key (confirmed via grep — no `permissions` mock in that
  file), unlike `ServerConfigView.test.tsx`, which does mock
  `permissions: { request: mockPermissionsRequest }`. When
  `ServerConfigView.tsx`'s `handleSubmit` reaches the fire-and-forget
  `void browser.permissions.request(...).catch(() => false)` line, member
  access on `browser.permissions` (undefined in this mock) throws
  synchronously, and because that throw happens outside any of the
  function's own try/catch, the async `handleSubmit`'s returned promise
  rejects unobserved.
- **Not in scope of this plan:** `App.test.tsx` was last touched in Phase 12
  (commit `7c56380`), and this plan (13-01) modified only
  `extension/wxt.config.ts` and `extension/package.json` — neither of which
  is imported by, or affects the mock setup of, `App.test.tsx` or
  `ServerConfigView.tsx`. This is a pre-existing test-mock gap, unrelated to
  Firefox manifest/CSP hardening.
- **Recommended fix (not applied here):** add a `permissions: { request:
  vi.fn().mockResolvedValue(true) }` (or similar) entry to `App.test.tsx`'s
  `browser` mock, mirroring `ServerConfigView.test.tsx`'s existing pattern.
- **Status:** Deferred — flag for the next plan/phase that touches
  `App.test.tsx` or `entrypoints/popup/` test mocks.

## 13-07 (execution session)

- **Out-of-scope, pre-existing:** `extension/entrypoints/popup/App.test.tsx` triggers an unhandled promise
  rejection from `entrypoints/popup/ServerConfigView.tsx:111:32` ("Cannot read properties of undefined
  (reading 'request')") during a full `npm test` run. Neither file is touched by 13-07's plan or diff.
  Does not fail any test (all 616 pass); flagged per scope-boundary rule, not fixed.

## CORS: Access-Control-Allow-Headers wildcard vs Authorization (2026-07-20, live FF warning)
Firefox loguje przy każdym syncu z rozszerzenia: "When the `Access-Control-Allow-Headers` is `*`, the `Authorization` header is not covered" — przyszła zmiana przeglądarek wyłączy Authorization z wildcardu. Fix: crates/pv-server CORS layer ma jawnie listować `Authorization` (+ pozostałe używane nagłówki) zamiast `*`. Nie blokuje dziś; zrobić przy najbliższym dotknięciu warstwy CORS (np. przy D-10 moz-wildcard→konkretne originy).
