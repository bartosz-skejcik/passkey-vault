---
phase: 29-a-real-settings-page-shell-migration
fixed_at: 2026-08-10T10:30:00Z
review_path: .planning/phases/29-a-real-settings-page-shell-migration/29-REVIEW.md
iteration: 1
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 29: Code Review Fix Report

**Fixed at:** 2026-08-10T10:30:00Z
**Source review:** .planning/phases/29-a-real-settings-page-shell-migration/29-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 14 (3 Critical, 9 Warning, 2 Info — IN-03/IN-04/IN-05 explicitly out of scope per fix_context)
- Fixed: 14
- Skipped: 0

## Fixed Issues

### CR-01: `hydrated` does not cover the shared-item pipeline

**Files modified:** `web/src/lib/vault/store.ts`, `web/src/lib/vault/store.test.ts`
**Commit:** `7978605`
**Applied fix:** `hydrated` no longer flips true from `loadAndDecryptAll()` (personal items) alone. Added `personalConfirmed`/`sharedConfirmed` module flags and a `maybeMarkHydrated()` helper that only raises `hydrated` once BOTH the personal snapshot (`applySyncSnapshot`) AND the shared pipeline (`doHandleSharedRevisions`'s clean-pass branch, or `refreshSharedItemsNow`'s confirmed-404-no-family branch) have genuinely confirmed their item sets. The unlock branch now runs both loaders through `Promise.allSettled(...)` and only logs a rejected leg — it never sets `hydrated` directly, so a later successful background poll can still recover a session whose initial attempt failed (closes WR-05 in the same fix; see below). A partially-failed shared-revisions pass (a real fetch failure, not just a decrypt failure) deliberately does NOT confirm — only a fully clean pass, or a definitive 404 (no family), counts as "known".
**New test:** `store.test.ts`'s "CR-01 falsification" test resolves the personal snapshot but leaves `getSharedRevisions()` permanently pending and asserts `isItemsHydrated() === false`. Verified this fails against the pre-fix code (`isItemsHydrated()` incorrectly returned `true`) before the fix, and passes after.

### CR-02: `ExportDialog` reads `getItems()` non-reactively

**Files modified:** `web/src/components/vault/ExportDialog.tsx`, `web/src/components/vault/ExportDialog.test.tsx`
**Commit:** `7978605`
**Applied fix:** `ExportDialog` now subscribes to `useVaultItems()`/`useFolders()` (reactive `useSyncExternalStore` hooks) instead of reading `getItems()`/`getFolders()` as a plain snapshot. `handleConfirm()` now builds the export from the SAME `allItems`/`allFolders` array the disclosure count was computed from (closes WR-06 in the same fix), not a second independent read.
**New test:** a reactivity test mounts the dialog, mutates the mocked `useVaultItems()` return value (simulating a background sync merge landing while the dialog is open), re-renders, and asserts the disclosure count updates and `handleConfirm` exports the new set.

### CR-03: `Referrer-Policy`/CORS never reach the static fallback

**Files modified:** `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/router_static_fallback.rs`
**Commit:** `fb1a9a2`
**Applied fix:** restructured `router_with_cors` to attach `.fallback_service(static_service)` BEFORE `.layer(cors).layer(referrer_policy_middleware)` runs, so both layers wrap the complete router (API routes AND the static fallback), not just the pre-fallback API sub-chain. Corrected the comment at the old call site, which asserted the (then-false) opposite in writing.
**New test:** `referrer_policy_header_reaches_the_static_fallback_not_only_the_api` builds the real router against a temp static dir and asserts `Referrer-Policy` on `/healthz`, `/`, and `/settings/whatever`. Verified this fails pre-fix (`/` and `/settings/whatever` had no header) and passes post-fix.

### WR-01: zero test coverage for `rewrite_nested_static_route`

**Files modified:** `crates/pv-server/tests/router_static_fallback.rs`
**Commits:** `fb1a9a2`, `6a8feb7`, `605af09`, `68caf26`, `056180d`
**Applied fix:** added comprehensive integration coverage across the fix commits above plus a dedicated closing commit: happy path (`GET /settings` → `settings.html` bytes), `HEAD` parity, the `/api/` guard, two percent-encoded traversal forms, an I/O-error existence-probe path (genuine `ENOTDIR`, not just `Ok(false)`), and query-string preservation through the rewrite. 11 tests total in `router_static_fallback.rs` now (was 4).

