---
phase: 29-a-real-settings-page-shell-migration
plan: 05
subsystem: testing
tags: [playwright, e2e, live-proof, axum, static-export, nextjs, download-event]

requires:
  - phase: 29-a-real-settings-page-shell-migration
    provides: "Real /settings route with settings-section-dane/settings-section-konto/settings-back-to-vault testids (Plan 29-01)"
  - phase: 29-a-real-settings-page-shell-migration
    provides: "ExportDialog's DEBT-02 disclosure sentence + hydrated gate (Plan 29-02)"
  - phase: 29-a-real-settings-page-shell-migration
    provides: "Sidebar's sidebar-open-settings real <Link>, drawer/tab mechanism retired (Plan 29-03)"
  - phase: 29-a-real-settings-page-shell-migration
    provides: "Repaired live e2e settings-navigation helpers in sharing/invite-flow/remove-member/delete-account specs (Plan 29-04)"
provides:
  - "web/e2e/export-disclosure.spec.ts -- this repo's first Playwright download-event spec; live byte-level proof DEBT-02's disclosure is honest for both a direct hidden_password share and a collection-scoped one, JSON and CSV"
  - "web/e2e/settings-route.spec.ts -- live proof of SC1's cold-navigation, reload-survival, and browser-back claims"
  - "pv-server's static-file serving now correctly serves any nested static route (out/<route>.html) at its real URL instead of silently substituting the root SPA page"
affects: []

tech-stack:
  added: []
  patterns:
    - "Playwright real browser download-event proof (page.waitForEvent('download') + download.path() + readFileSync) -- first use in this repo, for a claim no unit test (mocked crypto/store) can make"
    - "axum middleware.layer() scoped to a nested child Router used only as a fallback_service, keeping a request-rewrite concern fully self-contained rather than applied to the whole API router"

key-files:
  created:
    - web/e2e/export-disclosure.spec.ts
    - web/e2e/settings-route.spec.ts
  modified:
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/Cargo.toml

key-decisions:
  - "Direct-share-first ordering in export-disclosure.spec.ts: the item shared DIRECTLY at hidden_password is created and shared BEFORE the collection (folder) share, so the one-time per-account hidden-password ack modal is triggered and dismissed exactly once (on the direct share) -- shareExistingFolderWithMember's local reimplementation (mirroring sharing.spec.ts's own helper) deliberately does not handle that modal, matching the existing convention that only createAndShare-style call sites handle it."
  - "Rule 3 deviation (blocking, found live by Task 2's own SC1 proof): pv-server's static-file fallback silently served the ROOT index.html for GET /settings instead of the real settings.html -- Next.js 16's Turbopack static export puts a nested route's real page at a FLAT <route>.html file, and the same-named out/<route>/ directory holds only RSC prefetch fragments, never an index.html, which is what ServeDir's own directory-then-index.html logic assumed. Fixed with a small axum middleware (rewrite_nested_static_route) that rewrites the bare request path to its real .html file before ServeDir ever treats the directory as ambiguous -- scoped to only the static-file fallback service via a nested child Router, not the whole API router."
  - "tokio's 'fs' feature moved from implicit (transitive, via tower-http's own 'fs' feature) to an explicit direct dependency in pv-server/Cargo.toml -- the fix's tokio::fs::try_exists call should not rely on unstated feature unification."

patterns-established:
  - "Real browser download-event Playwright pattern (waitForEvent('download') -> download.path() -> readFileSync) is now precedented in this repo for any future claim requiring proof of actual generated-file bytes, not rendered DOM."

requirements-completed: [DEBT-02, SET-01, SET-02]

