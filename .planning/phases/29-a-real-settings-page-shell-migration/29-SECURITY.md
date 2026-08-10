---
phase: 29
slug: a-real-settings-page-shell-migration
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-10
---

# Phase 29 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register origin: **authored at plan time, extended retroactively.** Plans 29-01/02/03/06 carried
`<threat_model>` blocks (T-29-01 … T-29-09). Plans 29-04 and 29-05 declared `N/A — test-only plan,
no production code surface changes`. **That declaration is false for 29-05**: commit `2f16b34`
(`fix(29-05): serve nested static routes`) shipped a brand-new request-path-rewriting middleware
into `crates/pv-server/src/routes/mod.rs`. T-29-10 … T-29-13 below are registered retroactively by
this audit to cover the surface no plan declared.

Verification depth: configured `asvs_level: 1`, but every server-side row and every `high` row was
verified **above L1** — a real `pv-server` binary was booted against the real `web/out` export and
probed with live HTTP requests (traversal, encoding, method, header, and route-shadowing families),
and the Rust + vitest suites were executed rather than quoted.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Unauthenticated browser → `/settings` | A cold deep link / bookmark must never render authenticated content, including in the prerendered static artifact | none (must be empty) |
| Authenticated-but-locked session → `/settings` tree | Which components may mount, fetch, and place data in the DOM before the vault is unlocked | server-side account metadata (passkey labels, session rows, family members) |
| Raw HTTP request path → `ServeDir` filesystem lookup | `rewrite_nested_static_route` rewrites the request URI *before* the static file server resolves it — the guard runs on the encoded path, `ServeDir` acts on the decoded one | attacker-controlled path bytes |
| Unmatched `/api/*` request → static fallback | An unregistered/typo'd API path falls through to the same fallback the rewrite layer wraps | attacker-controlled path bytes |
| Complete router → response headers | `Referrer-Policy` / CORS must wrap API routes **and** the static fallback (the `/invite/{invite_id}` landing page is served by the fallback) | `invite_id` via `Referer` |
| In-memory item store → export file on disk | The export writes real plaintext by design; the *statement* about what the file contains must never understate it | plaintext passwords, incl. `hidden_password` items |
| Async hydration window → disclosure computation | The window after unlock where the item set is not yet known | — |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-29-01 | Information Disclosure | `settings/page.tsx` + `AuthGate.tsx` | high | mitigate | Fails closed on all three states. `settings/page.tsx:16-20` wraps `SettingsShell` in `AuthGate` — no sibling render path. `AuthGate.tsx:37` initialises `authed = null`; `:53-55` returns `null` (children never mount) until the mount effect resolves; `:49-50` `const token = getSessionToken(); setAuthed(token !== null && token !== "")` closes the empty-string fail-open (`6568812`). **Independent artifact proof:** `web/out/settings.html` (the prerendered static export an unauthenticated GET actually receives) contains **zero** `data-testid` attributes and zero `settings-section-*` markup — grepped at HEAD. Regression guards executed, not quoted: `settings/page.test.tsx:79-92` (zero-session mount asserts all four sections absent) and `AuthGate.test.tsx` (3 cases: real token / `null` / `""`) — 80 tests green across the 4 relevant suites | closed |
| T-29-02 | Tampering / Spoofing | `SettingsJumpNav.tsx` anchor links | low | accept | See Accepted Risks R-29-01. Premise re-verified: `SettingsJumpNav.tsx:12-17` — `GROUPS` is a module-level const of four literal slugs (`konto`/`bezpieczenstwo`/`dane`/`rodzina`); no `useSearchParams`/`location`/prop feeds it | closed |
| T-29-03 | Elevation of Privilege | `SettingsPanel.tsx` coexistence window | medium | accept (scoped) | See Accepted Risks R-29-03. The coexistence window is now closed by T-29-07's deletion, so the accepted risk has expired rather than persisting | closed |
| T-29-04 | Information Disclosure (false negative / dishonesty) | `ExportDialog.tsx` + `store.ts` hydration | high | mitigate | `ExportDialog.tsx:43-47` — `hiddenPasswordCount` is `null` (never `0`) until `useItemsHydrated()`; `:121` `disabled={hiddenPasswordCount === null}`; `:50-52` a second, independent early return inside `handleConfirm`. `:44-45/:54` the count and the exported bytes derive from the **same** `allItems`/`allFolders` read (WR-06), so the statement cannot describe a different set than the file. `store.ts:311-330` — `hydrated` requires **both** `personalConfirmed` (`:593`) and `sharedConfirmed` (`:1172`/`:1292`/`:1393`) via `maybeMarkHydrated()`; `:1437-1439` re-arms `false` on every unlock. **Folder-scoped shares are counted**, verified structurally and live: `store.ts:233-241` `recomputeItems()` merges `personalItems` + `collectionSharedItems` + `directSharedItems` into the array `useVaultItems()` returns, and `:447-448` assigns a collection-scoped item's `accessLevel` from `getCollectionAccessLevel(row.collection_id)` (direct shares at `:742`). `e2e/export-disclosure.spec.ts:301-348` asserts the disclosed count is exactly **2** (one direct + one reached via a shared folder), that `export-confirm` is not disabled at click time, and reads the real downloaded JSON *and* CSV bytes off disk containing both plaintext passwords. Falsification tests executed: `ExportDialog.test.tsx:175` and `store.test.ts:400` | closed |
| T-29-05 | Information Disclosure (intentional, by design) | export file (`toCsv.ts`/`toJson.ts`) | low | accept | See Accepted Risks R-29-02. Premise re-verified in shipped copy: `dictionary.ts:398-400` states in both locales that the export contains those passwords **and** that "to maskowanie działa tylko w interfejsie, nigdy kryptograficznie" / "that mask is an interface-only protection, never a cryptographic one" | closed |
| T-29-06 | Information Disclosure (open redirect) | `page.tsx` redirect effect | low | accept | See Accepted Risks R-29-01. Premise re-verified: `page.tsx:268-269` — `if (params.get("panel") === "settings") router.replace("/settings")`. The query value is compared, never interpolated into the destination; the destination is a literal | closed |
| T-29-07 | Elevation of Privilege (stale second path) | `SettingsPanel.tsx` removal | medium | mitigate | Genuine deletion, not an orphaned file: `SettingsPanel.tsx` and `SettingsPanel.test.tsx` are absent from `web/src/components/settings/` at HEAD. Repo-wide grep over `web/src` + `web/e2e` for `settings-panel` / `settings-close` / `settings-tab-*` returns only `page.test.tsx:248`'s *absence* assertion. The one surviving `role="tablist"` hit is `SharingOverviewPanel.tsx:419` — Phase 28 code, an unrelated component, not a second route to settings content | closed |
| T-29-08 | Repudiation (false-positive test) | `SettingsSectionData.test.tsx` / `SettingsJumpNav.test.tsx` | medium | mitigate | Both suites assert state **transitions**, not single renders: `SettingsSectionData.test.tsx:61`/`:83` drive click → mount → `onDone`/`onClose` → **unmount** (`:74`/`:90` assert `not.toBeInTheDocument`); `SettingsJumpNav.test.tsx:157`/`:177` drive the component's own captured IntersectionObserver callback and assert active→re-active and never-zero. Independently mutation-falsified by the verifier (29-VERIFICATION.md gap-closure table: stubbing `onClick` reddened exactly the import test; two separate observer-callback mutations reddened 1 and 2 tests respectively) | closed |
| T-29-09 | Tampering | `29-03-PLAN.md` scoped edit | medium | mitigate | `git show 3aeb175 --numstat` on that file → **`3  3`**: exactly three lines added, three removed, matching the three uniquely-identified strings the task named. No unrelated line changed | closed |
| T-29-10 | Tampering (path traversal) | `rewrite_nested_static_route` | high | mitigate | **Registered retroactively — no plan declared this middleware.** `routes/mod.rs:269-277` decodes once (`percent_decode_str(trimmed).decode_utf8().ok()`) then validates the **decoded** value: non-empty, no literal `.`, no NUL, and every `std::path::Component` is `Normal` (`605af09`). `.ok()` on invalid UTF-8 fails closed. Verified by live probe against a real booted server with a planted canary **outside** the static root and a planted `EVIL.html` sibling: `..%2f`, `%2e%2e%2f`, `%252e%252e%252f`, `%2e%2e/`, `..%252f`, `%c0%ae%c0%ae%2f`, `..%5c`, `%5c..%5c`, `....//`, `%2f`, `%00`-prefixed/suffixed, `/a/../../EVIL`, `/..;/EVIL` — **all 21 probes resolved to `index.html` (md5 `c238e77e…`); the canary and EVIL bytes were never returned.** `tests/router_static_fallback.rs` 11/11 green (was 4) | closed |
| T-29-11 | Elevation of Privilege (route shadowing) | `rewrite_nested_static_route` | medium | mitigate | **Registered retroactively.** Two independent structural facts, both verified. (1) The middleware is layered on a *child* router used only as the fallback (`mod.rs:202-205`), so a **registered** route never passes through it at all — live proof: `/api/auth/me`, `/api/vault/items`, `/api/sessions` all still return 401 with the static dir mounted. (2) `mod.rs:250` `!req.uri().path().starts_with("/api/")` is the real guard the 29-05 SUMMARY had claimed without shipping (`fb1a9a2`) — live proof with a planted decoy `out/api/decoy.html`: `GET /api/decoy` returns `index.html`, never the decoy. `HEAD` parity closed at `mod.rs:249` (`6a8feb7`), verified live (`HEAD /settings` `content-length: 10910` = `GET /settings` = `settings.html`, not `index.html`'s 10714). Non-GET/HEAD methods on `/settings` return 405 | closed |
| T-29-12 | Information Disclosure (honesty control weakened) | `store.ts` `doHandleSharedRevisions` | low | mitigate | **OPEN — below `high` threshold (non-blocking).** See Non-Blocking Residuals #1 | open |
| T-29-13 | Information Disclosure | `SettingsShell.tsx` + `PasskeysTab`/`SessionsTab`/`FamilyTab` | medium | mitigate | **OPEN — below `high` threshold (non-blocking).** See Non-Blocking Residuals #2 | open |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-29-01 | T-29-02, T-29-06 | No open-redirect / anchor-injection surface exists to mitigate. Both destinations are compile-time literals: `SettingsJumpNav.tsx:12-17`'s four const slugs, and `page.tsx:269`'s `router.replace("/settings")`. The only user-controlled value in either path (`params.get("panel")`) is *compared* against a literal, never *used as* the destination | 29-01/29-03-PLAN.md (authored disposition), re-verified by gsd-security-auditor | 2026-08-10 |
| R-29-02 | T-29-05 | Locked product decision carried from v0.4 A-6 / 26-CONTEXT.md: `hidden_password` is an interface-only protection, never cryptographic — the recipient already holds the item's Cipher Key and can read the value regardless, so the export cannot withhold it without lying about a protection that does not exist. The accepted risk is discharged by *stating* it: `dictionary.ts:398-400` says so verbatim at export time in both locales. Under PROJECT.md's zero-knowledge constraint this is the honest branch; masking here would be the security defect | Locked product decision (29-CONTEXT.md, v0.4 A-6) | 2026-08-10 |
| R-29-03 | T-29-03 | Time-boxed to the 29-01→29-03 window and now **expired**: during it both surfaces were independently auth-gated (the old panel only ever mounted inside `page.tsx`'s already-authed branch), and 29-03 deleted the second surface outright (T-29-07). No residual acceptance carries forward | 29-01-PLAN.md (scoped acceptance), closed out by 29-03 | 2026-08-10 |

---

## Register Corrections

Recorded so a future audit does not inherit a false premise.

**1. `29-05-PLAN.md`'s threat model is factually wrong.** It states *"Test-only plan; inherits and
does not extend the threat register established in Plans 29-01/29-02/29-03"* and declares no
production surface. In fact plan 29-05 shipped `2f16b34`, which added
`rewrite_nested_static_route` — a middleware that rewrites the HTTP request URI before the static
file server resolves it — to `crates/pv-server/src/routes/mod.rs`. This is new attack surface on the
server's request path, in a phase whose register contained no server row at all. T-29-10 and T-29-11
exist because this audit registered it retroactively; neither was declared, planned for, or flagged.

**2. `29-01-PLAN.md`'s trust-boundary claim is false as shipped.** Its second boundary row asserts
that bypassing `useIsUnlocked()` *"would leak nothing new (data is still fetched only after
unlock)."* `SettingsShell.tsx:58-63` mounts all four sections unconditionally, and
`PasskeysTab.tsx:40-41`, `SessionsTab.tsx:45-46` and `FamilyTab.tsx:199` each fetch from a
`useEffect(…, [])` with no unlock guard. See T-29-13.

**3. `29-05-SUMMARY.md`'s `/api/` guard claim was false when written** (the code review caught it as
WR-03). The guard now genuinely exists at `mod.rs:250` and this audit re-proved it live with a
planted decoy file rather than by re-reading the SUMMARY. Recorded because it is the second
documented instance in this phase of an artifact asserting a guard the code did not contain.