### WR-02: traversal guard inspected the encoded path

**Files modified:** `crates/pv-server/Cargo.toml`, `Cargo.lock`, `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/router_static_fallback.rs`
**Commit:** `605af09`
**Applied fix:** the guard now percent-decodes `trimmed` once via `percent_encoding::percent_decode_str` (promoted from an already-transitively-resolved dependency to a direct one) and validates the DECODED value explicitly (non-empty, no literal `.`, no NUL, every path component `Normal`) instead of inspecting the raw encoded literal. Honest caveat documented in code and here: this was a structural/defense-in-depth fix, not a fix to a currently-exploitable bug — `ServeDir`'s own independent sanitization was already the effective safety net (the review's own words). The added test (`percent_encoded_traversal_attempts_never_escape_the_static_root`) therefore passes both pre- and post-fix at the HTTP boundary; it is included anyway as real regression coverage and because it's exactly what WR-01's fix guidance asked for verbatim.

### WR-03: the `/api/` guard the SUMMARY claimed existed

**Files modified:** `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/router_static_fallback.rs`
**Commit:** `fb1a9a2`
**Applied fix:** added the actual `!req.uri().path().starts_with("/api/")` guard to `rewrite_nested_static_route`.
**New test:** `api_prefixed_unmatched_path_is_never_rewritten_to_a_static_file` places a decoy `out/api/does-not-exist.html` and confirms a `GET /api/does-not-exist` never resolves to that decoy (falls through to the ordinary SPA `index.html` instead). Verified fails pre-fix (decoy bytes returned), passes post-fix.

### WR-04: `HEAD` bypassed the rewrite