coverage:
  - id: D1
    description: "A real generated export file's bytes (JSON and CSV) contain the actual plaintext password for a hidden_password-level item reached via a DIRECT share, live -- not a unit-test claim."
    requirement: "DEBT-02"
    verification:
      - kind: e2e
        ref: "web/e2e/export-disclosure.spec.ts#hidden_password export includes real plaintext for both a directly-shared item and a collection-shared item, in JSON and CSV (DEBT-02 SC4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same file-byte proof also covers an item reached via a COLLECTION (shared folder) held at hidden_password -- proving the counted/disclosed set includes collection-scoped shares against real data, not a mocked getItems() array."
    requirement: "DEBT-02"
    verification:
      - kind: e2e
        ref: "web/e2e/export-disclosure.spec.ts (same test -- asserts folderItemName/folderPassword present in both JSON and CSV bytes)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The disclosure sentence's rendered count (n=2) is asserted visible and export-confirm is asserted NOT disabled BEFORE the export click, not inferred after the download succeeds -- proving genuine hydration completion, not lucky timing."
    requirement: "DEBT-02"
    verification:
      - kind: e2e
        ref: "web/e2e/export-disclosure.spec.ts (runExport() helper's pre-click assertions, run twice: JSON and CSV)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A cold page.goto('/settings') -- this browser context's first visit to the exact route, with a valid session -- renders the real settings shell (h1, jump-nav landmark) behind its own UnlockOverlay, then unlocks through to real settings content end-to-end."
    requirement: "SET-01"
    verification:
      - kind: e2e
        ref: "web/e2e/settings-route.spec.ts#Case 1 (cold navigation)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A hard page.reload() on /settings re-renders the same shell (not a 404) and correctly re-shows the unlock overlay -- the static-export 'survives a reload' claim proven live, not only via the npm run build artifact check."
    requirement: "SET-01"
    verification:
      - kind: e2e
        ref: "web/e2e/settings-route.spec.ts#Case 2 (reload survival)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Browser back after a client-side <Link> transition to /settings (with NO re-unlock prompt, corroborating the 29-01/29-03 <Link>-over-bare-<a> decision) returns to a usable, still-unlocked vault via a real page.goBack()."
    requirement: "SET-02"
    verification:
      - kind: e2e
        ref: "web/e2e/settings-route.spec.ts#Case 3 (browser back)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Phase-wide regression sweep: full vitest suite green at the recorded baseline (no unexplained drop), npm run build produces the settings artifact triple, and the full live e2e regression across every spec this phase touched or could plausibly affect passes."
    requirement: "SET-01"
    verification:
      - kind: unit
        ref: "cd web && npm test -- 832/832 tests, 80/80 files"
        status: pass
      - kind: other
        ref: "cd web && npm run build -- exits 0; out/settings.html + out/settings.txt + out/settings/ all present"
        status: pass
      - kind: e2e
        ref: "cd web && npx playwright test e2e/sharing.spec.ts e2e/invite-flow.spec.ts e2e/remove-member.spec.ts e2e/delete-account.spec.ts e2e/export-disclosure.spec.ts e2e/settings-route.spec.ts e2e/smoke.spec.ts e2e/shared-sync.spec.ts -- 23/23 tests pass"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-08-10
status: complete
---

# Phase 29 Plan 05: Live Byte/Route Evidence + Phase-Final Verification Summary

**Playwright's first real download-event spec proves DEBT-02's export honesty against actual file bytes (direct AND collection-scoped hidden_password shares, JSON and CSV), a second new spec proves SC1's cold-navigation/reload/browser-back claims live, and a genuine pv-server static-routing bug -- `/settings` silently served the root vault SPA, not Settings -- was found and fixed along the way.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3 complete (2 code tasks + 1 verification-only sweep; 1 Rule-3 deviation fix)
- **Files modified:** 4 (2 new e2e specs + 2 pv-server files for the deviation fix)

## Accomplishments

- `web/e2e/export-disclosure.spec.ts` -- this repo's first Playwright spec to handle a real browser `download` event. Sets up a real recipient session holding TWO independent `hidden_password` grants (a direct item share, mirroring `sharing.spec.ts`'s `createAndShare` including the one-time honesty ack modal; and an item reached via an existing shared folder/collection, mirroring `shareExistingFolderWithMember`), navigates to `/settings` via the real `<Link>`, asserts the disclosure sentence's `n=2` count and `export-confirm`'s non-disabled state BEFORE clicking, then generates and reads a REAL file from disk (`download.path()` + `readFileSync`) for both JSON and CSV formats -- asserting the actual bytes contain both items' real plaintext passwords. This is the byte-level evidence bar DEBT-02's own SC4 requires; nothing in this repo's vitest suite (which mocks `@/lib/crypto`) can make this claim.
- `web/e2e/settings-route.spec.ts` -- a single-session spec proving SC1's three remaining unverified claims live: Case 1 (cold `page.goto("/settings")`, first visit to the route, valid session) renders the shell behind `UnlockOverlay` and unlocks through to real content; Case 2 (`page.reload()`) survives with the same shell markers re-rendering and the vault re-locking; Case 3 (`settings-back-to-vault` then `sidebar-open-settings`, both real `<Link>` client-side transitions) shows NO re-unlock prompt, and a real `page.goBack()` returns to a usable vault.
- **Real bug found and fixed live** (not this plan's original scope, but a genuine blocking issue Task 2's own proof surfaced): `pv-server`'s static-file serving silently served the ROOT `index.html` (the vault's own React tree) for `GET /settings`, not the real Settings page -- confirmed by comparing raw response bytes (`content-length: 10714` matching `out/index.html` exactly, not `out/settings.html`'s `10910`). Root cause: Next.js 16's Turbopack static export emits a nested App Router route's real page as a FLAT `<route>.html` file; the same-named `out/<route>/` directory holds only RSC prefetch fragments (`__next.*.txt`), never an `index.html`. `ServeDir`'s own directory handling (redirect-with-trailing-slash, then look for `index.html` inside) found nothing there and fell straight through to the SPA fallback. Fixed with `rewrite_nested_static_route`, a small axum middleware scoped only to the static-file fallback service (a nested child `Router`, not the whole API router) that rewrites a bare nested-route request path to its real `.html` file before `ServeDir` ever sees the ambiguous directory name.
- Full phase-final verification sweep (Task 3): vitest 832/832 (80/80 files, matching the recorded current-main baseline exactly -- this plan adds zero new unit tests, being e2e-only); `npm run build` exits 0 and produces the settings artifact triple; the full live e2e regression across every spec this phase touched or could plausibly affect (`sharing`, `invite-flow`, `remove-member`, `delete-account`, `export-disclosure`, `settings-route`, `smoke`, `shared-sync`) -- 23/23 tests pass in one combined run.

## Task Commits

Each task was committed atomically:

1. **Task 1: New e2e spec -- hidden_password export byte proof** - `982a305` (test)
2. **Deviation fix (Rule 3, found live during Task 2): pv-server nested static route serving** - `2f16b34` (fix)
3. **Task 2: New e2e spec -- SC1 live proof (cold navigation, reload, browser back)** - `6acdb72` (test)

**Task 3 (phase-final verification sweep):** no code changes -- results recorded above and in the coverage block (D7). All three legs (vitest, build, live e2e regression) passed on the first run after the deviation fix landed.

## Files Created/Modified

- `web/e2e/export-disclosure.spec.ts` -- new spec: real download-event byte proof for DEBT-02's SC4, covering direct and collection-scoped hidden_password shares, JSON and CSV
- `web/e2e/settings-route.spec.ts` -- new spec: live cold-navigation/reload/browser-back proof for SC1
- `crates/pv-server/src/routes/mod.rs` -- `rewrite_nested_static_route` middleware, scoped to the static-file fallback service, fixing nested static-route serving
- `crates/pv-server/Cargo.toml` -- `tokio`'s `"fs"` feature made an explicit direct dependency (previously only available transitively via `tower-http`'s own `"fs"` feature)