**4. `T-24-10` had silently regressed and is now genuinely restored.** The review found empirically
that `Referrer-Policy` and CORS applied via `.layer()` were **inert on every
`.fallback_service()` response** — axum 0.8's `Router::fallback_service` replaces both fallback
slots with the raw, unlayered service, discarding prior wrapping. That is exactly the surface
T-24-10's threat lives on (`/invite/{invite_id}` is served by the SPA fallback). `fb1a9a2`
restructured `router_with_cors` so the fallback is attached **first** (`mod.rs:205`) and both layers
wrap the complete router **last** (`mod.rs:216-217`).
**Verified by issuing real requests, not by reading layer order** — a real `pv-server` booted
against `web/out`:

| Request | `Referrer-Policy` | ACAO (allowlisted origin) | ACAO (`https://evil.example`) |
|---|---|---|---|
| `GET /healthz` (API, 200) | `strict-origin-when-cross-origin` | echoed | absent |
| `GET /api/auth/me` (API, 401) | `strict-origin-when-cross-origin` | echoed | absent |
| `GET /` (static fallback) | `strict-origin-when-cross-origin` | echoed | absent |
| `GET /settings` (rewritten static) | `strict-origin-when-cross-origin` | echoed | absent |
| `GET /invite/abc123deadbeef` (**T-24-10's own surface**) | `strict-origin-when-cross-origin` | echoed | absent |
| `GET /_next/static` (307 redirect) | `strict-origin-when-cross-origin` | — | — |

`GET /settings` returned `settings.html`'s exact bytes (md5 `5eb9287f…`), not `index.html`'s
(`c238e77e…`); `/invite/…` correctly returned `index.html`'s.

---

## Non-Blocking Residuals

Both are below the `high` block threshold; neither counts toward `threats_open`.

**1. T-29-12 — `hydrated` can flip true on the bounded-retry fail-open path (low, open).**
`store.ts:1263-1277`: after `MAX_FAILED_MERGE_RETRIES` (= 3, `:478`) consecutive partially-failed
shared passes, `sharedRevisionsWatermark` is force-advanced **even though `anyStepFailed` is true**,
so `sharedConfirmed` correctly stays `false` on that pass — but the *next* tick then takes
`sharedRevisionsChanged() === false` and lands on `:1166-1174`, which sets `sharedConfirmed = true`
and marks hydrated. The stated invariant ("`hydrated` must mean the hidden-password set is genuinely
known") is therefore violated after a persistent shared-fetch failure. This is precisely the
interaction `29-REVIEW-FIX.md`'s own logic-verification flag said was *"reasoned through rather than
exhaustively tested"*; this audit traced it and confirms the hole is real.
*Why it is low, not high:* CR-02/WR-06 made the disclosure count and the exported bytes derive from
one `allItems` read (`ExportDialog.tsx:44/54`), so a shared item missing from the store is missing
from **both** — the file never contains a hidden-password item the sentence failed to count. The
residual is export *completeness* (a silently partial backup), not a false claim of protection, so
PROJECT.md Non-Negotiable #4 is not breached. Suggested fix: gate `:1172`'s confirmation on
`failedSharedRefreshAttempts === 0`, or clear `sharedConfirmed` when the watermark is force-advanced.

**2. T-29-13 — `/settings` mounts and fetches account metadata while the vault is locked (medium, open).**
`SettingsShell.tsx:58-63` mounts `SettingsSectionAccount`/`Security`/`Data`/`Family`
unconditionally; the only lock-dependent thing at that level is the cosmetic
`className={!unlocked ? "blur-md" : undefined}` at `:27`. `PasskeysTab.tsx:40-41`,
`SessionsTab.tsx:45-46` and `FamilyTab.tsx:199` all fire their fetch from a bare
`useEffect(…, [])`. So a cold deep link to `/settings` with a valid session but a **locked** vault
now issues `GET /api/passkeys`, `GET /api/sessions` and the family-state fetches, and paints passkey
labels, session rows and family-member emails into the DOM behind a CSS blur and
`UnlockOverlay`'s `fixed inset-0 z-50` scrim (`UnlockOverlay.tsx:68-70` confirms it renders exactly
when `sessionToken !== null && !unlocked`). This is a genuine delta: pre-Phase-29 the drawer was
only reachable by a click the overlay intercepted.
*Why it is medium, not high:* nothing here is vault plaintext, a key, or PRF output — the
zero-knowledge boundary is untouched, and every one of these values is server-side metadata the
session token already authorises. The export/import CTAs are **not** affected (they are click-gated
behind the same scrim, so `ExportDialog` never mounts while locked). The realistic attacker is
someone with local access to an unattended, locked-but-authenticated browser using devtools; a
script-level attacker already holds the localStorage session token and could call these endpoints
directly. Suggested fix: gate the four sections on `unlocked` in `SettingsShell.tsx` (matching the
"no data in the render tree" contract `page.tsx:335-338` states for `MainColumn`), rather than
relying on `blur-md`.

**3. `/api/` guard is case-sensitive while the filesystem may not be (informational, no register row).**
`mod.rs:250` compares `starts_with("/api/")` literally. On a case-insensitive filesystem (macOS dev,
Docker Desktop bind mount) a `GET /API/<name>` therefore bypasses the guard and *can* resolve to
`out/api/<name>.html` — reproduced live on this machine with a planted decoy (`GET /API/decoy`
returned the decoy bytes while `GET /api/decoy` correctly returned `index.html`). **Not exploitable
in the shipped artifact:** a real Next.js export contains no `out/api/` directory at all, the
production target is Linux/overlayfs (case-sensitive), and a *registered* API route is dispatched
before the fallback regardless of case. Recorded as hardening only.

**4. Reasoned and cleared — the encoded/decoded asymmetry is conservative, not a hole.**
`mod.rs:279` builds the candidate from `trimmed` (the still-**encoded** path) while `:270-277`
validates `decoded`. This looks like the WR-02 class of bug re-appearing one line down; it is not.
Percent-decoding never *removes* a literal `.` or `/` (neither is a hex digit or `%`), so any
traversal character present in `trimmed` is necessarily present in `decoded` and is rejected there —
validation on the decoded value is strictly stronger for every traversal-relevant byte. The
asymmetry's only effect is that an encoded path can never *match* a real file (the existence probe
looks for a literal `%2e…`-named file), so the rewrite silently declines and falls through. Recorded
so a future audit does not re-flag it, and so the reasoning is on record if that line ever changes.