**Files modified:** `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/router_static_fallback.rs`
**Commit:** `6a8feb7`
**Applied fix:** the method check now matches `GET | HEAD`.
**New test:** `head_request_to_a_nested_route_matches_get_not_the_root_spa` compares `Content-Length` between `GET /settings` and `HEAD /settings`. Verified fails pre-fix (HEAD's length matched `index.html`'s, not `settings.html`'s), passes post-fix.

### WR-05: rejected `loadAndDecryptAll()` latched `hydrated` false forever, unhandled rejection

**Files modified:** `web/src/lib/vault/store.ts`, `web/src/lib/vault/store.test.ts`
**Commit:** `7978605` (fixed together with CR-01 — the review's own CR-01 fix text explicitly said "a rejected leg must surface (see WR-05)")
**Applied fix:** the unlock branch's `Promise.allSettled([...]).then(...)` handles rejection explicitly (logs via `console.error`, no unhandled rejection) and never permanently latches `hydrated` false: `applySyncSnapshot` (called on every later successful background poll, not just the initial load) sets `personalConfirmed = true` on any completed merge, re-arming hydration once the shared side has also confirmed.

### WR-06: `handleConfirm` exported a different snapshot than the disclosure described

**Files modified:** `web/src/components/vault/ExportDialog.tsx`
**Commit:** `7978605` (fixed together with CR-02, same root cause)
**Applied fix:** see CR-02 above — one `allItems`/`allFolders` read, used for both the disclosure count and the export.

### WR-07: both middleware failure paths failed silently

**Files modified:** `crates/pv-server/src/routes/mod.rs`, `crates/pv-server/tests/router_static_fallback.rs`
**Commit:** `68caf26`
**Applied fix:** `tokio::fs::try_exists`'s `Err` branch and the URI-parse failure branch now both `tracing::warn!` with the underlying error, instead of collapsing to `unwrap_or(false)` / silent `if let Ok`.
**New test:** `existence_probe_io_error_falls_through_safely_never_panics` forces a genuine `ENOTDIR` (verified empirically, not assumed) and asserts the request still resolves to the ordinary SPA fallback, never a panic. Note: the `tracing::warn!` emission itself is not independently captured by an automated assertion — this crate has no tracing-capture test harness yet; the fail-safe *behavior* the logging protects is what's tested.

### WR-08: `SettingsJumpNav` observes every `section[id]` in the document

**Files modified:** `web/src/components/settings/SettingsJumpNav.tsx`, `web/src/components/settings/SettingsJumpNav.test.tsx`
**Commit:** `8e1430b`
**Applied fix:** the scroll-spy now looks up the four known `GROUPS` ids via `document.getElementById` instead of a global `querySelectorAll("section[id]")`.
**New test:** mocks `IntersectionObserver`, plants a foreign `<section id>` elsewhere in the document, and asserts only the four known sections are ever observed. Verified fails pre-fix (the foreign section was observed too), passes post-fix.

### WR-09: `panel=settings` test dropped its query-stripping assertion

**Files modified:** `web/src/app/page.test.tsx`, `web/e2e/settings-route.spec.ts`
**Commit:** `e1ff07f`
**Applied fix:** the unit test now additionally asserts `router.replace` was called exactly once AND `router.push` was never called (a named, assertable mock, closing what the fully-mocked `next/navigation` layer can prove). Added a new live Playwright test in `settings-route.spec.ts` that navigates a real browser to `/?panel=settings` and asserts `page.url()` lands on `/settings` with an empty query string — verified passing against the real dev server.

### IN-01: five orphaned `settings.tab*` i18n keys

**Files modified:** `web/src/lib/i18n/dictionary.ts`
**Commit:** `6568812`
**Applied fix:** deleted `settings.tabPasskeys`/`tabSessions`/`tabSecurity`/`tabImportExport`/`tabFamily` (confirmed zero remaining call sites) and updated the two surrounding comments that referenced them.

### IN-02: `AuthGate` treats an empty-string session token as authenticated

**Files modified:** `web/src/lib/auth/AuthGate.tsx`, `web/src/lib/auth/AuthGate.test.tsx` (new)
**Commit:** `6568812`
**Applied fix:** `setAuthed(getSessionToken() !== null)` → `const token = getSessionToken(); setAuthed(token !== null && token !== "")`.
**New test:** `AuthGate.test.tsx` (didn't exist before) covers all three cases: real token → children render; `null` → AuthCard; `""` → AuthCard (falsification test, verified fails against the pre-fix implementation — `protected-content` rendered instead of the login form).

## Skipped Issues

None — all in-scope findings were fixed.

**Out of scope by explicit fix_context instruction (not attempted):** IN-03 (bare `"2"` substring match in `export-disclosure.spec.ts`), IN-04 (Sidebar hidden on `/settings`, no logout affordance), IN-05 (scroll-spy picks first intersecting entry from a partial callback batch).

## Verification Summary

- `cd web && npm test` (vitest): **838 passed** / 82 files (baseline 832/80 + 6 new tests: CR-01 falsification, CR-02 reactivity, WR-08 scoping, 3 in `AuthGate.test.tsx`)
- `cd web && npm run build`: succeeds; `out/settings.html`, `out/settings.txt`, `out/settings/` all present; all 4 routes (`/`, `/_not-found`, `/self-test`, `/settings`) report `○ (Static)`
- `cargo check --workspace` and `cargo test --workspace`: all green (pv-server: 306 tests across all integration files + unit tests, including 11 in `router_static_fallback.rs`, up from 4)
- Live e2e (real dev server, port 8620): `export-disclosure.spec.ts` (3 tests), `settings-route.spec.ts` (2 tests incl. the new WR-09 test), `invite-flow.spec.ts` (6 tests) — all pass

## Logic-verification flags

Per the fixer's verification-strategy rules, findings whose fix involved non-trivial state-machine/timing logic (not pure syntax) are flagged here for human confirmation of correctness, even though all automated tests pass:

- **CR-01/WR-05 (`store.ts` hydration state machine)** — `personalConfirmed`/`sharedConfirmed`/`maybeMarkHydrated()` introduce new cross-pipeline state. Automated tests cover the documented scenarios (personal-then-shared, shared-404-no-family, rejected-then-recovered), but the interaction with `MAX_FAILED_MERGE_RETRIES`-bounded partial-failure retries in `doHandleSharedRevisions` was reasoned through rather than exhaustively tested for every retry-count edge. Recommend a human skim of the `sharedConfirmed` assignment sites (3 of them: the unchanged-payload early return, the clean-pass end-of-function branch, and `refreshSharedItemsNow`'s 404 branch) against the "hydrated must mean the hidden-password set is genuinely known" invariant.
- **CR-03 (`router_with_cors` layering order)** — reordering `.fallback_service()` relative to `.layer()` is a structural axum-internals argument (documented in code comments, verified empirically via the new test), not something exhaustively covered by axum's own type system.

---

_Fixed: 2026-08-10T10:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