## Decisions Made

- **Direct share before collection share, same account, same test.** The direct-share step is what triggers and dismisses the one-time per-account hidden-password honesty ack modal (mirroring `sharing.spec.ts`'s `createAndShare` pattern); the collection share that follows reuses a local `shareExistingFolderWithMember` (deliberately not ack-aware, matching the existing convention in `sharing.spec.ts`) which only works correctly because the ack was already dismissed by the earlier direct share in the same test.
- **The pv-server routing fix is scoped as narrowly as possible.** `rewrite_nested_static_route` is layered on a nested child `Router` used only as the static-file `fallback_service`, not on the whole API router -- so the fix cannot interact with `/api/*` request handling, session extraction, or CORS in any way, even though the middleware's own internal guard (`!path.starts_with("/api/")`) would have made that safe regardless.
- **`tokio`'s `"fs"` feature made explicit rather than relying on transitive unification.** Even though `tower-http`'s own `"fs"` feature (already enabled in this crate) very likely already unifies `tokio`'s `"fs"` feature across the build graph, the fix's own direct `tokio::fs::try_exists` call now has an honest, self-documenting entry in `pv-server/Cargo.toml` rather than depending on an implicit transitive grant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pv-server` silently served the root vault page for `GET /settings`, not Settings**
- **Found during:** Task 2 (`settings-route.spec.ts`'s own Case 1 cold-navigation assertion) -- the very first live run of this plan's own second spec failed immediately, with the captured DOM snapshot showing the VAULT's "All" heading and empty-state copy instead of the Settings shell's `<h1>`, even though a valid session existed and `page.goto("/settings")` returned 200.
- **Issue:** `crates/pv-server/src/routes/mod.rs`'s static-file fallback (`ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")))`) assumed a nested route's real page lived at `out/<route>/index.html`. Next.js 16's Turbopack static export instead emits it as a flat `out/<route>.html` file; `out/<route>/` exists but only holds RSC prefetch fragments (`__next.*.txt`), never an `index.html`. A request for `/settings` (no trailing slash) triggered `ServeDir`'s own directory-redirect behavior (307 to `/settings/`), and the follow-up request for `/settings/` found no `index.html` inside that directory and fell straight through to the SPA `index.html` fallback -- silently serving the ROOT page's entirely different React tree at a 200 status, with no error signal of any kind. Confirmed via manual `curl` against a locally-started server: `/settings/`'s response body was byte-identical to `out/index.html` (`content-length: 10714`), not `out/settings.html` (`content-length: 10910`).
- **Fix:** Added `rewrite_nested_static_route`, an axum middleware that intercepts a bare GET request path with no file extension, checks whether `<static_dir>/<path>.html` exists on disk, and if so rewrites the request's URI to that literal path BEFORE `ServeDir` ever sees the ambiguous directory name -- so `/settings` (and, as a byproduct, any other nested static route such as `/self-test`) is served directly at its real URL with a genuine 200, no visible redirect, no silent substitution. Scoped to a small nested child `Router` used only as the static-file `fallback_service`, leaving the rest of the API router (including `/api/*` handling and the existing `referrer_policy_middleware`/CORS layers) untouched. `tokio`'s `"fs"` feature was made an explicit direct dependency to support the fix's `tokio::fs::try_exists` call.
- **Files modified:** `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/Cargo.toml`
- **Verification:** `cargo check -p pv-server` clean; manual `curl` against a locally-started server confirmed `GET /settings` now returns byte-identical content to `out/settings.html` (`content-length: 10910`, diff empty) while `GET /` remains byte-identical to `out/index.html` and `GET /healthz` is unaffected. Both this plan's own e2e specs then passed live, and the full Task 3 regression sweep (23 e2e tests across 8 files, 832 vitest tests, `npm run build`) confirmed no regression anywhere else in the router.
- **Committed in:** `2f16b34`

---

**Total deviations:** 1 auto-fixed (1 Rule-3 blocking-issue fix). The bug predates this plan (present since Plan 29-01 first created the `/settings` route) but was invisible until this plan's own live-navigation proof was the first thing in the phase to actually request the route through a real browser against the real static-export build -- every prior plan's verification was either a jsdom mount test or a `npm run build` artifact-existence check, neither of which exercises the server's own request routing.
**Impact on plan:** Necessary correctness fix -- without it, SC1's entire "real, linkable route" claim was false in the one way that matters most (a cold browser visit to the URL). No scope creep: the fix is minimal, narrowly scoped to the static-file fallback path only, and does not touch any `/api/*` behavior.

## Issues Encountered

- Port 8620 was confirmed free via `lsof -i :8620` before every live Playwright run in this plan, per the stated live-run hazard; no port collision occurred.
- `data/pv.db` (the developer's real database) was never touched -- every live run in this plan used Playwright's own isolated, ephemeral SQLite database (`PV_E2E_DB_DIR`), and the manual `curl`-based reproduction/verification of the routing bug used a separate throwaway database under `/tmp`, started and stopped manually, never the `playwright.config.ts`-managed `webServer`.
- The first Playwright run of `settings-route.spec.ts` (before the deviation fix) failed 3/3 attempts (initial + 2 retries) with an identical, deterministic error -- confirming the bug was a genuine, consistent regression, not a flake, before any fix was attempted.

## Known Stubs

None -- both new specs assert against real generated artifacts (a real downloaded file's bytes; a real server's real HTTP responses), not mocked or stubbed data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **This plan is fully complete**, and it is the phase's own closing verification gate (Task 3). All three legs (vitest, build, live e2e regression) are green, with the vitest count matching the recorded current-main baseline exactly (832/832, 80/80 files -- zero net change, since this plan is e2e-only).
- DEBT-02's SC4 evidence bar (real file bytes, not a unit-test-only claim) is now closed, covering both direct and collection-scoped `hidden_password` shares, in both export formats.
- SC1's full claim set (real, linkable, static-export-compatible route; survives a reload; browser back works; no unnecessary re-unlock on a client-side `<Link>` transition) is now closed with live proof, not just the `npm run build` artifact check Plan 29-01 established.
- The static-file routing fix (`rewrite_nested_static_route`) is a general mechanism, not a `/settings`-specific patch -- it will also correctly serve any FUTURE nested static route this app adds (e.g. a hypothetical `/settings/security` sub-route, if the IA ever grows that way), and incidentally also fixes `/self-test`'s identical pre-existing (but previously undiscovered, since nothing in this repo's test suite navigated to it live either) routing gap.
- This is the final plan in Phase 29-a's dependency graph (`depends_on: ["29-01", "29-02", "29-03", "29-04"]`, nothing lists `29-05` as a dependency) -- no further in-phase work is blocked on this plan.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10*

## Self-Check: PASSED

- All 5 files (2 new e2e specs, 2 pv-server files for the deviation fix, this SUMMARY) confirmed present on disk.
- All 3 task/deviation commit hashes (`982a305`, `2f16b34`, `6acdb72`) confirmed present in `git log --oneline --all`.
- Full vitest suite: 832/832 green (80/80 files) -- matches the recorded current-main baseline exactly.
- `npm run build`: exits 0, produces `out/settings.html` / `out/settings.txt` / `out/settings/`.
- Live e2e regression: 23/23 tests pass across `sharing.spec.ts`, `invite-flow.spec.ts`, `remove-member.spec.ts`, `delete-account.spec.ts`, `export-disclosure.spec.ts`, `settings-route.spec.ts`, `smoke.spec.ts`, `shared-sync.spec.ts` in one combined run.