**Process gap (not a threat):** none of the six `29-0N-SUMMARY.md` files contains a
`## Threat Flags` section. The executor never populated the declared channel, so T-29-10 … T-29-13
had to be recovered from the diff and from `29-REVIEW.md`. This is the **second consecutive
milestone** with this gap (23-SECURITY.md recorded it verbatim for Phases 24–27). The section is
evidently not being written; either enforce it in the executor template or stop treating its absence
as evidence of no new surface.

---

## Zero-Knowledge Invariant

Explicitly re-checked across `084f53e..HEAD`, since PROJECT.md makes this absolute
("serwer nigdy nie widzi PRF output, kluczy, plaintextu"):

- **No new server transmission.** The diff adds no `fetch`/`apiPost`/`apiPut` call and no new field
  on any existing request body. `crates/` changes are confined to routing/middleware and tests.
- **No key, PRF output, or plaintext in any log.** The two new `tracing::warn!` calls
  (`mod.rs:294-298`, `:318-322`) emit only an `io::Error`/URI-parse error plus a filesystem path
  derived from the request path — no request body, no header, no token. The one new client-side
  `console.error` (`store.ts:1462-1465`) logs a `Promise.allSettled` rejection reason;
  `loadAndDecryptAll` (`store.ts:597-603`) can only reject with an API/network error, since
  `applySyncSnapshot` catches decrypt failures internally — and it is a browser console, not a
  server sink.
- **Export path unchanged.** `toCsv.ts`/`toJson.ts`/`download.ts` are untouched by this phase;
  plaintext leaves memory only via the intended `downloadFile` call at `ExportDialog.tsx:57`.
- **`main.rs`'s `/api/sync/ws` query-string redaction** (`span_uri_field`) is untouched and still
  covered by its own unit tests.

**Verdict: intact.** Nothing in this diff moves a key, a PRF output, or plaintext toward the server
or a log.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open (blocking) | Open (non-blocking) | Run By |
|------------|---------------|--------|-----------------|---------------------|--------|
| 2026-08-10 | 13 | 11 | 0 | 2 | gsd-security-auditor (opus) |

**Evidence executed for this audit (not quoted from SUMMARY/VERIFICATION):**
- `cargo test -p pv-server --test router_static_fallback` → **11 passed, 0 failed**
- `npx vitest run AuthGate.test.tsx settings/page.test.tsx ExportDialog.test.tsx store.test.ts` →
  **80 passed, 0 failed** (4 files)
- Real `pv-server` booted against the real `web/out` export; ~40 live HTTP probes across traversal,
  double/overlong encoding, backslash, NUL, method (`GET`/`HEAD`/`POST`/`PUT`/`DELETE`/`OPTIONS`/`PATCH`),
  header, and `/api/*` shadowing families, with planted canary/decoy files inside and outside the
  static root. All planted files removed afterwards (`git status` clean).
- `grep` of `web/out/settings.html` (the artifact an unauthenticated GET receives) for authenticated
  markup → zero matches.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed — the two open threats (T-29-12 `low`, T-29-13 `medium`) are both
      below the configured `security_block_on: high` gate and do not block ship
- [x] Two false premises in the phase's own planning artifacts corrected on the record
- [x] Zero-knowledge invariant re-verified against the diff
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-10
